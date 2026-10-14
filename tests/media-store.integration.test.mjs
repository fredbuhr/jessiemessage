import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { databaseOptions, connectDatabase } from "../server/db/connection.mjs";
import { applyMigrations, loadMigrations } from "../server/db/migrations.mjs";
import { createRuntimePool } from "../server/db/runtime.mjs";
import { createChatStore, ChatStoreError } from "../server/chat/store.mjs";
import { createMediaStore, MediaStoreError } from "../server/media/store.mjs";

const enabled = process.env.JESSIEMESSAGE_DB_TEST === "1";
const id = () => randomBytes(16), digest = () => randomBytes(32);
const now = Date.UTC(2026, 9, 15, 12);
const sqlDate = (value) => new Date(value).toISOString().replace("T", " ").replace("Z", "000");
const code = (expected) => (error) => error instanceof ChatStoreError && error.code === expected && error.cause === undefined;

test("real MariaDB private media ownership and delivery (synthetic disposable database only)", {
  skip: enabled ? false : "Set JESSIEMESSAGE_DB_TEST=1 with an explicit loopback test database.", timeout: 180000,
}, async (t) => {
  const options = databaseOptions();
  assert.ok(["127.0.0.1", "::1", "localhost"].includes(options.host), "integration tests require loopback");
  assert.match(options.database, /^jessiemessage_test(?:_[a-z0-9]+)*$/, "integration tests require a dedicated disposable schema");
  assert.ok(process.env.JESSIEMESSAGE_RUNTIME_DB_USER && process.env.JESSIEMESSAGE_RUNTIME_DB_PASSWORD,
    "integration tests require separately provisioned runtime DML credentials");
  const migrations = await loadMigrations();
  const ownedTables = migrations.map((migration) => {
    const match = /^CREATE\s+TABLE\s+([a-z][a-z0-9_]*)\s*\(/i.exec(migration.sql.trim());
    assert.ok(match, "cleanup only accepts reviewed single-table migrations"); return match[1];
  }).reverse();
  const allowedTables = [...ownedTables, "migration_probe", "schema_migrations"];
  const connection = await connectDatabase(); let pool, fixtureNumber = 0;
  async function reset() {
    const tables = await connection.query("SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?", [options.database]);
    assert.ok(tables.every((table) => allowedTables.includes(table.name)), "refuse cleanup when unrelated tables are present");
    for (const table of allowedTables) await connection.query(`DROP TABLE IF EXISTS ${table}`);
  }
  try {
    await reset(); await applyMigrations(connection, { database: options.database, migrations });
    pool = await createRuntimePool(process.env);
    const chat = createChatStore(pool), media = createMediaStore({ pool, chatStore: chat });
    async function user(role) {
      const result = { id: id(), sessionId: id(), tokenHash: digest(), role, pseudonym: `Synthetic ${role} ${fixtureNumber++}` };
      await connection.query(`INSERT INTO users (id, role, status, pseudonym, email, password_hash, email_verified_at,
        age_assured_at, access_approved_at, created_at, updated_at) VALUES (?, ?, 'active', ?, ?, 'synthetic-not-a-password', ?, ?, ?, ?, ?)`,
      [result.id, role, result.pseudonym, `media-${fixtureNumber}@example.invalid`, role === "client" ? sqlDate(now) : null,
        role === "client" ? sqlDate(now) : null, role === "client" ? sqlDate(now) : null, sqlDate(now), sqlDate(now)]);
      if (role === "admin") await connection.query("INSERT INTO admin_mfa (user_id, secret_encrypted, version, last_totp_step, enabled_at) VALUES (?, 'synthetic-encrypted-secret', 1, 1, ?)", [result.id, sqlDate(now)]);
      else await connection.query("INSERT INTO client_auth_state (user_id, credential_version, age_declared_at) VALUES (?, 1, ?)", [result.id, sqlDate(now)]);
      await connection.query("INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)", [result.sessionId, result.id, result.tokenHash, sqlDate(now), sqlDate(now + 8 * 3600000)]);
      if (role === "admin") await connection.query("INSERT INTO auth_session_state (session_id, last_seen_at, mfa_verified_at, mfa_version) VALUES (?, ?, ?, 1)", [result.sessionId, sqlDate(now), sqlDate(now)]);
      else await connection.query("INSERT INTO client_session_state (session_id, last_seen_at, credential_version) VALUES (?, ?, 1)", [result.sessionId, sqlDate(now)]);
      return result;
    }
    async function pair(admin = null) {
      const fixture = { admin: admin ?? await user("admin"), client: await user("client"), conversationId: id() };
      await connection.query("INSERT INTO conversations (id, client_id, admin_id, created_at) VALUES (?, ?, ?, ?)", [fixture.conversationId, fixture.client.id, fixture.admin.id, sqlDate(now)]);
      return fixture;
    }
    const actor = (fixture, role = "client", extra = {}) => ({ role, tokenHash: fixture[role].tokenHash, now, ...extra });
    const request = (fixture, role = "client", extra = {}) => ({ ...actor(fixture, role), conversationId: fixture.conversationId, ...extra });
    const asset = (extra = {}) => ({ id: id(), storageKey: digest(), digest: digest(), width: 1200, height: 800,
      thumbnailWidth: 480, thumbnailHeight: 320, fullBytes: 42000, thumbnailBytes: 7000, ...extra });
    const register = (fixture, role = "client", value = asset(), extra = {}) => media.registerAsset({ ...actor(fixture, role, extra), asset: value });
    const payload = (extra = {}) => ({ id: id(), clientMessageId: id(), bodyEncrypted: `v1.synthetic-${digest().toString("base64url")}`, bodyFingerprint: digest(), ...extra });
    const send = (fixture, role, mediaId, value = payload(), extra = {}) => chat.sendMessage({ ...request(fixture, role, extra), message: { ...value, mediaId } });
    const delivered = (fixture, role, messageId, extra = {}) => media.getMessageAsset({ ...request(fixture, role, extra), messageId });
    const remove = (fixture, role, assetId, extra = {}) => media.deleteAsset({ ...actor(fixture, role, extra), assetId });
    const counts = async (fixture) => ({
      messages: Number((await connection.query("SELECT COUNT(*) AS value FROM messages WHERE conversation_id = ?", [fixture.conversationId]))[0].value),
      links: Number((await connection.query("SELECT COUNT(*) AS value FROM message_media WHERE conversation_id = ?", [fixture.conversationId]))[0].value),
      events: Number((await connection.query("SELECT COUNT(*) AS value FROM chat_events WHERE conversation_id = ?", [fixture.conversationId]))[0].value),
    });

    await t.test("read-only schema checks reject dirty history, dimension type drift, lost ownership uniqueness and weaker CHECKs", async () => {
      assert.equal(await media.assertSchema(), true);
      await connection.query("UPDATE schema_migrations SET state = 'failed', finished_at = NULL WHERE version = 17");
      try { await assert.rejects(media.assertSchema(), code("CHAT_DATABASE_STATE")); }
      finally { await connection.query("UPDATE schema_migrations SET state = 'applied', finished_at = CURRENT_TIMESTAMP(6) WHERE version = 17"); }
      await connection.query("ALTER TABLE media_assets MODIFY width SMALLINT NOT NULL");
      try { await assert.rejects(media.assertSchema(), code("MEDIA_DATABASE_STATE")); }
      finally { await connection.query("ALTER TABLE media_assets MODIFY width SMALLINT UNSIGNED NOT NULL"); }
      await connection.query("ALTER TABLE media_assets DROP INDEX media_assets_owner_digest");
      try { await assert.rejects(media.assertSchema(), code("MEDIA_DATABASE_STATE")); }
      finally { await connection.query("ALTER TABLE media_assets ADD UNIQUE KEY media_assets_owner_digest (owner_id, active_digest)"); }
      await connection.query("ALTER TABLE media_assets DROP CONSTRAINT media_assets_active_state");
      await connection.query("ALTER TABLE media_assets ADD CONSTRAINT media_assets_active_state CHECK (1)");
      try { await assert.rejects(media.assertSchema(), code("MEDIA_DATABASE_STATE")); }
      finally {
        await connection.query("ALTER TABLE media_assets DROP CONSTRAINT media_assets_active_state");
        await connection.query(`ALTER TABLE media_assets ADD CONSTRAINT media_assets_active_state CHECK (
          (deleted_at IS NULL AND active_digest IS NOT NULL AND active_digest = content_digest) OR
          (deleted_at IS NOT NULL AND active_digest IS NULL AND deleted_at >= created_at))`);
      }
      await connection.query("ALTER TABLE message_media DROP FOREIGN KEY message_media_asset_fk");
      try { await assert.rejects(media.assertSchema(), code("MEDIA_DATABASE_STATE")); }
      finally { await connection.query("ALTER TABLE message_media ADD CONSTRAINT message_media_asset_fk FOREIGN KEY (media_id) REFERENCES media_assets (id) ON UPDATE RESTRICT ON DELETE RESTRICT"); }
      assert.equal(await media.assertSchema(), true);
    });

    await t.test("trusted actor callbacks recheck current SQL session, role, client gates and creator MFA and roll back failures", async () => {
      const fixture = await pair();
      assert.ok((await chat.withActor(actor(fixture), async (_connection, context) => context.actor.id)).equals(fixture.client.id));
      await assert.rejects(chat.withActor(actor(fixture, "client", { tokenHash: fixture.admin.tokenHash }), async () => true), code("CHAT_FORBIDDEN"));
      await assert.rejects(chat.withActor(actor(fixture, "client", { tokenHash: digest() }), async () => true), code("CHAT_UNAUTHORIZED"));
      await assert.rejects(chat.withConversation(request(fixture), async (tx) => {
        await tx.query("UPDATE users SET pseudonym = 'Must roll back' WHERE id = ?", [fixture.client.id]);
        throw new MediaStoreError("MEDIA_INPUT");
      }), code("MEDIA_INPUT"));
      assert.equal((await connection.query("SELECT pseudonym FROM users WHERE id = ?", [fixture.client.id]))[0].pseudonym, fixture.client.pseudonym);
      await connection.query("UPDATE users SET status = 'suspended' WHERE id = ?", [fixture.client.id]);
      await assert.rejects(media.listAssets(actor(fixture)), code("CHAT_FORBIDDEN"));
      await connection.query("UPDATE users SET status = 'active' WHERE id = ?", [fixture.client.id]);
      await connection.query("UPDATE admin_mfa SET enabled_at = NULL, last_totp_step = -1 WHERE user_id = ?", [fixture.admin.id]);
      await assert.rejects(register(fixture), code("CHAT_FORBIDDEN"));
    });

    await t.test("deduplication is private to the current owner and concurrent retries create one active asset", async () => {
      const fixture = await pair(), other = await pair(fixture.admin), value = asset();
      const results = await Promise.all([register(fixture, "client", value), register(fixture, "client", { ...value, id: id(), storageKey: digest() })]);
      assert.equal(results.filter((item) => item.duplicate).length, 1); assert.ok(results[0].asset.id.equals(results[1].asset.id));
      const separate = await register(other, "client", { ...value, id: id(), storageKey: digest() });
      assert.equal(separate.duplicate, false); assert.ok(!separate.asset.id.equals(results[0].asset.id));
      assert.equal((await media.listAssets(actor(fixture))).assets.length, 1);
      assert.equal((await media.listAssets(actor(other))).assets.length, 1);
      await assert.rejects(media.getOwnedAsset({ ...actor(other), assetId: results[0].asset.id }), code("MEDIA_NOT_FOUND"));
      await assert.rejects(remove(other, "client", results[0].asset.id), code("MEDIA_NOT_FOUND"));
      assert.ok(results[0].asset.ownerId.equals(fixture.client.id));
    });

    await t.test("metadata bounds and active/deleted state are enforced by both input validation and database checks", async () => {
      const fixture = await pair();
      for (const change of [{ width: 2049 }, { fullBytes: 10485761 }, { thumbnailBytes: 524289 }, { thumbnailWidth: 481 }, { width: 100 }]) {
        await assert.rejects(register(fixture, "client", asset(change)), code("MEDIA_INPUT"));
      }
      const saved = (await register(fixture)).asset;
      await assert.rejects(connection.query("UPDATE media_assets SET active_digest = NULL WHERE id = ?", [saved.id]));
      await assert.rejects(connection.query("UPDATE media_assets SET content_digest = ? WHERE id = ?", [digest(), saved.id]));
      await assert.rejects(connection.query("UPDATE media_assets SET mime = 'image/png' WHERE id = ?", [saved.id]));
      await assert.rejects(connection.query("UPDATE media_assets SET thumbnail_width = 481 WHERE id = ?", [saved.id]));
      assert.ok((await media.getOwnedAsset({ ...actor(fixture), assetId: saved.id })).id.equals(saved.id));
    });

    await t.test("a delivered image is available to the assigned parties while ownership URLs and reusable IDs stay private", async () => {
      const a = await pair(), b = await pair(a.admin), stranger = await pair();
      const image = (await register(a, "admin")).asset, sent = await send(a, "admin", image.id);
      assert.ok((await delivered(a, "client", sent.message.id)).id.equals(image.id));
      assert.ok((await delivered(a, "admin", sent.message.id)).id.equals(image.id));
      await assert.rejects(media.getOwnedAsset({ ...actor(a), assetId: image.id }), code("MEDIA_NOT_FOUND"));
      await assert.rejects(send(a, "client", image.id), code("CHAT_NOT_FOUND"));
      await assert.rejects(delivered(b, "client", sent.message.id, { conversationId: a.conversationId }), code("CHAT_NOT_FOUND"));
      await assert.rejects(delivered(stranger, "admin", sent.message.id, { conversationId: a.conversationId }), code("CHAT_NOT_FOUND"));
      await assert.rejects(delivered(b, "admin", sent.message.id), code("MEDIA_NOT_FOUND"));
      await assert.rejects(media.gallery({ ...request(b), conversationId: a.conversationId }), code("CHAT_NOT_FOUND"));
      const message = (await chat.readMessages(request(a))).messages[0];
      assert.deepEqual(message.media, { id: image.id, width: 1200, height: 800, thumbnailWidth: 480, thumbnailHeight: 320, fullBytes: 42000, thumbnailBytes: 7000 });
      for (const key of ["storageKey", "digest", "ownerId", "email"]) assert.equal(Object.hasOwn(message.media, key), false);
      assert.equal((await media.gallery(request(a))).items[0].sequence, sent.message.sequence);
    });

    await t.test("photo/text idempotency compares immutable attachment identity and allocates one atomic link and event", async () => {
      const fixture = await pair(), first = (await register(fixture)).asset, second = (await register(fixture)).asset, value = payload();
      const results = await Promise.all([send(fixture, "client", first.id, value), send(fixture, "client", first.id, { ...value, id: id() })]);
      assert.equal(results.filter((item) => item.duplicate).length, 1); assert.ok(results[0].message.id.equals(results[1].message.id));
      assert.deepEqual(await counts(fixture), { messages: 1, links: 1, events: 1 });
      await assert.rejects(send(fixture, "client", second.id, { ...value, id: id() }), code("CHAT_CONFLICT"));
      await assert.rejects(send(fixture, "client", null, { ...value, id: id() }), code("CHAT_CONFLICT"));
      await assert.rejects(send(fixture, "client", first.id, { ...value, id: id(), bodyFingerprint: digest() }), code("CHAT_CONFLICT"));
      const text = payload(); await send(fixture, "client", null, text);
      await assert.rejects(send(fixture, "client", first.id, { ...text, id: id() }), code("CHAT_CONFLICT"));
      assert.deepEqual(await counts(fixture), { messages: 2, links: 1, events: 2 });
    });

    await t.test("message/link/event creation rolls back completely when either the attachment or the event insert fails", async () => {
      const fixture = await pair(), image = (await register(fixture)).asset;
      for (const table of ["message_media", "chat_events"]) {
        await connection.query(`CREATE TRIGGER synthetic_fail_media BEFORE INSERT ON ${table} FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'synthetic media failure'`);
        try { await assert.rejects(send(fixture, "client", image.id), code("CHAT_DATABASE_OPERATION")); }
        finally { await connection.query("DROP TRIGGER synthetic_fail_media"); }
        assert.deepEqual(await counts(fixture), { messages: 0, links: 0, events: 0 });
      }
      assert.equal((await send(fixture, "client", image.id)).message.sequence, "1");
    });

    await t.test("composite foreign keys reject a cross-conversation attachment pointer", async () => {
      const fixture = await pair(), other = await pair(fixture.admin), image = (await register(fixture)).asset;
      const text = await send(fixture, "client", null);
      await assert.rejects(connection.query("INSERT INTO message_media (message_id, conversation_id, media_id, created_at) VALUES (?, ?, ?, ?)", [text.message.id, other.conversationId, image.id, sqlDate(now)]));
      assert.deepEqual(await counts(fixture), { messages: 1, links: 0, events: 1 });
    });

    await t.test("sharedHere reflects only live deliveries in the explicitly authorized conversation", async () => {
      const a = await pair(), b = await pair(a.admin), image = (await register(a, "admin")).asset;
      assert.equal((await media.listAssets({ ...actor(a, "admin"), conversationId: a.conversationId })).assets[0].sharedHere, false);
      const sent = await send(a, "admin", image.id);
      assert.equal((await media.listAssets({ ...actor(a, "admin"), conversationId: a.conversationId })).assets[0].sharedHere, true);
      assert.equal((await media.listAssets({ ...actor(b, "admin"), conversationId: b.conversationId })).assets[0].sharedHere, false);
      assert.equal((await media.listAssets(actor(a, "admin"))).assets[0].sharedHere, false);
      await chat.deleteMessage({ ...request(a, "admin"), messageId: sent.message.id });
      assert.equal((await media.listAssets({ ...actor(a, "admin"), conversationId: a.conversationId })).assets[0].sharedHere, false);
    });

    await t.test("deleting a photo message revokes its URL and event payload without removing another delivery", async () => {
      const a = await pair(), b = await pair(a.admin), image = (await register(a, "admin")).asset;
      const value = payload(), first = await send(a, "admin", image.id, value), second = await send(b, "admin", image.id);
      await assert.rejects(remove(a, "admin", image.id), code("MEDIA_IN_USE"));
      await assert.rejects(chat.deleteMessage({ ...request(a), messageId: first.message.id }), code("CHAT_NOT_FOUND"));
      const tombstone = await chat.deleteMessage({ ...request(a, "admin"), messageId: first.message.id });
      assert.equal(tombstone.bodyEncrypted, null); assert.equal(tombstone.media, null);
      await assert.rejects(delivered(a, "client", first.message.id), code("MEDIA_NOT_FOUND"));
      assert.ok((await delivered(b, "client", second.message.id)).id.equals(image.id));
      assert.equal((await media.gallery(request(a))).items.length, 0); assert.equal((await media.gallery(request(b))).items.length, 1);
      assert.ok((await chat.readEvents(request(a))).events.every((event) => event.message.media === null && event.message.bodyEncrypted === null));
      const retry = await send(a, "admin", image.id, { ...value, id: id() });
      assert.equal(retry.duplicate, true); assert.equal(retry.message.media, null);
      await assert.rejects(remove(a, "admin", image.id), code("MEDIA_IN_USE"));
      await chat.deleteMessage({ ...request(b, "admin"), messageId: second.message.id });
      const removed = await remove(a, "admin", image.id); assert.equal(removed.deletedAt, now);
      assert.equal((await remove(a, "admin", image.id)).deletedAt, now, "owner may repeat file cleanup after a committed soft delete");
      await assert.rejects(media.getOwnedAsset({ ...actor(a, "admin"), assetId: image.id }), code("MEDIA_NOT_FOUND"));
      assert.equal((await media.listAssets(actor(a, "admin"))).assets.length, 0);
      const deletedRetry = await send(a, "admin", image.id, { ...value, id: id() });
      assert.equal(deletedRetry.duplicate, true); assert.equal(deletedRetry.message.media, null);
      assert.equal(Number((await connection.query("SELECT COUNT(*) AS value FROM message_media WHERE media_id = ?", [image.id]))[0].value), 2, "historical linkage survives tombstones");
    });

    await t.test("removal releases owner deduplication without making a deleted asset reusable", async () => {
      const fixture = await pair(), value = asset(), original = (await register(fixture, "client", value)).asset;
      await remove(fixture, "client", original.id);
      const recreated = await register(fixture, "client", { ...value, id: id(), storageKey: digest() });
      assert.equal(recreated.duplicate, false); assert.ok(!recreated.asset.id.equals(original.id));
      await assert.rejects(send(fixture, "client", original.id), code("CHAT_NOT_FOUND"));
      assert.ok((await send(fixture, "client", recreated.asset.id)).message.media.id.equals(recreated.asset.id));
    });

    await t.test("concurrent removal and delivery serialize on the current owner and cannot leave a live dangling delivery", async () => {
      const fixture = await pair(), image = (await register(fixture)).asset;
      const results = await Promise.allSettled([remove(fixture, "client", image.id), send(fixture, "client", image.id)]);
      const row = (await connection.query("SELECT deleted_at FROM media_assets WHERE id = ?", [image.id]))[0];
      if (row.deleted_at !== null) {
        assert.equal(results[0].status, "fulfilled"); assert.equal(results[1].status, "rejected"); assert.equal(results[1].reason.code, "CHAT_NOT_FOUND");
        assert.deepEqual(await counts(fixture), { messages: 0, links: 0, events: 0 });
      } else {
        assert.equal(results[0].status, "rejected"); assert.equal(results[0].reason.code, "MEDIA_IN_USE"); assert.equal(results[1].status, "fulfilled");
        assert.deepEqual(await counts(fixture), { messages: 1, links: 1, events: 1 });
      }
    });

    await t.test("library keyset pages and descending gallery cursors stay bounded and retain decimal sequences", async () => {
      const fixture = await pair(), imageIds = [];
      for (let index = 0; index < 4; index++) { const image = (await register(fixture)).asset; imageIds.push(image.id.toString("hex")); await send(fixture, "client", image.id); }
      const first = await media.listAssets({ ...actor(fixture), limit: 2 }); assert.equal(first.hasMore, true);
      const second = await media.listAssets({ ...actor(fixture), afterId: first.nextCursor, limit: 2 }); assert.equal(second.hasMore, false); assert.equal(second.nextCursor, null);
      assert.deepEqual([...first.assets, ...second.assets].map((item) => item.id.toString("hex")), imageIds.sort());
      const gallery = await media.gallery({ ...request(fixture), limit: 2 }); assert.deepEqual(gallery.items.map((item) => item.sequence), ["4", "3"]); assert.equal(gallery.nextBefore, "3");
      const older = await media.gallery({ ...request(fixture), before: gallery.nextBefore, limit: 2 }); assert.deepEqual(older.items.map((item) => item.sequence), ["2", "1"]); assert.equal(older.nextBefore, null);
      for (const before of ["01", "-1", "18446744073709551616", 1, "1\n"]) await assert.rejects(media.gallery({ ...request(fixture), before }), code("MEDIA_INPUT"));
      for (const limit of [0, 101, 1.5]) await assert.rejects(media.listAssets({ ...actor(fixture), limit }), code("MEDIA_INPUT"));
    });

    await t.test("gallery pagination preserves full unsigned BIGINT values beyond JavaScript number precision", async () => {
      const fixture = await pair(), image = (await register(fixture)).asset, first = await send(fixture, "client", image.id);
      await connection.query("UPDATE messages SET sequence_no = 9007199254740993 WHERE id = ?", [first.message.id]);
      const second = await send(fixture, "client", image.id);
      assert.equal(second.message.sequence, "9007199254740994");
      const latest = await media.gallery({ ...request(fixture), limit: 1 });
      assert.equal(latest.items[0].sequence, "9007199254740994"); assert.equal(latest.nextBefore, "9007199254740994");
      const older = await media.gallery({ ...request(fixture), before: latest.nextBefore, limit: 1 });
      assert.equal(older.items[0].sequence, "9007199254740993"); assert.equal(older.hasMore, false);
    });

    await t.test("expiry/revocation revoke every client media operation while the assigned administrator retains history only", async () => {
      const fixture = await pair(), image = (await register(fixture)).asset, sent = await send(fixture, "client", image.id);
      await connection.query("UPDATE users SET access_expires_at = ? WHERE id = ?", [sqlDate(now + 1000), fixture.client.id]);
      const later = now + 1000;
      for (const operation of [
        () => media.getOwnedAsset({ ...actor(fixture, "client", { now: later }), assetId: image.id }),
        () => media.listAssets(actor(fixture, "client", { now: later })),
        () => register(fixture, "client", asset(), { now: later }),
        () => remove(fixture, "client", image.id, { now: later }),
        () => delivered(fixture, "client", sent.message.id, { now: later }),
        () => media.gallery(request(fixture, "client", { now: later })),
      ]) await assert.rejects(operation(), code("CHAT_FORBIDDEN"));
      assert.ok((await delivered(fixture, "admin", sent.message.id, { now: later })).id.equals(image.id));
      assert.equal((await media.gallery(request(fixture, "admin", { now: later }))).items.length, 1);
      const adminImage = (await register(fixture, "admin", asset(), { now: later })).asset;
      await assert.rejects(send(fixture, "admin", adminImage.id, payload(), { now: later }), code("CHAT_FORBIDDEN"));
      await connection.query("UPDATE sessions SET revoked_at = ? WHERE id = ?", [sqlDate(later), fixture.client.sessionId]);
      await assert.rejects(delivered(fixture, "client", sent.message.id, { now: later }), code("CHAT_UNAUTHORIZED"));
      await connection.query("UPDATE users SET access_expires_at = NULL WHERE id = ?", [fixture.client.id]);
      await connection.query("UPDATE sessions SET revoked_at = NULL WHERE id = ?", [fixture.client.sessionId]);
      await connection.query("UPDATE conversations SET closed_at = ? WHERE id = ?", [sqlDate(now), fixture.conversationId]);
      assert.ok((await delivered(fixture, "client", sent.message.id)).id.equals(image.id), "closed conversations retain authorized history");
      await assert.rejects(send(fixture, "client", image.id), code("CHAT_FORBIDDEN"));
    });
  } finally {
    if (pool) await pool.end();
    await reset(); await connection.end();
  }
});
