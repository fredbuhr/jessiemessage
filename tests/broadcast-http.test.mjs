import test from "node:test";
import assert from "node:assert/strict";
import { createServer, request as httpRequest } from "node:http";
import { PassThrough } from "node:stream";
import { AUTH_HEADERS } from "../server/auth/http.mjs";
import { createBroadcastHandler } from "../server/broadcast/http.mjs";

const origin = "https://jessiemessage.example", root = "/api/broadcast";
const token = Buffer.alloc(32, 7).toString("base64url"), clientToken = Buffer.alloc(32, 11).toString("base64url");
const csrf = Buffer.alloc(32, 9).toString("base64url"), clientCsrf = Buffer.alloc(32, 13).toString("base64url");
const cookie = `__Host-jessie_session=${token}`, clientCookie = `__Host-jessie_client=${clientToken}`;
const adminId = "a".repeat(32), clientId = "b".repeat(32), campaignId = "c".repeat(32), retryId = "d".repeat(32);
const conversationId = "1".repeat(32), secondConversationId = "2".repeat(32), mediaId = "e".repeat(32), messageId = "f".repeat(32);
const now = Date.now(), campaigns = `${root}/admin/campaigns`, detailPath = `${campaigns}/${campaignId}`;
const methods = ["actor", "preview", "create", "activity", "list", "get", "cancel"];
const actor = (role = "admin", changes = {}) => ({ user: { id: role === "admin" ? adminId : clientId, role, pseudonym: role === "admin" ? "Jessie" : "Client test", privateEmail: "private-email" },
  csrf: role === "admin" ? csrf : clientCsrf, expiresAt: now + 3600000, secret: "private-secret", ...changes });
const input = (changes = {}) => ({ clientCampaignId: retryId, title: "Nouvelles de Jess", body: "Bonjour <script>texte</script>\n", mediaId: null,
  allowRepeatMedia: false, conversationIds: [conversationId], ...changes });
const recipient = (changes = {}) => ({ conversationId, client: { id: clientId, pseudonym: "Client test", email: "private-email" },
  state: "pending", reason: null, messageId: null, deliveredAt: null, leaseToken: "private-lease", ...changes });
const campaign = (changes = {}) => ({ id: campaignId, clientCampaignId: retryId, title: input().title, body: input().body, mediaId: null,
  allowRepeatMedia: false, status: "queued", createdAt: now, updatedAt: now, expiresAt: now + 7 * 86400000,
  counts: { total: 1, pending: 1, sending: 0, delivered: 0, skipped: 0, cancelled: 0, failed: 0, privateCount: 99 },
  recipients: [recipient()], payloadEncrypted: "private-ciphertext", adminId, mfaVersion: 3, ...changes });
const preview = (changes = {}) => ({ recipients: [{ conversationId, client: { id: clientId, pseudonym: "Client test", notes: "private-notes" }, eligible: true, reason: null, repeatMedia: false, preferenceVersion: "private-version" }],
  eligibleCount: 1, repeatCount: 0, privateKey: "private-key", ...changes });

function fixtureService(calls, overrides = {}) {
  return {
    async actor(role, value) { calls.push(["actor", role, value]); return value === (role === "admin" ? token : clientToken) ? actor(role) : null; },
    async preview(value, body) { calls.push(["preview", value, body]); return preview(); },
    async create(value, body) { calls.push(["create", value, body]); return { campaign: campaign({ title: body.title, body: body.body, mediaId: body.mediaId, allowRepeatMedia: body.allowRepeatMedia }), duplicate: false, secret: "private-secret" }; },
    async activity(value) { calls.push(["activity", value]); return { campaigns: [campaign()], secret: "private-secret" }; },
    async list(value, options) { calls.push(["list", value, options]); return { campaigns: [campaign()], nextCursor: null, hasMore: false, secret: "private-secret" }; },
    async get(value, id) { calls.push(["get", value, id]); return campaign(); },
    async cancel(value, id) { calls.push(["cancel", value, id]); return campaign({ status: "cancelled", counts: { total: 1, pending: 0, sending: 0, delivered: 0, skipped: 0, cancelled: 1, failed: 0 } }); },
    ...overrides,
  };
}

test("live activity is administrator-only, read-only, query-free and strips private service fields", async (t) => {
  const f = await fixture(t);
  const response = await get(f.base, `${root}/admin/activity`);
  assert.equal(response.status, 200); privateHeaders(response);
  const result = await response.json(); assert.equal(result.campaigns.length, 1);
  noInternals(result); assert.equal(Object.hasOwn(result.campaigns[0], "recipients"), false);
  assert.equal((await get(f.base, `${root}/admin/activity`, { Cookie: clientCookie })).status, 401);
  assert.equal((await get(f.base, `${root}/admin/activity`, {})).status, 401);
  assert.equal((await get(f.base, `${root}/admin/activity?limit=20`)).status, 400);
  assert.equal((await post(f.base, `${root}/admin/activity`, {})).status, 405);
  assert.equal(f.calls.filter((call) => call[0] === "activity").length, 1);
});

test("live activity rejects malformed, duplicated, misordered or unbounded service feeds", async (t) => {
  const rows = [null, { campaigns: null }, { campaigns: [campaign(), campaign()] },
    { campaigns: [campaign({ id: "a".repeat(32) }), campaign()] },
    { campaigns: Array.from({ length: 31 }, () => campaign()) }];
  for (const value of rows) {
    const f = await fixture(t, { activity: async () => value });
    await errorBody(await get(f.base, `${root}/admin/activity`), 503, "broadcast_unavailable");
  }
});

async function fixture(t, overrides = {}, options = {}) {
  const calls = [], service = fixtureService(calls, overrides), handler = createBroadcastHandler(service, { origin, mediaEnabled: true, ...options });
  const server = createServer(async (req, res) => { if (!await handler(req, res)) { res.writeHead(404); res.end("fallback"); } });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); });
  return { base: `http://127.0.0.1:${server.address().port}`, calls, service };
}
const mutationHeaders = (role = "admin", extra = {}) => ({ Origin: origin, "Content-Type": "application/json", "X-CSRF-Token": role === "admin" ? csrf : clientCsrf,
  Cookie: role === "admin" ? cookie : clientCookie, ...extra });
const post = (base, path, body, headers = mutationHeaders()) => fetch(`${base}${path}`, { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) });
const get = (base, path, headers = { Cookie: cookie }) => fetch(`${base}${path}`, { headers });
function privateHeaders(response) {
  for (const [name, value] of Object.entries(AUTH_HEADERS)) assert.equal(response.headers.get(name), value, name);
  assert.equal(response.headers.get("access-control-allow-origin"), null);
}
function noInternals(value) {
  assert.doesNotMatch(JSON.stringify(value), /private-|payloadEncrypted|mfaVersion|leaseToken|tokenHash|preferenceVersion|adminId/);
}
async function errorBody(response, status, error) {
  assert.equal(response.status, status); privateHeaders(response); assert.deepEqual(await response.json(), { error });
}

test("broadcast handler requires canonical HTTPS, a boolean capability and the full service", () => {
  const service = fixtureService([]);
  for (const invalid of ["http://example.invalid", `${origin}/`, `${origin}/path`, `${origin}?q=1`, "https://u:p@example.invalid"]) {
    assert.throws(() => createBroadcastHandler(service, { origin: invalid }));
  }
  assert.throws(() => createBroadcastHandler(service, { origin, mediaEnabled: "true" }));
  for (const method of methods) assert.throws(() => createBroadcastHandler({ ...service, [method]: null }, { origin }));
});

test("only the admin broadcast session is exposed with its fixed media capability", async (t) => {
  const { base, calls } = await fixture(t);
  const response = await get(base, `${root}/admin/session`);
  assert.equal(response.status, 200); privateHeaders(response);
  const body = await response.json(); noInternals(body);
  assert.deepEqual(body, { user: { id: adminId, role: "admin", pseudonym: "Jessie" }, csrf, expiresAt: now + 3600000, mediaEnabled: true });
  assert.deepEqual(calls, [["actor", "admin", token]]);
});

test("each role rejects missing, duplicate, noncanonical and opposite role cookies", async (t) => {
  const { base, calls } = await fixture(t);
  for (const role of ["admin"]) {
    const own = role === "admin" ? cookie : clientCookie, opposite = role === "admin" ? clientCookie : cookie;
    const cookieName = role === "admin" ? "__Host-jessie_session" : "__Host-jessie_client";
    for (const [header, cleared] of [[null, false], [opposite, false], ["unrelated=value", false], [`${cookieName}_extra=wrong`, false],
      [`${cookieName}=`, true], [`${cookieName}=${role === "admin" ? clientToken : token}`, true], [`${own}; ${own}`, true],
      [`${own}; ${cookieName}=wrong`, true], [`${cookieName}=${"A".repeat(42)}B`, true]]) {
      const response = await get(base, `${root}/${role}/session`, header ? { Cookie: header } : {});
      assert.equal(response.headers.get("set-cookie"), cleared ? `${cookieName}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Strict` : null);
      await errorBody(response, 401, "authentication_required");
    }
    assert.equal((await get(base, `${root}/${role}/session`, { Cookie: `${cookie}; ${clientCookie}` })).status, 200);
  }
  assert.equal(calls.some(([name]) => name !== "actor"), false);
});

test("wrong roles and corrupt actor DTOs fail before any broadcast data operation", async (t) => {
  const { base, calls, service } = await fixture(t);
  service.actor = async () => actor("client");
  await errorBody(await get(base, campaigns), 401, "authentication_required");
  for (const value of [actor("admin", { csrf: "bad" }), actor("admin", { expiresAt: -1 }),
    actor("admin", { user: { id: "A".repeat(32), role: "admin", pseudonym: "Jessie" } }),
    actor("admin", { user: { id: adminId, role: "admin", pseudonym: "\ud800" } })]) {
    service.actor = async () => value;
    await errorBody(await get(base, campaigns), 503, "broadcast_unavailable");
  }
  assert.equal(calls.some(([name]) => name !== "actor"), false);
});

test("all page and module GET/HEAD paths authenticate their own current role", async (t) => {
  const { base } = await fixture(t);
  for (const path of ["/admin/broadcasts", "/broadcast.js", "/broadcast-model.js", "/broadcast.css"]) {
    const client = false;
    for (const method of ["GET", "HEAD"]) {
      for (const [headers, cleared] of [[{}, false], [{ Cookie: client ? cookie : clientCookie }, false], [{ Cookie: "__Host-jessie_session=wrong" }, true]]) {
        const response = await fetch(`${base}${path}`, { method, headers });
        assert.equal(response.status, 401); privateHeaders(response);
        assert.equal(response.headers.get("set-cookie"), cleared ? "__Host-jessie_session=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Strict" : null);
        if (method === "HEAD") assert.equal(await response.text(), "");
        else assert.deepEqual(await response.json(), { error: "authentication_required" });
      }
    }
  }
});

test("authenticated page and source assets stay private and HEAD has no source body", async (t) => {
  const { base } = await fixture(t);
  for (const [path, type] of [["/admin/broadcasts", /text\/html/], ["/broadcast.js", /javascript/], ["/broadcast-model.js", /javascript/],
    ["/broadcast.css", /text\/css/]]) {
    const headers = { Cookie: cookie };
    const response = await get(base, path, headers);
    assert.equal(response.status, 200); privateHeaders(response); assert.match(response.headers.get("content-type"), type);
    assert.ok((await response.text()).length > 0);
    const head = await fetch(`${base}${path}`, { method: "HEAD", headers });
    assert.equal(head.status, 200); assert.equal(await head.text(), ""); privateHeaders(head);
  }
});

test("unauthenticated and CSRF-rejected POSTs never attach a JSON body reader", async () => {
  const handler = createBroadcastHandler(fixtureService([]), { origin });
  for (const [path, headers, status, error] of [[`${root}/admin/preview`, mutationHeaders("admin", { Cookie: "" }), 401, "authentication_required"],
    [campaigns, mutationHeaders("admin", { "X-CSRF-Token": "bad" }), 403, "csrf_failed"]]) {
    const req = new PassThrough(); req.url = path; req.method = "POST";
    req.headers = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
    let responseStatus, responseHeaders, body;
    const res = { headersSent: false, destroyed: false, writeHead(code, values) { responseStatus = code; responseHeaders = values; }, end(value) { body = value; } };
    assert.equal(await handler(req, res), true); assert.equal(responseStatus, status); assert.deepEqual(JSON.parse(body), { error });
    assert.equal(responseHeaders["Set-Cookie"], status === 401 ? "__Host-jessie_session=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Strict" : undefined);
    assert.equal(req.listenerCount("data"), 0); assert.equal(req.listenerCount("end"), 0); assert.equal(responseHeaders.Connection, "close"); req.destroy();
  }
});

test("all mutations require exact Origin, JSON and same origin fetch metadata", async (t) => {
  const { base, calls } = await fixture(t);
  for (const extra of [{ Origin: "https://attacker.example" }, { Origin: `${origin}/` }, { Origin: "null" },
    { "Sec-Fetch-Site": "cross-site" }, { "Sec-Fetch-Site": "same-site" }, { "X-CSRF-Token": "" }]) {
    await errorBody(await post(base, `${root}/admin/preview`, { conversationIds: [conversationId], mediaId: null }, mutationHeaders("admin", extra)),
      403, Object.hasOwn(extra, "X-CSRF-Token") ? "csrf_failed" : "request_rejected");
  }
  for (const type of ["text/plain", "application/json; charset=latin1", "application/x-www-form-urlencoded"]) {
    await errorBody(await post(base, campaigns, input(), mutationHeaders("admin", { "Content-Type": type })), 415, "json_required");
  }
  const headers = mutationHeaders(); delete headers.Origin;
  await errorBody(await post(base, campaigns, input(), headers), 403, "request_rejected");
  assert.equal(calls.some(([name]) => ["preview", "create"].includes(name)), false);
});

test("retired client broadcast routes and module fall through without authentication or body reads", async (t) => {
  const { base, calls } = await fixture(t);
  for (const path of ["/broadcast-preference.js", `${root}/client/session`, `${root}/client/preference`]) {
    for (const headers of [{}, { Cookie: clientCookie }, { Cookie: cookie }]) {
      for (const method of ["GET", "HEAD", "POST"]) {
        const response = await fetch(`${base}${path}`, { method, headers, ...(method === "POST" ? { body: "{}" } : {}) });
        assert.equal(response.status, 404, `${method} ${path}`); assert.equal(response.headers.get("set-cookie"), null);
      }
    }
  }
  assert.deepEqual(calls, []);
  const handler = createBroadcastHandler(fixtureService(calls), { origin });
  const req = new PassThrough(); req.url = `${root}/client/preference`; req.method = "POST"; req.headers = {};
  assert.equal(await handler(req, {}), false); assert.equal(req.listenerCount("data"), 0); req.destroy();
});





test("preview preserves explicit requested recipients and strips all private fields", async (t) => {
  const { base, calls, service } = await fixture(t);
  const body = { conversationIds: [conversationId], mediaId: null };
  const result = await post(base, `${root}/admin/preview`, body);
  assert.equal(result.status, 200); privateHeaders(result); const value = await result.json(); noInternals(value);
  assert.deepEqual(value, { recipients: [{ conversationId, client: { id: clientId, pseudonym: "Client test" }, eligible: true, reason: null, repeatMedia: false }], eligibleCount: 1, repeatCount: 0 });
  assert.deepEqual(calls.at(-1), ["preview", token, body]);
  service.preview = async () => preview({ recipients: [{ ...preview().recipients[0], eligible: false, reason: "access_inactive", repeatMedia: true }], eligibleCount: 0, repeatCount: 1 });
  const optedOut = await post(base, `${root}/admin/preview`, { ...body, mediaId });
  assert.equal(optedOut.status, 200); assert.equal((await optedOut.json()).repeatCount, 1);
});

test("preview and creation reject extra authority, malformed IDs, duplicate or unbounded audiences", async (t) => {
  const { base, calls } = await fixture(t);
  for (const body of [{ conversationIds: [], mediaId: null }, { conversationIds: [conversationId, conversationId], mediaId: null },
    { conversationIds: [conversationId], mediaId: null, adminId }, { conversationIds: ["A".repeat(32)], mediaId: null },
    { conversationIds: [conversationId], mediaId: "bad" }, { conversationIds: Array.from({ length: 101 }, (_, i) => i.toString(16).padStart(32, "0")), mediaId: null }]) {
    await errorBody(await post(base, `${root}/admin/preview`, body), 400, "invalid_request");
  }
  for (const body of [input({ body: "" }), input({ title: "\n" }), input({ title: "\ud800" }), input({ body: "\u0000" }), input({ body: "x".repeat(4097) }),
    input({ mediaId, body: "x".repeat(1001) }), input({ allowRepeatMedia: "true" }), input({ clientCampaignId: "D".repeat(32) }),
    { ...input(), adminId }, { ...input(), preference: true }, input({ conversationIds: [conversationId, conversationId] })]) {
    await errorBody(await post(base, campaigns, body), 400, "invalid_request");
  }
  assert.equal(calls.some(([name]) => ["preview", "create"].includes(name)), false);
});

test("preview rejects substituted, duplicated or contradictory service recipients", async (t) => {
  const { base, service } = await fixture(t);
  for (const value of [null, preview({ recipients: [] }), preview({ eligibleCount: 0 }), preview({ repeatCount: 1 }),
    preview({ recipients: [{ ...preview().recipients[0], conversationId: secondConversationId }] }),
    preview({ recipients: [preview().recipients[0], preview().recipients[0]] }),
    preview({ recipients: [{ ...preview().recipients[0], eligible: false }] }),
    preview({ recipients: [{ ...preview().recipients[0], reason: "private-reason" }] }),
    preview({ recipients: [{ ...preview().recipients[0], repeatMedia: true }], repeatCount: 1 })]) {
    service.preview = async () => value;
    await errorBody(await post(base, `${root}/admin/preview`, { conversationIds: [conversationId], mediaId: null }), 503, "broadcast_unavailable");
  }
});

test("campaign create and retry use 201/200 and preserve exact immutable request content", async (t) => {
  const { base, service, calls } = await fixture(t);
  for (const duplicate of [false, true]) {
    service.create = async (value, body) => { calls.push(["create", value, body]); return { campaign: campaign(), duplicate, payload: "private-payload" }; };
    const response = await post(base, campaigns, input());
    assert.equal(response.status, duplicate ? 200 : 201); const result = await response.json(); noInternals(result);
    assert.equal(result.duplicate, duplicate); assert.equal(result.campaign.body, input().body);
    assert.equal(Object.hasOwn(result.campaign, "recipients"), false);
    assert.deepEqual(calls.at(-1), ["create", token, input()]);
  }
  for (const change of [{ clientCampaignId: "0".repeat(32) }, { title: "Other" }, { body: "Other" }, { mediaId }, { allowRepeatMedia: true },
    { counts: { total: 2, pending: 2, sending: 0, delivered: 0, skipped: 0, cancelled: 0, failed: 0 } }]) {
    service.create = async () => ({ campaign: campaign(change), duplicate: false });
    await errorBody(await post(base, campaigns, input()), 503, "broadcast_unavailable");
  }
});

test("disabled media rejects preview and create photos before service calls", async (t) => {
  const { base, calls } = await fixture(t, {}, { mediaEnabled: false });
  const session = await get(base, `${root}/admin/session`); assert.equal((await session.json()).mediaEnabled, false);
  await errorBody(await post(base, `${root}/admin/preview`, { conversationIds: [conversationId], mediaId }), 409, "media_unavailable");
  await errorBody(await post(base, campaigns, input({ mediaId, body: "" })), 409, "media_unavailable");
  assert.equal(calls.some(([name]) => ["preview", "create"].includes(name)), false);
});

test("campaign history, detail and cancellation reveal no queue approval internals", async (t) => {
  const { base, calls, service } = await fixture(t);
  const list = await get(base, `${campaigns}?afterId=${"0".repeat(32)}&limit=50`);
  assert.equal(list.status, 200); const page = await list.json(); noInternals(page);
  assert.equal(Object.hasOwn(page.campaigns[0], "recipients"), false);
  assert.deepEqual(calls.at(-1), ["list", token, { afterId: "0".repeat(32), limit: 50 }]);
  const detail = await get(base, detailPath); assert.equal(detail.status, 200); const body = await detail.json(); noInternals(body);
  assert.equal(body.recipients.length, 1); assert.deepEqual(Object.keys(body.recipients[0]).sort(), ["client", "conversationId", "deliveredAt", "messageId", "reason", "state"]);
  const cancelled = await post(base, `${detailPath}/cancel`, {}); assert.equal(cancelled.status, 200);
  const result = await cancelled.json(); noInternals(result); assert.equal(result.status, "cancelled"); assert.equal(result.counts.cancelled, 1);
  assert.deepEqual(calls.at(-1), ["cancel", token, campaignId]);
  await errorBody(await post(base, `${detailPath}/cancel`, { clientId }), 400, "invalid_request");
  service.cancel = async () => campaign();
  await errorBody(await post(base, `${detailPath}/cancel`, {}), 503, "broadcast_unavailable");
});

test("queries reject unknown, repeated or noncanonical values on every route", async (t) => {
  const { base, calls } = await fixture(t);
  for (const suffix of ["?limit=0", "?limit=01", "?limit=51", "?limit=100", "?limit=1%0A", "?limit=1&limit=2", "?afterId=", "?afterId=" + "A".repeat(32),
    `?afterId=${campaignId}&afterId=${campaignId}`, "?adminId=" + adminId, "?q=secret", "?=empty"]) {
    await errorBody(await get(base, campaigns + suffix), 400, "invalid_request");
  }
  for (const path of [`${root}/admin/session?role=client`, 
    `${detailPath}?limit=1`, "/broadcast.js?cache=1"]) {
    await errorBody(await get(base, path, { Cookie: `${cookie}; ${clientCookie}` }), 400, "invalid_request");
  }
  await errorBody(await post(base, `${root}/admin/preview?limit=1`, { conversationIds: [conversationId], mediaId: null }), 400, "invalid_request");
  await errorBody(await post(base, `${detailPath}/cancel?limit=1`, {}), 400, "invalid_request");
  assert.equal(calls.some(([name]) => name !== "actor"), false);
});

test("campaign output validates counts, terminal states, body and detail identity", async (t) => {
  const { base, service } = await fixture(t);
  for (const value of [null, campaign({ id: "A".repeat(32) }), campaign({ title: "" }), campaign({ body: "\u0000" }), campaign({ mediaId: "bad" }),
    campaign({ expiresAt: now }), campaign({ updatedAt: now - 1 }), campaign({ status: "draft" }), campaign({ status: "completed" }),
    campaign({ counts: { ...campaign().counts, total: 2 } }), campaign({ counts: { ...campaign().counts, pending: -1 } }),
    campaign({ counts: { ...campaign().counts, total: 101, pending: 101 } }), campaign({ recipients: [] }),
    campaign({ recipients: [recipient({ conversationId: "A".repeat(32) })] }), campaign({ recipients: [recipient({ state: "delivered" })] }),
    campaign({ recipients: [recipient({ reason: "cancelled" })] }), campaign({ recipients: [recipient({ messageId })] })]) {
    service.get = async () => value;
    await errorBody(await get(base, detailPath), 503, "broadcast_unavailable");
  }
  service.get = async () => campaign({ id: "0".repeat(32) });
  await errorBody(await get(base, detailPath), 503, "broadcast_unavailable");
  service.get = async () => campaign({ status: "completed", counts: { total: 1, pending: 0, sending: 0, delivered: 1, skipped: 0, cancelled: 0, failed: 0 },
    recipients: [recipient({ state: "delivered", messageId, deliveredAt: now + 1 })] });
  assert.equal((await get(base, detailPath)).status, 200);
});

test("history pages reject reversed, duplicate, stale and unbounded cursor output", async (t) => {
  const { base, service } = await fixture(t);
  for (const value of [{ campaigns: [campaign(), campaign()], hasMore: false, nextCursor: null },
    { campaigns: [campaign({ id: retryId }), campaign()], hasMore: true, nextCursor: campaignId },
    { campaigns: [], hasMore: true, nextCursor: campaignId }, { campaigns: [campaign()], hasMore: true, nextCursor: retryId },
    { campaigns: [campaign(), campaign({ id: retryId })], hasMore: false, nextCursor: null }]) {
    service.list = async () => value;
    await errorBody(await get(base, `${campaigns}?limit=1`), 503, "broadcast_unavailable");
  }
  service.list = async () => ({ campaigns: [campaign()], hasMore: false, nextCursor: null });
  await errorBody(await get(base, `${campaigns}?afterId=${campaignId}`), 503, "broadcast_unavailable");
  service.list = async () => ({ campaigns: [campaign({ id: retryId })], hasMore: true, nextCursor: retryId });
  assert.equal((await get(base, `${campaigns}?afterId=${campaignId}&limit=1`)).status, 200);
});

test("JSON wire size is bounded for content length and chunked bodies with fatal UTF-8", async (t) => {
  const { base, calls } = await fixture(t);
  const wire = JSON.stringify(input()), padding = " ".repeat(32768 - Buffer.byteLength(wire));
  assert.equal((await post(base, campaigns, padding + wire)).status, 201);
  await errorBody(await post(base, campaigns, " " + padding + wire), 413, "request_too_large");
  for (const [chunks, expected] of [[[Buffer.alloc(32768, 32), Buffer.from("{}")], 413],
    [[Buffer.from('{"body":"'), Buffer.from([0xc3, 0x28]), Buffer.from('"}')], 400]]) {
    const result = await new Promise((resolve, reject) => {
      const req = httpRequest(`${base}${campaigns}`, { method: "POST", headers: mutationHeaders() }, (res) => {
        let body = ""; res.on("data", (chunk) => { body += chunk; }); res.on("end", () => resolve({ status: res.statusCode, body }));
      });
      req.on("error", reject); for (const chunk of chunks.slice(0, -1)) req.write(chunk); req.end(chunks.at(-1));
    });
    assert.equal(result.status, expected); assert.deepEqual(JSON.parse(result.body), { error: expected === 413 ? "request_too_large" : "invalid_request" });
  }
  assert.equal(calls.filter(([name]) => name === "create").length, 1);
});

test("service failures map to bounded public errors and clear only the affected role cookie", async (t) => {
  const { base, service } = await fixture(t);
  for (const [code, status, error] of [["BROADCAST_UNAUTHORIZED", 401, "authentication_required"], ["CHAT_UNAUTHORIZED", 401, "authentication_required"],
    ["AUTH_INVALID", 401, "authentication_required"], ["CHAT_FORBIDDEN", 403, "request_rejected"], ["BROADCAST_NOT_FOUND", 404, "not_found"],
    ["BROADCAST_CONFLICT", 409, "record_changed"], ["BROADCAST_LIMIT", 409, "limit_reached"], ["BROADCAST_RECIPIENTS", 409, "recipients_unavailable"],
    ["BROADCAST_REPEAT", 409, "repeat_confirmation_required"], ["BROADCAST_MEDIA", 409, "media_unavailable"], ["BROADCAST_INPUT", 400, "invalid_request"],
    ["BROADCAST_CRYPTO", 503, "broadcast_unavailable"], ["SQL_PRIVATE", 503, "broadcast_unavailable"]]) {
    service.get = async () => { throw Object.assign(new Error("private SQL credentials ciphertext"), { code, cause: "private-cause" }); };
    const response = await get(base, detailPath);
    assert.equal(response.headers.get("set-cookie"), status === 401 ? "__Host-jessie_session=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Strict" : null);
    await errorBody(response, status, error);
  }
  for (const value of [{ httpStatus: 200, publicCode: "private-secret" }, { httpStatus: 503, publicCode: "private-secret" }, new Error("private-stack")]) {
    service.get = async () => { throw value; };
    await errorBody(await get(base, detailPath), 503, "broadcast_unavailable");
  }
});

test("rate limiting provides a bounded Retry-After without coercing private objects", async (t) => {
  const { base, service } = await fixture(t);
  for (const [retryAfter, expected] of [[1.2, "2"], [-4, "1"], [90000, "3600"], [Infinity, "60"], [Symbol("private"), "60"],
    [{ valueOf() { throw new Error("private-coercion"); } }, "60"]]) {
    service.get = async () => { throw Object.assign(new Error("private-budget"), { code: "BROADCAST_RATE_LIMIT", retryAfter }); };
    const response = await get(base, detailPath); assert.equal(response.headers.get("retry-after"), expected);
    await errorBody(response, 429, "try_again_later");
  }
});

test("exact routes expose only their methods and unknown paths fall through untouched", async (t) => {
  const { base, calls } = await fixture(t);
  for (const [path, method, allow] of [[`${root}/admin/session`, "HEAD", "GET"], [`${root}/admin/preview`, "GET", "POST"],
    [campaigns, "OPTIONS", "GET, POST"], [detailPath, "POST", "GET"], [`${detailPath}/cancel`, "GET", "POST"],
    ["/broadcast.js", "POST", "GET, HEAD"], ["/admin/broadcasts", "OPTIONS", "GET, HEAD"]]) {
    const response = await fetch(`${base}${path}`, { method, ...(method === "POST" ? { body: "{}" } : {}) });
    assert.equal(response.status, 405); privateHeaders(response); assert.equal(response.headers.get("allow"), allow);
    if (method === "HEAD") assert.equal(await response.text(), ""); else assert.deepEqual(await response.json(), { error: "method_not_allowed" });
  }
  for (const path of [`${campaigns}/`, `${campaigns}/${"C".repeat(32)}`, `${detailPath}/cancel/`, "/broadcast.html", "/private/broadcast.js",
    `${root}/client/campaigns`, `${root}/admin/preference`, "/server/broadcast/http.mjs", "/admin/broadcasts/extra"]) {
    const response = await get(base, path); assert.equal(response.status, 404); assert.equal(await response.text(), "fallback");
  }
  assert.deepEqual(calls, []);
});

test("historical opted-out terminal recipients remain readable without becoming sendable again", async (t) => {
  const { base } = await fixture(t, { get: async () => campaign({
    status: "completed", counts: { total: 1, pending: 0, sending: 0, delivered: 0, skipped: 1, cancelled: 0, failed: 0 },
    recipients: [recipient({ state: "skipped", reason: "opted_out" })],
  }) });
  const response = await get(base, detailPath);
  assert.equal(response.status, 200); privateHeaders(response);
  const result = await response.json(); noInternals(result);
  assert.equal(result.status, "completed"); assert.equal(result.recipients[0].reason, "opted_out"); assert.equal(result.counts.pending, 0);
});
