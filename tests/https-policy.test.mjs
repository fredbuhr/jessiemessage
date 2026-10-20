import test from "node:test";
import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { createAppServer } from "../server/index.mjs";
import { createAuthHandler } from "../server/auth/http.mjs";

const primary = "https://jessiemessage.com";
const recipe = "https://recette.jessiemessage.com";
const policy = "max-age=31536000";

async function fixture(t, options = {}) {
  const server = createAppServer(options);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return server.address().port;
}

function request(port, path, { host = "jessiemessage.com", method = "GET", headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: "127.0.0.1", port, path, method, agent: false, headers: { Host: host, ...headers } }, res => {
      const chunks = [];
      res.on("data", chunk => chunks.push(chunk));
      res.on("error", reject);
      res.once("end", () => resolve({ status: res.statusCode, headers: res.headers, rawHeaders: res.rawHeaders, body: Buffer.concat(chunks).toString() }));
    });
    req.on("error", reject); req.end();
  });
}

function assertPolicy(response, status) {
  assert.equal(response.status, status);
  assert.equal(response.headers["strict-transport-security"], policy);
  assert.equal(response.rawHeaders.filter((value, index) => index % 2 === 0 && value.toLowerCase() === "strict-transport-security").length, 1);
}

test("configured HTTPS authority carries one host-only HSTS policy on public, private and error responses", async t => {
  const authHandler = createAuthHandler({ login() {}, session() {}, logout() {}, logoutAll() {} }, { origin: primary });
  const port = await fixture(t, { requestOrigin: primary, authHandler });
  for (const [path, status, method] of [["/", 200, "GET"], ["/api/health", 200, "GET"], ["/api/ready", 503, "GET"],
    ["/api/auth/session", 401, "GET"], ["/missing", 404, "GET"], ["/api/health", 405, "POST"], ["/", 200, "HEAD"]]) {
    const result = await request(port, path, { method });
    assertPolicy(result, status);
    assert.equal(result.headers["cache-control"], "no-store");
    assert.equal(result.headers["x-content-type-options"], "nosniff");
    if (method === "HEAD") assert.equal(result.body, "");
  }
});

test("HSTS survives a private handler failure and request admission refusal", async t => {
  const unavailable = await fixture(t, { requestOrigin: primary, authHandler: async () => { throw new Error("synthetic failure"); } });
  assertPolicy(await request(unavailable, "/api/auth/session"), 503);
  const refused = await fixture(t, { requestOrigin: primary, authHandler: async () => { throw new Error("must not run"); },
    admission: { enter() { throw Object.assign(new Error("synthetic limit"), { code: "REQUEST_RATE_LIMIT", retryAfter: 10 }); } } });
  const response = await request(refused, "/api/auth/session");
  assertPolicy(response, 429); assert.equal(response.headers["retry-after"], "10");
});

test("neutral HTTP server and foreign authorities cannot acquire HSTS through forwarding headers", async t => {
  const headers = { Forwarded: "host=jessiemessage.com;proto=https", "X-Forwarded-Host": "jessiemessage.com", "X-Forwarded-Proto": "https" };
  const neutral = await fixture(t);
  const publicResponse = await request(neutral, "/", { headers });
  assert.equal(publicResponse.status, 200); assert.equal(publicResponse.headers["strict-transport-security"], undefined);
  const configured = await fixture(t, { requestOrigin: primary });
  const foreign = await request(configured, "/", { host: "other.example.invalid", headers });
  assert.equal(foreign.status, 421); assert.equal(foreign.headers["strict-transport-security"], undefined);
});

test("the configured legacy HTTPS origin receives the same host-only policy", async t => {
  const port = await fixture(t, { requestOrigin: primary, legacyHandlers: { entryHandler: async () => false } });
  const result = await request(port, "/", { host: new URL(recipe).host });
  assertPolicy(result, 200);
  assert.doesNotMatch(result.headers["strict-transport-security"], /includeSubDomains|preload/);
});

test("draining preserves HSTS on bodyless HEAD and GET service-unavailable responses", async t => {
  const server = createAppServer({ requestOrigin: primary });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  server.beginDrain();
  for (const method of ["GET", "HEAD"]) {
    const result = await request(server.address().port, "/api/health", { method });
    assertPolicy(result, 503);
    assert.equal(result.body, method === "HEAD" ? "" : '{"error":"service_unavailable"}');
  }
});
