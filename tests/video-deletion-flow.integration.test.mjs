// Candidate lifecycle only: disposable SQL, encrypted files and journals.
// No normal runtime, production route, hosted migration or real account is used.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { databaseOptions, connectDatabase } from "../server/db/connection.mjs";
import { applyMigrations, createdMigrationTables, loadMigrations, MigrationError } from "../server/db/migrations.mjs";
import { createRuntimePool } from "../server/db/runtime.mjs";
import { newToken, tokenDigest } from "../server/auth/crypto.mjs";
import { createAuthStore } from "../server/auth/store.mjs";
import { createAuthService } from "../server/auth/service.mjs";
import { createAccessStore } from "../server/access/store.mjs";
import { createAccessService } from "../server/access/service.mjs";
import { createChatStore } from "../server/chat/store.mjs";
import { createChatService } from "../server/chat/service.mjs";
import { createMediaStorage } from "../server/media/storage.mjs";
import { createMediaCapacityStore } from "../server/media/capacity-store.mjs";
import { createVideoStorage, VIDEO_BLOCK_BYTES, videoStoredBytes } from "../server/video/storage.mjs";
import { createVideoStore } from "../server/video/store.mjs";
import { createVideoMessageStore } from "../server/video/message-store.mjs";
import { createVideoService } from "../server/video/service.mjs";
import { loadVideoMigrations } from "../server/video/migrations.mjs";
import { createVideoErasureExtension } from "../server/video/erasure-store.mjs";
import { composeVideoErasureStorage } from "../server/video/erasure-storage.mjs";
import { createErasureStore } from "../server/data/erasure-store.mjs";
import { AccountErasureError } from "../server/data/erasure-state.mjs";
import { createAccountErasure } from "../server/data/erasure.mjs";
import { assertErasureSchema } from "../server/data/erasure-schema.mjs";
import { createErasureJournal, readErasureJournalBatch } from "../server/data/erasure-journal.mjs";
import { consumeSyntheticInvitation } from "./fixtures/manual-admission.mjs";
import { erasureDirectory } from "./fixtures/erasure-files.mjs";
import { managedClosureFixture } from "./fixtures/managed-closure-runtime.mjs";
import { collectVideo, mp4Source } from "./helpers/video-transport-fixture.mjs";

const enabled = process.env.JESSIEMESSAGE_DB_TEST === "1";
const id = () => randomBytes(16), secret = () => randomBytes(32), hex = value => value.toString("hex");
const sql = value => new Date(value).toISOString().replace("T", " ").replace("Z", "000");
const code = (...values) => error => values.includes(error.code) && error.cause === undefined;
const serialize = value => JSON.stringify(value, (_key, entry) => typeof entry === "bigint" ? entry.toString() : entry);

test("candidate video deletion and account closure remain durable and preserve other clients", {
  skip: enabled ? false : "Set JESSIEMESSAGE_DB_TEST=1 with an explicit loopback disposable database.", timeout: 180000,
}, async t => {
  const options = databaseOptions();
  assert.ok(["127.0.0.1", "::1", "localhost"].includes(options.host), "require loopback");
  assert.match(options.database, /^jessiemessage_test(?:_[a-z0-9]+)*$/, "require a disposable schema");
  assert.ok(process.env.JESSIEMESSAGE_RUNTIME_DB_USER && process.env.JESSIEMESSAGE_RUNTIME_DB_PASSWORD);
  assert.notEqual(process.env.JESSIEMESSAGE_RUNTIME_DB_USER, options.user, "require the separately provisioned DML runtime");
  const ordinary = await loadMigrations(), candidates = await loadVideoMigrations();
  assert.equal(ordinary.length, 33); assert.equal(candidates.length, 36); assert.deepEqual(candidates.slice(0, 33), ordinary);
  const allowed = [...createdMigrationTables(candidates).reverse(), "migration_probe", "schema_migrations"];
  const connection = await connectDatabase(); let pool;
  const now = Date.UTC(2026, 9, 22, 1), clock = () => now, created = sql(now - 1000);
  const directory = await erasureDirectory(t), photoRoot = path.join(directory, "photos"), videoRoot = path.join(directory, "videos"), journalRoot = path.join(directory, "journals"), managerRoot = path.join(directory, "manager");
  for (const root of [photoRoot, videoRoot, journalRoot, managerRoot]) await mkdir(root, { mode: 0o700 });
  const videoKey = secret(), journalKey = secret(), messageKey = secret(), broadcastKey = secret(), totpKey = secret();
  const photos = await createMediaStorage({ root: photoRoot, key: secret(), pathMode: "linux-dirfd" });
  const videos = await createVideoStorage({ root: videoRoot, key: videoKey, pathMode: "linux-dirfd" });
  const photoCapacity = { ownerBytes: 16 * 1024 * 1024, totalBytes: 64 * 1024 * 1024, rootFingerprint: await photos.fingerprint() };
  const videoCapacity = { ownerBytes: 16 * 1024 * 1024, totalBytes: 64 * 1024 * 1024, rootFingerprint: await videos.fingerprint() };
  async function reset() {
    const tables = await connection.query("SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?", [options.database]);
    assert.ok(tables.every(row => allowed.includes(row.name)), "refuse unrelated schema cleanup");
    for (const table of allowed) await connection.query("DROP TABLE IF EXISTS " + table);
  }
  try {
    await reset(); await applyMigrations(connection, { database: options.database, migrations: ordinary });
    pool = await createRuntimePool(process.env);
    const authStore = createAuthStore(pool, { clock }), accessStore = createAccessStore(pool, { clock });
    assert.equal(await createChatStore(pool, { clock }).assertSchema(), true);
    const authService = await createAuthService({ store: authStore, totpKey, clock });
    const accessService = await createAccessService({ store: accessStore, authStore, authService, totpKey, mailKey: secret(), origin: "https://example.invalid", clock });
    const photoCatalog = createMediaCapacityStore({ pool, capacity: photoCapacity });
    await photoCatalog.initialize({ now, offline: true });
    await applyMigrations(connection, { database: options.database, migrations: candidates });
    assert.equal((await loadMigrations()).length, 33, "candidate plan is never promoted by this fixture");
    async function stack(selectedPool = pool, selectedStorage = videos) {
      let messages;
      const chat = createChatStore(selectedPool, { clock, decorateMessages: (...args) => messages.decorateMessages(...args) });
      const catalog = createVideoStore({ pool: selectedPool, chatStore: chat, capacity: videoCapacity });
      messages = createVideoMessageStore({ pool: selectedPool, chatStore: chat, videoStore: catalog });
      const chatService = await createChatService({ store: chat, videoMessages: messages, authStore, authService, accessService, key: messageKey, clock });
      const service = await createVideoService({ store: catalog, messages, storage: selectedStorage, chatService, authStore, key: videoKey, minimumFreeBytes: 0, clock });
      return { chat, catalog, messages, chatService, service };
    }
    const normal = await stack();
    await normal.catalog.initialize({ now, offline: true });
    assert.equal(await normal.catalog.assertSchema(), true); assert.equal(await normal.messages.assertSchema(), true);
    const actor = owner => ({ role: owner.role, tokenHash: owner.tokenHash, now });
    async function user(role) {
      const owner = { id: id(), role, sessionId: id(), token: newToken() }; owner.tokenHash = tokenDigest(owner.token);
      await connection.query(`INSERT INTO users (id,role,status,pseudonym,email,password_hash,email_verified_at,age_assured_at,access_approved_at,created_at,updated_at)
        VALUES (?,?,'active',?,?,'synthetic-not-a-password',?,?,?,?,?)`,
      [owner.id, role, "Synthetic deletion " + role, hex(owner.id) + "@example.invalid", created, created, created, created, created]);
      if (role === "admin") await connection.query("INSERT INTO admin_mfa (user_id,secret_encrypted,version,last_totp_step,enabled_at) VALUES (?,'synthetic',1,1,?)", [owner.id, created]);
      else {
        await connection.query("INSERT INTO client_auth_state (user_id,credential_version,age_declared_at) VALUES (?,1,?)", [owner.id, created]);
        await consumeSyntheticInvitation(connection, owner.id, now - 1000);
      }
      await connection.query("INSERT INTO sessions (id,user_id,token_hash,created_at,expires_at) VALUES (?,?,?,?,?)", [owner.sessionId, owner.id, owner.tokenHash, created, sql(now + 8 * 3600000)]);
      await connection.query(role === "admin"
        ? "INSERT INTO auth_session_state (session_id,last_seen_at,mfa_verified_at,mfa_version) VALUES (?,?,?,1)"
        : "INSERT INTO client_session_state (session_id,last_seen_at,credential_version) VALUES (?,?,1)",
      role === "admin" ? [owner.sessionId, created, created] : [owner.sessionId, created]);
      return owner;
    }
    async function pair(admin = null) {
      const f = { admin: admin ?? await user("admin"), client: await user("client"), conversationId: id() }; f.cid = hex(f.conversationId);
      await connection.query("INSERT INTO conversations (id,admin_id,client_id,created_at) VALUES (?,?,?,?)", [f.conversationId, f.admin.id, f.client.id, created]);
      return f;
    }
    async function video(owner, { assetId = id(), bytes = VIDEO_BLOCK_BYTES + 57, reserved = false } = {}) {
      const asset = { id: assetId, storageKey: secret(), bytes, storedBytes: videoStoredBytes(bytes), mime: "video/mp4" };
      await normal.catalog.reserve({ ...actor(owner), asset });
      if (reserved) return asset;
      const saved = await videos.put({ assetId: asset.id, storageKey: asset.storageKey, bytes, source: mp4Source(bytes) });
      await normal.catalog.commit({ ...actor(owner), asset: { ...asset, digest: saved.digest } });
      return { ...asset, digest: saved.digest };
    }
    async function photo(owner, assetId = id()) {
      const asset = { id: assetId, storageKey: secret(), full: Buffer.alloc(400, 0x48), thumbnail: Buffer.alloc(100, 0x21) };
      asset.digest = createHash("sha256").update(asset.full).digest();
      await photos.put({ assetId: asset.id, storageKey: asset.storageKey, full: asset.full, thumbnail: asset.thumbnail });
      await connection.query(`INSERT INTO media_assets (id,owner_id,owner_role,storage_key,content_digest,active_digest,width,height,thumbnail_width,thumbnail_height,full_bytes,thumbnail_bytes,created_at,deleted_at)
        VALUES (?,?,?,?,?,?,100,80,50,40,400,100,?,NULL)`, [asset.id, owner.id, owner.role, asset.storageKey, asset.digest, asset.digest, created]);
      await connection.query(`INSERT INTO media_storage_objects (id,owner_id,owner_role,storage_key,content_digest,full_bytes,thumbnail_bytes,stored_bytes,state,asset_id,created_at,updated_at)
        VALUES (?,?,?,?,?,400,100,580,'registered',?,?,?)`, [asset.id, owner.id, owner.role, asset.storageKey, asset.digest, asset.id, created, created]);
      await connection.query("UPDATE media_storage_state SET held_bytes = held_bytes + 580 WHERE id = 1");
      return asset;
    }
    const send = async (f, owner, asset, caption = "Private video") => normal.service.send(owner.role, owner.token, f.cid,
      { clientMessageId: hex(id()), videoId: hex(asset.id), caption });
    const row = async asset => (await connection.query("SELECT state,stored_bytes,content_digest FROM video_assets WHERE id = ?", [asset.id]))[0];
    const videoHeld = async () => Number((await connection.query("SELECT held_bytes FROM video_storage_state WHERE id = 1"))[0].held_bytes);
    const photoHeld = async () => Number((await connection.query("SELECT held_bytes FROM media_storage_state WHERE id = 1"))[0].held_bytes);
    const videoFile = asset => path.join(videoRoot, hex(asset.storageKey) + ".video.enc");
    async function content(asset, selectedStorage = videos) {
      const opened = await selectedStorage.open({ assetId: asset.id, storageKey: asset.storageKey });
      try { return await collectVideo(opened.stream()); } finally { await opened.close(); }
    }
    // The acknowledgement is lost only after the native SQL commit completed.
    function ambiguousPool(marker) {
      let losses = 0;
      return { get losses() { return losses; }, async getConnection() {
        const native = await pool.getConnection(); let selected = false;
        return new Proxy(native, { get(target, name) {
          if (name === "query") return async (statement, args) => { if (marker.test(statement.trim())) selected = true; return target.query(statement, args); };
          if (name === "commit") return async () => { await target.commit(); if (selected && losses === 0) { losses++; throw new Error("Synthetic acknowledgement lost after actual SQL commit"); } };
          const value = target[name]; return typeof value === "function" ? value.bind(target) : value;
        } });
      } };
    }
    const journal = store => clientId => createErasureJournal({ directory: journalRoot, key: journalKey, clientId, binding: store.binding });
    const managed = await managedClosureFixture(t, managerRoot);
    await managed.runtime.start(); await managed.runtime.stop();
    assert.equal(managed.runtime.state().status, "stopped");
    let maintenanceGuards = 0, maintenanceHeld = false;
    const maintenance = { async withQuiescedProducers(work) {
      assert.equal(maintenanceHeld, false, "serialize erasure owners"); maintenanceHeld = true;
      const guard = async () => {
        maintenanceGuards++; assert.equal(maintenanceHeld, true); assert.equal(managed.runtime.state().status, "stopped", "the actual managed listener/producers must remain stopped");
      };
      try { await guard(); return await work(guard, guard); } finally { maintenanceHeld = false; }
    } };
    function eraser({ selectedPool = pool, videoStorage = videos, compositeStorage, journalFor } = {}) {
      const selectedCatalog = createVideoStore({ pool: selectedPool, chatStore: normal.chat, capacity: videoCapacity });
      const extension = createVideoErasureExtension({ videoStore: selectedCatalog, videoStorage, capacity: videoCapacity });
      const store = createErasureStore({ pool: selectedPool, database: options.database, capacity: photoCapacity, broadcastKey, video: extension });
      const storage = compositeStorage ?? composeVideoErasureStorage({ storage: photos, videoStorage });
      const engine = createAccountErasure({ store, storage, maintenance, clock, journalFor: journalFor ?? ((clientId, binding) => createErasureJournal({ directory: journalRoot, key: journalKey, clientId, binding })) });
      return { store, engine, journal: journal(store) };
    }
    async function readJournal(owner, selected = eraser()) {
      const reader = selected.journal(hex(owner.id)); try { return await reader.read(); } finally { reader.close(); }
    }
    async function preservedPeer(f, shared, peerVideo, peerPhoto) {
      const groups = [];
      for (const [table, column, value] of [
        ["users", "id", f.client.id], ["client_auth_state", "user_id", f.client.id], ["sessions", "user_id", f.client.id],
        ["invitations", "consumed_by_id", f.client.id], ["user_profiles", "user_id", f.client.id],
        ["email_verifications", "user_id", f.client.id], ["mail_outbox", "recipient_user_id", f.client.id],
        ["client_password_resets", "user_id", f.client.id], ["password_reset_outbox", "recipient_user_id", f.client.id],
        ["broadcast_preferences", "user_id", f.client.id], ["push_subscriptions", "user_id", f.client.id],
        ["conversations", "id", f.conversationId], ["messages", "conversation_id", f.conversationId], ["chat_events", "conversation_id", f.conversationId],
        ["message_video", "conversation_id", f.conversationId], ["chat_receipts", "conversation_id", f.conversationId],
        ["crm_profiles", "conversation_id", f.conversationId], ["crm_memberships", "conversation_id", f.conversationId], ["crm_tasks", "conversation_id", f.conversationId],
        ["media_assets", "owner_id", f.client.id], ["media_storage_objects", "owner_id", f.client.id], ["video_assets", "owner_id", f.client.id],
        ["video_assets", "id", shared.id],
      ]) groups.push([table, serialize((await connection.query(`SELECT * FROM ${table} WHERE ${column} = ?`, [value])).map(entry => serialize(entry)).sort())]);
      groups.push(["peer_session_state", serialize((await connection.query("SELECT cs.* FROM client_session_state cs JOIN sessions s ON s.id=cs.session_id WHERE s.user_id=? ORDER BY cs.session_id", [f.client.id])).map(entry => serialize(entry)).sort())]);
      for (const asset of [shared, peerVideo]) groups.push([hex(asset.id), createHash("sha256").update(await readFile(videoFile(asset))).digest("hex")]);
      for (const variant of ["full", "thumb"]) groups.push([hex(peerPhoto.id), variant,
        createHash("sha256").update(await photos.get({ assetId: peerPhoto.id, storageKey: peerPhoto.storageKey, variant })).digest("hex")]);
      return serialize(groups);
    }
    async function closureSeed() {
      const first = await pair(), peer = await pair(first.admin), collision = id();
      const ownVideo = await video(first.client, { assetId: collision }), ownPhoto = await photo(first.client, collision);
      const pending = await video(first.client, { reserved: true, bytes: 601 });
      const staging = path.join(videoRoot, "." + hex(pending.storageKey) + ".video." + hex(id()) + ".tmp");
      await writeFile(staging, Buffer.alloc(43, 0x51), { mode: 0o600 });
      const shared = await video(first.admin), peerVideo = await video(peer.client), peerPhoto = await photo(peer.client);
      await send(first, first.client, ownVideo); await send(first, first.admin, shared); const peerMessage = await send(peer, peer.admin, shared);
      const before = await preservedPeer(peer, shared, peerVideo, peerPhoto);
      return { first, peer, ownVideo, ownPhoto, pending, staging, shared, peerVideo, peerPhoto, peerMessage, before,
        videoHeld: await videoHeld(), photoHeld: await photoHeld() };
    }
    async function completeAndCompare(f, selected = eraser()) {
      let result;
      for (let pass = 0; pass < 20; pass++) { result = await selected.engine.resume({ clientId: hex(f.first.client.id), maxMedia: 1 }); if (result.completed) break; }
      assert.equal(result.completed, true);
      assert.equal((await connection.query("SELECT id FROM users WHERE id = ?", [f.first.client.id])).length, 0);
      assert.equal((await connection.query("SELECT id FROM video_assets WHERE owner_id = ?", [f.first.client.id])).length, 0);
      assert.equal((await connection.query("SELECT id FROM media_storage_objects WHERE owner_id = ?", [f.first.client.id])).length, 0);
      await assert.rejects(readFile(videoFile(f.ownVideo)), { code: "ENOENT" }); await assert.rejects(readFile(f.staging), { code: "ENOENT" });
      assert.equal(await videoHeld(), f.videoHeld - f.ownVideo.storedBytes - f.pending.storedBytes); assert.equal(await photoHeld(), f.photoHeld - 580);
      assert.equal(await preservedPeer(f.peer, f.shared, f.peerVideo, f.peerPhoto), f.before);
      const opened = await normal.service.openMessage("client", f.peer.client.token, f.peer.cid, f.peerMessage.message.id);
      try { assert.equal((await collectVideo(opened.stream())).length, f.shared.bytes); } finally { await opened.close(); }
      const saved = await readJournal(f.first.client, selected); assert.equal(saved.record.version, 2); assert.equal(saved.record.phase, "completed");
      const held = await videoHeld(); assert.equal((await selected.engine.resume({ clientId: hex(f.first.client.id) })).completed, true); assert.equal(await videoHeld(), held);
      return saved;
    }

    await t.test("owner deletion rejects live messages, then tombstone deletion removes only the intended original once", async () => {
      const f = await pair(), other = await pair(f.admin), asset = await video(f.admin), sent = await send(f, f.admin, asset);
      const before = await readFile(videoFile(asset)), held = await videoHeld();
      await assert.rejects(normal.service.remove("client", other.client.token, hex(asset.id)), code("VIDEO_NOT_FOUND"));
      await assert.rejects(normal.service.remove("admin", f.admin.token, hex(asset.id)), code("VIDEO_IN_USE"));
      assert.equal((await row(asset)).state, "committed"); assert.equal(await videoHeld(), held); assert.deepEqual(await readFile(videoFile(asset)), before);
      await normal.chatService.delete("admin", f.admin.token, f.cid, sent.message.id);
      assert.deepEqual(await normal.service.remove("admin", f.admin.token, hex(asset.id)), { deleted: true });
      assert.equal((await row(asset)).state, "released"); assert.equal(await videoHeld(), held - asset.storedBytes);
      assert.equal((await connection.query("SELECT message_id FROM message_video WHERE message_id = ?", [Buffer.from(sent.message.id, "hex")])).length, 1, "retain the tombstone link for message retries");
      await assert.rejects(readFile(videoFile(asset)), { code: "ENOENT" });
      assert.deepEqual(await normal.service.remove("admin", f.admin.token, hex(asset.id)), { deleted: true }); assert.equal(await videoHeld(), held - asset.storedBytes);
      await assert.rejects(normal.service.open("admin", f.admin.token, hex(asset.id)), code("VIDEO_NOT_FOUND"));
    });
    await t.test("a wrong physical video root cannot tombstone or refund an existing original", async () => {
      const f = await pair(), asset = await video(f.client), root = path.join(directory, "wrong-video-root"); await mkdir(root, { mode: 0o700 });
      const wrong = await createVideoStorage({ root, key: videoKey, pathMode: "linux-dirfd" }), wrongStack = await stack(pool, wrong);
      const held = await videoHeld(), original = await readFile(videoFile(asset));
      await assert.rejects(wrongStack.service.remove("client", f.client.token, hex(asset.id)), code("VIDEO_UNAVAILABLE"));
      assert.equal((await row(asset)).state, "committed"); assert.equal(await videoHeld(), held); assert.deepEqual(await readFile(videoFile(asset)), original); assert.deepEqual(await readdir(root), []);
    });
    await t.test("an acknowledgement lost after actual unlink leaves the allocation held until a durable retry", async () => {
      const f = await pair(), asset = await video(f.client), held = await videoHeld(); let lost = false;
      const interrupted = await stack(pool, { ...videos, async remove(value) { const result = await videos.remove(value); if (!lost) { lost = true; throw new Error("Synthetic acknowledgement lost after durable unlink"); } return result; } });
      await assert.rejects(interrupted.service.remove("client", f.client.token, hex(asset.id)), code("VIDEO_UNAVAILABLE"));
      assert.equal(lost, true); assert.equal((await row(asset)).state, "cleanup_pending"); assert.equal(await videoHeld(), held); await assert.rejects(readFile(videoFile(asset)), { code: "ENOENT" });
      assert.deepEqual(await normal.service.remove("client", f.client.token, hex(asset.id)), { deleted: true }); assert.equal(await videoHeld(), held - asset.storedBytes);
    });
    for (const [phase, marker, expectedState, refunded] of [
      ["delete intent", /^UPDATE video_assets SET state = 'cleanup_pending'/i, "cleanup_pending", false],
      ["release", /^UPDATE video_storage_state SET held_bytes = held_bytes -/i, "released", true],
    ]) await t.test(`a lost native ${phase} commit is durable, explicit and not double-refunded`, async () => {
      const f = await pair(), asset = await video(f.client), held = await videoHeld(), uncertain = ambiguousPool(marker), interrupted = await stack(uncertain);
      await assert.rejects(interrupted.service.remove("client", f.client.token, hex(asset.id)), code("VIDEO_UNAVAILABLE"));
      assert.equal(uncertain.losses, 1); assert.equal((await row(asset)).state, expectedState); assert.equal(await videoHeld(), held - (refunded ? asset.storedBytes : 0));
      if (refunded) await assert.rejects(readFile(videoFile(asset)), { code: "ENOENT" }); else assert.equal((await content(asset)).length, asset.bytes);
      assert.deepEqual(await normal.service.remove("client", f.client.token, hex(asset.id)), { deleted: true }); assert.equal(await videoHeld(), held - asset.storedBytes);
      assert.deepEqual(await normal.service.remove("client", f.client.token, hex(asset.id)), { deleted: true }); assert.equal(await videoHeld(), held - asset.storedBytes);
    });
    await t.test("the ordinary schema-33 eraser refuses the candidate graph instead of overlooking video references", async () => {
      const f = await pair(), asset = await video(f.client); await send(f, f.client, asset);
      async function snapshot() {
        const values = [];
        for (const table of [...createdMigrationTables(candidates), "schema_migrations"])
          values.push([table, (await connection.query("SELECT * FROM " + table)).map(entry => serialize(entry)).sort()]);
        for (const root of [photoRoot, videoRoot, journalRoot]) {
          const files = [];
          for (const name of (await readdir(root)).sort()) files.push([name, createHash("sha256").update(await readFile(path.join(root, name))).digest("hex")]);
          values.push([root, files]);
        }
        return serialize(values);
      }
      const before = await snapshot();
      // The immutable migration ledger rejects version 34 against the ordinary
      // plan of 33 before the subsequent dependency-graph checks are reached.
      await assert.rejects(assertErasureSchema(connection, options.database), error => {
        assert.ok(error instanceof MigrationError); assert.equal(error.code, "HISTORY_DIVERGED");
        assert.deepEqual(error.details, { version: 34 }); return true;
      });
      assert.equal(await snapshot(), before);
      const legacy = createErasureStore({ pool, database: options.database, capacity: photoCapacity, broadcastKey });
      let entered = false;
      // The store boundary intentionally hides non-erasure implementation
      // errors; it must still refuse before exposing the destructive scope.
      await assert.rejects(legacy.withLease(hex(f.client.id), scope => { entered = true; return scope.inspect(now); }),
        error => error instanceof AccountErasureError && error.code === "ERASURE_UNAVAILABLE" && error.cause === undefined);
      assert.equal(entered, false); assert.equal(await snapshot(), before);
      assert.equal((await connection.query("SELECT status FROM users WHERE id = ?", [f.client.id]))[0].status, "active");
    });
    await t.test("a bounded closure resumes with typed photo/video cursors, reserved staging and a complete peer preserved", async () => {
      const f = await closureSeed(), selected = eraser();
      const first = await selected.engine.resume({ clientId: hex(f.first.client.id), maxMedia: 1 });
      assert.equal(first.completed, false); assert.equal(first.phase, "prepared"); assert.equal(first.processedMedia, 1);
      const saved = await readJournal(f.first.client, selected); assert.equal(saved.record.version, 2); assert.equal(saved.record.cursor, "p:" + hex(f.ownPhoto.id));
      assert.equal(saved.record.binding.videoRootFingerprint, hex(videoCapacity.rootFingerprint));
      assert.equal((await row(f.ownVideo)).state, "cleanup_pending"); assert.equal(await videoHeld(), f.videoHeld, "same ID in another catalog must not be skipped or refunded early");
      const final = await completeAndCompare(f, selected); assert.match(final.record.cursor, /^v:[a-f0-9]{32}$/);
      const batch = await readErasureJournalBatch({ directory: journalRoot, key: journalKey, binding: selected.store.binding });
      assert.equal(batch.jobs.find(job => job.clientId === hex(f.first.client.id))?.phase, "completed"); assert.ok(maintenanceGuards > 10);
    });
    await t.test("candidate schema qualification and closure reuse the single lease connection", async () => {
      const f = await closureSeed(); let borrowed = 0, peak = 0, nested = 0;
      const oneConnection = { async getConnection() {
        if (borrowed !== 0) { nested++; throw new Error("A second runtime connection cannot be borrowed while the closure lease is held"); }
        const native = await pool.getConnection(); borrowed++; peak = Math.max(peak, borrowed); let released = false;
        return new Proxy(native, { get(target, name) {
          if (name === "release") return async () => { if (released) return; released = true; try { await target.release(); } finally { borrowed--; } };
          const value = target[name]; return typeof value === "function" ? value.bind(target) : value;
        } });
      } };
      await completeAndCompare(f, eraser({ selectedPool: oneConnection }));
      assert.equal(nested, 0); assert.equal(peak, 1); assert.equal(borrowed, 0);
    });
    for (const [phase, marker] of [
      ["prepare", /^UPDATE users SET status = 'deleted'/i],
      ["video release", /^UPDATE video_storage_state SET held_bytes = held_bytes -/i],
      ["finish", /^DELETE FROM users/i],
    ]) await t.test(`account closure resumes after the real ${phase} commit loses its acknowledgement`, async () => {
      const f = await closureSeed(), uncertain = ambiguousPool(marker), interrupted = eraser({ selectedPool: uncertain });
      await assert.rejects(interrupted.engine.resume({ clientId: hex(f.first.client.id) })); assert.equal(uncertain.losses, 1);
      const state = await readJournal(f.first.client, interrupted);
      assert.equal(state.record.phase, phase === "prepare" ? "requested" : phase === "finish" ? "files_erased" : "prepared");
      if (phase === "prepare") assert.equal((await row(f.ownVideo)).state, "cleanup_pending");
      if (phase === "finish") assert.equal((await connection.query("SELECT id FROM users WHERE id = ?", [f.first.client.id])).length, 0);
      await completeAndCompare(f);
    });
    await t.test("a changed video root binding stops closure before its first SQL mutation or destructive journal", async () => {
      const f = await closureSeed(), wrongRoot = path.join(directory, "wrong-closure-root"); await mkdir(wrongRoot, { mode: 0o700 });
      const wrong = await createVideoStorage({ root: wrongRoot, key: videoKey, pathMode: "linux-dirfd" });
      const selected = eraser({ compositeStorage: composeVideoErasureStorage({ storage: photos, videoStorage: wrong }) });
      const journalsBefore = await readdir(journalRoot), held = await videoHeld(), files = await readFile(videoFile(f.ownVideo));
      await assert.rejects(selected.engine.resume({ clientId: hex(f.first.client.id) }), code("ERASURE_BINDING"));
      assert.equal((await connection.query("SELECT status FROM users WHERE id = ?", [f.first.client.id]))[0].status, "active");
      assert.equal((await row(f.ownVideo)).state, "committed"); assert.equal(await videoHeld(), held); assert.deepEqual(await readFile(videoFile(f.ownVideo)), files); assert.deepEqual(await readdir(journalRoot), journalsBefore);
      await completeAndCompare(f);
    });
  } finally {
    await pool?.end(); await reset(); await connection.end();
  }
});
