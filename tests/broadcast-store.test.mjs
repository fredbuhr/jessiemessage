import test from "node:test";
import assert from "node:assert/strict";
import { createBroadcastStore } from "../server/broadcast/store.mjs";

const now = Date.UTC(2026, 9, 15, 12), id = (value) => Buffer.alloc(16, value);
const date = (value) => new Date(value);

function fixture({ waitAt = null, expires = "lease", advance = 1000 } = {}) {
  let at = now, appended = 0;
  const queries = [];
  const job = { campaignId: id(1), adminId: id(2), conversationId: id(3), clientId: id(4), messageId: id(5),
    clientMessageId: id(6), leaseToken: id(7), mfaVersion: 1, mediaId: id(8), allowRepeatMedia: false, payloadEncrypted: "synthetic" };
  const campaign = { id: job.campaignId, admin_id: job.adminId, mfa_version: 1, status: "running", created_at: date(now),
    expires_at: date(now + (expires === "campaign" ? 1000 : 86400000)), payload_encrypted: job.payloadEncrypted, allow_repeat_media: 0, media_id: job.mediaId };
  const recipient = { conversation_id: job.conversationId, client_id: job.clientId, created_at: date(now), available_at: date(now), state: "sending", lease_token: job.leaseToken,
    lease_until: date(now + (expires === "lease" ? 1000 : 120000)), proposed_message_id: job.messageId, client_message_id: job.clientMessageId };
  const client = { id: job.clientId, role: "client", status: "active", invitation_consumed_at: date(now), email_verified_at: date(now),
    access_approved_at: date(now), access_expires_at: expires === "access" ? date(now + 1000) : null };
  const connection = { async query(sql, parameters) {
    queries.push({ sql, parameters });
    const stage = sql.startsWith("SELECT * FROM broadcast_campaigns") ? "campaign"
      : sql.startsWith("SELECT * FROM broadcast_recipients") ? "recipient"
      : sql.startsWith("SELECT id, owner_id") ? "media" : sql.startsWith("SELECT 1 FROM message_media") ? "repeat" : null;
    if (stage === waitAt) { await Promise.resolve(); at = now + advance; }
    if (stage === "campaign") return [campaign];
    if (stage === "recipient") return [recipient];
    if (sql.startsWith("SELECT r.campaign_id")) return [{ campaign_id: job.campaignId, admin_id: job.adminId, conversation_id: job.conversationId, client_id: job.clientId, mfa_version: 1 }];
    if (stage === "media") return [{ id: job.mediaId, owner_id: job.adminId, owner_role: "admin", created_at: date(now), deleted_at: null }];
    if (stage === "repeat") return [];
    if (sql.startsWith("SELECT COUNT(*)")) return [{ value: 0 }];
    if (sql.startsWith("UPDATE")) return { affectedRows: 1 };
    throw new Error(`Unexpected query: ${sql}`);
  } };
  const chatStore = { withActor() { throw new Error("unused"); }, async withBroadcastDelivery(_request, operation) {
    const before = appended;
    const context = { now, reason: null, canSend: true, client, conversation: { id: job.conversationId,
      admin_id: job.adminId, client_id: job.clientId, created_at: date(now), closed_at: null } };
    try { return await operation(connection, context, async () => {
      appended += 1; if (waitAt === "append") at = now + advance;
      return { message: { id: job.messageId }, duplicate: false };
    }); } catch (error) { appended = before; throw error; }
  } };
  const store = createBroadcastStore({ getConnection: async () => ({ ...connection, release() {} }) }, { chatStore, mediaEnabled: true, clock: () => at });
  return { store, job, recipient, queries, appended: () => appended,
    deliver: () => store.deliver(job, { now, message: { id: job.messageId, clientMessageId: job.clientMessageId, mediaId: job.mediaId } }) };
}

for (const waitAt of ["campaign", "recipient", "media", "repeat", "append"]) {
  for (const expires of ["lease", "campaign", "access"]) {
    test(`broadcast ${expires} expiration during ${waitAt} SQL work prevents delivery`, async () => {
      const f = fixture({ waitAt, expires });
      assert.deepEqual(await f.deliver(), { delivered: false });
      assert.equal(f.appended(), 0, "the ordinary message must not commit");
    });
  }
}

test("a valid broadcast surviving a SQL wait still delivers once with the final timestamp", async () => {
  const f = fixture({ waitAt: "media", advance: 999 });
  assert.deepEqual(await f.deliver(), { delivered: true, duplicate: false });
  assert.equal(f.appended(), 1);
  const delivery = f.queries.find(({ sql }) => sql.startsWith("UPDATE broadcast_recipients SET state = 'delivered'"));
  assert.equal(delivery.parameters[1], "2026-10-15 12:00:00.999000");
});

test("a changed lease token remains unable to append even before expiration", async () => {
  const f = fixture(); f.recipient.lease_token = id(9);
  assert.deepEqual(await f.deliver(), { delivered: false }); assert.equal(f.appended(), 0);
});

for (const waitAt of ["campaign", "recipient", "media", "repeat"]) {
  test(`claim refuses a campaign expiring during ${waitAt} SQL work`, async () => {
    const f = fixture({ waitAt, expires: "campaign" }); f.recipient.state = "pending";
    assert.equal(await f.store.claim({ now, leaseMilliseconds: 1000 }), null);
    assert.equal(f.queries.some(({ sql }) => sql.startsWith("UPDATE broadcast_recipients SET state = 'sending'")), false);
  });
}

test("a valid claim measures its new lease from the final time after media SQL work", async () => {
  const f = fixture({ waitAt: "media", advance: 999 }); f.recipient.state = "pending";
  const claimed = await f.store.claim({ now, leaseMilliseconds: 1000 });
  assert.ok(claimed.messageId.equals(f.job.messageId));
  const lease = f.queries.find(({ sql }) => sql.startsWith("UPDATE broadcast_recipients SET state = 'sending'"));
  assert.equal(lease.parameters[1], "2026-10-15 12:00:01.999000");
});
