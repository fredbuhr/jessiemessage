import test from "node:test";
import assert from "node:assert/strict";
import { createServer, request as httpRequest } from "node:http";
import { PassThrough, Writable } from "node:stream";
import { AUTH_HEADERS } from "../server/auth/http.mjs";
import { createChatHandler } from "../server/chat/http.mjs";
import { createCrmHandler } from "../server/crm/http.mjs";
import { createArchiveTransfer } from "../server/chat/archive-transfer.mjs";

const origins = { primary: "https://jessiemessage.example", legacy: "https://recette.jessiemessage.example" };
const cid = "1".repeat(32), clientId = "2".repeat(32), adminId = "3".repeat(32), foreign = "4".repeat(32);
const tokens = { admin: Buffer.alloc(32, 7).toString("base64url"), client: Buffer.alloc(32, 9).toString("base64url") }, csrf = Buffer.alloc(32, 11).toString("base64url");
const MAX_BYTES = 256 * 1024 * 1024;
const cookie = role => `${role === "admin" ? "__Host-jessie_session" : "__Host-jessie_client"}=${tokens[role]}`;
const exportPath = role => role === "client" ? `/api/chat/client/conversations/${cid}/export` : `/api/admin/crm/conversations/${cid}/export`;
const capsPath = role => role === "client" ? "/api/chat/client/capabilities" : "/api/admin/crm/capabilities";
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function zipBytes() { const value = Buffer.alloc(48, 17); value.writeUInt32LE(0x04034b50); return value; }
function actor(role) {
  return { user: { id: role === "client" ? clientId : adminId, role, pseudonym: "Synthetic participant" }, csrf, expiresAt: Date.now() + 3600000,
    ...(role === "client" ? { access: { state: "active", admissionPolicy: "manual_invitation", invitationConsumed: true, emailVerified: true, approved: true } } : {}) };
}
function conversation() { return { id: cid, client: null, peerName: "Jess", createdAt: 1, closedAt: null, lastActivityAt: 1, latestSequence: "0", latestEventSequence: "0", lastReadSequence: "0", peerReadSequence: "0", unreadCount: 0, canSend: true }; }
function profile() { return { conversationId: cid, client: { id: clientId, pseudonym: "Synthetic client", email: "synthetic@example.invalid", status: "active" },
  access: { state: "active", expiresAt: null }, nickname: "", notes: "private notes never exported by transport", reminderAt: null, labels: [], version: "1", updatedAt: 1 }; }
function streaming({ photos = true, maxBytes = MAX_BYTES, make } = {}) {
  const calls = [], records = [];
  const exporter = { photos, videos: true, streaming: true, maxBytes, async create(input) {
    calls.push(input); const closed = deferred(), closeEntered = deferred(), aborted = deferred();
    const record = { index: records.length, expected: zipBytes(), buffers: [], streams: 0, closes: 0, signal: null, closed: closed.promise,
      closeEntered: closeEntered.promise, aborted: aborted.promise, closeGate: null, chunk(bytes) { this.buffers.push(bytes); return bytes; } };
    records.push(record);
    record.source = async function* () { yield record.chunk(Buffer.from(record.expected.subarray(0, 19))); yield record.chunk(Buffer.from(record.expected.subarray(19))); };
    const descriptor = { bytes: record.expected.length, stream({ signal }) {
      record.streams++; record.signal = signal; signal.addEventListener("abort", aborted.resolve, { once: true });
      if (signal.aborted) aborted.resolve(); return record.source({ signal });
    }, async close() { record.closes++; closeEntered.resolve(); if (record.closeGate) await record.closeGate; closed.resolve(); } };
    return make ? make(record, descriptor, input) : descriptor;
  } };
  return { exporter, records, calls };
}
async function fixture(t, { role = "client", origin = origins.primary, shared = streaming() } = {}) {
  const state = { actor: () => actor(role), conversation, profile, actorCalls: 0, lookups: 0 };
  let handler;
  if (role === "client") {
    const service = Object.fromEntries(["listConversations", "messages", "events", "send", "markRead", "delete"].map(name => [name, async () => { throw Error(`Unexpected ${name}`); }]));
    service.actor = async (actualRole, token) => { state.actorCalls++; return actualRole === role && token === tokens[role] ? state.actor() : null; };
    service.clientConversation = async () => { state.lookups++; return state.conversation(); };
    handler = createChatHandler(service, { origin, clientConversationExporter: shared.exporter });
  } else {
    const service = Object.fromEntries(["listLabels", "createLabel", "renameLabel", "deleteLabel", "saveProfile", "contacts"].map(name => [name, async () => { throw Error(`Unexpected ${name}`); }]));
    service.actor = async token => { state.actorCalls++; return token === tokens[role] ? state.actor() : null; };
    service.profile = async () => { state.lookups++; return state.profile(); };
    handler = createCrmHandler(service, { origin, conversationExporter: shared.exporter });
  }
  const server = createServer(async (request, response) => {
    try { if (!await handler(request, response)) { response.writeHead(404); response.end(); } }
    catch { if (response.headersSent || response.destroyed) response.destroy(); else { response.writeHead(500); response.end(); } }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { handler.close?.(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = extra => ({ Origin: origin, "Content-Type": "application/json", "X-CSRF-Token": csrf, Cookie: cookie(role), ...extra });
  return { role, origin, state, handler, shared, base, port: server.address().port, headers,
    post: (body = { includePhotos: false, includeVideos: true }, extra = {}, path = exportPath(role)) => fetch(base + path, { method: "POST", headers: headers(extra), body: typeof body === "string" ? body : JSON.stringify(body) }) };
}
function privateHeaders(response) { for (const [name, value] of Object.entries(AUTH_HEADERS)) assert.equal(response.headers.get(name), value); assert.equal(response.headers.get("access-control-allow-origin"), null); }
function privateError(value) { assert.doesNotMatch(JSON.stringify(value), /private|storageKey|password|notes|SQL|token|secret|example\.invalid/); }
function rawPost(f) {
  const first = deferred(), done = deferred(), chunks = []; let response;
  const body = JSON.stringify({ includePhotos: false, includeVideos: true });
  const request = httpRequest({ host: "127.0.0.1", port: f.port, path: exportPath(f.role), method: "POST", headers: { ...f.headers(), "Content-Length": Buffer.byteLength(body) } }, incoming => {
    response = incoming; incoming.on("error", () => {});
    incoming.on("data", chunk => { chunks.push(Buffer.from(chunk)); first.resolve(incoming); });
    incoming.once("close", () => done.resolve({ status: incoming.statusCode, complete: incoming.complete, bytes: Buffer.concat(chunks) }));
  });
  request.on("error", () => done.resolve({ status: response?.statusCode ?? null, complete: false, bytes: Buffer.concat(chunks) })); request.end(body);
  return { first: first.promise, done: done.promise, abort() { response?.destroy(); request.destroy(); } };
}
function writableFixture(write) {
  const request = new PassThrough(); request.method = "POST";
  const response = new Writable({ autoDestroy: false, write }); response.on("error", () => {});
  response.writeHead = (status, headers) => { response.headersSent = true; response.statusCode = status; response.headers = headers; };
  return { request, response };
}

test("archive transfer bounds streaming and historical exporters and all configured deadlines", () => {
  const current = streaming().exporter, legacy = { photos: false, maxBytes: 32 * 1024 * 1024, create: async () => zipBytes() };
  assert.doesNotThrow(() => createArchiveTransfer(current)); assert.doesNotThrow(() => createArchiveTransfer(legacy));
  for (const exporter of [{ ...current, maxBytes: MAX_BYTES + 1 }, { ...current, maxBytes: 21 }, { ...current, photos: "yes" },
    { ...current, create: null }, { ...legacy, maxBytes: 32 * 1024 * 1024 + 1 }]) assert.throws(() => createArchiveTransfer(exporter), TypeError);
  for (const transferTimeoutMs of [0, -1, 0.5, "1", 300001]) assert.throws(() => createArchiveTransfer(current, { transferTimeoutMs }), TypeError);
});

test("both authenticated roles and both origins stream exact bytes with explicit private video capabilities", async t => {
  for (const role of ["client", "admin"]) for (const origin of Object.values(origins)) {
    const f = await fixture(t, { role, origin }), caps = await fetch(f.base + capsPath(role), { headers: { Cookie: cookie(role) } });
    assert.equal(caps.status, 200); privateHeaders(caps);
    assert.deepEqual((await caps.json()).conversationExport, { enabled: true, photos: true, videos: true, maxBytes: MAX_BYTES });
    const response = await f.post(); assert.equal(response.status, 200); privateHeaders(response);
    assert.equal(response.headers.get("content-type"), "application/zip"); assert.equal(response.headers.get("content-length"), "48");
    assert.equal(response.headers.get("content-disposition"), `attachment; filename="JessieMessage-conversation-${cid}.zip"`); assert.equal(response.headers.get("set-cookie"), null);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), f.shared.records[0].expected); await f.shared.records[0].closed;
    assert.equal(f.shared.records[0].streams, 1); assert.ok(f.shared.records[0].buffers.every(chunk => chunk.every(byte => byte === 0)));
    assert.equal(f.shared.calls[0].token, tokens[role]); assert.equal(f.shared.calls[0].conversationId, cid); assert.equal(f.shared.calls[0].expectedClientId, clientId);
    assert.equal(f.shared.calls[0].includePhotos, false); assert.equal(f.shared.calls[0].includeVideos, true); assert.ok(f.shared.calls[0].signal instanceof AbortSignal);
    assert.ok(f.state.actorCalls >= 2); assert.equal(f.state.lookups, 2);
  }
});

test("historical Buffer exporters retain their old capability and exact one-field request", async t => {
  for (const role of ["client", "admin"]) {
    const buffers = [], calls = [], exporter = { photos: false, maxBytes: 1000, async create(input) { calls.push(input); const bytes = zipBytes(); buffers.push(bytes); return bytes; } };
    const f = await fixture(t, { role, shared: { exporter } }), caps = await fetch(f.base + capsPath(role), { headers: { Cookie: cookie(role) } });
    assert.deepEqual((await caps.json()).conversationExport, { enabled: true, photos: false, maxBytes: 1000 });
    const response = await f.post({ includePhotos: false }); assert.equal(response.status, 200); assert.deepEqual(Buffer.from(await response.arrayBuffer()), zipBytes());
    assert.ok(buffers[0].every(byte => byte === 0)); assert.equal(Object.hasOwn(calls[0], "includeVideos"), false);
    const extra = await f.post({ includePhotos: false, includeVideos: false }); assert.equal(extra.status, 400); await extra.arrayBuffer(); assert.equal(calls.length, 1);
  }
});

test("streaming export refuses wrong cookies, unsafe origins, CSRF and noncanonical bodies before preparation", async t => {
  for (const role of ["client", "admin"]) {
    const f = await fixture(t, { role, origin: origins.legacy });
    const body = { includePhotos: false, includeVideos: true };
    for (const [extra, status] of [[{ Cookie: "" }, 401], [{ Cookie: cookie(role === "client" ? "admin" : "client") }, 401],
      [{ Origin: origins.primary }, 403], [{ Origin: "https://foreign.example" }, 403], [{ "Sec-Fetch-Site": "same-site" }, 403],
      [{ "X-CSRF-Token": "wrong" }, 403], [{ "Content-Type": "text/plain" }, 415]]) {
      const response = await f.post(body, extra); assert.equal(response.status, status); privateHeaders(response); privateError(await response.json());
      assert.equal(response.headers.get("set-cookie"), null);
    }
    for (const value of [{ includePhotos: false }, { includeVideos: true }, { ...body, ownerId: foreign }, { ...body, includeVideos: "true" }, { ...body, includePhotos: 0 }, null, [], "{"]) {
      const response = await f.post(value); assert.equal(response.status, 400); privateError(await response.json());
    }
    const query = await f.post(body, {}, exportPath(role) + "?client=" + foreign); assert.equal(query.status, 400); await query.arrayBuffer();
    const method = await fetch(f.base + exportPath(role)); assert.equal(method.status, 405); assert.equal(method.headers.get("allow"), "POST"); await method.arrayBuffer();
    assert.equal(f.shared.calls.length, 0);
  }
  const client = await fixture(t); client.state.actor = () => ({ ...actor("client"), access: { ...actor("client").access, state: "revoked" } });
  assert.equal((await client.post()).status, 403); assert.equal(client.shared.calls.length, 0);
  const noPhotos = await fixture(t, { shared: streaming({ photos: false }) });
  assert.equal((await noPhotos.post({ includePhotos: true, includeVideos: true })).status, 400); assert.equal(noPhotos.shared.calls.length, 0);
});

test("revocation, identity, CSRF and ownership changes close prepared streaming descriptors before headers", async t => {
  for (const role of ["client", "admin"]) for (const change of ["revoked", "identity", "csrf", "binding"]) {
    const f = await fixture(t, { role });
    f.state.actor = () => {
      const current = actor(role); if (!f.shared.calls.length) return current;
      if (change === "revoked") return null;
      if (change === "identity") current.user.id = foreign;
      if (change === "csrf") current.csrf = Buffer.alloc(32, 23).toString("base64url"); return current;
    };
    if (change === "binding" && role === "client") f.state.conversation = () => ({ ...conversation(), ...(f.shared.calls.length ? { id: foreign } : {}) });
    if (change === "binding" && role === "admin") f.state.profile = () => ({ ...profile(), client: { ...profile().client, ...(f.shared.calls.length ? { id: foreign } : {}) } });
    const response = await f.post(); assert.equal(response.status, change === "binding" ? 409 : 401); privateError(await response.json());
    assert.equal(response.headers.get("content-disposition"), null); assert.notEqual(response.headers.get("content-type"), "application/zip");
    assert.equal(response.headers.get("set-cookie"), null); assert.equal(f.shared.records[0].streams, 0); await f.shared.records[0].closed;
  }
});

test("malformed streaming descriptors are closed and rejected before any archive header or stream", async t => {
  for (const change of [{ bytes: 21 }, { bytes: MAX_BYTES + 1 }, { bytes: "48" }, { stream: null }]) {
    const shared = streaming({ make: (_record, descriptor) => ({ ...descriptor, ...change }) }), f = await fixture(t, { shared });
    const response = await f.post(); assert.equal(response.status, 503); privateError(await response.json());
    assert.equal(response.headers.get("content-disposition"), null); assert.equal(shared.records[0].streams, 0); await shared.records[0].closed;
  }
});

test("source errors and invalid byte counts destroy a started HTTP archive without a JSON tail", { timeout: 10000 }, async t => {
  for (const kind of ["throw", "short", "long", "large-chunk", "non-buffer"]) {
    const gate = deferred(), shared = streaming({ make(record, descriptor) {
      record.source = async function* () {
        yield record.chunk(Buffer.from(record.expected.subarray(0, 19))); await gate.promise;
        if (kind === "throw") throw Error("private-secret-SQL-file-path");
        if (kind === "short") return;
        if (kind === "long") yield record.chunk(Buffer.alloc(30, 23));
        if (kind === "large-chunk") yield record.chunk(Buffer.alloc(262145, 23));
        if (kind === "non-buffer") yield "private-secret-SQL-file-path";
      }; return descriptor;
    } });
    const f = await fixture(t, { shared }), request = rawPost(f); t.after(() => { gate.resolve(); request.abort(); });
    await request.first; gate.resolve(); const result = await request.done;
    assert.equal(result.status, 200); assert.equal(result.complete, false, kind); assert.equal(result.bytes.length, 19, kind);
    assert.doesNotMatch(result.bytes.toString("utf8"), /conversation_export|private|secret|SQL/); await shared.records[0].closed;
    assert.ok(shared.records[0].buffers[0].every(byte => byte === 0));
  }
});

test("aborted HTTP work holds the shared primary and legacy slot through source exit and descriptor close", { timeout: 10000 }, async t => {
  const work = deferred(), cleanup = deferred(), shared = streaming({ make(record, descriptor) {
    if (record.index !== 0) return descriptor;
    record.closeGate = cleanup.promise; record.source = async function* ({ signal }) {
      yield record.chunk(Buffer.from(record.expected.subarray(0, 19))); await work.promise; if (signal.aborted) throw Error("private-source-cancelled");
    }; return descriptor;
  } });
  const primary = await fixture(t, { shared }), legacy = await fixture(t, { shared, origin: origins.legacy }), request = rawPost(primary);
  t.after(() => { work.resolve(); cleanup.resolve(); request.abort(); });
  await request.first; request.abort(); await shared.records[0].aborted;
  const pending = await legacy.post(); assert.equal(pending.status, 429); assert.equal(pending.headers.get("retry-after"), "30"); await pending.arrayBuffer();
  assert.equal(shared.calls.length, 1); work.resolve(); await shared.records[0].closeEntered;
  const closing = await legacy.post(); assert.equal(closing.status, 429); await closing.arrayBuffer(); assert.equal(shared.calls.length, 1);
  cleanup.resolve(); await shared.records[0].closed; const next = await legacy.post(); assert.equal(next.status, 200); await next.arrayBuffer();
  assert.equal(shared.calls.length, 2); assert.equal(shared.records[0].signal.aborted, true);
});

test("a retained Writable callback keeps plaintext and the cross-handler slot until the write actually settles", { timeout: 5000 }, async t => {
  const shared = streaming(), primary = createArchiveTransfer(shared.exporter), legacy = createArchiveTransfer(shared.exporter), entered = deferred();
  let callback, chunk; const f = writableFixture((value, _encoding, done) => { chunk = value; callback = done; entered.resolve(); });
  const outcome = primary.send(f.request, f.response, { conversationId: cid }, async () => {}).then(() => null, error => error);
  t.after(() => { primary.close(); callback?.(); }); await entered.promise;
  assert.ok(chunk.some(byte => byte !== 0)); primary.close(); assert.equal(f.response.destroyed, true);
  assert.ok(chunk.some(byte => byte !== 0), "pending native write still owns its original bytes");
  await assert.rejects(legacy.send(f.request, f.response, { conversationId: cid }, async () => {}), error => error.code === "busy");
  assert.equal(shared.records[0].closes, 0); callback(); await outcome; await shared.records[0].closed;
  assert.ok(chunk.every(byte => byte === 0)); assert.equal(shared.calls.length, 1);
});

test("the configured streaming deadline aborts pending source work and closes its descriptor", { timeout: 5000 }, async () => {
  const shared = streaming({ make(record, descriptor) {
    record.source = async function* ({ signal }) {
      yield record.chunk(Buffer.from(record.expected.subarray(0, 19)));
      await new Promise(resolve => { if (signal.aborted) resolve(); else signal.addEventListener("abort", resolve, { once: true }); });
      throw Error("private-source-cancelled");
    }; return descriptor;
  } });
  const transfer = createArchiveTransfer(shared.exporter, { transferTimeoutMs: 20 }), f = writableFixture((_chunk, _encoding, done) => done());
  await assert.rejects(transfer.send(f.request, f.response, { conversationId: cid }, async () => {}));
  assert.equal(shared.records[0].signal.aborted, true); assert.equal(f.response.destroyed, true); await shared.records[0].closed;
});

test("a source Buffer returned after cancellation is wiped when the pending read settles", { timeout: 5000 }, async t => {
  const entered = deferred(), gate = deferred(), shared = streaming({ make(record, descriptor) {
    record.source = async function* () {
      yield record.chunk(Buffer.from(record.expected.subarray(0, 19))); entered.resolve(); await gate.promise;
      yield record.chunk(Buffer.from(record.expected.subarray(19)));
    }; return descriptor;
  } });
  const transfer = createArchiveTransfer(shared.exporter), f = writableFixture((_chunk, _encoding, done) => done());
  const outcome = transfer.send(f.request, f.response, { conversationId: cid }, async () => {}).then(() => null, error => error);
  t.after(() => { transfer.close(); gate.resolve(); }); await entered.promise; transfer.close(); gate.resolve(); await outcome;
  assert.equal(shared.records[0].buffers.length, 2); assert.ok(shared.records[0].buffers.every(chunk => chunk.every(byte => byte === 0)));
  await shared.records[0].closed;
});
