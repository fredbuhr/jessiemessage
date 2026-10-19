import test from "node:test";
import assert from "node:assert/strict";
import { main } from "../scripts/start-recurring-private-messaging.mjs";
import { parseRecurringArguments } from "../server/backup/recurring-supervisor.mjs";

const environment = { JESSIEMESSAGE_PRIVATE_PATH_MODE: "linux-dirfd", PORT: "3000" };
const args = command => [command, "--runtime-directory", "/srv/app-reviewed", "--runtime-head", "a".repeat(40), "--runtime-tree", "b".repeat(40),
  "--private-directory", "/srv/private-runtime", "--operations-directory", "/srv/private-backups", "--private-path-mode", "linux-dirfd",
  "--witness-operator-directory", "/srv/witness-origin", "--witness-contract-sha256", "d".repeat(64)];
const forbidden = () => assert.fail("Recovery must not construct an application, producer, enrollment, monitor or mail worker");
const dependencies = { environment, execArgv: [], preflight: forbidden, makeSupervisor: forbidden, makeMonitor: forbidden,
  makeAlerts: forbidden, makeWitnessOrigin: forbidden, makeWitnessObserver: forbidden };
const failure = () => Object.assign(new Error("Synthetic private failure"), { code: "WITNESS_RECOVERY_UNAVAILABLE" });
function fixture(controller, at = "") {
  const events = [], reports = []; let finish;
  const maybeAbort = stage => { if (at === stage) controller.abort(); };
  const recovery = { handler: async () => false,
    async check() { events.push("check"); maybeAbort("check"); return { status: "passed", started: false, externalWitnessConfirmed: false, closuresEnabled: false }; },
    async start() { events.push("control"); maybeAbort("control"); return { status: "started", mode: "recovery_only", closuresEnabled: false }; },
    async close() { events.push("recovery-close"); },
  };
  const listener = { async start() { events.push("listen"); maybeAbort("listen"); }, assertReady() {},
    finished: new Promise(resolve => { finish = resolve; }), async close() { events.push("listener-close"); finish({ failed: false }); } };
  return { events, reports, recovery, listener, finish,
    options: { ...dependencies, signal: controller.signal,
      async makeWitnessRecovery(selected) { events.push("construct"); assert.match(selected.command, /^(?:check|start)-witness-recovery$/); maybeAbort("construct"); return recovery; },
      makeRecoveryServer(selected) { events.push("server"); assert.equal(selected.port, 3000); assert.equal(selected.control, recovery.handler); return listener; },
      outputStream: { write(line) { reports.push(JSON.parse(line)); events.push("report"); } } } };
}

test("recovery commands require the original contract and the same disjoint pinned paths", () => {
  for (const command of ["check-witness-recovery", "start-witness-recovery"]) {
    assert.equal(parseRecurringArguments(args(command)).command, command);
    for (const invalid of [args(command).slice(0, 13), [...args(command), "--offline", "true"],
      args(command).map(x => x === "d".repeat(64) ? "D".repeat(64) : x),
      args(command).map(x => x === "--witness-contract-sha256" ? "--witness-plan-sha256" : x),
      args(command).map(x => x === "/srv/witness-origin" ? "/srv/private-backups/inside" : x)])
      assert.throws(() => parseRecurringArguments(invalid), { code: "RECURRING_SUPERVISOR_USAGE" });
  }
});
test("recovery check is read-only and closes on success or authority refusal", async () => {
  for (const rejected of [false, true]) {
    const f = fixture(new AbortController()); f.options.makeRecoveryServer = forbidden;
    if (rejected) f.recovery.check = async () => { f.events.push("check"); throw failure(); };
    const result = main(args("check-witness-recovery"), f.options);
    if (rejected) { await assert.rejects(result, { code: "WITNESS_RECOVERY_UNAVAILABLE" }); assert.equal(f.reports.length, 0); }
    else { assert.equal((await result).started, false); assert.equal(f.reports[0].externalWitnessConfirmed, false); }
    assert.equal(f.events.at(-1), "recovery-close");
    assert.ok(!f.events.includes("listen") && !f.events.includes("control"));
  }
});
test("recovery startup reserves HTTP before Unix and reports only after both are ready", async () => {
  const controller = new AbortController(), f = fixture(controller);
  f.options.outputStream.write = line => { f.reports.push(JSON.parse(line)); f.events.push("report"); controller.abort(); };
  const result = await main(args("start-witness-recovery"), f.options);
  assert.equal(result.status, "stopped");
  assert.deepEqual(f.events.slice(0, 6), ["construct", "check", "server", "listen", "control", "report"]);
  assert.equal(f.reports.length, 1); assert.equal(f.reports[0].closuresEnabled, false);
  assert.ok(f.events.includes("recovery-close") && f.events.includes("listener-close"));
});
test("port or private-control collision never reports startup and releases the newly created resources", async () => {
  for (const stage of ["listen", "control"]) {
    const f = fixture(new AbortController());
    (stage === "listen" ? f.listener : f.recovery).start = async () => { f.events.push(stage); throw failure(); };
    await assert.rejects(main(args("start-witness-recovery"), f.options), { code: "WITNESS_RECOVERY_UNAVAILABLE" });
    assert.equal(f.reports.length, 0); assert.ok(f.events.includes("recovery-close") && f.events.includes("listener-close"));
    if (stage === "listen") assert.ok(!f.events.includes("control"));
  }
});
test("cancellation at every startup boundary releases resources without a started report", async () => {
  for (const stage of ["construct", "check", "listen", "control"]) {
    const f = fixture(new AbortController(), stage);
    await assert.rejects(main(args("start-witness-recovery"), f.options), { code: "RECURRING_SUPERVISOR_ABORTED" });
    assert.equal(f.reports.length, 0); assert.ok(f.events.includes("recovery-close"));
    if (["listen", "control"].includes(stage)) assert.ok(f.events.includes("listener-close"));
  }
});
test("an unexpected listener failure ends recovery and closes its private control", async () => {
  const f = fixture(new AbortController()); f.listener.finished = Promise.resolve({ failed: true });
  await assert.rejects(main(args("start-witness-recovery"), f.options), { code: "RECURRING_SUPERVISOR_RUNTIME" });
  assert.ok(f.events.includes("recovery-close") && f.events.includes("listener-close"));
});
test("a listener lost while the Unix control opens cannot emit a started report", async () => {
  const f = fixture(new AbortController()); f.listener.assertReady = () => { throw failure(); };
  await assert.rejects(main(args("start-witness-recovery"), f.options), { code: "WITNESS_RECOVERY_UNAVAILABLE" });
  assert.equal(f.reports.length, 0); assert.ok(f.events.includes("recovery-close") && f.events.includes("listener-close"));
});
test("recovery rejects ambient application environment and prior cancellation before any composition", async () => {
  await assert.rejects(main(args("start-witness-recovery"), { ...dependencies, makeWitnessRecovery: forbidden,
    environment: { ...environment, JESSIEMESSAGE_CRM_KEY: "forbidden" } }), { code: "RECURRING_SUPERVISOR_ENVIRONMENT" });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(main(args("start-witness-recovery"), { ...dependencies, signal: controller.signal, makeWitnessRecovery: forbidden }), { code: "RECURRING_SUPERVISOR_ABORTED" });
});
