import test from "node:test";
import assert from "node:assert/strict";
import { createServer, request as httpRequest } from "node:http";
import { PassThrough } from "node:stream";
import { AUTH_HEADERS } from "../server/auth/http.mjs";
import { createVideoHandler } from "../server/video/http.mjs";

const origin = "https://jessiemessage.example";
const token = Buffer.alloc(32, 5).toString("base64url"), clientToken = Buffer.alloc(32, 7).toString("base64url");
const csrf = Buffer.alloc(32, 6).toString("base64url"), assetId = "a".repeat(32);
const path = (role = "admin") => `/api/video/${role}/assets`;
const contentPath = (role = "admin") => `${path(role)}/${assetId}/content`;
const cookie = (role = "admin") => `${role === "admin" ? "__Host-jessie_session" : "__Host-jessie_client"}=${role === "admin" ? token : clientToken}`;
const headers = (role = "admin", extra = {}) => ({ Cookie: cookie(role), Origin: origin, "X-CSRF-Token": csrf, "Content-Type": "video/mp4", ...extra });
const video = Buffer.from("synthetic mp4 protocol bytes");
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(condition, timeout = 2000) {
  const start = Date.now(); while (!condition()) { if (Date.now() - start > timeout) throw new Error("Condition not reached."); await sleep(5); }
}

async function fixture(t, overrides = {}, options = {}) {
  const calls = [], streams = [], closes = [], tickets = new Set(), released = [];
  const service = {
    async actor(role, raw) {
      calls.push(["actor", role]);
      if (raw !== (role === "admin" ? token : clientToken)) return null;
      return { user: { id: (role === "admin" ? "b" : "c").repeat(32), role, pseudonym: role }, csrf,
        expiresAt: Date.now() + 3600000, access: { state: "active", admissionPolicy: "manual_invitation", emailVerified: true, invitationConsumed: true, approved: true } };
    },
    async admitUpload(role, raw, input) { calls.push(["admit", role, input]); const ticket = {}; tickets.add(ticket); return ticket; },
    async releaseUpload(ticket) { tickets.delete(ticket); released.push(ticket); },
    async upload(role, raw, ticket, source, { signal }) {
      assert.ok(tickets.has(ticket)); assert.equal(signal.aborted, false);
      const chunks = []; for await (const chunk of source) { assert.ok(chunk.length <= 65536); chunks.push(Buffer.from(chunk)); }
      const bytes = Buffer.concat(chunks); calls.push(["upload", role, bytes]);
      return { id: assetId, bytes: bytes.length, mime: "video/mp4", storageKey: "private-secret", originalFilename: "private.mp4" };
    },
    async open(role, raw, target, { signal }) {
      calls.push(["open", role, target]);
      return { bytes: video.length, mime: "video/mp4", storageKey: "private-secret", async *stream(range) {
        streams.push(range); assert.equal(signal.aborted, false); yield video.subarray(range.start, range.end + 1);
      }, async close() { closes.push(target); } };
    },
    ...overrides,
  };
  const handler = createVideoHandler(service, { origin, ...options });
  const server = createServer(async (request, response) => {
    if (!await handler(request, response)) { response.writeHead(404); response.end("fallback"); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); });
  return { base: `http://127.0.0.1:${server.address().port}`, port: server.address().port, server, handler, calls, streams, closes, tickets, released, service };
}

function privateHeaders(response) {
  for (const [name, value] of Object.entries(AUTH_HEADERS)) assert.equal(response.headers.get(name), value);
  assert.equal(response.headers.get("access-control-allow-origin"), null);
}
function rawRequest(port, { method = "GET", url = contentPath(), headers: requestHeaders = { Cookie: cookie() }, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ hostname: "127.0.0.1", port, method, path: url, headers: requestHeaders }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, bytes: Buffer.concat(chunks) }));
      res.on("error", reject);
    });
    req.on("error", reject); req.end(body);
  });
}

test("video handler requires canonical origin, complete service and bounded test deadlines", async (t) => {
  const { service } = await fixture(t);
  for (const candidate of ["http://example.invalid", `${origin}/`, `${origin}/path`, "https://user:password@example.invalid", `${origin}?x=1`]) assert.throws(() => createVideoHandler(service, { origin: candidate }));
  assert.throws(() => createVideoHandler({}, { origin }));
  for (const [name, limit] of [["uploadTimeoutMs", 300000], ["transferTimeoutMs", 300000], ["readTimeoutMs", 30000]]) {
    for (const value of [0, -1, 1.5, "1", limit + 1]) assert.throws(() => createVideoHandler(service, { origin, [name]: value }));
  }
});

test("known video routes reject other methods and malformed routes fall through", async (t) => {
  const { base } = await fixture(t);
  for (const [url, method, allow] of [[path(), "GET", "POST"], [contentPath(), "POST", "GET, HEAD"], [contentPath(), "OPTIONS", "GET, HEAD"]]) {
    const response = await fetch(`${base}${url}`, { method }); assert.equal(response.status, 405); assert.equal(response.headers.get("allow"), allow); privateHeaders(response);
  }
  for (const url of [`${path()}/`, `/api/video/other/assets`, `${path()}/${assetId.toUpperCase()}/content`, `${contentPath()}/`, `${path()}/../../admin`]) {
    assert.equal((await fetch(`${base}${url}`)).status, 404);
  }
});

test("only admins upload while both roles retain authorized reads without private metadata", async (t) => {
  const { base, calls, closes, released } = await fixture(t);
  for (const role of ["admin", "client"]) {
    const response = await fetch(`${base}${path(role)}`, { method: "POST", headers: headers(role), body: video });
    assert.equal(response.status, role === "admin" ? 201 : 403); privateHeaders(response);
    assert.deepEqual(await response.json(), role === "admin" ? { id: assetId, bytes: video.length, mime: "video/mp4" } : { error: "video_admin_only" });
    const download = await fetch(`${base}${contentPath(role)}`, { headers: { Cookie: cookie(role) } });
    assert.equal(download.status, 200); privateHeaders(download); assert.deepEqual(Buffer.from(await download.arrayBuffer()), video);
    assert.equal(download.headers.get("content-length"), String(video.length));
    assert.equal(download.headers.get("content-disposition"), 'inline; filename="video.mp4"');
    assert.equal(download.headers.get("accept-ranges"), "bytes");
  }
  assert.equal(calls.filter(([name]) => name === "upload").length, 1);
  await until(() => closes.length === 2 && released.length === 1);
});

test("single ranges clamp ends and serve inclusive, open and suffix byte intervals", async (t) => {
  const { base, streams } = await fixture(t);
  for (const [range, start, end] of [["bytes=0-0", 0, 0], ["Bytes=0-1", 0, 1], ["bytes=3-8", 3, 8], ["bytes=4-", 4, video.length - 1], ["bytes=-5", video.length - 5, video.length - 1], ["bytes=-999", 0, video.length - 1], ["bytes=2-999", 2, video.length - 1]]) {
    const response = await fetch(`${base}${contentPath()}`, { headers: { Cookie: cookie(), Range: range } });
    assert.equal(response.status, 206, range); privateHeaders(response);
    assert.equal(response.headers.get("content-range"), `bytes ${start}-${end}/${video.length}`);
    assert.equal(response.headers.get("content-length"), String(end - start + 1));
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), video.subarray(start, end + 1));
    assert.equal(streams.at(-1).start, start); assert.equal(streams.at(-1).end, end);
  }
});

test("HEAD ignores Range and describes the complete resource without invoking the byte stream", async (t) => {
  const { base, streams, closes } = await fixture(t);
  const whole = await fetch(`${base}${contentPath()}`, { method: "HEAD", headers: { Cookie: cookie() } });
  assert.equal(whole.status, 200); assert.equal(whole.headers.get("content-length"), String(video.length)); assert.equal(await whole.text(), "");
  for (const Range of ["bytes=2-4", "bytes=notvalid", "other=0-1"]) {
    const range = await fetch(`${base}${contentPath()}`, { method: "HEAD", headers: { Cookie: cookie(), Range } });
    assert.equal(range.status, 200); assert.equal(range.headers.get("content-range"), null); assert.equal(range.headers.get("content-length"), String(video.length));
    assert.equal(await range.text(), "");
  }
  assert.equal(streams.length, 0); await until(() => closes.length === 4);
});

test("malformed, multipart and impossible ranges return private 416 after owner authorization", async (t) => {
  const { base, streams, calls, closes } = await fixture(t);
  const ranges = ["bytes=", "bytes=-", "bytes=-0", "bytes=4-2", `bytes=${video.length}-`, "bytes=0-1,4-5", "bytes=1.5-", "bytes=9007199254740992-", "bytes=0-" + "1".repeat(200)];
  for (const Range of ranges) {
    const response = await fetch(`${base}${contentPath()}`, { headers: { Cookie: cookie(), Range } });
    assert.equal(response.status, 416, Range); privateHeaders(response);
    assert.equal(response.headers.get("content-range"), `bytes */${video.length}`);
    assert.deepEqual(await response.json(), { error: "range_not_satisfiable" });
  }
  assert.equal(streams.length, 0); assert.equal(calls.filter(([name]) => name === "open").length, ranges.length); await until(() => closes.length === ranges.length);
});

test("If-Range falls back to complete bytes because this private transport emits no validator", async (t) => {
  const { base } = await fixture(t);
  const response = await fetch(`${base}${contentPath()}`, { headers: { Cookie: cookie(), Range: "bytes=2-4", "If-Range": '"unavailable-validator"' } });
  assert.equal(response.status, 200); assert.equal(response.headers.get("content-range"), null); assert.equal(response.headers.get("etag"), null);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), video);
});

test("GET ignores an unknown valid range unit and returns the complete authorized video", async (t) => {
  const { base } = await fixture(t);
  for (const Range of ["other=0-1", "UnKnOwN=1-4", "items=0-1,4-5"]) {
    const response = await fetch(`${base}${contentPath()}`, { headers: { Cookie: cookie(), Range } });
    assert.equal(response.status, 200); assert.equal(response.headers.get("content-range"), null); assert.equal(response.headers.get("content-length"), String(video.length));
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), video);
  }
});

test("missing, malformed, duplicate and other-role cookies never reach storage", async (t) => {
  const { base, calls } = await fixture(t);
  for (const Cookie of ["", "__Host-jessie_session=invalid", `${cookie()}; ${cookie()}`, cookie("client"), `__Host-jessie_session=${"A".repeat(42)}B`]) {
    const response = await fetch(`${base}${contentPath()}`, { headers: { Cookie } });
    assert.equal(response.status, 401); privateHeaders(response); assert.deepEqual(await response.json(), { error: "authentication_required" });
  }
  assert.equal(calls.length, 0);
});

test("owner denial wins over range validity and never leaks video length", async (t) => {
  const { base } = await fixture(t, { async open() { throw Object.assign(new Error("private path and SQL"), { code: "VIDEO_NOT_FOUND" }); } });
  const response = await fetch(`${base}${contentPath()}`, { headers: { Cookie: cookie(), Range: "bytes=not-valid" } });
  assert.equal(response.status, 404); assert.equal(response.headers.get("content-range"), null); assert.deepEqual(await response.json(), { error: "not_found" });
});

test("client prerequisites and malformed actor DTOs fail closed before admission or open", async (t) => {
  const f = await fixture(t);
  const actor = f.service.actor;
  for (const override of [{ access: { state: "active", admissionPolicy: "manual_invitation", emailVerified: true, invitationConsumed: true, approved: false } }, { user: { id: "incorrect", role: "client", pseudonym: "client" } }, { csrf: "wrong" }]) {
    f.service.actor = async (...args) => ({ ...await actor(...args), ...override });
    const response = await fetch(`${f.base}${contentPath("client")}`, { headers: { Cookie: cookie("client") } });
    assert.ok([403, 503].includes(response.status)); await response.arrayBuffer();
  }
  assert.equal(f.calls.some(([name]) => ["admit", "open"].includes(name)), false);
});

test("upload origin, CSRF, encoding, MIME, length and query are validated before a body read", async (t) => {
  const { base, calls, port } = await fixture(t);
  const cases = [[{ Origin: "https://other.example" }, 403], [{ "Sec-Fetch-Site": "same-site" }, 403], [{ "X-CSRF-Token": "wrong" }, 403], [{ Cookie: "" }, 401], [{ "Content-Type": "video/webm" }, 415], [{ "Content-Type": "video/mp4; charset=utf-8" }, 415], [{ "Content-Encoding": "gzip" }, 415]];
  for (const [extra, status] of cases) {
    const response = await fetch(`${base}${path()}`, { method: "POST", headers: headers("admin", extra), body: video });
    assert.equal(response.status, status); privateHeaders(response); await response.arrayBuffer();
  }
  const lengthless = await rawRequest(port, { method: "POST", url: path(), headers: { ...headers(), "Transfer-Encoding": "chunked" }, body: video });
  assert.equal(lengthless.status, 411);
  const empty = await fetch(`${base}${path()}`, { method: "POST", headers: headers(), body: Buffer.alloc(0) }); assert.equal(empty.status, 400); await empty.arrayBuffer();
  const oversized = await rawRequest(port, { method: "POST", url: path(), headers: { ...headers(), "Content-Length": "104857601" } }); assert.equal(oversized.status, 413);
  for (const query of ["?x=1", "?x=1&x=1"]) {
    const response = await fetch(`${base}${contentPath()}${query}`, { headers: { Cookie: cookie() } }); assert.equal(response.status, 400); await response.arrayBuffer();
  }
  assert.equal(calls.some(([name]) => ["admit", "upload", "open"].includes(name)), false);
});

test("rejected authorization and CSRF do not attach a readable body listener", async (t) => {
  const { handler, calls } = await fixture(t);
  for (const extra of [{ Cookie: "" }, { "X-CSRF-Token": "wrong" }]) {
    const request = new PassThrough(); request.method = "POST"; request.url = path();
    request.headers = Object.fromEntries(Object.entries(headers("admin", { ...extra, "Content-Length": "20" })).map(([k, v]) => [k.toLowerCase(), v]));
    let status;
    const response = { writeHead(value) { status = value; }, end() {}, headersSent: false, destroyed: false };
    assert.equal(await handler(request, response), true); assert.ok([401, 403].includes(status)); assert.equal(request.listenerCount("readable"), 0);
    request.destroy();
  }
  assert.equal(calls.some(([name]) => name === "admit"), false);
});

test("streamed uploads use bounded source chunks rather than collecting the video in HTTP", async (t) => {
  let chunks = 0, received = 0, largest = 0;
  const bytes = 1024 * 1024 + 13;
  const { port, released } = await fixture(t, { async upload(role, raw, ticket, source) {
    for await (const chunk of source) { chunks += 1; received += chunk.length; largest = Math.max(largest, chunk.length); }
    return { id: assetId, bytes: received, mime: "video/mp4" };
  } });
  const response = await rawRequest(port, { method: "POST", url: path(), headers: { ...headers(), "Content-Length": String(bytes) }, body: Buffer.alloc(bytes, 9) });
  assert.equal(response.status, 201); assert.equal(received, bytes); assert.ok(chunks > 1); assert.ok(largest <= 65536); await until(() => released.length === 1);
});

test("upload timeout interrupts a stalled source and releases its admission", async (t) => {
  const { port, released } = await fixture(t, {}, { uploadTimeoutMs: 25 });
  const response = await new Promise((resolve, reject) => {
    const req = httpRequest({ hostname: "127.0.0.1", port, method: "POST", path: path(), headers: { ...headers(), "Content-Length": "100" } }, (res) => {
      const chunks = []; res.on("data", (chunk) => chunks.push(chunk)); res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() })); res.on("error", reject);
    });
    req.on("error", reject); req.flushHeaders(); req.write(Buffer.alloc(1));
  });
  assert.equal(response.status, 408); assert.deepEqual(JSON.parse(response.body), { error: "request_timeout" }); await until(() => released.length === 1);
});

test("aborted uploads settle the source and release admission before a new upload", async (t) => {
  const { port, calls, released, base } = await fixture(t);
  const req = httpRequest({ hostname: "127.0.0.1", port, method: "POST", path: path(), headers: { ...headers(), "Content-Length": "100000" } });
  req.on("error", () => {}); req.flushHeaders(); req.write(Buffer.alloc(65536));
  await until(() => calls.some(([name]) => name === "admit")); req.destroy();
  await until(() => released.length === 1);
  const next = await fetch(`${base}${path()}`, { method: "POST", headers: headers(), body: video }); assert.equal(next.status, 201); await next.arrayBuffer();
});

test("response stream failure and incorrect byte counts terminate the transfer without a JSON tail", async (t) => {
  const failures = [async function* () { yield video.subarray(0, 2); throw new Error("secret disk failure"); }, async function* () { yield video.subarray(0, 2); }, async function* () { yield Buffer.alloc(262145); }];
  for (const stream of failures) {
    let closed = 0;
    const { base } = await fixture(t, { async open() { return { bytes: video.length, mime: "video/mp4", stream, async close() { closed += 1; } }; } });
    await assert.rejects(async () => { const response = await fetch(`${base}${contentPath()}`, { headers: { Cookie: cookie() } }); await response.arrayBuffer(); });
    await until(() => closed === 1);
  }
});

test("response close aborts the stream but does not free its slot while I/O remains pending", async (t) => {
  const blocked = deferred(); let started = 0, closed = 0, signals = [];
  const { port, base } = await fixture(t, { async open() { return { bytes: video.length, mime: "video/mp4", async *stream({ signal }) {
    started += 1; signals.push(signal); yield video.subarray(0, 1); await blocked.promise; if (signal.aborted) throw signal.reason; yield video.subarray(1);
  }, async close() { closed += 1; } }; } });
  const requests = [];
  for (let i = 0; i < 4; i += 1) {
    const res = await new Promise((resolve, reject) => {
      const req = httpRequest({ hostname: "127.0.0.1", port, path: contentPath(), headers: { Cookie: cookie() } }, resolve);
      req.on("error", reject); req.end(); requests.push(req);
    });
    res.on("error", () => {}); res.destroy();
  }
  await until(() => started === 4 && signals.every((signal) => signal.aborted));
  const busy = await fetch(`${base}${contentPath()}`, { headers: { Cookie: cookie() } }); assert.equal(busy.status, 429); assert.equal(busy.headers.get("retry-after"), "5"); await busy.arrayBuffer();
  blocked.resolve(); await until(() => closed === 4);
  const next = await fetch(`${base}${contentPath()}`, { method: "HEAD", headers: { Cookie: cookie() } }); assert.equal(next.status, 200); await next.arrayBuffer();
});

test("upload process limit spans handler instances and remains held through admission cleanup", async (t) => {
  const admission = deferred(), cleanup = deferred(); let admitted = 0, cleanupStarted = 0;
  const overrides = { async admitUpload() { admitted += 1; await admission.promise; return {}; }, async upload(role, raw, ticket, source) { for await (const chunk of source) void chunk; return { id: assetId, bytes: video.length, mime: "video/mp4" }; }, async releaseUpload() { cleanupStarted += 1; await cleanup.promise; } };
  const a = await fixture(t, overrides), b = await fixture(t, overrides);
  const first = fetch(`${a.base}${path()}`, { method: "POST", headers: headers(), body: video });
  const second = fetch(`${b.base}${path()}`, { method: "POST", headers: headers(), body: video });
  await until(() => admitted === 2);
  const busy = await fetch(`${b.base}${path()}`, { method: "POST", headers: headers(), body: video }); assert.equal(busy.status, 429); await busy.arrayBuffer();
  admission.resolve(); const replies = await Promise.all([first, second]); for (const response of replies) { assert.equal(response.status, 201); await response.arrayBuffer(); }
  await until(() => cleanupStarted === 2);
  const stillBusy = await fetch(`${b.base}${path()}`, { method: "POST", headers: headers(), body: video }); assert.equal(stillBusy.status, 429); await stillBusy.arrayBuffer();
  cleanup.resolve(); await sleep(10);
});

test("a slow download applies socket backpressure instead of eagerly decrypting the entire video", async (t) => {
  const bytes = 64 * 1024 * 1024, chunk = Buffer.alloc(262144, 31); let yielded = 0, closed = false;
  const { port } = await fixture(t, { async open() { return { bytes, mime: "video/mp4", async *stream() {
    for (let i = 0; i < bytes / chunk.length; i += 1) { yielded += 1; yield chunk; }
  }, async close() { closed = true; } }; } });
  const response = await new Promise((resolve, reject) => {
    const req = httpRequest({ hostname: "127.0.0.1", port, path: contentPath(), headers: { Cookie: cookie() } }, resolve); req.on("error", reject); req.end();
  });
  response.pause(); await sleep(25);
  assert.ok(yielded > 0 && yielded < bytes / chunk.length, `Expected bounded production while paused, got ${yielded} chunks.`);
  let received = 0;
  await new Promise((resolve, reject) => { response.on("data", (part) => { received += part.length; }); response.on("end", resolve); response.on("error", reject); response.resume(); });
  assert.equal(received, bytes); assert.equal(yielded, bytes / chunk.length); await until(() => closed);
});

test("read deadline closes a stalled response and keeps its slot until underlying work settles", async (t) => {
  const block = deferred(); let signal, closed = false;
  const { port } = await fixture(t, { async open() { return { bytes: video.length, mime: "video/mp4", async *stream(range) {
    signal = range.signal; yield video.subarray(0, 1); await block.promise; if (signal.aborted) throw signal.reason; yield video.subarray(1);
  }, async close() { closed = true; } }; } }, { readTimeoutMs: 25, transferTimeoutMs: 50 });
  await assert.rejects(rawRequest(port));
  assert.equal(signal.aborted, true); assert.equal(closed, false);
  block.resolve(); await until(() => closed);
});
