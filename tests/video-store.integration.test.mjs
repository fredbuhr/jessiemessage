// Candidate video DDL is exercised only on a disposable loopback database.
// These tests do not promote migrations, register routes or touch real media.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { databaseOptions, connectDatabase } from "../server/db/connection.mjs";
import { applyMigrations, createdMigrationTables, loadMigrations } from "../server/db/migrations.mjs";
import { createRuntimePool } from "../server/db/runtime.mjs";
import { newToken, tokenDigest } from "../server/auth/crypto.mjs";
import { createAuthStore } from "../server/auth/store.mjs";
import { createChatStore, ChatStoreError } from "../server/chat/store.mjs";
import { createVideoStore } from "../server/video/store.mjs";
import { loadVideoMigrations } from "../server/video/migrations.mjs";
import { createVideoService } from "../server/video/service.mjs";
import { createVideoStorage, VIDEO_BLOCK_BYTES, videoStoredBytes } from "../server/video/storage.mjs";
import { consumeSyntheticInvitation } from "./fixtures/manual-admission.mjs";
import { mp4Source, collectVideo } from "./helpers/video-transport-fixture.mjs";

const enabled = process.env.JESSIEMESSAGE_DB_TEST === "1";
const id = () => randomBytes(16), digest = () => randomBytes(32);
const hex = (value) => value.toString("hex");
const sql = (value) => new Date(value).toISOString().replace("T", " ").replace("Z", "000");
const code = (...expected) => (error) => error instanceof ChatStoreError && expected.includes(error.code)
  && error.cause === undefined && !error.message.includes("synthetic acknowledgement");

test("real MariaDB dormant video catalog reserves, commits and reconciles durable capacity", {
  skip: enabled ? false : "Set JESSIEMESSAGE_DB_TEST=1 with an explicit loopback disposable database.", timeout: 180000,
}, async (t) => {
  const options = databaseOptions();
  assert.ok(["127.0.0.1", "::1", "localhost"].includes(options.host), "integration tests require loopback");
  assert.match(options.database, /^jessiemessage_test(?:_[a-z0-9]+)*$/, "integration tests require an isolated disposable schema");
  assert.ok(process.env.JESSIEMESSAGE_RUNTIME_DB_USER && process.env.JESSIEMESSAGE_RUNTIME_DB_PASSWORD,
    "integration tests require a separately provisioned DML-only runtime account");
  assert.notEqual(process.env.JESSIEMESSAGE_RUNTIME_DB_USER, options.user);
  const base = await loadMigrations(), candidates = await loadVideoMigrations();
  assert.equal(base.length, 33); assert.equal(candidates.length, 36);
  assert.deepEqual(candidates.slice(0, 33), base, "candidate qualification preserves the exact normal migration plan");
  const allowedTables = [...createdMigrationTables(candidates).reverse(), "migration_probe", "schema_migrations"];
  const connection = await connectDatabase(); let pool;
  const now = Date.UTC(2026, 9, 21, 12), created = sql(now - 1000), clock = () => now;
  async function reset() {
    const tables = await connection.query("SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?", [options.database]);
    assert.ok(tables.every((row) => allowedTables.includes(row.name)), "refuse cleanup when unrelated tables are present");
    for (const table of allowedTables) await connection.query(`DROP TABLE IF EXISTS ${table}`);
  }
  async function session(owner) {
    const result = { ...owner, sessionId: id(), token: newToken() }; result.tokenHash = tokenDigest(result.token);
    await connection.query("INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
      [result.sessionId, result.id, result.tokenHash, created, sql(now + 8 * 3600000)]);
    await connection.query(result.role === "admin"
      ? "INSERT INTO auth_session_state (session_id, last_seen_at, mfa_verified_at, mfa_version) VALUES (?, ?, ?, 1)"
      : "INSERT INTO client_session_state (session_id, last_seen_at, credential_version) VALUES (?, ?, 1)",
    result.role === "admin" ? [result.sessionId, created, created] : [result.sessionId, created]);
    return result;
  }
  async function user(role) {
    const value = { id: id(), role, pseudonym: `Synthetic video ${role}` };
    await connection.query(`INSERT INTO users (id, role, status, pseudonym, email, password_hash, email_verified_at,
      age_assured_at, access_approved_at, created_at, updated_at) VALUES (?, ?, 'active', ?, ?, 'synthetic-not-a-password', ?, ?, ?, ?, ?)`,
    [value.id, role, value.pseudonym, `${hex(value.id)}@example.invalid`, created, created, created, created, created]);
    if (role === "admin") await connection.query("INSERT INTO admin_mfa (user_id, secret_encrypted, version, last_totp_step, enabled_at) VALUES (?, 'synthetic', 1, 1, ?)", [value.id, created]);
    else {
      await connection.query("INSERT INTO client_auth_state (user_id, credential_version, age_declared_at) VALUES (?, 1, ?)", [value.id, created]);
      await consumeSyntheticInvitation(connection, value.id, now - 1000);
    }
    return session(value);
  }
  async function pair(admin = null) {
    const fixture = { admin: admin ?? await user("admin"), client: await user("client"), conversationId: id() };
    await connection.query("INSERT INTO conversations (id, admin_id, client_id, created_at) VALUES (?, ?, ?, ?)",
      [fixture.conversationId, fixture.admin.id, fixture.client.id, created]);
    return fixture;
  }
  const actor = (owner, extra = {}) => ({ role: owner.role, tokenHash: owner.tokenHash, now, ...extra });
  const asset = (bytes = VIDEO_BLOCK_BYTES + 17) => ({ id: id(), storageKey: digest(), bytes, storedBytes: videoStoredBytes(bytes), mime: "video/mp4" });
  const committed = (value) => ({ ...value, digest: digest() });
  const release = (store, owner, value, changes = {}) => store.release({ ...actor(owner), assetId: value.id, storageKey: value.storageKey, ...changes });
  function catalog(capacity, selectedPool = pool) {
    return createVideoStore({ pool: selectedPool, chatStore: createChatStore(selectedPool, { clock }), capacity });
  }
  async function fresh({ ownerBytes = 10 * 1024 * 1024, totalBytes = 20 * 1024 * 1024, initialize = true } = {}) {
    await connection.query("DELETE FROM video_assets"); await connection.query("DELETE FROM video_storage_state");
    const capacity = { ownerBytes, totalBytes, rootFingerprint: digest() }, store = catalog(capacity);
    if (initialize) await store.initialize({ now, offline: true });
    return { capacity, store };
  }
  // This proxy loses an acknowledgement only AFTER the native transaction has
  // committed. A rollback-only mock cannot prove persistence after uncertainty.
  function lostAcknowledgementPool() {
    let armed = false, losses = 0;
    return { arm() { armed = true; }, get losses() { return losses; }, async getConnection() {
      const native = await pool.getConnection();
      return new Proxy(native, { get(target, name) {
        if (name === "commit") return async () => { await target.commit(); if (armed) { armed = false; losses++; throw new Error("synthetic acknowledgement lost after actual SQL commit"); } };
        const value = target[name]; return typeof value === "function" ? value.bind(target) : value;
      } });
    } };
  }
  try {
    await reset(); await applyMigrations(connection, { database: options.database, migrations: base });
    pool = await createRuntimePool(process.env);
    assert.equal(await createChatStore(pool, { clock }).assertSchema(), true, "qualify the normal schema 33 before applying candidates");
    assert.equal(Number((await connection.query("SELECT COUNT(*) AS count FROM schema_migrations"))[0].count), 33);
    await applyMigrations(connection, { database: options.database, migrations: candidates });
    assert.equal(Number((await connection.query("SELECT COUNT(*) AS count FROM schema_migrations"))[0].count), 36);
    assert.equal((await loadMigrations()).length, 33, "candidate qualification never promotes the normal loader");

    await t.test("offline initialization is explicit, idempotent and bound to root and both quotas", async () => {
      const { capacity, store } = await fresh({ initialize: false }), owner = (await pair()).client, value = asset();
      assert.equal(await store.assertSchema(), true); assert.equal((await store.status()).ready, false);
      await assert.rejects(store.reserve({ ...actor(owner), asset: value }), code("VIDEO_CAPACITY_UNAVAILABLE"));
      await assert.rejects(store.initialize({ now, offline: false }), code("VIDEO_INPUT"));
      const initialized = await store.initialize({ now, offline: true });
      assert.equal(initialized.ready, true); assert.equal(initialized.heldBytes, 0); assert.equal(initialized.pendingBytes, 0);
      assert.deepEqual(await store.initialize({ now, offline: true }), initialized);
      for (const changed of [{ ...capacity, ownerBytes: capacity.ownerBytes - 1 }, { ...capacity, totalBytes: capacity.totalBytes + 1 }, { ...capacity, rootFingerprint: digest() }]) {
        const other = catalog(changed);
        await assert.rejects(other.status(), code("VIDEO_CAPACITY_UNAVAILABLE"));
        await assert.rejects(other.initialize({ now, offline: true }), code("VIDEO_CAPACITY_UNAVAILABLE"));
        await assert.rejects(other.reserve({ ...actor(owner), asset: asset() }), code("VIDEO_CAPACITY_UNAVAILABLE"));
      }
      assert.equal((await store.status()).heldBytes, 0);
    });

    await t.test("candidate DDL rejects weakened checks, keys, ownership links and dirty history", async () => {
      const { store } = await fresh(); assert.equal(await store.assertSchema(), true);
      await connection.query("UPDATE schema_migrations SET state = 'failed', finished_at = NULL WHERE version = ?", [candidates.at(-1).version]);
      try { await assert.rejects(store.assertSchema(), code("VIDEO_DATABASE_STATE")); }
      finally { await connection.query("UPDATE schema_migrations SET state = 'applied', finished_at = CURRENT_TIMESTAMP(6) WHERE version = ?", [candidates.at(-1).version]); }
      for (const [alter, restore] of [
        ["ALTER TABLE video_storage_state ENGINE = MyISAM", "ALTER TABLE video_storage_state ENGINE = InnoDB"],
        ["ALTER TABLE video_storage_state MODIFY held_bytes BIGINT NOT NULL", "ALTER TABLE video_storage_state MODIFY held_bytes BIGINT UNSIGNED NOT NULL"],
        ["ALTER TABLE video_storage_state MODIFY root_fingerprint VARBINARY(32) NULL", "ALTER TABLE video_storage_state MODIFY root_fingerprint VARBINARY(32) NOT NULL"],
        ["ALTER TABLE video_assets DROP INDEX video_assets_storage", "ALTER TABLE video_assets ADD UNIQUE KEY video_assets_storage (storage_key)"],
        ["ALTER TABLE video_assets DROP FOREIGN KEY video_assets_owner_fk", "ALTER TABLE video_assets ADD CONSTRAINT video_assets_owner_fk FOREIGN KEY (owner_id, owner_role) REFERENCES users (id, role) ON UPDATE RESTRICT ON DELETE RESTRICT"],
      ]) {
        await connection.query(alter); try { await assert.rejects(store.assertSchema(), code("VIDEO_DATABASE_STATE")); } finally { await connection.query(restore); }
      }
      await connection.query("ALTER TABLE video_assets DROP CONSTRAINT video_assets_bytes");
      await connection.query("ALTER TABLE video_assets ADD CONSTRAINT video_assets_bytes CHECK (bytes > 0)");
      try { await assert.rejects(store.assertSchema(), code("VIDEO_DATABASE_STATE")); }
      finally {
        await connection.query("ALTER TABLE video_assets DROP CONSTRAINT video_assets_bytes");
        await connection.query("ALTER TABLE video_assets ADD CONSTRAINT video_assets_bytes CHECK (bytes BETWEEN 1 AND 104857600 AND stored_bytes = 48 + bytes + 16 * ((bytes + 262143) DIV 262144))");
      }
      assert.equal(await store.assertSchema(), true);
    });

    await t.test("owned library pagination isolates accounts and retains cleanup intents only", async () => {
      const { store } = await fresh(), owner = (await pair()).client, other = (await pair()).client;
      const values = Array.from({ length: 5 }, () => asset(100));
      for (const [index, value] of values.entries()) {
        const account = index === 4 ? other : owner;
        await store.reserve({ ...actor(account), asset: value });
        if (index === 1) await release(store, owner, value);
        else if (index !== 0) await store.commit({ ...actor(account), asset: committed(value) });
      }
      await store.deleteAsset({ ...actor(owner), assetId: values[3].id });
      const expected = [values[2], values[3]].sort((a, b) => Buffer.compare(a.id, b.id));
      const held = (await store.status()).heldBytes;
      const first = await store.listOwned({ ...actor(owner), limit: 1 });
      assert.equal(first.hasMore, true); assert.ok(first.nextCursor.equals(expected[0].id));
      assert.equal(first.assets.length, 1); assert.ok(first.assets[0].ownerId.equals(owner.id));
      const second = await store.listOwned({ ...actor(owner), afterId: first.nextCursor, limit: 1 });
      assert.equal(second.hasMore, false); assert.equal(second.nextCursor, null);
      assert.ok(second.assets[0].id.equals(expected[1].id));
      const all = [...first.assets, ...second.assets];
      assert.equal(all.filter(value => value.deletedAt !== null).length, 1);
      assert.equal((await store.listOwned({ ...actor(other), limit: 100 })).assets.length, 1);
      assert.equal((await store.status()).heldBytes, held, "a library read never releases capacity");
      for (const options of [{ limit: 0 }, { limit: 101 }, { afterId: Buffer.alloc(15) }]) await assert.rejects(store.listOwned({ ...actor(owner), ...options }), code("VIDEO_INPUT"));
      await connection.query("UPDATE sessions SET revoked_at = ? WHERE id = ?", [sql(now), owner.sessionId]);
      await assert.rejects(store.listOwned({ ...actor(owner) }), code("CHAT_UNAUTHORIZED"));
    });

    await t.test("SQL itself enforces encrypted-byte accounting, state, role, digest and ownership", async () => {
      const { store } = await fresh(), owner = (await pair()).client, value = asset(); await store.reserve({ ...actor(owner), asset: value });
      for (const [statement, parameters] of [
        ["UPDATE video_assets SET stored_bytes = stored_bytes + 1 WHERE id = ?", [value.id]],
        ["UPDATE video_assets SET mime = 'image/jpeg' WHERE id = ?", [value.id]],
        ["UPDATE video_assets SET reserve_token_hash = ? WHERE id = ?", [Buffer.alloc(31), value.id]],
        ["UPDATE video_assets SET state = 'committed' WHERE id = ?", [value.id]],
        ["UPDATE video_assets SET content_digest = ? WHERE id = ?", [digest(), value.id]],
        ["UPDATE video_assets SET owner_role = 'admin' WHERE id = ?", [value.id]],
        ["UPDATE video_assets SET owner_id = ? WHERE id = ?", [id(), value.id]],
        ["UPDATE video_storage_state SET held_bytes = total_bytes + 1 WHERE id = 1", []],
        ["UPDATE video_storage_state SET root_fingerprint = ? WHERE id = 1", [Buffer.alloc(31)]],
      ]) await assert.rejects(connection.query(statement, parameters));
      const row = (await connection.query("SELECT state, stored_bytes, content_digest FROM video_assets WHERE id = ?", [value.id]))[0];
      assert.equal(row.state, "reserved"); assert.equal(Number(row.stored_bytes), value.storedBytes); assert.equal(row.content_digest, null);
      assert.equal((await store.status()).heldBytes, value.storedBytes);
    });

    await t.test("a corrupted durable counter fails every mutation without weakening SQL limits", async () => {
      const { store } = await fresh(), owner = (await pair()).client, value = asset(901);
      await store.reserve({ ...actor(owner), asset: value });
      // This remains inside the SQL CHECK range; only reconciliation with
      // actual outstanding allocations can identify the extra charged byte.
      await connection.query("UPDATE video_storage_state SET held_bytes = held_bytes + 1 WHERE id = 1");
      try {
        await assert.rejects(store.status(), code("VIDEO_DATABASE_STATE"));
        await assert.rejects(store.reserve({ ...actor(owner), asset: asset(1) }), code("VIDEO_DATABASE_STATE"));
        await assert.rejects(store.commit({ ...actor(owner), asset: committed(value) }), code("VIDEO_DATABASE_STATE"));
        await assert.rejects(release(store, owner, value), code("VIDEO_DATABASE_STATE"));
        const rows = await connection.query("SELECT state FROM video_assets"); assert.equal(rows.length, 1); assert.equal(rows[0].state, "reserved");
      } finally { await connection.query("UPDATE video_storage_state SET held_bytes = ? WHERE id = 1", [value.storedBytes]); }
      assert.equal((await store.status()).heldBytes, value.storedBytes);
    });

    await t.test("reserve, commit and release are exact retries, and committed objects cannot be released", async () => {
      const { store, capacity } = await fresh(), owner = (await pair()).client, value = asset(), request = { ...actor(owner), asset: value };
      const first = await store.reserve(request), retry = await store.reserve(request);
      assert.deepEqual(retry, first); assert.ok(first.reservation.ownerId.equals(owner.id));
      assert.equal((await catalog(capacity).status()).heldBytes, value.storedBytes);
      await assert.rejects(store.reserve({ ...request, asset: { ...value, bytes: value.bytes + 1, storedBytes: videoStoredBytes(value.bytes + 1) } }), code("VIDEO_INPUT", "VIDEO_NOT_FOUND"));
      const saved = committed(value), committedResult = await store.commit({ ...actor(owner), asset: saved });
      assert.deepEqual(await catalog(capacity).commit({ ...actor(owner), asset: saved }), committedResult);
      const read = await store.getOwned({ ...actor(owner), assetId: value.id });
      assert.ok(read.id.equals(value.id)); assert.ok(read.digest.equals(saved.digest)); assert.equal(read.deletedAt, null);
      await assert.rejects(catalog({ ...capacity, rootFingerprint: digest() }).getOwned({ ...actor(owner), assetId: value.id }), code("VIDEO_CAPACITY_UNAVAILABLE"));
      assert.equal((await store.status()).pendingBytes, 0); assert.equal((await store.status()).heldBytes, value.storedBytes);
      await assert.rejects(store.commit({ ...actor(owner), asset: { ...saved, digest: digest() } }), code("VIDEO_INPUT", "VIDEO_NOT_FOUND"));
      await assert.rejects(release(store, owner, value), code("VIDEO_INPUT", "VIDEO_NOT_FOUND"));
      assert.equal((await store.status()).heldBytes, value.storedBytes); assert.ok((await store.getOwned({ ...actor(owner), assetId: value.id })).digest.equals(saved.digest));
      const pending = asset(345); await store.reserve({ ...actor(owner), asset: pending });
      assert.deepEqual(await release(store, owner, pending), { released: true }); assert.deepEqual(await release(catalog(capacity), owner, pending), { released: true });
      assert.equal((await store.status()).heldBytes, value.storedBytes); assert.equal((await store.status()).pendingBytes, 0);
    });

    await t.test("current SQL owner, role, session, access and creator gates cannot be bypassed", async () => {
      const { store } = await fresh(), fixture = await pair(), stranger = await pair(fixture.admin), value = committed(asset());
      await store.reserve({ ...actor(fixture.client), asset: value }); await store.commit({ ...actor(fixture.client), asset: value });
      await assert.rejects(store.getOwned({ ...actor(stranger.client), assetId: value.id }), code("VIDEO_NOT_FOUND"));
      await assert.rejects(store.getOwned({ ...actor(fixture.admin), assetId: value.id }), code("VIDEO_NOT_FOUND"));
      await assert.rejects(store.getOwned({ ...actor(fixture.client, { role: "admin" }), assetId: value.id }), code("CHAT_FORBIDDEN", "CHAT_UNAUTHORIZED"));
      const anotherSession = await session(fixture.client);
      assert.ok((await store.getOwned({ ...actor(anotherSession), assetId: value.id })).id.equals(value.id), "live owner sessions may read an existing committed asset");
      await connection.query("UPDATE sessions SET revoked_at = ? WHERE id = ?", [sql(now), fixture.client.sessionId]);
      await assert.rejects(store.getOwned({ ...actor(fixture.client), assetId: value.id }), code("CHAT_UNAUTHORIZED"));
      await assert.rejects(store.reserve({ ...actor(fixture.client), asset: asset() }), code("CHAT_UNAUTHORIZED"));
      await connection.query("UPDATE users SET status = 'suspended' WHERE id = ?", [fixture.client.id]);
      await assert.rejects(store.getOwned({ ...actor(anotherSession), assetId: value.id }), code("CHAT_FORBIDDEN"));
      await connection.query("UPDATE users SET status = 'active', access_expires_at = ? WHERE id = ?", [sql(now), fixture.client.id]);
      await assert.rejects(store.getOwned({ ...actor(anotherSession), assetId: value.id }), code("CHAT_FORBIDDEN"));
      await connection.query("UPDATE users SET access_expires_at = NULL WHERE id = ?", [fixture.client.id]);
      await connection.query("UPDATE admin_mfa SET enabled_at = NULL, last_totp_step = -1 WHERE user_id = ?", [fixture.admin.id]);
      await assert.rejects(store.getOwned({ ...actor(anotherSession), assetId: value.id }), code("CHAT_FORBIDDEN"));
    });

    await t.test("cleanup after revocation is bound to the original reservation and never authorizes a read", async () => {
      const { store, capacity } = await fresh(), owner = (await pair()).client, other = (await pair()).client, value = asset(519);
      await store.reserve({ ...actor(owner), asset: value }); const differentSession = await session(owner);
      await connection.query("UPDATE sessions SET revoked_at = ? WHERE id = ?", [sql(now), owner.sessionId]);
      await connection.query("UPDATE users SET status = 'suspended' WHERE id = ?", [owner.id]);
      await assert.rejects(store.getOwned({ ...actor(owner), assetId: value.id }), code("CHAT_UNAUTHORIZED", "CHAT_FORBIDDEN"));
      await assert.rejects(store.commit({ ...actor(owner), asset: committed(value) }), code("CHAT_UNAUTHORIZED", "CHAT_FORBIDDEN"));
      for (const changes of [{ tokenHash: other.tokenHash }, { tokenHash: differentSession.tokenHash }, { storageKey: digest() }, { assetId: id() }, { role: "admin" }]) {
        await assert.rejects(release(store, owner, value, changes), code("VIDEO_NOT_FOUND"));
        assert.equal((await store.status()).heldBytes, value.storedBytes);
      }
      assert.deepEqual(await release(store, owner, value), { released: true }); assert.deepEqual(await release(catalog(capacity), owner, value), { released: true });
      assert.equal((await store.status()).heldBytes, 0); assert.equal((await store.status()).pendingBytes, 0);
      await assert.rejects(store.getOwned({ ...actor(differentSession), assetId: value.id }), code("CHAT_FORBIDDEN"));
    });

    await t.test("exact owner and global quotas serialize simultaneous reservations without oversubscription", async () => {
      const charge = videoStoredBytes(1000), one = (await pair()).client, two = (await pair()).client;
      const { store, capacity } = await fresh({ ownerBytes: charge, totalBytes: charge * 2 });
      const contenders = [asset(1000), asset(1000)];
      const ownerResults = await Promise.allSettled(contenders.map((value) => store.reserve({ ...actor(one), asset: value })));
      assert.equal(ownerResults.filter((r) => r.status === "fulfilled").length, 1);
      assert.equal(ownerResults.filter((r) => r.status === "rejected" && r.reason.code === "VIDEO_STORAGE_LIMIT").length, 1);
      assert.equal((await catalog(capacity).status()).heldBytes, charge);
      await store.reserve({ ...actor(two), asset: asset(1000) }); assert.equal((await store.status()).heldBytes, charge * 2);
      await assert.rejects(store.reserve({ ...actor((await pair()).client), asset: asset(1) }), code("VIDEO_STORAGE_LIMIT"));
      const global = await fresh({ ownerBytes: charge, totalBytes: charge });
      const results = await Promise.allSettled([global.store.reserve({ ...actor(one), asset: asset(1000) }), global.store.reserve({ ...actor(two), asset: asset(1000) })]);
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      assert.equal(results.filter((r) => r.status === "rejected" && r.reason.code === "VIDEO_STORAGE_LIMIT").length, 1);
      assert.equal((await catalog(global.capacity).status()).heldBytes, charge); assert.equal((await global.store.status()).pendingBytes, charge);
      assert.equal(Number((await connection.query("SELECT COUNT(*) AS count FROM video_assets WHERE state = 'reserved'"))[0].count), 1);
    });

    await t.test("lost acknowledgements after actual reserve and commit transactions survive store recreation", async () => {
      const { store, capacity } = await fresh(), owner = (await pair()).client, value = asset(789);
      const interruptedPool = lostAcknowledgementPool(), interrupted = catalog(capacity, interruptedPool); interruptedPool.arm();
      await assert.rejects(interrupted.reserve({ ...actor(owner), asset: value }), code("VIDEO_DATABASE_OPERATION", "CHAT_DATABASE_OPERATION"));
      assert.equal(interruptedPool.losses, 1); const reloaded = catalog(capacity);
      assert.equal((await reloaded.status()).heldBytes, value.storedBytes); assert.equal((await reloaded.status()).pendingBytes, value.storedBytes);
      assert.equal(Number((await connection.query("SELECT COUNT(*) AS count FROM video_assets WHERE id = ?", [value.id]))[0].count), 1);
      await reloaded.reserve({ ...actor(owner), asset: value }); assert.equal((await reloaded.status()).heldBytes, value.storedBytes);
      const saved = committed(value); interruptedPool.arm();
      await assert.rejects(interrupted.commit({ ...actor(owner), asset: saved }), code("VIDEO_DATABASE_OPERATION", "CHAT_DATABASE_OPERATION"));
      assert.equal(interruptedPool.losses, 2); const recreated = catalog(capacity);
      assert.ok((await recreated.getOwned({ ...actor(owner), assetId: value.id })).digest.equals(saved.digest));
      assert.equal((await recreated.status()).heldBytes, value.storedBytes); assert.equal((await recreated.status()).pendingBytes, 0);
      await recreated.commit({ ...actor(owner), asset: saved });
      await assert.rejects(release(recreated, owner, value), code("VIDEO_INPUT", "VIDEO_NOT_FOUND"));
      assert.equal((await store.status()).heldBytes, value.storedBytes);
      const pending = asset(321); await recreated.reserve({ ...actor(owner), asset: pending }); interruptedPool.arm();
      await assert.rejects(release(interrupted, owner, pending), code("VIDEO_DATABASE_OPERATION", "CHAT_DATABASE_OPERATION"));
      assert.equal(interruptedPool.losses, 3);
      assert.equal((await catalog(capacity).status()).heldBytes, value.storedBytes); assert.equal((await catalog(capacity).status()).pendingBytes, 0);
      assert.deepEqual(await release(catalog(capacity), owner, pending), { released: true });
      assert.equal((await store.status()).heldBytes, value.storedBytes);
    });

    await t.test("real SQL service and encrypted storage preserve a committed video after a lost acknowledgement", async () => {
      const { capacity } = await fresh(), fixture = await pair(), stranger = await pair(fixture.admin);
      const audit = fileURLToPath(new URL("../../audit/", import.meta.url)); await mkdir(audit, { recursive: true, mode: 0o700 });
      const root = await mkdtemp(path.join(audit, "video-native-")); t.after(() => rm(root, { recursive: true, force: true }));
      const key = digest(), storage = await createVideoStorage({ root, key }), interruptedPool = lostAcknowledgementPool();
      const chatStore = createChatStore(pool, { clock }), authStore = createAuthStore(pool, { clock });
      const chatService = { async actor(role, raw) {
        return chatStore.withActor({ role, tokenHash: tokenDigest(raw), now }, async (tx, context) => {
          const row = (await tx.query("SELECT expires_at FROM sessions WHERE token_hash = ?", [tokenDigest(raw)]))[0];
          return { user: { id: hex(context.actor.id), role: context.actor.role, pseudonym: context.actor.pseudonym },
            csrf: newToken(), expiresAt: Date.parse(`${row.expires_at.replace(" ", "T")}Z`) };
        });
      } };
      const service = await createVideoService({ store: catalog(capacity, interruptedPool), storage, chatService, authStore, key, minimumFreeBytes: 0, clock });
      const bytes = VIDEO_BLOCK_BYTES * 2 + 57;
      interruptedPool.arm(); await assert.rejects(service.admitUpload("client", fixture.client.token, { bytes, mime: "video/mp4" }), (error) => error.code === "VIDEO_UNAVAILABLE");
      assert.deepEqual(await readdir(root), []); assert.equal((await catalog(capacity).status()).heldBytes, videoStoredBytes(bytes));
      const pending = (await connection.query("SELECT id, storage_key FROM video_assets WHERE state = 'reserved'"))[0];
      await release(catalog(capacity), fixture.client, { id: pending.id, storageKey: pending.storage_key });
      const ticket = await service.admitUpload("client", fixture.client.token, { bytes, mime: "video/mp4" }); interruptedPool.arm();
      await assert.rejects(service.upload("client", fixture.client.token, ticket, mp4Source(bytes)), (error) => error.code === "VIDEO_UNAVAILABLE");
      const row = (await connection.query("SELECT id, storage_key, content_digest, state FROM video_assets WHERE state = 'committed'"))[0];
      assert.equal(row.state, "committed"); assert.equal((await catalog(capacity).status()).heldBytes, videoStoredBytes(bytes));
      assert.equal((await catalog(capacity).status()).pendingBytes, 0); assert.equal((await readdir(root)).length, 1);
      const ciphertext = await readFile(path.join(root, `${hex(row.storage_key)}.video.enc`));
      assert.equal(ciphertext.length, videoStoredBytes(bytes));
      assert.ok(!ciphertext.includes(Buffer.alloc(256, 0x5a)), "only encrypted bytes are published");
      const expectedDigest = createHash("sha256"); for await (const chunk of mp4Source(bytes)) expectedDigest.update(chunk);
      assert.deepEqual(row.content_digest, expectedDigest.digest(), "native metadata binds the actual streamed plaintext digest");
      const restarted = await createVideoService({ store: catalog(capacity), storage: await createVideoStorage({ root, key }), chatService, authStore, key, minimumFreeBytes: 0, clock });
      const handle = await restarted.open("client", fixture.client.token, hex(row.id));
      assert.deepEqual(await collectVideo(handle.stream({ start: VIDEO_BLOCK_BYTES - 3, end: VIDEO_BLOCK_BYTES + 12 })), Buffer.alloc(16, 0x5a)); await handle.close();
      await assert.rejects(restarted.open("client", stranger.client.token, hex(row.id)), (error) => error.code === "VIDEO_NOT_FOUND");
      await assert.rejects(release(catalog(capacity), fixture.client, { id: row.id, storageKey: row.storage_key }), code("VIDEO_INPUT", "VIDEO_NOT_FOUND"));
      assert.equal((await readdir(root)).length, 1); assert.equal(interruptedPool.losses, 2);
    });
  } finally {
    await pool?.end(); try { await reset(); } finally { await connection.end(); }
  }
});
