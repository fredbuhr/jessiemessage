import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { databaseOptions, connectDatabase } from "../server/db/connection.mjs";
import { applyMigrations, createdMigrationTables, loadMigrations } from "../server/db/migrations.mjs";
import { createRuntimePool } from "../server/db/runtime.mjs";
import { createMediaStorage } from "../server/media/storage.mjs";
import { createErasureStore } from "../server/data/erasure-store.mjs";
import { createErasureJournal, readErasureJournalBatch } from "../server/data/erasure-journal.mjs";
import { createClosureService, createClosureTargets } from "../server/data/closure-service.mjs";
import { createLocalClosureOperations } from "../server/data/closure-operations.mjs";
import { createApplicationInspectionPool, assertApplicationTableInspection } from "../server/backup/application-scope.mjs";
import { runManagedClosures, resumeManagedLocalClosureRuntime } from "../server/backup/managed-closures.mjs";
import { acquireRecurringLock } from "../server/backup/recurring-checkpoint-files.mjs";
import { consumeSyntheticInvitation } from "./fixtures/manual-admission.mjs";
import { erasureDirectory } from "./fixtures/erasure-files.mjs";
import { managedClosureFixture } from "./fixtures/managed-closure-runtime.mjs";

const enabled = process.env.JESSIEMESSAGE_DB_TEST === "1";
const id = () => randomBytes(16), hex = value => value.toString("hex");
const now = Date.parse("2026-10-19T20:00:00Z");
const sqlDate = value => new Date(value).toISOString().replace("T", " ").replace("Z", "000");
const created = sqlDate(now - 60000), expiry = sqlDate(now + 600000);
const serialize = rows => rows.map(row => JSON.stringify(row, (_key, value) => typeof value === "bigint" ? value.toString() : value)).sort();

test("local closures drain the real managed process and preserve durable SQL/photo absence without a PC (disposable MariaDB only)", {
  skip: enabled ? false : "Set JESSIEMESSAGE_DB_TEST=1 with explicit loopback disposable credentials.", timeout: 120000,
}, async t => {
  const options = databaseOptions();
  assert.ok(["127.0.0.1", "::1", "localhost"].includes(options.host));
  assert.match(options.database, /^jessiemessage_test(?:_[a-z0-9]+)*$/);
  assert.ok(process.env.JESSIEMESSAGE_RUNTIME_DB_USER && process.env.JESSIEMESSAGE_RUNTIME_DB_PASSWORD);
  const migrations = await loadMigrations(), allowed = [...createdMigrationTables(migrations).reverse(), "migration_probe", "schema_migrations"];
  let pool, inspector;
  const directory = await erasureDirectory(t), mediaRoot = path.join(directory, "media"), journalRoot = path.join(directory, "journal");
  await mkdir(mediaRoot, { mode: 0o700 }); await mkdir(journalRoot, { mode: 0o700 });
  const storage = await createMediaStorage({ root: mediaRoot, key: Buffer.alloc(32, 6), pathMode: "linux-dirfd" });
  const rootFingerprint = await storage.fingerprint(), journalKey = Buffer.alloc(32, 7);
  const capacity = { ownerBytes: 1048576, totalBytes: 104857600, rootFingerprint };
  let store;
  const journalFor = clientId => createErasureJournal({ directory: journalRoot, key: journalKey, binding: store.binding, clientId });
  const batch = page => readErasureJournalBatch({ directory: journalRoot, key: journalKey, binding: store.binding, ...page });
  async function cleanup() {
    const tables = await connection.query("SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?", [options.database]);
    assert.ok(tables.every(row => allowed.includes(row.name)), "Refuse unrelated schema cleanup");
    for (const table of allowed) await connection.query(`DROP TABLE IF EXISTS ${table}`);
  }
  async function databaseSnapshot() {
    const rows = [];
    for (const table of allowed.filter(name => name !== "migration_probe")) rows.push([table, serialize(await connection.query(`SELECT * FROM ${table}`))]);
    return JSON.stringify(rows);
  }
  async function user(role) {
    const uid = id();
    await connection.query(`INSERT INTO users (id, role, status, pseudonym, email, password_hash, email_verified_at, age_assured_at,
      access_approved_at, created_at, updated_at) VALUES (?, ?, 'active', ?, ?, 'synthetic-password-hash', ?, ?, ?, ?, ?)`,
    [uid, role, `Synthetic ${hex(uid)}`, `${hex(uid)}@example.invalid`, created, created, created, created, created]);
    if (role === "client") {
      await connection.query("INSERT INTO client_auth_state (user_id, age_declared_at) VALUES (?, ?)", [uid, created]);
      await consumeSyntheticInvitation(connection, uid, now - 60000);
    }
    return uid;
  }
  async function session(uid, role) {
    const sid = id();
    await connection.query("INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)", [sid, uid, randomBytes(32), created, expiry]);
    if (role === "client") await connection.query("INSERT INTO client_session_state (session_id, last_seen_at, credential_version) VALUES (?, ?, 1)", [sid, created]);
    return sid;
  }
  async function asset(uid, role) {
    const aid = id(), storageKey = randomBytes(32), full = Buffer.concat(Array.from({ length: 25 }, () => aid)), thumbnail = Buffer.alloc(100, aid[0]);
    const digest = createHash("sha256").update(full).digest();
    await storage.put({ assetId: aid, storageKey, full, thumbnail });
    await connection.query(`INSERT INTO media_assets (id, owner_id, owner_role, storage_key, content_digest, active_digest,
      width, height, thumbnail_width, thumbnail_height, full_bytes, thumbnail_bytes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 100, 80, 50, 40, 400, 100, ?)`, [aid, uid, role, storageKey, digest, digest, created]);
    await connection.query(`INSERT INTO media_storage_objects (id, owner_id, owner_role, storage_key, content_digest, full_bytes, thumbnail_bytes,
      stored_bytes, state, asset_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 400, 100, 580, 'registered', ?, ?, ?)`,
    [aid, uid, role, storageKey, digest, aid, created, created]);
    await connection.query("UPDATE media_storage_state SET held_bytes = held_bytes + 580 WHERE id = 1");
    return { id: aid, storageKey, full, thumbnail };
  }
  async function message(conversationId, uid, role, sequence, photo) {
    const mid = id();
    await connection.query(`INSERT INTO messages (id, conversation_id, sequence_no, sender_id, sender_role, client_message_id, body_encrypted, body_fingerprint, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'synthetic-ciphertext-not-exported', ?, ?)`, [mid, conversationId, sequence, uid, role, id(), randomBytes(32), created]);
    await connection.query("INSERT INTO chat_events (conversation_id, event_sequence, message_id, kind, occurred_at) VALUES (?, ?, ?, 'message', ?)", [conversationId, sequence, mid, created]);
    await connection.query("INSERT INTO message_media (message_id, conversation_id, media_id, created_at) VALUES (?, ?, ?, ?)", [mid, conversationId, photo.id, created]);
  }
  async function seed() {
    const admin = await user("admin"), subject = await user("client"), peer = await user("client");
    const adminSession = await session(admin, "admin"), subjectSession = await session(subject, "client"), peerSession = await session(peer, "client");
    const conv = id(), peerConv = id(), label = id();
    await connection.query("INSERT INTO conversations (id, client_id, admin_id, created_at) VALUES (?, ?, ?, ?), (?, ?, ?, ?)", [conv, subject, admin, created, peerConv, peer, admin, created]);
    const own = await asset(subject, "client"), shared = await asset(admin, "admin"), peerPhoto = await asset(peer, "client");
    await message(conv, subject, "client", 1, own); await message(conv, admin, "admin", 2, shared);
    await message(peerConv, peer, "client", 1, peerPhoto); await message(peerConv, admin, "admin", 2, shared);
    await connection.query("INSERT INTO crm_labels (id, owner_admin_id, kind, name, normalized_name, created_at, updated_at) VALUES (?, ?, 'tag', ?, ?, ?, ?)", [label, admin, hex(label), hex(label), created, created]);
    for (const [uid, conversationId] of [[subject, conv], [peer, peerConv]]) {
      await connection.query("INSERT INTO chat_receipts (conversation_id, user_id, last_read_sequence, updated_at) VALUES (?, ?, 2, ?), (?, ?, 2, ?)", [conversationId, uid, created, conversationId, admin, created]);
      await connection.query("INSERT INTO crm_profiles (admin_id, conversation_id, nickname, notes_encrypted, version, notes_revision, created_at, updated_at) VALUES (?, ?, 'Synthetic private note', 'synthetic-encrypted-note', 1, 1, ?, ?)", [admin, conversationId, created, created]);
      await connection.query("INSERT INTO crm_memberships (admin_id, conversation_id, label_id, created_at) VALUES (?, ?, ?, ?)", [admin, conversationId, label, created]);
      await connection.query("INSERT INTO broadcast_preferences (user_id, enabled, version, created_at, updated_at) VALUES (?, 1, 1, ?, ?)", [uid, created, created]);
    }
    return { admin, adminSession, subject, subjectSession, peer, peerSession, conv, peerConv, label, own, shared, peerPhoto };
  }
  async function peerSnapshot(f) {
    const groups = [];
    for (const [table, column, value] of [["users", "id", f.peer], ["users", "id", f.admin], ["sessions", "id", f.peerSession], ["sessions", "id", f.adminSession],
      ["client_auth_state", "user_id", f.peer], ["client_session_state", "session_id", f.peerSession], ["invitations", "consumed_by_id", f.peer],
      ["broadcast_preferences", "user_id", f.peer], ["media_assets", "owner_id", f.peer], ["media_storage_objects", "owner_id", f.peer],
      ["media_assets", "id", f.shared.id], ["media_storage_objects", "id", f.shared.id], ["conversations", "id", f.peerConv], ["crm_labels", "id", f.label],
      ...["messages", "chat_events", "chat_receipts", "message_media", "crm_profiles", "crm_memberships"].map(table => [table, "conversation_id", f.peerConv])])
      groups.push([table, serialize(await connection.query(`SELECT * FROM ${table} WHERE ${column} = ?`, [value]))]);
    for (const photo of [f.shared, f.peerPhoto]) for (const variant of ["full", "thumb"])
      groups.push([hex(photo.id), variant, createHash("sha256").update(await storage.get({ assetId: photo.id, storageKey: photo.storageKey, variant })).digest("hex")]);
    return JSON.stringify(groups);
  }
  async function journal(subject) {
    const file = journalFor(hex(subject));
    try { return await file.read(); } finally { file.close(); }
  }
  async function journalBytes() {
    return Promise.all((await readdir(journalRoot)).filter(name => /^erasure-[a-f0-9]{64}\.json$/.test(name)).sort()
      .map(async name => [name, (await readFile(path.join(journalRoot, name))).toString("utf8")]));
  }
  async function request(f) {
    const before = await databaseSnapshot(), service = createClosureService({ directory: journalRoot, key: journalKey, store, target: createClosureTargets(pool), clock: () => now });
    try {
      const preview = await service.preview(hex(f.subject));
      const accepted = await service.request(hex(f.subject), { confirmation: "FERMER", expectedPseudonym: preview.client.pseudonym }, async () => {});
      assert.equal(accepted.closure.phase, "requested"); assert.equal(await databaseSnapshot(), before, "Recording the confirmed intent changes no SQL row");
    } finally { service.close(); }
  }
  function operations(overrides = {}) {
    return createLocalClosureOperations({ store, storage, journalFor, batch, clock: () => now,
      async inspectApplicationSchema() {
        const c = await inspector.getConnection();
        try { await assertApplicationTableInspection(c, options.database); return { verified: true }; }
        finally { await c.release(); }
      }, ...overrides });
  }
  const run = (runtime, owner) => runManagedClosures({ runtime, operations: owner, directory: journalRoot, source: async () => {}, resumeClosures: resumeManagedLocalClosureRuntime });
  const reopen = (runtime, owner) => acquireRecurringLock(journalRoot, lease => resumeManagedLocalClosureRuntime({ runtime, operations: owner, assertReady: () => lease.assertReady() }));
  async function assertAbsent(f) {
    for (const [table, column, value] of [["users", "id", f.subject], ["client_auth_state", "user_id", f.subject], ["sessions", "user_id", f.subject],
      ["client_session_state", "session_id", f.subjectSession], ["invitations", "consumed_by_id", f.subject], ["broadcast_preferences", "user_id", f.subject],
      ["media_assets", "owner_id", f.subject], ["media_storage_objects", "owner_id", f.subject], ["conversations", "id", f.conv],
      ...["messages", "chat_events", "chat_receipts", "message_media", "crm_profiles", "crm_memberships"].map(table => [table, "conversation_id", f.conv])])
      assert.equal((await connection.query(`SELECT 1 FROM ${table} WHERE ${column} = ?`, [value])).length, 0, table);
    for (const variant of ["full", "thumb"]) assert.deepEqual(await storage.inspectEntry({ storageKey: f.own.storageKey, variant }), { exists: false });
    assert.equal((await journal(f.subject)).record.phase, "completed");
  }
  const connection = await connectDatabase();
  try {
    await cleanup(); await applyMigrations(connection, { database: options.database, migrations });
    pool = await createRuntimePool(process.env); inspector = await createApplicationInspectionPool(process.env);
    store = createErasureStore({ pool, database: options.database, capacity, broadcastKey: Buffer.alloc(32, 3) });
    await connection.query("INSERT INTO media_storage_state (id, owner_bytes, total_bytes, root_fingerprint, held_bytes, initialized_at) VALUES (1, ?, ?, ?, 0, ?)", [capacity.ownerBytes, capacity.totalBytes, rootFingerprint, created]);

    await t.test("normal closure drains requests and producers before SQL, restarts only after absence, and refuses a resurrected completed account", async step => {
      const f = await seed(), peerBefore = await peerSnapshot(f); await request(f);
      const held = Number((await connection.query("SELECT held_bytes FROM media_storage_state WHERE id = 1"))[0].held_bytes);
      const managedRoot = path.join(directory, "normal-runtime"); await mkdir(managedRoot, { mode: 0o700 });
      const managed = await managedClosureFixture(step, managedRoot); let body;
      try {
        await managed.runtime.start(); const response = await fetch(`${managed.origin}/hold`, { signal: AbortSignal.timeout(3000) }); body = response.text();
        let preparations = 0;
        const observedStore = { binding: store.binding, withLease: (clientId, work) => store.withLease(clientId, scope => work({ ...scope,
          async prepare(at) {
            assert.equal(managed.runtime.state().status, "stopped"); assert.equal(managed.children[0].exitCode, 0);
            assert.equal(await body, "starteddone");
            const events = (await readFile(managed.marker, "utf8")).trim().split("\n");
            for (const event of ["request-finished", "producer-stopped", "transport-closed", "diagnostics-closed"]) assert.ok(events.includes(event), event);
            assert.equal(events.at(-1), "pool-closed"); assert.ok((await readdir(journalRoot)).includes("recurring-backup.lock"));
            preparations++; return scope.prepare(at);
          },
        })) };
        const owner = operations({ store: observedStore });
        assert.equal(await owner.hasPending(), true); await run(managed.runtime, owner);
        assert.equal(preparations, 1); assert.equal(managed.children.length, 2); assert.equal(managed.runtime.state().status, "running");
        assert.equal(await owner.hasPending(), false); await assertAbsent(f); assert.equal(await peerSnapshot(f), peerBefore);
        assert.equal(Number((await connection.query("SELECT held_bytes FROM media_storage_state WHERE id = 1"))[0].held_bytes), held - 580);
        await managed.runtime.stop();
        const receipts = await journalBytes(), databaseBefore = await databaseSnapshot();
        const freshOwner = operations({ storage: { ...storage, async remove() { assert.fail("A completed receipt must be checked, never erased again on startup"); } } });
        await reopen(managed.runtime, freshOwner);
        assert.equal(managed.children.length, 3); assert.equal(managed.runtime.state().status, "running");
        assert.equal(await databaseSnapshot(), databaseBefore); assert.deepEqual(await journalBytes(), receipts);
        await managed.runtime.stop();
        await connection.query("INSERT INTO users (id, role, status, pseudonym, email, created_at, updated_at) VALUES (?, 'client', 'pending', 'Synthetic restored account', ?, ?, ?)",
        [f.subject, `${hex(f.subject)}-restored@example.invalid`, created, created]);
        try {
          const restoredBefore = await databaseSnapshot();
          await assert.rejects(operations().verifyStartup(async () => assert.equal(managed.runtime.state().status, "stopped")), { code: "ERASURE_RESTORE_REPLAY_REQUIRED" });
          await assert.rejects(reopen(managed.runtime, operations()), { code: "RECURRING_FILES_IO" });
          assert.equal(managed.runtime.state().status, "stopped"); assert.equal(managed.children.length, 3);
          assert.equal(await databaseSnapshot(), restoredBefore, "Startup refuses the restored identity without silently erasing it");
          assert.deepEqual(await journalBytes(), receipts); assert.equal(await peerSnapshot(f), peerBefore);
        } finally { await connection.query("DELETE FROM users WHERE id = ?", [f.subject]); }
      } finally { await body?.catch(() => {}); await managed.runtime.destroy(); }
    });

    await t.test("interruption after real photo removal retains charge and prepared intent; fresh local owner resumes once before reopening", async step => {
      const f = await seed(), peerBefore = await peerSnapshot(f); await request(f);
      const held = Number((await connection.query("SELECT held_bytes FROM media_storage_state WHERE id = 1"))[0].held_bytes);
      const managedRoot = path.join(directory, "interrupted-runtime"); await mkdir(managedRoot, { mode: 0o700 });
      const managed = await managedClosureFixture(step, managedRoot); let interrupted = false;
      try {
        await managed.runtime.start();
        const owner = operations({ storage: { ...storage, async remove(value) {
          assert.equal(managed.runtime.state().status, "stopped"); await storage.remove(value);
          if (value.storageKey.equals(f.own.storageKey) && !interrupted) { interrupted = true; throw new Error("Synthetic interruption after durable photo removal"); }
        } } });
        await assert.rejects(run(managed.runtime, owner), { code: "RECURRING_FILES_IO" });
        assert.equal(interrupted, true); assert.equal(managed.runtime.state().status, "stopped"); assert.equal(managed.children.length, 1);
        const prepared = await journal(f.subject); assert.equal(prepared.record.phase, "prepared"); assert.equal(prepared.record.cursor, null);
        assert.equal((await connection.query("SELECT status FROM users WHERE id = ?", [f.subject]))[0].status, "deleted");
        assert.equal((await connection.query("SELECT state FROM media_storage_objects WHERE id = ?", [f.own.id]))[0].state, "cleanup_pending");
        assert.equal(Number((await connection.query("SELECT held_bytes FROM media_storage_state WHERE id = 1"))[0].held_bytes), held);
        for (const variant of ["full", "thumb"]) assert.deepEqual(await storage.inspectEntry({ storageKey: f.own.storageKey, variant }), { exists: false });
        const pendingBytes = await journalBytes(), pendingDatabase = await databaseSnapshot();
        await assert.rejects(operations().verifyStartup(async () => assert.equal(managed.runtime.state().status, "stopped")), { code: "ERASURE_PENDING" });
        await assert.rejects(reopen(managed.runtime, operations()), { code: "RECURRING_FILES_IO" });
        assert.equal(managed.runtime.state().status, "stopped"); assert.equal(managed.children.length, 1);
        assert.deepEqual(await journalBytes(), pendingBytes); assert.equal(await databaseSnapshot(), pendingDatabase);
        await run(managed.runtime, operations());
        assert.equal(managed.runtime.state().status, "running"); assert.equal(managed.children.length, 2);
        await assertAbsent(f); assert.equal(await peerSnapshot(f), peerBefore);
        assert.equal(Number((await connection.query("SELECT held_bytes FROM media_storage_state WHERE id = 1"))[0].held_bytes), held - 580);
      } finally { await managed.runtime.destroy(); }
    });
    const page = await batch({ afterName: null, limit: 100 });
    assert.equal(page.jobs.length, 2); assert.ok(page.jobs.every(job => job.phase === "completed"));
    for (const [, bytes] of await journalBytes()) {
      assert.equal(bytes.includes("Synthetic"), false); assert.equal(bytes.includes("example.invalid"), false);
    }
  } finally {
    await inspector?.end(); await pool?.end();
    try { await cleanup(); } finally { await connection.end(); }
    journalKey.fill(0);
  }
});
