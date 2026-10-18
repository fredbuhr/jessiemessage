import test from "node:test";
import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createAppServer } from "../server/index.mjs";
import { createShutdown } from "../server/lifecycle.mjs";

function deferred() { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; }
async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${server.address().port}`;
}
async function close(server) { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }

test("central admission rejects every SQL-bearing route before a handler or body reader", async (t) => {
  let lookups = 0, admissions = 0;
  const server = createAppServer({
    authHandler: async () => { lookups += 1; return false; },
    admission: { enter(request) {
      admissions += 1;
      assert.notEqual(request.readableFlowing, true);
      throw Object.assign(new Error("private budget"), { code: "REQUEST_RATE_LIMIT", retryAfter: 7 });
    } },
  });
  t.after(() => close(server)); const base = await listen(server);
  for (const path of ["/api/auth/session", "/api/access/session", "/api/chat/client/conversation",
    "/api/media/admin/assets", "/admin", "/messages", "/admin/messages", "/admin/broadcasts", "/admin/readiness",
    "/broadcast.js", "/broadcast-model.js", "/broadcast.css",
    "/crm.js", "/crm-model.js", "/crm.css", "/readiness.js", "/readiness-model.js", "/readiness.css"]) {
    const response = await fetch(`${base}${path}`, { headers: { Cookie: `__Host-jessie_session=${"A".repeat(43)}` } });
    assert.equal(response.status, 429, path);
    assert.equal(response.headers.get("retry-after"), "7");
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("set-cookie"), null);
    assert.deepEqual(await response.json(), { error: "try_again_later" });
  }
  // A deliberately incomplete upload must receive its rejection immediately.
  const response = await new Promise((resolve, reject) => {
    const request = httpRequest(`${base}/api/media/client/assets`, { method: "POST", headers: { "Content-Length": "1000" } }, (incoming) => {
      incoming.resume(); incoming.once("end", () => { request.destroy(); resolve(incoming); });
    });
    request.once("error", reject); request.flushHeaders();
  });
  assert.equal(response.statusCode, 429);
  assert.equal(response.headers.connection, "close");
  assert.equal(lookups, 0); assert.equal(admissions, 19);
});

test("health and public files do not spend private admission, and feature-off routes stay neutral", async (t) => {
  let calls = 0;
  const admission = { enter() { calls += 1; throw new Error("must not run"); } };
  const enabled = createAppServer({ authHandler: async () => false, admission });
  const neutral = createAppServer({ admission });
  t.after(() => close(enabled)); t.after(() => close(neutral));
  for (const [server, paths] of [[enabled, ["/api/health", "/", "/chat.js"]], [neutral, ["/api/auth/session", "/admin"]]]) {
    const base = await listen(server);
    for (const path of paths) { const response = await fetch(`${base}${path}`); await response.text(); }
  }
  assert.equal(calls, 0);
});

test("draining rejects new work and waits for handlers after a client disconnects", async (t) => {
  const entered = deferred(), release = deferred(); let lookups = 0;
  const server = createAppServer({ authHandler: async (_request, response) => {
    lookups += 1; entered.resolve(); await release.promise; response.end("finished"); return true;
  } });
  t.after(() => { release.resolve(); return close(server); });
  const base = await listen(server);
  const request = httpRequest(`${base}/api/auth/session`); request.on("error", () => {}); request.end();
  await entered.promise; request.destroy(); server.beginDrain();
  let drained = false; const pending = server.waitForRequests().then(() => { drained = true; });
  const response = await fetch(`${base}/api/auth/session`);
  assert.equal(response.status, 503); assert.equal(response.headers.get("connection"), "close"); await response.text();
  assert.equal(lookups, 1); assert.equal(drained, false);
  release.resolve(); await pending; assert.equal(drained, true);
});

test("shutdown signals every producer immediately and closes the pool after request and worker drains", async (t) => {
  const entered = deferred(), releaseRequest = deferred(), releaseWorker = deferred(); const events = [];
  const server = createAppServer({ authHandler: async (_request, response) => {
    entered.resolve(); await releaseRequest.promise; events.push("request done"); response.end("ok"); return true;
  } });
  t.after(() => { releaseRequest.resolve(); releaseWorker.resolve(); return close(server); });
  const base = await listen(server); const response = fetch(`${base}/api/auth/session`).then((result) => result.text());
  await entered.promise;
  const shutdown = createShutdown({ server, graceMilliseconds: 500, deadlineMilliseconds: 1500,
    diagnostics: { close() { events.push("diagnostic stopped"); } },
    mailWorker: { stop() { events.push("workers stopped"); return releaseWorker.promise; }, close() { events.push("SMTP closed"); } },
    pool: { end() { events.push("pool closed"); } },
  });
  const closing = shutdown(); assert.equal(shutdown(), closing);
  assert.deepEqual(events, ["workers stopped", "diagnostic stopped"]);
  releaseWorker.resolve(); await Promise.resolve(); assert.equal(events.includes("pool closed"), false);
  releaseRequest.resolve(); await response;
  assert.deepEqual(await closing, { timedOut: false, forced: false, failed: false });
  assert.ok(events.indexOf("pool closed") > events.indexOf("request done"));
  assert.ok(events.indexOf("pool closed") > events.indexOf("SMTP closed"));
});

test("SMTP is cancelled after grace so its blocked worker can drain before the global deadline", async (t) => {
  const worker = deferred(); const events = [];
  const server = createAppServer(); t.after(() => close(server)); await listen(server);
  const shutdown = createShutdown({ server, graceMilliseconds: 20, deadlineMilliseconds: 500,
    mailWorker: {
      stop() { events.push("stop"); return worker.promise; },
      abort() { events.push("abort SMTP"); worker.resolve(); },
      close() { events.push("close SMTP"); },
    }, pool: { end() { events.push("close pool"); } },
  });
  assert.deepEqual(await shutdown(), { timedOut: false, forced: true, failed: false });
  assert.deepEqual(events, ["stop", "abort SMTP", "close SMTP", "close pool"]);
});

test("a disconnected request with an unsettled operation reaches the deadline without false completion", async (t) => {
  const entered = deferred(), release = deferred(), forced = deferred(); let ended = 0, endedAtForce;
  const server = createAppServer({ authHandler: async (_request, response) => {
    entered.resolve(); await release.promise; response.end(); return true;
  } });
  t.after(() => { release.resolve(); return close(server); });
  const base = await listen(server);
  const request = httpRequest(`${base}/api/auth/session`); request.on("error", () => {}); request.end();
  await entered.promise; request.destroy();
  const shutdown = createShutdown({ server, graceMilliseconds: 20, deadlineMilliseconds: 60,
    mailWorker: { stop() {}, abort() { endedAtForce = ended; forced.resolve(); }, close() {} },
    pool: { end() { ended += 1; } },
  });
  const closing = shutdown(); await forced.promise;
  assert.equal(endedAtForce, 0, "socket closure is not a completed SQL operation");
  assert.deepEqual(await closing, { timedOut: true, forced: true, failed: false });
  assert.equal(ended, 1); assert.equal(shutdown(), closing);
  release.resolve(); await server.waitForRequests(); assert.equal(ended, 1);
});

test("a stuck pool or failing cleanup cannot escape the single shutdown budget", async (t) => {
  const server = createAppServer(); t.after(() => close(server)); await listen(server);
  const shutdown = createShutdown({ server, graceMilliseconds: 10, deadlineMilliseconds: 35,
    diagnostics: { close() { throw new Error("private diagnostics"); } },
    pool: { end() { return new Promise(() => {}); } },
  });
  assert.deepEqual(await shutdown(), { timedOut: true, forced: true, failed: true });
});

test("SIGTERM can finish a process with an unresponsive producer at its shutdown deadline", { timeout: 5000 }, async (t) => {
  const source = `
    import { createAppServer } from ${JSON.stringify(new URL("../server/index.mjs", import.meta.url).href)};
    import { createShutdown } from ${JSON.stringify(new URL("../server/lifecycle.mjs", import.meta.url).href)};
    const server = createAppServer();
    const drain = createShutdown({server, graceMilliseconds:20, deadlineMilliseconds:80,
      mailWorker:{stop(){console.log('stopped');return new Promise(()=>{});},abort(){},close(){}}});
    process.once('SIGTERM',()=>{void drain().then(result=>{if(result.timedOut)process.exit(1);});});
    server.listen(0,'127.0.0.1',()=>console.log('ready'));
  `;
  const child = spawn(process.execPath, ["--input-type=module", "-e", source], { stdio: ["ignore", "pipe", "pipe"] });
  t.after(() => { if (child.exitCode === null) child.kill("SIGKILL"); });
  let output = "", errors = "";
  child.stderr.on("data", (chunk) => { errors += chunk; });
  const ready = deferred(); child.stdout.on("data", (chunk) => { output += chunk; if (output.includes("ready")) ready.resolve(); });
  const exited = once(child, "exit");
  await Promise.race([ready.promise, exited.then(() => { throw new Error(`child exited early: ${errors}`); })]);
  child.kill("SIGTERM");
  const [code, signal] = await exited;
  assert.equal(code, 1, errors); assert.equal(signal, null); assert.match(output, /stopped/);
});
