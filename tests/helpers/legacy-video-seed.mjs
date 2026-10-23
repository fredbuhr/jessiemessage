// Historical data only, for disposable loopback database fixtures. These rows
// model client videos saved before 1.9.0; no production permission is relaxed.
import { randomBytes } from "node:crypto";
import { tokenDigest } from "../../server/auth/crypto.mjs";
import { encryptMessageBody, videoMessageFingerprint } from "../../server/chat/crypto.mjs";
import { videoStoredBytes } from "../../server/video/storage.mjs";

const sqlDate = value => new Date(value).toISOString().replace("T", " ").replace("Z", "000");
export async function seedLegacyClientVideoAsset({ connection, storage = null, owner, now, asset = null, bytes = asset?.bytes, source = null }) {
  if (owner?.role !== "client" || !Number.isSafeInteger(now) || !Number.isSafeInteger(bytes)) throw new TypeError("Explicit historical client video required");
  const value = asset ?? { id: randomBytes(16), storageKey: randomBytes(32), bytes, storedBytes: videoStoredBytes(bytes), mime: "video/mp4" };
  let digest = value.digest;
  if (storage !== null) digest = (await storage.put({ assetId: value.id, storageKey: value.storageKey, bytes, source })).digest;
  if (!Buffer.isBuffer(digest) || digest.length !== 32) throw new TypeError("Historical fixture digest required");
  const tokenHash = owner.tokenHash ?? tokenDigest(owner.token), at = sqlDate(now);
  await connection.query(`INSERT INTO video_assets (id, owner_id, owner_role, storage_key, reserve_token_hash,
    content_digest, bytes, stored_bytes, mime, state, created_at, updated_at)
    VALUES (?, ?, 'client', ?, ?, ?, ?, ?, 'video/mp4', 'committed', ?, ?)`,
  [value.id, owner.id, value.storageKey, tokenHash, digest, value.bytes, value.storedBytes, at, at]);
  await connection.query("UPDATE video_storage_state SET held_bytes = held_bytes + ? WHERE id = 1", [value.storedBytes]);
  return { ...value, digest };
}

export async function seedLegacyClientVideoMessage({ chatStore, owner, conversationId, asset, caption, key, now, messageId = randomBytes(16), clientMessageId = randomBytes(16) }) {
  if (owner?.role !== "client") throw new TypeError("Explicit historical client message required");
  const tokenHash = owner.tokenHash ?? tokenDigest(owner.token);
  const binding = { messageId, conversationId, senderId: owner.id }, body = JSON.stringify({ videoId: asset.id.toString("hex"), caption });
  return chatStore.withConversationAppend({ role: "client", tokenHash, now, conversationId }, async (connection, context, append) => {
    const result = await append({ id: messageId, clientMessageId, bodyEncrypted: encryptMessageBody(body, key, binding), bodyFingerprint: videoMessageFingerprint(body, key, binding) });
    await connection.query("INSERT INTO message_video (message_id,conversation_id,video_id,created_at) VALUES (?,?,?,?)",
      [messageId, conversationId, asset.id, sqlDate(result.message.createdAt)]);
    return result;
  });
}
