import test from "node:test";
import assert from "node:assert/strict";
import { videoBundle } from "./fixtures/video-private.mjs";
import { inheritedEnv, origin } from "./fixtures/crm-private.mjs";
import { VIDEO_RUNTIME_OPTIONS, loadRuntimeVideoEnvironment } from "../server/config/runtime-video.mjs";
import { runtimeVideoConfiguration, assertDistinctVideoRoots, checkRuntimeVideoStorage } from "../server/config/runtime-video-storage.mjs";
import { parseArguments, run } from "../scripts/start-private-messaging.mjs";
import { parseRecurringArguments } from "../server/backup/recurring-supervisor.mjs";
import { createConfiguredServer, createAppServer } from "../server/index.mjs";
import { DATABASE_CHECK_NAMES } from "../server/preflight/database.mjs";
import { request as httpRequest } from "node:http";
import { createVideoHandler } from "../server/video/http.mjs";

const profile = "photos-notify-recovery-crm-broadcast-video";
const directory = "/private/synthetic-video";
const load = () => loadRuntimeVideoEnvironment(directory, VIDEO_RUNTIME_OPTIONS, { readBundle: async () => videoBundle() });
const command = mode => [mode, "--deployment", "primary-transition", "--profile", profile,
  "--private-directory", directory, "--private-path-mode", "linux-dirfd"];
const parentArgs = mode => [mode, "--runtime-directory", "/srv/reviewed-runtime", "--runtime-head", "a".repeat(40), "--runtime-tree", "b".repeat(40),
  "--private-directory", "/srv/private-config", "--operations-directory", "/srv/private-backups", "--private-path-mode", "linux-dirfd"];
const privilegeReport = () => ({ valid: true, checks: DATABASE_CHECK_NAMES.map(name => ({ name, status: "pass" })),
  privilegeObservation: { profile: "strict", source: "show_grants", ledgerWritable: false, tempTables: false, tableLocks: false, permanentDdl: false } });

test("video is an explicit primary local-closure profile and leaves the ordinary launcher unchanged", () => {
  assert.equal(parseArguments(command("check")).profile, profile);
  assert.throws(() => parseArguments(command("start").filter(value => !["--deployment", "primary-transition"].includes(value))));
  for (const mode of ["check-local-closures", "start-local-closures"]) {
    assert.equal(Object.hasOwn(parseRecurringArguments(parentArgs(mode)), "video"), false);
    const selected = parseRecurringArguments([...parentArgs(mode), "--profile", profile]);
    assert.equal(selected.video, true); assert.equal(selected.profile, profile);
  }
  for (const mode of ["check", "start", "plan-witness", "check-witness", "prepare-witness", "start-witness-recovery"])
    assert.throws(() => parseRecurringArguments([...parentArgs(mode), "--profile", profile]), { code: "RECURRING_SUPERVISOR_USAGE" });
  for (const selected of ["photos-notify-recovery-crm-broadcast", "video", "", "1"])
    assert.throws(() => parseRecurringArguments([...parentArgs("start-local-closures"), "--profile", selected]));
});

test("candidate startup checks both roots after SQL and opens one listener only after all checks pass", async () => {
  const source = await load(), before = structuredClone(source), events = [];
  const dependencies = { inheritedEnv, execArgv: [], managedVideo: true, loadEnvironment: async (_path, options) => {
    events.push("configuration"); assert.deepEqual(options, { port: "3000", ...VIDEO_RUNTIME_OPTIONS }); return source;
  }, inspect: async options => { events.push("privileges"); assert.equal(options.video, true); return privilegeReport(); },
  checkSchema: async (_env, options) => { events.push("schema"); assert.deepEqual(options, { video: true }); },
  checkStorage: async (_env, options) => { assert.deepEqual(options, { video: true }); events.push("photos"); }, checkVideoStorage: async () => events.push("videos"),
  startServer: async (_env, options) => { events.push("listener"); assert.deepEqual(options,
    { requestOrigin: origin, deviceTransition: true, recovery: true, crm: true, broadcast: true, video: true }); } };
  const started = await run(parseArguments(command("start")), dependencies);
  assert.equal(started.profile, `messaging-${profile}`); assert.equal(started.started, true);
  assert.deepEqual(events, ["configuration", "privileges", "schema", "photos", "videos", "listener"]); assert.deepEqual(source, before);
  events.length = 0; assert.equal((await run(parseArguments(command("check")), dependencies)).started, false);
  assert.deepEqual(events, ["configuration", "privileges", "schema", "photos", "videos"]);
  for (const phase of ["loadEnvironment", "inspect", "checkSchema", "checkStorage", "checkVideoStorage"]) {
    let started = false;
    await assert.rejects(run(parseArguments(command("start")), { ...dependencies,
      [phase]: async () => { throw Error("synthetic private failure"); }, startServer: async () => { started = true; } }));
    assert.equal(started, false, phase);
  }
  let loaded = false;
  await assert.rejects(run(parseArguments(command("start")), { inheritedEnv, execArgv: [], loadEnvironment: async () => { loaded = true; return source; } }),
    { code: "PRIVATE_MESSAGING_USAGE" });
  assert.equal(loaded, false);
});

test("candidate server rejects incomplete options before reading configuration or opening SQL", async () => {
  const env = await load(), complete = { requestOrigin: origin, deviceTransition: true, recovery: true, crm: true, broadcast: true,
    accountClosures: true, backupDirectory: "/srv/private-backups", video: true };
  for (const field of ["requestOrigin", "deviceTransition", "recovery", "crm", "broadcast", "accountClosures", "backupDirectory"]) {
    const options = { ...complete }; delete options[field];
    await assert.rejects(createConfiguredServer(env, options), { code: "REQUEST_ORIGIN_CONFIG" }, field);
  }
  for (const options of [{ ...complete, parentGateway: true }, { ...complete, video: "1" }, { ...complete, requestOrigin: "https://recette.jessiemessage.com" }])
    await assert.rejects(createConfiguredServer(env, options), { code: "REQUEST_ORIGIN_CONFIG" });
});

test("runtime video configuration requires independent keys and disjoint private trees", async () => {
  const env = await load(), before = structuredClone(env), selected = runtimeVideoConfiguration(env);
  assert.equal(selected.key.length, 32); assert.equal(selected.capacity.ownerBytes, 1073741824); selected.key.fill(0);
  for (const changes of [{ JESSIEMESSAGE_VIDEO_KEY: env.JESSIEMESSAGE_MEDIA_KEY }, { JESSIEMESSAGE_VIDEO_KEY: env.JESSIEMESSAGE_MESSAGE_KEY },
    { JESSIEMESSAGE_VIDEO_ROOT: env.JESSIEMESSAGE_MEDIA_ROOT }, { JESSIEMESSAGE_VIDEO_ROOT: `${env.JESSIEMESSAGE_MEDIA_ROOT}/video` },
    { JESSIEMESSAGE_MEDIA_ROOT: `${env.JESSIEMESSAGE_VIDEO_ROOT}/photos` }])
    assert.throws(() => runtimeVideoConfiguration({ ...env, ...changes }), { code: "RUNTIME_VIDEO_STORAGE" });
  assert.deepEqual(env, before);
});

test("physical root checks reject aliases and nesting even with unrelated path spellings", async () => {
  const ancestor = { dev: 1n, ino: 1n }, photos = { dev: 2n, ino: 2n }, videos = { dev: 3n, ino: 3n };
  const inspect = chains => async root => chains[root === "/photos" ? 0 : 1];
  assert.equal(await assertDistinctVideoRoots("/photos", "/videos", { inspect: inspect([[ancestor, photos], [ancestor, videos]]) }), true);
  for (const chains of [[[ancestor, photos], [ancestor, photos]], [[ancestor, photos], [ancestor, photos, videos]], [[ancestor, videos, photos], [ancestor, videos]], [[], [ancestor, videos]]])
    await assert.rejects(assertDistinctVideoRoots("/photos", "/videos", { inspect: inspect(chains) }), { code: "RUNTIME_VIDEO_STORAGE" });
});

test("video startup storage inspection is read-only, closes SQL, clears the copied key and rejects unready capacity", async () => {
  const env = await load(), before = structuredClone(env);
  for (const fault of [null, "root", "space", "schema", "capacity", "close"]) {
    const events = []; let copiedKey;
    const dependencies = { inspectRoots: async () => { events.push("roots"); if (fault === "root") throw Error("private root"); },
      makeStorage: async ({ key }) => { copiedKey = key; return { async fingerprint() { return Buffer.alloc(32, 8); },
        async availableSpace() { return { availableBytes: BigInt(env.JESSIEMESSAGE_VIDEO_MINIMUM_FREE_BYTES) + (fault === "space" ? 64n : 65n) }; } }; },
      createPool: async () => { events.push("pool"); return { async end() { events.push("close"); if (fault === "close") throw Error("private close"); } }; },
      makeStore: () => ({ async assertSchema() { events.push("schema"); if (fault === "schema") throw Error("private schema"); },
        async status() { events.push("status"); return { ready: fault !== "capacity" }; } }) };
    if (fault) await assert.rejects(checkRuntimeVideoStorage(env, dependencies), error => error.code === "RUNTIME_VIDEO_STORAGE" && !error.message.includes("private close"));
    else assert.equal((await checkRuntimeVideoStorage(env, dependencies)).ready, true);
    if (events.includes("pool")) assert.equal(events.at(-1), "close");
    if (copiedKey) assert.ok(copiedKey.every(value => value === 0));
    assert.deepEqual(env, before);
  }
});

test("photo and video body deadlines fit their native request budgets while ordinary requests and headers stay bounded", () => {
  const handler = async () => false;
  assert.equal(createAppServer().requestTimeout, 15000);
  const photos = createAppServer({ mediaHandler: handler });
  assert.equal(photos.requestTimeout, 65000); assert.equal(photos.headersTimeout, 10000);
  const selected = createAppServer({ videoHandler: handler });
  assert.equal(selected.requestTimeout, 300000); assert.equal(selected.headersTimeout, 10000); assert.equal(selected.keepAliveTimeout, 5000);
});

test("mounted candidate video routes preserve each authority's exact Origin and ordinary servers keep them closed", async t => {
  const token = Buffer.alloc(32, 4).toString("base64url"), csrf = Buffer.alloc(32, 5).toString("base64url"), calls = [];
  const service = { async actor(role, value) { return value === token ? { user: { id: "a".repeat(32), role, pseudonym: "Synthetic administrator" }, csrf, expiresAt: Date.now() + 60000 } : null; },
    async admitUpload() { return {}; }, async releaseUpload() {}, async upload(role, value, ticket, source) {
      for await (const chunk of source) assert.equal(chunk.toString(), "x"); calls.push(role); return { id: "b".repeat(32), bytes: 1, mime: "video/mp4" };
    }, async open() { throw Error("unused"); } };
  const legacy = "https://recette.jessiemessage.com", server = createAppServer({ requestOrigin: origin, videoHandler: createVideoHandler(service, { origin }),
    legacyHandlers: { entryHandler: async () => false, videoHandler: createVideoHandler(service, { origin: legacy }) } });
  const ordinary = createAppServer();
  for (const selected of [server, ordinary]) {
    await new Promise(resolve => selected.listen(0, "127.0.0.1", resolve));
    t.after(async () => { selected.closeAllConnections(); await new Promise(resolve => selected.close(resolve)); });
  }
  const request = (selected, authority, selectedOrigin) => new Promise((resolve, reject) => {
    const current = httpRequest({ host: "127.0.0.1", port: selected.address().port, path: "/api/video/admin/assets", method: "POST",
      headers: { Host: new URL(authority).host, Origin: selectedOrigin, Cookie: `__Host-jessie_session=${token}`, "X-CSRF-Token": csrf, "Content-Type": "video/mp4", "Content-Length": "1" } }, response => {
      response.resume(); response.once("end", () => resolve(response.statusCode));
    }); current.once("error", reject); current.end("x");
  });
  for (const authority of [origin, legacy]) {
    assert.equal(await request(server, authority, authority), 201);
    assert.equal(await request(server, authority, authority === origin ? legacy : origin), 403);
  }
  assert.equal(await request(server, "https://unrelated.example", origin), 421);
  assert.equal(await request(ordinary, origin, origin), 405); assert.deepEqual(calls, ["admin", "admin"]);
});
