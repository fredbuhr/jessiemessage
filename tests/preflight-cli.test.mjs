import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { main, parsePreflightArguments } from "../scripts/preflight.mjs";
import { makePreflightReport, preflightFailure, preflightExitCode } from "../server/preflight/report.mjs";
import { CONFIG_CHECK_NAMES } from "../server/preflight/config.mjs";
import { PLATFORM_CHECK_NAMES } from "../server/preflight/platform.mjs";
import { DATABASE_CHECK_NAMES } from "../server/preflight/database.mjs";

const origin = "https://preprod.jessiemessage.com";
const secret = "SYNTHETIC_PRIVATE_SENTINEL_DO_NOT_PRINT";
const success = (names) => ({ valid: true, checks: names.map((name) => ({ name, status: "pass" })),
  ...(names === DATABASE_CHECK_NAMES ? { privilegeObservation: { profile: "strict", source: "show_grants",
    ledgerWritable: false, tempTables: false, tableLocks: false, permanentDdl: false } } : {}),
});

test("preflight requires exact explicit command confirmations and refuses dangerous or ambiguous arguments", () => {
  assert.deepEqual(parsePreflightArguments(["config", "--offline", "--origin", origin]), { command: "config", expectedOrigin: origin });
  assert.deepEqual(parsePreflightArguments(["platform", "--offline"]), { command: "platform", scratch: null });
  assert.deepEqual(parsePreflightArguments(["platform", "--offline", "--scratch", "/private/new-synthetic-probe"]), { command: "platform", scratch: "/private/new-synthetic-probe" });
  assert.deepEqual(parsePreflightArguments(["database", "--offline", "--database", "synthetic_db", "--confirm-database", "synthetic_db"]), { command: "database", databaseName: "synthetic_db" });
  for (const args of [[], ["database", "--offline"], ["config", "--origin", origin],
    ["config", "--offline", "--origin", "https://jessiemessage.com"],
    ["config", "--offline", "--origin", "https://www.jessiemessage.com"],
    ["config", "--offline", "--origin", "https://preprod.jessiemessage.com.evil.invalid"],
    ["config", "--offline", "--origin", `${origin}/`],
    ["config", "--offline", "--origin", `https://${secret}@preprod.jessiemessage.com`],
    ["platform", "--offline", "--scratch", "relative"], ["platform", "--offline", "--scratch", "/private/../other"],
    ["platform", "--offline", "--scratch", "/private/control\npath"],
    ["database", "--offline", "--database", "synthetic_db", "--confirm-database", "other_db"],
    ["database", "--offline", "--database", "db;DROP TABLE users", "--confirm-database", "db;DROP TABLE users"],
    ["platform", "--offline", "--force"], ["config", "--offline", "--origin", origin, "--send-mail"]]) {
    assert.throws(() => parsePreflightArguments(args), { code: "PREFLIGHT_USAGE" });
  }
});

test("report rebuilds a closed DTO and never serializes extra values, getters or toJSON hooks", () => {
  let invoked = 0;
  const result = success(PLATFORM_CHECK_NAMES);
  result.secret = secret; result.toJSON = () => { invoked++; throw new Error(secret); };
  Object.defineProperty(result, "privateGetter", { get() { invoked++; throw new Error(secret); } });
  result.checks[0].path = secret; result.checks[0].toJSON = () => { invoked++; return secret; };
  const report = makePreflightReport("platform", result);
  assert.equal(report.status, "checks_passed"); assert.equal(preflightExitCode(report), 0);
  assert.equal(report.launchApproved, false); assert.equal(report.operatorOfflineVerified, false);
  assert.equal(invoked, 0); assert.doesNotMatch(JSON.stringify(report), new RegExp(secret));
  assert.deepEqual(report.checks.map((item) => Object.keys(item)), PLATFORM_CHECK_NAMES.map(() => ["name", "status"]));
  assert.ok(report.remainingChecks.includes("media_persistence")); assert.ok(report.remainingChecks.includes("secret_provenance"));
});

test("unrun checks remain incomplete and blocked checks cannot masquerade as a passing report", () => {
  const partial = success(PLATFORM_CHECK_NAMES); partial.checks.pop();
  const report = makePreflightReport("platform", partial);
  assert.equal(report.status, "incomplete"); assert.equal(preflightExitCode(report), 3);
  assert.equal(report.checks.at(-1).status, "not_checked");
  const failed = success(CONFIG_CHECK_NAMES); failed.valid = false; failed.checks[0].status = "fail";
  assert.equal(makePreflightReport("config", failed).status, "blocked");
  failed.valid = true; assert.throws(() => makePreflightReport("config", failed), { code: "PREFLIGHT_REPORT" });
  assert.equal(preflightExitCode(preflightFailure("config", "PREFLIGHT_USAGE")), 2);
  assert.equal(preflightFailure(secret, secret).error, "PREFLIGHT_OPERATION");
  assert.equal(preflightFailure(secret).command, "unavailable");
});

test("hostile known fields, unknown statuses and duplicate checks are rejected without reading their getters", () => {
  let invoked = 0;
  const accessor = { valid: true };
  Object.defineProperty(accessor, "checks", { get() { invoked++; throw new Error(secret); } });
  assert.throws(() => makePreflightReport("config", accessor), { code: "PREFLIGHT_REPORT" });
  const item = {};
  Object.defineProperty(item, "name", { get() { invoked++; return secret; } });
  for (const checks of [[item], [{ name: secret, status: "pass" }], [{ name: CONFIG_CHECK_NAMES[0], status: secret }],
    [{ name: CONFIG_CHECK_NAMES[0], status: "pass" }, { name: CONFIG_CHECK_NAMES[0], status: "pass" }]]) {
    assert.throws(() => makePreflightReport("config", { valid: true, checks }), { code: "PREFLIGHT_REPORT" });
  }
  assert.equal(invoked, 0);
});

test("database reports rebuild only validated fixed privilege observations and reject invented evidence", () => {
  const result = success(DATABASE_CHECK_NAMES);
  result.privilegeObservation.profile = "infomaniak-shared";
  for (const field of ["ledgerWritable", "tempTables", "tableLocks"]) result.privilegeObservation[field] = true;
  result.privilegeObservation.secret = secret;
  let invoked = 0;
  result.privilegeObservation.toJSON = () => { invoked++; return secret; };
  const report = makePreflightReport("database", result);
  assert.deepEqual(report.privilegeObservation, { profile: "infomaniak-shared", source: "show_grants",
    ledgerWritable: true, tempTables: true, tableLocks: true, permanentDdl: false });
  assert.equal(invoked, 0); assert.doesNotMatch(JSON.stringify(report), new RegExp(secret));
  const deceptive = success(DATABASE_CHECK_NAMES);
  deceptive.privilegeObservation = { profile: "infomaniak-shared", source: "show_grants",
    ledgerWritable: false, tempTables: true, tableLocks: true, permanentDdl: false };
  assert.throws(() => makePreflightReport("database", deceptive), { code: "PREFLIGHT_REPORT" });
  for (const field of ["profile", "source", "ledgerWritable", "tempTables", "tableLocks", "permanentDdl"]) {
    const invalid = success(DATABASE_CHECK_NAMES);
    invalid.privilegeObservation[field] = secret;
    assert.throws(() => makePreflightReport("database", invalid), { code: "PREFLIGHT_REPORT" });
    Object.defineProperty(invalid.privilegeObservation, field, { get() { invoked++; return secret; } });
    assert.throws(() => makePreflightReport("database", invalid), { code: "PREFLIGHT_REPORT" });
  }
  assert.equal(invoked, 0);
  const blocked = success(DATABASE_CHECK_NAMES); blocked.valid = false;
  blocked.checks.find((check) => check.name === "privileges").status = "fail";
  assert.throws(() => makePreflightReport("database", blocked), { code: "PREFLIGHT_REPORT" });
  blocked.privilegeObservation = { profile: "infomaniak-shared", source: "unverified",
    ledgerWritable: null, tempTables: null, tableLocks: null, permanentDdl: null };
  assert.equal(makePreflightReport("database", blocked).privilegeObservation.permanentDdl, null);
  blocked.privilegeObservation.permanentDdl = false;
  assert.throws(() => makePreflightReport("database", blocked), { code: "PREFLIGHT_REPORT" });
});

test("pattern reports retain only fixed current-namespace evidence and the explicit future limitation", () => {
  const observation = {
    profile: "infomaniak-shared-pattern", source: "show_grants_and_visible_schemata",
    ledgerWritable: true, tempTables: true, tableLocks: true, permanentDdl: false,
    databaseNamePattern: true, visibleApplicationNamespace: "selected_only", futureMatchingDatabasesUnproven: true,
  };
  const result = success(DATABASE_CHECK_NAMES); result.privilegeObservation = { ...observation, private_value: secret };
  let reads = 0;
  Object.defineProperty(result.privilegeObservation, "ignoredPrivateGetter", { get() { reads += 1; return secret; } });
  const report = makePreflightReport("database", result);
  assert.deepEqual(report.privilegeObservation, observation);
  assert.equal(report.launchApproved, false);
  assert.doesNotMatch(JSON.stringify(report), new RegExp(secret));
  for (const field of ["databaseNamePattern", "visibleApplicationNamespace", "futureMatchingDatabasesUnproven"]) {
    for (const value of [secret, false, null]) {
      const invalid = success(DATABASE_CHECK_NAMES); invalid.privilegeObservation = { ...observation, [field]: value };
      assert.throws(() => makePreflightReport("database", invalid), { code: "PREFLIGHT_REPORT" });
    }
    const invalid = success(DATABASE_CHECK_NAMES); invalid.privilegeObservation = { ...observation };
    Object.defineProperty(invalid.privilegeObservation, field, { get() { reads += 1; return secret; } });
    assert.throws(() => makePreflightReport("database", invalid), { code: "PREFLIGHT_REPORT" });
  }
  for (const source of ["show_grants", "unverified", secret]) {
    const invalid = success(DATABASE_CHECK_NAMES); invalid.privilegeObservation = { ...observation, source };
    assert.throws(() => makePreflightReport("database", invalid), { code: "PREFLIGHT_REPORT" });
  }
  assert.equal(reads, 0);
  const blocked = success(DATABASE_CHECK_NAMES); blocked.valid = false;
  blocked.checks.find(({ name }) => name === "privileges").status = "fail";
  blocked.privilegeObservation = { profile: "infomaniak-shared-pattern", source: "unverified",
    ledgerWritable: null, tempTables: null, tableLocks: null, permanentDdl: null,
    databaseNamePattern: null, visibleApplicationNamespace: null, futureMatchingDatabasesUnproven: null };
  assert.deepEqual(makePreflightReport("database", blocked).privilegeObservation, blocked.privilegeObservation);
  blocked.privilegeObservation.futureMatchingDatabasesUnproven = true;
  assert.throws(() => makePreflightReport("database", blocked), { code: "PREFLIGHT_REPORT" });
  const legacy = success(DATABASE_CHECK_NAMES); legacy.privilegeObservation.source = "show_grants_and_visible_schemata";
  assert.throws(() => makePreflightReport("database", legacy), { code: "PREFLIGHT_REPORT" });
});

test("each command calls only its own inspector and keeps private configuration out of its public report", async () => {
  const env = { PRIVATE_SENTINEL: secret, JESSIEMESSAGE_MEDIA_ROOT: "/private/synthetic-media" };
  for (const [command, args, names, selected] of [
    ["config", ["--origin", origin], CONFIG_CHECK_NAMES, "inspectConfiguration"],
    ["platform", [], PLATFORM_CHECK_NAMES, "inspectPlatform"],
    ["database", ["--database", "synthetic_db", "--confirm-database", "synthetic_db"], DATABASE_CHECK_NAMES, "inspectDatabase"],
  ]) {
    const calls = [];
    const dependencies = Object.fromEntries(["inspectConfiguration", "inspectPlatform", "inspectDatabase"].map((name) => [name, (...received) => {
      calls.push(name); assert.equal(name, selected);
      if (name === "inspectConfiguration") { assert.equal(received[0], env); assert.deepEqual(received[1], { target: "auth-only", expectedOrigin: origin }); }
      else if (name === "inspectPlatform") assert.deepEqual(received[0], { scratch: null, mediaRoot: env.JESSIEMESSAGE_MEDIA_ROOT });
      else { assert.equal(received[0].env, env); assert.equal(received[0].databaseName, "synthetic_db"); }
      return { ...success(names), secret };
    }]));
    const { report, exitCode } = await main([command, "--offline", ...args], env, dependencies);
    assert.equal(exitCode, 0); assert.deepEqual(calls, [selected]);
    assert.equal(report.command, command); assert.doesNotMatch(JSON.stringify(report), new RegExp(secret));
    assert.equal(report.launchApproved, false); assert.equal(report.operatorOfflineVerified, false);
  }
});

test("the real default platform command checks Node and Sharp without a scratch write or a private service", async () => {
  const { report, exitCode } = await main(["platform", "--offline"], {});
  assert.equal(report.status, "incomplete"); assert.equal(exitCode, 3);
  assert.deepEqual(report.checks, [
    { name: "node_runtime", status: "pass" },
    { name: "sharp_jpeg", status: "pass" },
    { name: "scratch_filesystem", status: "not_checked" },
  ]);
  assert.equal(report.launchApproved, false); assert.equal(report.operatorOfflineVerified, false);
});

test("usage errors, unexpected inspector errors and aborts remain neutral without launching another inspector", async () => {
  let calls = 0;
  const inspectPlatform = () => { calls++; throw Object.assign(new Error(secret), { code: secret, sql: secret, password: secret }); };
  const invalid = await main([secret, "--offline"], {}, { inspectPlatform });
  assert.equal(invalid.exitCode, 2); assert.equal(calls, 0);
  const failure = await main(["platform", "--offline"], {}, { inspectPlatform });
  assert.equal(failure.exitCode, 1); assert.equal(calls, 1);
  assert.equal(failure.report.error, "PREFLIGHT_OPERATION"); assert.doesNotMatch(JSON.stringify(failure), new RegExp(secret));
  const controller = new AbortController(); controller.abort();
  const aborted = await main(["platform", "--offline"], {}, { inspectPlatform, signal: controller.signal });
  assert.equal(aborted.report.error, "PREFLIGHT_ABORTED"); assert.equal(calls, 1);
  const later = new AbortController();
  const after = await main(["platform", "--offline"], {}, { signal: later.signal,
    inspectPlatform() { later.abort(); return success(PLATFORM_CHECK_NAMES); } });
  assert.equal(after.report.error, "PREFLIGHT_ABORTED");
});

test("the executable emits one neutral JSON line and nonzero usage status without echoing private arguments", async () => {
  const child = spawn(process.execPath, ["scripts/preflight.mjs", secret, "--offline"], {
    cwd: new URL("../", import.meta.url), env: { ...process.env, PREFLIGHT_SYNTHETIC_SECRET: secret }, stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "", stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; }); child.stderr.on("data", (chunk) => { stderr += chunk; });
  const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); });
  assert.equal(code, 2); assert.equal(stderr, ""); assert.equal(stdout.trim().split("\n").length, 1);
  assert.equal(JSON.parse(stdout).error, "PREFLIGHT_USAGE"); assert.doesNotMatch(stdout, new RegExp(secret));
});
