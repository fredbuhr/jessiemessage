import test from "node:test";
import assert from "node:assert/strict";
import { createServer, request as httpRequest } from "node:http";
import { PassThrough } from "node:stream";
import { EventEmitter } from "node:events";
import { AUTH_HEADERS } from "../server/auth/http.mjs";
import { createMediaHandler, readUpload } from "../server/media/http.mjs";
import { createMediaService } from "../server/media/service.mjs";

const origin = "https://jessiemessage.example";
const tokens = { admin: Buffer.alloc(32, 7).toString("base64url"), client: Buffer.alloc(32, 11).toString("base64url") };
const csrf = Buffer.alloc(32, 9).toString("base64url");
const now = Date.now();
const ids = { admin: "a".repeat(32), client: "c".repeat(32), conversation: "1234567890abcdef1234567890abcdef", message: "b".repeat(32), asset: "e".repeat(32), key: "d".repeat(32) };
const cookie = (role) => `${role === "admin" ? "__Host-jessie_session" : "__Host-jessie_client"}=${tokens[role]}`;
const assetsPath = (role = "admin") => `/api/media/${role}/assets`;
const conversationPath = (role = "admin") => `/api/media/${role}/conversations/${ids.conversation}`;
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
const imageSignatures = { "image/jpeg": jpeg, "image/png": Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), "image/webp": Buffer.from("RIFF\u0000\u0000\u0000\u0000WEBP", "binary") };
const imageInput = { clientMessageId: ids.key, mediaId: ids.asset, caption: "" };
const mutation = (role = "admin", extra = {}) => ({ Origin: origin, "X-CSRF-Token": csrf, Cookie: cookie(role), "Content-Type": "application/json", ...extra });
const uploadHeaders = (role = "admin", extra = {}) => mutation(role, { "Content-Type": "image/jpeg", ...extra });
function asset(role, delivery = false, overrides = {}) {
  const base = delivery ? `${conversationPath(role)}/messages/${ids.message}` : `${assetsPath(role)}/${ids.asset}`;
  return { id: ids.asset, width: 100, height: 150, thumbnailWidth: 100, thumbnailHeight: 150,
    bytes: 1000, thumbnailBytes: 500, createdAt: now, sharedHere: delivery,
    fullUrl: `${base}/full`, thumbnailUrl: `${base}/thumb`, storageKey: "private-storage-key",
    digest: "private-digest", ownerId: "private-owner", originalFilename: "private-filename", ...overrides };
}
function message(role, overrides = {}) {
  return { id: ids.message, sequence: "1", sender: "me", body: "", createdAt: now, deletedAt: null,
    clientMessageId: ids.key, media: asset(role, true), encryptedBody: "private-ciphertext", ...overrides };
}
async function fixture(t, overrides = {}) {
  const calls = [], admissionRates = [];
  const service = {
    async actor(role, token) { calls.push(["actor", role, token]); return token === tokens[role] ? { user: { id: ids[role], role, pseudonym: role === "admin" ? "Jessie" : "Client test" }, csrf, expiresAt: now + 3600000, access: { state: "active", admissionPolicy: "manual_invitation", invitationConsumed: true, emailVerified: true, ageAssured: false, approved: true } } : null; },
    async upload(role, token, bytes) { calls.push(["upload", role, token, bytes]); return { asset: asset(role), duplicate: false }; },
    async listAssets(role, token, options) { calls.push(["list", role, token, options]); return { assets: [asset(role)], nextCursor: null, hasMore: false }; },
    async asset(role, token, id, variant) { calls.push(["asset", role, token, id, variant]); return { bytes: jpeg, mime: "image/jpeg", storageKey: "private-storage-key" }; },
    async messageAsset(role, token, conversationId, messageId, variant) { calls.push(["delivery", role, token, conversationId, messageId, variant]); return { bytes: jpeg, mime: "image/jpeg" }; },
    async gallery(role, token, conversationId, options) { calls.push(["gallery", role, token, conversationId, options]); return { items: [{ messageId: ids.message, sequence: "1", sender: "peer", createdAt: now, media: asset(role, true) }], nextBefore: "1", hasMore: false }; },
    async removeAsset(role, token, id) { calls.push(["remove", role, token, id]); return { storageKey: "private-storage-key" }; },
    async send(role, token, conversationId, input) { calls.push(["send", role, token, conversationId, input]); return { message: message(role, { body: input.caption, clientMessageId: input.clientMessageId }), duplicate: false }; },
    ...overrides,
  };
  // Exercise the real account/global admission and opaque-ticket lifecycle,
  // while these protocol tests keep decoding and metadata as explicit fakes.
  const unused = () => { throw new Error("No image or metadata operation belongs in admission"); };
  const admissionService = await createMediaService({
    store: Object.fromEntries(["reserveAsset", "cancelAssetReservation", "registerAsset", "releaseStorageObject", "listAssets", "getOwnedAsset", "getMessageAsset", "deleteAsset", "gallery"].map((name) => [name, unused])),
    storage: { put: unused, get: unused, remove: unused, availableSpace: unused }, key: Buffer.alloc(32, 20), clock: () => now,
    chatService: { actor: (...args) => service.actor(...args), sendImage: unused },
    authStore: { async consumeRateLimit(bucket, options) { admissionRates.push({ bucket, options }); return { allowed: true }; } },
  });
  service.admitUpload ??= (...args) => admissionService.admitUpload(...args);
  service.releaseUpload ??= (...args) => admissionService.releaseUpload(...args);
  const handler = createMediaHandler(service, { origin });
  const server = createServer(async (request, response) => { if (!await handler(request, response)) { response.writeHead(404); response.end("fallback"); } });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); });
  return { base: `http://127.0.0.1:${server.address().port}`, calls, service, handler, server, admissionRates };
}
const post = (base, path, body, headers = mutation()) => fetch(`${base}${path}`, { method: "POST", headers, body: typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body) });
function privateHeaders(response) {
  for (const [name, value] of Object.entries(AUTH_HEADERS)) assert.equal(response.headers.get(name), value, name);
  assert.equal(response.headers.get("access-control-allow-origin"), null);
}
function noPrivateFields(value) { assert.doesNotMatch(JSON.stringify(value), /private-|storageKey|digest|ownerId|originalFilename|encryptedBody/); }

test("media handler requires a complete service and a canonical HTTPS origin", () => {
  const methods = ["actor", "admitUpload", "releaseUpload", "upload", "listAssets", "asset", "messageAsset", "gallery", "removeAsset", "send"];
  const service = Object.fromEntries(methods.map((name) => [name, () => {}]));
  for (const candidate of ["http://example.invalid", `${origin}/`, `${origin}/messages`, `${origin}?x=1`, "https://user:pass@example.invalid"]) assert.throws(() => createMediaHandler(service, { origin: candidate }));
  assert.throws(() => createMediaHandler({}, { origin }));
});

test("capabilities, own library and upload DTOs authenticate both roles and hide private metadata", async (t) => {
  const { base, calls } = await fixture(t);
  for (const role of ["admin", "client"]) {
    const capabilities = await fetch(`${base}/api/media/${role}/capabilities`, { headers: { Cookie: cookie(role) } });
    assert.equal(capabilities.status, 200); privateHeaders(capabilities);
    assert.deepEqual(await capabilities.json(), { enabled: true, maxUploadBytes: 10485760, formats: ["image/jpeg", "image/png", "image/webp"] });
    const list = await fetch(`${base}${assetsPath(role)}?conversationId=${ids.conversation}&afterId=${ids.asset}&limit=1`, { headers: { Cookie: cookie(role) } });
    assert.equal(list.status, 200); const listBody = await list.json(); noPrivateFields(listBody);
    assert.deepEqual(calls.at(-1), ["list", role, tokens[role], { conversationId: ids.conversation, afterId: ids.asset, limit: 1 }]);
    const upload = await post(base, assetsPath(role), jpeg, uploadHeaders(role));
    assert.equal(upload.status, 201); privateHeaders(upload); const uploadBody = await upload.json(); noPrivateFields(uploadBody);
    assert.equal(uploadBody.asset.fullUrl, `${assetsPath(role)}/${ids.asset}/full`);
    assert.deepEqual(calls.at(-1), ["upload", role, tokens[role], jpeg]);
  }
});

test("media cookies never accept the other role, duplicate values, or noncanonical token entropy", async (t) => {
  const { base, calls } = await fixture(t);
  for (const role of ["admin", "client"]) {
    for (const [value] of [[null, false], [cookie(role === "admin" ? "client" : "admin"), false], [`${cookie(role).split("=")[0]}=`, true], [`${cookie(role)}; ${cookie(role)}`, true], [cookie(role).replace(tokens[role], "A".repeat(42) + "B"), true]]) {
      const before = calls.length;
      const response = await fetch(`${base}${assetsPath(role)}`, { headers: value ? { Cookie: value } : {} });
      assert.equal(response.status, 401); assert.deepEqual(await response.json(), { error: "authentication_required" });
      assert.equal(response.headers.get("set-cookie"), null);
      assert.equal(calls.length, before);
    }
  }
});

test("unauthenticated media POST refuses admission without changing cookies", async (t) => {
  const { base, calls, admissionRates } = await fixture(t);
  for (const role of ["admin", "client"]) {
    const response = await post(base, assetsPath(role), jpeg, uploadHeaders(role, { Cookie: "" }));
    assert.equal(response.status, 401); assert.equal(response.headers.get("set-cookie"), null);
  }
  assert.equal(calls.length, 0); assert.equal(admissionRates.length, 0);
});

test("binary uploads require Origin, safe fetch metadata, exact image MIME and fresh role CSRF", async (t) => {
  const { base, calls } = await fixture(t);
  for (const extra of [{ Origin: "https://other.example" }, { Origin: "null" }, { Origin: `${origin}/` }, { "Sec-Fetch-Site": "cross-site" }, { "Sec-Fetch-Site": "same-site" }, { "X-CSRF-Token": "incorrect" }]) {
    const response = await post(base, assetsPath(), jpeg, uploadHeaders("admin", extra));
    assert.equal(response.status, 403); assert.deepEqual(await response.json(), { error: Object.hasOwn(extra, "X-CSRF-Token") ? "csrf_failed" : "request_rejected" });
    assert.equal(response.headers.get("set-cookie"), null);
  }
  const missingOrigin = uploadHeaders(); delete missingOrigin.Origin;
  assert.equal((await post(base, assetsPath(), jpeg, missingOrigin)).status, 403);
  for (const contentType of ["image/jpeg; charset=utf-8", "IMAGE/JPEG", "application/octet-stream", "application/json", "multipart/form-data", "image/svg+xml", "image/gif"]) {
    assert.equal((await post(base, assetsPath(), jpeg, uploadHeaders("admin", { "Content-Type": contentType }))).status, 415, contentType);
  }
  assert.equal((await post(base, assetsPath(), jpeg, uploadHeaders("admin", { "Content-Encoding": "gzip" }))).status, 415);
  assert.equal(calls.some(([name]) => name === "upload"), false);
  for (const contentType of ["image/jpeg", "image/png", "image/webp"]) assert.equal((await post(base, assetsPath(), imageSignatures[contentType], uploadHeaders("admin", { "Content-Type": contentType, "Sec-Fetch-Site": "same-origin" }))).status, 201);
});

test("declared photo type must match supported binary magic before native decoding", async (t) => {
  const { base, calls } = await fixture(t);
  for (const [type, bytes] of [["image/jpeg", imageSignatures["image/png"]], ["image/png", jpeg], ["image/webp", jpeg], ["image/jpeg", Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>")], ["image/jpeg", Buffer.from([0xff, 0xd8])]]) {
    const response = await post(base, assetsPath(), bytes, uploadHeaders("admin", { "Content-Type": type }));
    assert.equal(response.status, 415); assert.deepEqual(await response.json(), { error: "media_format" });
  }
  assert.equal(calls.some(([name]) => name === "upload"), false);
  assert.equal((await post(base, assetsPath(), jpeg, uploadHeaders())).status, 201);
});

test("upload rejection authenticates before attaching any body listener", async (t) => {
  const { handler, calls } = await fixture(t);
  for (const header of [{ ...uploadHeaders(), Cookie: "" }, uploadHeaders("admin", { "X-CSRF-Token": "wrong" })]) {
    const request = new PassThrough(); request.method = "POST"; request.url = assetsPath();
    request.headers = Object.fromEntries(Object.entries(header).map(([name, value]) => [name.toLowerCase(), value]));
    let status;
    const response = { writeHead(value) { status = value; }, end() {}, headersSent: false, destroyed: false };
    assert.equal(await handler(request, response), true);
    assert.ok([401, 403].includes(status)); assert.equal(request.listenerCount("data"), 0);
    request.destroy();
  }
  assert.equal(calls.some(([name]) => name === "upload"), false);
});

test("raw upload reader preserves arbitrary binary and rejects malformed length, empty and truncated bodies", async () => {
  for (const length of ["01", "1\n", "-1", "1.0", "1e2", "", "9007199254740992", 4]) {
    const request = new PassThrough(); request.headers = { "content-length": length };
    assert.throws(() => readUpload(request), (error) => error.httpStatus === 400, String(length)); request.destroy();
  }
  const oversized = new PassThrough(); oversized.headers = { "content-length": "10485761" };
  assert.throws(() => readUpload(oversized), (error) => error.httpStatus === 413); oversized.destroy();
  for (const [length, content] of [["0", Buffer.alloc(0)], ["5", jpeg]]) {
    const request = new PassThrough(); request.headers = { "content-length": length };
    const result = readUpload(request); request.end(content); await assert.rejects(result, (error) => error.httpStatus === 400);
  }
  const request = new PassThrough(); request.headers = {};
  const result = readUpload(request); const bytes = Buffer.from([0, 0xff, 0xc3, 0x28, 0x80]); request.end(bytes);
  assert.deepEqual(await result, bytes);
});

test("declared and chunked uploads are bounded to 10 MiB without calling the normalizer", async (t) => {
  const { base, calls } = await fixture(t);
  const declared = await post(base, assetsPath(), Buffer.alloc(10485761), uploadHeaders());
  assert.equal(declared.status, 413); assert.equal(declared.headers.get("connection"), "close");
  const chunked = await new Promise((resolve, reject) => {
    const request = httpRequest(`${base}${assetsPath()}`, { method: "POST", headers: uploadHeaders() }, (response) => { response.resume(); response.on("end", () => resolve(response.statusCode)); });
    request.on("error", reject); request.write(Buffer.alloc(5242880)); request.end(Buffer.alloc(5242881));
  });
  assert.equal(chunked, 413); assert.equal(calls.some(([name]) => name === "upload"), false);
});

test("one slow account cannot occupy the three global upload places and abort/completion restore capacity", { timeout: 10000 }, async (t) => {
  const rotatedA = Buffer.alloc(32, 21).toString("base64url"), tokenB = Buffer.alloc(32, 22).toString("base64url");
  const tokenC = Buffer.alloc(32, 23).toString("base64url"), tokenD = Buffer.alloc(32, 24).toString("base64url");
  const principals = new Map([[tokens.admin, ids.admin], [rotatedA, ids.admin], [tokenB, "1".repeat(32)], [tokenC, "2".repeat(32)], [tokenD, "3".repeat(32)]]);
  const { base, calls, service, server, admissionRates } = await fixture(t, {
    async actor(role, token) { return principals.has(token) ? { user: { id: principals.get(token), role, pseudonym: "Synthetic account" }, csrf, expiresAt: now + 3600000 } : null; },
  });
  const incoming = new Map(), admitted = new EventEmitter(); let admissionCount = 0;
  server.on("request", (request) => { if (request.headers["x-test-upload"]) incoming.set(request.headers["x-test-upload"], request); });
  const admit = service.admitUpload;
  service.admitUpload = async (...args) => { const ticket = await admit(...args); admissionCount += 1; admitted.emit("change"); return ticket; };
  const waitForAdmission = (target) => admissionCount >= target ? Promise.resolve() : new Promise((resolve) => {
    const changed = () => { if (admissionCount >= target) { admitted.off("change", changed); resolve(); } }; admitted.on("change", changed);
  });
  const headersFor = (token, extra = {}) => uploadHeaders("admin", { Cookie: `__Host-jessie_session=${token}`, ...extra });
  const stalled = [];
  const slow = (name, token) => {
    const request = httpRequest(`${base}${assetsPath()}`, { method: "POST", headers: headersFor(token, { "X-Test-Upload": name }) }, (response) => response.resume());
    request.on("error", () => {}); request.write(jpeg.subarray(0, 1)); stalled.push(request); return request;
  };
  let releaseProcessing;
  t.after(() => { releaseProcessing?.(); stalled.forEach((request) => request.destroy()); });
  const a = slow("a", tokens.admin); await waitForAdmission(1); await new Promise((resolve) => setImmediate(resolve));
  assert.equal(admissionRates.length, 2, "the unfinished A body already paid both persistent budgets");
  const sameAccount = await post(base, assetsPath(), jpeg, headersFor(rotatedA));
  assert.equal(sameAccount.status, 429); assert.equal(sameAccount.headers.get("retry-after"), "5"); assert.equal(admissionRates.length, 2, "rotating the session cannot reserve another place");
  assert.equal((await post(base, assetsPath(), jpeg, headersFor(tokenB))).status, 201, "B is admitted while A keeps its body open");
  const b = slow("b", tokenB), c = slow("c", tokenC); await waitForAdmission(4); await new Promise((resolve) => setImmediate(resolve));
  assert.equal(admissionRates.length, 8, "each admitted body pays once, including the unfinished bodies");
  const full = await post(base, assetsPath(), jpeg, headersFor(tokenD)); assert.equal(full.status, 429); assert.equal(admissionRates.length, 8);
  const abortA = new Promise((resolve) => incoming.get("a").once("aborted", resolve)); a.destroy(); await abortA; await new Promise((resolve) => setImmediate(resolve));
  const upload = service.upload; let processingStarted;
  const processing = new Promise((resolve) => { processingStarted = resolve; });
  service.upload = async (...args) => { processingStarted(); await new Promise((resolve) => { releaseProcessing = resolve; }); return upload(...args); };
  const d = post(base, assetsPath(), jpeg, headersFor(tokenD)); await processing;
  assert.equal((await post(base, assetsPath(), jpeg, headersFor(tokens.admin))).status, 429, "the processing operation retains the third place");
  releaseProcessing(); assert.equal((await d).status, 201); service.upload = upload;
  const aborts = [[b, "b"], [c, "c"]].map(([request, name]) => { const observed = new Promise((resolve) => incoming.get(name).once("aborted", resolve)); request.destroy(); return observed; });
  await Promise.all(aborts); await new Promise((resolve) => setImmediate(resolve));
  assert.equal((await post(base, assetsPath(), jpeg, headersFor(tokens.admin))).status, 201);
  assert.equal(calls.filter(([name]) => name === "upload").length, 3);
});

test("upload quota refusal returns before an unfinished body and attaches no body reader", async (t) => {
  const { base, handler, calls, service } = await fixture(t);
  service.admitUpload = async () => { throw Object.assign(new Error("private rate detail"), { code: "MEDIA_RATE_LIMIT", retryAfter: 42 }); };
  const request = new PassThrough(); request.method = "POST"; request.url = assetsPath();
  request.headers = Object.fromEntries(Object.entries(uploadHeaders()).map(([name, value]) => [name.toLowerCase(), value]));
  let status; const response = { headersSent: false, destroyed: false, writeHead(value) { status = value; }, end() {} };
  await handler(request, response); assert.equal(status, 429); assert.equal(request.listenerCount("data"), 0); request.destroy();
  const result = await new Promise((resolve, reject) => {
    const slow = httpRequest(`${base}${assetsPath()}`, { method: "POST", headers: uploadHeaders("admin", { "Content-Length": "1024" }) }, (response) => {
      response.resume(); response.on("end", () => { resolve({ status: response.statusCode, retry: response.headers["retry-after"] }); slow.destroy(); });
    });
    slow.on("error", reject); slow.flushHeaders();
  });
  assert.deepEqual(result, { status: 429, retry: "42" }); assert.equal(calls.some(([name]) => name === "upload"), false);
});

test("upload abort discards partial data and absorbs a later transport error", async () => {
  const request = new PassThrough(); request.headers = {};
  const result = readUpload(request); request.write(jpeg); request.emit("aborted");
  await assert.rejects(result, (error) => error.httpStatus === 400);
  assert.doesNotThrow(() => request.emit("error", new Error("private transport detail")));
  assert.equal(request.listenerCount("data"), 0); request.destroy();
});

test("slow binary uploads get a bounded thirty-second body budget and remove the body listeners", async (t) => {
  const request = new PassThrough(); request.headers = {};
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const result = readUpload(request);
  t.mock.timers.tick(29_999);
  assert.equal(request.listenerCount("data"), 1);
  t.mock.timers.tick(1);
  try { await assert.rejects(result, (error) => error.httpStatus === 408 && error.publicCode === "request_timeout"); }
  finally { request.destroy(); }
  assert.equal(request.listenerCount("data"), 0);
});

test("queries reject unknown, duplicate and noncanonical IDs, limits and uint64 cursors", async (t) => {
  const { base, calls } = await fixture(t);
  const listSuffixes = ["?afterId=invalid", "?afterId=" + "A".repeat(32), "?afterId=" + ids.asset + "%0A", "?afterId=" + ids.asset + "&afterId=" + ids.asset, "?conversationId=", "?limit=0", "?limit=101", "?limit=01", "?limit=1%0A", "?limit=1&limit=2", "?ownerId=x"];
  for (const suffix of listSuffixes) assert.equal((await fetch(`${base}${assetsPath()}${suffix}`, { headers: { Cookie: cookie("admin") } })).status, 400, suffix);
  for (const suffix of ["?before=01", "?before=-1", "?before=18446744073709551616", "?before=1%0A", "?before=1&before=2", "?after=1"]) assert.equal((await fetch(`${base}${conversationPath()}/gallery${suffix}`, { headers: { Cookie: cookie("admin") } })).status, 400, suffix);
  for (const suffix of ["?download=1", "?variant=full"]) assert.equal((await fetch(`${base}${assetsPath()}/${ids.asset}/full${suffix}`, { headers: { Cookie: cookie("admin") } })).status, 400);
  assert.equal(calls.some(([name]) => ["list", "gallery", "asset"].includes(name)), false);
});

test("gallery validates descending sequences, delivery URLs and the next page without precision loss", async (t) => {
  const maximum = "18446744073709551615";
  const { base, service, calls } = await fixture(t);
  service.gallery = async (role, token, conv, options) => { calls.push(["gallery", role, token, conv, options]); return { items: [{ messageId: ids.message, sequence: maximum, sender: "peer", createdAt: now, media: asset(role, true) }], nextBefore: maximum, hasMore: true }; };
  const response = await fetch(`${base}${conversationPath("client")}/gallery?limit=1`, { headers: { Cookie: cookie("client") } });
  assert.equal(response.status, 200); privateHeaders(response); const body = await response.json(); noPrivateFields(body);
  assert.equal(body.items[0].sequence, maximum); assert.equal(body.nextBefore, maximum);
  assert.equal(body.items[0].media.fullUrl, `${conversationPath("client")}/messages/${ids.message}/full`);
  assert.deepEqual(calls.at(-1), ["gallery", "client", tokens.client, ids.conversation, { before: null, limit: 1 }]);
  for (const result of [
    { items: [{ messageId: ids.message, sequence: "2", sender: "peer", createdAt: now, media: asset("client", true) }, { messageId: ids.message, sequence: "3", sender: "peer", createdAt: now, media: asset("client", true) }], nextBefore: "3", hasMore: false },
    { items: [], nextBefore: "1", hasMore: false },
    { items: [{ messageId: ids.message, sequence: "1", sender: "peer", createdAt: now, media: asset("client", true) }], nextBefore: "2", hasMore: false },
  ]) {
    service.gallery = async () => result;
    assert.equal((await fetch(`${base}${conversationPath("client")}/gallery`, { headers: { Cookie: cookie("client") } })).status, 503);
  }
});

test("GET and HEAD private bytes reauthorize each request, ignore Range and use fixed JPEG headers", async (t) => {
  const { base, calls } = await fixture(t);
  for (const role of ["admin", "client"]) for (const endpoint of [`${assetsPath(role)}/${ids.asset}/full`, `${conversationPath(role)}/messages/${ids.message}/thumb`]) {
    const response = await fetch(`${base}${endpoint}`, { headers: { Cookie: cookie(role), Range: "bytes=0-1" } });
    assert.equal(response.status, 200); privateHeaders(response); assert.deepEqual(Buffer.from(await response.arrayBuffer()), jpeg);
    assert.equal(response.headers.get("content-type"), "image/jpeg"); assert.equal(response.headers.get("content-length"), String(jpeg.length));
    assert.equal(response.headers.get("content-disposition"), 'inline; filename="photo.jpg"'); assert.equal(response.headers.get("accept-ranges"), "none"); assert.equal(response.headers.get("content-range"), null);
    const head = await fetch(`${base}${endpoint}`, { method: "HEAD", headers: { Cookie: cookie(role) } });
    assert.equal(head.status, 200); assert.equal(head.headers.get("content-length"), String(jpeg.length)); assert.equal((await head.arrayBuffer()).byteLength, 0);
  }
  assert.equal(calls.filter(([name]) => name === "actor").length, 8);
  assert.equal(calls.filter(([name]) => name === "asset" || name === "delivery").length, 8);
});

test("eight global private file operations bound both roles and retain aborted-operation slots until settled", async (t) => {
  const { base, service, server } = await fixture(t);
  const responses = new Map();
  server.on("request", (request, response) => { if (request.headers["x-test-download"]) responses.set(request.headers["x-test-download"], response); });
  const assetRead = service.asset;
  const gates = [];
  let readsReady, immediate = false;
  const started = new Promise((resolve) => { readsReady = resolve; });
  service.asset = async (...args) => {
    if (!immediate) await new Promise((resolve) => { gates.push(resolve); if (gates.length === 8) readsReady(); });
    return assetRead(...args);
  };
  const requests = [], completed = [];
  for (let index = 0; index < 8; index += 1) {
    completed.push(new Promise((resolve) => {
      const request = httpRequest(`${base}${assetsPath()}/${ids.asset}/full`, { headers: { Cookie: cookie("admin"), "X-Test-Download": String(index) } }, (response) => {
        response.resume(); response.on("end", () => resolve(response.statusCode));
      });
      request.on("error", () => resolve("aborted")); requests.push(request); request.end();
    }));
  }
  t.after(() => requests.forEach((request) => request.destroy()));
  await started;
  const blockedEndpoint = `${base}${assetsPath("client")}/${ids.asset}/thumb`;
  const blocked = await fetch(blockedEndpoint, { headers: { Cookie: cookie("client") } });
  assert.equal(blocked.status, 429); assert.deepEqual(await blocked.json(), { error: "try_again_later" }); assert.equal(blocked.headers.get("retry-after"), "5");
  assert.equal(gates.length, 8);
  const serverClosed = new Promise((resolve) => responses.get("0").once("close", resolve));
  requests[0].destroy(); await serverClosed;
  const stillBound = await fetch(blockedEndpoint, { headers: { Cookie: cookie("client") } });
  assert.equal(stillBound.status, 429); assert.equal(gates.length, 8);
  gates[0](); await new Promise((resolve) => setImmediate(resolve));
  immediate = true;
  const available = await fetch(blockedEndpoint, { method: "HEAD", headers: { Cookie: cookie("client") } });
  assert.equal(available.status, 200); assert.equal((await available.arrayBuffer()).byteLength, 0);
  gates.slice(1).forEach((resolve) => resolve());
  assert.deepEqual(await Promise.all(completed), ["aborted", ...Array(7).fill(200)]);
  for (let index = 0; index < 10; index += 1) assert.equal((await fetch(blockedEndpoint, { headers: { Cookie: cookie("client") } })).status, 200);
});

test("private byte slots last through response finish or close and use only a fifteen-second binary timeout", async (t) => {
  const { base, handler } = await fixture(t);
  const responses = [];
  for (let index = 0; index < 8; index += 1) {
    const response = new EventEmitter();
    response.headersSent = false; response.destroyed = false; response.writableEnded = false; response.writableFinished = false;
    response.writeHead = function (status) { this.status = status; this.headersSent = true; };
    response.end = function () { this.writableEnded = true; };
    response.setTimeout = function (duration, callback) { this.timeout = duration; if (callback) this.on("timeout", callback); return this; };
    response.destroy = function () { this.destroyed = true; this.emit("close"); };
    const request = new PassThrough(); request.method = "GET"; request.url = `${assetsPath()}/${ids.asset}/full`; request.headers = { cookie: cookie("admin") };
    assert.equal(await handler(request, response), true); assert.equal(response.status, 200); assert.equal(response.timeout, 15000); responses.push(response); request.destroy();
  }
  const endpoint = `${base}${assetsPath("client")}/${ids.asset}/thumb`;
  const full = await fetch(endpoint, { headers: { Cookie: cookie("client") } }); assert.equal(full.status, 429);
  responses[0].writableFinished = true; responses[0].emit("finish");
  assert.equal((await fetch(endpoint, { headers: { Cookie: cookie("client") } })).status, 200);
  responses[1].emit("timeout"); assert.equal(responses[1].destroyed, true);
  responses.slice(2).forEach((response) => response.destroy());
  for (const response of responses) {
    assert.equal(response.listenerCount("finish"), 0); assert.equal(response.listenerCount("close"), 0); assert.equal(response.listenerCount("timeout"), 0);
  }
  assert.equal((await fetch(endpoint, { headers: { Cookie: cookie("client") } })).status, 200);
});

test("image sends allow empty or exact plain caption and preserve duplicate/conflict behavior", async (t) => {
  const { base, calls, service } = await fixture(t);
  const endpoint = `${conversationPath("client")}/messages`;
  const sent = await post(base, endpoint, imageInput, mutation("client"));
  assert.equal(sent.status, 201); const sentBody = await sent.json(); noPrivateFields(sentBody); assert.equal(sentBody.message.body, ""); assert.equal(sentBody.message.media.id, ids.asset);
  assert.deepEqual(calls.at(-1), ["send", "client", tokens.client, ids.conversation, imageInput]);
  const escaped = `{"clientMessageId":"${ids.key}","mediaId":"${ids.asset}","caption":"${"\\u754c".repeat(1000)}"}`;
  assert.ok(Buffer.byteLength(escaped) > 4096);
  const caption = await post(base, endpoint, escaped, mutation("client")); assert.equal(caption.status, 201); assert.equal((await caption.json()).message.body, "界".repeat(1000));
  service.send = async () => ({ message: message("client"), duplicate: true });
  assert.equal((await post(base, endpoint, imageInput, mutation("client"))).status, 200);
  service.send = async () => { throw Object.assign(new Error("private previous caption"), { code: "CHAT_CONFLICT" }); };
  const conflict = await post(base, endpoint, imageInput, mutation("client")); assert.equal(conflict.status, 409); assert.deepEqual(await conflict.json(), { error: "message_conflict" });
});

test("image sends reject spoofed fields, invalid IDs, malformed captions and oversized JSON", async (t) => {
  const { base, calls } = await fixture(t); const endpoint = `${conversationPath()}/messages`;
  for (const body of [null, [], {}, { ...imageInput, caption: "x".repeat(1001) }, { ...imageInput, caption: null }, { ...imageInput, caption: " \n " }, { ...imageInput, caption: "\ud800" }, { ...imageInput, caption: "\u0000" }, { ...imageInput, caption: "\u200b" }, { ...imageInput, mediaId: "E".repeat(32) }, { ...imageInput, mediaId: ids.asset + "\n" }, { ...imageInput, clientMessageId: "" }, { ...imageInput, ownerId: ids.admin }, { ...imageInput, body: "spoofed text" }, { ...imageInput, fullUrl: "https://other.example" }]) {
    const rejected = await post(base, endpoint, body); assert.equal(rejected.status, 400, JSON.stringify(body)); assert.deepEqual(await rejected.json(), { error: "invalid_request" });
  }
  assert.equal((await post(base, endpoint, "x".repeat(8193))).status, 413);
  assert.equal(calls.some(([name]) => name === "send"), false);
});

test("asset removal uses authenticated JSON/CSRF, accepts only an empty object and hides returned storage", async (t) => {
  const { base, calls, service } = await fixture(t); const endpoint = `${assetsPath()}/${ids.asset}/delete`;
  for (const body of [[], null, { force: true }, { ownerId: ids.admin }]) assert.equal((await post(base, endpoint, body)).status, 400);
  assert.equal((await post(base, endpoint, {}, mutation("admin", { "X-CSRF-Token": "wrong" }))).status, 403);
  assert.equal((await post(base, endpoint, {}, mutation("admin", { "Content-Type": "text/plain" }))).status, 415);
  const response = await post(base, endpoint, {}); assert.equal(response.status, 200); assert.deepEqual(await response.json(), { deleted: true });
  assert.deepEqual(calls.at(-1), ["remove", "admin", tokens.admin, ids.asset]);
  service.removeAsset = async () => { throw Object.assign(new Error("private reference detail"), { code: "MEDIA_IN_USE" }); };
  const inUse = await post(base, endpoint, {}); assert.equal(inUse.status, 409); assert.deepEqual(await inUse.json(), { error: "media_in_use" });
});

test("invalid or cross-role service metadata, URLs and byte buffers fail closed", async (t) => {
  const { base, service } = await fixture(t);
  for (const overrides of [{ fullUrl: "https://attacker.example/photo.jpg" }, { thumbnailUrl: `${assetsPath("client")}/${ids.asset}/thumb` }, { fullUrl: `${assetsPath()}/${ids.asset}/full?key=private` }, { bytes: 10485761 }, { thumbnailBytes: 524289 }, { width: 2049 }, { height: 0 }, { thumbnailWidth: 481 }, { createdAt: Infinity }, { sharedHere: "yes" }]) {
    service.listAssets = async () => ({ assets: [asset("admin", false, overrides)], nextCursor: null, hasMore: false });
    const response = await fetch(`${base}${assetsPath()}`, { headers: { Cookie: cookie("admin") } }); assert.equal(response.status, 503); assert.deepEqual(await response.json(), { error: "messaging_unavailable" });
  }
  for (const result of [{ bytes: "private file path", mime: "image/jpeg" }, { bytes: Buffer.alloc(0), mime: "image/jpeg" }, { bytes: jpeg, mime: "text/html" }, { bytes: Buffer.alloc(524289), mime: "image/jpeg" }]) {
    service.asset = async () => result;
    const response = await fetch(`${base}${assetsPath()}/${ids.asset}/thumb`, { headers: { Cookie: cookie("admin") } }); assert.equal(response.status, 503); assert.deepEqual(await response.json(), { error: "media_unavailable" });
  }
});

test("media service errors are bounded without changing cookies", async (t) => {
  const { base, service } = await fixture(t);
  for (const [code, status, publicCode] of [["CHAT_UNAUTHORIZED", 401, "authentication_required"], ["AUTH_INVALID", 401, "authentication_required"], ["ACCESS_EXPIRED", 403, "request_rejected"], ["ACCESS_PREREQUISITES", 403, "request_rejected"], ["CHAT_FORBIDDEN", 403, "request_rejected"], ["MEDIA_NOT_FOUND", 404, "not_found"], ["MEDIA_INPUT", 400, "invalid_request"], ["MEDIA_FORMAT", 415, "media_format"], ["MEDIA_DIMENSIONS", 422, "media_dimensions"], ["MEDIA_BUSY", 429, "try_again_later"], ["MEDIA_RATE_LIMIT", 429, "try_again_later"], ["MEDIA_STORAGE_LIMIT", 507, "storage_limit"], ["MEDIA_CAPACITY_UNAVAILABLE", 503, "media_unavailable"], ["MEDIA_UNAVAILABLE", 503, "media_unavailable"], ["ER_PRIVATE_SQL", 503, "media_unavailable"]]) {
    service.listAssets = async () => { throw Object.assign(new Error("private SQL, original name and filesystem path"), { code, retryAfter: 5, privateKey: "secret" }); };
    const response = await fetch(`${base}${assetsPath("client")}`, { headers: { Cookie: cookie("client") } }); assert.equal(response.status, status, code); assert.deepEqual(await response.json(), { error: publicCode });
    assert.equal(response.headers.get("set-cookie"), null); if (status === 429) assert.equal(response.headers.get("retry-after"), "5");
  }
  service.listAssets = async () => { throw Object.assign(new Error("private"), { httpStatus: 400, publicCode: "private SQL" }); };
  const unexpected = await fetch(`${base}${assetsPath("client")}`, { headers: { Cookie: cookie("client") } }); assert.equal(unexpected.status, 503); assert.deepEqual(await unexpected.json(), { error: "media_unavailable" });
});

test("upload capacity refusals distinguish exhausted storage from an unavailable capacity check without leaking details", async (t) => {
  const { base, service } = await fixture(t);
  for (const role of ["admin", "client"]) for (const [code, status, error] of [
    ["MEDIA_STORAGE_LIMIT", 507, "storage_limit"], ["MEDIA_CAPACITY_UNAVAILABLE", 503, "media_unavailable"],
  ]) {
    service.upload = async () => { throw Object.assign(new Error("Private disk path /private/photos and usage 99"), { code, usedBytes: 99, limitBytes: 100 }); };
    const response = await post(base, assetsPath(role), jpeg, uploadHeaders(role));
    assert.equal(response.status, status); privateHeaders(response);
    assert.deepEqual(await response.json(), { error });
    assert.equal(response.headers.get("set-cookie"), null); assert.equal(response.headers.get("retry-after"), null);
  }
});

test("media routing is exact, unexpected methods do not touch service and HEAD never emits JSON", async (t) => {
  const { base, calls } = await fixture(t);
  for (const endpoint of ["/api/media/other/assets", `${assetsPath()}/`, `${assetsPath()}/${"E".repeat(32)}/full`, `${assetsPath()}/${ids.asset}/unknown`, `${conversationPath()}/gallery/${ids.message}/full`]) assert.equal((await fetch(`${base}${endpoint}`)).status, 404);
  for (const [endpoint, method, allow] of [[assetsPath(), "DELETE", "GET, POST"], [`${assetsPath()}/${ids.asset}/full`, "POST", "GET, HEAD"], [`${conversationPath()}/messages`, "GET", "POST"], ["/api/media/admin/capabilities", "HEAD", "GET"]]) {
    const response = await fetch(`${base}${endpoint}`, { method }); assert.equal(response.status, 405); assert.equal(response.headers.get("allow"), allow); if (method === "HEAD") assert.equal((await response.arrayBuffer()).byteLength, 0);
  }
  assert.equal(calls.length, 0);
});

test("photo selection is bounded to ten and fully validated before any message write", async t => {
  const {base,calls}=await fixture(t);
  const input=n=>({...imageInput,clientMessageId:n.toString(16).padStart(32,"0")});
  for (const messages of [[],Array.from({length:11},(_,n)=>input(n+1)),[input(1),input(1)],[input(1),{...input(2),caption:7}]]) {
    const response=await fetch(`${base}${conversationPath()}/messages/batch`,{method:"POST",headers:mutation(),body:JSON.stringify({messages})});
    assert.equal(response.status,400);
  }
  assert.equal(calls.filter(([name])=>name==="send").length,0);
  const response=await fetch(`${base}${conversationPath()}/messages/batch`,{method:"POST",headers:mutation(),body:JSON.stringify({messages:Array.from({length:10},(_,n)=>input(n+1))})});
  assert.equal(response.status,200);privateHeaders(response);
  const data=await response.json();assert.equal(data.results.length,10);noPrivateFields(data);
});
test("photo batch returns per-file failure and retry reuses existing per-message idempotency",async t=>{
  const recorded=new Map();let fail=true;
  const {base}=await fixture(t,{send:async(role,token,conversationId,input)=>{
    if(input.clientMessageId==="2".repeat(32)&&fail){fail=false;throw Object.assign(new Error(),{code:"MEDIA_UNAVAILABLE"});}
    const duplicate=recorded.has(input.clientMessageId);
    if(!duplicate)recorded.set(input.clientMessageId,message(role,{clientMessageId:input.clientMessageId,sequence:String(recorded.size+1)}));
    return {message:recorded.get(input.clientMessageId),duplicate};
  }});
  const inputs=["1","2","3"].map(n=>({...imageInput,clientMessageId:n.repeat(32)}));
  const send=()=>fetch(`${base}${conversationPath("client")}/messages/batch`,{method:"POST",headers:mutation("client"),body:JSON.stringify({messages:inputs})});
  const first=await(await send()).json();assert.equal(first.results[1].status,503);assert.equal(first.results[2].status,424);assert.equal(recorded.size,1);
  const second=await(await send()).json();assert.equal(recorded.size,3);assert.deepEqual(second.results.map(row=>row.duplicate),[true,false,false]);
});
test("gallery month spans are passed to authorized history and nearest newer photo is bounded",async t=>{
  const {base,calls,service}=await fixture(t);
  const from=now-1000,until=now+1000;
  assert.equal((await fetch(`${base}${conversationPath("client")}/gallery?from=${from}&until=${until}`,{headers:{Cookie:cookie("client")}})).status,200);
  assert.deepEqual(calls.at(-1),["gallery","client",tokens.client,ids.conversation,{before:null,limit:50,from,until}]);
  for(const suffix of [`?from=${until}&until=${from}`,"?from=-1","?from=01","?from=1&from=2","?until=253402300800000","?after=1&limit=2","?after=1&before=3&limit=1"])
    assert.equal((await fetch(`${base}${conversationPath()}/gallery${suffix}`,{headers:{Cookie:cookie("admin")}})).status,400,suffix);
  service.gallery=async()=>({items:[{messageId:ids.message,sequence:"2",sender:"peer",createdAt:now,media:asset("admin",true)}],nextBefore:null,hasMore:false});
  assert.equal((await fetch(`${base}${conversationPath()}/gallery?after=1&limit=1`,{headers:{Cookie:cookie("admin")}})).status,200);
  service.gallery=async()=>({items:[{messageId:ids.message,sequence:"2",sender:"peer",createdAt:now,media:asset("admin",true)},{messageId:ids.message,sequence:"1",sender:"peer",createdAt:now,media:asset("admin",true)}],nextBefore:null,hasMore:false});
  assert.equal((await fetch(`${base}${conversationPath()}/gallery?limit=2`,{headers:{Cookie:cookie("admin")}})).status,503,"duplicate delivery metadata is not exposed");
});
test("clients cannot inject administrative reply tracking into ordinary or batched photo sends",async t=>{
  const {base,calls}=await fixture(t);
  for(const suffix of ["","/batch"]){
    const value={...imageInput,replyThrough:"1",replyVersion:"1"};
    const response=await fetch(`${base}${conversationPath("client")}/messages${suffix}`,{method:"POST",headers:mutation("client"),body:JSON.stringify(suffix?{messages:[value]}:value)});
    assert.equal(response.status,400);
  }
  assert.equal(calls.filter(([name])=>name==="send").length,0);
});

test("gallery validates canonical date and identity order independently of message sequences",async t=>{
  const {base,service}=await fixture(t);
  const item=(messageId,seq,createdAt)=>({messageId,sequence:seq,sender:"peer",createdAt,media:asset("admin",true,{fullUrl:`${conversationPath()}/messages/${messageId}/full`,thumbnailUrl:`${conversationPath()}/messages/${messageId}/thumb`})});
  for(const items of [[item("a".repeat(32),"1",now),item("b".repeat(32),"2",now-1)],[item("b".repeat(32),"1",now),item("a".repeat(32),"2",now)]]){
    service.gallery=async()=>({items,nextBefore:null,hasMore:false});
    assert.equal((await fetch(`${base}${conversationPath()}/gallery`,{headers:{Cookie:cookie("admin")}})).status,200);
  }
  service.gallery=async()=>({items:[item("a".repeat(32),"2",now),item("b".repeat(32),"1",now)],nextBefore:null,hasMore:false});
  assert.equal((await fetch(`${base}${conversationPath()}/gallery`,{headers:{Cookie:cookie("admin")}})).status,503,"equal-date IDs must be descending even if sequences descend");
});
