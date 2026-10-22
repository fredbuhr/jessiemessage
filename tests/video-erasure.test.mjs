import test from "node:test";
import assert from "node:assert/strict";
import { createAccountErasure } from "../server/data/erasure.mjs";
import { AccountErasureError, erasureTransition } from "../server/data/erasure-state.mjs";
import { composeVideoErasureStorage } from "../server/video/erasure-storage.mjs";

const clientId = "a".repeat(32), assetId = "b".repeat(32);
const photoRoot = Buffer.alloc(32, 1), videoRoot = Buffer.alloc(32, 2);
const binding = { database: "jessiemessage_test_video_erasure", rootFingerprint: photoRoot.toString("hex"), videoRootFingerprint: videoRoot.toString("hex") };
function fixture() {
  const objects = ["photo", "video"].map((kind, index) => ({ id: assetId, kind,
    cursor: `${kind === "photo" ? "p" : "v"}:${assetId}`, storageKey: Buffer.alloc(32, index + 1), bytes: (index + 1) * 100 }));
  const fault = {}, events = [], released = new Set(), physical = new Set(objects.map(object => object.cursor));
  let durable = { revision: 0, record: null }, held = 300, excluded = false, exists = true, clock = 1000;
  const lose = name => { if (fault[name]) { delete fault[name]; throw new Error("synthetic uncertain " + name); } };
  const scope = { binding,
    async inspect() { events.push("inspect"); if (!exists) throw new AccountErasureError("ERASURE_NOT_FOUND"); },
    async prepare() { events.push("prepare"); lose("prepareAfter"); return { prepared: true }; },
    async nextMedia(cursor) { return objects.find(object => cursor === null || object.cursor > cursor) ?? null; },
    async releaseMedia(id, storageKey, _now, kind) {
      const object = objects.find(item => item.kind === kind); assert.equal(id, object.id); assert.ok(storageKey.equals(object.storageKey));
      assert.equal(physical.has(object.cursor), false); events.push("release:" + kind);
      if (!released.has(kind)) { held -= object.bytes; released.add(kind); }
      lose("releaseAfter"); return { released: true };
    },
    async finish() { assert.equal(held, 0); exists = false; lose("finishAfter"); return { completed: true }; },
    async verifyAbsent() { if (exists) throw new AccountErasureError("ERASURE_RESTORE_REPLAY_REQUIRED"); return { absent: true }; },
  };
  const store = { binding, async withLease(id, work) { assert.equal(id, clientId); return work(scope); } };
  const storage = {
    async fingerprint() { return photoRoot; },
    async videoFingerprint() { return fault.wrongVideoRoot ? Buffer.alloc(32, 9) : videoRoot; },
    async remove({ kind, storageKey }) {
      const object = objects.find(item => item.kind === kind); assert.ok(storageKey.equals(object.storageKey));
      events.push("remove:" + kind); physical.delete(object.cursor);
      if (fault.changeRootAfterRemove) { delete fault.changeRootAfterRemove; fault.wrongVideoRoot = true; }
      lose("removeAfter"); return fault.noRemovalAck ? undefined : { removed: true };
    },
  };
  const journalFor = () => ({
    async read() { events.push("read"); return structuredClone(durable); },
    async save(record, revision, authorize) {
      await authorize(); assert.equal(revision, durable.revision); erasureTransition(durable.record, record);
      if (record.cursor !== null) lose("cursorBefore");
      durable = { revision: revision + 1, record: structuredClone(record) };
      if (record.cursor !== null) lose("cursorAfter"); return structuredClone(durable);
    }, close() {},
  });
  const maintenance = { async withQuiescedProducers(work) {
    excluded = true;
    try { return await work(async () => { if (!excluded) throw new AccountErasureError("ERASURE_MAINTENANCE"); }); }
    finally { excluded = false; }
  } };
  const engine = createAccountErasure({ store, storage, journalFor, maintenance, clock: () => clock++ });
  return { engine, fault, events, released, physical, store, storage, scope, journalFor, maintenance,
    get durable() { return structuredClone(durable); }, get held() { return held; } };
}

test("candidate closure distinguishes colliding photo and video IDs across bounded resumptions", async () => {
  const f = fixture();
  const first = await f.engine.resume({ clientId, maxMedia: 1 });
  assert.equal(first.completed, false); assert.equal(first.processedMedia, 1);
  assert.equal(f.durable.record.version, 2); assert.equal(f.durable.record.cursor, `p:${assetId}`); assert.equal(f.held, 200);
  const second = await f.engine.resume({ clientId, maxMedia: 1 });
  assert.equal(second.completed, true); assert.equal(second.processedMedia, 1); assert.equal(f.held, 0);
  assert.deepEqual(f.events.filter(event => event.startsWith("remove:")), ["remove:photo", "remove:video"]);
  assert.equal(f.durable.record.cursor, `v:${assetId}`);
});

test("candidate closure checks both roots before opening a journal or changing SQL", async () => {
  const f = fixture(); f.fault.wrongVideoRoot = true;
  await assert.rejects(f.engine.resume({ clientId }), { code: "ERASURE_BINDING" });
  assert.deepEqual(f.events, []); assert.equal(f.durable.record, null); assert.equal(f.held, 300);
});

test("candidate closure refuses a missing video fingerprint implementation", () => {
  const f = fixture(); const storage = { ...f.storage, videoFingerprint: undefined };
  assert.throws(() => createAccountErasure({ store: f.store, storage, journalFor: f.journalFor, maintenance: f.maintenance }), { code: "ERASURE_INPUT" });
});

test("root drift between unlink and release leaves the entire charge and cursor pending", async () => {
  const f = fixture(); f.fault.changeRootAfterRemove = true;
  await assert.rejects(f.engine.resume({ clientId }), { code: "ERASURE_BINDING" });
  assert.equal(f.held, 300); assert.equal(f.released.size, 0); assert.equal(f.durable.record.cursor, null);
  delete f.fault.wrongVideoRoot;
  assert.equal((await f.engine.resume({ clientId })).completed, true); assert.equal(f.held, 0);
});

test("an unlink with lost acknowledgement is checked again before any capacity refund", async () => {
  const f = fixture(); f.fault.removeAfter = true;
  await assert.rejects(f.engine.resume({ clientId }));
  assert.equal(f.held, 300); assert.equal(f.durable.record.cursor, null);
  assert.equal((await f.engine.resume({ clientId })).completed, true); assert.equal(f.held, 0);
  assert.equal(f.events.filter(event => event === "remove:photo").length, 2);
});

test("a missing positive removal acknowledgement never releases candidate capacity", async () => {
  const f = fixture(); f.fault.noRemovalAck = true;
  await assert.rejects(f.engine.resume({ clientId }), { code: "ERASURE_FILES" });
  assert.equal(f.held, 300); assert.equal(f.durable.record.cursor, null); assert.equal(f.released.size, 0);
});

test("an uncertain SQL capacity commit is idempotently resumed for a typed asset", async () => {
  const f = fixture(); f.fault.releaseAfter = true;
  await assert.rejects(f.engine.resume({ clientId })); assert.equal(f.held, 200);
  assert.equal(f.durable.record.cursor, null);
  assert.equal((await f.engine.resume({ clientId })).completed, true); assert.equal(f.held, 0);
  assert.equal(f.released.size, 2);
});

for (const point of ["cursorBefore", "cursorAfter"]) test(`typed closure resumes a ${point} uncertainty without skipping video`, async () => {
  const f = fixture(); f.fault[point] = true;
  await assert.rejects(f.engine.resume({ clientId }));
  assert.equal(f.events.includes("remove:video"), false);
  assert.equal((await f.engine.resume({ clientId })).completed, true); assert.equal(f.held, 0);
});

test("candidate closure survives a final SQL acknowledgement lost after account removal", async () => {
  const f = fixture(); f.fault.finishAfter = true;
  await assert.rejects(f.engine.resume({ clientId })); assert.equal(f.durable.record.phase, "files_erased");
  assert.equal((await f.engine.resume({ clientId })).completed, true); assert.equal(f.held, 0);
});

test("candidate storage dispatches by kind and requires positive video removal", async () => {
  const calls = [], storageKey = Buffer.alloc(32, 8);
  const photo = { fingerprint: async () => photoRoot, async remove(value) { calls.push(["photo", value]); } };
  let acknowledged = true;
  const video = { fingerprint: async () => videoRoot, async remove(value) { calls.push(["video", value]); return acknowledged ? { removed: true } : undefined; } };
  const storage = composeVideoErasureStorage({ storage: photo, videoStorage: video });
  assert.ok((await storage.fingerprint()).equals(photoRoot)); assert.ok((await storage.videoFingerprint()).equals(videoRoot));
  assert.deepEqual(await storage.remove({ kind: "photo", storageKey }), { removed: true });
  assert.deepEqual(await storage.remove({ kind: "video", storageKey }), { removed: true });
  assert.deepEqual(calls.map(call => call[0]), ["photo", "video"]);
  acknowledged = false;
  await assert.rejects(storage.remove({ kind: "video", storageKey }), { code: "ERASURE_FILES" });
  for (const kind of [undefined, "other", "../photo"])
    await assert.rejects(storage.remove({ kind, storageKey }), { code: "ERASURE_INPUT" });
});
