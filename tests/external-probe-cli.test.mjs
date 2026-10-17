import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { main } from "../scripts/check-private-service.mjs";

const report = (healthy = true) => ({ version: 1, type: "private_service_probe", status: healthy ? "healthy" : "unavailable",
  checkedAt: 1792279800000, durationMilliseconds: 2,
  checks: [{ name: "http", status: "pass", code: "ok" },
    { name: "readiness", status: healthy ? "pass" : "fail", code: healthy ? "ok" : "http_status" }] });

test("healthy service stops after one pass and does not wait", async () => {
  let calls = 0;
  const value = await main([], { probe: async () => { calls++; return report(); }, wait: () => assert.fail("unexpected wait") });
  assert.equal(calls, 1); assert.equal(value.exitCode, 0);
  assert.deepEqual(value.report, { version: 1, type: "private_service_check", status: "healthy", attempts: 1,
    confirmedFailure: false, lastProbe: report() });
});

test("transient failures recover without announcing a confirmed outage", async () => {
  for (const recoveryAttempt of [2, 3]) {
    let calls = 0; const waits = [];
    const value = await main([], { probe: async () => report(++calls === recoveryAttempt), wait: async (ms) => { waits.push(ms); } });
    assert.equal(calls, recoveryAttempt); assert.equal(value.exitCode, 0); assert.equal(value.report.attempts, recoveryAttempt);
    assert.equal(value.report.confirmedFailure, false); assert.deepEqual(waits, Array(recoveryAttempt - 1).fill(10000));
  }
});

test("three unsuccessful passes confirm failure with precisely two ten-second waits", async () => {
  let calls = 0; const waits = [];
  const value = await main([], { probe: async () => { calls++; return report(false); }, wait: async (ms) => { waits.push(ms); } });
  assert.equal(calls, 3); assert.deepEqual(waits, [10000, 10000]); assert.equal(value.exitCode, 1);
  assert.equal(value.report.status, "unavailable"); assert.equal(value.report.confirmedFailure, true);
  assert.equal(value.report.attempts, 3); assert.deepEqual(value.report.lastProbe, report(false));
});

test("single-pass mode never pretends to have confirmed three failures", async () => {
  let calls = 0;
  const value = await main(["--once"], { probe: async () => { calls++; return report(false); }, wait: () => assert.fail("unexpected wait") });
  assert.equal(calls, 1); assert.equal(value.exitCode, 1); assert.equal(value.report.confirmedFailure, false);
});

test("destination and timing cannot be overridden by command arguments", async () => {
  for (const args of [["https://private.invalid/token"], ["--url", "secret"], ["--once", "--once"], ["--retries", "1"], null]) {
    const value = await main(args, { probe: () => assert.fail("must not request") });
    assert.deepEqual(value, { report: { version: 1, type: "private_service_check", status: "error", code: "SERVICE_CHECK_USAGE" }, exitCode: 2 });
  }
});

test("unexpected transport, wait and malformed-report failures are sanitized", async () => {
  const secret = "password=private-token";
  for (const dependencies of [
    { probe: async () => { throw new Error(secret); } },
    { probe: async () => report(false), wait: async () => { throw new Error(secret); } },
    { probe: async () => ({ ...report(), private: secret }) },
    { probe: async () => ({ ...report(), status: "unavailable" }) },
  ]) {
    const value = await main([], dependencies);
    assert.equal(value.exitCode, 2); assert.equal(value.report.code, "SERVICE_CHECK_OPERATION");
    assert.doesNotMatch(JSON.stringify(value), /password|private-token/);
  }
  assert.equal((await main([], { probe: null })).report.code, "SERVICE_CHECK_CONFIGURATION");
});

test("the returned DTO owns its data and never invokes untrusted getters or toJSON", async () => {
  const source = report();
  const value = await main([], { probe: async () => source });
  source.checks[0].name = "private";
  assert.equal(value.report.lastProbe.checks[0].name, "http");
  let invoked = false;
  for (const hostile of [Object.defineProperty(report(), "status", { get() { invoked = true; return "healthy"; } }),
    { ...report(), toJSON() { invoked = true; return "secret"; } }]) {
    assert.equal((await main([], { probe: async () => hostile })).exitCode, 2);
  }
  assert.equal(invoked, false);
});

test("CLI rejects an invalid flag offline, prints one safe JSON line and exits two", () => {
  const script = fileURLToPath(new URL("../scripts/check-private-service.mjs", import.meta.url));
  assert.throws(() => execFileSync(process.execPath, [script, "--private-token"], { encoding: "utf8", timeout: 3000 }), (error) => {
    assert.equal(error.status, 2); assert.equal(error.stderr, "");
    assert.deepEqual(JSON.parse(error.stdout), { version: 1, type: "private_service_check", status: "error", code: "SERVICE_CHECK_USAGE" });
    assert.equal(error.stdout.trim().split("\n").length, 1); return true;
  });
});
