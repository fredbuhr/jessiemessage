import test from "node:test";
import assert from "node:assert/strict";
import { assertBackupSnapshot, captureBackupSnapshot, createBackupSnapshotStore, verifyBackupStorage } from "../server/backup/snapshot.mjs";

const d = "2026-10-15 08:00:00.000000", later = "2026-10-15 08:01:00.000000";
const h = (byte, size = 32) => byte.repeat(size * 2);
const clone = (value) => structuredClone(value);
function fixture() {
  const objects = [
    { id: h("1", 16), owner_id: h("4", 16), owner_role: "admin", storage_key: h("5"), content_digest: h("6"), full_bytes: 100,
      thumbnail_bytes: 10, stored_bytes: 190, state: "registered", asset_id: h("1", 16), created_at: d, updated_at: d, released_at: null },
    { id: h("2", 16), owner_id: h("4", 16), owner_role: "admin", storage_key: h("7"), content_digest: h("8"), full_bytes: 200,
      thumbnail_bytes: 20, stored_bytes: 300, state: "reserved", asset_id: null, created_at: d, updated_at: d, released_at: null },
    { id: h("3", 16), owner_id: h("4", 16), owner_role: "admin", storage_key: h("9"), content_digest: h("a"), full_bytes: 300,
      thumbnail_bytes: 30, stored_bytes: 410, state: "cleanup_pending", asset_id: h("3", 16), created_at: d, updated_at: d, released_at: null },
  ];
  const assets = objects.filter((row) => row.asset_id !== null).map((row) => ({ id: row.id, owner_id: row.owner_id, storage_key: row.storage_key,
    content_digest: row.content_digest, full_bytes: row.full_bytes, thumbnail_bytes: row.thumbnail_bytes, deleted_at: row.state === "registered" ? null : d }));
  return { version: 1, schemaDigest: h("b"), coreDigest: h("c"), counts: { tables: 28, rows: 6 },
    capacity: { ownerBytes: 1000, totalBytes: 10000, heldBytes: 900, rootFingerprint: h("d"), initializedAt: d }, objects, assets };
}
function storageFor(snapshot, missing = new Set(), extra = []) {
  const entries = snapshot.objects.flatMap((object) => ["full", "thumb"].map((variant) => ({ exists: true, kind: "published", status: "structural_ok",
    storageKey: Buffer.from(object.storage_key, "hex"), variant, encryptedBytes: BigInt((variant === "full" ? object.full_bytes : object.thumbnail_bytes) + 40) })))
    .filter((entry) => !missing.has(`${entry.storageKey.toString("hex")}:${entry.variant}`));
  return { inspectEntry: async ({ storageKey, variant }) => entries.find((entry) => entry.storageKey.equals(storageKey) && entry.variant === variant) ?? { exists: false },
    async *scanEntries() { yield* [...entries, ...extra]; } };
}
test("backup exact comparison survives canonical manifest key ordering", () => {
  const expected = fixture(), reordered = JSON.parse(JSON.stringify(expected, Object.keys(expected)));
  const reorder = (value) => Array.isArray(value) ? value.map(reorder) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).reverse().map((key) => [key, reorder(value[key])])) : value;
  assert.equal(assertBackupSnapshot({ expected, actual: reorder(expected), mode: "exact" }).candidates.length, 2);
  assert.notDeepEqual(reordered, expected);
});
test("recovery accepts only signed pending rows progressing to durable release and exact counters", () => {
  const expected = fixture(), actual = clone(expected);
  actual.objects[1].state = "cleanup_pending"; actual.objects[1].updated_at = later;
  assert.equal(assertBackupSnapshot({ expected, actual, mode: "recovery" }).heldBytes, 900);
  for (const row of actual.objects.slice(1)) { row.state = "released"; row.updated_at = later; row.released_at = later; }
  actual.capacity.heldBytes = 190; actual.capacity.rootFingerprint = h("e");
  assert.equal(assertBackupSnapshot({ expected, actual, mode: "recovery", targetFingerprint: h("e") }).heldBytes, 190);
  assert.throws(() => assertBackupSnapshot({ expected, actual, mode: "recovery" }), /could not be verified/);
});
test("snapshot rejects core/schema drift, active changes, lost rows, changed candidate bindings and counter refunds", () => {
  const expected = fixture();
  const mutations = [
    (s) => { s.coreDigest = h("e"); }, (s) => { s.schemaDigest = h("e"); }, (s) => { s.objects.pop(); },
    (s) => { s.objects[0].updated_at = later; }, (s) => { s.objects[1].storage_key = h("e"); },
    (s) => { s.capacity.heldBytes -= 300; }, (s) => { s.objects[1].state = "registered"; },
    (s) => { s.objects[2].state = "reserved"; }, (s) => { s.objects[1].updated_at = "2026-02-30 00:00:00.000000"; },
    (s) => { s.assets[0].deleted_at = d; }, (s) => { s.capacity.rootFingerprint = h("e"); },
  ];
  for (const mutate of mutations) { const actual = clone(expected); mutate(actual); assert.throws(() => assertBackupSnapshot({ expected, actual, mode: "recovery", targetFingerprint: h("e") })); }
});
test("structural backup scan tolerates known pending absence, authentic active file structure, and no unknowns", async () => {
  const snapshot = fixture();
  const missing = new Set(snapshot.objects.slice(1).flatMap((object) => ["full", "thumb"].map((variant) => `${object.storage_key}:${variant}`)));
  assert.equal((await verifyBackupStorage({ snapshot, storage: storageFor(snapshot, missing) })).healthy, true);
  missing.add(`${snapshot.objects[0].storage_key}:full`);
  const result = await verifyBackupStorage({ snapshot, storage: storageFor(snapshot, missing) });
  assert.equal(result.healthy, false); assert.deepEqual(result.issues, [{ code: "ACTIVE_FILE_MISSING" }]);
});
test("unknown, staging, unsafe and released files block recovery without exposing identifiers", async () => {
  for (const entry of [{ kind: "unknown", rawName: "private@example.invalid" }, { kind: "staging", status: "structural_ok" }, { kind: "published", status: "unsafe" }]) {
    const snapshot = fixture(), report = await verifyBackupStorage({ snapshot, storage: storageFor(snapshot, new Set(), [entry]) });
    assert.equal(report.healthy, false); assert.doesNotMatch(JSON.stringify(report), /private@example|1111111111/);
  }
  const snapshot = fixture(); snapshot.objects[2].state = "released"; snapshot.objects[2].released_at = later; snapshot.objects[2].updated_at = later; snapshot.capacity.heldBytes -= 410;
  assert.equal((await verifyBackupStorage({ snapshot, storage: storageFor(snapshot) })).healthy, false);
});
test("scan detects changes between expected lookup and streamed inventory", async () => {
  const snapshot = fixture(), storage = storageFor(snapshot); storage.scanEntries = async function* () {};
  const report = await verifyBackupStorage({ snapshot, storage });
  assert.equal(report.healthy, false); assert.ok(report.issues.some(({ code }) => code === "FILES_CHANGED"));
});
test("backup scans enforce cancellation, row/entry budgets and input constraints", async () => {
  const snapshot = fixture(), storage = storageFor(snapshot);
  await assert.rejects(verifyBackupStorage({ snapshot, storage, signal: { aborted: true } }));
  await assert.rejects(verifyBackupStorage({ snapshot, storage, limits: { maxEntries: 1 } }));
  await assert.rejects(verifyBackupStorage({ snapshot, storage, limits: { maxIssues: 101 } }));
  await assert.rejects(captureBackupSnapshot({ store: { capture: async () => ({}) } }));
});
test("snapshot reader queries actual database and sanitizes database errors while releasing", async () => {
  let released = 0;
  const store = createBackupSnapshotStore({ pool: { getConnection: async () => ({ query: async () => [{ name: "jessiemessage_test_clone" }], release: () => { released++; } }) } });
  assert.equal(await store.databaseName(), "jessiemessage_test_clone"); assert.equal(released, 1);
  const bad = createBackupSnapshotStore({ pool: { getConnection: async () => ({ query: async () => { throw new Error("SELECT password /private/path"); }, release: () => { released++; } }) } });
  await assert.rejects(bad.databaseName(), (error) => { assert.equal(error.code, "BACKUP_SNAPSHOT_DATABASE"); assert.doesNotMatch(error.message, /password|path|SELECT/); return true; });
  assert.equal(released, 2);
});
