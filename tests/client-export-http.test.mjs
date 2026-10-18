import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createChatHandler } from "../server/chat/http.mjs";
import { ConversationExportError } from "../server/chat/conversation-export.mjs";

const origin = "https://client.example", id = n => n.toString(16).padStart(32, "0"), conversationId = id(1), clientId = id(2);
const token = "A".repeat(43), csrf = Buffer.alloc(32, 9).toString("base64url"), cookie = `__Host-jessie_client=${token}`;
const actor = () => ({ user: { id: clientId, role: "client", pseudonym: "Synthetic client" }, csrf, expiresAt: Date.now() + 3600000,
  access: { state: "active", admissionPolicy: "manual_invitation", invitationConsumed: true, emailVerified: true, approved: true } });
const conversation = () => ({ id: conversationId, client: null, peerName: "Jess", createdAt: 1, closedAt: null, lastActivityAt: 1,
  latestSequence: "0", latestEventSequence: "0", lastReadSequence: "0", peerReadSequence: "0", unreadCount: 0, canSend: true });
const headers = (changes = {}) => ({ Origin: origin, "Content-Type": "application/json", "X-Jessie-Request": "1", Cookie: cookie, "X-CSRF-Token": csrf, ...changes });
const path = `/api/chat/client/conversations/${conversationId}/export`;
const archive = () => { const value = Buffer.alloc(40, 9); value.writeUInt32LE(0x04034b50); return value; };

async function fixture(t, { create = async () => archive(), photos = true, disabled = false, ...overrides } = {}) {
  const calls = [], actorCalls = [];
  const service = Object.fromEntries(["listConversations", "messages", "events", "send", "markRead", "delete"].map(name => [name, async () => { throw Error(`Unexpected ${name}`); }]));
  Object.assign(service, { actor: async (role, value) => { actorCalls.push({ role, token: value }); return role === "client" && value === token ? actor() : null; }, clientConversation: async () => conversation(), ...overrides });
  const exporter = { photos, maxBytes: 1000, create: async input => { calls.push(input); return create(input); } };
  const handler = createChatHandler(service, { origin, clientConversationExporter: disabled ? null : exporter });
  const server = createServer(async (req, res) => { if (!await handler(req, res)) { res.writeHead(404); res.end(); } });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { handler.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (body = { includePhotos: true }, custom = headers(), suffix = path) => fetch(base + suffix, { method: "POST", headers: custom, body: JSON.stringify(body) });
  return { base, post, handler, calls, actorCalls };
}

test("client archive uses only the authenticated client and fixed conversation, then wipes its buffer", async t => {
  const buffer = archive(), f = await fixture(t, { create: async () => buffer });
  const caps = await fetch(f.base + "/api/chat/client/capabilities", { headers: { Cookie: cookie } });
  assert.deepEqual(await caps.json(), { enabled: true, conversationExport: { enabled: true, photos: true, maxBytes: 1000 } });
  const r = await f.post(); assert.equal(r.status, 200); const received = Buffer.from(await r.arrayBuffer());
  assert.equal(received.readUInt32LE(), 0x04034b50); assert.equal(received.length, 40);
  assert.match(r.headers.get("content-disposition"), new RegExp(`${conversationId}\\.zip`)); assert.equal(r.headers.get("content-length"), "40");
  assert.match(r.headers.get("cache-control"), /no-store/); assert.equal(r.headers.get("set-cookie"), null);
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].expectedClientId, clientId); assert.equal(f.calls[0].clientName, "Synthetic client");
  assert.equal(f.calls[0].token, token); assert.equal(f.calls[0].includePhotos, true); assert.equal(buffer.every(byte => byte === 0), true);
  assert.equal(f.actorCalls.every(call => call.role === "client"), true);
});

test("client archive refuses wrong account, Origin, CSRF, query, body and foreign conversation before preparing", async t => {
  const f = await fixture(t);
  for (const [body, custom, suffix, status] of [
    [{ includePhotos: true }, headers({ Cookie: "" }), path, 401],
    [{ includePhotos: true }, headers({ Cookie: `__Host-jessie_session=${token}` }), path, 401],
    [{ includePhotos: true }, headers({ Cookie: "__Host-jessie_client=" + "C".repeat(43) }), path, 401],
    [{ includePhotos: true }, headers({ Origin: "https://foreign.invalid" }), path, 403],
    [{ includePhotos: true }, headers({ Origin: "" }), path, 403],
    [{ includePhotos: true }, headers({ "X-CSRF-Token": "invalid" }), path, 403],
    [{ includePhotos: true }, headers(), path + "?client=" + id(3), 400],
    [{ includePhotos: true, clientId: id(3) }, headers(), path, 400],
    [{ includePhotos: "true" }, headers(), path, 400],
    [{}, headers(), path, 400],
    [{ includePhotos: true }, headers(), path.replace(conversationId, id(3)), 404]
  ]) { const r = await f.post(body, custom, suffix); assert.equal(r.status, status, JSON.stringify({ body, suffix, status })); assert.equal(r.headers.get("set-cookie"), null); await r.arrayBuffer(); }
  const method = await fetch(f.base + path, { headers: { Cookie: cookie } }); assert.equal(method.status, 405); assert.equal(method.headers.get("allow"), "POST");
  assert.equal(f.calls.length, 0);
});

test("client archive scripts require current admission and are absent when export is disabled", async t => {
  const f = await fixture(t);
  for (const asset of ["/conversation-download.js", "/client-archive.js"]) for (const method of ["GET", "HEAD"]) {
    assert.equal((await fetch(f.base + asset, { method })).status, 401);
    assert.equal((await fetch(f.base + asset, { method, headers: { Cookie: cookie } })).status, 200);
    assert.equal((await fetch(f.base + asset, { method, headers: { Cookie: `__Host-jessie_session=${token}` } })).status, 401);
  }
  for (const changes of [{ state: "expired" }, { approved: false }, { emailVerified: false }, { invitationConsumed: false }, { admissionPolicy: "wrong" }]) {
    const denied = await fixture(t, { actor: async () => ({ ...actor(), access: { ...actor().access, ...changes } }) });
    assert.equal((await denied.post()).status, 403); assert.equal(denied.calls.length, 0);
  }
  const disabled = await fixture(t, { disabled: true });
  assert.equal((await disabled.post()).status, 404);
  assert.equal((await fetch(disabled.base + "/client-archive.js", { headers: { Cookie: cookie } })).status, 404);
  assert.deepEqual(await (await fetch(disabled.base + "/api/chat/client/capabilities", { headers: { Cookie: cookie } })).json(), { enabled: true });
});

test("revocation, identity/CSRF replacement and conversation rebinding suppress a prepared client archive", async t => {
  for (const change of ["revoked", "identity", "csrf", "conversation"]) {
    let prepared = false; const buffer = archive();
    const f = await fixture(t, { create: async () => { prepared = true; return buffer; },
      actor: async () => prepared && change === "revoked" ? null : { ...actor(), ...(prepared && change === "csrf" ? { csrf: Buffer.alloc(32, 8).toString("base64url") } : {}),
        user: { ...actor().user, ...(prepared && change === "identity" ? { id: id(3) } : {}) } },
      clientConversation: async () => ({ ...conversation(), ...(prepared && change === "conversation" ? { id: id(3) } : {}) }) });
    const r = await f.post(); assert.equal(r.status, change === "conversation" ? 409 : 401); assert.equal(r.headers.get("set-cookie"), null);
    assert.equal(r.headers.get("content-disposition"), null); assert.equal(buffer.every(byte => byte === 0), true); assert.equal(f.calls.length, 1);
  }
});

test("client archive failures and shutdown stay bounded and expose no internal details", async t => {
  for (const [code, status, publicCode] of [["limit", 413, "conversation_export_limit"], ["busy", 429, "conversation_export_busy"], ["changed", 409, "conversation_export_changed"], ["unavailable", 503, "conversation_export_unavailable"]]) {
    const f = await fixture(t, { create: async () => { throw new ConversationExportError(code); } });
    const r = await f.post(); assert.equal(r.status, status); assert.deepEqual(await r.json(), { error: publicCode });
    if (status === 429) assert.equal(r.headers.get("retry-after"), "30");
  }
  const malformed = await fixture(t, { create: async () => Buffer.alloc(40, 9) }); assert.equal((await malformed.post()).status, 503);
  const textOnly = await fixture(t, { photos: false }); assert.equal((await textOnly.post()).status, 400); assert.equal(textOnly.calls.length, 0);
  let entered; const ready = new Promise(resolve => { entered = resolve; }); let cancelled = false;
  const f = await fixture(t, { create: ({ signal }) => new Promise((resolve, reject) => { entered(); signal.addEventListener("abort", () => { cancelled = true; reject(new ConversationExportError("cancelled")); }, { once: true }); }) });
  const pending = f.post(); await ready; f.handler.close(); const r = await pending;
  assert.equal(r.status, 503); assert.equal(cancelled, true); assert.equal(f.calls.length, 1);
  assert.equal((await f.post()).status, 503); assert.equal(f.calls.length, 1);
});
