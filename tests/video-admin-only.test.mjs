import test from "node:test";
import assert from "node:assert/strict";
import { createVideoStore } from "../server/video/store.mjs";
import { createVideoMessageStore } from "../server/video/message-store.mjs";
import { imageFormat } from "../server/media/image.mjs";
import { mp4Prefix } from "./helpers/video-transport-fixture.mjs";
import { videoStoredBytes } from "../server/video/storage.mjs";

const id = value => Buffer.alloc(16, value), hash = value => Buffer.alloc(32, value);
const request = { role: "client", tokenHash: hash(1), now: Date.UTC(2026, 9, 23) };
const code = expected => error => error.code === expected;

test("the authenticated client principal cannot reserve or commit video capacity through the persistence adapter", async () => {
  let authorizations = 0, operations = 0;
  const pool = { async getConnection() { assert.fail("No independent transaction expected"); } };
  const connection = { async query() { operations++; assert.fail("No capacity lookup or mutation may occur"); } };
  const chatStore = { async withActor(value, operation) {
    assert.equal(value.role, "client"); assert.equal(value.tokenHash, request.tokenHash); authorizations++;
    return operation(connection, { actor: { id: id(1), role: "client" }, now: value.now });
  } };
  const store = createVideoStore({ pool, chatStore, capacity: { ownerBytes: 1000000, totalBytes: 2000000, rootFingerprint: hash(2) } });
  const asset = { id: id(3), storageKey: hash(4), bytes: 100, storedBytes: videoStoredBytes(100), mime: "video/mp4" };
  await assert.rejects(store.reserve({ ...request, asset }), code("VIDEO_ADMIN_ONLY"));
  await assert.rejects(store.commit({ ...request, asset: { ...asset, digest: hash(5) } }), code("VIDEO_ADMIN_ONLY"));
  assert.equal(authorizations, 2); assert.equal(operations, 0);
});

test("the video message adapter blocks an authenticated client before the ordinary append or asset lookup", async () => {
  let authorizations = 0, appends = 0, lookups = 0;
  const store = createVideoMessageStore({
    pool: { async getConnection() { assert.fail("No separate transaction expected"); } },
    chatStore: {
      async withConversation() { assert.fail("No read expected"); },
      async withConversationAppend(value, operation) {
        authorizations++;
        return operation({ async query() { assert.fail("No video binding write expected"); } },
          { actor: { id: id(1), role: "client" }, conversation: { id: value.conversationId }, now: value.now },
          () => { appends++; assert.fail("No message may be appended"); });
      },
    },
    videoStore: { async assertSchema() {}, async getCommittedAsset() { lookups++; assert.fail("No video lookup expected"); },
      async getCommittedAssets() { lookups++; assert.fail("No video batch expected"); } },
  });
  await assert.rejects(store.sendMessage({ ...request, conversationId: id(2), message: { videoId: id(3) } }), code("VIDEO_ADMIN_ONLY"));
  assert.equal(authorizations, 1); assert.equal(appends, 0); assert.equal(lookups, 0);
});


test("a genuine MP4 renamed or announced as a photo is rejected by the existing photo signature validator", () => {
  const renamedPhoto = mp4Prefix(100);
  assert.throws(() => imageFormat(renamedPhoto), code("MEDIA_FORMAT"));
  assert.equal(imageFormat(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), "jpeg");
});
