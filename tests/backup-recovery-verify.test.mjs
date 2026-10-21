import test from "node:test";
import assert from "node:assert/strict";
import { createECDH, createHash, randomBytes } from "node:crypto";
import { tokenDigest } from "../server/auth/crypto.mjs";
import { sealVerificationPayload } from "../server/mail/crypto.mjs";
import { sealResetPayload } from "../server/reset/mail-crypto.mjs";
import { sealSubscription, endpointDigest } from "../server/notifications/crypto.mjs";
import { sealPayload, campaignFingerprint } from "../server/broadcast/crypto.mjs";
import { sealNotes } from "../server/crm/crypto.mjs";
import { verifyPhotoNotificationBackupData, verifyPhotoNotificationRecoveryBackupData, verifyPhotoNotificationRecoveryCrmBackupData, verifyPhotoNotificationRecoveryCrmBroadcastBackupData } from "../server/backup/verify.mjs";

const id = number => { const value = Buffer.alloc(16); value.writeUInt32BE(number, 12); return value; };
const names = ["totpKey", "mailKey", "messageKey", "mediaKey", "notificationKey"];
const digestEmail = email => createHash("sha256").update(email, "utf8").digest();
function fixture() {
  const keys = Object.fromEntries(names.map(name => [name, randomBytes(32)]));
  const token = randomBytes(32).toString("base64url"), email = "synthetic-recovery@example.invalid", clientId = id(2), jobId = id(6);
  const curve = createECDH("prime256v1"); curve.generateKeys();
  const subscription = { endpoint: "https://fcm.googleapis.com/fcm/send/synthetic-recovery-backup-only", expirationTime: null,
    keys: { p256dh: curve.getPublicKey().toString("base64url"), auth: randomBytes(16).toString("base64url") } };
  const binding = { subscriptionId: id(3), userId: clientId, generation: 2 };
  const rows = {
    client_password_resets: [{ id: id(5) }],
    password_reset_outbox: [{ id: jobId, encrypted: sealResetPayload({ email, token }, keys.mailKey, jobId), recipient_user_id: clientId,
      challenge_user_id: clientId, token_hash: tokenDigest(token), email_hash: digestEmail(email), recipient_email: email }],
    push_subscriptions: [{ id: binding.subscriptionId, user_id: clientId, role: "client", user_role: "client", session_id: id(4),
      session_user_id: clientId, credential_version: 1, generation: binding.generation,
      endpoint_digest: endpointDigest(subscription.endpoint, keys.notificationKey), encrypted: sealSubscription(subscription, keys.notificationKey, binding) }],
    push_outbox: [{ id: id(7), subscription_generation: 1, generation: 2, user_id: clientId, role: "client",
      sender_id: id(1), sender_role: "admin", admin_id: id(1), client_id: clientId }],
  };
  const calls = []; let released = 0;
  const pool = { getConnection: async () => ({ query: async (sql, parameters = []) => {
    assert.match(sql, /^SELECT\s/); assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|FOR UPDATE)\b/);
    calls.push({ sql, parameters }); const table = /\bFROM ([a-z_]+)/.exec(sql)?.[1];
    if (sql.startsWith("SELECT EXISTS")) return [{ present: rows[table]?.length ? 1 : 0 }];
    return (rows[table] ?? []).filter(row => parameters.length === 1 || Buffer.compare(row.id, parameters[0]) > 0).slice(0, table === "broadcast_recipients" ? 101 : parameters.at(-1));
  }, release() { released++; } }) };
  const storage = { async get() { assert.fail("this metadata-only fixture has no media to read"); } };
  return { keys, token, email, clientId, jobId, subscription, rows, calls, pool, storage, options: { keys, pool, storage }, released: () => released };
}
const copyKeys = keys => Object.fromEntries(Object.entries(keys).map(([name, key]) => [name, Buffer.from(key)]));
function crmFixture() {
  const f = fixture(), adminId = id(1), conversationId = id(10), notes = "Synthetic shared private note";
  f.keys.crmKey = randomBytes(32);
  f.rows.crm_profiles = [{ id: Buffer.concat([adminId, conversationId]), admin_id: adminId, conversation_id: conversationId, notes_revision: 2, version: 3,
    encrypted: sealNotes(notes, f.keys.crmKey, { adminId, conversationId, version: "2" }) }];
  f.rows.crm_labels = [{ id: id(11) }]; f.rows.crm_memberships = [{ id: id(12) }];
  return { ...f, notes };
}

test("the CRM recovery verifier authenticates populated notes, reset mail and Push with exactly six keys and reads only SQL", async () => {
  const f = crmFixture(), before = copyKeys(f.keys), report = await verifyPhotoNotificationRecoveryCrmBackupData(f.options);
  assert.equal(report.complete, true); assert.equal(report.healthy, true); assert.deepEqual(report.issues, []);
  assert.equal(report.counts.crm, 1); assert.equal(report.counts.reset, 1); assert.equal(report.counts.notificationJobs, 1);
  assert.deepEqual(f.keys, before); assert.equal(f.calls.filter(call => call.sql.startsWith("SELECT EXISTS")).length, 4);
  for (const value of [f.notes, f.token, f.rows.crm_profiles[0].encrypted, ...Object.values(f.keys).map(key => key.toString("base64url"))])
    assert.equal(JSON.stringify(report).includes(value), false);
});

test("CRM notes fail verification for a changed key, owner, revision or ciphertext, without changing caller-owned secrets", async () => {
  for (const changed of ["key", "owner", "revision", "ciphertext", "missingKey", "collision"]) {
    const f = crmFixture(), row = f.rows.crm_profiles[0];
    if (changed === "key") f.keys.crmKey = randomBytes(32);
    if (changed === "owner") { row.admin_id = id(13); row.id = Buffer.concat([row.admin_id, row.conversation_id]); }
    if (changed === "revision") row.notes_revision = 3;
    if (changed === "ciphertext") row.encrypted = `${row.encrypted.slice(0, -5)}AAAAA`;
    if (changed === "missingKey") delete f.keys.crmKey;
    if (changed === "collision") f.keys.crmKey = f.keys.mediaKey;
    const before = copyKeys(f.keys), report = await verifyPhotoNotificationRecoveryCrmBackupData(f.options);
    assert.equal(report.healthy, false, changed); assert.ok(report.issues.length, changed); assert.deepEqual(f.keys, before);
    if (["missingKey", "collision"].includes(changed)) assert.deepEqual(f.calls, []);
  }
});

test("CRM restoration retains the inactive broadcast boundary, including metadata-only rows", async () => {
  for (const table of ["broadcast_preferences", "broadcast_campaigns", "broadcast_recipients"]) {
    const f = crmFixture(); f.rows[table] = [{ id: id(20) }];
    const report = await verifyPhotoNotificationRecoveryCrmBackupData(f.options);
    assert.equal(report.complete, false); assert.deepEqual(report.issues, [{ purpose: "broadcast", code: "inactive_domain_populated" }]);
    assert.equal(f.calls.some(call => !call.sql.startsWith("SELECT EXISTS")), false);
  }
});

test("recovery photo notification backup authenticates reset mail and Push offline with exactly the existing five keys", async () => {
  const f = fixture(), before = copyKeys(f.keys), report = await verifyPhotoNotificationRecoveryBackupData(f.options);
  assert.equal(report.complete, true); assert.equal(report.healthy, true); assert.deepEqual(report.issues, []);
  assert.equal(report.counts.reset, 1); assert.equal(report.counts.notifications, 1); assert.equal(report.counts.notificationJobs, 1); assert.equal(report.counts.rows, 3);
  assert.equal(f.calls.filter(({ sql }) => sql.startsWith("SELECT EXISTS")).length, 7);
  assert.equal(f.released(), 8); assert.deepEqual(f.keys, before);
  assert.ok(f.calls.some(({ sql }) => sql.includes("LEFT JOIN client_password_resets r ON r.id = o.reset_id")));
  for (const value of [f.token, f.email, f.rows.password_reset_outbox[0].encrypted, f.subscription.endpoint,
    f.subscription.keys.auth, f.subscription.keys.p256dh, ...Object.values(f.keys).map(key => key.toString("base64url"))]) assert.equal(JSON.stringify(report).includes(value), false);
});

test("recovery reset payloads retain purpose, outbox identity, recipient, token and email challenge authentication", async () => {
  for (const change of ["key", "tag", "id", "owner", "missingChallenge", "token", "emailHash", "email", "noncanonicalEmail", "verificationPurpose"]) {
    const f = fixture(), row = f.rows.password_reset_outbox[0], before = copyKeys(f.keys);
    if (change === "key") f.options.keys = { ...f.keys, mailKey: randomBytes(32) };
    if (change === "tag") { const parts = row.encrypted.split("."), tag = Buffer.from(parts[3], "base64url"); tag[0] ^= 1; parts[3] = tag.toString("base64url"); row.encrypted = parts.join("."); }
    if (change === "id") row.id = id(9);
    if (change === "owner") row.challenge_user_id = id(9);
    if (change === "missingChallenge") row.challenge_user_id = null;
    if (change === "token") row.token_hash = randomBytes(32);
    if (change === "emailHash") row.email_hash = randomBytes(32);
    if (change === "email") row.recipient_email = "different@example.invalid";
    if (change === "noncanonicalEmail") row.recipient_email = "SYNTHETIC-RECOVERY@example.invalid";
    if (change === "verificationPurpose") row.encrypted = sealVerificationPayload({ email: f.email, token: f.token }, f.keys.mailKey, row.id);
    const supplied = copyKeys(f.options.keys), report = await verifyPhotoNotificationRecoveryBackupData(f.options);
    assert.equal(report.healthy, false, change); assert.ok(report.issues.some(issue => issue.purpose === "reset"), change);
    assert.deepEqual(f.keys, before, change); assert.deepEqual(f.options.keys, supplied, change);
  }
});

test("the recovery profile still authenticates notification ciphertext and delivery conversation links", async () => {
  for (const change of ["key", "session", "jobOwner", "jobGeneration"]) {
    const f = fixture();
    if (change === "key") f.options.keys = { ...f.keys, notificationKey: randomBytes(32) };
    if (change === "session") f.rows.push_subscriptions[0].session_user_id = id(9);
    if (change === "jobOwner") f.rows.push_outbox[0].user_id = id(9);
    if (change === "jobGeneration") f.rows.push_outbox[0].subscription_generation = 3;
    const before = copyKeys(f.options.keys), report = await verifyPhotoNotificationRecoveryBackupData(f.options);
    assert.equal(report.healthy, false, change); assert.ok(report.issues.some(issue => ["notifications", "notificationJobs"].includes(issue.purpose)), change);
    assert.deepEqual(f.options.keys, before);
  }
});

test("legacy photos-notify refuses either reset table even when no encrypted mail remains", async () => {
  for (const table of ["client_password_resets", "password_reset_outbox"]) {
    const f = fixture();
    for (const other of ["client_password_resets", "password_reset_outbox"]) if (other !== table) f.rows[other] = [];
    const before = copyKeys(f.keys), report = await verifyPhotoNotificationBackupData(f.options);
    assert.equal(report.complete, false); assert.equal(report.healthy, false);
    assert.deepEqual(report.issues, [{ purpose: "reset", code: "inactive_domain_populated" }]);
    assert.equal(f.calls.some(({ sql }) => !sql.startsWith("SELECT EXISTS")), false); assert.deepEqual(f.keys, before);
  }
});

test("recovery does not permit even metadata-only CRM or broadcast rows", async () => {
  for (const table of ["crm_profiles", "crm_labels", "crm_memberships", "broadcast_preferences", "broadcast_campaigns", "broadcast_recipients"]) {
    const f = fixture(); f.rows[table] = [{ id: id(10) }];
    const report = await verifyPhotoNotificationRecoveryBackupData(f.options);
    assert.equal(report.complete, false); assert.equal(report.healthy, false); assert.equal(report.issues[0].code, "inactive_domain_populated", table);
    assert.equal(f.calls.some(({ sql }) => !sql.startsWith("SELECT EXISTS")), false);
  }
});

test("recovery refuses any missing, extra or colliding key before SQL and never erases caller-owned buffers", async () => {
  for (const change of [...names, "extra", "collision"]) {
    const f = fixture(), keys = { ...f.keys }, before = copyKeys(f.keys);
    if (names.includes(change)) delete keys[change];
    if (change === "extra") keys.crmKey = randomBytes(32);
    if (change === "collision") keys.notificationKey = keys.mailKey;
    const supplied = copyKeys(keys), report = await verifyPhotoNotificationRecoveryBackupData({ ...f.options, keys });
    assert.equal(report.complete, false); assert.deepEqual(report.issues, [{ purpose: "verification", code: "invalid_configuration" }]);
    assert.deepEqual(f.calls, []); assert.deepEqual(f.keys, before); assert.deepEqual(keys, supplied);
  }
});

test("reset verification paginates all encrypted mail, obeys row limits and aborts without writes", async () => {
  const f = fixture(), prototype = f.rows.password_reset_outbox[0];
  f.rows.password_reset_outbox = Array.from({ length: 105 }, (_, index) => {
    const jobId = id(index + 100), token = randomBytes(32).toString("base64url");
    return { ...prototype, id: jobId, token_hash: tokenDigest(token), encrypted: sealResetPayload({ email: f.email, token }, f.keys.mailKey, jobId) };
  });
  const before = copyKeys(f.keys), report = await verifyPhotoNotificationRecoveryBackupData(f.options);
  assert.equal(report.healthy, true); assert.equal(report.counts.reset, 105);
  const pages = f.calls.filter(({ sql }) => sql.includes("FROM password_reset_outbox o")); assert.equal(pages.length, 3);
  assert.deepEqual(pages[1].parameters, [id(149), 51]); assert.deepEqual(pages[2].parameters, [id(199), 51]);
  const limited = await verifyPhotoNotificationRecoveryBackupData({ ...f.options, limits: { maxRows: 2 } });
  assert.equal(limited.complete, false); assert.equal(limited.counts.rows, 2); assert.ok(limited.issues.some(issue => issue.code === "row_limit"));
  const callsBefore = f.calls.length, controller = new AbortController(); controller.abort();
  const aborted = await verifyPhotoNotificationRecoveryBackupData({ ...f.options, signal: controller.signal });
  assert.equal(aborted.complete, false); assert.equal(aborted.issues[0].code, "aborted"); assert.equal(f.calls.length, callsBefore);
  assert.deepEqual(f.keys, before);
});

function broadcastFixture() {
  const f = crmFixture(), binding = { campaignId: id(20), adminId: id(1) };
  const payload = { title: "Synthetic private campaign", body: "Synthetic broadcast only", mediaId: null, allowRepeatMedia: false,
    conversationIds: [id(10).toString("hex"), id(11).toString("hex")] };
  f.rows.broadcast_campaigns = [{ id: binding.campaignId, admin_id: binding.adminId, encrypted: sealPayload(payload, f.keys.messageKey, binding),
    request_fingerprint: campaignFingerprint(payload, f.keys.messageKey, binding), media_id: null, allow_repeat_media: 0 }];
  f.rows.broadcast_recipients = payload.conversationIds.map(value => ({ conversation_id: Buffer.from(value, "hex") }));
  f.rows.broadcast_preferences = [{ id: id(2) }];
  return { ...f, payload };
}

test("the broadcast recovery verifier authenticates campaigns, complete audiences, notes, reset and Push with the same six keys and SELECT only", async () => {
  const f = broadcastFixture(), before = copyKeys(f.keys), result = await verifyPhotoNotificationRecoveryCrmBroadcastBackupData(f.options);
  assert.equal(result.healthy, true); assert.equal(result.complete, true); assert.deepEqual(result.issues, []);
  assert.equal(result.counts.broadcast, 1); assert.equal(result.counts.broadcastRecipients, 2);
  assert.equal(result.counts.crm, 1); assert.equal(result.counts.reset, 1); assert.equal(result.counts.notificationJobs, 1);
  assert.equal(f.calls.filter(({ sql }) => sql.startsWith("SELECT EXISTS")).length, 0); assert.deepEqual(f.keys, before);
  for (const value of [f.payload.body, f.payload.title, f.notes, ...Object.values(f.keys).map(key => key.toString("base64url"))])
    assert.equal(JSON.stringify(result).includes(value), false);
});

test("broadcast backup refuses changed keys, ciphertext, owner, audience, media or fingerprint without touching caller secrets", async () => {
  for (const change of ["key", "ciphertext", "owner", "audience", "missingRecipient", "media", "fingerprint", "repeat"]) {
    const f = broadcastFixture(), row = f.rows.broadcast_campaigns[0];
    if (change === "key") f.keys.messageKey = randomBytes(32);
    if (change === "ciphertext") { const parts = row.encrypted.split("."), tag = Buffer.from(parts[3], "base64url"); tag[0] ^= 1; parts[3] = tag.toString("base64url"); row.encrypted = parts.join("."); }
    if (change === "owner") row.admin_id = id(19);
    if (change === "audience") f.rows.broadcast_recipients.reverse();
    if (change === "missingRecipient") f.rows.broadcast_recipients.pop();
    if (change === "media") row.media_id = id(25);
    if (change === "fingerprint") row.request_fingerprint = randomBytes(32);
    if (change === "repeat") row.allow_repeat_media = 1;
    const before = copyKeys(f.keys), result = await verifyPhotoNotificationRecoveryCrmBroadcastBackupData(f.options);
    assert.equal(result.healthy, false, change); assert.ok(result.issues.some(issue => issue.purpose === "broadcast"), change);
    assert.deepEqual(f.keys, before);
  }
});
