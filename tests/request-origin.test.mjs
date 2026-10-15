import test from "node:test";
import assert from "node:assert/strict";
import { request as httpRequest, createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createRequestOriginGuard, isOriginFormTarget } from "../server/http/request-origin.mjs";
import { createAppServer, createConfiguredServer } from "../server/index.mjs";

const origin = "https://private.example.invalid";
const wire = (host = "private.example.invalid", url = "/api/auth/session", rawHeaders = ["Host", host]) => ({ url, headers: { host }, rawHeaders });
const rejected = (callback) => assert.throws(callback, (error) => error.code === "REQUEST_ORIGIN_CONFIG" && error.cause === undefined && !error.message.includes("example.invalid"));

for (const value of [undefined, null, false, {}, "", "http://private.example.invalid", `${origin}/`, `${origin}?x=1`, `${origin}#fragment`,
  "https://user:password@private.example.invalid", "https://PRIVATE.example.invalid", "https://private.example.invalid:443",
  "https://private.example.invalid.", "https://bad_label.example.invalid", "https://127.0.0.1", "https://[::1]", "https://-bad.example.invalid"]) {
  test(`request authority factory refuses noncanonical configuration ${typeof value === "string" ? JSON.stringify(value) : typeof value}`, () => {
    rejected(() => createRequestOriginGuard(value));
    if (value !== null) rejected(() => createAppServer({ requestOrigin: value === undefined ? false : value }));
  });
}

test("request authority uses the one actual Host, DNS case-insensitivity and explicit HTTPS port semantics", () => {
  const allowed = createRequestOriginGuard(origin);
  for (const host of ["private.example.invalid", "PRIVATE.EXAMPLE.INVALID", "private.example.invalid:443", "PRIVATE.example.invalid:443"]) assert.equal(allowed(wire(host)), true, host);
  for (const host of ["private.example.invalid:80", "private.example.invalid:0443", "private.example.invalid:8443", "other.example.invalid",
    "private.example.invalid.", " private.example.invalid", "private.example.invalid ", "private.example.invalid,other.example.invalid", ""]) assert.equal(allowed(wire(host)), false, String(host));
  assert.equal(allowed({ url: "/", headers: {}, rawHeaders: [] }), false);
  const custom = createRequestOriginGuard(`${origin}:8443`);
  assert.equal(custom(wire("PRIVATE.example.invalid:8443")), true);
  assert.equal(custom(wire("private.example.invalid")), false); assert.equal(custom(wire("private.example.invalid:443")), false);
  assert.equal(createRequestOriginGuard("https://localhost")(wire("LOCALHOST:443")), true);
});

test("duplicate, missing or inconsistent raw Host fields fail closed and forwarding headers grant no authority", () => {
  const allowed = createRequestOriginGuard(origin);
  for (const raw of [[], ["Host"], ["Host", "private.example.invalid", "HOST", "private.example.invalid"],
    ["host", "other.example.invalid"], ["Forwarded", "host=private.example.invalid"], [null, "private.example.invalid"], ["Host", null]]) assert.equal(allowed(wire("private.example.invalid", "/", raw)), false);
  assert.equal(allowed({ ...wire(), rawHeaders: undefined }), false);
  const wrong = wire("other.example.invalid");
  wrong.headers.forwarded = "host=private.example.invalid;proto=https";
  wrong.headers["x-forwarded-host"] = "private.example.invalid"; wrong.headers["x-forwarded-proto"] = "https";
  assert.equal(allowed(wrong), false);
  const correct = wire(); correct.headers.forwarded = "host=other.example.invalid"; correct.headers["x-forwarded-host"] = "other.example.invalid";
  assert.equal(allowed(correct), true);
});

test("wire targets must retain origin-form before URL normalization", () => {
  const allowed = createRequestOriginGuard(origin);
  for (const target of ["/", "/api/auth/session", "/api/auth/session?x=1", "/a%20b", "/a/../api/health"]) {
    assert.equal(isOriginFormTarget(target), true); assert.equal(allowed(wire("private.example.invalid", target)), true);
  }
  for (const target of [undefined, null, "", "*", "private.example.invalid:443", `${origin}/api/auth/session`, "//private.example.invalid/api/auth/session",
    "/\\private.example.invalid/api/auth/session", "/api/auth/session#fragment", "/x y", "/x\t", "/x\r\n", "/x\0", "/x\u007f", "/x\u0085"]) {
    assert.equal(isOriginFormTarget(target), false, String(target)); assert.equal(allowed({ ...wire(), url: target }), false, String(target));
  }
});

async function fixture(t, options) {
  const server = createAppServer(options);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); });
  return { server, port: server.address().port };
}
function request(port, { path = "/api/auth/session", host = "private.example.invalid", method = "GET", headers, incomplete = false } = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: "127.0.0.1", port, path, method, setHost: false, agent: false, headers: headers ?? { Host: host } }, (response) => {
      const chunks = []; response.on("data", (chunk) => chunks.push(chunk)); response.on("error", reject);
      response.once("end", () => { resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString("utf8") }); if (incomplete) req.destroy(); });
    });
    req.on("error", reject); if (incomplete) req.flushHeaders(); else req.end();
  });
}
function tracked() {
  const calls = { handlers: 0, admission: 0, completed: 0, operations: 0 };
  return { calls, options: { requestOrigin: origin,
    authHandler: async (_request, response) => { calls.handlers += 1; response.writeHead(200, { "Content-Type": "application/json", "Set-Cookie": "synthetic=private" }); response.end('{"private":true}'); return true; },
    entryHandler: async () => { calls.handlers += 1; return false; },
    admission: { enter() { calls.admission += 1; return () => { calls.completed += 1; }; } },
    operations: { publicStatus() { calls.operations += 1; return { status: "ready" }; } },
  } };
}
const assertMisdirected = (result, method = "GET") => {
  assert.equal(result.status, 421); assert.equal(result.headers["cache-control"], "no-store"); assert.equal(result.headers.connection, "close"); assert.equal(result.headers["set-cookie"], undefined);
  assert.equal(result.body, method === "HEAD" ? "" : '{"error":"misdirected_request"}');
};

test("wrong, duplicate or missing Host and absolute targets are rejected before every private callback", async (t) => {
  const f = tracked(), { port } = await fixture(t, f.options);
  for (const options of [
    { host: "other.example.invalid" },
    { headers: ["Host", "private.example.invalid", "HOST", "private.example.invalid"] },
    { host: "other.example.invalid", headers: { Host: "other.example.invalid", Forwarded: "host=private.example.invalid;proto=https", "X-Forwarded-Host": "private.example.invalid" } },
    { path: `${origin}/api/auth/session` }, { path: "//private.example.invalid/api/auth/session" }, { path: "/\\private.example.invalid/api/auth/session" },
    { path: "/api/ready", host: "other.example.invalid" }, { path: "/admin", host: "other.example.invalid" }, { path: "/", host: "other.example.invalid" },
    { host: "other.example.invalid", method: "HEAD" },
  ]) assertMisdirected(await request(port, options), options.method);
  // Keep Node's own HTTP/1.1 missing-Host rejection enabled. This request is
  // refused by the parser before the application's stricter guard is reached.
  const missing = await request(port, { headers: {} });
  assert.equal(missing.status, 400); assert.equal(missing.headers["set-cookie"], undefined);
  assert.deepEqual(f.calls, { handlers: 0, admission: 0, completed: 0, operations: 0 });
  assertMisdirected(await request(port, { method: "POST", headers: { Host: "other.example.invalid", "Content-Length": "1000" }, incomplete: true }));
  assert.deepEqual(f.calls, { handlers: 0, admission: 0, completed: 0, operations: 0 });
});

test("a matching authority reaches private admission and handlers while readiness remains cache-only", async (t) => {
  const f = tracked(), { port } = await fixture(t, f.options);
  const result = await request(port, { host: "PRIVATE.EXAMPLE.INVALID:443", headers: { Host: "PRIVATE.EXAMPLE.INVALID:443", "X-Forwarded-Host": "untrusted.example.invalid" } });
  assert.equal(result.status, 200); assert.equal(result.body, '{"private":true}');
  assert.deepEqual(f.calls, { handlers: 2, admission: 1, completed: 1, operations: 0 });
  const ready = await request(port, { path: "/api/ready" });
  assert.equal(ready.status, 200); assert.equal(ready.body, '{"status":"ready"}');
  assert.deepEqual(f.calls, { handlers: 2, admission: 1, completed: 1, operations: 1 });
});

test("strict health is fixed for unknown authority and all methods without handlers, cookies, admission or monitor", async (t) => {
  const f = tracked(), { port } = await fixture(t, f.options);
  for (const host of ["private.example.invalid", "unknown.example.invalid"]) for (const method of ["GET", "HEAD", "POST", "OPTIONS", "PUT"]) {
    const result = await request(port, { path: "/api/health?probe=1", host, method });
    assert.equal(result.status, ["GET", "HEAD"].includes(method) ? 200 : 405);
    assert.equal(result.body, method === "HEAD" ? "" : method === "GET" ? '{"status":"ok"}' : '{"error":"method_not_allowed"}');
    if (!["GET", "HEAD"].includes(method)) assert.equal(result.headers.allow, "GET, HEAD");
    assert.equal(result.headers["cache-control"], "no-store"); assert.equal(result.headers["set-cookie"], undefined);
  }
  for (const path of [`${origin}/api/health`, "//private.example.invalid/api/health", "/api/health#fragment"]) assertMisdirected(await request(port, { path }));
  assert.deepEqual(f.calls, { handlers: 0, admission: 0, completed: 0, operations: 0 });
});

test("omitting the optional guard preserves neutral routing, including the existing health handler order", async (t) => {
  const { port } = await fixture(t, {});
  for (const host of ["unknown.example.invalid", "private.example.invalid:80"]) {
    const health = await request(port, { path: "/api/health", host }); assert.equal(health.status, 200); assert.equal(health.body, '{"status":"ok"}');
    assert.equal((await request(port, { path: "/", host })).status, 200);
    assert.equal((await request(port, { path: `${origin}/api/health`, host })).status, 200);
  }
  let callbacks = 0;
  const old = await fixture(t, { authHandler: async (_request, response) => { callbacks += 1; response.writeHead(202); response.end("existing handler order"); return true; } });
  assert.equal((await request(old.port, { path: "/api/health", host: "unknown.example.invalid" })).status, 202); assert.equal(callbacks, 1);
});

test("configured strict servers refuse disabled or mismatched authentication before acquiring a pool", async () => {
  for (const env of [{}, { JESSIEMESSAGE_ENABLE_AUTH: "0" }, { JESSIEMESSAGE_ENABLE_AUTH: "1", JESSIEMESSAGE_SITE_ORIGIN: "https://other.example.invalid", JESSIEMESSAGE_MFA_KEY: Buffer.alloc(32, 7).toString("base64url") }]) {
    await assert.rejects(createConfiguredServer(env, { requestOrigin: origin }), { code: "REQUEST_ORIGIN_CONFIG" });
  }
  await assert.rejects(createConfiguredServer({}, { requestOrigin: "http://private.example.invalid" }), { code: "REQUEST_ORIGIN_CONFIG" });
  const neutral = await createConfiguredServer({}); assert.equal(neutral.pool, null); assert.equal(neutral.server.listening, false);
  await new Promise((resolve) => neutral.server.close(resolve));
});

async function child(source, env = {}) {
  const processHandle = spawn(process.execPath, ["--input-type=module", "-e", source], { env: { PATH: process.env.PATH ?? "/usr/bin:/bin", ...env }, stdio: ["ignore", "pipe", "pipe"] });
  let output = "", errors = ""; processHandle.stdout.on("data", (data) => { output += data; }); processHandle.stderr.on("data", (data) => { errors += data; });
  const [code, signal] = await once(processHandle, "exit"); return { code, signal, output, errors };
}

test("start rejects a bind failure only after cleanup and removes its startup signal handlers", { timeout: 10000 }, async (t) => {
  const occupied = createServer(); await new Promise((resolve) => occupied.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => occupied.close(resolve))); const port = occupied.address().port;
  const result = await child(`
    import assert from 'node:assert/strict';
    import { start } from ${JSON.stringify(new URL("../server/index.mjs", import.meta.url).href)};
    const term=process.listenerCount('SIGTERM'),interrupt=process.listenerCount('SIGINT');
    await assert.rejects(start({PORT:${JSON.stringify(String(port))}}), {message:'JessieMessage HTTP listener could not start.'});
    assert.equal(process.listenerCount('SIGTERM'),term);assert.equal(process.listenerCount('SIGINT'),interrupt);
    assert.equal(process.exitCode,undefined);process.stdout.write('bind failure drained\\n');
  `);
  assert.equal(result.code, 0, result.errors); assert.equal(result.signal, null); assert.match(result.output, /bind failure drained/);
  assert.doesNotMatch(result.errors, /EADDRINUSE|127\.0\.0\.1|private|password/);
});

test("start uses its supplied environment and resolves after the real listener can serve, then drains normally", { timeout: 10000 }, async () => {
  const reservation = createServer(); await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve)); const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const result = await child(`
    import assert from 'node:assert/strict';
    import { start } from ${JSON.stringify(new URL("../server/index.mjs", import.meta.url).href)};
    const handle=await start({PORT:${JSON.stringify(String(port))}});
    assert.equal(handle.server.listening,true);assert.equal(handle.pool,null);assert.equal(handle.server.address().port,${port});
    const response=await fetch('http://127.0.0.1:${port}/api/health');assert.equal(response.status,200);await response.text();
    assert.deepEqual(await handle.drain(),{timedOut:false,forced:false,failed:false});process.stdout.write('listener bound and drained\\n');
  `, { PORT: "1", JESSIEMESSAGE_ENABLE_AUTH: "invalid" });
  assert.equal(result.code, 0, result.errors); assert.equal(result.signal, null); assert.match(result.output, new RegExp(`JessieMessage listening on port ${port}`)); assert.match(result.output, /listener bound and drained/);
});
