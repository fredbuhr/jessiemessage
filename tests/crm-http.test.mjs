import test from "node:test";
import assert from "node:assert/strict";
import { createServer, request as httpRequest } from "node:http";
import { PassThrough } from "node:stream";
import { AUTH_HEADERS, readJson } from "../server/auth/http.mjs";
import { createCrmHandler } from "../server/crm/http.mjs";

const origin = "https://jessiemessage.example";
const token = Buffer.alloc(32, 7).toString("base64url"), clientToken = Buffer.alloc(32, 11).toString("base64url");
const csrf = Buffer.alloc(32, 9).toString("base64url");
const now = Date.now(), conversationId = "1234567890abcdef1234567890abcdef";
const adminId = "a".repeat(32), clientId = "b".repeat(32), labelId = "c".repeat(32), groupId = "d".repeat(32);
const root = "/api/admin/crm", profilePath = `${root}/conversations/${conversationId}`;
const cookie = `__Host-jessie_session=${token}`;
const actor = () => ({ user: { id: adminId, role: "admin", pseudonym: "Jessie" }, expiresAt: now + 3600000, csrf, mfaSecret: "private-mfa" });
const label = (changes = {}) => ({ id: labelId, kind: "tag", name: "VIP", version: "1", createdAt: now - 1000,
  updatedAt: now, memberCount: 2, ownerAdminId: adminId, normalizedName: "private-normalized", ...changes });
const access = () => ({ state: "active", expiresAt: null, assuranceEvidenceId: "private-age-evidence" });
const profile = (changes = {}) => ({ conversationId, client: { id: clientId, pseudonym: "Client test", email: "client@example.invalid",
  status: "active", passwordHash: "private-password" }, access: access(), nickname: "Contact préféré", notes: "Notes privées <script>example</script>\n",
  reminderAt: now + 5000, labels: [label()], version: "1", updatedAt: now,
  notesRevision: "1", notesEncrypted: "private-ciphertext", privateKey: "private-key", ...changes });
const contact = (changes = {}) => ({ id: conversationId, client: { id: clientId, pseudonym: "Client test", email: "private-email@example.invalid" },
  peerName: "Client test", createdAt: now - 5000, closedAt: null, lastActivityAt: now,
  latestSequence: "1", latestEventSequence: "1", lastReadSequence: "0", peerReadSequence: "0", unreadCount: 1, canSend: true,
  crm: { nickname: "Contact préféré", labels: [label()], reminderAt: now + 5000, version: "1", notes: "private-inbox-notes", notesEncrypted: "private-ciphertext" },
  access: access(), email: "private-email@example.invalid", notes: "private-inbox-notes", ...changes });
const profileInput = (changes = {}) => ({ expectedVersion: "1", nickname: "Contact préféré", notes: "Notes privées <script>example</script>\n",
  reminderAt: now + 5000, labelIds: [labelId], ...changes });
const methods = ["actor", "listLabels", "createLabel", "renameLabel", "deleteLabel", "profile", "saveProfile", "contacts"];

function fixtureService(calls, overrides = {}) {
  return {
    async actor(value) { calls.push(["actor", value]); return value === token ? actor() : null; },
    async listLabels(value, options) { calls.push(["listLabels", value, options]); return { labels: [label()], nextCursor: null, hasMore: false }; },
    async createLabel(value, body) { calls.push(["createLabel", value, body]); return { label: label({ kind: body.kind, name: body.name }), duplicate: false }; },
    async renameLabel(value, id, body) { calls.push(["renameLabel", value, id, body]); return label({ id, name: body.name, version: "2" }); },
    async deleteLabel(value, id, body) { calls.push(["deleteLabel", value, id, body]); return { deleted: true, privateNotes: "private" }; },
    async profile(value, id) { calls.push(["profile", value, id]); return profile(); },
    async saveProfile(value, id, body) { calls.push(["saveProfile", value, id, body]); return profile({ nickname: body.nickname, notes: body.notes, reminderAt: body.reminderAt, version: "2" }); },
    async contacts(value, options) { calls.push(["contacts", value, options]); return { contacts: [contact()], nextCursor: null, hasMore: false }; },
    ...overrides,
  };
}

async function fixture(t, overrides = {}) {
  const calls = [], service = fixtureService(calls, overrides), handler = createCrmHandler(service, { origin });
  const server = createServer(async (req, res) => { if (!await handler(req, res)) { res.writeHead(404); res.end("fallback"); } });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); });
  return { base: `http://127.0.0.1:${server.address().port}`, calls, service };
}
const mutationHeaders = (extra = {}) => ({ Origin: origin, "Content-Type": "application/json", "X-CSRF-Token": csrf, Cookie: cookie, ...extra });
const post = (base, endpoint, body, headers = mutationHeaders()) => fetch(`${base}${endpoint}`, { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) });
const get = (base, endpoint, headers = { Cookie: cookie }) => fetch(`${base}${endpoint}`, { headers });
function privateHeaders(response) {
  for (const [name, value] of Object.entries(AUTH_HEADERS)) assert.equal(response.headers.get(name), value, name);
  assert.equal(response.headers.get("access-control-allow-origin"), null);
}
function internalFieldsAbsent(body) {
  assert.doesNotMatch(JSON.stringify(body), /private-ciphertext|private-key|private-password|private-age-evidence|private-normalized|notesRevision|notesEncrypted|ownerAdminId|normalizedName|passwordHash/);
}

test("CRM handler validates canonical HTTPS origin and the full service contract", () => {
  const service = Object.fromEntries(methods.map((key) => [key, () => {}]));
  for (const value of ["http://example.invalid", `${origin}/`, `${origin}/crm`, `${origin}?a=1`, "https://user:pass@example.invalid"]) {
    assert.throws(() => createCrmHandler(service, { origin: value }));
  }
  assert.throws(() => createCrmHandler({}, { origin }));
});

test("CRM capabilities require current administrator authentication and expose only fixed limits", async (t) => {
  const { base, calls } = await fixture(t);
  const response = await get(base, `${root}/capabilities`);
  assert.equal(response.status, 200); privateHeaders(response);
  assert.deepEqual(await response.json(), { enabled: true, limits: { labelsPerKind: 100, labelsPerClient: 32, noteCharacters: 8000 } });
  assert.deepEqual(calls, [["actor", token]]);
});

test("CRM never accepts client cookies, forged admin cookies, duplicate cookies or noncanonical tokens", async (t) => {
  const { base, calls } = await fixture(t);
  for (const header of [null, `__Host-jessie_client=${clientToken}`, `__Host-jessie_session=${clientToken}`, `${cookie}; ${cookie}`,
    `${cookie}; __Host-jessie_session=wrong`, `__Host-jessie_session=${"A".repeat(42)}B`, `${cookie}=`]) {
    const response = await get(base, `${root}/contacts`, header ? { Cookie: header } : {});
    assert.equal(response.status, 401); privateHeaders(response);
    assert.deepEqual(await response.json(), { error: "authentication_required" });
    assert.equal(response.headers.get("set-cookie"), "__Host-jessie_session=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Strict");
  }
  assert.equal(calls.some(([name]) => name === "contacts"), false);
  const response = await get(base, `${root}/contacts`, { Cookie: `__Host-jessie_client=${clientToken}; ${cookie}` });
  assert.equal(response.status, 200);
});

test("CRM authenticates the current admin role and MFA-backed service session before data access", async (t) => {
  const { base, calls, service } = await fixture(t);
  for (const session of [null, { ...actor(), user: { id: clientId, role: "client", pseudonym: "Client" } }]) {
    service.actor = async () => session;
    const response = await get(base, `${root}/contacts`);
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "authentication_required" });
  }
  service.actor = async () => ({ ...actor(), csrf: "incorrect" });
  const response = await get(base, `${root}/contacts`);
  assert.equal(response.status, 503); assert.deepEqual(await response.json(), { error: "crm_unavailable" });
  assert.equal(calls.some(([name]) => name === "contacts"), false);
});

test("all private CRM assets authenticate GET and HEAD before reading any source", async (t) => {
  const { base, calls } = await fixture(t);
  for (const endpoint of ["/crm.js", "/crm-model.js", "/crm.css"]) {
    for (const method of ["GET", "HEAD"]) {
      for (const headers of [{}, { Cookie: `__Host-jessie_client=${clientToken}` }, { Cookie: `__Host-jessie_session=${clientToken}` }]) {
        const response = await fetch(`${base}${endpoint}`, { method, headers });
        assert.equal(response.status, 401); privateHeaders(response);
        if (method === "HEAD") assert.equal(await response.text(), "");
        else assert.deepEqual(await response.json(), { error: "authentication_required" });
      }
    }
  }
  assert.equal(calls.some(([name]) => name !== "actor"), false);
});

test("authenticated CRM assets have private headers and HEAD has no source body", async (t) => {
  const { base } = await fixture(t);
  for (const [endpoint, type] of [["/crm.js", /javascript/], ["/crm-model.js", /javascript/], ["/crm.css", /text\/css/]]) {
    const response = await get(base, endpoint);
    assert.equal(response.status, 200); privateHeaders(response); assert.match(response.headers.get("content-type"), type);
    assert.ok((await response.text()).length > 0);
    const head = await fetch(`${base}${endpoint}`, { method: "HEAD", headers: { Cookie: cookie } });
    assert.equal(head.status, 200); assert.equal(await head.text(), "");
  }
});

test("anonymous mutations and CSRF failures finish before a JSON body reader is attached", async () => {
  const calls = [], service = fixtureService(calls), handler = createCrmHandler(service, { origin });
  for (const [headers, status, error] of [
    [mutationHeaders({ Cookie: "" }), 401, "authentication_required"],
    [mutationHeaders({ "X-CSRF-Token": "wrong" }), 403, "csrf_failed"],
  ]) {
    const req = new PassThrough(); req.url = profilePath; req.method = "POST"; req.headers = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
    let body, responseStatus, responseHeaders;
    const res = { headersSent: false, destroyed: false, writeHead(code, values) { responseStatus = code; responseHeaders = values; }, end(value) { body = value; } };
    assert.equal(await handler(req, res), true);
    assert.equal(responseStatus, status); assert.deepEqual(JSON.parse(body), { error });
    assert.equal(req.listenerCount("data"), 0); assert.equal(req.listenerCount("end"), 0);
    assert.equal(responseHeaders.Connection, "close"); req.destroy();
  }
  assert.equal(calls.some(([name]) => name === "saveProfile"), false);
});

test("CRM mutations require exact origin, JSON and current administrator CSRF", async (t) => {
  const { base, calls } = await fixture(t);
  for (const extra of [{ Origin: "https://attacker.example" }, { Origin: `${origin}/` }, { Origin: "null" },
    { "Sec-Fetch-Site": "cross-site" }, { "Sec-Fetch-Site": "same-site" }, { "X-CSRF-Token": "wrong" }, { "X-CSRF-Token": "" }]) {
    const response = await post(base, root + "/labels", { kind: "tag", name: "VIP" }, mutationHeaders(extra));
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: Object.hasOwn(extra, "X-CSRF-Token") ? "csrf_failed" : "request_rejected" });
  }
  for (const type of ["text/plain", "application/json; charset=latin1", "application/x-www-form-urlencoded"]) {
    assert.equal((await post(base, root + "/labels", { kind: "tag", name: "VIP" }, mutationHeaders({ "Content-Type": type }))).status, 415);
  }
  const headers = mutationHeaders(); delete headers.Origin;
  assert.equal((await post(base, root + "/labels", {}, headers)).status, 403);
  assert.equal(calls.some(([name]) => name === "createLabel"), false);
  const response = await post(base, root + "/labels", { kind: "tag", name: "VIP" }, mutationHeaders({ "Sec-Fetch-Site": "same-origin" }));
  assert.equal(response.status, 201); assert.equal(response.headers.get("set-cookie"), null);
});

test("label list and create/rename/delete routes pass exact canonical inputs and strip internal fields", async (t) => {
  const { base, calls, service } = await fixture(t);
  const list = await get(base, `${root}/labels?kind=tag&limit=1`);
  assert.equal(list.status, 200); const listBody = await list.json(); internalFieldsAbsent(listBody);
  assert.deepEqual(calls.at(-1), ["listLabels", token, { kind: "tag", afterId: null, limit: 1 }]);
  assert.deepEqual(Object.keys(listBody.labels[0]).sort(), ["createdAt", "id", "kind", "memberCount", "name", "updatedAt", "version"]);
  for (const duplicate of [false, true]) {
    service.createLabel = async (value, body) => { calls.push(["createLabel", value, body]); return { label: label(), duplicate, rawNotes: "private" }; };
    const result = await post(base, `${root}/labels`, { kind: "tag", name: "VIP" });
    assert.equal(result.status, duplicate ? 200 : 201); const body = await result.json(); assert.equal(body.duplicate, duplicate); internalFieldsAbsent(body);
  }
  const rename = await post(base, `${root}/labels/${labelId}/rename`, { name: "Fidèles", expectedVersion: "1" });
  assert.equal(rename.status, 200); assert.equal((await rename.json()).label.version, "2");
  assert.deepEqual(calls.at(-1), ["renameLabel", token, labelId, { name: "Fidèles", expectedVersion: "1" }]);
  const deleted = await post(base, `${root}/labels/${labelId}/delete`, { expectedVersion: "2" });
  assert.equal(deleted.status, 200); assert.deepEqual(await deleted.json(), { deleted: true });
  assert.deepEqual(calls.at(-1), ["deleteLabel", token, labelId, { expectedVersion: "2" }]);
});

test("label payloads reject extra authority fields, malformed names and noncanonical uint32 versions", async (t) => {
  const { base, calls } = await fixture(t);
  for (const body of [null, [], {}, { kind: "tag" }, { kind: "room", name: "VIP" }, { kind: "tag", name: "" },
    { kind: "tag", name: "\u200b" }, { kind: "tag", name: "x".repeat(65) }, { kind: "tag", name: "\ud800" },
    { kind: "tag", name: "VIP", adminId }, { kind: "tag", name: "VIP", ownerAdminId: adminId }, { kind: "tag", name: "VIP", version: "1" }]) {
    const response = await post(base, `${root}/labels`, JSON.stringify(body));
    assert.equal(response.status, 400, JSON.stringify(body)); assert.deepEqual(await response.json(), { error: "invalid_request" });
  }
  for (const version of [0, 1, "0", "01", "1\n", "1.0", "+1", "4294967296", "-1", null]) {
    assert.equal((await post(base, `${root}/labels/${labelId}/rename`, { name: "VIP", expectedVersion: version })).status, 400);
    assert.equal((await post(base, `${root}/labels/${labelId}/delete`, { expectedVersion: version })).status, 400);
  }
  assert.equal((await post(base, `${root}/labels/${labelId}/delete`, { expectedVersion: "1", clientId })).status, 400);
  assert.equal(calls.some(([name]) => ["createLabel", "renameLabel", "deleteLabel"].includes(name)), false);
});

test("contact queries retain literal search and combine private filters without exposing notes or email", async (t) => {
  const { base, calls } = await fixture(t);
  const params = new URLSearchParams({ q: "client%_", tagId: labelId, groupId, access: "expired", unread: "1", reminder: "due", afterId: "0".repeat(32), limit: "100" });
  const response = await get(base, `${root}/contacts?${params}`);
  assert.equal(response.status, 200); privateHeaders(response);
  const body = await response.json(); internalFieldsAbsent(body);
  assert.doesNotMatch(JSON.stringify(body), /private-email|private-inbox-notes|"email"|"notes"/);
  assert.deepEqual(calls.at(-1), ["contacts", token, { q: "client%_", tagId: labelId, groupId, access: "expired", unread: true,
    reminder: "due", afterId: "0".repeat(32), limit: 100 }]);
  assert.equal(body.contacts[0].crm.nickname, "Contact préféré");
  await get(base, `${root}/contacts`);
  assert.deepEqual(calls.at(-1), ["contacts", token, { q: "", tagId: null, groupId: null, access: "all", unread: false, reminder: "all", afterId: null, limit: 50 }]);
});

test("CRM queries reject unknown or duplicate keys, loose flags, IDs, sizes and private note search", async (t) => {
  const { base, calls } = await fixture(t);
  for (const suffix of ["?q=a&q=b", "?q=" + "x".repeat(81), "?q=%00", "?notes=secret", "?role=admin", "?adminId=" + adminId,
    "?unread=0", "?unread=true", "?unread=", "?access=unknown", "?reminder=expired", "?tagId=", "?groupId=" + "D".repeat(32),
    "?afterId=" + labelId + "%0A", "?limit=0", "?limit=01", "?limit=101", "?limit=1%0A", "?limit=1&limit=2"]) {
    assert.equal((await get(base, `${root}/contacts${suffix}`)).status, 400, suffix);
  }
  for (const suffix of ["?kind=room", "?kind=", "?kind=tag&kind=group", "?afterId=" + "A".repeat(32), "?afterId=" + labelId + "%0A", "?q=test", "?limit=1000"]) {
    assert.equal((await get(base, `${root}/labels${suffix}`)).status, 400, suffix);
  }
  for (const endpoint of [`${profilePath}?notes=1`, `${root}/capabilities?q=1`, "/crm.js?x=1"]) {
    assert.equal((await get(base, endpoint)).status, 400);
  }
  assert.equal(calls.some(([name]) => ["contacts", "listLabels", "profile"].includes(name)), false);
});

test("private profile reads and atomic saves expose approved fields only and preserve exact notes", async (t) => {
  const { base, calls } = await fixture(t);
  const read = await get(base, profilePath);
  assert.equal(read.status, 200); const body = await read.json(); internalFieldsAbsent(body);
  assert.deepEqual(Object.keys(body).sort(), ["access", "client", "conversationId", "labels", "nickname", "notes", "reminderAt", "updatedAt", "version"]);
  assert.deepEqual(Object.keys(body.client).sort(), ["email", "id", "pseudonym", "status"]);
  assert.equal(body.client.email, "client@example.invalid"); assert.equal(body.notes, profile().notes);
  const input = profileInput({ notes: " \n<script>plain notes</script>\t " });
  const saved = await post(base, profilePath, input);
  assert.equal(saved.status, 200); const result = await saved.json(); internalFieldsAbsent(result);
  assert.equal(result.notes, input.notes); assert.equal(result.version, "2");
  assert.deepEqual(calls.at(-1), ["saveProfile", token, conversationId, input]);
});

test("absent profiles use version zero and no synthetic labels or notes", async (t) => {
  const { base } = await fixture(t, { async profile() { return profile({ version: "0", nickname: "", notes: "", labels: [], reminderAt: null, updatedAt: null }); } });
  const response = await get(base, profilePath); assert.equal(response.status, 200);
  const result = await response.json(); assert.equal(result.version, "0"); assert.equal(result.notes, ""); assert.equal(result.updatedAt, null); assert.deepEqual(result.labels, []);
});

test("profile JSON accepts 8000 escaped characters with a bounded 64 KiB wire budget", async (t) => {
  const { base, calls } = await fixture(t);
  const input = profileInput({ notes: "界".repeat(8000) });
  const wire = JSON.stringify(input).replaceAll("界", "\\u754c");
  assert.ok(Buffer.byteLength(wire) > 32768 && Buffer.byteLength(wire) < 65536);
  const response = await post(base, profilePath, wire);
  assert.equal(response.status, 200); assert.equal((await response.json()).notes, input.notes);
  assert.equal(calls.at(-1)[3].notes, input.notes);
  const tooLarge = await post(base, profilePath, "x".repeat(65537));
  assert.equal(tooLarge.status, 413); assert.equal(tooLarge.headers.get("connection"), "close");
  const other = await post(base, `${root}/labels`, "x".repeat(4097));
  assert.equal(other.status, 413);
});

test("profile chunked bodies and malformed UTF-8 cannot bypass the byte budget or parser", async (t) => {
  const { base, calls } = await fixture(t);
  for (const [chunks, expected] of [[ [Buffer.alloc(32768, 120), Buffer.alloc(32769, 120)], 413 ],
    [ [Buffer.from('{"notes":"'), Buffer.from([0xc3, 0x28]), Buffer.from('"}')], 400 ]]) {
    const status = await new Promise((resolve, reject) => {
      const req = httpRequest(`${base}${profilePath}`, { method: "POST", headers: mutationHeaders() }, (res) => { res.resume(); res.on("end", () => resolve(res.statusCode)); });
      req.on("error", reject); for (const chunk of chunks.slice(0, -1)) req.write(chunk); req.end(chunks.at(-1));
    });
    assert.equal(status, expected);
  }
  assert.equal(calls.some(([name]) => name === "saveProfile"), false);
});

test("profile full saves reject missing fields, hidden authority, duplicate labels and malformed values", async (t) => {
  const { base, calls } = await fixture(t);
  const missing = profileInput(); delete missing.notes;
  for (const body of [missing, profileInput({ expectedVersion: "01" }), profileInput({ expectedVersion: 1 }), profileInput({ expectedVersion: "4294967296" }),
    profileInput({ nickname: "x".repeat(65) }), profileInput({ nickname: "\ud800" }), profileInput({ notes: "x".repeat(8001) }),
    profileInput({ notes: "\u0000" }), profileInput({ notes: "\ud800" }), profileInput({ notes: null }),
    profileInput({ reminderAt: "2026-10-15" }), profileInput({ reminderAt: 1.5 }), profileInput({ reminderAt: -1 }), profileInput({ reminderAt: 253402300800000 }),
    profileInput({ labelIds: [labelId, labelId] }), profileInput({ labelIds: ["C".repeat(32)] }), profileInput({ labelIds: [labelId + "\n"] }),
    profileInput({ labelIds: Array.from({ length: 33 }, (_, i) => i.toString(16).padStart(32, "0")) }),
    { ...profileInput(), adminId }, { ...profileInput(), notesEncrypted: "private" }, { ...profileInput(), clientId }, { ...profileInput(), version: "1" }]) {
    const response = await post(base, profilePath, body);
    assert.equal(response.status, 400, JSON.stringify(body).slice(0, 100)); assert.deepEqual(await response.json(), { error: "invalid_request" });
  }
  assert.equal(calls.some(([name]) => name === "saveProfile"), false);
});

test("CRM output rejects malformed profiles, contact gates, labels and private service DTOs", async (t) => {
  const { base, service } = await fixture(t);
  for (const change of [{ conversationId: "f".repeat(32) }, { notes: "\u0000" }, { version: "01" }, { version: "0" }, { labels: [label(), label()] },
    { client: { ...profile().client, email: "INVALID@example.invalid" } }, { client: { ...profile().client, status: "admin" } },
    { reminderAt: -1 }, { updatedAt: null }, { notes: "x".repeat(8001) }, { nickname: " alias " }]) {
    service.profile = async () => profile(change);
    const response = await get(base, profilePath); assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "crm_unavailable" });
  }
  for (const change of [{ canSend: true, access: { state: "expired", expiresAt: now - 1 } }, { lastReadSequence: "2" }, { latestSequence: 1 },
    { crm: { ...contact().crm, version: "4294967296" } }, { unreadCount: "1" }, { closedAt: now, canSend: true },
    { crm: { ...contact().crm, labels: [label({ name: " bad " })] } }]) {
    service.contacts = async () => ({ contacts: [contact(change)], hasMore: false, nextCursor: null });
    const response = await get(base, `${root}/contacts`); assert.equal(response.status, 503); assert.deepEqual(await response.json(), { error: "crm_unavailable" });
  }
});

test("CRM pagination rejects reversed, duplicated, foreign and unbounded output cursors", async (t) => {
  const { base, service } = await fixture(t);
  for (const result of [
    { labels: [label(), label()], nextCursor: null, hasMore: false },
    { labels: [label({ id: groupId }), label()], nextCursor: labelId, hasMore: true },
    { labels: [label()], nextCursor: groupId, hasMore: true },
    { labels: [], nextCursor: labelId, hasMore: true },
    { labels: [label({ version: "0" })], nextCursor: null, hasMore: false },
    { labels: [label({ memberCount: -1 })], nextCursor: null, hasMore: false },
    { labels: [label(), label({ id: groupId })], nextCursor: null, hasMore: false },
  ]) {
    service.listLabels = async () => result;
    const response = await get(base, `${root}/labels?limit=1`); assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "crm_unavailable" });
  }
  service.listLabels = async () => ({ labels: [label()], nextCursor: null, hasMore: false });
  assert.equal((await get(base, `${root}/labels?afterId=${labelId}`)).status, 503);
  service.listLabels = async () => ({ labels: [label({ id: groupId })], nextCursor: groupId, hasMore: true });
  assert.equal((await get(base, `${root}/labels?afterId=${labelId}&limit=1`)).status, 200);
});

test("label responses retain their requested kind, canonical identity and renamed resource binding", async (t) => {
  const { base, service } = await fixture(t);
  service.listLabels = async () => ({ labels: [label({ kind: "group" })], nextCursor: null, hasMore: false });
  assert.equal((await get(base, `${root}/labels?kind=tag`)).status, 503);
  service.createLabel = async () => ({ label: label({ kind: "group" }), duplicate: false });
  assert.equal((await post(base, `${root}/labels`, { kind: "tag", name: "VIP" })).status, 503);
  service.createLabel = async () => ({ label: label({ name: "Foreign" }), duplicate: true });
  assert.equal((await post(base, `${root}/labels`, { kind: "tag", name: "VIP" })).status, 503);
  service.createLabel = async () => ({ label: label(), duplicate: true });
  assert.equal((await post(base, `${root}/labels`, { kind: "tag", name: "vip" })).status, 200);
  for (const change of [{ id: groupId, name: "Updated" }, { id: labelId, name: "Foreign" }]) {
    service.renameLabel = async () => label(change);
    const response = await post(base, `${root}/labels/${labelId}/rename`, { name: "Updated", expectedVersion: "1" });
    assert.equal(response.status, 503); assert.deepEqual(await response.json(), { error: "crm_unavailable" });
  }
});

test("CRM conflicts and operation failures expose only bounded public codes", async (t) => {
  const { base, service } = await fixture(t);
  for (const [code, status, error] of [["CRM_UNAUTHORIZED", 401, "authentication_required"], ["CHAT_UNAUTHORIZED", 401, "authentication_required"],
    ["AUTH_INVALID", 401, "authentication_required"], ["CHAT_FORBIDDEN", 403, "request_rejected"], ["CRM_FORBIDDEN", 403, "request_rejected"],
    ["CHAT_NOT_FOUND", 404, "not_found"], ["CRM_NOT_FOUND", 404, "not_found"], ["CRM_CONFLICT", 409, "record_changed"],
    ["CRM_NAME_CONFLICT", 409, "name_in_use"], ["CRM_LIMIT", 409, "limit_reached"], ["CRM_INPUT", 400, "invalid_request"],
    ["CRM_RATE_LIMIT", 429, "try_again_later"], ["AUTH_RATE_LIMIT", 429, "try_again_later"], ["SQL_PRIVATE_FAILURE", 503, "crm_unavailable"]]) {
    service.profile = async () => { throw Object.assign(new Error("private notes client@example.invalid ciphertext credentials"), { code, retryAfter: 17.2 }); };
    const response = await get(base, profilePath); assert.equal(response.status, status, code); privateHeaders(response);
    assert.deepEqual(await response.json(), { error });
    assert.equal(response.headers.get("set-cookie")?.startsWith("__Host-jessie_session=;") ?? false, status === 401);
    if (status === 429) assert.equal(response.headers.get("retry-after"), "18");
  }
  for (const [retryAfter, expected] of [[-5, "1"], [Infinity, "60"], [99999, "3600"]]) {
    service.profile = async () => { throw Object.assign(new Error("private"), { code: "CRM_RATE_LIMIT", retryAfter }); };
    const response = await get(base, profilePath); assert.equal(response.headers.get("retry-after"), expected);
  }
  service.profile = async () => { throw { httpStatus: 200, publicCode: "private notes" }; };
  const response = await get(base, profilePath); assert.equal(response.status, 503); assert.deepEqual(await response.json(), { error: "crm_unavailable" });
});

test("CRM exact routes enforce methods, do not expose client aliases and API HEAD has no data", async (t) => {
  const { base, calls } = await fixture(t);
  for (const [endpoint, method, allow] of [[`${root}/contacts`, "POST", "GET"], [profilePath, "OPTIONS", "GET, POST"],
    [`${root}/labels/${labelId}/rename`, "GET", "POST"], [`${root}/labels`, "HEAD", "GET, POST"], ["/crm.js", "POST", "GET, HEAD"]]) {
    const response = await fetch(`${base}${endpoint}`, { method }); assert.equal(response.status, 405); assert.equal(response.headers.get("allow"), allow);
    if (method === "HEAD") assert.equal(await response.text(), "");
  }
  assert.equal(calls.length, 0);
  for (const endpoint of ["/api/client/crm/contacts", "/api/crm/client/contacts", `${root}/conversations/${"A".repeat(32)}`,
    `${profilePath}%0A`, `${root}/labels/${"D".repeat(32)}/delete`, `${root}/contacts/`, "/server/crm/http.mjs", "/crm.html"]) {
    const response = await get(base, endpoint); assert.equal(response.status, 404); assert.equal(await response.text(), "fallback");
  }
});

test("readJson extended programmer ceiling remains bounded and default body budget stays 4096", async () => {
  for (const maxBytes of [0, -1, 65537, Infinity, NaN, "65536", 1.5]) assert.throws(() => readJson({ headers: {} }, { maxBytes }), TypeError);
  const request = new PassThrough(); request.headers = {};
  const body = readJson(request, { maxBytes: 65536 }); request.end(JSON.stringify({ notes: "界".repeat(8000) }));
  assert.equal((await body).notes.length, 8000);
  const defaultRequest = new PassThrough(); defaultRequest.headers = {};
  const rejected = readJson(defaultRequest); defaultRequest.end(JSON.stringify({ notes: "x".repeat(4097) }));
  await assert.rejects(rejected, { httpStatus: 413, publicCode: "request_too_large" });
});
