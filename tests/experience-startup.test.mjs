import test from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { videoBundle } from "./fixtures/video-private.mjs";
import { inheritedEnv, origin } from "./fixtures/crm-private.mjs";
import { VIDEO_RUNTIME_OPTIONS, loadRuntimeVideoEnvironment } from "../server/config/runtime-video.mjs";
import { parseArguments, run } from "../scripts/start-private-messaging.mjs";
import { parseArguments as childArguments } from "../scripts/private-messaging-child.mjs";
import { parseRecurringArguments, checkpointProcess } from "../server/backup/recurring-supervisor.mjs";
import { createManagedRuntime } from "../server/backup/managed-runtime.mjs";
import { createConfiguredServer } from "../server/index.mjs";
import { DATABASE_CHECK_NAMES } from "../server/preflight/database.mjs";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

const profile = "photos-notify-recovery-crm-broadcast-video";
const directory = "/private/synthetic-video";
const load = () => loadRuntimeVideoEnvironment(directory, VIDEO_RUNTIME_OPTIONS, { readBundle: async () => videoBundle() });
const command = mode => [mode, "--deployment", "primary-transition", "--experience", "1", "--profile", profile,
  "--private-directory", directory, "--private-path-mode", "linux-dirfd"];
const parentArgs = mode => [mode, "--runtime-directory", "/srv/reviewed-runtime", "--runtime-head", "a".repeat(40), "--runtime-tree", "b".repeat(40),
  "--private-directory", "/srv/private-config", "--operations-directory", "/srv/private-backups", "--private-path-mode", "linux-dirfd"];
const privilegeReport = () => ({ valid: true, checks: DATABASE_CHECK_NAMES.map(name => ({ name, status: "pass" })),
  privilegeObservation: { profile: "strict", source: "show_grants", ledgerWritable: false, tempTables: false, tableLocks: false, permanentDdl: false } });

test("experience requires the explicit video closure profile throughout both public CLIs", () => {
  assert.equal(parseArguments(command("check")).experience, true);
  for (const mode of ["check-local-closures", "start-local-closures"]) {
    const selected = parseRecurringArguments([...parentArgs(mode), "--profile", profile, "--experience", "1"]);
    assert.equal(selected.video, true); assert.equal(selected.experience, true);
    assert.equal(Object.hasOwn(parseRecurringArguments([...parentArgs(mode), "--profile", profile]), "experience"), false);
  }
  for (const value of ["0", "true", "", "managed"])
    assert.throws(() => parseArguments(command("check").map((item, index) => index === 4 ? value : item)), { code: "PRIVATE_MESSAGING_USAGE" });
  for (const selectedProfile of ["photos", "photos-notify-recovery-crm-broadcast"])
    assert.throws(() => parseArguments(command("check").map(item => item === profile ? selectedProfile : item)), { code: "PRIVATE_MESSAGING_USAGE" });
  assert.throws(() => parseRecurringArguments([...parentArgs("start-local-closures"), "--experience", "1"]), { code: "RECURRING_SUPERVISOR_USAGE" });
  assert.throws(() => parseRecurringArguments([...parentArgs("start-local-closures"), "--profile", profile, "--experience", "true"]), { code: "RECURRING_SUPERVISOR_USAGE" });
  assert.throws(() => parseArguments([...command("check"), "--experience", "1"]), { code: "PRIVATE_MESSAGING_USAGE" });
});

test("experience reaches every startup gate before the listener and a failed gate prevents startup", async () => {
  const source = await load(), before = structuredClone(source), events = [];
  const dependencies = { inheritedEnv, execArgv: [], managedVideo: true, loadEnvironment: async () => source,
    inspect: async options => { events.push("privileges"); assert.equal(options.video, true); assert.equal(options.experience, true); return privilegeReport(); },
    checkSchema: async (_env, options) => { events.push("schema"); assert.deepEqual(options, { video: true, experience: true }); },
    checkStorage: async (_env, options) => { events.push("photos"); assert.deepEqual(options, { video: true, experience: true }); },
    checkVideoStorage: async (_env, options) => { events.push("videos"); assert.deepEqual(options, { experience: true }); },
    startServer: async (_env, options) => { events.push("listener"); assert.deepEqual(options,
      { requestOrigin: origin, deviceTransition: true, recovery: true, crm: true, broadcast: true, video: true, experience: true }); } };
  assert.equal((await run(parseArguments(command("start")), dependencies)).started, true);
  assert.deepEqual(events, ["privileges", "schema", "photos", "videos", "listener"]);
  assert.deepEqual(source, before);
  for (const phase of ["inspect", "checkSchema", "checkStorage", "checkVideoStorage"]) {
    let started = false;
    await assert.rejects(run(parseArguments(command("start")), { ...dependencies,
      [phase]: async () => { throw Error("synthetic gate failure"); }, startServer: async () => { started = true; } }));
    assert.equal(started, false, phase);
  }
});

test("programmatic experience values cannot silently fall back to the historical schema", async () => {
  for (const experience of [false, "1", "true", null, undefined, 1]) {
    let loaded = false;
    await assert.rejects(run({ ...parseArguments(command("check")), experience }, { inheritedEnv, execArgv: [],
      loadEnvironment: async () => { loaded = true; throw Error("configuration must not be read"); } }), { code: "PRIVATE_MESSAGING_USAGE" });
    assert.equal(loaded, false);
  }
});

test("the configured server rejects experience without video or with an invalid value before configuration reads", async () => {
  const complete = { requestOrigin: origin, deviceTransition: true, recovery: true, crm: true, broadcast: true,
    accountClosures: true, backupDirectory: "/srv/private-backups", video: true, experience: true };
  for (const options of [{ ...complete, video: false }, { ...complete, experience: "1" }, { ...complete, experience: null },
    { ...complete, get experience() { throw Error("must not execute getter"); } }])
    await assert.rejects(createConfiguredServer({}, options), { code: "REQUEST_ORIGIN_CONFIG" });
});

test("the managed IPC child preserves experience through the private CLI and configured server then drains", { timeout: 5000 }, async t => {
  const base = fileURLToPath(new URL("../../audit/", import.meta.url)); await mkdir(base, { recursive: true, mode: 0o700 });
  const temporary = await mkdtemp(join(base, "jm-experience-startup-")), fixture = join(temporary, "child.mjs"), invocations = [], children = [];
  const childUrl = new URL("../scripts/private-messaging-child.mjs", import.meta.url).href;
  await writeFile(fixture, `import assert from 'node:assert/strict';
import {run,parseArguments} from ${JSON.stringify(childUrl)};
await run(parseArguments(process.argv.slice(2)), {async loadRuntime(){return {
  async main(args,dependencies){assert.deepEqual(args,['start','--deployment','primary-transition','--experience','1','--profile',${JSON.stringify(profile)},'--private-directory','/synthetic-private','--private-path-mode','linux-dirfd']);assert.equal(dependencies.managedVideo,true);await dependencies.startServer({}, {requestOrigin:${JSON.stringify(origin)},experience:true});},
  async start(env,options){assert.deepEqual(options,{requestOrigin:${JSON.stringify(origin)},experience:true,backupDirectory:'/synthetic-operations',accountClosures:true,video:true});return {async drain(){process.send({type:'fixture_drained'});return {failed:false,timedOut:false};}};}
};}});
`);
  const environment = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("JESSIEMESSAGE_")
    && !["NODE_OPTIONS", "NODE_PATH", "NODE_EXTRA_CA_CERTS", "NODE_TLS_REJECT_UNAUTHORIZED", "NODE_USE_SYSTEM_CA", "SSL_CERT_FILE", "SSL_CERT_DIR", "OPENSSL_CONF"].includes(name)));
  Object.assign(environment, { JESSIEMESSAGE_PRIVATE_PATH_MODE: "linux-dirfd", PORT: "3000" });
  let drained = false;
  const runtime = createManagedRuntime({ runtimeDirectory: "/synthetic-runtime", privateDirectory: "/synthetic-private",
    operationsDirectory: "/synthetic-operations", port: 3000, environment, accountClosures: true, video: true, experience: true }, {
    startupMilliseconds: 1500, stopMilliseconds: 700, requestMilliseconds: 30, retryMilliseconds: 5,
    fetchClient: async () => new Response('{"status":"ready"}'),
    forkClient(_path, args, settings) { invocations.push(args); const child = fork(fixture, args, settings); children.push(child); child.on("message", message => { if (message.type === "fixture_drained") drained = true; }); return child; },
  });
  t.after(async () => { try { await runtime.destroy(); } catch {} for (const child of children) try { child.kill("SIGKILL"); } catch {} await rm(temporary, { recursive: true, force: true }); });
  assert.deepEqual(await runtime.start(), { ready: true });
  assert.deepEqual(invocations[0].slice(-6), ["--account-closures", "managed", "--video", "managed", "--experience", "managed"]);
  assert.equal(childArguments(invocations[0]).experience, true);
  assert.deepEqual(await runtime.stop(), { exitCode: 0, signal: null }); assert.equal(drained, true);
  const baseArgs = ["--runtime-directory", "/synthetic-runtime", "--private-directory", "/synthetic-private", "--port", "3000"];
  assert.throws(() => childArguments([...baseArgs, "--experience", "managed"]), { code: "PRIVATE_MESSAGING_CHILD" });
  assert.throws(() => createManagedRuntime({ runtimeDirectory: "/synthetic-runtime", privateDirectory: "/synthetic-private", environment, experience: true }), { code: "MANAGED_RUNTIME_CONFIGURATION" });
});

test("experience checkpoint IPC distinguishes 37 tables from 38 ledger migrations", async () => {
  const options = { privateDirectory: "/synthetic-private", operationsDirectory: "/synthetic-operations", video: true, experience: true };
  const receipt = { status: "application_checkpoint_saved", profile: `messaging-${profile}-application`, started: false,
    migrationPerformed: false, tables: 37, migrations: 38, videoCovered: true, coverage: { encryptedVideo: true },
    operationsCovered: true, archiveListed: true, archiveContentsVerified: true, archive: { sha256: "c".repeat(64) } };
  for (const tables of [37, 38, 36]) {
    let args;
    const promise = checkpointProcess("capture-application", options, "/synthetic-destination", { environment: {} }, {
      spawnClient(_executable, selected) {
        args = selected; const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => {};
        queueMicrotask(() => { child.stdout.write(JSON.stringify({ ...receipt, tables })); child.emit("close", 0, null); }); return child;
      }, timeoutMilliseconds: 1000, killMilliseconds: 10,
    });
    if (tables === 37) assert.deepEqual(await promise, { saved: true, precheckPassed: false });
    else await assert.rejects(promise, { code: "RECURRING_SUPERVISOR_CHECKPOINT" });
    assert.deepEqual(args.slice(-2), ["--experience", "1"]);
  }
});
