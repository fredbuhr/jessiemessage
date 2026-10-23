import test from "node:test";
import assert from "node:assert/strict";
import { createServer, request as httpRequest } from "node:http";
import { once } from "node:events";
import { readdir } from "node:fs/promises";
import { createVideoHandler } from "../server/video/http.mjs";
import { VIDEO_BLOCK_BYTES } from "../server/video/storage.mjs";
import { videoFixture, mp4Source, legacyClientVideoFixture, collectVideo } from "./helpers/video-transport-fixture.mjs";

const origin = "https://jessiemessage.example";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(condition, timeout = 2000) {
  const start = Date.now(); while (!await condition()) { if (Date.now() - start > timeout) throw new Error("Video cleanup did not settle."); await sleep(5); }
}
const cookie = (account) => `${account.role === "admin" ? "__Host-jessie_session" : "__Host-jessie_client"}=${account.token}`;
const path = (account) => `/api/video/${account.role}/assets`;
const contentPath = (account, id) => `${path(account)}/${id}/content`;
const uploadHeaders = (account, bytes) => ({ Cookie: cookie(account), Origin: origin, "X-CSRF-Token": account.csrf,
  "Content-Type": "video/mp4", "Content-Length": String(bytes) });

async function httpFixture(t, options = {}) {
  const f = await videoFixture(t), handler = createVideoHandler(f.service, { origin, ...options });
  const server = createServer(async (request, response) => { if (!await handler(request, response)) { response.writeHead(404); response.end(); } });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); });
  return { ...f, server, port: server.address().port, base: `http://127.0.0.1:${server.address().port}` };
}

function upload(f, account, bytes, source = mp4Source(bytes)) {
  return new Promise((resolve, reject) => {
    const request = httpRequest({ hostname: "127.0.0.1", port: f.port, path: path(account), method: "POST", headers: uploadHeaders(account, bytes) }, (response) => {
      const chunks = []; response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, body: JSON.parse(Buffer.concat(chunks).toString()) }));
      response.on("error", reject);
    });
    request.on("error", reject);
    (async () => { try { for await (const chunk of source) if (!request.write(chunk)) await once(request, "drain"); request.end(); } catch (error) { request.destroy(); reject(error); } })();
  });
}

test("real video transport uploads encrypted blocks and reads owner ranges across block boundaries", async (t) => {
  const f = await httpFixture(t), bytes = VIDEO_BLOCK_BYTES * 3 + 65, account = f.accounts[0];
  const expected = await collectVideo(mp4Source(bytes)), result = await upload(f, account, bytes);
  assert.equal(result.status, 201); assert.equal(result.body.bytes, bytes); assert.equal(result.body.mime, "video/mp4");
  assert.match(result.body.id, /^[a-f0-9]{32}$/); assert.deepEqual(Object.keys(result.body).sort(), ["bytes", "id", "mime"]);
  const filenames = await readdir(f.root); assert.equal(filenames.length, 1); assert.match(filenames[0], /^[a-f0-9]{64}\.video\.enc$/);
  const first = VIDEO_BLOCK_BYTES - 5, last = VIDEO_BLOCK_BYTES + 17;
  const response = await fetch(`${f.base}${contentPath(account, result.body.id)}`, { headers: { Cookie: cookie(account), Range: `bytes=${first}-${last}` } });
  assert.equal(response.status, 206); assert.equal(response.headers.get("content-range"), `bytes ${first}-${last}/${bytes}`);
  assert.equal(response.headers.get("cache-control"), "no-store"); assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), expected.subarray(first, last + 1));
  const suffix = await fetch(`${f.base}${contentPath(account, result.body.id)}`, { headers: { Cookie: cookie(account), Range: "bytes=-19" } });
  assert.equal(suffix.status, 206); assert.deepEqual(Buffer.from(await suffix.arrayBuffer()), expected.subarray(-19));
  const head = await fetch(`${f.base}${contentPath(account, result.body.id)}`, { method: "HEAD", headers: { Cookie: cookie(account), Range: "bytes=0-31" } });
  assert.equal(head.status, 200); assert.equal(head.headers.get("content-length"), String(bytes)); assert.equal(head.headers.get("content-range"), null); assert.equal(await head.text(), "");
  const whole = await fetch(`${f.base}${contentPath(account, result.body.id)}`, { headers: { Cookie: cookie(account) } });
  assert.equal(whole.status, 200); assert.deepEqual(Buffer.from(await whole.arrayBuffer()), expected);
  assert.ok(f.state.held > bytes); assert.equal(f.state.calls.filter((name) => name === "commit").length, 1);
});

test("real video transport refuses another client and administrator owner routes and revoked sessions", async (t) => {
  const f = await httpFixture(t), owner = f.accounts[1], bytes = VIDEO_BLOCK_BYTES + 32;
  const saved = await legacyClientVideoFixture(f, owner, bytes), uploaded = { body: saved };
  const historical = await fetch(`${f.base}${contentPath(owner, saved.id)}`, { headers: { Cookie: cookie(owner) } });
  assert.equal(historical.status, 200); assert.equal((await historical.arrayBuffer()).byteLength, bytes);
  for (const other of [f.accounts[0], f.accounts[2]]) {
    const response = await fetch(`${f.base}${contentPath(other, uploaded.body.id)}`, { headers: { Cookie: cookie(other), Range: "bytes=notvalid" } });
    assert.equal(response.status, 404); assert.equal(response.headers.get("content-range"), null); assert.deepEqual(await response.json(), { error: "not_found" });
  }
  owner.active = false;
  const revoked = await fetch(`${f.base}${contentPath(owner, uploaded.body.id)}`, { headers: { Cookie: cookie(owner) } });
  assert.equal(revoked.status, 401); assert.deepEqual(await revoked.json(), { error: "authentication_required" });
  assert.equal(revoked.headers.get("set-cookie"), null);
});

test("aborting an actual staged upload refunds only after confirmed encrypted staging cleanup and permits retry", async (t) => {
  const f = await httpFixture(t), account = f.accounts[0], bytes = VIDEO_BLOCK_BYTES * 3;
  const request = httpRequest({ hostname: "127.0.0.1", port: f.port, path: path(account), method: "POST", headers: uploadHeaders(account, bytes) });
  request.on("error", () => {}); request.flushHeaders();
  for await (const chunk of mp4Source(VIDEO_BLOCK_BYTES * 2, 65536)) request.write(chunk);
  await until(async () => (await readdir(f.root)).some((name) => name.endsWith(".tmp")));
  assert.ok(f.state.held > 0); request.destroy();
  await until(async () => f.state.held === 0 && (await readdir(f.root)).length === 0);
  assert.equal([...f.state.rows.values()][0].state, "released"); assert.equal(f.state.calls.includes("commit"), false);
  const retry = await upload(f, account, bytes); assert.equal(retry.status, 201);
  const response = await fetch(`${f.base}${contentPath(account, retry.body.id)}`, { headers: { Cookie: cookie(account), Range: "bytes=0-31" } });
  assert.equal(response.status, 206); assert.equal((await response.arrayBuffer()).byteLength, 32);
});

test("real source timeout is reported as 408 across the service boundary and refunds an unwritten reservation", async (t) => {
  const f = await httpFixture(t, { uploadTimeoutMs: 30 }), account = f.accounts[0], bytes = VIDEO_BLOCK_BYTES;
  const result = await new Promise((resolve, reject) => {
    const request = httpRequest({ hostname: "127.0.0.1", port: f.port, path: path(account), method: "POST", headers: uploadHeaders(account, bytes) }, (response) => {
      const chunks = []; response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString()) })); response.on("error", reject);
    });
    request.on("error", reject); request.flushHeaders(); request.write(Buffer.alloc(10));
  });
  assert.equal(result.status, 408); assert.deepEqual(result.body, { error: "request_timeout" });
  await until(() => f.state.held === 0); assert.equal((await readdir(f.root)).length, 0); assert.equal(f.state.calls.includes("commit"), false);
});

test("invalid real MP4 prefix creates no persistent file and releases the reserved capacity", async (t) => {
  const f = await httpFixture(t), account = f.accounts[0], bytes = 65536;
  const result = await upload(f, account, bytes, (async function* () { yield Buffer.alloc(bytes, 1); })());
  assert.equal(result.status, 415); assert.deepEqual(result.body, { error: "video_format" });
  await until(() => f.state.held === 0); assert.equal((await readdir(f.root)).length, 0);
});

test("timeout during real encrypted staging removes its partial file before the capacity refund", async (t) => {
  const f = await httpFixture(t, { uploadTimeoutMs: 100 }), account = f.accounts[0], bytes = VIDEO_BLOCK_BYTES * 3;
  let request;
  const result = new Promise((resolve, reject) => {
    request = httpRequest({ hostname: "127.0.0.1", port: f.port, path: path(account), method: "POST", headers: uploadHeaders(account, bytes) }, (response) => {
      const chunks = []; response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString()) })); response.on("error", reject);
    });
    request.on("error", reject); request.flushHeaders();
  });
  const prefix = await collectVideo(mp4Source(bytes)); request.write(prefix.subarray(0, VIDEO_BLOCK_BYTES + 32));
  await until(async () => (await readdir(f.root)).some((name) => name.endsWith(".tmp")));
  assert.ok(f.state.held > 0);
  const response = await result; assert.equal(response.status, 408); assert.deepEqual(response.body, { error: "request_timeout" });
  await until(async () => f.state.held === 0 && (await readdir(f.root)).length === 0);
  assert.equal(f.state.calls.includes("commit"), false); assert.equal([...f.state.rows.values()][0].state, "released");
});


test("client binary video upload returns before receiving its body and leaves no durable reservation or file", async t => {
  const f = await httpFixture(t), account = f.accounts[1], before = [...f.state.calls];
  const response = await new Promise((resolve, reject) => {
    const req = httpRequest({ hostname: "127.0.0.1", port: f.port, path: path(account), method: "POST", headers: uploadHeaders(account, 65536) }, res => {
      const chunks = []; res.on("data", chunk => chunks.push(chunk));
      res.on("end", () => { resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks)) }); req.destroy(); });
      res.on("error", reject);
    });
    req.on("error", error => { if (error.code !== "ECONNRESET") reject(error); }); req.flushHeaders();
  });
  assert.deepEqual(response, { status: 403, body: { error: "video_admin_only" } });
  assert.deepEqual(f.state.calls, before); assert.equal(f.state.held, 0); assert.equal(f.state.rows.size, 0);
  assert.deepEqual(await readdir(f.root), []);
});
