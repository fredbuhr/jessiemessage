import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createProfileHandler } from "../server/profile/http.mjs";
import { AUTH_HEADERS } from "../server/auth/http.mjs";

const origin = "https://jessiemessage.example", tokens = { admin: Buffer.alloc(32, 1).toString("base64url"), client: Buffer.alloc(32, 2).toString("base64url") };
const csrf = Buffer.alloc(32, 3).toString("base64url"), cid = "c".repeat(32), avatarId = "a".repeat(32), jpeg = Buffer.from([255, 216, 255, 224, 1, 255, 217]);
const cookie = role => `${role === "admin" ? "__Host-jessie_session" : "__Host-jessie_client"}=${tokens[role]}`;
const headers = role => ({ Cookie: cookie(role), Origin: origin, "X-CSRF-Token": csrf, "Content-Type": "application/json" });
const body = { expectedVersion: "1", pseudonym: "Changed name", avatarId: null };
async function fixture(t, overrides = {}) {
  const calls = [], service = {
    async actor(role, token) { calls.push(["actor", role, token]); return token === tokens[role] ? { user: { id: (role === "admin" ? "1" : "2").repeat(32), role }, csrf,
      access: { state: "active", admissionPolicy: "manual_invitation", invitationConsumed: true, emailVerified: true, approved: true } } : null; },
    async profile(role, token) { calls.push(["profile", role, token]); return { pseudonym: "Name", version: "1", avatarId, avatarUrl: "https://foreign.invalid/private", email: "secret@example.invalid" }; },
    async save(role, token, input) { calls.push(["save", role, token, input]); return { pseudonym: input.pseudonym, version: "2", avatarId: input.avatarId, avatarUrl: null }; },
    async avatar(role, token, version) { calls.push(["avatar", role, token, version]); return { mime: "image/jpeg", bytes: jpeg }; },
    async peerAvatar(role, token, conversationId, version) { calls.push(["peer", role, token, conversationId, version]); return { mime: "image/jpeg", bytes: jpeg }; },
    ...overrides,
  };
  const handler = createProfileHandler(service, { origin });
  const server = createServer(async (req, res) => { if (!await handler(req, res)) { res.writeHead(404); res.end(); } });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return { base: `http://127.0.0.1:${server.address().port}`, calls, service };
}
function privateHeaders(response) { for (const [name, value] of Object.entries(AUTH_HEADERS)) assert.equal(response.headers.get(name), value); }

test("profile HTTP authenticates distinct role cookies and reconstructs only local own-avatar URLs", async t => {
  const f = await fixture(t);
  for (const role of ["admin", "client"]) {
    const response = await fetch(`${f.base}/api/profile/${role}`, { headers: headers(role) });
    assert.equal(response.status, 200); privateHeaders(response);
    assert.deepEqual(await response.json(), { pseudonym: "Name", version: "1", avatarId, avatarUrl: `/api/profile/${role}/avatar?v=1` });
  }
  const wrongRole = await fetch(`${f.base}/api/profile/client`, { headers: { Cookie: cookie("admin") } });
  assert.equal(wrongRole.status, 401); assert.equal(wrongRole.headers.get("set-cookie"), null);
  for (const suffix of ["/api/profile/client/users/" + avatarId, "/api/profile/client/" + avatarId + "/avatar", "/api/profile/unknown"]) assert.equal((await fetch(f.base + suffix, { headers: headers("client") })).status, 404);
});

test("profile HTTP requires CSRF, exact JSON shape and canonical versions before saving", async t => {
  const f = await fixture(t), url = `${f.base}/api/profile/client`;
  assert.equal((await fetch(url, { method: "POST", headers: headers("client"), body: JSON.stringify(body) })).status, 200);
  assert.equal(f.calls.filter(([name]) => name === "save").length, 1);
  for (const change of [{ Origin: "https://foreign.invalid" }, { "X-CSRF-Token": "bad" }, { "Content-Type": "text/plain" }]) {
    const result = await fetch(url, { method: "POST", headers: { ...headers("client"), ...change }, body: JSON.stringify(body) });
    assert.equal(result.status, Object.hasOwn(change, "Content-Type") ? 415 : 403);
  }
  for (const input of [null, [], {}, { ...body, userId: avatarId }, { ...body, expectedVersion: "01" }, { ...body, pseudonym: "\u200bHidden" }, { ...body, avatarId: "wrong" }]) {
    assert.equal((await fetch(url, { method: "POST", headers: headers("client"), body: JSON.stringify(input) })).status, 400);
  }
  assert.equal(f.calls.filter(([name]) => name === "save").length, 1);
});

test("own and conversation avatar routes support authenticated GET/HEAD thumbnails with one canonical version", async t => {
  const f = await fixture(t);
  for (const role of ["admin", "client"]) for (const suffix of ["avatar?v=1", `conversations/${cid}/avatar?v=2`]) {
    const url = `${f.base}/api/profile/${role}/${suffix}`;
    const response = await fetch(url, { headers: headers(role) });
    assert.equal(response.status, 200); privateHeaders(response);
    assert.equal(response.headers.get("content-type"), "image/jpeg"); assert.deepEqual(Buffer.from(await response.arrayBuffer()), jpeg);
    const head = await fetch(url, { method: "HEAD", headers: headers(role) });
    assert.equal(head.status, 200); assert.equal(head.headers.get("content-length"), String(jpeg.length)); assert.equal((await head.arrayBuffer()).byteLength, 0);
  }
  assert.ok(f.calls.filter(([name]) => name === "peer").every(([, , , conversation]) => conversation === cid));
  for (const query of ["", "?v=0", "?v=01", "?v=4294967296", "?v=1&v=1", "?v=1&userId=" + avatarId]) {
    assert.equal((await fetch(`${f.base}/api/profile/client/avatar${query}`, { headers: headers("client") })).status, 400);
  }
  assert.equal((await fetch(`${f.base}/api/profile/client/avatar?v=1`, { method: "POST", headers: headers("client"), body: "{}" })).status, 405);
});

test("profile HTTP sanitizes conflicts, forbidden conversations and private failures", async t => {
  const f = await fixture(t);
  for (const [code, status, expected] of [["PROFILE_CONFLICT", 409, "profile_changed"], ["PROFILE_AVATAR", 422, "avatar_invalid"], ["CHAT_FORBIDDEN", 403, "request_rejected"], ["OTHER", 503, "profile_unavailable"]]) {
    f.service.save = async () => { throw Object.assign(new Error("SELECT secret@example.invalid"), { code }); };
    const response = await fetch(`${f.base}/api/profile/client`, { method: "POST", headers: headers("client"), body: JSON.stringify(body) });
    assert.equal(response.status, status); assert.deepEqual(await response.json(), { error: expected });
  }
  f.service.peerAvatar = async () => { throw Object.assign(new Error("secret"), { code: "CHAT_NOT_FOUND" }); };
  const response = await fetch(`${f.base}/api/profile/client/conversations/${cid}/avatar?v=1`, { headers: headers("client") });
  assert.equal(response.status, 404); assert.deepEqual(await response.json(), { error: "not_found" });
});

test("profile HTTP refuses unapproved client sessions even from an alternate actor implementation", async t => {
  const f = await fixture(t, { actor: async () => ({ user: { id: avatarId, role: "client" }, csrf, access: { state: "pending" } }) });
  const response = await fetch(`${f.base}/api/profile/client`, { headers: headers("client") });
  assert.equal(response.status, 403); assert.equal(f.calls.some(([name]) => name === "profile"), false);
});
