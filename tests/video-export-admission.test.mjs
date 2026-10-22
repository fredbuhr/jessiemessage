import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createVideoService } from "../server/video/service.mjs";
import { videoStoredBytes } from "../server/video/storage.mjs";
import { createStreamingConversationExporter } from "../server/chat/streaming-conversation-export.mjs";
import { newToken, tokenDigest } from "../server/auth/crypto.mjs";

const now = Date.UTC(2026, 9, 22, 12), cid = "a".repeat(32), clientId = "b".repeat(32);
const hex = value => value.toString(16).padStart(32, "0");
const failure = code => Object.assign(new Error("Synthetic private failure"), { code });
async function fixture() {
  const ownerId = Buffer.alloc(16, 1), key = randomBytes(32), token = newToken(), rawBytes = 16;
  const state = { active: true, allowed: true, rateCalls: 0, reads: 0, closes: 0, abortAfterChunk: null };
  const buckets = new Map();
  const actor = role => {
    if (!state.active) throw failure("CHAT_UNAUTHORIZED");
    return { user: { id: ownerId.toString("hex"), role, pseudonym: "Synthetic" }, expiresAt: now + 60000 };
  };
  const service = await createVideoService({ key, clock: () => now, minimumFreeBytes: 0,
    store: Object.fromEntries(["reserve", "commit", "getOwned", "release"].map(name => [name, async () => { throw Error("Unexpected " + name); }])),
    chatService: { async actor(role, raw) { if (raw !== token) throw failure("CHAT_UNAUTHORIZED"); return actor(role); }, async sendVideo() {} },
    messages: { async gallery() {}, async getMessageAsset(request) {
      actor(request.role);
      if (!state.allowed || request.conversationId.toString("hex") !== cid || !request.tokenHash.equals(tokenDigest(token))) throw failure("CHAT_NOT_FOUND");
      return { id: request.messageId, ownerId, storageKey: Buffer.alloc(32, 5), digest: Buffer.alloc(32, 6),
        bytes: rawBytes, storedBytes: videoStoredBytes(rawBytes), mime: "video/mp4", deletedAt: null, createdAt: now - 1000 };
    } },
    authStore: { async consumeRateLimit(bucket, { limit }) {
      state.rateCalls++; const name = bucket.toString("hex"), count = (buckets.get(name) ?? 0) + 1;
      buckets.set(name, count); return { allowed: count <= limit, retryAfter: 60 };
    } },
    storage: { async put() {}, async availableSpace() { return { availableBytes: 100000n }; }, async open() {
      state.reads++; let closed = false;
      return { bytes: rawBytes, storedBytes: videoStoredBytes(rawBytes), async *stream() {
        yield Buffer.alloc(rawBytes / 2); state.abortAfterChunk?.abort(); yield Buffer.alloc(rawBytes / 2);
      }, async close() { if (!closed) { closed = true; state.closes++; } } };
    } },
  });
  const messages = Array.from({ length: 121 }, (_, index) => ({ id: hex(index + 1), sequence: String(index + 1), sender: "me",
    body: "", createdAt: now - 500, deletedAt: null, video: { id: hex(index + 1), bytes: rawBytes,
      mime: "video/mp4", contentUrl: `/api/video/admin/conversations/${cid}/messages/${hex(index + 1)}/content` } }));
  const exporter = createStreamingConversationExporter({ clock: () => now,
    history: async (_token, _id, { before }) => ({ conversation: { id: cid, client: { id: clientId, pseudonym: "Synthetic" }, peerName: "Synthetic", latestSequence: "121" },
      messages: before === null ? messages.slice(21) : messages.slice(0, 21), hasMoreBefore: before === null, nextBefore: before === null ? "22" : null }),
    video: (...args) => service.openExportMessage("admin", ...args),
  });
  return { state, service, token, exporter, async archive() { return exporter.create({ token, conversationId: cid,
    expectedClientId: clientId, includePhotos: false, includeVideos: true }); } };
}
async function consume(handle) { let bytes = 0; try { for await (const chunk of handle.stream()) bytes += chunk.length; } finally { await handle.close(); } return bytes; }

test("a 121-original video archive completes without spending the ordinary display quota", async () => {
  const f = await fixture(), archive = await f.archive(), chunks = [];
  try { for await (const chunk of archive.stream()) chunks.push(chunk); } finally { await archive.close(); }
  const zip = Buffer.concat(chunks);
  assert.equal(zip.length, archive.bytes); assert.equal(zip.readUInt32LE(zip.length - 22), 0x06054b50);
  assert.equal(f.state.reads, 121); assert.equal(f.state.closes, 121); assert.equal(f.state.rateCalls, 0);
  for (let index = 0; index < 120; index++) assert.equal(await consume(await f.service.openMessage("admin", f.token, cid, hex(1))), 16);
  await assert.rejects(f.service.openMessage("admin", f.token, cid, hex(1)), error => error.code === "VIDEO_RATE_LIMIT");
});

test("the export reader retains live session and message authorization before opening an original", async () => {
  const f = await fixture(); f.state.allowed = false;
  await assert.rejects(f.service.openExportMessage("admin", f.token, cid, hex(1)), error => error.code === "CHAT_NOT_FOUND");
  f.state.allowed = true; f.state.active = false;
  await assert.rejects(f.service.openExportMessage("admin", f.token, cid, hex(1)), error => error.code === "CHAT_UNAUTHORIZED");
  assert.equal(f.state.reads, 0); assert.equal(f.state.rateCalls, 0);
});

test("revocation after archive preparation prevents original delivery and leaves no complete ZIP", async () => {
  const f = await fixture(), archive = await f.archive(); f.state.active = false;
  await assert.rejects(async () => { for await (const _chunk of archive.stream()) {} }, error => error.code === "unauthorized");
  await archive.close(); assert.equal(f.state.reads, 0);
});

test("cancellation of an export original closes its handle and preserves ordinary read admission", async () => {
  const f = await fixture(), controller = new AbortController(); f.state.abortAfterChunk = controller;
  const handle = await f.service.openExportMessage("admin", f.token, cid, hex(1), { signal: controller.signal });
  await assert.rejects(async () => { for await (const _chunk of handle.stream()) {} }, error => error.code === "VIDEO_INPUT");
  await handle.close(); assert.equal(f.state.closes, 1);
  f.state.abortAfterChunk = null;
  assert.equal(await consume(await f.service.openMessage("admin", f.token, cid, hex(1))), 16);
  assert.equal(f.state.closes, 2);
});
