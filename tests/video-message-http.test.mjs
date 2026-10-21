import test from "node:test";
import assert from "node:assert/strict";
import { createServer, request as httpRequest } from "node:http";
import { AUTH_HEADERS } from "../server/auth/http.mjs";
import { createVideoHandler } from "../server/video/http.mjs";

const origin = "https://jessiemessage.example", now = Date.UTC(2026, 9, 21, 12);
const cid = "1".repeat(32), mid = "2".repeat(32), aid = "3".repeat(32), requestId = "6".repeat(32);
const tokens = { admin: Buffer.alloc(32, 7).toString("base64url"), client: Buffer.alloc(32, 9).toString("base64url") };
const csrf = Buffer.alloc(32, 11).toString("base64url"), video = Buffer.from("synthetic delivery video bytes");
const basePath = (role = "admin") => `/api/video/${role}/conversations/${cid}`;
const sendPath = (role = "admin") => `${basePath(role)}/messages`;
const contentPath = (role = "admin") => `${sendPath(role)}/${mid}/content`;
const ownerPath = (role = "admin") => `/api/video/${role}/assets/${aid}/content`;
const cookie = (role = "admin") => `${role === "admin" ? "__Host-jessie_session" : "__Host-jessie_client"}=${tokens[role]}`;
const headers = (role = "admin", extra = {}) => ({ Cookie: cookie(role), Origin: origin, "X-CSRF-Token": csrf, "Content-Type": "application/json", ...extra });
const body = (caption = "Légende privée <b>littérale</b>") => ({ clientMessageId: requestId, videoId: aid, caption });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const failure = (code) => Object.assign(new Error("private SQL, token and file path must stay private"), { code });
function delivery(role, extra = {}) {
  return { id: aid, bytes: video.length, mime: "video/mp4", contentUrl: contentPath(role), storageKey: "private-storage-key", digest: "private-digest", ...extra };
}
function message(role, caption = "", extra = {}) {
  return { id: mid, sequence: "1", sender: "me", body: caption, createdAt: now, deletedAt: null, clientMessageId: requestId,
    video: delivery(role), senderId: "private-sender", encryptedBody: "private-ciphertext", ...extra };
}
async function fixture(t, overrides = {}, options = {}) {
  const calls = [], handles = [];
  const open = async (kind, role, token, ...args) => {
    const { signal } = args.at(-1); calls.push([kind, role, ...args.slice(0, -1)]);
    const closed = deferred(), record = { kind, closed: closed.promise, streamed: false, closes: 0 }; handles.push(record);
    return { bytes: video.length, mime: "video/mp4", async *stream(range) {
      record.streamed = true; record.range = range; assert.equal(signal.aborted, false); yield video.subarray(range.start, range.end + 1);
    }, async close() { if (record.closes++ === 0) closed.resolve(); } };
  };
  const service = {
    async actor(role, token) {
      calls.push(["actor", role]);
      if (token !== tokens[role]) return null;
      return { user: { id: (role === "admin" ? "4" : "5").repeat(32), role, pseudonym: "Synthetic role" }, csrf, expiresAt: now + 3600000,
        access: { state: "active", admissionPolicy: "manual_invitation", emailVerified: true, invitationConsumed: true, approved: true } };
    },
    async admitUpload() { throw Error("unexpected binary admission"); }, async releaseUpload() {}, async upload() { throw Error("unexpected binary upload"); },
    open: (role, token, id, opts) => open("owner", role, token, id, opts),
    openMessage: (role, token, conversationId, messageId, opts) => open("delivery", role, token, conversationId, messageId, opts),
    async send(role, token, conversationId, payload) { calls.push(["send", role, conversationId, payload]); return { message: message(role, payload.caption), duplicate: false }; },
    async gallery(role, token, conversationId, query) {
      calls.push(["gallery", role, conversationId, query]);
      return { items: [{ messageId: mid, sequence: "9007199254740993", sender: "peer", createdAt: now, video: delivery(role), internal: "private-internal" }], nextBefore: null, hasMore: false };
    },
    ...overrides,
  };
  const handler = createVideoHandler(service, { origin, ...options });
  const server = createServer(async (req, res) => { if (!await handler(req, res)) { res.writeHead(404); res.end("fallback"); } });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return { base: `http://127.0.0.1:${server.address().port}`, port: server.address().port, calls, handles, service, handler };
}
const post = (f, url = sendPath(), payload = body(), requestHeaders = headers()) => fetch(f.base + url, { method: "POST", headers: requestHeaders, body: typeof payload === "string" ? payload : JSON.stringify(payload) });
function privateResponse(response) {
  for (const [key, value] of Object.entries(AUTH_HEADERS)) assert.equal(response.headers.get(key), value);
  assert.equal(response.headers.get("access-control-allow-origin"), null);
}
function noPrivateFields(value) { assert.doesNotMatch(JSON.stringify(value), /private-|storageKey|senderId|digest|encryptedBody/); }

test("video message routes require the complete optional family and remain absent for the foundation alone", async (t) => {
  const f = await fixture(t);
  for (const missing of ["send", "openMessage", "gallery"]) assert.throws(() => createVideoHandler({ ...f.service, [missing]: undefined }, { origin }));
  const disabled = await fixture(t, { send: undefined, openMessage: undefined, gallery: undefined });
  for (const path of [sendPath(), contentPath(), `${basePath()}/gallery`]) assert.equal((await fetch(disabled.base + path, { headers: { Cookie: cookie() } })).status, 404);
  assert.equal((await fetch(disabled.base + ownerPath(), { headers: { Cookie: cookie() } })).status, 200);
});

test("both roles send literal or empty captions and responses expose only message-bound video metadata", async (t) => {
  const f = await fixture(t);
  for (const role of ["admin", "client"]) for (const caption of ["", "Bonjour 👋 <b>texte</b>"]) {
    const response = await post(f, sendPath(role), body(caption), headers(role)); assert.equal(response.status, 201); privateResponse(response);
    const result = await response.json(); noPrivateFields(result); assert.equal(result.message.body, caption);
    assert.deepEqual(result.message.video, { id: aid, bytes: video.length, mime: "video/mp4", contentUrl: contentPath(role) });
    assert.equal(f.calls.at(-1)[0], "send"); assert.deepEqual(f.calls.at(-1)[3], body(caption));
  }
  f.service.send = async (role) => ({ message: message(role), duplicate: true });
  const duplicate = await post(f); assert.equal(duplicate.status, 200); assert.equal((await duplicate.json()).duplicate, true);
});

test("video message mutations reject untrusted origins, missing credentials and invalid JSON before publication", async (t) => {
  const f = await fixture(t);
  for (const [extra, status] of [[{ Origin: "https://other.example" }, 403], [{ "Sec-Fetch-Site": "same-site" }, 403], [{ "X-CSRF-Token": "wrong" }, 403], [{ Cookie: "" }, 401], [{ Cookie: cookie("client") }, 401], [{ "Content-Type": "text/plain" }, 415]]) {
    const response = await post(f, sendPath(), body(), headers("admin", extra)); assert.equal(response.status, status); privateResponse(response); await response.arrayBuffer();
  }
  const malformed = ["{", "[]", "null", {}, { ...body(), ownerId: "4".repeat(32) }, { ...body(), videoId: "wrong" }, { ...body(), caption: "x".repeat(1001) }, { ...body(), caption: "\u0000" }, { ...body(), caption: "\ud800" }];
  for (const payload of malformed) {
    const response = await post(f, sendPath(), payload); assert.equal(response.status, 400); await response.arrayBuffer();
  }
  assert.equal(f.calls.filter(([kind]) => kind === "send").length, 0);
});

test("video gallery validates canonical pagination and strips private fields", async (t) => {
  const f = await fixture(t);
  const response = await fetch(`${f.base}${basePath("client")}/gallery?before=9007199254740995&limit=1`, { headers: { Cookie: cookie("client") } });
  assert.equal(response.status, 200); privateResponse(response); const value = await response.json(); noPrivateFields(value);
  assert.equal(value.items[0].sequence, "9007199254740993"); assert.equal(value.items[0].video.contentUrl, contentPath("client"));
  assert.deepEqual(f.calls.at(-1), ["gallery", "client", cid, { before: "9007199254740995", limit: 1 }]);
  const plain = await fetch(`${f.base}${basePath()}/gallery`, { headers: { Cookie: cookie() } }); assert.equal(plain.status, 200); await plain.arrayBuffer();
  assert.deepEqual(f.calls.at(-1), ["gallery", "admin", cid, { before: null, limit: 50 }]);
  const count = f.calls.filter(([name]) => name === "gallery").length;
  for (const query of ["?limit=0", "?limit=101", "?limit=01", "?limit=1&limit=2", "?before=-1", "?before=01", "?before=18446744073709551616", "?ownerId=x"]) {
    const bad = await fetch(`${f.base}${basePath()}/gallery${query}`, { headers: { Cookie: cookie() } }); assert.equal(bad.status, 400, query); await bad.arrayBuffer();
  }
  assert.equal(f.calls.filter(([name]) => name === "gallery").length, count);
});

test("message delivery preserves Range, HEAD and If-Range without routing the recipient through owner access", async (t) => {
  const f = await fixture(t);
  const partial = await fetch(f.base + contentPath("client"), { headers: { Cookie: cookie("client"), Range: "bytes=3-8" } });
  assert.equal(partial.status, 206); privateResponse(partial); assert.equal(partial.headers.get("content-range"), `bytes 3-8/${video.length}`);
  assert.deepEqual(Buffer.from(await partial.arrayBuffer()), video.subarray(3, 9));
  const head = await fetch(f.base + contentPath("client"), { method: "HEAD", headers: { Cookie: cookie("client"), Range: "bytes=invalid" } });
  assert.equal(head.status, 200); assert.equal(await head.text(), ""); assert.equal(head.headers.get("content-length"), String(video.length));
  const whole = await fetch(f.base + contentPath("client"), { headers: { Cookie: cookie("client"), Range: "bytes=1-3", "If-Range": '"missing"' } });
  assert.equal(whole.status, 200); assert.deepEqual(Buffer.from(await whole.arrayBuffer()), video);
  await Promise.all(f.handles.map(handle => handle.closed));
  assert.equal(f.handles[1].streamed, false); assert.ok(f.handles.every(handle => handle.closes === 1));
  assert.equal(f.calls.some(([kind]) => kind === "owner"), false);
  const owner = await fetch(f.base + ownerPath(), { headers: { Cookie: cookie() } }); assert.equal(owner.status, 200); await owner.arrayBuffer();
  assert.equal(f.calls.at(-1)[0], "owner");
});

test("recipient denial precedes Range parsing and wrong-role cookies never reach delivery", async (t) => {
  const f = await fixture(t, { async openMessage() { throw failure("VIDEO_NOT_FOUND"); } });
  const denied = await fetch(f.base + contentPath("client"), { headers: { Cookie: cookie("client"), Range: "bytes=invalid" } });
  assert.equal(denied.status, 404); assert.equal(denied.headers.get("content-range"), null); assert.deepEqual(await denied.json(), { error: "not_found" });
  const previous = f.calls.length;
  const wrongRole = await fetch(f.base + contentPath("client"), { headers: { Cookie: cookie("admin") } });
  assert.equal(wrongRole.status, 401); assert.equal(f.calls.length, previous); await wrongRole.arrayBuffer();
  const query = await fetch(f.base + contentPath("client") + "?videoId=" + aid, { headers: { Cookie: cookie("client") } });
  assert.equal(query.status, 400); await query.arrayBuffer();
});

test("conflicts and malformed video responses fail privately rather than leaking adapter details", async (t) => {
  const f = await fixture(t, { async send() { throw failure("CHAT_CONFLICT"); } });
  const conflict = await post(f); assert.equal(conflict.status, 409); noPrivateFields(await conflict.json());
  f.service.send = async role => ({ message: message(role, "", { video: delivery(role, { contentUrl: ownerPath(role) }) }), duplicate: false });
  const forged = await post(f); assert.equal(forged.status, 503); noPrivateFields(await forged.json());
  f.service.send = async role => ({ message: message(role), duplicate: "yes" });
  const broken = await post(f); assert.equal(broken.status, 503); noPrivateFields(await broken.json());
  f.service.gallery = async role => ({ items: [{ messageId: mid, sequence: "1", sender: "peer", createdAt: now, video: delivery(role) }], nextBefore: null, hasMore: true });
  const gallery = await fetch(`${f.base}${basePath()}/gallery`, { headers: { Cookie: cookie() } }); assert.equal(gallery.status, 503); noPrivateFields(await gallery.json());
});

test("message routes enforce client admission and preserve private service error statuses", async (t) => {
  const f = await fixture(t), actor = f.service.actor;
  f.service.actor = async (...args) => ({ ...await actor(...args), access: { state: "revoked" } });
  for (const [path, method] of [[sendPath("client"), "POST"], [`${basePath("client")}/gallery`, "GET"], [contentPath("client"), "GET"]]) {
    const response = await fetch(f.base + path, { method, headers: headers("client"), ...(method === "POST" ? { body: JSON.stringify(body()) } : {}) });
    assert.equal(response.status, 403); privateResponse(response); noPrivateFields(await response.json());
  }
  assert.equal(f.calls.some(([kind]) => ["send", "gallery", "delivery"].includes(kind)), false);
  f.service.actor = actor;
  for (const [error, status] of [["CHAT_UNAUTHORIZED", 401], ["CHAT_FORBIDDEN", 403], ["CHAT_NOT_FOUND", 404], ["CHAT_INPUT", 400], ["CHAT_RATE_LIMIT", 429], ["PRIVATE_DATABASE_FAILURE", 503]]) {
    f.service.send = async () => { throw failure(error); };
    const response = await post(f); assert.equal(response.status, status); privateResponse(response); noPrivateFields(await response.json());
    if (status === 429) assert.equal(response.headers.get("retry-after"), "5");
  }
});

test("message delivery abort closes the shared handle after the request signal is cancelled", { timeout: 5000 }, async (t) => {
  const closed = deferred(), entered = deferred(); let signal;
  const f = await fixture(t, { async openMessage(_role, _raw, _conversation, _message, options) {
    signal = options.signal;
    return { bytes: video.length, mime: "video/mp4", async *stream() {
      yield video.subarray(0, 1); entered.resolve();
      await new Promise(resolve => { if (signal.aborted) resolve(); else signal.addEventListener("abort", resolve, { once: true }); });
    }, async close() { closed.resolve(); } };
  } });
  const req = httpRequest({ host: "127.0.0.1", port: f.port, path: contentPath("client"), headers: { Cookie: cookie("client") } }, res => {
    res.once("data", () => { res.destroy(); req.destroy(); }); res.on("error", () => {});
  });
  req.on("error", () => {}); req.end(); await entered.promise; await closed.promise; assert.equal(signal.aborted, true);
});

test("owner and message delivery share HTTP read capacity until aborted work and cleanup finish", { timeout: 5000 }, async (t) => {
  const blocked = deferred(), records = [];
  const open = async (...args) => {
    const { signal } = args.at(-1), aborted = deferred(), closed = deferred();
    const record = { signal, aborted: aborted.promise, closed: closed.promise }; records.push(record);
    signal.addEventListener("abort", aborted.resolve, { once: true });
    return { bytes: video.length, mime: "video/mp4", async *stream() {
      yield video.subarray(0, 1); await blocked.promise; if (signal.aborted) throw signal.reason; yield video.subarray(1);
    }, async close() { closed.resolve(); } };
  };
  const f = await fixture(t, { open, openMessage: open });
  t.after(() => blocked.resolve());
  for (const path of [ownerPath(), contentPath(), ownerPath("client"), contentPath("client")]) {
    await new Promise((resolve, reject) => {
      const req = httpRequest({ host: "127.0.0.1", port: f.port, path, headers: { Cookie: cookie(path.includes("/client/") ? "client" : "admin") } }, res => {
        res.on("error", () => {}); res.once("data", () => { res.destroy(); req.destroy(); resolve(); });
      });
      req.on("error", reject); req.end();
    });
  }
  await Promise.all(records.map(record => record.aborted));
  for (const path of [ownerPath(), contentPath()]) {
    const response = await fetch(f.base + path, { headers: { Cookie: cookie() } });
    assert.equal(response.status, 429); assert.equal(response.headers.get("retry-after"), "5"); await response.arrayBuffer();
  }
  assert.equal(records.length, 4);
  blocked.resolve(); await Promise.all(records.map(record => record.closed));
  for (const path of [ownerPath(), contentPath()]) {
    const response = await fetch(f.base + path, { method: "HEAD", headers: { Cookie: cookie() } }); assert.equal(response.status, 200); await response.arrayBuffer();
  }
});

test("message routes preserve method allowlists and malformed routes fall through", async (t) => {
  const f = await fixture(t);
  for (const [path, method, allow] of [[sendPath(), "GET", "POST"], [`${basePath()}/gallery`, "POST", "GET"], [contentPath(), "POST", "GET, HEAD"]]) {
    const response = await fetch(f.base + path, { method }); assert.equal(response.status, 405); assert.equal(response.headers.get("allow"), allow); await response.arrayBuffer();
  }
  for (const path of [`${sendPath()}/`, contentPath().replace(cid, cid.toUpperCase() + "a"), `${basePath()}/gallery/${mid}/content`, contentPath().replace("/admin/", "/other/")]) {
    const response = await fetch(f.base + path); assert.equal(response.status, 404); await response.arrayBuffer();
  }
});
