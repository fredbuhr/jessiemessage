import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile, readFile, utimes, chmod } from "node:fs/promises";
import path from "node:path";
import { createMediaStorage } from "../server/media/storage.mjs";
import { inspectMediaInventory } from "../server/media/inventory.mjs";
import { createMediaInventoryStore } from "../server/media/inventory-store.mjs";

const base = path.resolve(import.meta.dirname, "../../audit");
const capacity = { ownerBytes: 128 * 1024 * 1024, totalBytes: 1024 * 1024 * 1024 };
const full = Buffer.from("synthetic-full-bytes"), thumbnail = Buffer.from("synthetic-thumbnail-bytes");
const filename = (f, row, variant) => path.join(f.root, `${row.storageKey.toString("hex")}.${variant}.enc`);
function page(kind, rows, { afterId, limit }) {
  const chosen = rows.filter((row) => afterId === null || Buffer.compare(row.id, afterId) > 0).sort((a, b) => Buffer.compare(a.id, b.id));
  const values = chosen.slice(0, limit), hasMore = chosen.length > limit;
  return { [kind]: values, hasMore, nextCursor: hasMore ? values.at(-1).id : null };
}
async function fixture(t) {
  await mkdir(base, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(path.join(base, "inventory-")); t.after(() => rm(root, { recursive: true, force: true }));
  const storage = await createMediaStorage({ root, key: randomBytes(32) }), rootFingerprint = await storage.fingerprint();
  const assets = [], objects = [], reads = [];
  const state = { ready: false, heldBytes: 0, pendingBytes: 0, ...capacity, rootFingerprint };
  const store = {
    listAssets: async (options) => { reads.push(["assets", options]); return page("assets", assets, options); },
    listObjects: async (options) => { reads.push(["objects", options]); return page("objects", objects, options); },
    lookupStorageKey: async ({ storageKey }) => ({ asset: assets.find((row) => row.storageKey.equals(storageKey)) ?? null, object: objects.find((row) => row.storageKey.equals(storageKey)) ?? null }),
  };
  const f = { root, storage, assets, objects, reads, state, store, capacityStore: { status: async () => ({ ...state }) }, capacity };
  f.add = async ({ deleted = false, publish = true, journal = null } = {}) => {
    const row = { id: randomBytes(16), ownerId: Buffer.alloc(16, 1), storageKey: randomBytes(32), fullBytes: full.length, thumbnailBytes: thumbnail.length, deleted };
    assets.push(row);
    if (publish) await storage.put({ assetId: row.id, storageKey: row.storageKey, full, thumbnail });
    if (journal) objects.push({ ...row, state: journal, assetId: row.id, storedBytes: BigInt(row.fullBytes + row.thumbnailBytes + 80) });
    return row;
  };
  return f;
}
const inspect = (f, changes = {}) => inspectMediaInventory({ ...f, ...changes });
const codes = (report) => report.issues.map((item) => item.code);

test("inventory includes unreferenced legacy assets and emits only private structural counters", async (t) => {
  const f = await fixture(t), row = await f.add();
  const report = await inspect(f);
  assert.equal(report.complete, true); assert.equal(report.healthy, true); assert.equal(report.canInitialize, true);
  assert.equal(report.integrity, "structure_only"); assert.equal(report.counts.assets, 1); assert.equal(report.counts.knownPublished, 2);
  assert.equal(report.bytes.declared, String(full.length + thumbnail.length + 80)); assert.deepEqual(report.issues, []);
  assert.deepEqual(f.reads.map(([kind]) => kind), ["assets", "objects", "assets", "objects"]);
  for (const [, options] of f.reads) assert.equal(options.limit, 100);
  for (const secret of [f.root, row.storageKey.toString("hex"), row.ownerId.toString("hex"), full.toString()]) assert.equal(JSON.stringify(report).includes(secret), false);
});

test("active missing files block initialization while absent deleted legacy files stay charged and known", async (t) => {
  const f = await fixture(t); await f.add({ publish: false });
  let report = await inspect(f); assert.equal(report.complete, true); assert.equal(report.canInitialize, false);
  assert.equal(report.counts.missingActive, 2); assert.ok(codes(report).includes("missing_active"));
  f.assets[0].deleted = true;
  report = await inspect(f); assert.equal(report.healthy, true); assert.equal(report.canInitialize, true);
  assert.equal(report.counts.missingDeleted, 2); assert.equal(report.bytes.declared, String(full.length + thumbnail.length + 80));
});

test("released deleted tombstones without files are healthy and keep their SQL history", async (t) => {
  const f = await fixture(t); await f.add({ deleted: true, publish: false, journal: "released" }); f.state.ready = true;
  const before = JSON.stringify(f.assets), report = await inspect(f);
  assert.equal(report.complete, true); assert.equal(report.healthy, true); assert.equal(report.canInitialize, false);
  assert.equal(report.counts.released, 1); assert.equal(JSON.stringify(f.assets), before);
  f.assets[0].deleted = false;
  assert.equal((await inspect(f)).healthy, false);
});

test("many absent deleted legacy assets use bounded pages and do not exhaust diagnostic issue capacity", async (t) => {
  const f = await fixture(t);
  for (let i = 0; i < 250; i++) await f.add({ deleted: true, publish: false });
  const report = await inspect(f, { storage: { ...f.storage, inspectEntry: async () => ({ exists: false }) } });
  assert.equal(report.complete, true); assert.equal(report.healthy, true); assert.equal(report.canInitialize, true);
  assert.equal(report.counts.deletedAssets, 250); assert.equal(report.counts.missingDeleted, 500);
  assert.equal(report.bytes.declared, String(250 * (full.length + thumbnail.length + 80)));
  assert.deepEqual(report.issues, []); assert.equal(report.issuesTruncated, false);
  const pages = f.reads.filter(([kind]) => kind === "assets"); assert.equal(pages.length, 6);
  for (const [, options] of pages) assert.equal(options.limit, 100);
});

test("journal states must agree with active versus deleted assets and preinitialization history cannot be hidden", async (t) => {
  const f = await fixture(t), row = await f.add({ journal: "registered" }); f.state.ready = true;
  f.objects[0].state = "cleanup_pending";
  assert.ok(codes(await inspect(f)).includes("metadata_mismatch"));
  row.deleted = true; f.objects[0].state = "registered";
  assert.ok(codes(await inspect(f)).includes("metadata_mismatch"));
  f.objects[0].state = "released";
  const released = await inspect(f); assert.ok(codes(released).includes("released_files_present")); assert.ok(!codes(released).includes("metadata_mismatch"));
  f.state.ready = false;
  assert.ok(codes(await inspect(f)).includes("uninitialized_journal"));
});

test("registered assets and campaign-independent files are known; unfinished reservations are not unknown files", async (t) => {
  const f = await fixture(t); await f.add({ journal: "registered" }); f.state.ready = true;
  let report = await inspect(f); assert.equal(report.healthy, true);
  const reserved = { id: randomBytes(16), ownerId: Buffer.alloc(16, 1), storageKey: randomBytes(32), fullBytes: full.length, thumbnailBytes: thumbnail.length,
    storedBytes: BigInt(full.length + thumbnail.length + 80), state: "reserved", assetId: null };
  f.objects.push(reserved); await f.storage.put({ assetId: reserved.id, storageKey: reserved.storageKey, full, thumbnail });
  report = await inspect(f); assert.equal(report.complete, true); assert.equal(report.healthy, false);
  assert.equal(report.counts.unknown, 0); assert.equal(report.counts.reserved, 1); assert.ok(codes(report).includes("reserved_object"));
  assert.ok(!codes(report).includes("unknown_file"));
});

test("unknown and staging files block initialization without revealing unknown names or storage keys", async (t) => {
  const f = await fixture(t), row = await f.add();
  const privateName = "private-person@example.invalid-secret-path";
  await writeFile(path.join(f.root, privateName), "synthetic-private-unknown", { mode: 0o600 });
  const staging = `.${row.storageKey.toString("hex")}.full.${"2".repeat(32)}.tmp`;
  await writeFile(path.join(f.root, staging), await readFile(filename(f, row, "full")), { mode: 0o600 });
  const report = await inspect(f);
  assert.equal(report.complete, true); assert.equal(report.healthy, false); assert.equal(report.counts.unknown, 1); assert.equal(report.counts.staging, 1);
  assert.ok(codes(report).includes("unknown_file")); assert.ok(codes(report).includes("staging_file"));
  for (const secret of [privateName, staging, row.storageKey.toString("hex"), "synthetic-private-unknown"]) assert.equal(JSON.stringify(report).includes(secret), false);
});

test("structural corruption and SQL/file length mismatches block initialization", async (t) => {
  const f = await fixture(t), row = await f.add();
  row.fullBytes++;
  let report = await inspect(f); assert.equal(report.canInitialize, false); assert.ok(codes(report).includes("size_mismatch"));
  row.fullBytes--;
  const target = filename(f, row, "full"), envelope = await readFile(target); envelope[0] ^= 1; await writeFile(target, envelope);
  report = await inspect(f); assert.equal(report.complete, true); assert.equal(report.healthy, false); assert.ok(codes(report).includes("invalid_envelope"));
});

test("unsafe published file permissions block initialization without attempting a repair", async (t) => {
  const f = await fixture(t), row = await f.add(), target = filename(f, row, "full");
  await chmod(target, 0o644);
  const report = await inspect(f); assert.equal(report.complete, true); assert.equal(report.canInitialize, false); assert.ok(codes(report).includes("unsafe"));
});

test("inventory states its structural scope and does not claim to authenticate a changed GCM tag", async (t) => {
  const f = await fixture(t), row = await f.add(), target = filename(f, row, "full"), envelope = await readFile(target);
  envelope[envelope.length - 1] ^= 1; await writeFile(target, envelope);
  const report = await inspect(f); assert.equal(report.healthy, true); assert.equal(report.integrity, "structure_only");
});

test("object, entry and issue limits produce incomplete bounded reports", async (t) => {
  const f = await fixture(t); await f.add(); await f.add();
  let report = await inspect(f, { limits: { maxObjects: 1 } }); assert.equal(report.complete, false); assert.ok(codes(report).includes("object_limit"));
  report = await inspect(f, { limits: { maxEntries: 1 } }); assert.equal(report.complete, false); assert.ok(codes(report).includes("entry_limit"));
  f.assets.length = 0;
  report = await inspect(f, { limits: { maxIssues: 1 } }); assert.equal(report.complete, false); assert.equal(report.issuesTruncated, true); assert.equal(report.issues.length, 1);
});

test("an aborted scan or backend failure stays incomplete and never exposes backend details", async (t) => {
  const f = await fixture(t), controller = new AbortController(); controller.abort();
  let report = await inspect(f, { signal: controller.signal }); assert.equal(report.complete, false); assert.ok(codes(report).includes("aborted"));
  report = await inspect(f, { store: { ...f.store, listAssets: async () => { throw new Error("SQL password private@example.invalid /private/root"); } } });
  assert.equal(report.complete, false); assert.ok(codes(report).includes("inventory_unavailable")); assert.doesNotMatch(JSON.stringify(report), /password|private@example|private\/root/);
});

test("filesystem changes between expected inspection and observed scan invalidate the inventory", async (t) => {
  const f = await fixture(t), row = await f.add();
  const storage = { ...f.storage, async *scanEntries(options) {
    const future = Math.floor(Date.now() / 1000) + 10; await utimes(filename(f, row, "full"), future, future);
    yield* f.storage.scanEntries(options);
  } };
  const report = await inspect(f, { storage }); assert.equal(report.complete, false); assert.ok(codes(report).includes("filesystem_drift"));
});

test("SQL changes between bounded passes invalidate the inventory", async (t) => {
  const f = await fixture(t); await f.add(); let reads = 0;
  const store = { ...f.store, listAssets: async (options) => { if (++reads === 2) f.assets[0].deleted = true; return f.store.listAssets(options); } };
  const report = await inspect(f, { store }); assert.equal(report.complete, false); assert.ok(codes(report).includes("sql_drift"));
});

test("root or configured limit mismatches and insufficient disk reserve block initialization", async (t) => {
  const f = await fixture(t);
  f.state.rootFingerprint = randomBytes(32);
  let report = await inspect(f); assert.equal(report.canInitialize, false); assert.ok(codes(report).includes("capacity_binding_mismatch"));
  f.state.rootFingerprint = await f.storage.fingerprint(); f.state.ownerBytes++;
  report = await inspect(f); assert.equal(report.canInitialize, false); assert.ok(codes(report).includes("capacity_binding_mismatch"));
  f.state.ownerBytes--;
  report = await inspect(f, { minimumFreeBytes: 2n, storage: { ...f.storage, availableSpace: async () => ({ availableBytes: 1n }) } });
  assert.equal(report.canInitialize, false); assert.ok(codes(report).includes("insufficient_free_space"));
});

test("inventory SQL adapter performs only bounded SELECTs and storage-key lookups, including deleted assets", async () => {
  const calls = [], raw = { id: randomBytes(16), owner_id: randomBytes(16), storage_key: randomBytes(32), full_bytes: full.length, thumbnail_bytes: thumbnail.length, deleted_at: "2026-10-15 00:00:00.000000" };
  const pool = { getConnection: async () => ({ query: async (sql, parameters) => { calls.push({ sql, parameters }); return sql.includes("media_storage_objects") ? [] : [raw]; }, release() { calls.push({ release: true }); } }) };
  const store = createMediaInventoryStore({ pool });
  const assets = await store.listAssets({ afterId: null, limit: 100 }); assert.equal(assets.assets[0].deleted, true);
  assert.equal((await store.listObjects()).objects.length, 0);
  const lookup = await store.lookupStorageKey({ storageKey: raw.storage_key }); assert.equal(lookup.asset.deleted, true); assert.equal(lookup.object, null);
  const queries = calls.filter((item) => item.sql);
  assert.equal(queries.length, 4); for (const { sql } of queries) assert.match(sql.trim(), /^SELECT /);
  assert.doesNotMatch(queries[0].sql, /deleted_at\s+IS\s+NULL|message_media|broadcast/i);
  assert.deepEqual(queries[0].parameters, [101]); assert.match(queries[2].sql, /WHERE storage_key = \? LIMIT 2/);
  assert.equal(calls.filter((item) => item.release).length, 3);
});
