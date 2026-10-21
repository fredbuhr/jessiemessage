import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { ConversationExportError } from "../server/chat/conversation-export.mjs";
import { createStreamingConversationExporter, STREAMING_CONVERSATION_EXPORT_LIMITS } from "../server/chat/streaming-conversation-export.mjs";

const id = (n) => n.toString(16).padStart(32, "0"), cid = id(1), clientId = id(2), now = 1792340000000, block = 262144;
const videoId = id(20), jpeg = Buffer.from([0xff, 0xd8, 0xff, 1, 0xff, 0xd9]);
const videoMetadata = (mid, changes = {}, role = "admin") => ({ id: videoId, bytes: block * 2 + 57, mime: "video/mp4", contentUrl: `/api/video/${role}/conversations/${cid}/messages/${mid}/content`, ...changes });
const message = (n, changes = {}) => ({ id: id(100 + n), sequence: String(n), sender: "peer", body: "Caption <script>literal</script> & 🎥", createdAt: now - 10000 + n, deletedAt: null, ...changes });
const page = (messages, changes = {}) => ({ conversation: { id: cid, client: { id: clientId, pseudonym: "<Client & synthetic>" }, peerName: "Never-export-login", latestSequence: "100" }, messages, hasMoreBefore: false, nextBefore: null, ...changes });
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
const code = (expected) => (error) => error instanceof ConversationExportError && error.code === expected && error.cause === undefined && !/secret|SQL|path/.test(error.message);
function fixture({ pages, role = "admin", photo = true, videoOpen, history: historyRead, limits = {}, elapsed = () => 0 } = {}) {
  const historyCalls = [], opens = [], photoBuffers = []; let currentTime = now, closed = 0, chunks = 0;
  const exporter = createStreamingConversationExporter({ role, clock: () => currentTime, elapsed, limits,
    async history(...args) { historyCalls.push(args); return historyRead ? historyRead(...args) : pages?.[historyCalls.length - 1] ?? page([message(1, { video: videoMetadata(id(101)) })]); },
    photo: photo ? async () => { const bytes = Buffer.from(jpeg); photoBuffers.push(bytes); return { mime: "image/jpeg", bytes }; } : null,
    async video(...args) {
      opens.push(args); if (videoOpen) return videoOpen(...args);
      let closing;
      return { bytes: block * 2 + 57, mime: "video/mp4", stream() { return (async function* () {
        for (const bytes of [block, block, 57]) { chunks++; yield Buffer.alloc(bytes, 0x5a); }
      })(); }, close() { closing ??= Promise.resolve().then(() => { closed++; }); return closing; } };
    } });
  return { exporter, historyCalls, opens, photoBuffers, get closed() { return closed; }, get chunks() { return chunks; },
    advance() { currentTime += 30001; }, create(options = {}) { return exporter.create({ token: "synthetic-token", conversationId: cid, expectedClientId: clientId,
      ...(role === "client" ? { clientName: "Synthetic client" } : {}), includePhotos: photo, includeVideos: true, ...options }); } };
}
async function collect(prepared, options) {
  const chunks = []; let bytes = 0;
  for await (const chunk of prepared.stream(options)) { assert.ok(Buffer.isBuffer(chunk)); assert.ok(chunk.length > 0 && chunk.length <= block); chunks.push(Buffer.from(chunk)); bytes += chunk.length; }
  assert.equal(bytes, prepared.bytes); return Buffer.concat(chunks);
}
async function inspect(t, archive) {
  const base = fileURLToPath(new URL("../../audit/", import.meta.url)); await mkdir(base, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(path.join(base, "streaming-archive-")); t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, "conversation.zip"); await writeFile(file, archive, { mode: 0o600 });
  const script = "import sys,zipfile,json,hashlib;z=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None;print(json.dumps({'names':z.namelist(),'document':json.loads(z.read('conversation.json')),'html':z.read('Conversation.html').decode(),'readme':z.read('LIRE-MOI.txt').decode(),'hashes':{n:hashlib.sha256(z.read(n)).hexdigest() for n in z.namelist() if n.startswith(('photos/','videos/'))}}))";
  return JSON.parse((await promisify(execFile)("python3", ["-c", script, file], { maxBuffer: 2 * 1024 * 1024 })).stdout);
}

test("prepared ZIP streams one original for repeated deliveries, preserving each caption and offline HTML", async (t) => {
  const first = message(1), third = message(3, { body: "A distinct caption for the same original" }), media = { id: id(30), sharedHere: true, bytes: jpeg.length, width: 12, height: 8 };
  first.video = videoMetadata(first.id); third.video = videoMetadata(third.id);
  const f = fixture({ pages: [page([third, message(4, { body: null, deletedAt: now })], { hasMoreBefore: true, nextBefore: "3" }), page([first, message(2, { media, body: "Photo caption" })])] });
  const prepared = await f.create(); assert.equal(f.opens.length, 0); assert.equal(f.chunks, 0);
  assert.equal(f.exporter.streaming, true); assert.equal(f.exporter.videos, true); assert.equal(f.exporter.photos, true); assert.equal(f.exporter.maxBytes, 256 * 1024 * 1024);
  assert.ok(prepared.bytes > block * 2); assert.equal(f.photoBuffers.every((bytes) => bytes.every((value) => value === 0)), true);
  const data = await inspect(t, await collect(prepared));
  assert.deepEqual(data.names.sort(), ["Conversation.html", "conversation.json", "LIRE-MOI.txt", `photos/${id(30)}.jpg`, `videos/${videoId}.mp4`].sort());
  assert.equal(data.document.version, 2); assert.deepEqual(data.document.messages.map((m) => m.sequence), ["1", "2", "3", "4"]);
  assert.equal(data.document.messages[0].body, first.body); assert.equal(data.document.messages[2].body, third.body);
  assert.deepEqual(data.document.messages[0].video, { file: `videos/${videoId}.mp4`, bytes: block * 2 + 57, mime: "video/mp4" });
  assert.equal(Object.hasOwn(data.document.messages[3], "video"), false);
  assert.equal(f.opens.length, 1); assert.equal(f.opens[0][0], "synthetic-token"); assert.equal(f.opens[0][1], cid); assert.equal(f.opens[0][2], third.id); assert.ok(f.opens[0][3].signal instanceof AbortSignal);
  assert.equal(f.closed, 1); assert.equal(data.hashes[`videos/${videoId}.mp4`], createHash("sha256").update(Buffer.alloc(block * 2 + 57, 0x5a)).digest("hex"));
  assert.match(data.html, /<video controls preload="metadata" src="videos\/[a-f0-9]{32}\.mp4">/); assert.match(data.html, /media-src 'self' file:/);
  assert.match(data.html, /&lt;script&gt;literal&lt;\/script&gt;/); assert.match(data.html, /&lt;Client &amp; synthetic&gt;/);
  assert.doesNotMatch(data.html + JSON.stringify(data.document), /https?:|contentUrl|storageKey|Never-export-login/); assert.doesNotMatch(data.html, /<script>/); assert.match(data.readme, /originals/);
});

test("omitted originals remain explicit placeholders and never open photo or video readers", async (t) => {
  const m = message(1, { video: videoMetadata(id(101)), body: "" }), f = fixture({ pages: [page([m])] });
  const prepared = await f.create({ includeVideos: false, includePhotos: false }), data = await inspect(t, await collect(prepared));
  assert.equal(f.opens.length, 0); assert.equal(f.photoBuffers.length, 0); assert.equal(data.names.length, 3);
  assert.deepEqual(data.document.messages[0].video, { file: null, bytes: block * 2 + 57, mime: "video/mp4" });
  assert.equal(data.document.includeVideos, false); assert.equal(data.document.messages[0].body, ""); assert.match(data.html, /Video not included/);
});

test("client archives use their canonical authors without exposing a private administrator identity", async (t) => {
  const own = message(1, { sender: "me", video: videoMetadata(id(101), {}, "client") });
  const f = fixture({ role: "client", pages: [page([own, message(2)], { conversation: { id: cid, client: null, peerName: "Never-export-login", latestSequence: "2" } })] });
  const data = await inspect(t, await collect(await f.create()));
  assert.equal(data.document.administrator, "Jess"); assert.equal(data.document.client, "Synthetic client"); assert.equal(data.document.messages[0].sender, "peer"); assert.equal(data.document.messages[1].sender, "me");
  assert.doesNotMatch(data.html + JSON.stringify(data.document), /Never-export-login/);
});

test("the prepared descriptor and each source respect backpressure and retain the busy slot until close settles", async () => {
  const entered = deferred(), release = deferred(); let closed = 0, chunks = 0;
  const f = fixture({ videoOpen: async () => ({ bytes: block * 2 + 57, mime: "video/mp4", stream() { return (async function* () {
    chunks++; yield Buffer.alloc(block); chunks++; yield Buffer.alloc(block); chunks++; yield Buffer.alloc(57);
  })(); }, async close() { entered.resolve(); await release.promise; closed++; } }) });
  const prepared = await f.create(), iterator = prepared.stream();
  while (!chunks) assert.equal((await iterator.next()).done, false);
  assert.equal(chunks, 1); f.advance(); await assert.rejects(f.create(), code("busy"));
  const closing = prepared.close(); assert.equal(prepared.close(), closing);
  try { await entered.promise; assert.equal(closed, 0); assert.equal(chunks, 1); await assert.rejects(f.create(), code("busy")); }
  finally { release.resolve(); }
  await closing; assert.equal(closed, 1); await iterator.return();
  const next = await f.create(); await next.close();
});

test("close before consumption and return before first next are idempotent and open no original", async () => {
  const f = fixture(), prepared = await f.create(); const closing = prepared.close(); assert.equal(prepared.close(), closing); await closing;
  assert.throws(() => prepared.stream(), code("input")); assert.equal(f.opens.length, 0);
  f.advance(); const next = await f.create(), iterator = next.stream(); await iterator.return(); assert.equal(f.opens.length, 0); await next.close();
  assert.throws(() => next.stream(), code("input"));
});

test("a delivery revoked after preparation is revalidated at open and cannot produce a complete archive", async () => {
  let allowed = true;
  const f = fixture({ videoOpen: async () => { assert.equal(allowed, false); throw Object.assign(new Error("private SQL detail"), { code: "VIDEO_NOT_FOUND" }); } });
  const prepared = await f.create(); allowed = false;
  await assert.rejects(collect(prepared), code("changed")); assert.equal(f.opens.length, 1);
  f.advance(); const retry = await f.create(); await retry.close();
});

test("invalid handle metadata and source failures close the opened original without leaking details", async () => {
  for (const kind of ["metadata", "source", "short", "long"]) {
    let closed = 0;
    const f = fixture({ videoOpen: async () => ({ bytes: kind === "metadata" ? 1 : block * 2 + 57, mime: "video/mp4",
      stream() { return (async function* () { yield Buffer.alloc(block); if (kind === "source") throw new Error("private source secret"); if (kind !== "short") { yield Buffer.alloc(block); yield Buffer.alloc(kind === "long" ? 58 : 57); } })(); }, async close() { closed++; } }) });
    await assert.rejects(collect(await f.create()), code(kind === "metadata" ? "changed" : "unavailable")); assert.equal(closed, 1, kind);
  }
});

test("abort during preparation waits for the authorized read and cancels every later original", async () => {
  const entered = deferred(), release = deferred(), controller = new AbortController();
  const f = fixture({ history: async () => { entered.resolve(); await release.promise; return page([message(1, { video: videoMetadata(id(101)) })]); } });
  const pending = f.create({ signal: controller.signal }), rejected = assert.rejects(pending, code("cancelled"));
  await entered.promise; controller.abort(); f.advance(); await assert.rejects(f.create(), code("busy")); release.resolve(); await rejected;
  assert.equal(f.opens.length, 0);
});

test("stream abort and elapsed deadline close the current handle and prevent following originals", async () => {
  for (const mode of ["signal", "elapsed"]) {
    const controller = new AbortController(); let elapsed = 0, closed = 0, chunks = 0;
    const f = fixture({ elapsed: () => elapsed, pages: [page([message(1, { video: videoMetadata(id(101)) }), message(2, { video: videoMetadata(id(102), { id: id(21) }) })])],
      videoOpen: async () => ({ bytes: block * 2 + 57, mime: "video/mp4", stream() { return (async function* () { chunks++; yield Buffer.alloc(block); chunks++; yield Buffer.alloc(block); yield Buffer.alloc(57); })(); }, async close() { closed++; } }) });
    const prepared = await f.create(), iterator = prepared.stream({ signal: controller.signal });
    while (!chunks) await iterator.next();
    if (mode === "signal") controller.abort(); else elapsed = 300001;
    await assert.rejects(iterator.next(), code("cancelled")); assert.equal(f.opens.length, 1); assert.equal(closed, 1); await prepared.close();
  }
});

test("strict message metadata, tombstones, captions, pagination and duplicate identities fail closed", async () => {
  const m = message(1, { video: videoMetadata(id(101)) });
  const invalid = [
    page([{ ...m, video: { ...m.video, contentUrl: "https://other.invalid/private" } }]), page([{ ...m, video: { ...m.video, bytes: 104857601 } }]),
    page([{ ...m, body: "x".repeat(1001) }]), page([{ ...m, body: "\u200b" }]), page([{ ...m, media: {} }]),
    page([{ ...m, body: null, deletedAt: now }]), page([{ ...m, sequence: "01" }]), page([m, m]),
    page([m, message(2, { video: videoMetadata(id(102), { bytes: 2 }) })]),
    page([m], { hasMoreBefore: true, nextBefore: "2" }), page([m], { conversation: { id: id(99), client: { id: clientId, pseudonym: "X" }, peerName: "X", latestSequence: "1" } }),
  ];
  for (const p of invalid) { const f = fixture({ pages: [p] }); await assert.rejects(f.create(), ConversationExportError); assert.equal(f.opens.length, 0); }
  const f = fixture(); for (const options of [{ includePhotos: undefined }, { includeVideos: undefined }, { includeVideos: 1 }, { expectedClientId: id(99) }]) await assert.rejects(f.create(options), ConversationExportError);
});

test("document, photo, archive and message limits reject before any video is opened", async () => {
  for (const limits of [{ textBytes: 100 }, { archiveBytes: 1000 }, { messages: 1 }]) {
    const f = fixture({ limits, pages: [page([message(1, { video: videoMetadata(id(101)) }), message(2)])] }); await assert.rejects(f.create(), code("limit")); assert.equal(f.opens.length, 0);
  }
  const media = { id: id(30), sharedHere: true, bytes: jpeg.length, width: 12, height: 8 };
  const f = fixture({ limits: { photoBytes: 1 }, pages: [page([message(1, { media })])] }); await assert.rejects(f.create(), code("limit")); assert.equal(f.photoBuffers.length, 0);
  const documents = fixture({ limits: { textBytes: 6000 }, pages: [page([message(1, { body: "x".repeat(2000) })])] });
  await assert.rejects(documents.create(), code("limit"), "the three individually small documents share one memory budget");
  for (const limits of [{ archiveBytes: 268435457 }, { milliseconds: 300001 }, { textBytes: 0 }, { unknown: 1 }]) assert.throws(() => fixture({ limits }), TypeError);
  assert.equal(STREAMING_CONVERSATION_EXPORT_LIMITS.photoBytes, 32 * 1024 * 1024);
});

test("a maximum-size original is budgeted without opening or allocating its body during preparation", async () => {
  const f = fixture({ pages: [page([message(1, { video: videoMetadata(id(101), { bytes: 104857600 }) })])] });
  const prepared = await f.create(); assert.ok(prepared.bytes > 104857600); assert.ok(prepared.bytes < f.exporter.maxBytes);
  assert.equal(f.opens.length, 0); assert.equal(f.chunks, 0); await prepared.close();
});

test("a ZIP output received after the deadline is wiped when the factory cannot hand it over", async () => {
  const plaintext = Buffer.alloc(block, 0x79); let elapsed = 0, undelivered, closed = 0;
  const f = fixture({ elapsed: () => elapsed, videoOpen: async () => ({ bytes: block * 2 + 57, mime: "video/mp4",
    stream() { return (async function* () { yield plaintext; yield Buffer.alloc(block); yield Buffer.alloc(57); })(); }, async close() { closed++; } }) });
  const prepared = await f.create(), originalFrom = Buffer.from;
  Buffer.from = function (value, ...args) {
    const copy = Reflect.apply(originalFrom, Buffer, [value, ...args]);
    if (value === plaintext) { undelivered = copy; elapsed = 300001; }
    return copy;
  };
  try { await assert.rejects(collect(prepared), code("cancelled")); }
  finally { Buffer.from = originalFrom; await prepared.close(); }
  assert.ok(undelivered); assert.equal(undelivered.every((byte) => byte === 0), true); assert.equal(closed, 1);
});

test("return closes a blocked source before awaiting its pending next and holds busy until real cleanup", async () => {
  const reading = deferred(), readReleased = deferred(), closeEntered = deferred(), closeReleased = deferred(); let closed = 0;
  const f = fixture({ videoOpen: async (_token, _cid, _mid, { signal }) => ({ bytes: block * 2 + 57, mime: "video/mp4",
    stream() { return (async function* () { reading.resolve(); await readReleased.promise; if (signal.aborted) throw new Error("synthetic cancelled read"); yield Buffer.alloc(block); yield Buffer.alloc(block); yield Buffer.alloc(57); })(); },
    async close() { closeEntered.resolve(); await closeReleased.promise; closed++; readReleased.resolve(); } }) });
  const prepared = await f.create(), iterator = prepared.stream();
  let pending;
  while (!pending) {
    const next = iterator.next();
    const result = await Promise.race([next.then((value) => ({ value })), reading.promise.then(() => ({ reading: true }))]);
    if (result.reading) pending = next; else assert.equal(result.value.done, false);
  }
  const cancelled = assert.rejects(pending, code("cancelled")), returned = iterator.return();
  try { await closeEntered.promise; f.advance(); assert.equal(closed, 0); await assert.rejects(f.create(), code("busy")); }
  finally { closeReleased.resolve(); }
  await cancelled; assert.equal((await returned).done, true); assert.equal(closed, 1);
  const next = await f.create(); await next.close();
});
