import test from "node:test";
import assert from "node:assert/strict";
import { main } from "../scripts/start-recurring-private-messaging.mjs";
import { parseRecurringArguments } from "../server/backup/recurring-supervisor.mjs";
import { resumeManagedLocalClosureRuntime } from "../server/backup/managed-closures.mjs";

const environment = { JESSIEMESSAGE_PRIVATE_PATH_MODE: "linux-dirfd", PORT: "3000" };
const args = command => [command, "--runtime-directory", "/srv/reviewed-runtime", "--runtime-head", "a".repeat(40), "--runtime-tree", "b".repeat(40),
  "--private-directory", "/srv/private-config", "--operations-directory", "/srv/private-backups", "--private-path-mode", "linux-dirfd"];
const forbidden = () => assert.fail("A local closure must not construct an external witness");
const noWitness = { makeWitnessOrigin: forbidden, makeWitnessObserver: forbidden, makeWitnessRecovery: forbidden, makeRecoveryServer: forbidden };

test("local closure modes are explicit and accept no witness parameters", () => {
  for (const command of ["check-local-closures", "start-local-closures"]) {
    assert.equal(parseRecurringArguments(args(command)).command, command);
    assert.throws(() => parseRecurringArguments([...args(command), "--witness-contract-sha256", "c".repeat(64)]));
  }
});

test("local check remains read-only and closes resources on success or failure", async () => {
  for (const reject of [false, true]) {
    const events = []; let output = "";
    const report = { type: "local_closure_precheck", started: false, erased: false };
    const run = main(args("check-local-closures"), { environment, execArgv: [], ...noWitness,
      async preflight() { events.push("preflight"); },
      async makeLocalClosures() { events.push("context"); return { async check() { events.push("check"); if (reject) throw new Error("Synthetic failure"); return report; },
        async close() { events.push("close"); } }; },
      makeSupervisor: forbidden, makeMonitor: forbidden, makeAlerts: forbidden,
      outputStream: { write(value) { output += value; } } });
    if (reject) { await assert.rejects(run); assert.equal(output, ""); }
    else { assert.deepEqual(await run, report); assert.deepEqual(JSON.parse(output), report); }
    assert.deepEqual(events, ["preflight", "context", "check", "close"]);
  }
});

test("local start composes the existing supervisor and closes the owner after the drained child", async () => {
  const events = [], operations = {};
  await main(args("start-local-closures"), { environment, execArgv: [], ...noWitness,
    async preflight() { events.push("preflight"); },
    async makeLocalClosures() { return { operations, async close() { events.push("local-close"); } }; },
    makeSupervisor(selected, dependencies) {
      assert.equal(selected.command, "start"); assert.equal(dependencies.closureOperations, operations);
      assert.equal(dependencies.resumeClosures, resumeManagedLocalClosureRuntime);
      assert.equal(Object.hasOwn(dependencies, "witnessControl"), false);
      return { async start() { events.push("start"); }, async close() { events.push("supervisor-close"); }, finished: Promise.resolve({ failed: false }) };
    },
    makeMonitor() { return { async start() {}, async close() { events.push("monitor-close"); } }; },
    makeAlerts() { return { async close() { events.push("alerts-close"); } }; },
  });
  assert.deepEqual(events, ["preflight", "start", "monitor-close", "supervisor-close", "alerts-close", "local-close"]);
});

test("local construction and child startup failures never leak the parent context", async () => {
  for (const stage of ["construct", "start", "close"]) {
    const events = [];
    await assert.rejects(main(args("start-local-closures"), { environment, execArgv: [], ...noWitness,
      async preflight() {}, async makeLocalClosures() { return { operations: {}, async close() { events.push("local-close"); } }; },
      makeSupervisor() {
        if (stage === "construct") throw new Error("Synthetic construction failure");
        return { async start() { if (stage === "start") throw new Error("Synthetic startup failure"); },
          async close() { events.push("child-close"); if (stage === "close") throw new Error("Synthetic drain failure"); }, finished: Promise.resolve({ failed: false }) };
      }, makeMonitor() { return { async start() {}, async close() {} }; }, makeAlerts() { return { async close() {} }; },
    }));
    assert.equal(events.at(-1), "local-close");
    if (stage !== "construct") assert.ok(events.indexOf("child-close") < events.indexOf("local-close"));
  }
});
