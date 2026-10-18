import test from "node:test";
import assert from "node:assert/strict";
import { BackupRecoveryStoreError, createBackupRecoveryStore } from "../server/backup/recovery-store.mjs";

const now = Date.UTC(2026, 9, 15, 12, 1), createdAt = "2026-10-15 12:00:00.123456";
const date = (value) => new Date(value).toISOString().replace("T", " ").replace("Z", "000");
const copy = (value) => Buffer.isBuffer(value) ? Buffer.from(value) : Array.isArray(value) ? value.map(copy)
  : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([key, child]) => [key, copy(child)])) : value;
const code = (expected) => (error) => error instanceof BackupRecoveryStoreError && error.code === expected && error.cause === undefined;

function fixture() {
  const candidate = { id: "11".repeat(16), owner_id: "22".repeat(16), owner_role: "client", storage_key: "33".repeat(32),
    content_digest: "44".repeat(32), full_bytes: 1000, thumbnail_bytes: 100, stored_bytes: 1180, asset_id: null, created_at: createdAt, state: "reserved" };
  const sourceFingerprint = Buffer.alloc(32, 5), targetFingerprint = Buffer.alloc(32, 6), targetDatabaseName = "jessiemessage_test_restore";
  const object = { ...candidate, id: Buffer.from(candidate.id, "hex"), owner_id: Buffer.from(candidate.owner_id, "hex"),
    storage_key: Buffer.from(candidate.storage_key, "hex"), content_digest: Buffer.from(candidate.content_digest, "hex"),
    updated_at: createdAt, released_at: null };
  const state = { database: targetDatabaseName, global: { owner_bytes: 10000, total_bytes: 50000, held_bytes: 1180,
    root_fingerprint: Buffer.from(sourceFingerprint), initialized_at: date(now - 86400000) }, objects: [object], assets: [],
    sumOverride: undefined, queryError: null, badAck: null, commitAckLost: false, acquireError: false, beginError: false, rollbackError: false,
    acquired: 0, released: 0, begun: 0, commits: 0, rollbacks: 0, mutations: 0, queries: [] };
  let checkpoint = null;
  const connection = {
    async beginTransaction() { state.begun++; if (state.beginError) throw new Error("private begin details"); checkpoint = copy({ global: state.global, objects: state.objects }); },
    async commit() { state.commits++; checkpoint = null; if (state.commitAckLost) { state.commitAckLost = false; throw new Error("private lost commit acknowledgement"); } },
    async rollback() { state.rollbacks++; if (checkpoint) { state.global = checkpoint.global; state.objects = checkpoint.objects; checkpoint = null; } if (state.rollbackError) throw new Error("private rollback details"); },
    release() { state.released++; },
    async query(source, parameters = []) {
      const sql = source.replace(/\s+/g, " ").trim(); state.queries.push(sql);
      if (state.queryError?.(sql)) throw new Error("private SQL storage_key=secret root=secret");
      if (sql === "SELECT DATABASE() AS name") return [{ name: state.database }];
      if (sql.startsWith("SELECT owner_bytes")) return state.global ? [copy(state.global)] : [];
      if (sql.startsWith("SELECT COALESCE(SUM(stored_bytes)")) return [{ value: state.sumOverride ?? state.objects.filter((row) => row.state !== "released").reduce((total, row) => total + Number(row.stored_bytes), 0) }];
      if (sql.startsWith("SELECT id FROM media_storage_objects WHERE state")) return state.objects.filter((row) => ["reserved", "cleanup_pending"].includes(row.state)).slice(0, 1).map((row) => ({ id: row.id }));
      if (sql.startsWith("SELECT id, owner_id") && sql.includes("FROM media_storage_objects")) return state.objects.filter((row) => row.id.equals(parameters[0])).map(copy);
      if (sql.includes("FROM media_assets")) return state.assets.filter((row) => row.id.equals(parameters[0]) || row.storage_key.equals(parameters[1])).slice(0, 2).map(copy);
      if (!sql.startsWith("UPDATE ")) throw new Error("Unexpected synthetic query");
      state.mutations++;
      if (state.badAck?.(sql)) return { affectedRows: 0 };
      if (sql.startsWith("UPDATE media_storage_objects SET state = 'cleanup_pending'")) {
        const row = state.objects.find((item) => item.id.equals(parameters[1]) && item.storage_key.equals(parameters[2]) && item.state === "reserved");
        if (!row) return { affectedRows: 0 }; row.state = "cleanup_pending"; row.updated_at = parameters[0];
      } else if (sql.startsWith("UPDATE media_storage_objects SET state = 'released'")) {
        const row = state.objects.find((item) => item.id.equals(parameters[2]) && item.storage_key.equals(parameters[3]) && item.state === "cleanup_pending");
        if (!row) return { affectedRows: 0 }; row.state = "released"; row.updated_at = parameters[0]; row.released_at = parameters[1];
      } else if (sql.startsWith("UPDATE media_storage_state SET held_bytes")) {
        if (!state.global.root_fingerprint.equals(parameters[1]) || state.global.held_bytes !== parameters[2]) return { affectedRows: 0 };
        state.global.held_bytes -= parameters[0];
      } else if (sql.startsWith("UPDATE media_storage_state SET root_fingerprint")) {
        if (!state.global.root_fingerprint.equals(parameters[1]) || state.global.held_bytes !== parameters[2]
          || state.global.owner_bytes !== parameters[3] || state.global.total_bytes !== parameters[4]) return { affectedRows: 0 };
        state.global.root_fingerprint = Buffer.from(parameters[0]);
      } else throw new Error("Unexpected synthetic update");
      return { affectedRows: 1 };
    },
  };
  const pool = { async getConnection() { state.acquired++; if (state.acquireError) throw new Error("private credentials and database location"); return connection; } };
  const store = createBackupRecoveryStore({ pool });
  const command = (patch = {}) => ({ candidate: copy(candidate), sourceFingerprint: Buffer.from(sourceFingerprint), targetDatabaseName, now, ...patch });
  const rebind = (patch = {}) => ({ sourceFingerprint: Buffer.from(sourceFingerprint), targetFingerprint: Buffer.from(targetFingerprint), targetDatabaseName,
    capacity: { ownerBytes: 10000, totalBytes: 50000 }, expectedHeldBytes: 0, now, ...patch });
  function tombstone() {
    state.objects[0].state = "cleanup_pending"; state.objects[0].asset_id = Buffer.from(object.id);
    candidate.state = "cleanup_pending"; candidate.asset_id = candidate.id;
    state.assets = [{ ...copy(state.objects[0]), created_at: date(now - 2000), active_digest: null, deleted_at: date(now - 1000) }];
  }
  return { store, state, candidate, command, rebind, tombstone, sourceFingerprint, targetFingerprint };
}

test("offline recovery requires canonical signed candidates, explicit targets, safe clocks and 32-byte bindings before SQL", async () => {
  assert.throws(() => createBackupRecoveryStore({}), code("BACKUP_RECOVERY_INPUT"));
  const f = fixture();
  const invalid = [
    { candidate: { ...f.candidate, id: "A".repeat(32) } }, { candidate: { ...f.candidate, id: "1".repeat(31) + "\n" } },
    { candidate: { ...f.candidate, storage_key: "3".repeat(63) + "\n" } }, { candidate: { ...f.candidate, full_bytes: 0 } },
    { candidate: { ...f.candidate, stored_bytes: 1181 } }, { candidate: { ...f.candidate, state: "registered" } },
    { candidate: { ...f.candidate, asset_id: f.candidate.id } }, { candidate: { ...f.candidate, created_at: "2026-02-30 12:00:00.123456" } },
    { candidate: { ...f.candidate, created_at: createdAt + "\n" } }, { candidate: { ...f.candidate, updated_at: createdAt } },
    { sourceFingerprint: "55".repeat(32) }, { sourceFingerprint: Buffer.alloc(31) }, { targetDatabaseName: "restore;DROP" },
    { targetDatabaseName: "restore\n" }, { targetDatabaseName: "x".repeat(65) }, { now: NaN }, { now: -1 }, { now: 1.5 }, { now: 253402300800000 },
  ];
  for (const patch of invalid) for (const method of ["closeCandidate", "releaseCandidate"]) await assert.rejects(f.store[method](f.command(patch)), code("BACKUP_RECOVERY_INPUT"));
  for (const patch of [{ capacity: { ownerBytes: 1, totalBytes: 0 } }, { expectedHeldBytes: -1 }, { targetFingerprint: Buffer.alloc(33) }, { capacity: { ownerBytes: 10000, totalBytes: 50000, extra: true } }]) {
    await assert.rejects(f.store.rebind(f.rebind(patch)), code("BACKUP_RECOVERY_INPUT"));
  }
  assert.equal(f.state.acquired, 0); assert.equal(f.state.mutations, 0);
});

test("closing a signed reservation acknowledges cleanup without refund and repeats safely", async () => {
  const f = fixture();
  assert.deepEqual(await f.store.closeCandidate(f.command()), { closed: true, state: "cleanup_pending" });
  assert.equal(f.state.objects[0].state, "cleanup_pending"); assert.equal(f.state.global.held_bytes, 1180);
  assert.equal(f.state.objects[0].created_at, createdAt); assert.equal(f.state.objects[0].updated_at, date(now));
  assert.deepEqual(await f.store.closeCandidate(f.command()), { closed: true, state: "cleanup_pending" });
  assert.equal(f.state.mutations, 1); assert.equal(f.state.commits, 2); assert.equal(f.state.released, 2);
});

test("release refuses an unclosed reservation and refunds a confirmed cleanup exactly once", async () => {
  const f = fixture();
  await assert.rejects(f.store.releaseCandidate(f.command()), code("BACKUP_RECOVERY_STATE"));
  assert.equal(f.state.global.held_bytes, 1180); assert.equal(f.state.mutations, 0);
  await f.store.closeCandidate(f.command());
  assert.deepEqual(await f.store.releaseCandidate(f.command()), { released: true });
  assert.equal(f.state.global.held_bytes, 0); assert.equal(f.state.objects[0].state, "released");
  assert.equal(f.state.objects[0].released_at, date(now));
  const mutations = f.state.mutations;
  assert.deepEqual(await f.store.releaseCandidate(f.command()), { released: true });
  assert.deepEqual(await f.store.closeCandidate(f.command()), { closed: true, state: "released" });
  assert.equal(f.state.global.held_bytes, 0); assert.equal(f.state.mutations, mutations);
});

test("journal immutable comparisons reject altered ids, owners, roles, keys, digests, sizes and microseconds", async () => {
  for (const patch of [{ id: "aa".repeat(16) }, { owner_id: "aa".repeat(16) }, { owner_role: "admin" }, { storage_key: "aa".repeat(32) },
    { content_digest: "aa".repeat(32) }, { full_bytes: 1001, stored_bytes: 1181 }, { thumbnail_bytes: 101, stored_bytes: 1181 },
    { created_at: "2026-10-15 12:00:00.123457" }, { state: "cleanup_pending" }]) {
    const f = fixture();
    await assert.rejects(f.store.closeCandidate(f.command({ candidate: { ...f.candidate, ...patch } })), code("BACKUP_RECOVERY_STATE"));
    assert.equal(f.state.objects[0].state, "reserved"); assert.equal(f.state.global.held_bytes, 1180); assert.equal(f.state.mutations, 0);
    assert.equal(f.state.rollbacks, 1); assert.equal(f.state.released, 1);
  }
});

test("database, root binding and exact safe-integer accounting are checked before every recovery mutation", async () => {
  const alterations = [
    (f) => { f.state.database = "a_different_database"; }, (f) => { f.state.global = null; },
    (f) => { f.state.global.root_fingerprint = Buffer.alloc(32, 99); }, (f) => { f.state.global.held_bytes = 1179; },
    (f) => { f.state.sumOverride = "9007199254740992"; }, (f) => { f.state.sumOverride = "1180\n"; },
    (f) => { f.state.global.held_bytes = true; }, (f) => { f.state.global.initialized_at = date(now + 1); },
    (f) => { f.state.objects[0].updated_at = "2026-10-15 12:01:00.000001"; },
    (f) => { f.state.objects[0].state = "registered"; },
  ];
  for (const alter of alterations) for (const operation of ["closeCandidate", "releaseCandidate", "rebind"]) {
    const f = fixture(); alter(f);
    await assert.rejects(f.store[operation](operation === "rebind" ? f.rebind() : f.command()), code("BACKUP_RECOVERY_STATE"));
    assert.equal(f.state.mutations, 0); assert.equal(f.state.rollbacks, 1); assert.equal(f.state.released, 1);
  }
});

test("an unlinked candidate cannot close while any asset occupies its proposed id or storage key", async () => {
  for (const matching of ["id", "storage_key"]) {
    const f = fixture(), row = copy(f.state.objects[0]); row.deleted_at = null;
    if (matching === "id") row.storage_key = Buffer.alloc(32, 77); else row.id = Buffer.alloc(16, 77);
    f.state.assets = [row];
    await assert.rejects(f.store.closeCandidate(f.command()), code("BACKUP_RECOVERY_STATE"));
    assert.equal(f.state.mutations, 0); assert.equal(f.state.global.held_bytes, 1180);
  }
});

test("linked cleanup requires the exact historical tombstone and refuses active or altered assets", async () => {
  const valid = fixture(); valid.tombstone();
  assert.ok(valid.state.objects[0].created_at < valid.state.assets[0].created_at);
  assert.ok(valid.state.assets[0].created_at < valid.state.assets[0].deleted_at);
  assert.deepEqual(await valid.store.closeCandidate(valid.command()), { closed: true, state: "cleanup_pending" });
  assert.deepEqual(await valid.store.releaseCandidate(valid.command()), { released: true });
  assert.equal(valid.state.global.held_bytes, 0);
  for (const change of [
    (row) => { row.deleted_at = null; }, (row) => { row.active_digest = Buffer.alloc(32, 8); },
    (row) => { row.deleted_at = "2026-10-15 12:01:00.000001"; }, (row) => { row.owner_id = Buffer.alloc(16, 8); },
    (row) => { row.content_digest = Buffer.alloc(32, 8); }, (row) => { row.full_bytes = 999; },
    (row) => { row.created_at = "2026-10-15 12:00:00.123455"; },
    (row) => { row.created_at = date(now - 500); },
  ]) {
    const f = fixture(); f.tombstone(); change(f.state.assets[0]);
    await assert.rejects(f.store.closeCandidate(f.command()), code("BACKUP_RECOVERY_STATE"));
    assert.equal(f.state.mutations, 0); assert.equal(f.state.global.held_bytes, 1180);
  }
});

test("a failed counter update rolls back the release transition and leaves its full charge for retry", async () => {
  const f = fixture(); await f.store.closeCandidate(f.command());
  f.state.queryError = (sql) => sql.startsWith("UPDATE media_storage_state SET held_bytes");
  await assert.rejects(f.store.releaseCandidate(f.command()), code("BACKUP_RECOVERY_DATABASE"));
  assert.equal(f.state.objects[0].state, "cleanup_pending"); assert.equal(f.state.objects[0].released_at, null); assert.equal(f.state.global.held_bytes, 1180);
  f.state.queryError = null;
  assert.deepEqual(await f.store.releaseCandidate(f.command()), { released: true }); assert.equal(f.state.global.held_bytes, 0);
});

test("missing compare-and-set acknowledgements roll back close, release and rebind", async () => {
  for (const operation of ["closeCandidate", "releaseCandidate", "rebind"]) {
    const f = fixture();
    if (operation !== "closeCandidate") await f.store.closeCandidate(f.command());
    if (operation === "rebind") await f.store.releaseCandidate(f.command());
    const before = copy({ objects: f.state.objects, global: f.state.global });
    f.state.badAck = () => true;
    await assert.rejects(f.store[operation](operation === "rebind" ? f.rebind() : f.command()), code("BACKUP_RECOVERY_STATE"));
    assert.deepEqual(f.state.objects, before.objects); assert.deepEqual(f.state.global, before.global);
  }
});

test("lost commit acknowledgements can resume closed and released candidates without a second refund", async () => {
  const f = fixture(); f.state.commitAckLost = true;
  await assert.rejects(f.store.closeCandidate(f.command()), code("BACKUP_RECOVERY_DATABASE"));
  assert.equal(f.state.objects[0].state, "cleanup_pending"); assert.equal(f.state.global.held_bytes, 1180);
  assert.deepEqual(await f.store.closeCandidate(f.command()), { closed: true, state: "cleanup_pending" });
  f.state.commitAckLost = true;
  await assert.rejects(f.store.releaseCandidate(f.command()), code("BACKUP_RECOVERY_DATABASE"));
  assert.equal(f.state.objects[0].state, "released"); assert.equal(f.state.global.held_bytes, 0);
  assert.deepEqual(await f.store.releaseCandidate(f.command()), { released: true }); assert.equal(f.state.global.held_bytes, 0);
});

test("rebind requires no unfinished allocation, exact limits and expected held bytes", async () => {
  const pending = fixture();
  await assert.rejects(pending.store.rebind(pending.rebind({ expectedHeldBytes: 1180 })), code("BACKUP_RECOVERY_STATE"));
  await pending.store.closeCandidate(pending.command());
  await assert.rejects(pending.store.rebind(pending.rebind({ expectedHeldBytes: 1180 })), code("BACKUP_RECOVERY_STATE"));
  for (const patch of [{ expectedHeldBytes: 1 }, { capacity: { ownerBytes: 9999, totalBytes: 50000 } },
    { capacity: { ownerBytes: 10000, totalBytes: 50001 } }, { sourceFingerprint: Buffer.alloc(32, 99) }]) {
    const f = fixture(); await f.store.closeCandidate(f.command()); await f.store.releaseCandidate(f.command());
    await assert.rejects(f.store.rebind(f.rebind(patch)), code("BACKUP_RECOVERY_STATE"));
    assert.deepEqual(f.state.global.root_fingerprint, f.sourceFingerprint);
  }
});

test("root rebind resumes after a lost acknowledgement and never changes quotas or counters", async () => {
  const f = fixture(); await f.store.closeCandidate(f.command()); await f.store.releaseCandidate(f.command());
  f.state.commitAckLost = true;
  await assert.rejects(f.store.rebind(f.rebind()), code("BACKUP_RECOVERY_DATABASE"));
  assert.deepEqual(f.state.global.root_fingerprint, f.targetFingerprint); assert.equal(f.state.global.held_bytes, 0);
  const mutations = f.state.mutations;
  assert.deepEqual(await f.store.rebind(f.rebind()), { rebound: true }); assert.equal(f.state.mutations, mutations);
  assert.equal(f.state.global.owner_bytes, 10000); assert.equal(f.state.global.total_bytes, 50000);
});

test("rebind preserves registered media and their nonzero capacity charge", async () => {
  const f = fixture(); f.state.objects[0].state = "registered"; f.state.objects[0].asset_id = Buffer.from(f.state.objects[0].id);
  f.state.assets = [{ ...copy(f.state.objects[0]), active_digest: Buffer.from(f.state.objects[0].content_digest), deleted_at: null }];
  const objects = copy(f.state.objects), assets = copy(f.state.assets);
  assert.deepEqual(await f.store.rebind(f.rebind({ expectedHeldBytes: 1180 })), { rebound: true });
  assert.equal(f.state.global.held_bytes, 1180); assert.deepEqual(f.state.objects, objects); assert.deepEqual(f.state.assets, assets);
});

test("private driver, acquisition and rollback errors stay neutral and every acquired connection is released", async () => {
  for (const mode of ["acquire", "begin", "query", "rollback"]) {
    const f = fixture();
    if (mode === "acquire") f.state.acquireError = true;
    else if (mode === "begin") f.state.beginError = true;
    else { f.state.queryError = () => true; f.state.rollbackError = mode === "rollback"; }
    await assert.rejects(f.store.closeCandidate(f.command()), (error) => {
      assert.ok(code("BACKUP_RECOVERY_DATABASE")(error));
      for (const secret of ["private", "credentials", "SQL", "storage_key", "root="]) assert.equal(error.message.includes(secret), false);
      return true;
    });
    assert.equal(f.state.released, mode === "acquire" ? 0 : 1); assert.equal(f.state.mutations, 0);
  }
});
