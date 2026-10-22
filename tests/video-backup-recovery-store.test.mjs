import test from "node:test";
import assert from "node:assert/strict";
import { createVideoBackupRecoveryStore, BackupRecoveryStoreError } from "../server/backup/recovery-store.mjs";

const now = Date.UTC(2026, 9, 22), at = "2026-10-21 00:00:00.000000";
const clone = value => Buffer.isBuffer(value) ? Buffer.from(value) : Array.isArray(value) ? value.map(clone)
  : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([name, child]) => [name, clone(child)])) : value;
const refused = error => error instanceof BackupRecoveryStoreError && /^BACKUP_RECOVERY_[A-Z]+$/.test(error.code);
function fixture() {
  const candidate = { id: "11".repeat(16), owner_id: "22".repeat(16), owner_role: "admin", storage_key: "33".repeat(32),
    reserve_token_hash: "44".repeat(32), content_digest: null, bytes: 1000, stored_bytes: 1064, mime: "video/mp4", state: "reserved", created_at: at };
  const sourceFingerprint = Buffer.alloc(32, 5), targetFingerprint = Buffer.alloc(32, 6), targetDatabaseName = "jessiemessage_test_video_restore";
  const asset = { ...candidate, id: Buffer.from(candidate.id, "hex"), owner_id: Buffer.from(candidate.owner_id, "hex"),
    storage_key: Buffer.from(candidate.storage_key, "hex"), reserve_token_hash: Buffer.from(candidate.reserve_token_hash, "hex"), updated_at: at, released_at: null };
  const state = { database: targetDatabaseName, global: { owner_bytes: 10000, total_bytes: 50000, held_bytes: candidate.stored_bytes,
    root_fingerprint: sourceFingerprint, initialized_at: at }, asset, live: false, queries: [], mutations: 0, released: 0,
    loseCommit: false, badAck: false, failRefund: false };
  let saved;
  const connection = {
    async beginTransaction() { saved = clone({ global: state.global, asset: state.asset }); },
    async commit() { saved = null; if (state.loseCommit) { state.loseCommit = false; throw new Error("private commit diagnostic"); } },
    async rollback() { if (saved) { state.global = saved.global; state.asset = saved.asset; saved = null; } },
    release() { state.released++; },
    async query(source, args = []) {
      const sql = source.replace(/\s+/g, " ").trim(); state.queries.push(sql);
      if (sql === "SELECT DATABASE() AS name") return [{ name: state.database }];
      if (sql.startsWith("SELECT owner_bytes")) return [clone(state.global)];
      if (sql.startsWith("SELECT COALESCE(SUM")) return [{ value: state.asset.state === "released" ? 0 : state.asset.stored_bytes }];
      if (sql.startsWith("SELECT id, owner_id")) return [clone(state.asset)];
      if (sql.startsWith("SELECT mv.message_id")) return state.live ? [{ message_id: Buffer.alloc(16, 9) }] : [];
      if (sql.startsWith("SELECT id FROM video_assets")) return ["reserved", "cleanup_pending"].includes(state.asset.state) ? [{ id: state.asset.id }] : [];
      assert.ok(sql.startsWith("UPDATE "), sql); state.mutations++;
      if (state.badAck || state.failRefund && sql.includes("SET held_bytes")) return { affectedRows: 0 };
      if (sql.includes("SET state = 'cleanup_pending'")) { state.asset.state = "cleanup_pending"; state.asset.updated_at = args[0]; }
      else if (sql.includes("SET state = 'released'")) { state.asset.state = "released"; state.asset.updated_at = args[0]; state.asset.released_at = args[1]; }
      else if (sql.includes("SET held_bytes")) state.global.held_bytes -= args[0];
      else if (sql.includes("SET root_fingerprint")) state.global.root_fingerprint = Buffer.from(args[0]);
      else assert.fail(sql);
      return { affectedRows: 1 };
    },
  };
  const store = createVideoBackupRecoveryStore({ pool: { getConnection: async () => connection } });
  const command = { candidate, sourceFingerprint, targetDatabaseName, now };
  const binding = () => ({ sourceFingerprint, targetFingerprint, targetDatabaseName, capacity: { ownerBytes: 10000, totalBytes: 50000 }, expectedHeldBytes: 0, now });
  return { state, store, command, binding, targetFingerprint };
}

test("video recovery marks before deletion, refunds once and rebinds only the finished independent capacity", async () => {
  const f = fixture();
  await assert.rejects(f.store.releaseCandidate(f.command), refused); assert.equal(f.state.mutations, 0);
  assert.deepEqual(await f.store.closeCandidate(f.command), { closed: true, state: "cleanup_pending" });
  assert.equal(f.state.global.held_bytes, 1064);
  assert.deepEqual(await f.store.releaseCandidate(f.command), { released: true });
  assert.equal(f.state.global.held_bytes, 0);
  const mutations = f.state.mutations;
  assert.deepEqual(await f.store.releaseCandidate(f.command), { released: true }); assert.equal(f.state.mutations, mutations);
  assert.deepEqual(await f.store.rebind(f.binding()), { rebound: true });
  assert.deepEqual(f.state.global.root_fingerprint, f.targetFingerprint);
  assert.deepEqual(await f.store.rebind(f.binding()), { rebound: true });
  assert.equal(f.state.mutations, mutations + 1);
});

test("a live video reference, wrong root, wrong clone or immutable candidate drift refuses recovery before mutations", async () => {
  for (const change of [f => { f.state.live = true; }, f => { f.state.database = "source_database"; },
    f => { f.state.global.root_fingerprint = Buffer.alloc(32, 99); }, f => { f.state.asset.owner_id = Buffer.alloc(16, 99); },
    f => { f.state.asset.reserve_token_hash = Buffer.alloc(32, 99); }, f => { f.state.asset.stored_bytes++; },
    f => { f.state.asset.updated_at = "2027-01-01 00:00:00.000000"; }]) {
    const f = fixture(); change(f); await assert.rejects(f.store.closeCandidate(f.command), refused); assert.equal(f.state.mutations, 0);
  }
});

test("lost video close/refund acknowledgements resume durable states without duplicate refunds", async () => {
  const f = fixture(); f.state.loseCommit = true;
  await assert.rejects(f.store.closeCandidate(f.command), refused); assert.equal(f.state.asset.state, "cleanup_pending");
  assert.deepEqual(await f.store.closeCandidate(f.command), { closed: true, state: "cleanup_pending" });
  f.state.loseCommit = true; await assert.rejects(f.store.releaseCandidate(f.command), refused);
  assert.equal(f.state.asset.state, "released"); assert.equal(f.state.global.held_bytes, 0);
  assert.deepEqual(await f.store.releaseCandidate(f.command), { released: true }); assert.equal(f.state.global.held_bytes, 0);
});

test("a missing video refund acknowledgement rolls back both SQL transitions and retains the full charge", async () => {
  const f = fixture(); await f.store.closeCandidate(f.command); f.state.failRefund = true;
  await assert.rejects(f.store.releaseCandidate(f.command), refused);
  assert.equal(f.state.asset.state, "cleanup_pending"); assert.equal(f.state.global.held_bytes, 1064);
});

test("video rebind refuses unfinished reservations, incorrect quotas or expected capacity", async () => {
  const f = fixture(); await assert.rejects(f.store.rebind({ ...f.binding(), expectedHeldBytes: 1064 }), refused);
  assert.equal(f.state.mutations, 0);
  await f.store.closeCandidate(f.command); await f.store.releaseCandidate(f.command);
  for (const value of [{ ...f.binding(), expectedHeldBytes: 1 }, { ...f.binding(), capacity: { ownerBytes: 9999, totalBytes: 50000 } }])
    await assert.rejects(f.store.rebind(value), refused);
  assert.deepEqual(f.state.global.root_fingerprint, f.command.sourceFingerprint);
});
