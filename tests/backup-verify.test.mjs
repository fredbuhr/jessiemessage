import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm, readFile, writeFile, unlink, symlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeTotpSecret, newToken, sealTotpSecret, tokenDigest } from "../server/auth/crypto.mjs";
import { sealVerificationPayload } from "../server/mail/crypto.mjs";
import { sealResetPayload } from "../server/reset/mail-crypto.mjs";
import { encryptMessageBody, messageFingerprint } from "../server/chat/crypto.mjs";
import { sealNotes } from "../server/crm/crypto.mjs";
import { sealPayload, campaignFingerprint } from "../server/broadcast/crypto.mjs";
import { createMediaStorage } from "../server/media/storage.mjs";
import { createBackupCryptoStore, BackupCryptoStoreError } from "../server/backup/crypto-store.mjs";
import { verifyBackupData } from "../server/backup/verify.mjs";

const PURPOSES = ["mfa", "mail", "reset", "messages", "crm", "broadcast", "media"];
const KEY_NAMES = ["totpKey", "mailKey", "messageKey", "mediaKey", "crmKey"];
const base = fileURLToPath(new URL("../../audit/", import.meta.url));
const id = (number) => { const value = Buffer.alloc(16); value.writeUInt32BE(number, 12); return value; };
const altered = (envelope) => { const parts = envelope.split("."), tag = Buffer.from(parts[3], "base64url"); tag[0] ^= 1; parts[3] = tag.toString("base64url"); return parts.join("."); };

async function fixture(t) {
  const keys = Object.fromEntries(KEY_NAMES.map((name) => [name, randomBytes(32)]));
  const adminId = id(1), clientId = id(2), conversationId = id(3), token = newToken(), email = "private-recipient@example.invalid";
  const body = "Private synthetic message <text>", notes = "Private synthetic CRM notes", secret = makeTotpSecret();
  const full = Buffer.from("private synthetic normalized full jpeg"), thumbnail = Buffer.from("private synthetic normalized thumbnail jpeg");
  const assetId = id(8), storageKey = randomBytes(32), digest = createHash("sha256").update(full).digest();
  await mkdir(base, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(path.join(base, "backup-verify-")); t.after(() => rm(root, { recursive: true, force: true }));
  const actualStorage = await createMediaStorage({ root, key: keys.mediaKey });
  await actualStorage.put({ assetId, storageKey, full, thumbnail });
  const messageBinding = { messageId: id(6), conversationId, senderId: adminId };
  const payload = { title: "Private synthetic campaign", body: "Private synthetic broadcast body", mediaId: null, allowRepeatMedia: false, conversationIds: [conversationId.toString("hex")] };
  const campaignBinding = { campaignId: id(7), adminId };
  const rows = {
    notifications: [], notificationJobs: [],
    mfa: [{ id: adminId, encrypted: sealTotpSecret(secret, keys.totpKey, adminId) }],
    mail: [{ id: id(4), encrypted: sealVerificationPayload({ email, token }, keys.mailKey, id(4)), recipientUserId: clientId, challengeUserId: clientId, tokenHash: tokenDigest(token), recipientEmail: email }],
    reset: [{ id: id(5), encrypted: sealResetPayload({ email, token }, keys.mailKey, id(5)), recipientUserId: clientId, challengeUserId: clientId,
      tokenHash: tokenDigest(token), recipientEmail: email, emailHash: createHash("sha256").update(email).digest() }],
    messages: [{ id: id(6), conversationId, senderId: adminId, senderRole: "admin", adminId, clientId, deleted: false,
      encrypted: encryptMessageBody(body, keys.messageKey, messageBinding), fingerprint: messageFingerprint(body, keys.messageKey, messageBinding), mediaId: null, mediaOwnerId: null }],
    crm: [{ id: Buffer.concat([adminId, conversationId]), adminId, conversationId, encrypted: sealNotes(notes, keys.crmKey, { adminId, conversationId, version: "1" }), notesRevision: "1", version: "1" }],
    broadcast: [{ id: id(7), adminId, encrypted: sealPayload(payload, keys.messageKey, campaignBinding), fingerprint: campaignFingerprint(payload, keys.messageKey, campaignBinding),
      mediaId: null, allowRepeatMedia: false, conversationIds: [conversationId] }],
    media: [{ id: assetId, ownerId: adminId, storageKey, digest, fullBytes: full.length, thumbnailBytes: thumbnail.length,
      journalState: "registered", journalAssetId: assetId, journalOwnerId: adminId }],
  };
  const calls = [], plaintexts = [];
  const store = { async page({ purpose, afterId, limit }) {
    calls.push({ purpose, afterId: afterId && Buffer.from(afterId), limit });
    const matching = rows[purpose].filter((row) => afterId === null || Buffer.compare(row.id, afterId) > 0), selected = matching.slice(0, limit);
    const hasMore = matching.length > selected.length;
    return { rows: selected, hasMore, nextCursor: hasMore ? selected.at(-1).id : null };
  } };
  const storage = { async get(options) { const plaintext = await actualStorage.get(options); plaintexts.push(plaintext); return plaintext; } };
  const options = { store, storage, keys };
  return { keys, rows, calls, storage, actualStorage, plaintexts, options, root, full, thumbnail, body, notes, secret, token, email, payload };
}

test("backup verification authenticates existing ciphertext in all domains without reporting plaintext or mutating supplied keys", async (t) => {
  const f = await fixture(t), originalKeys = KEY_NAMES.map((name) => Buffer.from(f.keys[name])), report = await verifyBackupData(f.options);
  assert.deepEqual(Object.keys(report), ["complete", "healthy", "counts", "issues"]);
  assert.equal(report.complete, true); assert.equal(report.healthy, true); assert.deepEqual(report.issues, []);
  assert.deepEqual(report.counts, { rows: 8, mfa: 1, mail: 1, reset: 1, messages: 1, crm: 1, broadcast: 1, broadcastRecipients: 1, media: 1, mediaFiles: 2, notifications: 0, notificationJobs: 0 });
  assert.ok(f.calls.every(({ limit }) => limit === 50));
  assert.equal(f.plaintexts.length, 2); assert.ok(f.plaintexts.every((bytes) => bytes.every((byte) => byte === 0)));
  KEY_NAMES.forEach((name, index) => assert.deepEqual(f.keys[name], originalKeys[index]));
  const json = JSON.stringify(report);
  for (const value of [f.root, f.email, f.token, f.secret, f.body, f.notes, f.full.toString(), ...KEY_NAMES.map((name) => f.keys[name].toString("base64url"))]) assert.equal(json.includes(value), false);
});

test("empty domains, null CRM notes and erased message bodies remain valid alongside separately checked pre-backup canaries", async (t) => {
  const f = await fixture(t);
  for (const purpose of PURPOSES) f.rows[purpose] = [];
  assert.equal((await verifyBackupData(f.options)).healthy, true);
  f.rows.messages = [{ id: id(6), conversationId: id(3), senderId: id(1), senderRole: "admin", adminId: id(1), clientId: id(2), deleted: true,
    encrypted: null, fingerprint: randomBytes(32), mediaId: null, mediaOwnerId: null }];
  f.rows.crm = [{ id: Buffer.concat([id(1), id(3)]), adminId: id(1), conversationId: id(3), encrypted: null, notesRevision: "1", version: "8" }];
  const report = await verifyBackupData(f.options); assert.equal(report.healthy, true); assert.equal(report.counts.mediaFiles, 0);
});

test("a wrong key for every populated domain fails existing ciphertext authentication", async (t) => {
  for (const [key, expectedPurpose] of [["totpKey", "mfa"], ["mailKey", "mail"], ["messageKey", "messages"], ["crmKey", "crm"], ["mediaKey", "media"]]) {
    const f = await fixture(t); f.keys[key] = randomBytes(32);
    if (key === "mediaKey") f.options.storage = await createMediaStorage({ root: f.root, key: f.keys.mediaKey });
    const report = await verifyBackupData(f.options);
    assert.equal(report.complete, true); assert.equal(report.healthy, false); assert.ok(report.issues.some((issue) => issue.purpose === expectedPurpose));
  }
});

test("changed authentication tags and purpose-swapped mail payloads cannot verify", async (t) => {
  for (const purpose of PURPOSES.filter((value) => value !== "media")) {
    const f = await fixture(t); f.rows[purpose][0].encrypted = altered(f.rows[purpose][0].encrypted);
    const report = await verifyBackupData(f.options); assert.equal(report.healthy, false); assert.ok(report.issues.some((issue) => issue.purpose === purpose));
  }
  const f = await fixture(t), reset = f.rows.reset[0];
  reset.encrypted = sealVerificationPayload({ email: f.email, token: f.token }, f.keys.mailKey, reset.id);
  assert.ok((await verifyBackupData(f.options)).issues.some((issue) => issue.purpose === "reset"));
});

test("mail verification checks challenge token, recipient identity and reset email hash bindings", async (t) => {
  for (const [purpose, field, value] of [["mail", "tokenHash", randomBytes(32)], ["mail", "challengeUserId", id(90)],
    ["mail", "recipientEmail", "other@example.invalid"], ["reset", "emailHash", randomBytes(32)], ["reset", "recipientUserId", id(90)]]) {
    const f = await fixture(t); f.rows[purpose][0][field] = value;
    const report = await verifyBackupData(f.options); assert.equal(report.healthy, false); assert.ok(report.issues.some((issue) => issue.purpose === purpose));
  }
});

test("message ciphertext is bound to its message, conversation, sender and retained fingerprint", async (t) => {
  for (const [field, value] of [["id", id(60)], ["conversationId", id(30)], ["senderId", id(90)], ["fingerprint", randomBytes(32)]]) {
    const f = await fixture(t); f.rows.messages[0][field] = value;
    const report = await verifyBackupData(f.options); assert.equal(report.healthy, false); assert.ok(report.issues.some((issue) => issue.purpose === "messages"));
  }
  const f = await fixture(t), row = f.rows.messages[0]; row.deleted = true;
  assert.ok((await verifyBackupData(f.options)).issues.some((issue) => issue.purpose === "messages" && issue.code === "invalid_metadata"));
});

test("photo message payloads match their SQL media delivery and sender", async (t) => {
  const f = await fixture(t), row = f.rows.messages[0], mediaId = f.rows.media[0].id;
  const binding = { messageId: row.id, conversationId: row.conversationId, senderId: row.senderId };
  const body = JSON.stringify({ mediaId: mediaId.toString("hex"), caption: "Private synthetic photo caption" });
  Object.assign(row, { encrypted: encryptMessageBody(body, f.keys.messageKey, binding), fingerprint: messageFingerprint(body, f.keys.messageKey, binding), mediaId, mediaOwnerId: row.senderId });
  assert.equal((await verifyBackupData(f.options)).healthy, true);
  row.mediaId = id(99); assert.ok((await verifyBackupData(f.options)).issues.some((issue) => issue.purpose === "messages" && issue.code === "binding_mismatch"));
});

test("CRM decrypts the notes revision rather than the independently incremented profile version", async (t) => {
  const f = await fixture(t); f.rows.crm[0].version = "9";
  assert.equal((await verifyBackupData(f.options)).healthy, true);
  f.rows.crm[0].notesRevision = "2";
  assert.ok((await verifyBackupData(f.options)).issues.some((issue) => issue.purpose === "crm"));
});

test("broadcast verification authenticates the immutable audience, media choice and request fingerprint", async (t) => {
  for (const [field, value] of [["id", id(70)], ["fingerprint", randomBytes(32)], ["mediaId", id(8)], ["allowRepeatMedia", true], ["conversationIds", [id(90)]]]) {
    const f = await fixture(t); f.rows.broadcast[0][field] = value;
    const report = await verifyBackupData(f.options); assert.equal(report.healthy, false); assert.ok(report.issues.some((issue) => issue.purpose === "broadcast"));
  }
});

test("media authentication detects missing files, corrupted tags, wrong lengths and wrong full-image digests", async (t) => {
  for (const corruption of ["missing", "tag", "symlink", "length", "digest"]) {
    const f = await fixture(t), row = f.rows.media[0], target = path.join(f.root, `${row.storageKey.toString("hex")}.full.enc`);
    if (corruption === "missing") await unlink(target);
    if (corruption === "tag") { const bytes = await readFile(target); bytes[bytes.length - 1] ^= 1; await writeFile(target, bytes); }
    if (corruption === "symlink") { await unlink(target); await symlink(path.join(f.root, `${row.storageKey.toString("hex")}.thumb.enc`), target); }
    if (corruption === "length") row.fullBytes++;
    if (corruption === "digest") row.digest = randomBytes(32);
    const report = await verifyBackupData(f.options); assert.equal(report.healthy, false); assert.ok(report.issues.some((issue) => issue.purpose === "media"));
    assert.ok(f.plaintexts.every((bytes) => bytes.every((byte) => byte === 0)));
  }
});

test("unregistered reserved candidates without asset metadata are left for separate journal recovery", async (t) => {
  const f = await fixture(t), candidate = { assetId: id(80), storageKey: randomBytes(32), full: Buffer.from("reserved private full"), thumbnail: Buffer.from("reserved private thumb") };
  await f.actualStorage.put(candidate);
  const report = await verifyBackupData(f.options); assert.equal(report.healthy, true); assert.equal(report.counts.media, 1); assert.equal(report.counts.mediaFiles, 2);
});

test("abort after a media read erases the obtained plaintext and returns an incomplete report", async (t) => {
  const f = await fixture(t), controller = new AbortController(); let plaintext;
  f.options.storage = { get: async (options) => { plaintext = await f.actualStorage.get(options); controller.abort(); return plaintext; } };
  const report = await verifyBackupData({ ...f.options, signal: controller.signal });
  assert.equal(report.complete, false); assert.equal(report.healthy, false); assert.ok(report.issues.some((issue) => issue.code === "aborted"));
  assert.ok(plaintext.every((byte) => byte === 0));
});

test("global row and issue limits stay bounded, including broadcast recipients", async (t) => {
  const f = await fixture(t), limited = await verifyBackupData({ ...f.options, limits: { maxRows: 1 } });
  assert.equal(limited.complete, false); assert.equal(limited.counts.rows, 1); assert.ok(limited.issues.some((issue) => issue.code === "row_limit"));
  for (const purpose of ["mfa", "mail"]) f.rows[purpose][0].encrypted = altered(f.rows[purpose][0].encrypted);
  const issues = await verifyBackupData({ ...f.options, limits: { maxIssues: 1 } });
  assert.equal(issues.complete, false); assert.equal(issues.healthy, false); assert.equal(issues.issues.length, 1);
  const g = await fixture(t);
  for (const purpose of PURPOSES.filter((value) => value !== "broadcast")) g.rows[purpose] = [];
  const audience = await verifyBackupData({ ...g.options, limits: { maxRows: 1 } });
  assert.equal(audience.complete, false); assert.equal(audience.counts.broadcast, 1); assert.equal(audience.counts.broadcastRecipients, 0);
});

test("keyset verification traverses more than one page without retaining earlier ciphertext pages", async (t) => {
  const f = await fixture(t);
  for (const purpose of PURPOSES) f.rows[purpose] = [];
  f.rows.mfa = Array.from({ length: 105 }, (_, index) => ({ id: id(index + 100), encrypted: sealTotpSecret(f.secret, f.keys.totpKey, id(index + 100)) }));
  const report = await verifyBackupData(f.options); assert.equal(report.healthy, true); assert.equal(report.counts.mfa, 105);
  const pages = f.calls.filter((call) => call.purpose === "mfa"); assert.equal(pages.length, 3);
  assert.equal(pages[0].afterId, null); assert.deepEqual(pages[1].afterId, id(149)); assert.deepEqual(pages[2].afterId, id(199));
});

test("malformed or nonprogressing pages and database failures cannot produce a complete verification", async (t) => {
  const f = await fixture(t);
  for (const page of [{ rows: [], hasMore: true, nextCursor: id(1) }, { rows: [f.rows.mfa[0]], hasMore: false, nextCursor: id(1) },
    { rows: [f.rows.mfa[0], f.rows.mfa[0]], hasMore: false, nextCursor: null }]) {
    const report = await verifyBackupData({ ...f.options, store: { page: async () => page } });
    assert.equal(report.complete, false); assert.equal(report.healthy, false); assert.ok(report.issues.some((issue) => issue.code === "invalid_page"));
  }
  const report = await verifyBackupData({ ...f.options, store: { page: async () => { throw new Error("private-db-password-and-payload"); } } });
  assert.equal(report.complete, false); assert.equal(JSON.stringify(report).includes("private-db"), false);
});

test("invalid configuration is neutral and cannot read data", async (t) => {
  const f = await fixture(t), readCount = f.calls.length;
  for (const options of [{ ...f.options, keys: {} }, { ...f.options, keys: { ...f.keys, crmKey: f.keys.mediaKey } },
    { ...f.options, limits: { maxRows: 100001 } }, { ...f.options, limits: { maxIssues: 0 } }, { ...f.options, limits: { path: "private" } }]) {
    const report = await verifyBackupData(options); assert.equal(report.complete, false); assert.equal(report.healthy, false);
    assert.deepEqual(report.issues, [{ purpose: "verification", code: "invalid_configuration" }]);
  }
  assert.equal(f.calls.length, readCount);
});

function sqlFixture(f) {
  const raw = {
    notifications: [], notificationJobs: [],
    mfa: f.rows.mfa.map((row) => ({ id: row.id, encrypted: row.encrypted })),
    mail: f.rows.mail.map((row) => ({ id: row.id, encrypted: row.encrypted, recipient_user_id: row.recipientUserId, challenge_user_id: row.challengeUserId, token_hash: row.tokenHash, recipient_email: row.recipientEmail })),
    reset: f.rows.reset.map((row) => ({ id: row.id, encrypted: row.encrypted, recipient_user_id: row.recipientUserId, challenge_user_id: row.challengeUserId, token_hash: row.tokenHash, recipient_email: row.recipientEmail, email_hash: row.emailHash })),
    messages: f.rows.messages.map((row) => ({ id: row.id, conversation_id: row.conversationId, sender_id: row.senderId, sender_role: row.senderRole, admin_id: row.adminId, client_id: row.clientId,
      encrypted: row.encrypted, body_fingerprint: row.fingerprint, deleted_at: row.deleted ? "2025-01-01 00:00:00.000000" : null, media_id: row.mediaId, media_owner_id: row.mediaOwnerId })),
    crm: f.rows.crm.map((row) => ({ admin_id: row.adminId, conversation_id: row.conversationId, encrypted: row.encrypted, notes_revision: Number(row.notesRevision), version: Number(row.version) })),
    broadcast: f.rows.broadcast.map((row) => ({ id: row.id, admin_id: row.adminId, encrypted: row.encrypted, request_fingerprint: row.fingerprint, media_id: row.mediaId, allow_repeat_media: row.allowRepeatMedia ? 1 : 0 })),
    media: f.rows.media.map((row) => ({ id: row.id, owner_id: row.ownerId, storage_key: row.storageKey, content_digest: row.digest, full_bytes: row.fullBytes, thumbnail_bytes: row.thumbnailBytes,
      journal_state: row.journalState, journal_asset_id: row.journalAssetId, journal_owner_id: row.journalOwnerId })),
  };
  const queries = [], releases = [];
  const pool = { getConnection: async () => ({ async query(sql, parameters) {
    queries.push({ sql, parameters });
    assert.match(sql, /^SELECT\s/u); assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|TRUNCATE)\b/u);
    if (sql.includes("FROM broadcast_recipients")) return f.rows.broadcast[0].conversationIds.map((conversation_id) => ({ conversation_id }));
    const tables = { mfa: "admin_mfa", mail: "mail_outbox", reset: "password_reset_outbox", messages: "messages", crm: "crm_profiles", broadcast: "broadcast_campaigns", media: "media_assets", notifications: "push_subscriptions", notificationJobs: "push_outbox" };
    const purpose = Object.keys(tables).find((value) => sql.includes(`FROM ${tables[value]} `)); assert.ok(purpose);
    return raw[purpose];
  }, release() { releases.push(true); } }) };
  return { raw, queries, releases, pool };
}

test("the SQL crypto adapter projects all domains with SELECT-only bounded reads and composes with real cryptography", async (t) => {
  const f = await fixture(t), sql = sqlFixture(f), store = createBackupCryptoStore({ pool: sql.pool });
  assert.ok(Object.isFrozen(store));
  const report = await verifyBackupData({ ...f.options, store }); assert.equal(report.healthy, true); assert.equal(sql.releases.length, 9);
  assert.ok(sql.queries.filter((query) => !query.sql.includes("broadcast_recipients")).every((query) => query.parameters.at(-1) === 51));
  assert.equal(sql.queries.filter((query) => query.sql.includes("broadcast_recipients")).length, 1);
  assert.match(sql.queries.find((query) => query.sql.includes("FROM media_assets ")).sql, /a\.deleted_at IS NULL/u);
});

test("the SQL adapter validates composite CRM cursors and rejects malformed, duplicated or unbounded rows", async (t) => {
  const f = await fixture(t), sql = sqlFixture(f), store = createBackupCryptoStore({ pool: sql.pool });
  await store.page({ purpose: "crm", afterId: Buffer.concat([id(1), id(2)]), limit: 100 });
  const query = sql.queries[0]; assert.match(query.sql, /p\.admin_id > \? OR \(p\.admin_id = \? AND p\.conversation_id > \?\)/u);
  assert.deepEqual(query.parameters, [id(1), id(1), id(2), 101]);
  const reject = (promise) => assert.rejects(promise, (error) => error instanceof BackupCryptoStoreError && error.code === "BACKUP_DATABASE" && error.cause === undefined);
  const before = sql.queries.length;
  for (const options of [{ purpose: "users; DROP TABLE users" }, { purpose: "mfa", afterId: Buffer.alloc(32) }, { purpose: "crm", afterId: id(1) }, { purpose: "mail", limit: 101 }, { purpose: "mfa", path: "private" }]) await reject(store.page(options));
  assert.equal(sql.queries.length, before);
  sql.raw.mfa.push(sql.raw.mfa[0]); await reject(store.page({ purpose: "mfa" }));
  sql.raw.mfa = Array(52).fill(sql.raw.mfa[0]); await reject(store.page({ purpose: "mfa" }));
});

test("SQL backend errors are sanitized and always release the connection", async () => {
  let releases = 0;
  const store = createBackupCryptoStore({ pool: { getConnection: async () => ({ query: async () => { throw new Error("private SQL credentials and restored contents"); }, release: () => { releases++; } }) } });
  await assert.rejects(store.page({ purpose: "mail" }), (error) => error instanceof BackupCryptoStoreError && !error.message.includes("private SQL") && error.cause === undefined);
  assert.equal(releases, 1);
});
