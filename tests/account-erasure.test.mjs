import test from "node:test";
import assert from "node:assert/strict";
import { createAccountErasure } from "../server/data/erasure.mjs";
import { AccountErasureError, erasureRecord, erasureTransition } from "../server/data/erasure-state.mjs";

const clientId = "a".repeat(32), root = Buffer.alloc(32, 4), binding = { database: "jessiemessage_test_erasure", rootFingerprint: root.toString("hex") };
function fixture() {
  const events = [], faults = {}, objects = [1, 2].map(n => ({ id: String(n).repeat(32), storageKey: Buffer.alloc(32, n), bytes: n * 100 }));
  const db = { exists: true, prepared: false, held: 300, released: new Set(), physical: new Set(objects.map(x => x.id)) };
  let durable = { revision: 0, record: null }, held = false, tick = 1792350000000;
  const fail = point => { if (faults[point]) { delete faults[point]; throw new Error("Synthetic lost acknowledgement: " + point); } };
  const scope = { binding,
    async inspect() { events.push("inspect"); if (!db.exists) throw new AccountErasureError("ERASURE_NOT_FOUND"); return { clientId }; },
    async prepare() { events.push("prepare"); assert.ok(durable.record); db.prepared = true; fail("prepareAfter"); return { prepared: true }; },
    async nextMedia(cursor) { events.push("next"); return objects.find(x => cursor === null || x.id > cursor) ?? null; },
    async releaseMedia(id) {
      events.push("release:" + id[0]); assert.equal(db.physical.has(id), false);
      if (!db.released.has(id)) { db.held -= objects.find(x => x.id === id).bytes; db.released.add(id); }
      fail("releaseAfter"); return { released: true };
    },
    async finish() { events.push("finish"); assert.equal(db.held, 0); assert.equal(db.physical.size, 0); db.exists = false; fail("finishAfter"); return { completed: true }; },
    async verifyAbsent() { events.push("verify"); if (db.exists) throw new AccountErasureError("ERASURE_RESTORE_REPLAY_REQUIRED"); return { absent: true }; },
  };
  const store = { binding, async withLease(id, operation) { assert.equal(id, clientId); fail("lease"); return operation(scope); } };
  const storage = { async fingerprint() { return faults.wrongRoot ? Buffer.alloc(32, 5) : root; }, async remove({ storageKey }) {
    const object = objects.find(x => x.storageKey.equals(storageKey)); events.push("remove:" + object.id[0]);
    fail("removeBefore"); db.physical.delete(object.id); if (faults.breakMaintenance) { delete faults.breakMaintenance; held = false; }
  } };
  function journalFor() { return {
    async read() { events.push("read"); return structuredClone(durable); },
    async save(record, revision, authorize) {
      await authorize(); assert.equal(revision, durable.revision); erasureTransition(durable.record, record);
      events.push("save:" + record.phase + ":" + (record.cursor?.[0] ?? "-"));
      const point = record.cursor ? "cursor" : record.phase; fail(point + "Before");
      durable = { revision: revision + 1, record: structuredClone(record) }; fail(point + "After"); return structuredClone(durable);
    }, close() { events.push("close"); },
  }; }
  const maintenance = { async withQuiescedProducers(operation) {
    assert.equal(held, false); held = true;
    try { return await operation(async () => { if (!held) throw new AccountErasureError("ERASURE_MAINTENANCE"); }); }
    finally { held = false; }
  } };
  const engine = createAccountErasure({ store, storage, journalFor, maintenance, clock: () => tick++ });
  return { engine, store, storage, journalFor, maintenance, db, faults, events, scope, get durable() { return structuredClone(durable); }, set durable(value) { durable = value; } };
}
test("account erasure records intent before SQL and durable media removal before capacity release", async () => {
  const f = fixture(), result = await f.engine.resume({ clientId });
  assert.equal(result.completed, true); assert.equal(result.processedMedia, 2); assert.equal(f.db.held, 0); assert.equal(f.db.exists, false);
  assert.equal(result.scope, "active_database_and_client_owned_media"); assert.equal(result.backupCopies, "separate_not_erased"); assert.equal(result.externalCopies, "not_checked");
  assert.ok(f.events.indexOf("save:requested:-") < f.events.indexOf("prepare"));
  assert.ok(f.events.indexOf("save:prepared:-") < f.events.indexOf("remove:1"));
  assert.ok(f.events.indexOf("remove:1") < f.events.indexOf("release:1"));
  assert.ok(f.events.indexOf("remove:2") < f.events.indexOf("finish"));
  assert.equal(f.durable.record.phase, "completed");
});
test("an ambiguous SQL preparation commit stops before filesystem deletion and is resumed explicitly", async () => {
  const f = fixture(); f.faults.prepareAfter = true;
  await assert.rejects(f.engine.resume({ clientId }), { code: "ERASURE_UNAVAILABLE" });
  assert.equal(f.db.prepared, true); assert.equal(f.durable.record.phase, "requested"); assert.equal(f.events.some(x => x.startsWith("remove:")), false);
  assert.equal((await f.engine.resume({ clientId })).completed, true);
});
test("failed physical deletion keeps its entire capacity charge and can be retried", async () => {
  const f = fixture(); f.faults.removeBefore = true;
  await assert.rejects(f.engine.resume({ clientId })); assert.equal(f.db.held, 300); assert.equal(f.db.exists, true);
  assert.equal(f.durable.record.cursor, null); assert.equal((await f.engine.resume({ clientId })).completed, true);
});
test("a lost release acknowledgement repeats unlink safely and never releases capacity twice", async () => {
  const f = fixture(); f.faults.releaseAfter = true;
  await assert.rejects(f.engine.resume({ clientId })); assert.equal(f.db.held, 200); assert.equal(f.durable.record.cursor, null);
  assert.equal((await f.engine.resume({ clientId })).completed, true); assert.equal(f.db.held, 0);
  assert.equal(f.events.filter(x => x === "remove:1").length, 2);
});
for (const suffix of ["Before", "After"]) test(`an uncertain cursor publication ${suffix.toLowerCase()} rename stops this pass and reloads durable progress`, async () => {
  const f = fixture(); f.faults["cursor" + suffix] = true;
  await assert.rejects(f.engine.resume({ clientId })); assert.equal(f.events.includes("remove:2"), false);
  assert.equal((await f.engine.resume({ clientId })).completed, true); assert.equal(f.db.held, 0);
});
test("a lost final SQL acknowledgement resumes from the independent journal even after the user is gone", async () => {
  const f = fixture(); f.faults.finishAfter = true;
  await assert.rejects(f.engine.resume({ clientId })); assert.equal(f.db.exists, false); assert.equal(f.durable.record.phase, "files_erased");
  assert.equal((await f.engine.resume({ clientId })).completed, true);
});
test("a wrong physical media root fails before intent or SQL", async () => {
  const f = fixture(); f.faults.wrongRoot = true;
  await assert.rejects(f.engine.resume({ clientId }), { code: "ERASURE_BINDING" }); assert.deepEqual(f.events, []); assert.equal(f.durable.record, null);
});
test("loss of producer exclusion after unlink never releases capacity or removes the account", async () => {
  const f = fixture(); f.faults.breakMaintenance = true;
  await assert.rejects(f.engine.resume({ clientId }), { code: "ERASURE_MAINTENANCE" });
  assert.equal(f.db.held, 300); assert.equal(f.db.exists, true); assert.equal(f.durable.record.cursor, null);
  assert.equal((await f.engine.resume({ clientId })).completed, true);
});
test("bounded passes preserve a durable cursor and finish without repeating earlier objects", async () => {
  const f = fixture(); const first = await f.engine.resume({ clientId, maxMedia: 1 });
  assert.equal(first.completed, false); assert.equal(first.phase, "prepared"); assert.equal(first.processedMedia, 1); assert.equal(f.db.held, 200);
  const second = await f.engine.resume({ clientId, maxMedia: 1 }); assert.equal(second.completed, true); assert.equal(second.processedMedia, 1);
  assert.equal(f.events.filter(x => x === "remove:1").length, 1);
});
test("a completion receipt detects account reappearance instead of declaring a restored account erased", async () => {
  const f = fixture(); await f.engine.resume({ clientId }); f.db.exists = true; const saved = f.durable;
  await assert.rejects(f.engine.resume({ clientId }), { code: "ERASURE_RESTORE_REPLAY_REQUIRED" });
  assert.deepEqual(f.durable, saved); assert.equal(f.db.exists, true);
});
test("a busy database erasure lease cannot touch a journal or files", async () => {
  const f = fixture(); f.faults.lease = true;
  await assert.rejects(f.engine.resume({ clientId })); assert.deepEqual(f.events, []); assert.equal(f.db.held, 300);
});
test("journal bindings, identity and monotone phases cannot be reset or crossed", () => {
  const start = erasureRecord({ version: 1, clientId, binding, phase: "requested", cursor: null, startedAt: 5, updatedAt: 5 });
  const prepared = { ...start, phase: "prepared", updatedAt: 6, cursor: null };
  assert.deepEqual(erasureTransition(start, prepared), prepared);
  const progress = { ...prepared, cursor: "1".repeat(32) };
  assert.deepEqual(erasureTransition(prepared, progress), progress);
  assert.throws(() => erasureTransition(start, progress));
  assert.throws(() => erasureTransition(progress, { ...progress, phase: "files_erased", cursor: "2".repeat(32) }));
  for (const next of [{ ...prepared, phase: "completed" }, { ...prepared, startedAt: 4 }, { ...prepared, binding: { ...binding, database: "other" } }, { ...prepared, clientId: "b".repeat(32) }])
    assert.throws(() => erasureTransition(start, next));
  assert.throws(() => erasureTransition(progress, { ...progress, cursor: null }));
  assert.throws(() => erasureTransition(prepared, start));
  assert.throws(() => erasureRecord({ ...start, extra: true }));
});
test("a journal from another account never authorizes the SQL phase", async () => {
  const f = fixture(); f.durable = { revision: 1, record: { version: 1, clientId: "b".repeat(32), binding, phase: "requested", cursor: null, startedAt: 1, updatedAt: 1 } };
  await assert.rejects(f.engine.resume({ clientId }), { code: "ERASURE_BINDING" }); assert.equal(f.db.prepared, false);
});
test("there is no default maintenance bypass, boolean offline flag or permissive subject parser", async () => {
  const f = fixture();
  assert.throws(() => createAccountErasure({ store: f.store, storage: f.storage, journalFor: f.journalFor, maintenance: true }));
  for (const value of [{}, [], { clientId: "../" }, { clientId: "A".repeat(32) }, { clientId, offline: true }, { clientId, maxMedia: 0 }, { clientId, maxMedia: 101 }])
    await assert.rejects(f.engine.resume(value), { code: "ERASURE_INPUT" });
  assert.equal(f.db.prepared, false);
});
