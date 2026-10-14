import test from "node:test";
import assert from "node:assert/strict";
import { createServer, request as httpRequest } from "node:http";
import { PassThrough } from "node:stream";
import { AUTH_HEADERS, readJson } from "../server/auth/http.mjs";
import { createChatHandler } from "../server/chat/http.mjs";

const origin = "https://jessiemessage.example";
const tokens = { admin: Buffer.alloc(32, 7).toString("base64url"), client: Buffer.alloc(32, 11).toString("base64url") };
const csrf = Buffer.alloc(32, 9).toString("base64url");
const now = Date.now();
const conversationId = "1234567890abcdef1234567890abcdef";
const clientId = "c".repeat(32), adminId = "a".repeat(32), messageId = "b".repeat(32), clientMessageId = "d".repeat(32);
const cookie = (role) => `${role === "admin" ? "__Host-jessie_session" : "__Host-jessie_client"}=${tokens[role]}`;
const path = (role, action = "messages") => `/api/chat/${role}/conversations/${conversationId}/${action}`;
const conversation = (role) => ({
  id: conversationId, client: role === "admin" ? { id: clientId, pseudonym: "Client test", email: "secret@example.invalid" } : null,
  peerName: role === "admin" ? "Client test" : "Jessie", createdAt: now - 5000, closedAt: null, lastActivityAt: now,
  latestSequence: "1", latestEventSequence: "1", lastReadSequence: "0", peerReadSequence: "0", unreadCount: 1, canSend: true,
  privateNote: "private-crm-note", encryptedBody: "private-ciphertext",
});
const message = (overrides = {}) => ({
  id: messageId, sequence: "1", sender: "me", body: "Bonjour 👋 <script>example</script>", createdAt: now,
  deletedAt: null, clientMessageId, encryptedBody: "private-ciphertext", senderId: adminId, fingerprint: "private-fingerprint", ...overrides,
});
function deliveredMedia(role, overrides = {}) {
  const base = `/api/media/${role}/conversations/${conversationId}/messages/${messageId}`;
  return { id: "e".repeat(32), width: 100, height: 150, thumbnailWidth: 100, thumbnailHeight: 150,
    bytes: 1000, thumbnailBytes: 500, createdAt: now, sharedHere: true,
    fullUrl: `${base}/full`, thumbnailUrl: `${base}/thumb`, storageKey: "private-storage-key",
    contentDigest: "private-fingerprint", originalFilename: "private-filename", ...overrides };
}

async function fixture(t, overrides = {}) {
  const calls = [];
  const service = {
    async actor(role, value) {
      calls.push(["actor", role, value]);
      return value === tokens[role] ? { user: { id: role === "admin" ? adminId : clientId, role, pseudonym: role === "admin" ? "Jessie" : "Client test" }, csrf, expiresAt: now + 3600000, email: "secret@example.invalid", mfaSecret: "private-mfa" } : null;
    },
    async listConversations(value, options) { calls.push(["list", value, options]); return { conversations: [conversation("admin")], hasMore: false, nextCursor: null }; },
    async clientConversation(value) { calls.push(["conversation", value]); return conversation("client"); },
    async messages(role, value, id, options) {
      calls.push(["messages", role, value, id, options]);
      return { conversation: conversation(role), messages: [message()], hasMoreBefore: false, hasMoreAfter: false, nextBefore: "1", nextAfter: "1", eventCursor: "1" };
    },
    async events(role, value, id, options) {
      calls.push(["events", role, value, id, options]);
      return { conversation: conversation(role), events: [{ sequence: "1", kind: "message", occurredAt: now, message: message(), email: "secret@example.invalid" }], nextCursor: "1", hasMore: false };
    },
    async send(role, value, id, body) { calls.push(["send", role, value, id, body]); return { message: message({ body: body.body, clientMessageId: body.clientMessageId }), duplicate: false }; },
    async markRead(role, value, id, body) { calls.push(["read", role, value, id, body]); return { lastReadSequence: body.throughSequence }; },
    async delete(role, value, id, deletedId) { calls.push(["delete", role, value, id, deletedId]); return message({ body: null, deletedAt: now + 1 }); },
    ...overrides,
  };
  const handler = createChatHandler(service, { origin });
  const server = createServer(async (req, res) => { if (!await handler(req, res)) { res.writeHead(404); res.end("fallback"); } });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); });
  return { base: `http://127.0.0.1:${server.address().port}`, service, calls };
}

function mutationHeaders(role, extra = {}) {
  return { Origin: origin, "Content-Type": "application/json", "X-CSRF-Token": csrf, Cookie: cookie(role), ...extra };
}
function post(base, endpoint, body, headers = mutationHeaders("admin")) {
  return fetch(`${base}${endpoint}`, { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) });
}
function headersArePrivate(response) {
  for (const [name, value] of Object.entries(AUTH_HEADERS)) assert.equal(response.headers.get(name), value, name);
  assert.equal(response.headers.get("access-control-allow-origin"), null);
}
function privateFieldsAbsent(body) {
  assert.doesNotMatch(JSON.stringify(body), /private-ciphertext|private-fingerprint|secret@example|private-crm|private-mfa|encryptedBody|senderId|fingerprint/);
}

test("chat handler requires canonical HTTPS origin and its full service contract", () => {
  const service = Object.fromEntries(["actor", "listConversations", "clientConversation", "messages", "events", "send", "markRead", "delete"].map((key) => [key, () => {}]));
  for (const value of ["http://example.invalid", `${origin}/`, `${origin}/messages`, `${origin}?x=1`, "https://user:pass@example.invalid"]) assert.throws(() => createChatHandler(service, { origin: value }));
  assert.throws(() => createChatHandler({}, { origin }));
});

test("chat reads and events expose images through authorized delivery URLs while preserving text DTOs", async (t) => {
  const { base, service } = await fixture(t);
  for (const role of ["admin", "client"]) {
    service.messages = async () => ({ conversation: conversation(role), messages: [message({ body: "", media: deliveredMedia(role) })], hasMoreBefore: false, hasMoreAfter: false, nextBefore: "1", nextAfter: "1", eventCursor: "1" });
    const response = await fetch(`${base}${path(role)}`, { headers: { Cookie: cookie(role) } });
    assert.equal(response.status, 200); const result = await response.json(); privateFieldsAbsent(result);
    assert.equal(result.messages[0].body, "");
    assert.deepEqual(Object.keys(result.messages[0].media).sort(), ["bytes", "createdAt", "fullUrl", "height", "id", "sharedHere", "thumbnailBytes", "thumbnailHeight", "thumbnailUrl", "thumbnailWidth", "width"]);
    assert.equal(result.messages[0].media.fullUrl, `/api/media/${role}/conversations/${conversationId}/messages/${messageId}/full`);
    service.events = async () => ({ conversation: conversation(role), events: [{ sequence: "1", kind: "message", occurredAt: now, message: message({ body: "<script>plain caption</script>", media: deliveredMedia(role) }) }], nextCursor: "1", hasMore: false });
    const events = await fetch(`${base}${path(role, "events")}`, { headers: { Cookie: cookie(role) } });
    assert.equal(events.status, 200); assert.equal((await events.json()).events[0].message.body, "<script>plain caption</script>");
  }
  service.messages = async () => ({ conversation: conversation("admin"), messages: [message()], hasMoreBefore: false, hasMoreAfter: false, nextBefore: "1", nextAfter: "1", eventCursor: "1" });
  const response = await fetch(`${base}${path("admin")}`, { headers: { Cookie: cookie("admin") } });
  assert.equal(Object.hasOwn((await response.json()).messages[0], "media"), false);
});

test("chat images reject foreign URLs, invalid metadata or captions and remove media on tombstones", async (t) => {
  const { base, service } = await fixture(t);
  const read = () => fetch(`${base}${path("admin")}`, { headers: { Cookie: cookie("admin") } });
  for (const value of [
    message({ body: "", media: deliveredMedia("client") }),
    message({ body: "", media: deliveredMedia("admin", { fullUrl: "https://other.example/photo.jpg" }) }),
    message({ body: "", media: deliveredMedia("admin", { fullUrl: `/api/media/admin/assets/${"e".repeat(32)}/full` }) }),
    message({ body: "", media: deliveredMedia("admin", { sharedHere: false }) }),
    message({ body: "", media: deliveredMedia("admin", { bytes: 10485761 }) }),
    message({ body: "x".repeat(1001), media: deliveredMedia("admin") }),
    message({ body: "\u200b", media: deliveredMedia("admin") }),
    message({ body: "\ud800", media: deliveredMedia("admin") }),
    message({ body: null, deletedAt: now + 1, media: deliveredMedia("admin") }),
  ]) {
    service.messages = async () => ({ conversation: conversation("admin"), messages: [value], hasMoreBefore: false, hasMoreAfter: false, nextBefore: "1", nextAfter: "1", eventCursor: "1" });
    const response = await read(); assert.equal(response.status, 503); assert.deepEqual(await response.json(), { error: "messaging_unavailable" });
  }
  service.events = async () => ({ conversation: conversation("admin"), events: [{ sequence: "1", kind: "delete", occurredAt: now + 1, message: message({ body: null, deletedAt: now + 1, media: null }) }], nextCursor: "1", hasMore: false });
  const deleted = await fetch(`${base}${path("admin", "events")}`, { headers: { Cookie: cookie("admin") } });
  assert.equal(deleted.status, 200); const body = await deleted.json();
  assert.equal(body.events[0].message.body, null); assert.equal(Object.hasOwn(body.events[0].message, "media"), false);
});

test("chat capability and conversation responses authenticate roles and whitelist private DTOs", async (t) => {
  const { base, calls } = await fixture(t);
  for (const role of ["admin", "client"]) {
    const capabilities = await fetch(`${base}/api/chat/${role}/capabilities`, { headers: { Cookie: cookie(role) } });
    assert.equal(capabilities.status, 200);
    headersArePrivate(capabilities);
    assert.deepEqual(await capabilities.json(), { enabled: true });
    const response = await fetch(`${base}${role === "admin" ? "/api/chat/admin/conversations" : "/api/chat/client/conversation"}`, { headers: { Cookie: cookie(role) } });
    assert.equal(response.status, 200);
    const body = await response.json();
    privateFieldsAbsent(body);
    const dto = role === "admin" ? body.conversations[0] : body;
    assert.equal(dto.id, conversationId);
    assert.equal(dto.client?.id ?? null, role === "admin" ? clientId : null);
    if (dto.client) assert.deepEqual(Object.keys(dto.client).sort(), ["id", "pseudonym"]);
  }
  assert.deepEqual(calls.find(([name]) => name === "list"), ["list", tokens.admin, { afterId: null, limit: 50 }]);
});

test("role cookies are distinct, canonical, unique and never fall back to the other role", async (t) => {
  const { base, calls } = await fixture(t);
  for (const role of ["admin", "client"]) {
    const other = role === "admin" ? "client" : "admin";
    for (const header of [undefined, cookie(other), `${cookie(role)}; ${cookie(role)}`, `${cookie(role)}; ${cookie(role).split("=")[0]}=wrong`, `${cookie(role)}=`, cookie(role).replace(tokens[role], "A".repeat(42) + "B")]) {
      const before = calls.length;
      const response = await fetch(`${base}${path(role)}`, { headers: header ? { Cookie: header } : {} });
      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), { error: "authentication_required" });
      assert.match(response.headers.get("set-cookie"), new RegExp(`^${cookie(role).split("=")[0]}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Strict$`));
      assert.equal(calls.length, before);
    }
    const both = await fetch(`${base}${path(role)}`, { headers: { Cookie: `${cookie(other)}; ${cookie(role)}` } });
    assert.equal(both.status, 200);
    assert.deepEqual(calls.at(-2), ["actor", role, tokens[role]]);
  }
});

test("current actor authentication, role and client prerequisites fail closed", async (t) => {
  const { base, service, calls } = await fixture(t);
  service.actor = async () => null;
  assert.equal((await fetch(`${base}${path("admin")}`, { headers: { Cookie: cookie("admin") } })).status, 401);
  service.actor = async () => ({ user: { id: adminId, role: "admin", pseudonym: "Jessie" }, csrf, expiresAt: now + 3600000 });
  assert.equal((await fetch(`${base}${path("client")}`, { headers: { Cookie: cookie("client") } })).status, 503);
  service.actor = async () => ({ user: { id: clientId, role: "client", pseudonym: "Client" }, csrf, expiresAt: now + 3600000, access: { state: "pending", emailVerified: true, ageAssured: false, approved: true } });
  const response = await fetch(`${base}${path("client")}`, { headers: { Cookie: cookie("client") } });
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "request_rejected" });
  assert.equal(calls.some(([name]) => name === "messages"), false);
});

test("message reads and event streams preserve full integer precision without private fields", async (t) => {
  const maximum = "18446744073709551615";
  const { base, service, calls } = await fixture(t);
  service.messages = async (role, value, id, options) => {
    calls.push(["messages", role, value, id, options]);
    return { conversation: { ...conversation(role), latestSequence: maximum, latestEventSequence: maximum }, messages: [message({ sequence: maximum })], hasMoreBefore: true, hasMoreAfter: false, nextBefore: maximum, nextAfter: maximum, eventCursor: maximum };
  };
  const response = await fetch(`${base}${path("admin")}?before=${maximum}&limit=100`, { headers: { Cookie: cookie("admin") } });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.messages[0].sequence, maximum);
  assert.equal(body.messages[0].body, message().body);
  privateFieldsAbsent(body);
  assert.deepEqual(calls.at(-1), ["messages", "admin", tokens.admin, conversationId, { before: maximum, after: null, limit: 100 }]);
  const events = await fetch(`${base}${path("client", "events")}`, { headers: { Cookie: cookie("client") } });
  assert.equal(events.status, 200);
  privateFieldsAbsent(await events.json());
  assert.deepEqual(calls.at(-1), ["events", "client", tokens.client, conversationId, { after: "0", limit: 100 }]);
});

test("queries accept only known unique bounded canonical parameters", async (t) => {
  const { base, calls } = await fixture(t);
  for (const suffix of ["?after=0&before=2", "?after=01", "?after=-1", "?after=18446744073709551616", "?after=1.0", "?after=1e2", "?after=%2B1", "?after=", "?after=1%0A", "?after=1%0D", "?after=1&after=2", "?limit=0", "?limit=101", "?limit=01", "?limit=1%0A", "?limit=1&limit=2", "?senderId=x", "?role=admin"]) {
    const response = await fetch(`${base}${path("admin")}${suffix}`, { headers: { Cookie: cookie("admin") } });
    assert.equal(response.status, 400, suffix);
    assert.deepEqual(await response.json(), { error: "invalid_request" });
  }
  for (const suffix of ["?afterId=invalid", "?afterId=" + "A".repeat(32), "?afterId=" + clientId + "%0A", "?afterId=" + clientId + "&afterId=" + clientId, "?before=1"]) {
    assert.equal((await fetch(`${base}/api/chat/admin/conversations${suffix}`, { headers: { Cookie: cookie("admin") } })).status, 400);
  }
  assert.equal(calls.some(([name]) => ["messages", "list"].includes(name)), false);
  const list = await fetch(`${base}/api/chat/admin/conversations?afterId=${clientId}&limit=1`, { headers: { Cookie: cookie("admin") } });
  assert.equal(list.status, 200);
  assert.deepEqual(calls.at(-1), ["list", tokens.admin, { afterId: clientId, limit: 1 }]);
});

test("all chat mutations require exact origin, JSON and current actor CSRF without a preauth header", async (t) => {
  const { base, calls } = await fixture(t);
  const body = { clientMessageId, body: "Bonjour" };
  for (const extra of [{ Origin: "https://attacker.example" }, { Origin: `${origin}/` }, { Origin: "null" }, { "Sec-Fetch-Site": "cross-site" }, { "Sec-Fetch-Site": "same-site" }, { "X-CSRF-Token": "wrong" }, { "X-CSRF-Token": "" }]) {
    const response = await post(base, path("admin"), body, mutationHeaders("admin", extra));
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: Object.hasOwn(extra, "X-CSRF-Token") ? "csrf_failed" : "request_rejected" });
  }
  const headers = mutationHeaders("admin"); delete headers.Origin;
  assert.equal((await post(base, path("admin"), body, headers)).status, 403);
  for (const contentType of ["text/plain", "application/x-www-form-urlencoded", "application/json; charset=latin1"]) {
    assert.equal((await post(base, path("admin"), body, mutationHeaders("admin", { "Content-Type": contentType }))).status, 415);
  }
  assert.equal(calls.some(([name]) => name === "send"), false);
  const response = await post(base, path("admin"), body, mutationHeaders("admin", { "Sec-Fetch-Site": "same-origin" }));
  assert.equal(response.status, 201);
  assert.equal(response.headers.get("set-cookie"), null);
  assert.deepEqual(calls.at(-1), ["send", "admin", tokens.admin, conversationId, body]);
});

test("client CSRF failures are distinguishable from inactive access and preserve its valid cookie", async (t) => {
  const { base, service, calls } = await fixture(t);
  const body = { clientMessageId, body: "Bonjour" };
  const response = await post(base, path("client"), body, mutationHeaders("client", { "X-CSRF-Token": "incorrect" }));
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "csrf_failed" });
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(calls.some(([name]) => name === "send"), false);
  service.actor = async () => { throw Object.assign(new Error("private access detail"), { code: "ACCESS_EXPIRED" }); };
  const expired = await post(base, path("client"), body, mutationHeaders("client"));
  assert.equal(expired.status, 403);
  assert.deepEqual(await expired.json(), { error: "request_rejected" });
});

test("send permits large UTF-8 plain text, never accepts sender, recipient or ciphertext fields", async (t) => {
  const { base, calls } = await fixture(t);
  const large = "界".repeat(4096);
  const response = await post(base, path("client"), { clientMessageId, body: large }, mutationHeaders("client"));
  assert.equal(response.status, 201);
  assert.equal((await response.json()).message.body, large);
  for (const body of [null, [], {}, { body: "Hello" }, { clientMessageId, body: "" }, { clientMessageId, body: "  \n\t " }, { clientMessageId, body: "\u200b" }, { clientMessageId, body: "\u0000" }, { clientMessageId, body: "\ud800" }, { clientMessageId, body: "x".repeat(4097) }, { clientMessageId: "D".repeat(32), body: "Hello" }, { clientMessageId: `${clientMessageId}\n`, body: "Hello" }, { clientMessageId, body: "Hello", senderId: adminId }, { clientMessageId, body: "Hello", role: "admin" }, { clientMessageId, body: "Hello", ciphertext: "secret" }, { clientMessageId, body: "Hello", createdAt: now }]) {
    const rejected = await post(base, path("client"), JSON.stringify(body), mutationHeaders("client"));
    assert.equal(rejected.status, 400, JSON.stringify(body).slice(0, 100));
    assert.deepEqual(await rejected.json(), { error: "invalid_request" });
  }
  assert.equal(calls.filter(([name]) => name === "send").length, 1);
});

test("chat extended body limit is bounded for declared and chunked messages", async (t) => {
  const { base, calls } = await fixture(t);
  const response = await post(base, path("admin"), "x".repeat(32769));
  assert.equal(response.status, 413);
  assert.equal(response.headers.get("connection"), "close");
  const chunked = await new Promise((resolve, reject) => {
    const req = httpRequest(`${base}${path("admin")}`, { method: "POST", headers: mutationHeaders("admin") }, (res) => {
      res.resume(); res.on("end", () => resolve(res.statusCode));
    });
    req.on("error", reject);
    req.write("x".repeat(16384)); req.end("x".repeat(16385));
  });
  assert.equal(chunked, 413);
  const readTooLarge = await post(base, path("admin", "read"), "x".repeat(4097));
  assert.equal(readTooLarge.status, 413);
  assert.equal(calls.some(([name]) => ["send", "read"].includes(name)), false);
});

test("extended readJson still rejects malformed UTF-8 transport data", async (t) => {
  const { base, calls } = await fixture(t);
  const result = await new Promise((resolve, reject) => {
    const req = httpRequest(`${base}${path("admin")}`, { method: "POST", headers: mutationHeaders("admin") }, (res) => {
      res.resume(); res.on("end", () => resolve(res.statusCode));
    });
    req.on("error", reject);
    req.end(Buffer.concat([Buffer.from(`{"clientMessageId":"${clientMessageId}","body":"`), Buffer.from([0xc3, 0x28]), Buffer.from('"}') ]));
  });
  assert.equal(result, 400);
  assert.equal(calls.some(([name]) => name === "send"), false);
});

test("readJson optional limit preserves the default and rejects unbounded programmer configuration", async () => {
  for (const maxBytes of [0, -1, 32769, NaN, Infinity, "4096", 1.1]) assert.throws(() => readJson({ headers: {} }, { maxBytes }), TypeError);
  const request = new PassThrough(); request.headers = {};
  const promise = readJson(request, { maxBytes: 8192 });
  request.end(JSON.stringify({ body: "界".repeat(2000) }));
  assert.equal((await promise).body.length, 2000);
});

test("successful sends preserve idempotency result and conflict responses are bounded", async (t) => {
  const { base, service } = await fixture(t);
  service.send = async () => ({ message: message(), duplicate: true, privateFingerprint: "never-public" });
  const duplicate = await post(base, path("admin"), { clientMessageId, body: "Bonjour" });
  assert.equal(duplicate.status, 200);
  const body = await duplicate.json();
  assert.equal(body.duplicate, true);
  privateFieldsAbsent(body);
  service.send = async () => { throw Object.assign(new Error("original body secret"), { code: "CHAT_CONFLICT" }); };
  const conflict = await post(base, path("admin"), { clientMessageId, body: "Bonjour" });
  assert.equal(conflict.status, 409);
  assert.deepEqual(await conflict.json(), { error: "message_conflict" });
});

test("read cursors and deletions require strict payloads and canonical identifiers", async (t) => {
  const { base, calls } = await fixture(t);
  const maximum = "18446744073709551615";
  const read = await post(base, path("client", "read"), { throughSequence: maximum }, mutationHeaders("client"));
  assert.equal(read.status, 200);
  assert.deepEqual(await read.json(), { lastReadSequence: maximum });
  assert.deepEqual(calls.at(-1), ["read", "client", tokens.client, conversationId, { throughSequence: maximum }]);
  for (const body of [{ throughSequence: 1 }, { throughSequence: "01" }, { throughSequence: "-1" }, { throughSequence: "1\n" }, { throughSequence: "18446744073709551616" }, { throughSequence: "1", userId: adminId }, {}]) {
    assert.equal((await post(base, path("client", "read"), body, mutationHeaders("client"))).status, 400);
  }
  const endpoint = `${path("admin")}/${messageId}/delete`;
  assert.equal((await post(base, endpoint, { id: messageId })).status, 400);
  const deleted = await post(base, endpoint, {});
  assert.equal(deleted.status, 200);
  assert.equal((await deleted.json()).message.body, null);
  assert.deepEqual(calls.at(-1), ["delete", "admin", tokens.admin, conversationId, messageId]);
  for (const endpoint of [path("admin").replace(conversationId, "A".repeat(32)), path("admin").replace(conversationId, "x".repeat(32)), `${path("admin")}/${"B".repeat(32)}/delete`, `/api/chat/admin/conversations/${conversationId}/read/${messageId}/delete`, path("admin").replace("admin", "ADMIN")]) {
    assert.equal((await fetch(`${base}${endpoint}`)).status, 404);
  }
});

test("chat HTTP errors hide private service exceptions and clear only an unauthorized role cookie", async (t) => {
  const { base, service } = await fixture(t);
  for (const [code, status, error] of [["CHAT_UNAUTHORIZED", 401, "authentication_required"], ["AUTH_INVALID", 401, "authentication_required"], ["CHAT_FORBIDDEN", 403, "request_rejected"], ["ACCESS_EXPIRED", 403, "request_rejected"], ["ACCESS_PREREQUISITES", 403, "request_rejected"], ["CHAT_NOT_FOUND", 404, "not_found"], ["CHAT_INPUT", 400, "invalid_request"], ["CHAT_RATE_LIMIT", 429, "try_again_later"], ["AUTH_RATE_LIMIT", 429, "try_again_later"], ["SQL_PRIVATE_FAILURE", 503, "messaging_unavailable"]]) {
    service.messages = async () => { throw Object.assign(new Error("private database ciphertext credentials"), { code, retryAfter: 17.2 }); };
    const response = await fetch(`${base}${path("client")}`, { headers: { Cookie: cookie("client") } });
    assert.equal(response.status, status, code);
    assert.deepEqual(await response.json(), { error });
    headersArePrivate(response);
    if (status === 401) assert.match(response.headers.get("set-cookie"), /^__Host-jessie_client=;/);
    else assert.equal(response.headers.get("set-cookie"), null);
    if (status === 429) assert.equal(response.headers.get("retry-after"), "18");
  }
  for (const retryAfter of [-5, Infinity, 99999]) {
    service.messages = async () => { throw Object.assign(new Error("private"), { code: "CHAT_RATE_LIMIT", retryAfter }); };
    const response = await fetch(`${base}${path("client")}`, { headers: { Cookie: cookie("client") } });
    assert.equal(response.headers.get("retry-after"), retryAfter === -5 ? "1" : retryAfter === Infinity ? "60" : "3600");
  }
});

test("malformed service output fails closed before ciphertext or invalid DTO values are emitted", async (t) => {
  const { base, service } = await fixture(t);
  const good = service.messages;
  for (const alteration of [
    { messages: [message({ body: null })] }, { messages: [message({ body: "", deletedAt: null })] },
    { messages: [message({ body: "secret deleted body", deletedAt: now + 1 })] },
    { messages: [message({ sender: "peer", clientMessageId })] },
    { messages: [message({ sequence: 1 })] }, { messages: [message({ sequence: "1\n" })] }, { messages: [message({ sequence: "18446744073709551616" })] },
    { messages: [message({ id: "B".repeat(32) })] }, { messages: [message({ id: `${messageId}\n` })] }, { messages: [message({ createdAt: NaN })] },
    { conversation: { ...conversation("admin"), closedAt: now, canSend: true } },
    { conversation: { ...conversation("admin"), lastReadSequence: "2" } },
    { conversation: { ...conversation("admin"), id: "f".repeat(32) } },
    { conversation: { ...conversation("admin"), unreadCount: "1" } }, { eventCursor: 1 },
  ]) {
    service.messages = async (...args) => ({ ...await good(...args), ...alteration });
    const response = await fetch(`${base}${path("admin")}`, { headers: { Cookie: cookie("admin") } });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "messaging_unavailable" });
  }
  service.clientConversation = async () => ({ ...conversation("client"), client: { id: clientId, pseudonym: "Private client" } });
  assert.equal((await fetch(`${base}/api/chat/client/conversation`, { headers: { Cookie: cookie("client") } })).status, 503);
});

test("event streams reject reversed cursors, duplicates and undeleted delete records", async (t) => {
  const { base, service } = await fixture(t);
  for (const data of [
    { events: [{ sequence: "1", kind: "delete", occurredAt: now, message: message() }], nextCursor: "1" },
    { events: [{ sequence: "1", kind: "message", occurredAt: now, message: message() }, { sequence: "1", kind: "message", occurredAt: now, message: message() }], nextCursor: "1" },
    { events: [], nextCursor: "1" },
  ]) {
    service.events = async () => ({ conversation: conversation("admin"), hasMore: false, ...data });
    const response = await fetch(`${base}${path("admin", "events")}`, { headers: { Cookie: cookie("admin") } });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "messaging_unavailable" });
  }
});

test("exact routes enforce methods and API HEAD never returns JSON or service data", async (t) => {
  const { base, calls } = await fixture(t);
  for (const [endpoint, method, allow] of [[path("admin"), "OPTIONS", "GET, POST"], [path("client", "events"), "POST", "GET"], [path("client", "read"), "GET", "POST"], ["/api/chat/admin/conversations", "HEAD", "GET"], ["/api/chat/client/conversation", "HEAD", "GET"], ["/messages", "POST", "GET, HEAD"], ["/chat.js", "POST", "GET, HEAD"]]) {
    const response = await fetch(`${base}${endpoint}`, { method });
    assert.equal(response.status, 405);
    assert.equal(response.headers.get("allow"), allow);
    if (method === "HEAD") assert.equal(await response.text(), "");
  }
  assert.equal(calls.length, 0);
  for (const endpoint of ["/api/chat/admin/unknown", "/chat.html", "/server/chat/http.mjs", "/messages/", "/api/chat/client/conversations"]) {
    const response = await fetch(`${base}${endpoint}`);
    assert.equal(response.status, 404);
    assert.equal(await response.text(), "fallback");
  }
});

test("protected chat pages redirect absent and inactive accounts before serving the UI", async (t) => {
  const { base, service } = await fixture(t);
  for (const [endpoint, location] of [["/messages", "/access"], ["/admin/messages", "/admin/login"]]) {
    const response = await fetch(`${base}${endpoint}`, { redirect: "manual" });
    assert.equal(response.status, 303);
    assert.equal(response.headers.get("location"), location);
    assert.equal(await response.text(), "");
    headersArePrivate(response);
    const head = await fetch(`${base}${endpoint}`, { method: "HEAD", redirect: "manual" });
    assert.equal(head.status, 303);
    assert.equal(await head.text(), "");
  }
  service.actor = async () => { throw Object.assign(new Error("private prerequisite detail"), { code: "ACCESS_PREREQUISITES" }); };
  const inactive = await fetch(`${base}/messages`, { headers: { Cookie: cookie("client") }, redirect: "manual" });
  assert.equal(inactive.status, 303);
  assert.equal(inactive.headers.get("location"), "/access");
});

test("authenticated pages share the safe UI shell and its explicit assets", async (t) => {
  const { base } = await fixture(t);
  for (const [endpoint, role] of [["/messages", "client"], ["/admin/messages", "admin"]]) {
    const response = await fetch(`${base}${endpoint}`, { headers: { Cookie: cookie(role) } });
    assert.equal(response.status, 200);
    headersArePrivate(response);
    assert.match(response.headers.get("content-type"), /text\/html/);
    const html = await response.text();
    assert.match(html, /chat\.js/);
    assert.doesNotMatch(html, /private-ciphertext|secret@example|data:image|private-mfa/);
    const head = await fetch(`${base}${endpoint}`, { method: "HEAD", headers: { Cookie: cookie(role) } });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
  }
  for (const [endpoint, type] of [["/chat.js", /javascript/], ["/chat-model.js", /javascript/], ["/chat.css", /text\/css/]]) {
    const response = await fetch(`${base}${endpoint}`);
    assert.equal(response.status, 200);
    headersArePrivate(response);
    assert.match(response.headers.get("content-type"), type);
    assert.equal((await fetch(`${base}${endpoint}`, { method: "HEAD" })).status, 200);
  }
});
