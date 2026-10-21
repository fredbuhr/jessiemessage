import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { makeTotpSecret, newToken, sealTotpSecret, tokenDigest } from "../server/auth/crypto.mjs";
import { sealVerificationPayload } from "../server/mail/crypto.mjs";
import { encryptMessageBody, messageFingerprint } from "../server/chat/crypto.mjs";
import { verifyTextBackupData } from "../server/backup/verify.mjs";

const id = (number) => { const value = Buffer.alloc(16); value.writeUInt32BE(number, 12); return value; };
const inactive = { notifications: ["push_subscriptions", "push_outbox"], reset: ["client_password_resets", "password_reset_outbox"], crm: ["crm_profiles", "crm_labels", "crm_memberships"],
  broadcast: ["broadcast_preferences", "broadcast_campaigns", "broadcast_recipients"], announcements: ["announcements"], tasks: ["crm_tasks"],
  media: ["media_assets", "message_media", "media_storage_state", "media_storage_objects"] };

function fixture() {
  const keys = Object.fromEntries(["totpKey", "mailKey", "messageKey"].map((name) => [name, randomBytes(32)]));
  const adminId = id(1), clientId = id(2), conversationId = id(3), mailId = id(4), messageId = id(5);
  const secret = makeTotpSecret(), token = newToken(), email = "private-recipient@example.invalid", body = "Private synthetic restored text <&>";
  const binding = { messageId, conversationId, senderId: clientId };
  const rows = {
    admin_mfa: [{ id: adminId, encrypted: sealTotpSecret(secret, keys.totpKey, adminId) }],
    mail_outbox: [{ id: mailId, encrypted: sealVerificationPayload({ email, token }, keys.mailKey, mailId),
      recipient_user_id: clientId, challenge_user_id: clientId, token_hash: tokenDigest(token), recipient_email: email }],
    messages: [{ id: messageId, conversation_id: conversationId, sender_id: clientId, sender_role: "client", admin_id: adminId, client_id: clientId,
      encrypted: encryptMessageBody(body, keys.messageKey, binding), body_fingerprint: messageFingerprint(body, keys.messageKey, binding),
      deleted_at: null, media_id: null, media_owner_id: null }],
  };
  const populated = new Set(), calls = [], state = { acquired: 0, released: 0, failRelease: false, failQuery: false };
  const pool = { getConnection: async () => {
    state.acquired++;
    return { query: async (sql, parameters = []) => {
      assert.match(sql, /^SELECT\s/); assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|CALL)\b/);
      calls.push({ sql, parameters });
      if (state.failQuery) throw new Error(`private SQL failure ${email} ${token}`);
      const table = /\bFROM ([a-z_]+)\b/.exec(sql)?.[1];
      if (sql.startsWith("SELECT EXISTS")) {
        assert.ok(Object.values(inactive).flat().includes(table)); assert.match(sql, /LIMIT 1\) AS present$/);
        return [{ present: populated.has(table) ? 1 : 0 }];
      }
      assert.ok(Object.hasOwn(rows, table)); assert.equal(parameters.at(-1), 51);
      const selected = rows[table].filter((row) => parameters.length === 1 || Buffer.compare(row.id, parameters[0]) > 0);
      return selected.slice(0, parameters.at(-1));
    }, release: async () => { state.released++; if (state.failRelease) throw new Error(`private release failure ${token}`); } };
  } };
  return { options: { pool, keys }, keys, rows, populated, calls, state, secret, token, email, body };
}

test("text verification uses only three real keys and SELECT-only crypto adapter reads without a media store", async () => {
  const f = fixture(), original = Object.fromEntries(Object.entries(f.keys).map(([name, key]) => [name, Buffer.from(key)])), report = await verifyTextBackupData(f.options);
  assert.deepEqual(Object.keys(report), ["complete", "healthy", "counts", "issues"]);
  assert.equal(report.complete, true); assert.equal(report.healthy, true); assert.deepEqual(report.issues, []);
  assert.deepEqual(report.counts, { rows: 3, mfa: 1, mail: 1, reset: 0, messages: 1, crm: 0, tasks: 0, broadcast: 0, broadcastRecipients: 0, announcements: 0, media: 0, mediaFiles: 0, notifications: 0, notificationJobs: 0 });
  assert.deepEqual(f.keys, original); assert.equal(f.state.acquired, 4); assert.equal(f.state.released, 4);
  assert.equal(f.calls.filter(({ sql }) => sql.startsWith("SELECT EXISTS")).length, 16);
  const json = JSON.stringify(report);
  for (const value of [f.secret, f.token, f.email, f.body, ...Object.values(f.keys).map((key) => key.toString("base64url"))]) assert.equal(json.includes(value), false);
});

test("each incorrect text key fails its actual populated domain without affecting caller keys or exposing values", async () => {
  for (const [keyName, purpose] of [["totpKey", "mfa"], ["mailKey", "mail"], ["messageKey", "messages"]]) {
    const f = fixture(), wrong = randomBytes(32), original = Buffer.from(wrong);
    const report = await verifyTextBackupData({ ...f.options, keys: { ...f.keys, [keyName]: wrong } });
    assert.equal(report.complete, true); assert.equal(report.healthy, false);
    assert.deepEqual(report.issues, [{ purpose, code: "verification_failed" }]); assert.deepEqual(wrong, original);
    assert.equal(JSON.stringify(report).includes(wrong.toString("base64url")), false);
  }
});

test("restored text remains bound to message, conversation, author and fingerprint, and mail to its recipient/token", async () => {
  for (const [field, value] of [["id", id(50)], ["conversation_id", id(30)], ["sender_id", id(20)], ["body_fingerprint", randomBytes(32)]]) {
    const f = fixture(); f.rows.messages[0][field] = value;
    const report = await verifyTextBackupData(f.options); assert.equal(report.healthy, false);
    assert.ok(report.issues.some((issue) => issue.purpose === "messages"));
  }
  for (const [field, value] of [["recipient_email", "other@example.invalid"], ["token_hash", randomBytes(32)], ["challenge_user_id", id(99)]]) {
    const f = fixture(); f.rows.mail_outbox[0][field] = value;
    const report = await verifyTextBackupData(f.options); assert.equal(report.healthy, false);
    assert.ok(report.issues.some((issue) => issue.purpose === "mail"));
  }
});

test("every table of disabled domains is checked, including deleted media metadata, reservations, labels and reset challenges", async () => {
  for (const [purpose, tables] of Object.entries(inactive)) for (const table of tables) {
    const f = fixture(); f.populated.add(table);
    const report = await verifyTextBackupData(f.options);
    assert.equal(report.complete, false); assert.equal(report.healthy, false);
    assert.deepEqual(report.issues, [{ purpose, code: "inactive_domain_populated" }]);
    assert.equal(report.counts.rows, 0, "incompatible domains stop before encrypted content is read");
    assert.equal(f.state.released, 1); assert.equal(f.calls.some(({ sql }) => sql.includes("FROM admin_mfa ")), false);
  }
});

test("a photo reference is incompatible even in a deleted message or an inconsistent empty-domain projection", async () => {
  for (const deleted of [false, true]) {
    const f = fixture(), row = f.rows.messages[0]; row.media_id = id(8); row.media_owner_id = row.sender_id;
    if (deleted) { row.deleted_at = "2026-10-16 10:00:00.000000"; row.encrypted = null; }
    const report = await verifyTextBackupData(f.options);
    assert.equal(report.healthy, false); assert.deepEqual(report.issues, [{ purpose: "messages", code: "inactive_domain_populated" }]);
  }
});

test("text verification preserves bounded pagination and row limits for retained messages and tombstones", async () => {
  const f = fixture(); f.rows.admin_mfa = []; f.rows.mail_outbox = [];
  f.rows.messages = Array.from({ length: 105 }, (_, index) => ({ ...f.rows.messages[0], id: id(index + 100),
    encrypted: null, deleted_at: "2026-10-16 10:00:00.000000" }));
  const report = await verifyTextBackupData(f.options); assert.equal(report.healthy, true); assert.equal(report.counts.messages, 105);
  assert.equal(f.calls.filter(({ sql }) => sql.includes("FROM messages ")).length, 3);
  const limited = await verifyTextBackupData({ ...f.options, limits: { maxRows: 100 } });
  assert.equal(limited.complete, false); assert.equal(limited.counts.rows, 100); assert.deepEqual(limited.issues, [{ purpose: "messages", code: "row_limit" }]);
});

test("missing/extra/colliding keys cannot trigger reads; abort and read/cleanup failures return only fixed incomplete reports", async () => {
  for (const transform of [(keys) => { delete keys.mailKey; }, (keys) => { keys.mediaKey = randomBytes(32); }, (keys) => { keys.mailKey = keys.messageKey; }]) {
    const f = fixture(), keys = { ...f.keys }; transform(keys);
    const report = await verifyTextBackupData({ ...f.options, keys });
    assert.deepEqual(report.issues, [{ purpose: "verification", code: "invalid_configuration" }]); assert.equal(f.state.acquired, 0);
  }
  const aborted = fixture(), controller = new AbortController(); controller.abort();
  const report = await verifyTextBackupData({ ...aborted.options, signal: controller.signal });
  assert.equal(report.complete, false); assert.equal(aborted.state.acquired, 0); assert.deepEqual(report.issues, [{ purpose: "verification", code: "aborted" }]);
  for (const flag of ["failQuery", "failRelease"]) {
    const f = fixture(); f.state[flag] = true;
    const result = await verifyTextBackupData(f.options); assert.equal(result.complete, false); assert.equal(result.healthy, false);
    assert.equal(f.state.released, 1); assert.equal(result.issues.at(-1).code, "verification_unavailable");
    for (const value of [f.email, f.token, "private SQL", "private release"]) assert.equal(JSON.stringify(result).includes(value), false);
  }
});
