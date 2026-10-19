import test from "node:test";
import assert from "node:assert/strict";
import { fork, execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { createManagedRuntime } from "../server/backup/managed-runtime.mjs";
import { parseArguments } from "../scripts/private-messaging-child.mjs";

const shim = fileURLToPath(new URL("../scripts/private-messaging-child.mjs", import.meta.url));
const shimUrl = new URL("../scripts/private-messaging-child.mjs", import.meta.url).href;
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
function environment(port = 3000) {
  const result = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("JESSIEMESSAGE_")
    && !["NODE_OPTIONS", "NODE_PATH", "NODE_EXTRA_CA_CERTS", "NODE_TLS_REJECT_UNAUTHORIZED", "NODE_USE_SYSTEM_CA", "SSL_CERT_FILE", "SSL_CERT_DIR", "OPENSSL_CONF"].includes(name)));
  return { ...result, JESSIEMESSAGE_PRIVATE_PATH_MODE: "linux-dirfd", PORT: String(port) };
}
const options = port => ({ runtimeDirectory: "/synthetic-runtime", privateDirectory: "/synthetic-private", port, environment: environment(port) });
const ready = () => Promise.resolve(new Response('{"status":"ready"}', { status: 200 }));
async function fixture(t, source, overrides = {}) {
  const base = fileURLToPath(new URL("../../audit/", import.meta.url)); await mkdir(base, { recursive: true, mode: 0o700 });
  const directory = await mkdtemp(join(base, "jm-managed-runtime-")), file = join(directory, "child.mjs"), children = [], invocations = [];
  await writeFile(file, `process.on('message',()=>{});\n${source}`);
  const internal = { startupMilliseconds: 500, stopMilliseconds: 80, requestMilliseconds: 30, retryMilliseconds: 5,
    fetchClient: ready,
    forkClient(path, args, settings) { invocations.push({ path, args, settings }); const child = fork(file, [], settings); children.push(child); return child; }, ...overrides };
  const runtime = createManagedRuntime(options(3000), internal);
  t.after(async () => { await runtime.destroy(); for (const child of children) try { child.kill("SIGKILL"); } catch {} await rm(directory, { recursive: true, force: true }); });
  return { runtime, children, invocations, internal, file };
}
const cooperative = `process.on('SIGTERM', () => { process.disconnect(); }); process.send({type:'runtime_started'});`;
const waitForClose = child => child.exitCode !== null || child.signalCode !== null ? Promise.resolve() : new Promise(resolve => child.once("exit", resolve));

test("managed child IPC, fixed arguments, inherited logs and local readiness are all required before ready", async t => {
  const requests = [];
  const f = await fixture(t, cooperative, { async fetchClient(url, settings) { requests.push({ url, settings }); return ready(); } });
  assert.deepEqual(f.runtime.state(), { status: "stopped" });
  const first = f.runtime.start(); assert.equal(f.runtime.start(), first); assert.deepEqual(await first, { ready: true });
  assert.deepEqual(f.runtime.state(), { status: "running" });
  assert.equal(f.invocations[0].path, shim); assert.deepEqual(f.invocations[0].settings.execArgv, []);
  assert.deepEqual(f.invocations[0].settings.stdio, ["ignore", "inherit", "inherit", "ipc"]);
  assert.deepEqual(f.invocations[0].args, ["--runtime-directory", "/synthetic-runtime", "--private-directory", "/synthetic-private", "--port", "3000"]);
  assert.equal(requests[0].url, "http://127.0.0.1:3000/api/ready");
  assert.deepEqual(requests[0].settings.headers, { Accept: "application/json", Host: "jessiemessage.com", "X-Forwarded-Proto": "https" });
  assert.equal(requests[0].settings.credentials, "omit"); assert.equal(requests[0].settings.redirect, "error");
  assert.deepEqual(await f.runtime.stop(), { exitCode: 0, signal: null });
  assert.deepEqual(await f.runtime.stop(), { exitCode: 0, signal: null });
  assert.deepEqual(f.runtime.state(), { status: "stopped" });
  await f.runtime.start(); assert.equal(f.children.length, 2); await f.runtime.stop();
});

test("forced termination produces no graceful-stop acknowledgement and waits for actual child close", async t => {
  const f = await fixture(t, "process.on('SIGTERM',()=>{}); process.send({type:'runtime_started'});");
  await f.runtime.start(); await assert.rejects(f.runtime.stop(), { code: "MANAGED_RUNTIME_STOP" });
  assert.equal(f.children[0].signalCode, "SIGKILL"); assert.deepEqual(f.runtime.state(), { status: "stopped" });
});

test("a graceful handler exiting nonzero is still an unsafe capture boundary", async t => {
  const f = await fixture(t, "process.on('SIGTERM',()=>process.exit(7)); process.send({type:'runtime_started'});");
  await f.runtime.start(); await assert.rejects(f.runtime.stop(), { code: "MANAGED_RUNTIME_STOP" }); assert.equal(f.children[0].exitCode, 7);
});

test("local readiness never substitutes for the child's missing IPC startup receipt", async t => {
  let probes = 0;
  const f = await fixture(t, "process.on('SIGTERM',()=>process.disconnect());", { async fetchClient() { probes++; return ready(); } });
  await assert.rejects(f.runtime.start(), { code: "MANAGED_RUNTIME_START" }); assert.equal(probes, 0); assert.equal(f.children[0].exitCode, 0);
});

test("premature child exit and wrong IPC message fail with only fixed metadata", async t => {
  for (const source of ["process.exit(9);", "process.on('SIGTERM',()=>process.disconnect()); process.send({type:'runtime_started',secret:'not accepted'});"]) {
    const f = await fixture(t, source);
    await assert.rejects(f.runtime.start(), error => error.code === "MANAGED_RUNTIME_START" && !JSON.stringify(error).includes("secret") && !error.cause);
  }
});

for (const [label, response] of [["unready", () => new Response('{"status":"starting"}')], ["HTTP unavailable", () => new Response('{"status":"ready"}', { status: 503 })],
  ["cookie", () => new Response('{"status":"ready"}', { headers: { "set-cookie": "private=x" } })], ["extra JSON", () => new Response('{"status":"ready","secret":true}')],
  ["oversized", () => new Response("x".repeat(1025))], ["malformed JSON", () => new Response("secret broken JSON")],
  ["declared oversize", () => new Response('{"status":"ready"}', { headers: { "content-length": "2048" } })]]) {
  test(`${label} readiness is not accepted`, async t => {
    const f = await fixture(t, cooperative, { fetchClient: async () => response() });
    await assert.rejects(f.runtime.start(), { code: "MANAGED_RUNTIME_START" }); assert.equal(f.children[0].exitCode, 0);
  });
}

test("readiness fetch and stream are bounded even if an adapter ignores its AbortSignal", async t => {
  for (const fetchClient of [async () => new Promise(() => {}), async () => new Response(new ReadableStream({ pull() { return new Promise(() => {}); } }))]) {
    const f = await fixture(t, cooperative, { fetchClient }); const began = Date.now();
    await assert.rejects(f.runtime.start(), { code: "MANAGED_RUNTIME_START" }); assert.ok(Date.now() - began < 1500);
  }
});

test("a transient local readiness refusal can recover within the same bounded startup", async t => {
  let attempts = 0;
  const f = await fixture(t, cooperative, { async fetchClient() { if (++attempts === 1) return new Response('{"status":"starting"}'); return ready(); } });
  assert.deepEqual(await f.runtime.start(), { ready: true }); assert.equal(attempts, 2);
});

test("destroy is idempotent and forbids later starts, including a start still awaiting IPC", async t => {
  const f = await fixture(t, "process.on('SIGTERM',()=>process.disconnect());");
  const starting = f.runtime.start(); starting.catch(() => {}); await sleep(30);
  const stopping = f.runtime.destroy(); assert.equal(f.runtime.destroy(), stopping); await stopping;
  await assert.rejects(starting, { code: "MANAGED_RUNTIME_START" }); await assert.rejects(f.runtime.start(), { code: "MANAGED_RUNTIME_CLOSED" });
  assert.deepEqual(f.runtime.state(), { status: "closed" });
});

test("unexpected exit reports one fixed event while planned stop/destroy do not report crashes", async t => {
  const events = [];
  const f = await fixture(t, "process.on('SIGTERM',()=>process.exit(0)); process.send({type:'runtime_started'}); setTimeout(()=>process.exit(4),100);");
  const runtime = createManagedRuntime({ ...options(3000), onUnexpectedExit: value => { events.push(value); throw new Error("secret observer"); } }, f.internal);
  t.after(() => runtime.destroy()); await runtime.start(); await waitForClose(f.children.at(-1));
  assert.deepEqual(events, [{ type: "runtime_exited" }]); assert.equal(Object.isFrozen(events[0]), true);
  const plannedEvents = [], planned = createManagedRuntime({ ...options(3000), onUnexpectedExit: value => plannedEvents.push(value) }, { ...f.internal, forkClient(path, args, settings) {
    const child = fork(f.file, [], settings); f.children.push(child); return child;
  } });
  t.after(() => planned.destroy()); await planned.start(); await planned.stop(); assert.deepEqual(plannedEvents, []);
});

async function freePort() {
  const server = createServer(); await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
}
function shimFixture({ startupDelay = 0, drainDelay = 0 } = {}) {
  return `import { run } from ${JSON.stringify(shimUrl)};
import { createServer } from 'node:http';
await run({runtimeDirectory:'/synthetic-runtime',privateDirectory:'/synthetic-private',port:Number(process.env.PORT)}, {async loadRuntime(){return {
async main(args,dependencies){await new Promise(resolve=>setTimeout(resolve,${startupDelay}));await dependencies.startServer({},{});},
async start(){const server=createServer((request,response)=>{response.setHeader('Cache-Control','no-store');response.end(JSON.stringify({status:request.headers.host==='jessiemessage.com'&&request.headers['x-forwarded-proto']==='https'?'ready':'wrong'}));});await new Promise(resolve=>server.listen(Number(process.env.PORT),'127.0.0.1',resolve));return {async drain(){await new Promise(resolve=>setTimeout(resolve,${drainDelay}));await new Promise(resolve=>server.close(resolve));return {failed:false,timedOut:false};}};}
};}});`;
}

test("actual shim serves real readiness then exits zero after graceful IPC drain", async t => {
  const port = await freePort(), f = await fixture(t, shimFixture());
  const runtime = createManagedRuntime(options(port), { ...f.internal, startupMilliseconds: 1500, stopMilliseconds: 400, fetchClient: undefined });
  t.after(() => runtime.destroy()); assert.deepEqual(await runtime.start(), { ready: true }); assert.deepEqual(await runtime.stop(), { exitCode: 0, signal: null });
});

test("actual shim drains and exits when its parent IPC disconnects, leaving no orphan listener", { timeout: 3000 }, async t => {
  const port = await freePort(), f = await fixture(t, shimFixture()), runtime = createManagedRuntime(options(port), { ...f.internal, startupMilliseconds: 1500, stopMilliseconds: 400, fetchClient: undefined });
  t.after(() => runtime.destroy()); await runtime.start(); const child = f.children.at(-1); child.disconnect();
  await Promise.race([waitForClose(child), sleep(1000).then(() => { throw new Error("orphan child"); })]);
  assert.equal(child.exitCode, 0);
  await assert.rejects(fetch(`http://127.0.0.1:${port}/api/ready`));
});

test("actual shim cannot begin a listener after shutdown was requested during startup", async t => {
  const port = await freePort(), f = await fixture(t, shimFixture({ startupDelay: 150 })), runtime = createManagedRuntime(options(port), { ...f.internal, startupMilliseconds: 1000, stopMilliseconds: 500, fetchClient: undefined });
  t.after(() => runtime.destroy()); const starting = runtime.start(); starting.catch(() => {}); await sleep(50); await runtime.destroy();
  await assert.rejects(starting, { code: "MANAGED_RUNTIME_START" }); await assert.rejects(fetch(`http://127.0.0.1:${port}/api/ready`));
});

test("production shim refuses execution without an IPC parent and rejects extra arguments", async () => {
  await assert.rejects(promisify(execFile)(process.execPath, [shim, "--runtime-directory", "/synthetic-runtime", "--private-directory", "/synthetic-private", "--port", "3000"], { env: environment(), timeout: 1000 }), error => error.code === 1 && /PRIVATE_MESSAGING_CHILD/.test(error.stderr));
  assert.throws(() => parseArguments(["--runtime-directory", "/synthetic-runtime", "--private-directory", "/synthetic-private", "--port", "3000", "--fixture", "unsafe"]), { code: "PRIVATE_MESSAGING_CHILD" });
});

test("the optional copy directory crosses the fixed IPC launcher and reaches only internal startup options", async t => {
  const port = await freePort();
  const source = shimFixture().replace("port:Number(process.env.PORT)},", "port:Number(process.env.PORT),operationsDirectory:'/synthetic-operations'},")
    .replace("async start(){const server", "async start(env,options){if(options.backupDirectory!=='/synthetic-operations')throw new Error('missing bounded copy directory');const server");
  const f = await fixture(t, source), runtime = createManagedRuntime({ ...options(port), operationsDirectory: "/synthetic-operations" }, { ...f.internal, startupMilliseconds: 1500, stopMilliseconds: 400, fetchClient: undefined });
  t.after(() => runtime.destroy()); await runtime.start();
  assert.deepEqual(f.invocations[0].args.slice(-2), ["--operations-directory", "/synthetic-operations"]);
  assert.deepEqual(parseArguments(f.invocations[0].args), { runtimeDirectory: "/synthetic-runtime", privateDirectory: "/synthetic-private", port, operationsDirectory: "/synthetic-operations" });
  assert.deepEqual(await runtime.stop(), { exitCode: 0, signal: null });
});

test("paths, ambient application secrets, port mismatch and callback configuration fail before fork", () => {
  for (const changes of [{ runtimeDirectory: "/a/../b" }, { privateDirectory: "/" }, { port: 0 }, { environment: { ...environment(), JESSIEMESSAGE_RUNTIME_DB_PASSWORD: "secret" } },
    { environment: environment(3001) }, { onUnexpectedExit: true }]) {
    assert.throws(() => createManagedRuntime({ ...options(3000), ...changes }), { code: "MANAGED_RUNTIME_CONFIGURATION" });
  }
});

test("the parent gateway flag crosses IPC, pins child startup and stamps the private readiness probe", async t => {
  const port = await freePort();
  const source = shimFixture().replace("port:Number(process.env.PORT)},", "port:Number(process.env.PORT),parentGateway:true},")
    .replace("async start(){const server", "async start(env,options){if(options.parentGateway!==true)throw new Error('missing gateway binding');const server")
    .replace("request.headers.host==='jessiemessage.com'", "request.headers['x-jessie-parent-peer']==='127.0.0.1'&&request.headers.host==='jessiemessage.com'");
  const f = await fixture(t, source), runtime = createManagedRuntime({ ...options(port), parentGateway: true }, { ...f.internal, startupMilliseconds: 1500, stopMilliseconds: 400, fetchClient: undefined });
  t.after(() => runtime.destroy()); await runtime.start(); assert.deepEqual(f.invocations[0].args.slice(-2), ["--parent-gateway", "managed"]);
  assert.equal(parseArguments(f.invocations[0].args).parentGateway, true); assert.deepEqual(await runtime.stop(), { exitCode: 0, signal: null });
  for (const args of [["--parent-gateway", "true"], ["--parent-gateway", "managed", "--parent-gateway", "managed"]]) {
    assert.throws(() => parseArguments(["--runtime-directory", "/synthetic-runtime", "--private-directory", "/synthetic-private", "--port", String(port), ...args]), { code: "PRIVATE_MESSAGING_CHILD" });
  }
});
