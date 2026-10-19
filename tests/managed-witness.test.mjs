import test from "node:test";
import assert from "node:assert/strict";
import { runManagedWitnessPreparation } from "../server/backup/managed-witness.mjs";

const receipt = () => ({ prepared: true, contractSha256: "a".repeat(64), externalWitnessConfirmed: false, closuresEnabled: false });
function fixture() {
  let status = "running", held = false; const events = [];
  const runtime = { state: () => ({ status }), async stop() { events.push("stop"); status = "stopped"; return { exitCode: 0, signal: null }; },
    async start() { events.push("start"); status = "running"; } };
  const operations = { async check() { events.push("check"); }, async prepare({ assertQuiescent, withMaintenance }) {
    held = true; events.push("lease");
    try { return await withMaintenance(async () => { await assertQuiescent(); events.push("publish"); return receipt(); }, async () => { assert.equal(held, true); }); }
    finally { held = false; events.push("release"); }
  } };
  return { events, runtime, operations, held: () => held, source: async () => {} };
}
const run = (f, changes) => runManagedWitnessPreparation({ ...f, ...changes });

test("precheck, actual zero exit, publication and restart all precede release of the same lease", async () => {
  const f = fixture(), result = await run(f);
  assert.deepEqual(f.events, ["check", "lease", "stop", "publish", "start", "release"]);
  assert.equal(result.runtimeResumed, true); assert.equal(result.externalWitnessConfirmed, false); assert.equal(result.closuresEnabled, false);
});

test("failed precheck or missing lease cannot authorize a publication", async () => {
  const f = fixture(); f.operations.check = async () => { throw new Error("Synthetic private cause"); };
  await assert.rejects(run(f), error => { assert.equal(error.code, "WITNESS_ORIGIN_MAINTENANCE"); assert.doesNotMatch(JSON.stringify(error), /private cause/); return true; });
  assert.deepEqual(f.events, []);
  const g = fixture(); g.operations.prepare = ({ withMaintenance }) => withMaintenance(receipt, null);
  await assert.rejects(run(g)); assert.equal(g.events.includes("publish"), false); assert.equal(g.events.includes("start"), false);
});

test("forced or nonzero termination never reaches the contract publication or resumes", async () => {
  for (const stop of [async () => { throw new Error("Synthetic forced termination"); }, async () => ({ exitCode: 1, signal: null }), async () => ({ exitCode: 0, signal: "SIGKILL" })]) {
    const f = fixture(); f.runtime.stop = stop;
    await assert.rejects(run(f)); assert.equal(f.events.includes("publish"), false); assert.equal(f.events.includes("start"), false);
  }
});

test("uncertain publication, changed source/lease and cancellation all prevent reopening", async () => {
  for (const mode of ["publication", "source", "lease", "abort"]) {
    const f = fixture(), controller = new AbortController();
    if (mode === "source") f.source = async () => { if (f.runtime.state().status === "stopped") throw new Error("Synthetic source drift"); };
    f.operations.prepare = async ({ assertQuiescent, withMaintenance }) => withMaintenance(async () => {
      await assertQuiescent(); if (mode === "publication") throw new Error("Synthetic lost acknowledgement");
      if (mode === "abort") controller.abort(); return receipt();
    }, async () => { if (mode === "lease" && f.runtime.state().status === "stopped") throw new Error("Synthetic changed lease"); });
    await assert.rejects(run(f, { signal: controller.signal }));
    assert.equal(f.runtime.state().status, "stopped"); assert.equal(f.events.includes("start"), false);
  }
});

test("cleanup failure after a resumed lease callback stops that process and never returns success", async () => {
  const f = fixture(), prepare = f.operations.prepare;
  f.operations.prepare = async args => { await prepare(args); throw new Error("Synthetic descriptor cleanup failure"); };
  await assert.rejects(run(f)); assert.equal(f.runtime.state().status, "stopped");
  assert.deepEqual(f.events, ["check", "lease", "stop", "publish", "start", "release", "stop"]);
});

test("a skipped or repeated maintenance callback and a failed ready restart never certify preparation", async () => {
  for (const mode of ["skipped", "repeated", "restart"]) {
    const f = fixture();
    if (mode === "skipped") f.operations.prepare = async () => receipt();
    if (mode === "repeated") f.operations.prepare = async ({ withMaintenance }) => {
      await withMaintenance(receipt, async () => {}); return withMaintenance(receipt, async () => {});
    };
    if (mode === "restart") f.runtime.start = async () => { throw new Error("Synthetic restart failure"); };
    await assert.rejects(run(f));
    if (mode !== "skipped") assert.equal(f.runtime.state().status, "stopped");
  }
});
