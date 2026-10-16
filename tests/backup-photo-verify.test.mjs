import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createMediaStorage } from "../server/media/storage.mjs";
import { makeTotpSecret, newToken, sealTotpSecret, tokenDigest } from "../server/auth/crypto.mjs";
import { sealVerificationPayload } from "../server/mail/crypto.mjs";
import { encryptMessageBody, messageFingerprint } from "../server/chat/crypto.mjs";
import { verifyPhotoBackupData } from "../server/backup/verify.mjs";

const id = number => Buffer.alloc(16, number);
async function fixture(t) {
  const base = resolve("../audit"); await mkdir(base, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(join(base, "photo-backup-")); await chmod(root, 0o700); t.after(() => rm(root, { recursive: true, force: true }));
  const keys = Object.fromEntries(["totpKey", "mailKey", "messageKey", "mediaKey"].map(name => [name, randomBytes(32)]));
  const storage = await createMediaStorage({ root, key: keys.mediaKey, pathMode: "strict" });
  const admin = id(1), client = id(2), conversation = id(3), message = id(4), asset = id(5), mail = id(6), storageKey = randomBytes(32);
  const full = Buffer.from("Synthetic private normalized image bytes"), thumbnail = Buffer.from("Synthetic thumb bytes");
  await storage.put({ assetId: asset, storageKey, full, thumbnail });
  const body = JSON.stringify({ mediaId: asset.toString("hex"), caption: "Synthetic private caption" }), binding = { messageId: message, conversationId: conversation, senderId: admin };
  const token = newToken(), email = "private-photo@example.invalid";
  const rows = {
    admin_mfa: [{ id: admin, encrypted: sealTotpSecret(makeTotpSecret(), keys.totpKey, admin) }],
    mail_outbox: [{ id: mail, encrypted: sealVerificationPayload({ email, token }, keys.mailKey, mail), recipient_user_id: client,
      challenge_user_id: client, token_hash: tokenDigest(token), recipient_email: email }],
    messages: [{ id: message, conversation_id: conversation, sender_id: admin, sender_role: "admin", admin_id: admin, client_id: client,
      encrypted: encryptMessageBody(body, keys.messageKey, binding), body_fingerprint: messageFingerprint(body, keys.messageKey, binding),
      deleted_at: null, media_id: asset, media_owner_id: admin }],
    media_assets: [{ id: asset, owner_id: admin, storage_key: storageKey, content_digest: createHash("sha256").update(full).digest(),
      full_bytes: full.length, thumbnail_bytes: thumbnail.length, journal_state: "registered", journal_asset_id: asset, journal_owner_id: admin }],
  };
  const calls = [], populated = new Set(); let released = 0;
  const pool = { getConnection: async () => ({ query: async (sql, parameters = []) => {
    assert.match(sql, /^SELECT\s/); assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|CREATE|DROP|ALTER)\b/); calls.push(sql);
    const table = /\bFROM ([a-z_]+)/.exec(sql)?.[1];
    if (sql.startsWith("SELECT EXISTS")) return [{ present: populated.has(table) ? 1 : 0 }];
    assert.ok(Object.hasOwn(rows, table));
    return rows[table].filter(row => parameters.length === 1 || Buffer.compare(row.id, parameters[0]) > 0).slice(0, parameters.at(-1));
  }, release: async () => { released++; } }) };
  return { keys, storage, root, storageKey, rows, calls, populated, options: { keys, storage, pool }, released: () => released, body, token, email };
}

test("photo-profile backup authenticates real encrypted files and caption bindings using four keys and SELECT-only reads", async t => {
  const f = await fixture(t), report = await verifyPhotoBackupData(f.options);
  assert.equal(report.complete, true); assert.equal(report.healthy, true); assert.deepEqual(report.issues, []);
  assert.deepEqual(report.counts, { rows: 4, mfa: 1, mail: 1, reset: 0, messages: 1, crm: 0, broadcast: 0, broadcastRecipients: 0, media: 1, mediaFiles: 2 });
  assert.equal(f.calls.filter(sql => sql.startsWith("SELECT EXISTS")).length, 8); assert.equal(f.released(), 5);
  for (const value of [f.body, f.token, f.email, ...Object.values(f.keys).map(key => key.toString("base64url"))]) assert.equal(JSON.stringify(report).includes(value), false);
});

test("each wrong photo-profile key fails its populated domain while caller key buffers remain intact", async t => {
  for (const name of ["totpKey", "mailKey", "messageKey", "mediaKey"]) {
    const f = await fixture(t), wrong = randomBytes(32), before = Buffer.from(wrong);
    const storage = name === "mediaKey" ? await createMediaStorage({ root: f.root, key: wrong, pathMode: "strict" }) : f.storage;
    const report = await verifyPhotoBackupData({ ...f.options, keys: { ...f.keys, [name]: wrong }, storage });
    assert.equal(report.healthy, false); assert.ok(report.issues.length > 0); assert.deepEqual(wrong, before);
  }
});

test("photo verification refuses every populated disabled-domain table before crypto reads", async t => {
  for (const table of ["client_password_resets", "password_reset_outbox", "crm_profiles", "crm_labels", "crm_memberships",
    "broadcast_preferences", "broadcast_campaigns", "broadcast_recipients"]) {
    const f = await fixture(t); f.populated.add(table);
    const report = await verifyPhotoBackupData(f.options); assert.equal(report.complete, false); assert.equal(report.healthy, false);
    assert.equal(report.issues[0].code, "inactive_domain_populated"); assert.equal(f.calls.some(sql => sql.includes("FROM admin_mfa ")), false);
  }
});

test("changed file authentication tag, image digest, journal owner or photo sender cannot verify", async t => {
  for (const change of ["tag", "digest", "journal", "sender"]) {
    const f = await fixture(t);
    if (change === "tag") {
      const filename = join(f.root, f.storageKey.toString("hex") + ".full.enc"), bytes = await readFile(filename);
      bytes[bytes.length - 1] ^= 1; await writeFile(filename, bytes);
    }
    if (change === "digest") f.rows.media_assets[0].content_digest = randomBytes(32);
    if (change === "journal") f.rows.media_assets[0].journal_owner_id = id(9);
    if (change === "sender") f.rows.messages[0].media_owner_id = id(9);
    const report = await verifyPhotoBackupData(f.options); assert.equal(report.healthy, false); assert.ok(report.issues.length > 0);
  }
});

test("photo verification rejects missing, extra and colliding keys without querying SQL", async t => {
  for (const change of ["missing", "extra", "collision"]) {
    const f = await fixture(t), keys = { ...f.keys };
    if (change === "missing") delete keys.mediaKey;
    if (change === "extra") keys.crmKey = randomBytes(32);
    if (change === "collision") keys.mediaKey = keys.messageKey;
    const report = await verifyPhotoBackupData({ ...f.options, keys });
    assert.equal(report.complete, false); assert.equal(report.issues[0].code, "invalid_configuration"); assert.deepEqual(f.calls, []);
  }
});
