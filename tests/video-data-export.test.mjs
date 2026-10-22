import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { DataExportError, exportClientContent } from "../server/data/export.mjs";
import { encryptMessageBody, messageFingerprint, videoMessageFingerprint } from "../server/chat/crypto.mjs";
import { MAX_VIDEO_BYTES, VIDEO_BLOCK_BYTES, videoStoredBytes } from "../server/video/storage.mjs";
import { videoFixture } from "./helpers/video-transport-fixture.mjs";

const NOW = Date.UTC(2026, 9, 21, 12), sql = value => new Date(value).toISOString().replace("T", " ").replace("Z", "000");
const id = value => Buffer.from(value.toString(16).padStart(32, "0"), "hex"), hex = value => value.toString("hex");
const sha = value => createHash("sha256").update(value).digest();
const unavailable = error => error instanceof DataExportError && error.code === "DATA_EXPORT_UNAVAILABLE"
  && error.cause === undefined && !/secret|SQL|password|example\.invalid|storage/i.test(error.message);
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function* blocks(bytes, seed, chunkBytes = 16381) {
  for (let offset = 0; offset < bytes; offset += chunkBytes) yield Buffer.alloc(Math.min(chunkBytes, bytes - offset), seed);
}
function generatedDigest(bytes, seed) { const hash = createHash("sha256"); for (const block of blocks(bytes, seed)) hash.update(block); return hash.digest(); }

function fixture() {
  const clientId = id(1), adminId = id(2), messageKey = randomBytes(32);
  const account = { id: clientId, role: "client", status: "active", pseudonym: "Client synthétique", email: "client@example.invalid",
    createdAt: sql(NOW - 60000), updatedAt: sql(NOW - 1000), emailVerifiedAt: sql(NOW - 55000), ageDeclaredAt: sql(NOW - 60000),
    ageAssuredAt: null, accessApprovedAt: sql(NOW - 45000), accessExpiresAt: sql(NOW + 86400000), passwordHash: "private-secret-password" };
  const conversation = { id: id(10), clientId, adminId, peerName: "Jess", createdAt: sql(NOW - 45000), closedAt: null,
    lastReadSequence: "2", peerReadSequence: "18446744073709551615", adminEmail: "private-secret-admin@example.invalid" };
  const state = { messages: [], ownMedia: [], ownVideos: [], objects: new Map(), photos: new Map(), opens: [], handles: [], pages: [], writes: [],
    producedBytes: 0, producedChunks: 0, sourceReturns: 0, finalized: false, captureChunks: false, captured: [] };
  const output = { json: new Map(), lines: new Map(), media: new Map(), videos: new Map() };
  function video(value, ownerId = adminId, bytes = VIDEO_BLOCK_BYTES + 37) {
    const seed = value % 251, storageKey = randomBytes(32);
    const raw = { id: id(value), ownerId, ownerRole: ownerId.equals(clientId) ? "client" : "admin", storageKey,
      digest: generatedDigest(bytes, seed), bytes, storedBytes: videoStoredBytes(bytes), mime: "video/mp4", state: "committed", deletedAt: null,
      createdAt: sql(NOW - 35000), reserveTokenHash: "private-secret-reservation", ciphertext: "private-secret-ciphertext" };
    state.objects.set(hex(storageKey), { bytes, seed, stream: null }); return raw;
  }
  function photo(value, ownerId = clientId) {
    const payload = Buffer.from([0xff, 0xd8, 0xff, 0xe0, value % 251, 0xff, 0xd9]), assetId = id(value), storageKey = randomBytes(32);
    state.photos.set(hex(storageKey), payload);
    return { id: assetId, ownerId, ownerRole: ownerId.equals(clientId) ? "client" : "admin", storageKey, digest: sha(payload),
      width: 200, height: 100, fullBytes: payload.length, deletedAt: null, journalState: "registered", journalAssetId: assetId, journalOwnerId: ownerId };
  }
  function reseal(row, body, typed = row.video !== undefined && row.video !== null) {
    const binding = { messageId: row.id, conversationId: row.conversationId, senderId: row.senderId };
    row.encrypted = encryptMessageBody(body, messageKey, binding);
    row.fingerprint = (typed ? videoMessageFingerprint : messageFingerprint)(body, messageKey, binding); return row;
  }
  function message(value, sequence, { video = null, caption = "", body, senderRole = "client", media = null } = {}) {
    const row = { id: id(value), conversationId: conversation.id, senderId: senderRole === "client" ? clientId : adminId, senderRole,
      sequence: String(sequence), createdAt: sql(NOW - 30000), deletedAt: null, media, video, secret: "private-secret-retry" };
    return reseal(row, body ?? (video ? JSON.stringify({ videoId: hex(video.id), caption }) : "Texte privé littéral"));
  }
  function library(kind, rows, { afterId, limit }) {
    state.pages.push({ kind, afterId: afterId === null ? null : Buffer.from(afterId), limit });
    const eligible = rows.filter(row => afterId === null || Buffer.compare(row.id, afterId) > 0), selected = eligible.slice(0, limit);
    return { rows: selected, hasMore: eligible.length > limit, nextCursor: eligible.length > limit ? selected.at(-1).id : null };
  }
  const reader = { account, conversation, preference: { enabled: true, updatedAt: sql(NOW - 20000) },
    async messages({ afterSequence, limit }) {
      state.pages.push({ kind: "messages", afterSequence, limit });
      const eligible = state.messages.filter(row => BigInt(row.sequence) > BigInt(afterSequence)), rows = eligible.slice(0, limit);
      return { rows, hasMore: eligible.length > limit, nextCursor: eligible.length > limit ? rows.at(-1).sequence : null };
    },
    async ownMedia(query) { return library("ownMedia", state.ownMedia, query); },
    async ownVideos(query) { return library("ownVideos", state.ownVideos, query); },
  };
  const storage = { async get({ storageKey }) { const value = state.photos.get(hex(storageKey)); if (!value) throw Error("private-secret-storage"); return Buffer.from(value); } };
  const videoStorage = { async open(input) {
    state.opens.push(input); const record = state.objects.get(hex(input.storageKey)); if (!record) throw Error("private-secret-video-storage");
    const track = { closes: 0, streams: 0, signal: undefined }; state.handles.push(track);
    return { bytes: record.bytes, storedBytes: videoStoredBytes(record.bytes),
      stream({ signal } = {}) {
        track.streams++; track.signal = signal;
        if (record.stream) return record.stream({ signal });
        return (async function* () {
          try { for (const chunk of blocks(record.bytes, record.seed)) { state.producedBytes += chunk.length; state.producedChunks++; if (state.captureChunks) state.captured.push(chunk); yield chunk; } }
          finally { state.sourceReturns++; }
        })();
      }, async close() { track.closes++; } };
  } };
  const writer = {
    async empty(name) { state.writes.push(["empty", name]); output.lines.set(name, []); },
    async json(name, value) { state.writes.push(["json", name]); output.json.set(name, structuredClone(value)); },
    async line(name, value) { state.writes.push(["line", name]); output.lines.get(name).push(structuredClone(value)); },
    async media(name, value) { state.writes.push(["media", name]); output.media.set(name, Buffer.from(value)); },
    async video(name, source, options) {
      state.writes.push(["video", name, options]); const chunks = [];
      for await (const chunk of source) chunks.push(Buffer.from(chunk)); output.videos.set(name, Buffer.concat(chunks));
    },
    finalize() { state.finalized = true; },
  };
  const legacyReader = { ...reader }; delete legacyReader.ownVideos;
  return { clientId, adminId, messageKey, account, conversation, state, output, video, photo, message, reseal, reader, legacyReader, storage, videoStorage, writer,
    record: raw => state.objects.get(hex(raw.storageKey)),
    run: (changes = {}) => exportClientContent({ reader, writer, clientId, now: NOW, messageKey, storage, videoStorage, ...changes }) };
}

test("video exports are opt-in, retain the legacy v1 shape and require complete streaming dependencies", async () => {
  const legacy = fixture(), row = legacy.message(101, 1); delete row.video; legacy.state.messages = [row];
  const counts = await legacy.run({ videoStorage: null, reader: legacy.legacyReader });
  assert.equal(legacy.output.json.get("account.json").version, 1); assert.equal(Object.hasOwn(counts, "videoFiles"), false);
  assert.equal(Object.hasOwn(legacy.output.lines.get("messages.jsonl")[0], "video"), false);
  const current = fixture(); current.state.messages = [current.message(101, 1)]; delete current.state.messages[0].video;
  assert.equal((await current.run()).videoFiles, 0); assert.equal(current.output.json.get("account.json").version, 2);
  assert.equal(current.output.lines.get("messages.jsonl")[0].video, null);
  const live = fixture(), attached = live.video(201); live.state.messages = [live.message(101, 1, { video: attached, senderRole: "admin" })];
  await assert.rejects(live.run({ videoStorage: null, reader: live.legacyReader }), unavailable); assert.equal(live.state.opens.length, 0);
  for (const alter of [f => ({ reader: { ...f.reader, ownVideos: undefined } }), f => ({ writer: { ...f.writer, video: null } }),
    () => ({ videoStorage: {} }), () => ({ signal: {} })]) {
    const f = fixture(); await assert.rejects(f.run(alter(f)), unavailable); assert.equal(f.state.writes.length, 0);
  }
});

test("v2 exports deduplicate delivered and owned videos while counting photos and videos together", async () => {
  const f = fixture(), received = f.video(201), own = f.video(202, f.clientId, 19), unused = f.video(203, f.clientId, 35), photo = f.photo(204);
  f.state.captureChunks = true;
  f.state.messages = [f.message(101, 1), f.message(102, 2, { video: received, senderRole: "admin", caption: "Légende 👋 <b>littérale</b>" }),
    f.message(103, 3, { video: received, senderRole: "admin", caption: "" }), f.message(104, 4, { video: own, caption: "Mon original" })];
  f.state.ownMedia = [photo]; f.state.ownVideos = [own, unused];
  const bytes = received.bytes + own.bytes + unused.bytes, counts = await f.run();
  assert.deepEqual(counts, { messages: 4, mediaFiles: 4, libraryItems: 3, mediaBytes: bytes + 7, rows: 7,
    videoFiles: 3, videoBytes: bytes, videoLibraryItems: 2 });
  const messages = f.output.lines.get("messages.jsonl"); assert.equal(messages[0].video, null); assert.equal(messages[1].body, "Légende 👋 <b>littérale</b>"); assert.equal(messages[2].body, "");
  assert.deepEqual(messages[1].video, { file: `media/${hex(received.id)}.mp4`, type: "video/mp4", bytes: received.bytes });
  assert.deepEqual(messages[2].video, messages[1].video); assert.equal(messages[1].media, null);
  assert.deepEqual(f.output.lines.get("library.jsonl").map(row => row.file), [`media/${hex(photo.id)}.jpg`, `media/${hex(own.id)}.mp4`, `media/${hex(unused.id)}.mp4`]);
  assert.equal(f.state.opens.length, 3); assert.ok(f.state.handles.every(handle => handle.closes >= 1));
  assert.ok(f.state.captured.length > 0); assert.ok(f.state.captured.every(chunk => chunk.every(byte => byte === 0)));
  const all = JSON.stringify([...f.output.json.values(), ...f.output.lines.values()]);
  assert.doesNotMatch(all, /secret|password|token|fingerprint|digest|storageKey|ciphertext|adminEmail|ownerId|ownerRole/i);
  assert.equal(f.output.json.get("account.json").conversation.peerReadSequence, "0");
  for (const raw of [received, own, unused]) assert.deepEqual(sha(f.output.videos.get(`media/${hex(raw.id)}.mp4`)), raw.digest);
});

test("an actual multi-block GCM object exports the exact authenticated original", async t => {
  const f = fixture(), raw = f.video(201, f.clientId, VIDEO_BLOCK_BYTES * 2 + 17), storage = await videoFixture(t), record = f.record(raw);
  const saved = await storage.storage.put({ assetId: raw.id, storageKey: raw.storageKey, bytes: raw.bytes,
    source: (async function* () { yield* blocks(record.bytes, record.seed); })() });
  assert.deepEqual(saved.digest, raw.digest); f.state.ownVideos = [raw];
  const counts = await f.run({ videoStorage: storage.storage });
  assert.equal(counts.videoBytes, raw.bytes); assert.deepEqual(sha(f.output.videos.get(`media/${hex(raw.id)}.mp4`)), raw.digest);
});

test("tombstones export no video and foreign bindings cannot broaden selected client content", async () => {
  const f = fixture(), retained = f.video(201), deleted = f.message(101, 1, { video: retained, senderRole: "admin" });
  deleted.encrypted = null; deleted.video = null; deleted.deletedAt = sql(NOW - 1000); f.state.messages = [deleted];
  const counts = await f.run(); assert.equal(counts.videoFiles, 0); assert.equal(f.state.opens.length, 0);
  assert.deepEqual(f.output.lines.get("messages.jsonl")[0].video, null); assert.equal(f.output.lines.get("messages.jsonl")[0].body, null);
  for (const kind of ["foreign-library", "foreign-conversation", "foreign-sender", "tombstone-attachment"]) {
    const current = fixture(), raw = current.video(201), row = current.message(101, 1, { video: raw, senderRole: "admin" });
    if (kind === "foreign-library") current.state.ownVideos = [raw]; else current.state.messages = [row];
    if (kind === "foreign-conversation") row.conversationId = id(999);
    if (kind === "foreign-sender") row.senderId = id(999);
    if (kind === "tombstone-attachment") { row.encrypted = null; row.deletedAt = sql(NOW - 1000); }
    await assert.rejects(current.run(), unavailable, kind); assert.equal(current.state.opens.length, 0, kind);
  }
});

test("typed video HMAC, exact canonical payload and the current delivery link are all mandatory", async () => {
  for (const kind of ["text-fingerprint", "missing-link", "photo-and-video", "wrong-id", "extra-key", "reordered", "duplicate-key", "long-caption", "invisible-caption"]) {
    const f = fixture(), raw = f.video(201), row = f.message(101, 1, { video: raw, senderRole: "admin", caption: "Caption" }); f.state.messages = [row];
    const payload = { videoId: hex(raw.id), caption: "Caption" };
    if (kind === "text-fingerprint") f.reseal(row, JSON.stringify(payload), false);
    if (kind === "missing-link") row.video = null;
    if (kind === "photo-and-video") row.media = f.photo(202, f.adminId);
    if (kind === "wrong-id") f.reseal(row, JSON.stringify({ ...payload, videoId: hex(id(999)) }));
    if (kind === "extra-key") f.reseal(row, JSON.stringify({ ...payload, ownerId: hex(f.adminId) }));
    if (kind === "reordered") f.reseal(row, JSON.stringify({ caption: payload.caption, videoId: payload.videoId }));
    if (kind === "duplicate-key") f.reseal(row, `{"videoId":"${payload.videoId}","caption":"first","caption":"last"}`);
    if (kind === "long-caption") f.reseal(row, JSON.stringify({ ...payload, caption: "x".repeat(1001) }));
    if (kind === "invisible-caption") f.reseal(row, JSON.stringify({ ...payload, caption: "\u200b" }));
    await assert.rejects(f.run(), unavailable, kind); assert.equal(f.state.opens.length, 0, kind);
  }
  const literal = fixture(), text = JSON.stringify({ videoId: hex(id(201)), caption: "A literal text" });
  literal.state.messages = [literal.message(101, 1, { body: text })]; await literal.run();
  assert.equal(literal.output.lines.get("messages.jsonl")[0].body, text); assert.equal(literal.output.lines.get("messages.jsonl")[0].video, null);
});

test("video metadata requires exact owner, private bindings, types, lifetime and encrypted charge before opening", async () => {
  const changes = [{ id: "not-a-buffer" }, { ownerId: id(999) }, { ownerRole: "client" }, { storageKey: Buffer.alloc(31) }, { digest: Buffer.alloc(31) },
    { bytes: 0 }, { bytes: "1" }, { bytes: MAX_VIDEO_BYTES + 1 }, { storedBytes: 1 }, { mime: "image/jpeg" }, { state: "reserved" },
    { deletedAt: sql(NOW - 1000) }, { createdAt: NOW - 35000 }, { createdAt: sql(NOW + 1) }, { createdAt: sql(NOW - 10000) }];
  for (const change of changes) {
    const f = fixture(), raw = f.video(201), row = f.message(101, 1, { video: raw, senderRole: "admin" });
    Object.assign(raw, change); f.state.messages = [row]; await assert.rejects(f.run(), unavailable); assert.equal(f.state.opens.length, 0);
  }
});

test("malformed handles, SHA mismatch, truncated, excess and unbounded chunks fail privately and close the handle", async () => {
  for (const kind of ["handle-bytes", "handle-charge", "digest", "short", "long", "large-chunk", "empty-chunk", "non-buffer", "source-error"]) {
    const f = fixture(), raw = f.video(201, f.clientId, VIDEO_BLOCK_BYTES + 1), record = f.record(raw); f.state.ownVideos = [raw];
    const original = f.videoStorage.open;
    if (kind === "handle-bytes" || kind === "handle-charge") f.videoStorage.open = async input => ({ ...await original(input), ...(kind === "handle-bytes" ? { bytes: raw.bytes + 1 } : { storedBytes: raw.storedBytes + 1 }) });
    if (kind === "digest") raw.digest = Buffer.alloc(32);
    if (["short", "long"].includes(kind)) record.stream = async function* () { yield* blocks(record.bytes + (kind === "short" ? -1 : 1), record.seed); };
    if (kind === "large-chunk") record.stream = async function* () { yield Buffer.alloc(VIDEO_BLOCK_BYTES + 1, record.seed); };
    if (kind === "empty-chunk") record.stream = async function* () { yield Buffer.alloc(0); };
    if (kind === "non-buffer") record.stream = async function* () { yield "private-secret"; };
    if (kind === "source-error") record.stream = async function* () { yield Buffer.alloc(1); throw Error("private-secret-SQL-storage"); };
    await assert.rejects(f.run(), unavailable, kind); assert.equal(f.state.handles.length, 1, kind); assert.ok(f.state.handles[0].closes >= 1, kind);
    assert.equal(f.state.finalized, false);
  }
});

test("writer failure or incomplete consumption closes the source without accepting a partial copy", async () => {
  for (const kind of ["before-read", "after-first", "early-success"]) {
    const f = fixture(), raw = f.video(201, f.clientId); f.state.ownVideos = [raw];
    f.state.captureChunks = true;
    const writer = { ...f.writer, async video(_name, source) {
      if (kind === "before-read") throw Error("private-secret-writer");
      await source.next(); if (kind !== "early-success") throw Error("private-secret-writer");
    } };
    await assert.rejects(f.run({ writer }), unavailable, kind); assert.ok(f.state.handles[0].closes >= 1);
    if (kind !== "before-read") assert.equal(f.state.sourceReturns, 1);
    assert.ok(f.state.captured.every(chunk => chunk.every(byte => byte === 0)));
    assert.equal(f.state.finalized, false);
  }
});

test("abort before output and during an awaited video copy remains private and closes current work", async () => {
  const early = fixture(), aborted = new AbortController(); aborted.abort();
  await assert.rejects(early.run({ signal: aborted.signal }), unavailable); assert.equal(early.state.writes.length, 0); assert.equal(early.state.opens.length, 0);
  const f = fixture(), raw = f.video(201, f.clientId), controller = new AbortController(); f.state.ownVideos = [raw];
  f.state.captureChunks = true;
  const writer = { ...f.writer, async video(_name, source, options) {
    assert.equal(options.signal, controller.signal); for await (const chunk of source) { assert.ok(chunk.length > 0); controller.abort(); }
  } };
  await assert.rejects(f.run({ writer, signal: controller.signal }), unavailable);
  assert.equal(f.state.handles[0].signal, controller.signal); assert.ok(f.state.handles[0].closes >= 1); assert.equal(f.state.sourceReturns, 1);
  assert.ok(f.state.captured.length > 0); assert.ok(f.state.captured.every(chunk => chunk.every(byte => byte === 0)));
});

test("a maximum-size lazy video honors writer backpressure and is hashed without retaining its original", { timeout: 10000 }, async t => {
  const f = fixture(), raw = f.video(201, f.clientId, MAX_VIDEO_BYTES), first = deferred(), gate = deferred(); f.state.ownVideos = [raw];
  let total = 0, maximum = 0, digest, firstChunk; const preservedKey = Buffer.from(f.messageKey);
  const writer = { ...f.writer, async video(name, source, options) {
    assert.equal(name, `media/${hex(raw.id)}.mp4`); assert.equal(options.bytes, MAX_VIDEO_BYTES); const hash = createHash("sha256");
    for await (const chunk of source) {
      maximum = Math.max(maximum, chunk.length); total += chunk.length; hash.update(chunk);
      if (total === chunk.length) { firstChunk = chunk; first.resolve(); await gate.promise; }
    }
    digest = hash.digest();
  } };
  t.after(() => gate.resolve()); const task = f.run({ writer }); let counts;
  try {
    await Promise.race([first.promise, task.then(() => { throw Error("Export finished before its first streamed write."); })]);
    assert.ok(f.state.producedBytes <= VIDEO_BLOCK_BYTES); assert.equal(f.state.producedChunks, 1);
    assert.ok(firstChunk.some(byte => byte !== 0), "plaintext remains valid until its awaited writer resumes");
    assert.ok(f.state.producedBytes < MAX_VIDEO_BYTES); assert.equal(f.output.videos.size, 0);
  } finally { gate.resolve(); counts = await task; }
  assert.equal(total, MAX_VIDEO_BYTES); assert.ok(maximum <= VIDEO_BLOCK_BYTES); assert.deepEqual(digest, raw.digest);
  assert.equal(counts.mediaBytes, MAX_VIDEO_BYTES); assert.equal(counts.videoBytes, MAX_VIDEO_BYTES);
  assert.ok(firstChunk.every(byte => byte === 0));
  assert.ok(f.state.handles[0].closes >= 1); assert.deepEqual(f.messageKey, preservedKey);
});

test("video libraries page by exact binary ids and share the total row and media byte budgets", async () => {
  const f = fixture(); f.state.ownVideos = Array.from({ length: 101 }, (_, index) => f.video(1000 + index, f.clientId, 1));
  f.state.messages = [f.message(101, "9007199254740993", { video: f.state.ownVideos[0] })];
  const counts = await f.run(); assert.equal(counts.videoFiles, 101); assert.equal(counts.videoLibraryItems, 101); assert.equal(counts.rows, 102);
  assert.equal(f.output.lines.get("messages.jsonl")[0].sequence, "9007199254740993");
  assert.deepEqual(f.state.pages.filter(page => page.kind === "ownVideos"), [{ kind: "ownVideos", afterId: null, limit: 100 }, { kind: "ownVideos", afterId: id(1099), limit: 100 }]);
  for (const limits of [{ maxRows: 1 }, { maxMediaBytes: 16 }]) {
    const current = fixture(), raw = current.video(201, current.clientId, 10); current.state.ownVideos = [raw, current.video(202, current.clientId, 10)];
    await assert.rejects(current.run({ limits }), unavailable); assert.equal(current.state.opens.length, 1);
  }
});

test("duplicate video identities with changed metadata and malformed library pages cannot complete", async () => {
  const f = fixture(), raw = f.video(201, f.clientId, 17); f.state.messages = [f.message(101, 1, { video: raw })];
  f.state.ownVideos = [{ ...raw, createdAt: sql(NOW - 34000) }];
  await assert.rejects(f.run(), unavailable); assert.equal(f.state.opens.length, 1);
  for (const page of [{ rows: [], hasMore: true, nextCursor: id(201) }, { rows: [], hasMore: false, nextCursor: id(201) },
    { rows: [], hasMore: "yes", nextCursor: null }]) {
    const current = fixture(); current.reader.ownVideos = async () => page;
    await assert.rejects(current.run(), unavailable); assert.equal(current.state.opens.length, 0);
  }
});
