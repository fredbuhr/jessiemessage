import test from "node:test";
import assert from "node:assert/strict";
import { runWitnessObservationMaintenance } from "../server/backup/witness-observation-maintenance.mjs";

const code = "WITNESS_OBSERVATION_MAINTENANCE";
const privateFailure = () => Object.assign(new Error("Synthetic private configuration SQL and /private/path must not escape"), { code: "PRIVATE_DETAIL", cause: "Synthetic private cause" });
const neutral = error => {
  assert.equal(error?.code, code);
  assert.equal(error.cause, undefined);
  assert.doesNotMatch(`${error.message} ${JSON.stringify(error)}`, /Synthetic|PRIVATE_DETAIL|configuration|SQL|\/private\/path/);
  return true;
};

function fixture() {
  let state = "running", held = false;
  const events = [], controller = new AbortController();
  const runtime = { state: () => ({ status: state }),
    async stop() { events.push("stop"); state = "stopped"; return { exitCode: 0, signal: null }; },
    async start() { assert.equal(held, true); events.push("start"); state = "running"; },
  };
  const input = { runtime, directory: "/synthetic-observation-only", signal: controller.signal,
    async source() { assert.equal(held, true); },
    async work(assertQuiescent) { events.push("work"); await assertQuiescent(); return { observed: true, closuresEnabled: false }; },
    async verifyResume(assertQuiescent) { events.push("verify-resume"); await assertQuiescent(); },
  };
  const internal = { async lock(directory, work, options) {
    assert.equal(directory, input.directory); assert.equal(options.signal, controller.signal);
    assert.equal(held, false); held = true; events.push("lease");
    try { return await work({ async assertReady() { assert.equal(held, true); } }); }
    finally { held = false; events.push("cleanup"); }
  } };
  return { events, runtime, input, internal, controller, held: () => held, state: value => { state = value; } };
}
const run = f => runWitnessObservationMaintenance(f.input, f.internal);

test("observer maintenance retains one capture lease through verified zero exit, work, independent revalidation and ready restart", async () => {
  const f = fixture();
  assert.deepEqual(await run(f), { observed: true, closuresEnabled: false });
  assert.deepEqual(f.events, ["lease", "stop", "work", "verify-resume", "start", "cleanup"]);
  assert.equal(f.runtime.state().status, "running"); assert.equal(f.held(), false);
});

test("a failed observer exchange preserves its consumer error only after independent verification, restart and lease cleanup", async () => {
  const f = fixture(), failure = Object.assign(new Error("Neutral exchange unavailable"), { code: "WITNESS_EXCHANGE_UNAVAILABLE" });
  f.input.work = async quiescent => { f.events.push("work"); await quiescent(); throw failure; };
  await assert.rejects(run(f), error => error === failure);
  assert.deepEqual(f.events, ["lease", "stop", "work", "verify-resume", "start", "cleanup"]);
  assert.equal(f.runtime.state().status, "running"); assert.equal(f.held(), false);
});

test("even throwing undefined is a failed exchange and cannot become a successful observation", async () => {
  const f = fixture(); f.input.work = async () => { f.events.push("work"); throw undefined; };
  let rejected = false;
  await run(f).then(() => assert.fail("A thrown undefined must remain a rejection"), error => { rejected = true; assert.equal(error, undefined); });
  assert.equal(rejected, true); assert.equal(f.runtime.state().status, "running");
  assert.deepEqual(f.events, ["lease", "stop", "work", "verify-resume", "start", "cleanup"]);
});

test("unverified or forced termination never invokes observer work, independent verification or startup", async () => {
  for (const receipt of [undefined, {}, { exitCode: 1, signal: null }, { exitCode: 0, signal: "SIGKILL" }, "throws"]) {
    const f = fixture(), stop = f.runtime.stop;
    f.runtime.stop = async () => { await stop(); if (receipt === "throws") throw privateFailure(); return receipt; };
    await assert.rejects(run(f), neutral);
    assert.equal(f.runtime.state().status, "stopped"); assert.equal(f.events.includes("work"), false);
    assert.equal(f.events.includes("verify-resume"), false); assert.equal(f.events.includes("start"), false);
  }
});

test("independent resume verification failure prevents startup even if observer work succeeded or failed", async () => {
  for (const failedWork of [false, true]) {
    const f = fixture();
    if (failedWork) f.input.work = async () => { f.events.push("work"); throw Object.assign(new Error("Neutral exchange error"), { code: "WITNESS_EXCHANGE_UNAVAILABLE" }); };
    f.input.verifyResume = async quiescent => { f.events.push("verify-resume"); await quiescent(); throw privateFailure(); };
    await assert.rejects(run(f), neutral);
    assert.deepEqual(f.events.slice(0, 4), ["lease", "stop", "work", "verify-resume"]);
    assert.ok(f.events.slice(4).every(event => ["stop", "cleanup"].includes(event)));
    assert.equal(f.events.filter(event => event === "cleanup").length, 1); assert.equal(f.events.includes("start"), false);
    assert.equal(f.runtime.state().status, "stopped");
  }
});

test("source or lease drift while stopped prevents exchange or verified startup", async () => {
  for (const failure of ["source", "lease"]) {
    const f = fixture();
    if (failure === "source") f.input.source = async () => { if (f.runtime.state().status === "stopped") throw privateFailure(); };
    else {
      const lock = f.internal.lock;
      f.internal.lock = (directory, work, options) => lock(directory, lease => work({ async assertReady() {
        await lease.assertReady(); if (f.runtime.state().status === "stopped") throw privateFailure();
      } }), options);
    }
    await assert.rejects(run(f), neutral);
    assert.equal(f.events.includes("work"), false); assert.equal(f.events.includes("start"), false);
    assert.equal(f.runtime.state().status, "stopped");
  }
});

test("failed restart or a restart without actual running state leaves the daily runtime stopped", async () => {
  for (const kind of ["throws", "not-running", "source-after-start", "lease-after-start"]) {
    const f = fixture(), start = f.runtime.start; let restarted = false;
    f.runtime.start = async () => {
      if (kind === "throws") { f.events.push("start"); throw privateFailure(); }
      await start(); restarted = true; if (kind === "not-running") f.state("starting");
    };
    if (kind === "source-after-start") f.input.source = async () => { if (restarted) throw privateFailure(); };
    if (kind === "lease-after-start") {
      const lock = f.internal.lock;
      f.internal.lock = (directory, work, options) => lock(directory, lease => work({ async assertReady() {
        await lease.assertReady(); if (restarted) throw privateFailure();
      } }), options);
    }
    await assert.rejects(run(f), neutral);
    assert.equal(f.runtime.state().status, "stopped");
    assert.ok(f.events.lastIndexOf("stop") > f.events.indexOf("start"));
    assert.equal(f.events.filter(event => event === "cleanup").length, 1);
  }
});

test("cancellation before stop, during exchange, during revalidation, after start or during cleanup never reports success", async () => {
  for (const stage of ["initial", "exchange", "verification", "restart", "cleanup"]) {
    const f = fixture();
    if (stage === "initial") f.controller.abort();
    if (stage === "exchange") { const work = f.input.work; f.input.work = async ready => { const value = await work(ready); f.controller.abort(); return value; }; }
    if (stage === "verification") { const verify = f.input.verifyResume; f.input.verifyResume = async ready => { await verify(ready); f.controller.abort(); }; }
    if (stage === "restart") { const start = f.runtime.start; f.runtime.start = async () => { await start(); f.controller.abort(); }; }
    if (stage === "cleanup") { const lock = f.internal.lock; f.internal.lock = async (...args) => { const result = await lock(...args); f.controller.abort(); return result; }; }
    await assert.rejects(run(f), neutral);
    if (stage === "initial") { assert.equal(f.runtime.state().status, "running"); assert.deepEqual(f.events, ["lease", "cleanup"]); }
    else assert.equal(f.runtime.state().status, "stopped");
    if (["exchange", "verification"].includes(stage)) assert.equal(f.events.includes("start"), false);
  }
});

test("invalid runtime states and missing capabilities cannot enter a maintenance stop or exchange", async () => {
  for (const state of ["stopped", "starting", "stopping", "closed", undefined]) {
    const f = fixture(); f.state(state);
    await assert.rejects(run(f), neutral); assert.deepEqual(f.events, ["lease", "cleanup"]);
  }
  for (const field of ["source", "work", "verifyResume"]) {
    const f = fixture(); f.input[field] = null;
    await assert.rejects(run(f), neutral); assert.deepEqual(f.events, []);
  }
  for (const field of ["state", "start", "stop"]) {
    const f = fixture(); f.runtime[field] = null;
    await assert.rejects(run(f), neutral); assert.deepEqual(f.events, []);
  }
});

test("lock acquisition failure or a skipped capture callback cannot fabricate observer success", async () => {
  for (const kind of ["acquisition-failed", "callback-skipped"]) {
    const f = fixture(); f.internal.lock = async () => { if (kind === "acquisition-failed") throw privateFailure(); };
    await assert.rejects(run(f), neutral);
    assert.deepEqual(f.events, []); assert.equal(f.runtime.state().status, "running");
  }
});

test("a repeated capture callback or an unexpectedly running child cannot exchange twice or bypass quiescence", async () => {
  const repeated = fixture(), lock = repeated.internal.lock;
  repeated.internal.lock = (directory, work, options) => lock(directory, async lease => { await work(lease); return work(lease); }, options);
  await assert.rejects(run(repeated), neutral);
  assert.equal(repeated.events.filter(event => event === "work").length, 1);
  assert.equal(repeated.events.filter(event => event === "start").length, 1);
  assert.equal(repeated.runtime.state().status, "stopped");
  const resumed = fixture();
  resumed.input.work = async quiescent => { resumed.events.push("work"); await quiescent(); resumed.state("running"); };
  await assert.rejects(run(resumed), neutral);
  assert.equal(resumed.events.includes("verify-resume"), false); assert.equal(resumed.events.includes("start"), false);
  assert.equal(resumed.runtime.state().status, "stopped");
});

test("lease or descriptor cleanup failure after restart stops that process and replaces observer outcomes with the neutral failure", async () => {
  for (const failedWork of [false, true]) {
    const f = fixture(), lock = f.internal.lock;
    if (failedWork) f.input.work = async () => { f.events.push("work"); throw Object.assign(new Error("Neutral exchange error"), { code: "WITNESS_EXCHANGE_UNAVAILABLE" }); };
    f.internal.lock = async (...args) => { await lock(...args); throw privateFailure(); };
    await assert.rejects(run(f), neutral);
    assert.equal(f.runtime.state().status, "stopped");
    assert.deepEqual(f.events, ["lease", "stop", "work", "verify-resume", "start", "cleanup", "stop"]);
  }
});
