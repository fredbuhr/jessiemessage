import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { databaseOptions, connectDatabase } from "../server/db/connection.mjs";
import { createdMigrationTables, applyMigrations, loadMigrations } from "../server/db/migrations.mjs";
import { createRuntimePool } from "../server/db/runtime.mjs";
import { createMediaStorage } from "../server/media/storage.mjs";
import { openPayload, sealPayload, campaignFingerprint } from "../server/broadcast/crypto.mjs";
import { createErasureStore } from "../server/data/erasure-store.mjs";
import { createErasureJournal, readErasureJournalBatch } from "../server/data/erasure-journal.mjs";
import { createAccountErasure } from "../server/data/erasure.mjs";
import { createServer } from "node:http";
import { createClosureService, createClosureTargets } from "../server/data/closure-service.mjs";
import { createClosureHandler } from "../server/data/closure-http.mjs";
import { createClosureOperations, verifyClosureStartup } from "../server/data/closure-operations.mjs";
import { runManagedClosures } from "../server/backup/managed-closures.mjs";
import { createBackupInspectionPool, assertBackupInspection } from "../server/backup/inspection.mjs";
import { consumeSyntheticInvitation } from "./fixtures/manual-admission.mjs";
import { erasureDirectory } from "./fixtures/erasure-files.mjs";
import { managedClosureFixture } from "./fixtures/managed-closure-runtime.mjs";

const enabled = process.env.JESSIEMESSAGE_DB_TEST === "1";
const id = () => randomBytes(16), hex = value => value.toString("hex");
const now = Date.parse("2026-10-18T20:00:00Z");
const sqlDate = value => new Date(value).toISOString().replace("T", " ").replace("Z", "000");
const created = sqlDate(now - 60000), expiry = sqlDate(now + 600000);
const serialize = rows => rows.map(row => JSON.stringify(row, (_key, value) => typeof value === "bigint" ? value.toString() : value)).sort();

test("durable account erasure removes the selected graph and actual encrypted files, with peers intact (disposable MariaDB only)", {
  skip: enabled ? false : "Set JESSIEMESSAGE_DB_TEST=1 with explicit loopback disposable credentials.", timeout: 180000,
}, async t => {
  const options = databaseOptions();
  assert.ok(["127.0.0.1", "::1", "localhost"].includes(options.host));
  assert.match(options.database, /^jessiemessage_test(?:_[a-z0-9]+)*$/);
  assert.ok(process.env.JESSIEMESSAGE_RUNTIME_DB_USER && process.env.JESSIEMESSAGE_RUNTIME_DB_PASSWORD);
  const migrations = await loadMigrations(), allowed = [...createdMigrationTables(migrations).reverse(), "migration_probe", "schema_migrations"];
  const connection = await connectDatabase(); let pool;
  const directory = await erasureDirectory(t), mediaRoot = path.join(directory, "media"), journalRoot = path.join(directory, "journal");
  await mkdir(mediaRoot, { mode: 0o700 }); await mkdir(journalRoot, { mode: 0o700 });
  const storage = await createMediaStorage({ root: mediaRoot, key: Buffer.alloc(32, 6), pathMode: "linux-dirfd" });
  const rootFingerprint = await storage.fingerprint(), broadcastKey = Buffer.alloc(32, 3), journalKey = Buffer.alloc(32, 7);
  const capacity = { ownerBytes: 1048576, totalBytes: 104857600, rootFingerprint };
  async function cleanup() {
    const tables = await connection.query("SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?", [options.database]);
    assert.ok(tables.every(row => allowed.includes(row.name)), "Refuse unrelated schema cleanup");
    for (const table of allowed) await connection.query(`DROP TABLE IF EXISTS ${table}`);
  }
  async function databaseHash() {
    const digest = createHash("sha256");
    for (const table of allowed.filter(name => name !== "migration_probe")) digest.update(table).update(JSON.stringify(serialize(await connection.query(`SELECT * FROM ${table}`))));
    return digest.digest("hex");
  }
  let admin, adminSession;
  async function user(role) {
    const uid = id();
    await connection.query(`INSERT INTO users (id, role, status, pseudonym, email, password_hash, email_verified_at, age_assured_at,
      access_approved_at, created_at, updated_at) VALUES (?, ?, 'active', ?, ?, 'synthetic-password-hash', ?, ?, ?, ?, ?)`,
    [uid, role, `Private ${hex(uid)}`, `${hex(uid)}@example.invalid`, created, created, created, created, created]);
    if (role === "client") { await connection.query("INSERT INTO client_auth_state (user_id, age_declared_at) VALUES (?, ?)", [uid, created]); await consumeSyntheticInvitation(connection, uid, now - 60000); }
    return uid;
  }
  async function session(uid, role) {
    const sid = id();
    await connection.query("INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)", [sid, uid, randomBytes(32), created, expiry]);
    if (role === "client") await connection.query("INSERT INTO client_session_state (session_id, last_seen_at, credential_version) VALUES (?, ?, 1)", [sid, created]);
    return sid;
  }
  async function asset(uid, role, state) {
    const aid = id(), storageKey = randomBytes(32), full = Buffer.concat(Array.from({ length: 25 }, () => aid)), thumbnail = Buffer.alloc(100, aid[0]);
    const digest = createHash("sha256").update(full).digest();
    await storage.put({ assetId: aid, storageKey, full, thumbnail });
    if (state !== "reserved") await connection.query(`INSERT INTO media_assets (id, owner_id, owner_role, storage_key, content_digest, active_digest,
      width, height, thumbnail_width, thumbnail_height, full_bytes, thumbnail_bytes, created_at, deleted_at)
      VALUES (?, ?, ?, ?, ?, ?, 100, 80, 50, 40, 400, 100, ?, ?)`,
    [aid, uid, role, storageKey, digest, state === "registered" ? digest : null, created, state === "registered" ? null : created]);
    await connection.query(`INSERT INTO media_storage_objects (id, owner_id, owner_role, storage_key, content_digest, full_bytes, thumbnail_bytes,
      stored_bytes, state, asset_id, created_at, updated_at, released_at) VALUES (?, ?, ?, ?, ?, 400, 100, 580, ?, ?, ?, ?, ?)`,
    [aid, uid, role, storageKey, digest, state, state === "reserved" ? null : aid, created, created, state === "released" ? created : null]);
    if (state !== "released") await connection.query("UPDATE media_storage_state SET held_bytes = held_bytes + 580 WHERE id = 1");
    return { id: aid, storageKey, full, thumbnail };
  }
  async function message(conv, uid, role, sequence, media = null, clientMessageId = id()) {
    const mid = id();
    await connection.query(`INSERT INTO messages (id, conversation_id, sequence_no, sender_id, sender_role, client_message_id, body_encrypted, body_fingerprint, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'synthetic-ciphertext-not-exported', ?, ?)`, [mid, conv, sequence, uid, role, clientMessageId, randomBytes(32), created]);
    await connection.query("INSERT INTO chat_events (conversation_id, event_sequence, message_id, kind, occurred_at) VALUES (?, ?, ?, 'message', ?)", [conv, sequence, mid, created]);
    if (media !== null) await connection.query("INSERT INTO message_media (message_id, conversation_id, media_id, created_at) VALUES (?, ?, ?, ?)", [mid, conv, media.id, created]); return mid;
  }
  async function mail(uid, table, state) {
    const challenge = id(), field = table === "mail_outbox" ? "verification_id" : "reset_id";
    if (field === "verification_id") await connection.query("INSERT INTO email_verifications (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)", [challenge, uid, randomBytes(32), created, expiry]);
    else await connection.query("INSERT INTO client_password_resets (id, user_id, token_hash, credential_version, email_hash, created_at, expires_at) VALUES (?, ?, ?, 1, ?, ?, ?)", [challenge, uid, randomBytes(32), randomBytes(32), created, expiry]);
    await connection.query(`INSERT INTO ${table} (id, ${field}, recipient_user_id, payload_encrypted, status, attempts, available_at, expires_at, created_at, lease_token, lease_until, sent_at)
      VALUES (?, ?, ?, 'synthetic-payload-no-mail-transport', ?, 1, ?, ?, ?, ?, ?, ?)`,
    [id(), challenge, uid, state, created, expiry, created, state === "sending" ? id() : null, state === "sending" ? expiry : null, state === "sent" ? created : null]);
  }
  async function subscription(uid, sid, role) {
    const pid = id(); await connection.query(`INSERT INTO push_subscriptions (id, user_id, role, session_id, credential_version, generation, endpoint_digest,
      subscription_encrypted, locale, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 1, ?, 'synthetic-push-no-transport', 'fr', ?, ?)`,
    [pid, uid, role, sid, randomBytes(32), created, created]); return pid;
  }
  async function push(mid, sid, sending = false) {
    await connection.query(`INSERT INTO push_outbox (id, message_id, subscription_id, subscription_generation, status, attempts, available_at, created_at, expires_at, lease_token, lease_until)
      VALUES (?, ?, ?, 1, ?, 1, ?, ?, ?, ?, ?)`, [id(), mid, sid, sending ? "sending" : "pending", created, created, expiry, sending ? id() : null, sending ? expiry : null]);
  }
  async function campaign(recipients, status = "queued") {
    const cid = id(), clientCampaignId = id(), ordered = [...recipients].sort((a, b) => Buffer.compare(a.conv, b.conv));
    const payload = { title: "Synthetic shared campaign", body: "Unsent synthetic message", mediaId: null, allowRepeatMedia: false, conversationIds: ordered.map(x => hex(x.conv)) };
    const associated = { campaignId: cid, adminId: admin }, fingerprint = campaignFingerprint(payload, broadcastKey, associated);
    await connection.query(`INSERT INTO broadcast_campaigns (id, admin_id, client_campaign_id, mfa_version, payload_encrypted, request_fingerprint, status, created_at, updated_at, expires_at)
      VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`, [cid, admin, clientCampaignId, sealPayload(payload, broadcastKey, associated), fingerprint, status, created, created, expiry]);
    for (const r of ordered) {
      const delivered = status === "completed", clientMessageId = id(); let proposed = id();
      if (delivered) {
        const sequence = Number((await connection.query("SELECT COALESCE(MAX(sequence_no), 0) AS n FROM messages WHERE conversation_id = ?", [r.conv]))[0].n) + 1;
        proposed = await message(r.conv, admin, "admin", sequence, null, clientMessageId);
      }
      await connection.query(`INSERT INTO broadcast_recipients (campaign_id, conversation_id, client_id, proposed_message_id, client_message_id,
        delivered_message_id, state, available_at, created_at, delivered_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [cid, r.conv, r.client, proposed, clientMessageId, delivered ? proposed : null, delivered ? "delivered" : "pending", created, created, delivered ? created : null]);
    }
    return { id: cid, payload, fingerprint, clientCampaignId };
  }
  async function seed() {
    const first = await user("client"), peer = await user("client"), conv = id(), peerConv = id();
    await connection.query("INSERT INTO conversations (id, client_id, admin_id, created_at) VALUES (?, ?, ?, ?), (?, ?, ?, ?)", [conv, first, admin, created, peerConv, peer, admin, created]);
    const sid = await session(first, "client"), peerSid = await session(peer, "client");
    const own = await asset(first, "client", "registered"), shared = await asset(admin, "admin", "registered"), peerAsset = await asset(peer, "client", "registered");
    const objects = [own]; for (const state of ["reserved", "cleanup_pending", "released"]) objects.push(await asset(first, "client", state));
    const ownMessage = await message(conv, first, "client", 1, own), adminMessage = await message(conv, admin, "admin", 2, shared);
    const peerMessage = await message(peerConv, peer, "client", 1, peerAsset), peerAdminMessage = await message(peerConv, admin, "admin", 2, shared);
    const label = id(); await connection.query("INSERT INTO crm_labels (id, owner_admin_id, kind, name, normalized_name, created_at, updated_at) VALUES (?, ?, 'tag', ?, ?, ?, ?)", [label, admin, hex(label), hex(label), created, created]);
    for (const [uid, conversationId] of [[first, conv], [peer, peerConv]]) {
      await connection.query("INSERT INTO chat_receipts (conversation_id, user_id, last_read_sequence, updated_at) VALUES (?, ?, 2, ?), (?, ?, 2, ?)", [conversationId, uid, created, conversationId, admin, created]);
      await connection.query("INSERT INTO crm_profiles (admin_id, conversation_id, nickname, notes_encrypted, version, notes_revision, created_at, updated_at) VALUES (?, ?, 'Synthetic internal note', 'synthetic-encrypted-private-note', 1, 1, ?, ?)", [admin, conversationId, created, created]);
      await connection.query("INSERT INTO crm_memberships (admin_id, conversation_id, label_id, created_at) VALUES (?, ?, ?, ?)", [admin, conversationId, label, created]);
      await connection.query("INSERT INTO broadcast_preferences (user_id, enabled, version, created_at, updated_at) VALUES (?, 1, 1, ?, ?)", [uid, created, created]);
      for (const table of ["mail_outbox", "password_reset_outbox"]) for (const state of ["pending", "sending", "sent"]) await mail(uid, table, state);
    }
    const sub = await subscription(first, sid, "client"), peerSub = await subscription(peer, peerSid, "client"), adminSub = await subscription(admin, adminSession, "admin");
    await push(adminMessage, sub); await push(ownMessage, adminSub, true); await push(peerAdminMessage, peerSub); await push(peerMessage, adminSub);
    const sharedCampaign = await campaign([{ client: first, conv }, { client: peer, conv: peerConv }]);
    const onlyCampaign = await campaign([{ client: first, conv, message: adminMessage }], "completed");
    const deliveredCampaign = await campaign([{ client: first, conv, message: adminMessage }, { client: peer, conv: peerConv, message: peerAdminMessage }], "completed");
    return { first, peer, conv, peerConv, sid, peerSid, own, shared, peerAsset, objects, ownMessage, sharedCampaign, onlyCampaign, deliveredCampaign };
  }
  async function peerSnapshot(f) {
    const groups = [];
    for (const [table, column, value] of [["users", "id", f.peer], ["users", "id", admin], ["sessions", "user_id", f.peer], ["sessions", "user_id", admin],
      ["client_auth_state", "user_id", f.peer], ["client_session_state", "session_id", f.peerSid], ["invitations", "consumed_by_id", f.peer],
      ["email_verifications", "user_id", f.peer], ["client_password_resets", "user_id", f.peer], ["mail_outbox", "recipient_user_id", f.peer],
      ["password_reset_outbox", "recipient_user_id", f.peer], ["broadcast_preferences", "user_id", f.peer], ["push_subscriptions", "user_id", f.peer],
      ["media_assets", "owner_id", f.peer], ["media_storage_objects", "owner_id", f.peer], ["media_assets", "id", f.shared.id], ["media_storage_objects", "id", f.shared.id],
      ["conversations", "id", f.peerConv], ...["messages", "chat_events", "chat_receipts", "message_media", "crm_profiles", "crm_memberships"].map(table => [table, "conversation_id", f.peerConv])])
      groups.push([table, serialize(await connection.query(`SELECT * FROM ${table} WHERE ${column} = ?`, [value]))]);
    groups.push(["crm_labels", serialize(await connection.query("SELECT * FROM crm_labels"))]);
    groups.push(["peer_campaign_recipients", serialize(await connection.query("SELECT * FROM broadcast_recipients WHERE client_id = ?", [f.peer]))]);
    groups.push(["peer_push", serialize(await connection.query("SELECT o.* FROM push_outbox o JOIN messages m ON m.id = o.message_id WHERE m.conversation_id = ?", [f.peerConv]))]);
    for (const asset of [f.shared, f.peerAsset]) for (const variant of ["full", "thumb"]) {
      const bytes = await storage.get({ assetId: asset.id, storageKey: asset.storageKey, variant }); groups.push([hex(asset.id), variant, createHash("sha256").update(bytes).digest("hex")]);
    }
    return JSON.stringify(groups);
  }
  function engine(customPool = pool, overrides = {}) {
    const store = createErasureStore({ pool: customPool, database: options.database, capacity, broadcastKey });
    const maintenance = { async withQuiescedProducers(work) { return work(async () => {}); } }; // This fixture has no listener, worker, transport or concurrent producer.
    return createAccountErasure({ store, storage, maintenance, clock: () => now,
      journalFor: (clientId, binding) => createErasureJournal({ directory: journalRoot, key: journalKey, clientId, binding }), ...overrides });
  }
  async function journal(f) {
    const j = createErasureJournal({ directory: journalRoot, key: journalKey, clientId: hex(f.first), binding: { database: options.database, rootFingerprint: hex(rootFingerprint) } });
    try { return await j.read(); } finally { j.close(); }
  }
  try {
    await cleanup(); await applyMigrations(connection, { database: options.database, migrations }); pool = await createRuntimePool(process.env);
    await connection.query("INSERT INTO media_storage_state (id, owner_bytes, total_bytes, root_fingerprint, held_bytes, initialized_at) VALUES (1, ?, ?, ?, 0, ?)", [capacity.ownerBytes, capacity.totalBytes, rootFingerprint, created]);
    admin = await user("admin"); adminSession = await session(admin, "admin");
    await t.test("confirmed HTTP intent survives a real managed drain, privileged inventory and SQL erasure; startup blocks a restored identity", async step => {
      const f = await seed(), before = await databaseHash(), peerBefore = await peerSnapshot(f);
      const store = createErasureStore({ pool, database: options.database, capacity, broadcastKey });
      const batch = page => readErasureJournalBatch({ directory: journalRoot, key: journalKey, binding: store.binding, ...page });
      const journalFor = clientId => createErasureJournal({ directory: journalRoot, key: journalKey, binding: store.binding, clientId });
      const service = createClosureService({ directory: journalRoot, key: journalKey, store, target: createClosureTargets(pool), clock: () => now });
      const token = Buffer.alloc(32, 1).toString("base64url"), csrf = Buffer.alloc(32, 2).toString("base64url");
      const handler = createClosureHandler(service, { origin: "https://jessiemessage.com", actor: async value => value === token
        ? { user: { id: hex(admin), role: "admin", pseudonym: "Synthetic administrator" }, csrf, expiresAt: now + 3600000 } : null });
      const api = createServer(async (request, response) => { if (!await handler(request, response)) { response.writeHead(404); response.end(); } });
      let managed, inspector;
      try {
        await new Promise(done => api.listen(0, "127.0.0.1", done));
        const client = await createClosureTargets(pool)(hex(f.first));
        const accepted = await fetch(`http://127.0.0.1:${api.address().port}/api/admin/closures/clients/${hex(f.first)}`, { method: "POST",
          headers: { Cookie: `__Host-jessie_session=${token}`, Origin: "https://jessiemessage.com", "Content-Type": "application/json", "X-CSRF-Token": csrf },
          body: JSON.stringify({ confirmation: "FERMER", expectedPseudonym: client.pseudonym }) });
        assert.equal(accepted.status, 202); assert.equal((await accepted.json()).closure.phase, "requested");
        assert.equal(await databaseHash(), before, "The web request writes no SQL row");
        await assert.rejects(verifyClosureStartup({ store, batch, clock: () => now }), { code: "ERASURE_PENDING" });
        await new Promise(done => api.close(done));
        const managedRoot = path.join(directory, "managed-runtime"); await mkdir(managedRoot, { mode: 0o700 });
        managed = await managedClosureFixture(step, managedRoot); await managed.runtime.start();
        inspector = await createBackupInspectionPool(process.env); let inventoryChecks = 0, inventoryRejections = 0;
        const operations = createClosureOperations({ store, storage, journalFor, batch, clock: () => now,
          async inspectExecutableObjects() {
            const c = await inspector.getConnection();
            try { await assertBackupInspection(c, options.database); inventoryChecks++; return { verified: true }; }
            catch (error) { if (error?.code === "BACKUP_INSPECTION_CONFIG") inventoryRejections++; throw error; }
            finally { await c.release(); }
          },
          // Disposable fixture: this private directory is retained independently
          // of SQL restoration for the whole test. This is not production proof.
          async verifyRegistryContinuity() { await batch({ limit: 100 }); return { verified: true }; },
        });
        assert.equal(await operations.hasPending(), true);
        await connection.query("CREATE TRIGGER closure_fixture_trigger BEFORE DELETE ON users FOR EACH ROW SET @closure_probe = 1");
        try {
          const dml = await pool.getConnection();
          try {
            const rows = await dml.query("SELECT TRIGGER_NAME AS name, ACTION_STATEMENT AS body, DEFINER AS owner FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = ?", [options.database]);
            assert.equal(rows.length, 1); assert.equal(rows[0].body, null); assert.equal(rows[0].owner, null, "DML exposes a partial trigger record, not privileged executable inspection");
          }
          finally { await dml.release(); }
          // The existing capture-lock facade deliberately sanitizes callback
          // failures. Check the real rejection as well as the public boundary.
          await assert.rejects(runManagedClosures({ runtime: managed.runtime, operations, directory: journalRoot, source: async () => {} }), { code: "RECURRING_FILES_IO" });
          assert.equal(inventoryRejections, 1);
          assert.equal(managed.runtime.state().status, "running"); assert.equal(await databaseHash(), before);
        } finally { await connection.query("DROP TRIGGER closure_fixture_trigger"); }
        await runManagedClosures({ runtime: managed.runtime, operations, directory: journalRoot, source: async () => {} });
        assert.ok(inventoryChecks >= 2); assert.equal(await operations.hasPending(), false);
        assert.equal(await peerSnapshot(f), peerBefore);
        assert.equal((await service.preview(hex(f.first))).client, null); assert.equal((await journal(f)).record.phase, "completed");
        assert.equal((await verifyClosureStartup({ store, batch, clock: () => now })).verified, true);
        await managed.runtime.stop();
        await connection.query("INSERT INTO users (id, role, status, pseudonym, email, created_at, updated_at) VALUES (?, 'client', 'pending', 'Restored closure fixture', ?, ?, ?)", [f.first, `${hex(f.first)}-closure-restore@example.invalid`, created, created]);
        try { await assert.rejects(verifyClosureStartup({ store, batch, clock: () => now }), { code: "ERASURE_RESTORE_REPLAY_REQUIRED" }); }
        finally { await connection.query("DELETE FROM users WHERE id = ?", [f.first]); }
        assert.equal(managed.runtime.state().status, "stopped"); assert.equal((await journal(f)).record.phase, "completed");
        await assert.rejects(createClosureTargets(pool)(hex(admin)), { code: "ERASURE_TARGET" });
      } finally {
        api.closeAllConnections(); await new Promise(done => api.close(done)); handler.close();
        await managed?.runtime.destroy(); await inspector?.end();
      }
    });
    await t.test("a pending client without any conversation can be closed from its account card", async () => {
      const uid = await user("client"); await connection.query("UPDATE users SET status = 'pending', email_verified_at = NULL, access_approved_at = NULL, updated_at = ? WHERE id = ?", [created, uid]);
      const store = createErasureStore({ pool, database: options.database, capacity, broadcastKey });
      const service = createClosureService({ directory: journalRoot, key: journalKey, store, target: createClosureTargets(pool), clock: () => now });
      try {
        const client = (await service.preview(hex(uid))).client; assert.equal(client.status, "pending");
        await service.request(hex(uid), { confirmation: "FERMER", expectedPseudonym: client.pseudonym }, async () => {});
        assert.equal((await engine().resume({ clientId: hex(uid) })).completed, true);
        assert.equal((await service.preview(hex(uid))).client, null);
      } finally { service.close(); }
    });
    await t.test("complete removal preserves peer data, reused administrator photos and coherent shared campaign audiences", async () => {
      const f = await seed(), before = await peerSnapshot(f), held = Number((await connection.query("SELECT held_bytes FROM media_storage_state WHERE id = 1"))[0].held_bytes);
      const result = await engine().resume({ clientId: hex(f.first) }); assert.equal(result.completed, true); assert.equal(result.processedMedia, 4);
      assert.equal(await peerSnapshot(f), before); assert.equal(Number((await connection.query("SELECT held_bytes FROM media_storage_state WHERE id = 1"))[0].held_bytes), held - 1740);
      for (const [table, column, value] of [["users", "id", f.first], ["client_auth_state", "user_id", f.first], ["sessions", "user_id", f.first],
        ["invitations", "consumed_by_id", f.first], ["media_assets", "owner_id", f.first], ["media_storage_objects", "owner_id", f.first], ["conversations", "id", f.conv], ["messages", "conversation_id", f.conv]])
        assert.equal((await connection.query(`SELECT 1 FROM ${table} WHERE ${column} = ?`, [value])).length, 0, table);
      for (const object of f.objects) assert.equal((await readdir(mediaRoot)).some(name => name.includes(hex(object.storageKey))), false, "remove even released and reserved files");
      assert.equal((await connection.query("SELECT 1 FROM broadcast_campaigns WHERE id = ?", [f.onlyCampaign.id])).length, 0);
      for (const original of [f.sharedCampaign, f.deliveredCampaign]) {
        const row = (await connection.query("SELECT * FROM broadcast_campaigns WHERE id = ?", [original.id]))[0];
        const associated = { campaignId: row.id, adminId: admin }, payload = openPayload(row.payload_encrypted, broadcastKey, associated);
        assert.deepEqual(payload.conversationIds, [hex(f.peerConv)]); assert.deepEqual(row.client_campaign_id, original.clientCampaignId);
        assert.deepEqual(row.request_fingerprint, campaignFingerprint(payload, broadcastKey, associated)); assert.notDeepEqual(row.request_fingerprint, original.fingerprint);
      }
      assert.equal((await journal(f)).record.phase, "completed"); assert.equal((await engine().resume({ clientId: hex(f.first) })).processedMedia, 0);
    });
    await t.test("partial physical deletion retains charge and resumes without touching peer media", async () => {
      const f = await seed(), before = await peerSnapshot(f), held = Number((await connection.query("SELECT held_bytes FROM media_storage_state WHERE id = 1"))[0].held_bytes); let failed = false;
      const interrupted = engine(pool, { storage: { ...storage, async remove(value) { if (!failed) { failed = true; throw new Error("Synthetic disk failure"); } await storage.remove(value); } } });
      await assert.rejects(interrupted.resume({ clientId: hex(f.first) }));
      assert.equal(Number((await connection.query("SELECT held_bytes FROM media_storage_state WHERE id = 1"))[0].held_bytes), held);
      assert.equal((await connection.query("SELECT status, password_hash FROM users WHERE id = ?", [f.first]))[0].status, "deleted");
      assert.equal((await connection.query("SELECT password_hash FROM users WHERE id = ?", [f.first]))[0].password_hash, null);
      assert.equal((await journal(f)).record.phase, "prepared"); assert.equal((await engine().resume({ clientId: hex(f.first) })).completed, true);
      assert.equal(await peerSnapshot(f), before);
    });
    for (const phase of ["prepare", "release", "finish"]) await t.test(`real SQL ${phase} commit with a lost acknowledgement stops and resumes idempotently`, async () => {
      const f = await seed(); let injected = false;
      const ambiguousPool = { async getConnection() {
        const c = await pool.getConnection(); let match = false;
        return { ...c, async query(sql, args) {
          if (phase === "prepare" && /^UPDATE users SET status = 'deleted'/i.test(sql.trim())
            || phase === "release" && /^UPDATE media_storage_state SET held_bytes = held_bytes -/i.test(sql.trim())
            || phase === "finish" && /^DELETE FROM users/i.test(sql.trim())) match = true;
          return c.query(sql, args);
        }, async commit() { await c.commit(); if (match && !injected) { injected = true; throw new Error("Synthetic committed but acknowledgement lost"); } } };
      } };
      await assert.rejects(engine(ambiguousPool).resume({ clientId: hex(f.first) })); assert.equal(injected, true);
      if (phase === "prepare") { assert.equal((await journal(f)).record.phase, "requested"); for (const object of f.objects) assert.ok((await readdir(mediaRoot)).some(name => name.includes(hex(object.storageKey)))); }
      if (phase === "finish") {
        assert.equal((await connection.query("SELECT 1 FROM users WHERE id = ?", [f.first])).length, 0);
        const discovered = await readErasureJournalBatch({ directory: journalRoot, key: journalKey,
          binding: { database: options.database, rootFingerprint: hex(rootFingerprint) } });
        assert.equal(discovered.jobs.find(x => x.clientId === hex(f.first))?.phase, "files_erased");
      }
      assert.equal((await engine().resume({ clientId: hex(f.first) })).completed, true);
    });
    await t.test("an administrator target or nonexistent subject cannot create a destructive intent", async () => {
      const before = await databaseHash(); await assert.rejects(engine().resume({ clientId: hex(admin) }), { code: "ERASURE_TARGET" });
      await assert.rejects(engine().resume({ clientId: hex(id()) }), { code: "ERASURE_NOT_FOUND" }); assert.equal(await databaseHash(), before);
    });
    await t.test("an unrelated message author is a blocker, not a reason to erase peer content", async () => {
      const f = await seed(); await connection.query("UPDATE messages SET sender_id = ? WHERE id = ?", [f.peer, f.ownMessage]);
      const before = await databaseHash(); await assert.rejects(engine().resume({ clientId: hex(f.first) }), { code: "ERASURE_BINDINGS" }); assert.equal(await databaseHash(), before);
      await connection.query("UPDATE messages SET sender_id = ? WHERE id = ?", [f.first, f.ownMessage]);
    });
    await t.test("a client-owned photo linked outside its conversation cannot be erased", async () => {
      const f = await seed(), sequence = Number((await connection.query("SELECT MAX(sequence_no) AS n FROM messages WHERE conversation_id = ?", [f.peerConv]))[0].n) + 1;
      const mid = await message(f.peerConv, f.peer, "client", sequence, f.own), before = await databaseHash();
      await assert.rejects(engine().resume({ clientId: hex(f.first) }), { code: "ERASURE_BINDINGS" }); assert.equal(await databaseHash(), before);
      await connection.query("DELETE FROM message_media WHERE message_id = ?", [mid]);
    });
    await t.test("a media journal handle mismatch is rejected before any unlink", async () => {
      const f = await seed(); await connection.query("UPDATE media_storage_objects SET storage_key = ? WHERE id = ?", [randomBytes(32), f.own.id]);
      const before = await databaseHash(); await assert.rejects(engine().resume({ clientId: hex(f.first) }), { code: "ERASURE_BINDINGS" }); assert.equal(await databaseHash(), before);
      await connection.query("UPDATE media_storage_objects SET storage_key = ? WHERE id = ?", [f.own.storageKey, f.own.id]);
    });
    await t.test("a corrupted shared audience rolls back the complete SQL phase", async () => {
      const f = await seed(), row = (await connection.query("SELECT payload_encrypted FROM broadcast_campaigns WHERE id = ?", [f.sharedCampaign.id]))[0];
      await connection.query("UPDATE broadcast_campaigns SET payload_encrypted = 'corrupt' WHERE id = ?", [f.sharedCampaign.id]);
      const before = await databaseHash(); await assert.rejects(engine().resume({ clientId: hex(f.first) })); assert.equal(await databaseHash(), before);
      assert.equal((await journal(f)).record.phase, "requested"); await connection.query("UPDATE broadcast_campaigns SET payload_encrypted = ? WHERE id = ?", [row.payload_encrypted, f.sharedCampaign.id]);
    });
    await t.test("database advisory exclusion serializes two erasers without pretending to stop producers", async () => {
      const f = await seed(), store = createErasureStore({ pool, database: options.database, capacity, broadcastKey });
      let release, entered; const gate = new Promise(resolve => release = resolve), started = new Promise(resolve => entered = resolve);
      const first = store.withLease(hex(f.first), async () => { entered(); await gate; }); await started;
      try { await assert.rejects(store.withLease(hex(f.peer), async () => {}), { code: "ERASURE_BUSY" }); } finally { release(); await first; }
    });
    await t.test("a lost GET_LOCK acknowledgement releases the acquired lock before returning the connection", async () => {
      const f = await seed(); let injected = false;
      const ambiguousPool = { async getConnection() {
        const c = await pool.getConnection(); return { ...c, async query(sql, args) {
          const result = await c.query(sql, args);
          if (sql.startsWith("SELECT GET_LOCK") && !injected) { injected = true; throw new Error("Synthetic acquired lock acknowledgement lost"); }
          return result;
        } };
      } };
      await assert.rejects(engine(ambiguousPool).resume({ clientId: hex(f.first) })); assert.equal((await journal(f)).record, null);
      assert.equal((await engine().resume({ clientId: hex(f.first) })).completed, true);
    });
    await t.test("an unknown table or missing foreign-key dependency blocks erasure before mutation", async () => {
      const f = await seed(); await connection.query("CREATE TABLE erasure_unknown_fixture (id INT PRIMARY KEY) ENGINE=InnoDB");
      try { await assert.rejects(engine().resume({ clientId: hex(f.first) }), { code: "ERASURE_SCHEMA" }); } finally { await connection.query("DROP TABLE erasure_unknown_fixture"); }
      await connection.query("ALTER TABLE chat_receipts DROP FOREIGN KEY chat_receipts_user_fk");
      try { await assert.rejects(engine().resume({ clientId: hex(f.first) }), { code: "ERASURE_SCHEMA" }); }
      finally { await connection.query("ALTER TABLE chat_receipts ADD CONSTRAINT chat_receipts_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON UPDATE RESTRICT ON DELETE RESTRICT"); }
      assert.equal((await journal(f)).record, null);
    });
    await t.test("the preserved completion receipt blocks a restored client until an explicit restore reconciliation", async () => {
      const f = await seed(); await engine().resume({ clientId: hex(f.first) });
      await connection.query("INSERT INTO users (id, role, status, pseudonym, email, created_at, updated_at) VALUES (?, 'client', 'pending', 'Restored fixture', ?, ?, ?)", [f.first, `${hex(f.first)}-restored@example.invalid`, created, created]);
      await assert.rejects(engine().resume({ clientId: hex(f.first) }), { code: "ERASURE_RESTORE_REPLAY_REQUIRED" });
      assert.equal((await journal(f)).record.phase, "completed"); await connection.query("DELETE FROM users WHERE id = ?", [f.first]);
    });
    // Encrypted receipt files contain no private names, message bodies, SMTP or Push data.
    for (const filename of await readdir(journalRoot)) assert.equal((await readFile(path.join(journalRoot, filename), "utf8")).includes("Synthetic internal note"), false);
  } finally { if (pool) await pool.end(); try { await cleanup(); } finally { await connection.end(); } }
});
