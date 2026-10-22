import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readdir } from "node:fs/promises";
import { createVideoService } from "../server/video/service.mjs";
import { tokenDigest } from "../server/auth/crypto.mjs";
import { VIDEO_BLOCK_BYTES, videoStoredBytes } from "../server/video/storage.mjs";
import { videoFixture, mp4Source, uploadFixture, collectVideo } from "./helpers/video-transport-fixture.mjs";

const code = (wanted) => (error) => error.code === wanted;

test("compatibility video transport keeps authenticated ranges while refusing admission and upload before storage", async t => {
  const f = await videoFixture(t), account = f.accounts[0], saved = await uploadFixture(f, account, 100);
  const compat = await createVideoService({ ...f.options, creationEnabled: false }), before = f.state.calls.length;
  await assert.rejects(compat.admitUpload(account.role, account.token, { bytes: 100, mime: "video/mp4" }), code("VIDEO_READ_ONLY"));
  await assert.rejects(compat.upload(account.role, account.token, {}, { async *[Symbol.asyncIterator]() { assert.fail("A closed creator must not read a body"); } }), code("VIDEO_READ_ONLY"));
  await assert.rejects(compat.upload(account.role, "bad", {}, []), code("CHAT_UNAUTHORIZED"));
  assert.equal(f.state.calls.length, before);
  const opened = await compat.open(account.role, account.token, saved.id);
  assert.equal((await collectVideo(opened.stream({ start: 0, end: 15 }))).length, 16); await opened.close();
});

async function deletionFixture(t) {
  const f = await videoFixture(t), fingerprint = await f.storage.fingerprint();
  const failure = (value) => { throw Object.assign(new Error("synthetic lifecycle failure"), { code: value }); };
  const owned = (request) => {
    const owner = f.accounts.find((a) => a.active && a.role === request.role && tokenDigest(a.token).equals(request.tokenHash));
    if (!owner) failure("CHAT_UNAUTHORIZED");
    const row = f.state.rows.get(request.assetId.toString("hex"));
    if (!row || !row.ownerId.equals(owner.id)) failure("VIDEO_NOT_FOUND");
    return row;
  };
  f.state.deletionFault = null; f.state.references = new Set(); f.state.refunds = 0;
  Object.assign(f.store, {
    binding: Object.freeze({ rootFingerprint: fingerprint.toString("hex") }),
    async deleteAsset(request) {
      f.state.calls.push("deleteAsset"); const row = owned(request);
      if (f.state.references.has(row.id.toString("hex"))) failure("VIDEO_IN_USE");
      if (row.state === "reserved") failure("VIDEO_INPUT");
      if (row.state === "registered") { row.state = "cleanup_pending"; row.deletedAt = f.state.now; }
      if (f.state.deletionFault === "mark_ack") throw new Error("synthetic SQL acknowledgement lost after mark");
      return { ...row };
    },
    async releaseDeletedStorage(request) {
      f.state.calls.push("releaseDeletedStorage"); const row = owned(request);
      assert.ok(row.storageKey.equals(request.storageKey));
      if (row.state === "released") return { released: true };
      assert.equal(row.state, "cleanup_pending");
      if (f.state.deletionFault === "release_before") throw new Error("synthetic SQL failure before commit");
      row.state = "released"; f.state.held -= row.storedBytes; f.state.refunds++;
      if (f.state.deletionFault === "release_ack") throw new Error("synthetic SQL acknowledgement lost after release");
      return { released: true };
    },
  });
  const originalRemove = f.options.storage.remove;
  f.options.storage.remove = async (request) => { f.state.calls.push("remove"); return originalRemove(request); };
  return f;
}

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

test("owner deletion uses durable marking, real encrypted file removal and one final refund", async (t) => {
  const f = await deletionFixture(t), a = f.accounts[0], result = await uploadFixture(f), before = f.state.calls.length;
  assert.deepEqual(await f.service.remove(a.role, a.token, result.id), { deleted: true });
  assert.deepEqual(await readdir(f.root), []); assert.equal(f.state.held, 0); assert.equal(f.state.refunds, 1);
  assert.deepEqual(f.state.calls.slice(before).filter((name) => ["deleteAsset", "remove", "releaseDeletedStorage"].includes(name)),
    ["deleteAsset", "remove", "releaseDeletedStorage"]);
  await assert.rejects(f.service.open(a.role, a.token, result.id), code("VIDEO_NOT_FOUND"));
  assert.deepEqual(await f.service.remove(a.role, a.token, result.id), { deleted: true });
  assert.equal(f.state.held, 0); assert.equal(f.state.refunds, 1);
});

test("owner deletion rejects missing lifecycle composition, a peer and live message references before I/O", async (t) => {
  const legacy = await videoFixture(t), a = legacy.accounts[0];
  await assert.rejects(legacy.service.remove(a.role, a.token, "a".repeat(32)), code("VIDEO_CONFIG"));
  const f = await deletionFixture(t), original = await uploadFixture(f), held = f.state.held, files = await readdir(f.root);
  await assert.rejects(f.service.remove("client", f.accounts[1].token, original.id), code("VIDEO_NOT_FOUND"));
  f.state.references.add(original.id);
  await assert.rejects(f.service.remove("admin", f.accounts[0].token, original.id), code("VIDEO_IN_USE"));
  assert.deepEqual(await readdir(f.root), files); assert.equal(f.state.held, held);
  assert.equal(f.state.calls.includes("remove"), false); assert.equal(f.state.calls.includes("releaseDeletedStorage"), false);
});

test("lost deletion-mark acknowledgement keeps the original charged and a retry completes it", async (t) => {
  const f = await deletionFixture(t), a = f.accounts[0], result = await uploadFixture(f), held = f.state.held;
  f.state.deletionFault = "mark_ack";
  await assert.rejects(f.service.remove(a.role, a.token, result.id), code("VIDEO_UNAVAILABLE"));
  assert.equal((await readdir(f.root)).length, 1); assert.equal(f.state.held, held); assert.equal(f.state.refunds, 0);
  await assert.rejects(f.service.open(a.role, a.token, result.id), code("VIDEO_NOT_FOUND"));
  f.state.deletionFault = null;
  await f.service.remove(a.role, a.token, result.id);
  assert.equal(f.state.held, 0); assert.equal(f.state.refunds, 1);
});

test("ambiguous or failed physical removal never releases durable video capacity", async (t) => {
  for (const fault of ["before_remove", "after_remove", "missing_positive_result"]) await t.test(fault, async (t) => {
    const f = await deletionFixture(t), a = f.accounts[0], result = await uploadFixture(f), held = f.state.held;
    const original = f.options.storage.remove;
    f.options.storage.remove = async (request) => {
      if (fault === "before_remove") throw new Error("synthetic storage unavailable");
      await original(request);
      if (fault === "after_remove") throw new Error("synthetic lost durable-removal result");
      return { removed: false };
    };
    await assert.rejects(f.service.remove(a.role, a.token, result.id), code("VIDEO_UNAVAILABLE"));
    assert.equal(f.state.held, held); assert.equal(f.state.refunds, 0);
    assert.equal(f.state.calls.includes("releaseDeletedStorage"), false);
    f.options.storage.remove = original;
    await f.service.remove(a.role, a.token, result.id);
    assert.deepEqual(await readdir(f.root), []); assert.equal(f.state.held, 0); assert.equal(f.state.refunds, 1);
  });
});

test("SQL release failures retain an exact charge or preserve the completed one-refund result", async (t) => {
  for (const fault of ["release_before", "release_ack"]) await t.test(fault, async (t) => {
    const f = await deletionFixture(t), a = f.accounts[0], result = await uploadFixture(f), held = f.state.held;
    f.state.deletionFault = fault;
    await assert.rejects(f.service.remove(a.role, a.token, result.id), code("VIDEO_UNAVAILABLE"));
    assert.deepEqual(await readdir(f.root), []);
    assert.equal(f.state.held, fault === "release_before" ? held : 0);
    f.state.deletionFault = null;
    await f.service.remove(a.role, a.token, result.id);
    await f.service.remove(a.role, a.token, result.id);
    assert.equal(f.state.held, 0); assert.equal(f.state.refunds, 1);
  });
});

test("deletion revalidates its physical root before marking, before removal and before refund", async (t) => {
  for (const changeAt of [1, 2, 3]) await t.test(`root changes at guard ${changeAt}`, async (t) => {
    const f = await deletionFixture(t), a = f.accounts[0], result = await uploadFixture(f), held = f.state.held;
    const original = f.options.storage.fingerprint; let reads = 0;
    f.options.storage.fingerprint = async () => ++reads === changeAt ? randomBytes(32) : original();
    await assert.rejects(f.service.remove(a.role, a.token, result.id), code("VIDEO_UNAVAILABLE"));
    assert.equal(f.state.held, held); assert.equal(f.state.refunds, 0);
    assert.equal(f.state.calls.includes("releaseDeletedStorage"), false);
    assert.equal((await readdir(f.root)).length, changeAt === 3 ? 0 : 1);
    f.options.storage.fingerprint = original;
    await f.service.remove(a.role, a.token, result.id);
    assert.equal(f.state.held, 0); assert.equal(f.state.refunds, 1);
  });
});

test("revocation after unlink prevents release until an authorized retry or closure", async (t) => {
  const f = await deletionFixture(t), a = f.accounts[0], result = await uploadFixture(f), held = f.state.held;
  const original = f.options.storage.remove;
  f.options.storage.remove = async (request) => { const result = await original(request); a.active = false; return result; };
  await assert.rejects(f.service.remove(a.role, a.token, result.id), code("CHAT_UNAUTHORIZED"));
  assert.deepEqual(await readdir(f.root), []); assert.equal(f.state.held, held); assert.equal(f.state.refunds, 0);
  f.options.storage.remove = original; a.active = true;
  await f.service.remove(a.role, a.token, result.id);
  assert.equal(f.state.held, 0); assert.equal(f.state.refunds, 1);
});

test("the owned video library is scoped, ordered and retains cleanup intents without private fields", async t => {
  const f = await videoFixture(t), owner = f.accounts[0];
  const first = await uploadFixture(f, owner, 100), second = await uploadFixture(f, owner, 101);
  const rows = [first, second].map(item => f.state.rows.get(item.id)).sort((a, b) => Buffer.compare(a.id, b.id));
  rows[1].deletedAt = f.state.now;
  f.store.listOwned = async request => {
    assert.equal(request.role, owner.role); assert.ok(request.tokenHash.equals(tokenDigest(owner.token)));
    assert.equal(request.limit, 1);
    return request.afterId === null ? { assets: [rows[0]], nextCursor: rows[0].id, hasMore: true }
      : { assets: [rows[1]], nextCursor: null, hasMore: false };
  };
  const page = await f.service.listOwned(owner.role, owner.token, { limit: 1 });
  assert.equal(page.nextCursor, rows[0].id.toString("hex")); assert.equal(page.hasMore, true);
  assert.equal(page.assets[0].contentUrl, `/api/video/admin/assets/${page.nextCursor}/content`);
  assert.equal(page.assets[0].cleanupPending, false);
  const next = await f.service.listOwned(owner.role, owner.token, { afterId: page.nextCursor, limit: 1 });
  assert.equal(next.assets[0].cleanupPending, true); assert.equal(next.assets[0].contentUrl, null);
  assert.doesNotMatch(JSON.stringify([page, next]), /storageKey|ownerId|digest|reserveToken|pendingBytes/);
  for (const invalid of [{ limit: 0 }, { limit: 101 }, { afterId: "bad" }]) await assert.rejects(f.service.listOwned(owner.role, owner.token, invalid), code("VIDEO_INPUT"));
  f.store.listOwned = async () => ({ assets: [{ ...rows[0], ownerId: f.accounts[1].id }], nextCursor: null, hasMore: false });
  await assert.rejects(f.service.listOwned(owner.role, owner.token), code("VIDEO_UNAVAILABLE"));
});

test("the owned video library rejects cursor drift and revoked sessions", async t => {
  const f = await videoFixture(t), owner = f.accounts[0], uploaded = await uploadFixture(f, owner, 100), row = f.state.rows.get(uploaded.id);
  f.store.listOwned = async () => ({ assets: [row], nextCursor: Buffer.alloc(16, 255), hasMore: true });
  await assert.rejects(f.service.listOwned(owner.role, owner.token), code("VIDEO_UNAVAILABLE"));
  f.store.listOwned = async () => ({ assets: [row], nextCursor: null, hasMore: false });
  await assert.rejects(f.service.listOwned(owner.role, owner.token, { afterId: uploaded.id }), code("VIDEO_UNAVAILABLE"));
  owner.active = false;
  await assert.rejects(f.service.listOwned(owner.role, owner.token), code("CHAT_UNAUTHORIZED"));
});
