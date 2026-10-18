import test from "node:test";
import assert from "node:assert/strict";
import { createServer, request as httpRequest } from "node:http";
import { PassThrough } from "node:stream";
import { AUTH_HEADERS } from "../server/auth/http.mjs";
import { createReadinessHandler } from "../server/readiness/http.mjs";

const origin = "https://jessiemessage.example";
const token = Buffer.alloc(32, 7).toString("base64url"), clientToken = Buffer.alloc(32, 11).toString("base64url");
const csrf = Buffer.alloc(32, 9).toString("base64url");
const cookie = `__Host-jessie_session=${token}`;
const now = Date.now(), root = "/api/admin/readiness", smtp = `${root}/smtp`;
const assets = ["/admin/readiness", "/readiness.js", "/readiness-model.js", "/readiness.css"];
const actor = (changes = {}) => ({ user: { id: "a".repeat(32), role: "admin", pseudonym: "Jessie" },
  expiresAt: now + 3600000, csrf, privateMfa: "private-mfa", ...changes });
const summary = (changes = {}) => ({ contactEmail: "contact@jessiemessage.com",
  mail: { configured: true, sender: "contact@jessiemessage.com", replyTo: "contact@jessiemessage.com", host: "private-host", password: "private-password" },
  features: { clientAccess: true, chat: true, photos: false, clientFiles: true, passwordRecovery: false, broadcasts: false, notifications: false, privateKey: "private-key" },
  checks: { admissionPolicy: "manual_invitation", ageAssurance: "not_integrated", smtpDelivery: "not_checked", deviceAcceptance: "pending", privateDatabase: "private-database" },
  username: "private-username", databaseName: "private-database", key: "private-key", ...changes });
const proof = (changes = {}) => ({ status: "verified", checkedAt: now, scope: "smtp_authentication", delivery: "not_checked",
  host: "private-host", password: "private-password", transcript: "private-transcript", ...changes });

function fixtureService(calls, overrides = {}) {
  return {
    async actor(value) { calls.push(["actor", value]); return value === token ? actor() : null; },
    async summary(value) { calls.push(["summary", value]); return summary(); },
    async verifySmtp(value) { calls.push(["verifySmtp", value]); return proof(); },
    ...overrides,
  };
}
async function fixture(t, overrides = {}) {
  const calls = [], service = fixtureService(calls, overrides), handler = createReadinessHandler(service, { origin });
  const server = createServer(async (req, res) => { if (!await handler(req, res)) { res.writeHead(404); res.end("fallback"); } });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); });
  return { base: `http://127.0.0.1:${server.address().port}`, calls, service };
}
const mutationHeaders = (extra = {}) => ({ Origin: origin, "Content-Type": "application/json", "X-CSRF-Token": csrf, Cookie: cookie, ...extra });
const post = (base, endpoint = smtp, body = {}, headers = mutationHeaders()) => fetch(`${base}${endpoint}`, {
  method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body),
});
const get = (base, endpoint = root, headers = { Cookie: cookie }) => fetch(`${base}${endpoint}`, { headers });
function privateHeaders(response) {
  for (const [name, value] of Object.entries(AUTH_HEADERS)) assert.equal(response.headers.get(name), value, name);
  assert.equal(response.headers.get("access-control-allow-origin"), null);
}
async function errorBody(response, status, error) {
  assert.equal(response.status, status); privateHeaders(response);
  assert.deepEqual(await response.json(), { error });
}

test("readiness handler requires a canonical HTTPS origin and its complete private service contract", () => {
  const service = fixtureService([]);
  for (const value of ["http://example.invalid", `${origin}/`, `${origin}/path`, `${origin}?a=1`, "https://user:pass@example.invalid"]) {
    assert.throws(() => createReadinessHandler(service, { origin: value }));
  }
  for (const key of ["actor", "summary", "verifySmtp"]) assert.throws(() => createReadinessHandler({ ...service, [key]: null }, { origin }));
});

test("readiness summary whitelists public identity and feature inventory without claiming delivery or publication", async (t) => {
  const { base, calls } = await fixture(t);
  const response = await get(base); assert.equal(response.status, 200); privateHeaders(response);
  assert.deepEqual(await response.json(), { contactEmail: "contact@jessiemessage.com",
    mail: { configured: true, sender: "contact@jessiemessage.com", replyTo: "contact@jessiemessage.com" },
    features: { clientAccess: true, chat: true, photos: false, clientFiles: true, passwordRecovery: false, broadcasts: false, notifications: false },
    checks: { admissionPolicy: "manual_invitation", ageAssurance: "not_integrated", smtpDelivery: "not_checked", deviceAcceptance: "pending" } });
  assert.deepEqual(calls, [["actor", token], ["summary", token]]);
});

test("SMTP verification accepts only an empty object and exposes authentication proof without transport details", async (t) => {
  const { base, calls } = await fixture(t);
  const response = await post(base); assert.equal(response.status, 200); privateHeaders(response);
  assert.equal(response.headers.get("set-cookie"), null);
  assert.deepEqual(await response.json(), { status: "verified", checkedAt: now, scope: "smtp_authentication", delivery: "not_checked" });
  assert.deepEqual(calls, [["actor", token], ["verifySmtp", token]]);
});

test("anonymous, client, duplicate and malformed cookies cannot access summary or invoke SMTP", async (t) => {
  const { base, calls } = await fixture(t);
  for (const header of [null, `__Host-jessie_client=${clientToken}`, `__Host-jessie_session=${clientToken}`, `${cookie}; ${cookie}`,
    `${cookie}; __Host-jessie_session=wrong`, `__Host-jessie_session=${"A".repeat(42)}B`, `${cookie}=`]) {
    const response = await get(base, root, header ? { Cookie: header } : {});
    await errorBody(response, 401, "authentication_required");
    assert.equal(response.headers.get("set-cookie"), "__Host-jessie_session=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Strict");
    const mutation = await post(base, smtp, {}, mutationHeaders({ Cookie: header ?? "" }));
    await errorBody(mutation, 401, "authentication_required");
    assert.doesNotMatch(mutation.headers.get("set-cookie"), /jessie_client/);
  }
  assert.equal(calls.some(([name]) => name !== "actor"), false);
  assert.equal((await get(base, root, { Cookie: `__Host-jessie_client=${clientToken}; ${cookie}` })).status, 200);
});

test("the current role is rechecked and malformed service sessions do not reach private data", async (t) => {
  const { base, calls, service } = await fixture(t);
  for (const value of [null, actor({ user: { id: "b".repeat(32), role: "client", pseudonym: "Client" } })]) {
    service.actor = async () => value;
    await errorBody(await get(base), 401, "authentication_required");
  }
  for (const value of [actor({ csrf: "wrong" }), actor({ expiresAt: Infinity }), actor({ expiresAt: -1 }),
    actor({ user: { id: "a".repeat(32) + "\n", role: "admin", pseudonym: "Jessie" } }),
    actor({ user: { id: "A".repeat(32), role: "admin", pseudonym: "Jessie" } }),
    actor({ user: { id: "a".repeat(32), role: "admin", pseudonym: "\ud800" } })]) {
    service.actor = async () => value;
    await errorBody(await get(base), 503, "readiness_unavailable");
  }
  assert.equal(calls.some(([name]) => name !== "actor"), false);
});

test("all readiness pages and assets authenticate both GET and HEAD before opening their source", async (t) => {
  const { base, calls } = await fixture(t);
  for (const endpoint of assets) for (const method of ["GET", "HEAD"]) {
    for (const headers of [{}, { Cookie: `__Host-jessie_client=${clientToken}` }, { Cookie: `__Host-jessie_session=${clientToken}` }]) {
      const response = await fetch(`${base}${endpoint}`, { method, headers });
      assert.equal(response.status, 401); privateHeaders(response);
      if (method === "HEAD") assert.equal(await response.text(), "");
      else assert.deepEqual(await response.json(), { error: "authentication_required" });
    }
  }
  assert.equal(calls.some(([name]) => name !== "actor"), false);
});

test("authorized readiness source is served with private security headers and bodyless HEAD", async (t) => {
  const { base } = await fixture(t);
  for (const [endpoint, type] of [["/admin/readiness", /text\/html/], ["/readiness.js", /javascript/],
    ["/readiness-model.js", /javascript/], ["/readiness.css", /text\/css/]]) {
    const response = await get(base, endpoint);
    assert.equal(response.status, 200); privateHeaders(response); assert.match(response.headers.get("content-type"), type);
    assert.ok((await response.text()).length > 0);
    const head = await fetch(`${base}${endpoint}`, { method: "HEAD", headers: { Cookie: cookie } });
    assert.equal(head.status, 200); privateHeaders(head); assert.equal(await head.text(), "");
  }
});

test("anonymous, Origin and CSRF failures finish before any JSON reader attaches", async () => {
  const calls = [], handler = createReadinessHandler(fixtureService(calls), { origin });
  for (const [headers, status, error] of [
    [mutationHeaders({ Cookie: "" }), 401, "authentication_required"],
    [mutationHeaders({ "X-CSRF-Token": "wrong" }), 403, "csrf_failed"],
    [mutationHeaders({ Origin: "https://attacker.invalid" }), 403, "request_rejected"],
  ]) {
    const req = new PassThrough(); req.url = smtp; req.method = "POST";
    req.headers = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
    let body, responseStatus, responseHeaders;
    const res = { headersSent: false, destroyed: false, writeHead(code, values) { responseStatus = code; responseHeaders = values; }, end(value) { body = value; } };
    assert.equal(await handler(req, res), true); assert.equal(responseStatus, status);
    assert.deepEqual(JSON.parse(body), { error }); assert.equal(responseHeaders.Connection, "close");
    assert.equal(req.listenerCount("data"), 0); assert.equal(req.listenerCount("end"), 0); req.destroy();
  }
  assert.equal(calls.some(([name]) => name === "verifySmtp"), false);
});

test("SMTP verification requires exact origin, same-origin fetch context, JSON and current CSRF", async (t) => {
  const { base, calls } = await fixture(t);
  for (const extra of [{ Origin: "https://attacker.invalid" }, { Origin: `${origin}/` }, { Origin: "null" },
    { "Sec-Fetch-Site": "cross-site" }, { "Sec-Fetch-Site": "same-site" }, { "X-CSRF-Token": "wrong" }, { "X-CSRF-Token": "" }]) {
    await errorBody(await post(base, smtp, {}, mutationHeaders(extra)), 403,
      Object.hasOwn(extra, "X-CSRF-Token") ? "csrf_failed" : "request_rejected");
  }
  const headers = mutationHeaders(); delete headers.Origin;
  await errorBody(await post(base, smtp, {}, headers), 403, "request_rejected");
  for (const value of ["text/plain", "application/json; charset=latin1", "application/x-www-form-urlencoded"]) {
    await errorBody(await post(base, smtp, {}, mutationHeaders({ "Content-Type": value })), 415, "json_required");
  }
  assert.equal(calls.some(([name]) => name === "verifySmtp"), false);
  assert.equal((await post(base, smtp, {}, mutationHeaders({ "Sec-Fetch-Site": "same-origin" }))).status, 200);
});

test("all known routes reject every query and duplicated parameters before their service operation", async (t) => {
  const { base, calls } = await fixture(t);
  for (const endpoint of [root, ...assets]) for (const query of ["?a=1", "?role=admin&role=client", "?password=secret", "?=empty"]) {
    await errorBody(await get(base, endpoint + query), 400, "invalid_request");
  }
  for (const query of ["?host=mail.invalid", "?to=person@example.invalid", "?action=send&action=verify"]) {
    await errorBody(await post(base, smtp + query), 400, "invalid_request");
  }
  assert.equal(calls.some(([name]) => name !== "actor"), false);
});

test("SMTP requests reject recipient, identity, credentials and action inputs without invoking the service", async (t) => {
  const { base, calls } = await fixture(t);
  for (const body of ["", "null", "[]", "true", "0", '{"host":"mail.invalid"}', '{"port":587}', '{"password":"private"}',
    '{"from":"other@example.invalid"}', '{"replyTo":"other@example.invalid"}', '{"to":"other@example.invalid"}',
    '{"action":"send"}', '{"adminId":"forged"}', '{"__proto__":{}}', '{"a":null}', '{"to":null,"to":null}', "{broken}"]) {
    await errorBody(await post(base, smtp, body), 400, "invalid_request");
  }
  assert.equal(calls.some(([name]) => name === "verifySmtp"), false);
});

test("the empty-object request retains the default 4096 byte wire limit including chunked bodies", async (t) => {
  const { base, calls } = await fixture(t);
  await errorBody(await post(base, smtp, " ".repeat(4095) + "{}"), 413, "request_too_large");
  const status = await new Promise((resolve, reject) => {
    const req = httpRequest(`${base}${smtp}`, { method: "POST", headers: mutationHeaders() }, (res) => {
      res.resume(); res.on("end", () => resolve(res.statusCode));
    });
    req.on("error", reject); req.write(" ".repeat(4095)); req.end("{}");
  });
  assert.equal(status, 413); assert.equal(calls.some(([name]) => name === "verifySmtp"), false);
  const valid = await post(base, smtp, " ".repeat(4094) + "{}"); assert.equal(valid.status, 200);
});

test("malformed UTF-8 cannot become an empty SMTP request", async (t) => {
  const { base, calls } = await fixture(t);
  const result = await new Promise((resolve, reject) => {
    const req = httpRequest(`${base}${smtp}`, { method: "POST", headers: mutationHeaders() }, (res) => {
      let body = ""; res.on("data", (chunk) => { body += chunk; }); res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.on("error", reject); req.end(Buffer.from([123, 0xc3, 0x28, 125]));
  });
  assert.equal(result.status, 400); assert.deepEqual(JSON.parse(result.body), { error: "invalid_request" });
  assert.equal(calls.some(([name]) => name === "verifySmtp"), false);
});

test("corrupt readiness summary values fail closed without leaking their fields", async (t) => {
  const { base, service } = await fixture(t);
  const valid = summary();
  for (const value of [null, {}, summary({ contactEmail: "other@example.invalid" }),
    summary({ mail: { ...valid.mail, configured: 1 } }), summary({ mail: { ...valid.mail, sender: "Contact@jessiemessage.com" } }),
    summary({ mail: { ...valid.mail, sender: "bad\r\nFrom: private-password" } }),
    summary({ mail: { ...valid.mail, replyTo: "other@example.invalid" } }),
    summary({ mail: { configured: false, sender: "other@example.invalid", replyTo: "other@example.invalid" } }),
    summary({ features: { ...valid.features, photos: "true" } }), summary({ features: { chat: true } }),
    summary({ checks: { ...valid.checks, smtpDelivery: "delivered" } }),
    summary({ checks: { ...valid.checks, ageAssurance: "passed" } }), summary({ checks: { ...valid.checks, deviceAcceptance: "ready" } })]) {
    service.summary = async () => value;
    await errorBody(await get(base), 503, "readiness_unavailable");
  }
  service.summary = async () => summary({ mail: { configured: false, sender: "contact@jessiemessage.com", replyTo: "contact@jessiemessage.com" } });
  assert.equal((await get(base)).status, 200);
});

test("SMTP authentication cannot report sent mail, inbox delivery or an invalid proof timestamp", async (t) => {
  const { base, service } = await fixture(t);
  for (const value of [null, {}, true, proof({ status: "sent" }), proof({ delivery: "delivered" }), proof({ scope: "inbox_delivery" }),
    proof({ checkedAt: -1 }), proof({ checkedAt: 0.5 }), proof({ checkedAt: "2026-10-15" }), proof({ checkedAt: 253402300800000 })]) {
    service.verifySmtp = async () => value;
    await errorBody(await post(base), 503, "readiness_unavailable");
  }
});

test("private service errors map to fixed status codes and never expose SMTP messages or causes", async (t) => {
  const { base, service } = await fixture(t);
  for (const [code, status, error, extra = {}] of [
    ["READINESS_UNAUTHORIZED", 401, "authentication_required"], ["AUTH_INVALID", 401, "authentication_required"],
    ["READINESS_MAIL_DISABLED", 409, "mail_delivery_disabled"], ["READINESS_SMTP_FAILED", 502, "smtp_check_failed"],
    ["READINESS_UNAVAILABLE", 503, "readiness_unavailable"], ["EUNKNOWN", 503, "readiness_unavailable"],
    ["EINJECT", 503, "readiness_unavailable", { httpStatus: 418, publicCode: "private-password" }],
    ["EINJECT", 503, "readiness_unavailable", { httpStatus: 503, publicCode: "private-password" }],
  ]) {
    service.verifySmtp = async () => { throw Object.assign(new Error("private-password SMTP transcript"), {
      code, cause: new Error("private-host private-user"), password: "private-password", ...extra,
    }); };
    const response = await post(base); await errorBody(response, status, error);
    assert.equal(Boolean(response.headers.get("set-cookie")), status === 401);
  }
  service.summary = async () => { throw new Error("private-database"); };
  await errorBody(await get(base), 503, "readiness_unavailable");
});

test("readiness quotas and busy responses provide bounded Retry-After without backend details", async (t) => {
  const { base, service } = await fixture(t);
  for (const [code, retryAfter, expected] of [["READINESS_BUSY", 999, "5"], ["READINESS_RATE_LIMIT", 1.1, "2"],
    ["READINESS_RATE_LIMIT", -2, "1"], ["READINESS_RATE_LIMIT", Infinity, "60"], ["READINESS_RATE_LIMIT", 90000, "3600"],
    ["READINESS_RATE_LIMIT", Symbol("private-retry"), "60"],
    ["READINESS_RATE_LIMIT", { valueOf() { throw new Error("private-retry"); } }, "60"],
    ["AUTH_RATE_LIMIT", 20, "20"], ["AUTH_BUSY", undefined, "60"]]) {
    service.verifySmtp = async () => { throw Object.assign(new Error("private-rate-limit"), { code, retryAfter }); };
    const response = await post(base); assert.equal(response.headers.get("retry-after"), expected);
    await errorBody(response, 429, "try_again_later");
  }
});

test("known routes expose only their exact methods and unknown URLs fall through without authentication", async (t) => {
  const { base, calls } = await fixture(t);
  for (const [endpoint, method, allow] of [[root, "HEAD", "GET"], [root, "POST", "GET"],
    [smtp, "GET", "POST"], [smtp, "HEAD", "POST"], ["/readiness.js", "POST", "GET, HEAD"], ["/admin/readiness", "OPTIONS", "GET, HEAD"]]) {
    const response = await fetch(`${base}${endpoint}`, { method, ...(method === "POST" ? { body: "{}" } : {}) });
    assert.equal(response.status, 405); privateHeaders(response); assert.equal(response.headers.get("allow"), allow);
    if (method === "HEAD") assert.equal(await response.text(), "");
    else assert.deepEqual(await response.json(), { error: "method_not_allowed" });
  }
  for (const endpoint of ["/api/admin/readiness/unknown", "/api/admin/readiness/smtp/", "/readiness.html", "/private/readiness.js", "/admin/readiness/extra"]) {
    const response = await get(base, endpoint); assert.equal(response.status, 404); assert.equal(await response.text(), "fallback");
  }
  assert.deepEqual(calls, []);
});

test("operational diagnostics are administrator-only and projected to aggregate safe fields", async (t) => {
  let reads = 0;
  const operations = { status: "unavailable", database: { state: "unavailable", checkedAt: now, hostname: "private-host" },
    workers: [{ name: "broadcasts", state: "error", lastCompletedAt: now - 1, lastErrorAt: now, consecutiveFailures: 1, processed: 2, failures: 1, token: "private-token" }],
    queues: [{ name: "broadcasts", pending: { count: 1, truncated: false, payload: "private-payload" }, sending: { count: 0, truncated: false }, failed: { count: 0, truncated: false }, oldestDueAt: now - 2000, conversationId: "private-conversation" }],
    queuesCheckedAt: now, error: "private-driver-error" };
  const { base } = await fixture(t, { async summary() { reads++; return summary({ operations }); } });
  const anonymous = await get(base, root, {}); await errorBody(anonymous, 401, "authentication_required"); assert.equal(reads, 0);
  const response = await get(base); assert.equal(response.status, 200); const data = await response.json();
  assert.equal(data.operations.workers[0].failures, 1); assert.equal(data.operations.queues[0].pending.count, 1);
  assert.doesNotMatch(JSON.stringify(data), /private-|hostname|conversationId|payload|token/); assert.equal(reads, 1);
  operations.status = "ready";
  await errorBody(await get(base), 503, "readiness_unavailable");
});
