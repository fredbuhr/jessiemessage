import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createVideoStorage, VIDEO_BLOCK_BYTES, videoStoredBytes } from "../server/video/storage.mjs";
import { encryptMessageBody, messageFingerprint, videoMessageFingerprint } from "../server/chat/crypto.mjs";
import { createBackupCryptoStore } from "../server/backup/crypto-store.mjs";
import { verifyPhotoNotificationRecoveryCrmBroadcastVideoBackupData } from "../server/backup/verify.mjs";

const id = value => Buffer.alloc(16, value);
const keyNames = ["totpKey", "mailKey", "messageKey", "mediaKey", "crmKey", "notificationKey", "videoKey"];
const createdAt = "2026-10-22 01:00:00.000000", assetCreatedAt = "2026-10-22 00:59:00.000000";
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "backup-video-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const keys = Object.fromEntries(keyNames.map(name => [name, randomBytes(32)]));
  const actualStorage = await createVideoStorage({ root, key: keys.videoKey, pathMode: "strict" });
  const assetId = id(8), storageKey = randomBytes(32), plaintext = randomBytes(VIDEO_BLOCK_BYTES + 37);
  const source = { async *[Symbol.asyncIterator]() { yield plaintext; } };
  await actualStorage.put({ assetId, storageKey, bytes: plaintext.length, source });
  const adminId = id(1), clientId = id(2), conversationId = id(3), messageId = id(4);
  const binding = { messageId, conversationId, senderId: adminId };
  const body = JSON.stringify({ videoId: assetId.toString("hex"), caption: "Synthetic private video" });
  const rows = Object.fromEntries(["admin_mfa", "mail_outbox", "password_reset_outbox", "messages", "crm_profiles", "crm_tasks",
    "broadcast_campaigns", "announcements", "media_assets", "video_assets", "push_subscriptions", "push_outbox"].map(name => [name, []]));
  const message = { id: messageId, conversation_id: conversationId, sender_id: adminId, sender_role: "admin", admin_id: adminId, client_id: clientId,
    encrypted: encryptMessageBody(body, keys.messageKey, binding), body_fingerprint: videoMessageFingerprint(body, keys.messageKey, binding),
    deleted_at: null, media_id: null, media_owner_id: null, video_id: assetId, video_conversation_id: conversationId,
    video_owner_id: adminId, video_owner_role: "admin", video_state: "committed", message_created_at: createdAt,
    video_link_created_at: createdAt, video_created_at: assetCreatedAt };
  rows.messages.push(message);
  rows.video_assets.push({ id: assetId, owner_id: adminId, owner_role: "admin", user_role: "admin", storage_key: storageKey,
    content_digest: createHash("sha256").update(plaintext).digest(), bytes: plaintext.length, stored_bytes: videoStoredBytes(plaintext.length),
    mime: "video/mp4", state: "committed" });
  const calls = [], yielded = []; let opened = 0, closed = 0;
  const pool = { async getConnection() { return { async query(sql, parameters = []) {
    calls.push(sql); assert.match(sql, /^SELECT\s/); assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|CREATE|DROP|ALTER)\b/);
    const table = /\bFROM ([a-z_]+)/.exec(sql)?.[1]; assert.ok(Object.hasOwn(rows, table), table);
    let selected = rows[table];
    if (table === "video_assets") selected = selected.filter(row => row.state === "committed");
    return selected.filter(row => parameters.length === 1 || Buffer.compare(row.id, parameters[0]) > 0).slice(0, parameters.at(-1));
  }, async release() {} }; } };
  const storage = { async get() { assert.fail("Empty photo catalogue cannot open a photo."); } };
  const videoStorage = { async open(options) {
    opened++; const handle = await actualStorage.open(options);
    return { ...handle, stream() { return (async function* () { for await (const chunk of handle.stream()) { yielded.push(chunk); yield chunk; } })(); },
      async close() { closed++; await handle.close(); } };
  } };
  return { root, keys, assetId, storageKey, actualStorage, plaintext, body, binding, message, rows, calls, yielded,
    opened: () => opened, closed: () => closed, options: { pool, storage, videoStorage, keys } };
}

test("explicit video backup verifies the typed message and streams authenticated blocks with an exact catalogue digest", async t => {
  const f = await fixture(t), originals = keyNames.map(name => Buffer.from(f.keys[name]));
  const report = await verifyPhotoNotificationRecoveryCrmBroadcastVideoBackupData(f.options);
  assert.equal(report.complete, true); assert.equal(report.healthy, true); assert.deepEqual(report.issues, []);
  assert.equal(report.counts.messages, 1); assert.equal(report.counts.videos, 1);
  assert.equal(report.counts.videoFiles, 1); assert.equal(report.counts.videoBytes, f.plaintext.length);
  assert.equal(f.opened(), 1); assert.equal(f.closed(), 1); assert.equal(f.yielded.length, 2);
  assert.ok(f.yielded.every(chunk => chunk.every(byte => byte === 0)), "consumer-owned decrypted blocks are erased");
  keyNames.forEach((name, index) => assert.deepEqual(f.keys[name], originals[index]));
  for (const value of [f.body, f.root, ...keyNames.map(name => f.keys[name].toString("base64url"))]) assert.equal(JSON.stringify(report).includes(value), false);
});

test("video messages reject an ordinary-text fingerprint and foreign, conflicting or changed attachment bindings", async t => {
  for (const change of ["fingerprint", "payload", "owner", "owner-role", "conversation", "photo", "link-date", "catalogue-state"]) {
    const f = await fixture(t);
    if (change === "fingerprint") f.message.body_fingerprint = messageFingerprint(f.body, f.keys.messageKey, f.binding);
    if (change === "payload") {
      const body = JSON.stringify({ videoId: id(9).toString("hex"), caption: "Synthetic private video" });
      f.message.encrypted = encryptMessageBody(body, f.keys.messageKey, f.binding);
      f.message.body_fingerprint = videoMessageFingerprint(body, f.keys.messageKey, f.binding);
    }
    if (change === "owner") f.message.video_owner_id = id(9);
    if (change === "owner-role") f.message.video_owner_role = "client";
    if (change === "conversation") f.message.video_conversation_id = id(9);
    if (change === "photo") { f.message.media_id = id(9); f.message.media_owner_id = f.binding.senderId; }
    if (change === "link-date") f.message.video_link_created_at = "2026-10-22 01:00:01.000000";
    if (change === "catalogue-state") f.message.video_state = "cleanup_pending";
    const report = await verifyPhotoNotificationRecoveryCrmBroadcastVideoBackupData(f.options);
    assert.equal(report.healthy, false, change); assert.ok(report.issues.some(issue => issue.purpose === "messages" && issue.code === "binding_mismatch"), change);
  }
});

test("literal video JSON remains ordinary text and erased video tombstones never open an original", async t => {
  const f = await fixture(t);
  f.message.body_fingerprint = messageFingerprint(f.body, f.keys.messageKey, f.binding);
  for (const name of ["video_id", "video_conversation_id", "video_owner_id", "video_owner_role", "video_state", "video_link_created_at", "video_created_at"]) f.message[name] = null;
  let report = await verifyPhotoNotificationRecoveryCrmBroadcastVideoBackupData(f.options);
  assert.equal(report.healthy, true); assert.equal(report.counts.videoFiles, 1);
  f.message.video_id = f.assetId; f.message.video_conversation_id = f.binding.conversationId;
  f.message.video_link_created_at = createdAt; f.message.video_created_at = assetCreatedAt;
  f.message.video_owner_id = f.binding.senderId; f.message.video_owner_role = "admin"; f.message.video_state = "released";
  f.message.deleted_at = "2026-10-22 01:01:00.000000"; f.message.encrypted = null; f.message.body_fingerprint = randomBytes(32);
  f.rows.video_assets[0].state = "released";
  const opened = f.opened(); report = await verifyPhotoNotificationRecoveryCrmBroadcastVideoBackupData(f.options);
  assert.equal(report.healthy, true); assert.equal(report.counts.videoFiles, 0); assert.equal(f.opened(), opened);
});

test("corrupted GCM, catalogue digest and mismatched video key fail without retaining decrypted blocks", async t => {
  for (const change of ["tag", "digest", "key"]) {
    const f = await fixture(t);
    if (change === "tag") {
      const filename = join(f.root, f.storageKey.toString("hex") + ".video.enc"), encrypted = await readFile(filename);
      encrypted[encrypted.length - 1] ^= 1; await writeFile(filename, encrypted);
    }
    if (change === "digest") f.rows.video_assets[0].content_digest = randomBytes(32);
    if (change === "key") {
      const wrong = randomBytes(32); f.options.keys = { ...f.keys, videoKey: wrong };
      f.options.videoStorage = await createVideoStorage({ root: f.root, key: wrong, pathMode: "strict" });
    }
    const report = await verifyPhotoNotificationRecoveryCrmBroadcastVideoBackupData(f.options);
    assert.equal(report.healthy, false, change); assert.ok(report.issues.some(issue => issue.purpose === "videos"), change);
    assert.ok(f.yielded.every(chunk => chunk.every(byte => byte === 0)), change);
  }
});

test("a missing or colliding seventh key and absent video reader refuse before SQL or file access", async t => {
  for (const change of ["missing", "extra", "collision", "storage"]) {
    const f = await fixture(t), keys = { ...f.keys }, options = { ...f.options, keys };
    if (change === "missing") delete keys.videoKey;
    if (change === "extra") keys.extraKey = randomBytes(32);
    if (change === "collision") keys.videoKey = keys.mediaKey;
    if (change === "storage") options.videoStorage = {};
    const report = await verifyPhotoNotificationRecoveryCrmBroadcastVideoBackupData(options);
    assert.equal(report.complete, false); assert.equal(report.issues[0].code, "invalid_configuration");
    assert.deepEqual(f.calls, []); assert.equal(f.opened(), 0);
  }
});

test("bounded video verification erases oversized yielded buffers and closes an incomplete stream", async t => {
  for (const change of ["oversized", "truncated", "close"]) {
    const f = await fixture(t), chunk = Buffer.alloc(change === "oversized" ? VIDEO_BLOCK_BYTES + 1 : 3, 7); let closed = 0;
    f.options.videoStorage = { async open() { return { bytes: f.plaintext.length, storedBytes: videoStoredBytes(f.plaintext.length),
      async *stream() { yield chunk; }, async close() { closed++; if (change === "close") throw new Error("Synthetic private path must not leak"); } }; } };
    const report = await verifyPhotoNotificationRecoveryCrmBroadcastVideoBackupData(f.options);
    assert.equal(report.healthy, false); assert.equal(report.counts.videoFiles, 0); assert.equal(closed, 1);
    assert.ok(chunk.every(byte => byte === 0)); assert.equal(JSON.stringify(report).includes("Synthetic private path"), false);
  }
});

test("cancellation after decryption erases the yielded block, closes its pinned reader and cannot report a healthy backup", async t => {
  const f = await fixture(t), cancellation = new AbortController(), yielded = []; let closed = 0;
  f.options.signal = cancellation.signal;
  f.options.videoStorage = { async open(options) {
    const handle = await f.actualStorage.open(options);
    return { ...handle, stream() { return (async function* () {
      for await (const chunk of handle.stream()) { yielded.push(chunk); cancellation.abort(); yield chunk; }
    })(); }, async close() { closed++; await handle.close(); } };
  } };
  const report = await verifyPhotoNotificationRecoveryCrmBroadcastVideoBackupData(f.options);
  assert.equal(report.complete, false); assert.equal(report.healthy, false); assert.equal(report.counts.videoFiles, 0);
  assert.deepEqual(report.issues, [{ purpose: "videos", code: "aborted" }]);
  assert.equal(closed, 1); assert.equal(yielded.length, 1); assert.ok(yielded[0].every(byte => byte === 0));
});

test("historical crypto readers never query video tables and require explicit opt-in for video pages", async () => {
  const calls = [], pool = { async getConnection() { return { async query(sql) { calls.push(sql); return []; }, release() {} }; } };
  const legacy = createBackupCryptoStore({ pool });
  assert.deepEqual(await legacy.page({ purpose: "messages" }), { rows: [], hasMore: false, nextCursor: null });
  assert.doesNotMatch(calls[0], /message_video|video_assets/);
  await assert.rejects(legacy.page({ purpose: "videos" }), { code: "BACKUP_DATABASE" });
  const video = createBackupCryptoStore({ pool, video: true });
  await video.page({ purpose: "messages" }); await video.page({ purpose: "videos" });
  assert.match(calls[1], /LEFT JOIN message_video/); assert.match(calls[2], /FROM video_assets/);
  assert.throws(() => createBackupCryptoStore({ pool, video: "true" }));
});
