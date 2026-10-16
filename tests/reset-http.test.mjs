import test from "node:test";
import assert from "node:assert/strict";
import { createServer, request as httpRequest } from "node:http";
import { createResetHandler } from "../server/reset/http.mjs";
import { AUTH_HEADERS } from "../server/auth/http.mjs";

const origin = "https://jessiemessage.example";
const token = Buffer.alloc(32, 19).toString("base64url");
const password = "  Nouveau mot de passe exact é  ";
const email = "client@example.invalid";
const requestPath = "/api/access/recovery/request";
const resetPath = "/api/access/recovery/reset";
const capabilitiesPath = "/api/access/recovery/capabilities";
const headers = (extra = {}) => ({ Origin: origin, "Content-Type": "application/json", "X-Jessie-Request": "1", ...extra });

async function fixture(t, overrides = {}) {
  const calls = [];
  const implementations = {
    requestReset: () => ({ status: "accepted" }),
    resetPassword: () => ({ status: "password_changed" }),
    ...overrides,
  };
  const service = {};
  for (const [name, implementation] of Object.entries(implementations)) {
    service[name] = async (...args) => { calls.push([name, ...args]); return implementation(...args); };
  }
  const handler = createResetHandler(service, { origin });
  const server = createServer(async (request, response) => {
    if (!await handler(request, response)) { response.writeHead(404); response.end("fallback"); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); });
  return { base: `http://127.0.0.1:${server.address().port}`, calls, service };
}

const post = (base, path, body, values = headers()) => fetch(`${base}${path}`, { method: "POST", headers: values, body: typeof body === "string" ? body : JSON.stringify(body) });
function assertHeaders(response) {
  for (const [name, value] of Object.entries(AUTH_HEADERS)) assert.equal(response.headers.get(name), value, name);
  assert.equal(response.headers.get("access-control-allow-origin"), null);
}

function rawRequest(base, path, { values = headers(), body, end = true } = {}) {
  return new Promise((resolve, reject) => {
    const request = httpRequest(`${base}${path}`, { method: "POST", headers: values }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => { resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString("utf8") }); request.destroy(); });
    });
    request.on("error", reject);
    if (end) request.end(body); else request.flushHeaders();
  });
}

test("recovery handler requires canonical HTTPS and both recovery service methods", () => {
  const service = { requestReset() {}, resetPassword() {} };
  for (const value of ["http://jessiemessage.example", `${origin}/`, `${origin}/recover`, `${origin}?x=1`, `${origin}#reset=x`, "https://user:password@jessiemessage.example"]) {
    assert.throws(() => createResetHandler(service, { origin: value }));
  }
  assert.throws(() => createResetHandler({}, { origin }));
  assert.throws(() => createResetHandler({ requestReset() {} }, { origin }));
  assert.equal(typeof createResetHandler(service, { origin }), "function");
});

test("public capabilities disclose fixed password bounds without reading cookies or service state", async (t) => {
  const { base, calls } = await fixture(t);
  const response = await fetch(`${base}${capabilitiesPath}`, { headers: { Cookie: "__Host-jessie_session=forged; __Host-jessie_client=forged" } });
  assert.equal(response.status, 200); assertHeaders(response);
  assert.deepEqual(await response.json(), { enabled: true, password: { minLength: 8, maxLength: 128 } });
  assert.equal(response.headers.get("set-cookie"), null);
  assert.deepEqual(calls, []);
});

test("enabled recovery assets are fixed public files with private caching and HEAD support", async (t) => {
  const { base, calls } = await fixture(t);
  for (const [path, type] of [["/recover", "text/html"], ["/recover.js", "text/javascript"], ["/recover-model.js", "text/javascript"], ["/recover.css", "text/css"]]) {
    const response = await fetch(`${base}${path}`);
    assert.equal(response.status, 200, path); assertHeaders(response);
    assert.ok(response.headers.get("content-type").startsWith(type));
    assert.ok((await response.text()).length > 0);
    assert.equal(response.headers.get("set-cookie"), null);
    const head = await fetch(`${base}${path}`, { method: "HEAD" });
    assert.equal(head.status, 200); assert.equal(await head.text(), ""); assertHeaders(head);
  }
  assert.deepEqual(calls, []);
});

test("request always returns a neutral accepted DTO and uses only the socket peer", async (t) => {
  const { base, calls } = await fixture(t, { requestReset: () => ({ status: "accepted", token, email, userId: "private", passwordHash: "private", accountExists: true }) });
  for (const value of [email, "unknown@example.invalid", "not a canonical email", " "]) {
    const response = await post(base, requestPath, { email: value }, headers({ "X-Forwarded-For": "203.0.113.55", "X-Real-IP": "203.0.113.56", Cookie: "__Host-jessie_client=forged" }));
    assert.equal(response.status, 202); assertHeaders(response);
    assert.deepEqual(await response.json(), { status: "accepted" });
    assert.equal(response.headers.get("set-cookie"), null);
  }
  assert.deepEqual(calls, [email, "unknown@example.invalid", "not a canonical email", " "].map((value) => ["requestReset", { email: value, peerAddress: "127.0.0.1" }]));
});

test("successful reset passes exact password and clears only the client cookie without signing in", async (t) => {
  const { base, calls } = await fixture(t, { resetPassword: () => ({ status: "password_changed", token, email, session: "private", userId: "private" }) });
  const response = await post(base, resetPath, { token, password }, headers({ Cookie: "__Host-jessie_session=admin-preserved; __Host-jessie_client=client-old" }));
  assert.equal(response.status, 200); assertHeaders(response);
  assert.deepEqual(await response.json(), { status: "password_changed" });
  assert.equal(response.headers.get("set-cookie"), "__Host-jessie_client=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Strict");
  assert.deepEqual(calls, [["resetPassword", { token, password, peerAddress: "127.0.0.1" }]]);
});

test("every mutation checks exact origin, fetch metadata, JSON and custom preauth header", async (t) => {
  const { base, calls } = await fixture(t);
  for (const path of [requestPath, resetPath]) {
    for (const values of [headers({ Origin: "https://attacker.example" }), headers({ Origin: "null" }), headers({ "X-Jessie-Request": "" }), headers({ "X-Jessie-Request": "01" }), headers({ "Sec-Fetch-Site": "cross-site" }), headers({ "Sec-Fetch-Site": "same-site" })]) {
      const response = await post(base, path, { email, token, password }, values);
      assert.equal(response.status, 403); assertHeaders(response);
      assert.deepEqual(await response.json(), { error: "request_rejected" });
      assert.equal(response.headers.get("connection"), "close");
    }
    const response = await post(base, path, {}, headers({ "Content-Type": "text/plain" }));
    assert.equal(response.status, 415); assert.deepEqual(await response.json(), { error: "json_required" });
  }
  assert.deepEqual(calls, []);
});

test("preauth guards reject an unfinished secret body before waiting for its bytes", { timeout: 3000 }, async (t) => {
  const { base, calls } = await fixture(t);
  const response = await rawRequest(base, resetPath, { values: headers({ Origin: "https://attacker.example", "Content-Length": "1024" }), end: false });
  assert.equal(response.status, 403);
  assert.deepEqual(JSON.parse(response.body), { error: "request_rejected" });
  assert.equal(response.headers.connection, "close");
  assert.deepEqual(calls, []);
});

test("queries including duplicate or secret fields are refused on all known routes", async (t) => {
  const { base, calls } = await fixture(t);
  for (const path of [requestPath, resetPath]) {
    for (const query of [`?token=${token}`, "?email=a&email=b", "?unknown=1", "?token="]) {
      const response = await post(base, `${path}${query}`, path === requestPath ? { email } : { token, password });
      assert.equal(response.status, 400); assert.deepEqual(await response.json(), { error: "invalid_request" });
    }
  }
  for (const path of [capabilitiesPath, "/recover", "/recover.js", "/recover-model.js", "/recover.css"]) {
    const response = await fetch(`${base}${path}?token=${token}&token=${token}`);
    assert.equal(response.status, 400); assert.deepEqual(await response.json(), { error: "invalid_request" });
  }
  assert.deepEqual(calls, []);
});

test("request payload allows only a bounded well-formed email string", async (t) => {
  const { base, calls } = await fixture(t);
  for (const body of [{}, { email: "" }, { email: "a".repeat(255) }, { email: "bad\ud800" }, { email: 1 }, { email, role: "admin" }, { email, token }, { email, userId: "forged" }, [], null, "true", '{"email":']) {
    const response = await post(base, requestPath, body);
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.deepEqual(await response.json(), { error: "invalid_request" });
  }
  assert.deepEqual(calls, []);
});

test("reset requires exactly one canonical body token and a well-formed exact password", async (t) => {
  const { base, calls } = await fixture(t);
  for (const body of [{ password }, { token, password, userId: "forged" }, { token, password, email }, { token, password, role: "admin" }, { token, password, credentialVersion: 2 }, ...["bad", `${token}\n`, `${token}=`, `${"A".repeat(42)}B`, "é".repeat(43), null].map((value) => ({ token: value, password }))]) {
    const response = await post(base, resetPath, body);
    assert.equal(response.status, 400); assert.deepEqual(await response.json(), { error: "invalid_request" });
    assert.equal(response.headers.get("set-cookie"), null);
  }
  for (const value of ["a".repeat(7), "a".repeat(129), "a".repeat(8) + "\ud800", null, 17]) {
    const response = await post(base, resetPath, { token, password: value });
    assert.equal(response.status, 400); assert.deepEqual(await response.json(), { error: "invalid_password" });
  }
  assert.deepEqual(calls, []);
  for (const value of ["a".repeat(8), "a".repeat(13), "a".repeat(128), "e\u0301".repeat(4), " ".repeat(8)]) {
    const response = await post(base, resetPath, { token, password: value });
    assert.equal(response.status, 200);
    assert.equal(calls.at(-1)[1].password, value);
  }
});

test("bounded JSON reading rejects large wire bodies and malformed UTF-8 without calling service", async (t) => {
  const { base, calls } = await fixture(t);
  const large = await post(base, requestPath, JSON.stringify({ email, extra: "x".repeat(4096) }));
  assert.equal(large.status, 413); assert.deepEqual(await large.json(), { error: "request_too_large" });
  assert.equal(large.headers.get("connection"), "close");
  const invalid = await rawRequest(base, requestPath, { body: Buffer.concat([Buffer.from('{"email":"'), Buffer.from([0xc0, 0xaf]), Buffer.from('"}')]) });
  assert.equal(invalid.status, 400); assert.deepEqual(JSON.parse(invalid.body), { error: "invalid_request" });
  assert.deepEqual(calls, []);
});

test("unfinished same-origin JSON times out with a neutral response and a closed connection", { timeout: 8000 }, async (t) => {
  const { base, calls } = await fixture(t);
  const response = await rawRequest(base, requestPath, { values: headers({ "Content-Length": "100" }), end: false });
  assert.equal(response.status, 408); assert.deepEqual(JSON.parse(response.body), { error: "request_timeout" });
  assert.equal(response.headers.connection, "close");
  assert.deepEqual(calls, []);
});

test("service errors are purpose-specific, sanitized and never clear a cookie", async (t) => {
  const { base, service } = await fixture(t);
  for (const [code, status, publicCode] of [["RESET_INVALID", 401, "invalid_reset_link"], ["RESET_INPUT", 400, "invalid_request"], ["RESET_RATE_LIMIT", 429, "try_again_later"], ["AUTH_BUSY", 429, "try_again_later"], ["AUTH_INVALID", 503, "recovery_unavailable"], ["ACCESS_FORBIDDEN", 503, "recovery_unavailable"], ["RESET_CONFIG", 503, "recovery_unavailable"], ["RESET_DATABASE_OPERATION", 503, "recovery_unavailable"]]) {
    service.resetPassword = async () => { throw Object.assign(new Error(`private ${email} ${token} ${password}`), { code, retryAfter: 17.2 }); };
    const response = await post(base, resetPath, { token, password });
    assert.equal(response.status, status); assertHeaders(response);
    assert.deepEqual(await response.json(), { error: publicCode });
    assert.equal(response.headers.get("set-cookie"), null);
    if (status === 429) assert.equal(response.headers.get("retry-after"), "18");
  }
  for (const failure of [Object.assign(new Error("private"), { httpStatus: 418, publicCode: email }), Object.assign(new Error("private"), { httpStatus: 400, publicCode: token }), new Error("private database cause")]) {
    service.requestReset = async () => { throw failure; };
    const response = await post(base, requestPath, { email });
    assert.equal(response.status, 503); assert.deepEqual(await response.json(), { error: "recovery_unavailable" });
  }
});

test("rate-limit retry values remain bounded and unknown service results cannot report success", async (t) => {
  const { base, service } = await fixture(t);
  for (const [value, expected] of [[-100, "1"], [0, "1"], [9000, "3600"], [Number.NaN, "60"], [Infinity, "60"], [undefined, "60"]]) {
    service.requestReset = async () => { throw Object.assign(new Error("private"), { code: "RESET_RATE_LIMIT", retryAfter: value }); };
    const response = await post(base, requestPath, { email });
    assert.equal(response.status, 429); assert.equal(response.headers.get("retry-after"), expected);
  }
  for (const [method, path, body] of [["requestReset", requestPath, { email }], ["resetPassword", resetPath, { token, password }]]) {
    for (const value of [null, false, [], "accepted", { status: "wrong" }, {}]) {
      service[method] = async () => value;
      const response = await post(base, path, body);
      assert.equal(response.status, 503); assert.deepEqual(await response.json(), { error: "recovery_unavailable" });
      assert.equal(response.headers.get("set-cookie"), null);
    }
  }
});

test("methods are exact and unrelated paths fall through without consuming tokens", async (t) => {
  const { base, calls } = await fixture(t);
  for (const [path, method, allowed] of [[requestPath, "GET", "POST"], [resetPath, "GET", "POST"], [resetPath, "HEAD", "POST"], [capabilitiesPath, "POST", "GET"], ["/recover", "OPTIONS", "GET, HEAD"]]) {
    const response = await fetch(`${base}${path}`, { method });
    assert.equal(response.status, 405); assert.equal(response.headers.get("allow"), allowed); assertHeaders(response);
    if (method === "HEAD") assert.equal(await response.text(), "");
    else assert.deepEqual(await response.json(), { error: "method_not_allowed" });
  }
  for (const path of ["/api/auth/login", "/api/access/recovery", "/api/access/recovery/request/", "/api/access/recovery/RESET", "/recover.html", "/recover/secret.txt", "/server/reset/http.mjs"]) {
    const response = await fetch(`${base}${path}`);
    assert.equal(response.status, 404); assert.equal(await response.text(), "fallback");
  }
  assert.deepEqual(calls, []);
});
