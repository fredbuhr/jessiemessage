import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readdir } from "node:fs/promises";
import { createVideoService } from "../server/video/service.mjs";
import { VIDEO_BLOCK_BYTES, videoStoredBytes } from "../server/video/storage.mjs";
import { videoFixture, mp4Source, uploadFixture, collectVideo } from "./helpers/video-transport-fixture.mjs";

const code = (wanted) => (error) => error.code === wanted;

test("video foundation requires an explicit catalog, live authorization, persistent rate limits and private storage", async (t) => {
  const f = await videoFixture(t);
  for (const name of ["store", "chatService", "authStore", "storage"]) await assert.rejects(createVideoService({ ...f.options, [name]: null }), code("VIDEO_CONFIG"));
  for (const name of ["reserve", "commit", "getOwned", "release"]) await assert.rejects(createVideoService({ ...f.options, store: { ...f.store, [name]: null } }), code("VIDEO_CONFIG"));
  for (const key of [null, Buffer.alloc(31), Buffer.alloc(33)]) await assert.rejects(createVideoService({ ...f.options, key }), code("VIDEO_CONFIG"));
  for (const minimumFreeBytes of [-1, 1.2, NaN, "0"]) await assert.rejects(createVideoService({ ...f.options, minimumFreeBytes }), code("VIDEO_CONFIG"));
});

test("streamed private upload reserves encrypted capacity, commits minimal metadata and serves authenticated ranges", async (t) => {
  const f = await videoFixture(t), bytes = VIDEO_BLOCK_BYTES * 4 + 57, source = mp4Source(bytes, 37);
  const result = await uploadFixture(f, f.accounts[1], bytes, source);
  assert.deepEqual(Object.keys(result).sort(), ["bytes", "id", "mime"]);
  assert.equal(result.bytes, bytes); assert.equal(result.mime, "video/mp4");
  assert.equal(f.state.held, videoStoredBytes(bytes));
  assert.equal(f.state.rows.get(result.id).state, "registered");
  assert.ok(f.state.calls.indexOf("reserve") < f.state.calls.indexOf("commit"));
  const handle = await f.service.open("client", f.accounts[1].token, result.id);
  const range = await collectVideo(handle.stream({ start: VIDEO_BLOCK_BYTES - 3, end: VIDEO_BLOCK_BYTES + 12 }));
  assert.deepEqual(range, Buffer.alloc(16, 0x5a)); await handle.close();
});

test("another owner, wrong role, deleted object and revoked access fail before file opening", async (t) => {
  const f = await videoFixture(t), result = await uploadFixture(f, f.accounts[1]);
  await assert.rejects(f.service.open("client", f.accounts[2].token, result.id), code("VIDEO_NOT_FOUND"));
  await assert.rejects(f.service.open("admin", f.accounts[1].token, result.id), code("CHAT_UNAUTHORIZED"));
  f.state.rows.get(result.id).deletedAt = f.state.now;
  await assert.rejects(f.service.open("client", f.accounts[1].token, result.id), code("VIDEO_NOT_FOUND"));
  f.accounts[1].active = false;
  await assert.rejects(f.service.open("client", f.accounts[1].token, result.id), code("CHAT_UNAUTHORIZED"));
  assert.equal((await readdir(f.root)).length, 1);
});

test("admission binds the account and original token, is single-use and excludes simultaneous same-owner transfers", async (t) => {
  const f = await videoFixture(t), account = f.accounts[0], bytes = 100;
  const ticket = await f.service.admitUpload(account.role, account.token, { bytes, mime: "video/mp4" });
  await assert.rejects(f.service.admitUpload(account.role, account.token, { bytes, mime: "video/mp4" }), code("VIDEO_BUSY"));
  await assert.rejects(f.service.upload("client", f.accounts[1].token, ticket, mp4Source(bytes)), code("VIDEO_INPUT"));
  const result = await f.service.upload(account.role, account.token, ticket, mp4Source(bytes)); assert.equal(result.bytes, bytes);
  await assert.rejects(f.service.upload(account.role, account.token, ticket, mp4Source(bytes)), code("VIDEO_INPUT"));
  const next = await f.service.admitUpload(account.role, account.token, { bytes, mime: "video/mp4" }); await f.service.releaseUpload(next);
  assert.equal(f.state.held, videoStoredBytes(bytes));
});

test("abandoning a waiting upload refunds exactly its reservation and supports retry", async (t) => {
  const f = await videoFixture(t), a = f.accounts[0];
  const ticket = await f.service.admitUpload(a.role, a.token, { bytes: 100, mime: "video/mp4" });
  await f.service.releaseUpload(ticket); await f.service.releaseUpload(ticket);
  assert.equal(f.state.held, 0); assert.deepEqual(await readdir(f.root), []);
  const next = await f.service.admitUpload(a.role, a.token, { bytes: 100, mime: "video/mp4" }); await f.service.releaseUpload(next);
});

test("format rejection and exact-size failure remove no preexisting object and refund a known unwritten reservation", async (t) => {
  const f = await videoFixture(t), original = await uploadFixture(f), before = await readdir(f.root), held = f.state.held;
  await assert.rejects(uploadFixture(f, f.accounts[0], 100, (async function* () { yield Buffer.alloc(100); })()), code("VIDEO_FORMAT"));
  await assert.rejects(uploadFixture(f, f.accounts[0], 100000, mp4Source(99000)), code("VIDEO_INPUT"));
  assert.equal(f.state.held, held); assert.deepEqual(await readdir(f.root), before);
  // Explicitly close an unconsumed descriptor, as HEAD requests must do.
  const h = await f.service.open("admin", f.accounts[0].token, original.id); assert.equal(h.bytes, original.bytes); await h.close();
});

test("rate and disk limits reject before consuming video source", async (t) => {
  const f = await videoFixture(t); f.state.rateAllowed = false;
  await assert.rejects(uploadFixture(f), code("VIDEO_RATE_LIMIT")); assert.equal(f.state.held, 0);
  f.state.rateAllowed = true;
  const g = await videoFixture(t, { storageOverrides: { availableSpace: async () => ({ availableBytes: 0n }) }, minimumFreeBytes: 1 });
  const progress = {}; await assert.rejects(uploadFixture(g, g.accounts[0], 100, mp4Source(100, 20, progress)), code("VIDEO_STORAGE_LIMIT"));
  assert.equal(progress.produced, undefined); assert.equal(g.state.held, 0);
});

test("lost reserve acknowledgement retains capacity and never starts file writing", async (t) => {
  const f = await videoFixture(t); f.state.failReserveAck = true;
  await assert.rejects(uploadFixture(f), code("VIDEO_UNAVAILABLE"));
  assert.ok(f.state.held > 0); assert.deepEqual(await readdir(f.root), []); assert.equal(f.state.calls.includes("release"), false);
  f.state.failReserveAck = false; await uploadFixture(f);
});

test("lost commit acknowledgement preserves the encrypted object and durable charge", async (t) => {
  const f = await videoFixture(t); f.state.failCommitAck = true;
  await assert.rejects(uploadFixture(f), code("VIDEO_UNAVAILABLE"));
  assert.ok(f.state.held > 0); assert.equal((await readdir(f.root)).length, 1); assert.equal(f.state.calls.includes("release"), false);
  const [row] = f.state.rows.values(); assert.equal(row.state, "registered");
  f.state.failCommitAck = false;
  const h = await f.service.open("admin", f.accounts[0].token, row.id.toString("hex")); await h.close();
});

test("revocation during transfer prevents metadata commit and preserves the encrypted result for reconciliation", async (t) => {
  const f = await videoFixture(t), a = f.accounts[0], bytes = VIDEO_BLOCK_BYTES * 2 + 37;
  const source = (async function* () { for await (const chunk of mp4Source(bytes)) yield chunk; a.active = false; })();
  await assert.rejects(uploadFixture(f, a, bytes, source), code("CHAT_UNAUTHORIZED"));
  assert.equal(f.state.calls.includes("commit"), false); assert.ok(f.state.held > 0); assert.equal((await readdir(f.root)).length, 1);
});

test("cancellation before writing refunds admission and release cannot free an in-progress writer", async (t) => {
  const f = await videoFixture(t), a = f.accounts[0], controller = new AbortController();
  const ticket = await f.service.admitUpload(a.role, a.token, { bytes: 100, mime: "video/mp4" }); controller.abort();
  await assert.rejects(f.service.upload(a.role, a.token, ticket, mp4Source(100), { signal: controller.signal }), code("VIDEO_INPUT"));
  assert.equal(f.state.held, 0);
  let unblock, entered; const ready = new Promise((resolve) => { entered = resolve; });
  const wait = new Promise((resolve) => { unblock = resolve; });
  const next = await f.service.admitUpload(a.role, a.token, { bytes: 100, mime: "video/mp4" });
  const upload = f.service.upload(a.role, a.token, next, (async function* () { entered(); await wait; yield* mp4Source(100); })());
  await ready; await f.service.releaseUpload(next);
  await assert.rejects(f.service.admitUpload(a.role, a.token, { bytes: 100, mime: "video/mp4" }), code("VIDEO_BUSY"));
  unblock(); await upload;
});

test("owner read slots close after completion, HEAD-style close, cancellation and corrupt metadata", async (t) => {
  const f = await videoFixture(t), a = f.accounts[0], result = await uploadFixture(f);
  const one = await f.service.open(a.role, a.token, result.id), two = await f.service.open(a.role, a.token, result.id);
  await assert.rejects(f.service.open(a.role, a.token, result.id), code("VIDEO_BUSY"));
  await one.close(); await one.close();
  const three = await f.service.open(a.role, a.token, result.id); await three.close();
  const controller = new AbortController(); controller.abort();
  await assert.rejects(collectVideo(two.stream({ signal: controller.signal })), code("VIDEO_INPUT"));
  const row = f.state.rows.get(result.id); row.storageKey = randomBytes(32);
  await assert.rejects(f.service.open(a.role, a.token, result.id), code("VIDEO_UNAVAILABLE"));
});

test("return or throw before the first video read closes both descriptor and owner slot", async (t) => {
  const f = await videoFixture(t), a = f.accounts[0], result = await uploadFixture(f);
  for (let i = 0; i < 5; i++) {
    const h = await f.service.open(a.role, a.token, result.id), stream = h.stream();
    await stream.return(); await h.close();
  }
  for (let i = 0; i < 5; i++) {
    const h = await f.service.open(a.role, a.token, result.id), stream = h.stream();
    await assert.rejects(stream.throw(new Error("consumer stopped")), /consumer stopped/); await h.close();
  }
  const h = await f.service.open(a.role, a.token, result.id); await h.close();
});
