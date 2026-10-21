import test from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { validateAudience, validateCampaign, validatePayload, validatePreview } from "../server/broadcast/validation.mjs";
import { campaignFingerprint, createAudienceDigest, openPayload, recipientProof, sealPayload, verifyRecipientProof } from "../server/broadcast/crypto.mjs";
import { createBroadcastWorker } from "../server/broadcast/worker.mjs";
import { createBackupCryptoStore } from "../server/backup/crypto-store.mjs";
import { verifyBackupData } from "../server/backup/verify.mjs";

const id = n => { const b = Buffer.alloc(16); b.writeUInt32BE(n, 12); return b; };
const key = Buffer.alloc(32, 7), binding = { campaignId: id(1), adminId: id(2) };
const filters = { q: "", tagId: null, groupId: null, access: "all", unread: false, reminder: "all" };
function snapshot(size = 250) {
  const digest = createAudienceDigest(), recipients = [];
  for (let n = 1; n <= size; n++) {
    const recipient = { conversationId: id(n + 100), clientId: id(n + 10000), messageId: id(n + 20000) };
    digest.update(recipient.conversationId, recipient.clientId);
    recipients.push({ ...recipient, proof: recipientProof(key, { ...binding, ...recipient }),
      actualClientId: recipient.clientId, actualAdminId: binding.adminId });
  }
  const payload = { version: 2, title: "Synthetic compact campaign", body: "Synthetic body", mediaId: null,
    allowRepeatMedia: false, audience: { mode: "all", count: size, digest: digest.digest(), selectorHash: "a".repeat(64) } };
  return { recipients, payload };
}

test("compact audience selectors preserve legacy limits and accept a transport-bounded selection of 2500", () => {
  const conversationIds = Array.from({ length: 2500 }, (_, n) => id(n + 1).toString("hex"));
  const input = { mode: "selected", conversationIds: [...conversationIds].reverse() };
  assert.deepEqual(validateAudience(input), { mode: "selected", conversationIds });
  assert.equal(input.conversationIds[0], conversationIds.at(-1), "canonicalization never mutates the caller");
  assert.deepEqual(validateAudience({ mode: "all" }), { mode: "all" });
  assert.deepEqual(validateAudience({ mode: "filtered", filters: { ...filters, q: " Cafe\u0301 " } }),
    { mode: "filtered", filters: { ...filters, q: "Café" } });
  assert.deepEqual(validatePreview({ audience: { mode: "all" }, mediaId: null }), { audience: { mode: "all" }, mediaId: null });
  const campaign = validateCampaign({ clientCampaignId: id(9).toString("hex"), title: "Title", body: "Body", mediaId: null,
    allowRepeatMedia: false, audience: input, previewToken: "p2.synthetic-proof" });
  assert.deepEqual(campaign.clientCampaignId, id(9)); assert.equal(campaign.audience.conversationIds.length, 2500);
  assert.throws(() => validatePreview({ conversationIds: conversationIds.slice(0, 101), mediaId: null }), { code: "BROADCAST_INPUT" });
  for (const value of [{ mode: "all", extra: true }, { mode: "selected", conversationIds: [] },
    { mode: "selected", conversationIds: [conversationIds[0], conversationIds[0]] }, { mode: "selected", conversationIds: Array(40000) },
    { mode: "filtered", filters: { ...filters, unread: 1 } }, { mode: "filtered", filters: { ...filters, access: "anything" } },
    { mode: "filtered", filters: { ...filters, q: "private\u0000" } }, { mode: "filtered", filters: { ...filters, another: 1 } }])
    assert.throws(() => validateAudience(value), { code: "BROADCAST_INPUT" });
  const getter = Object.defineProperty({}, "mode", { enumerable: true, get() { throw Error("must not execute"); } });
  assert.throws(() => validateAudience(getter), { code: "BROADCAST_INPUT" });
});

test("compact payloads authenticate bounded v2 metadata and keep v1 ciphertext readable", () => {
  const { payload } = snapshot(2500), encrypted = sealPayload(payload, key, binding);
  assert.match(encrypted, /^v2\./); assert.ok(encrypted.length < 1000);
  assert.deepEqual(openPayload(encrypted, key, binding), payload);
  assert.throws(() => openPayload(encrypted.replace(/^v2\./, "v1."), key, binding), { code: "BROADCAST_CRYPTO" });
  const legacy = { title: "Legacy", body: "Still readable", mediaId: null, allowRepeatMedia: false, conversationIds: [id(3).toString("hex")] };
  const oldEncrypted = sealPayload(legacy, key, binding);
  assert.match(oldEncrypted, /^v1\./); assert.deepEqual(openPayload(oldEncrypted, key, binding), legacy);
  assert.deepEqual(campaignFingerprint(legacy, key, binding), createHmac("sha256", key)
    .update("jessiemessage:broadcast-fingerprint:v1:").update(binding.adminId).update(JSON.stringify(legacy)).digest());
  for (const audience of [{ ...payload.audience, count: 0 }, { ...payload.audience, count: 1.5 },
    { ...payload.audience, digest: "A".repeat(64) }, { ...payload.audience, selectorHash: "x" }])
    assert.throws(() => validatePayload({ ...payload, audience }), { code: "BROADCAST_INPUT" });
  assert.throws(() => validatePayload({ ...payload, conversationIds: [] }), { code: "BROADCAST_INPUT" });
});

test("streamed audience digests and recipient proofs bind order and every durable member identity", () => {
  const a = id(5), b = id(6), digest = createAudienceDigest();
  digest.update(a, b);
  assert.equal(digest.count, 1);
  assert.equal(digest.digest(), createHash("sha256").update("jessiemessage:broadcast-audience:v2:").update(a).update(b).digest("hex"));
  assert.throws(() => digest.update(id(7), id(8)), { code: "BROADCAST_CRYPTO" });
  const ordered = createAudienceDigest(); ordered.update(a, b);
  assert.throws(() => ordered.update(a, id(8)), { code: "BROADCAST_CRYPTO" });
  const member = { ...binding, conversationId: a, clientId: b, messageId: id(7) };
  const proof = recipientProof(key, member);
  assert.deepEqual(proof, createHmac("sha256", key).update("jessiemessage:broadcast-recipient:v2:")
    .update(member.campaignId).update(member.adminId).update(a).update(b).update(member.messageId).digest().subarray(0, 16));
  assert.equal(verifyRecipientProof(key, member, proof), true);
  for (const field of ["campaignId", "adminId", "conversationId", "clientId", "messageId"])
    assert.equal(verifyRecipientProof(key, { ...member, [field]: id(900) }, proof), false, field);
  assert.equal(verifyRecipientProof(Buffer.alloc(32, 8), member, proof), false);
  assert.equal(verifyRecipientProof(key, member, Buffer.alloc(15)), false);
});

function workerFixture(change) {
  const { payload, recipients } = snapshot(1), member = recipients[0];
  const job = { ...binding, ...member, clientMessageId: member.proof, leaseToken: id(99), mediaId: null,
    allowRepeatMedia: false, payloadEncrypted: sealPayload(payload, key, binding) };
  if (change) change(job);
  const calls = [], rates = []; let claimed = false;
  const store = { claim: async () => { if (claimed) return null; claimed = true; return job; },
    deliver: async () => { calls.push("deliver"); return { delivered: true }; },
    defer: async () => { calls.push("defer"); return true; }, fail: async () => { calls.push("fail"); return true; } };
  const worker = createBroadcastWorker({ key, store, clock: () => 1792580000000,
    authStore: { consumeRateLimit: async (bucket, options) => { rates.push({ bucket, options }); return { allowed: true }; } } });
  return { worker, job, calls, rates };
}
test("compact worker uses a separate 120/minute budget and rejects substituted members before any rate budget", async () => {
  const valid = workerFixture(); assert.deepEqual(await valid.worker.runOnce(), { delivered: 1, deferred: 0, failed: 0 });
  assert.deepEqual(valid.rates.map(row => row.options.limit), [120, 300]);
  assert.deepEqual(valid.rates[0].bucket, createHmac("sha256", key).update("jessiemessage:broadcast-delivery-rate:v2:")
    .update("user-send").update("\0").update(binding.adminId.toString("hex")).digest());
  for (const field of ["campaignId", "adminId", "conversationId", "clientId", "messageId", "clientMessageId"]) {
    const f = workerFixture(job => { job[field] = id(999); });
    assert.deepEqual(await f.worker.runOnce(), { delivered: 0, deferred: 0, failed: 1 }, field);
    assert.deepEqual(f.calls, ["fail"]); assert.equal(f.rates.length, 0);
  }
});

function verificationFixture(changes = {}) {
  const { payload, recipients } = snapshot(250), row = { id: binding.campaignId, adminId: binding.adminId,
    encrypted: sealPayload(payload, key, binding), fingerprint: campaignFingerprint(payload, key, binding), mediaId: null, allowRepeatMedia: false };
  const pages = [];
  row.recipientPages = async function* () {
    for (let n = 0; n < recipients.length; n += 100) {
      let page = recipients.slice(n, n + 100).map(recipient => ({ ...recipient }));
      if (changes.page) page = changes.page(page, n);
      pages.push(page.length); yield page;
    }
  };
  if (changes.row) changes.row(row);
  const keys = { messageKey: key, totpKey: Buffer.alloc(32, 1), mailKey: Buffer.alloc(32, 2), mediaKey: Buffer.alloc(32, 3), crmKey: Buffer.alloc(32, 4) };
  const options = { keys, storage: { get: async () => { throw Error("no media fixture"); } },
    store: { page: async ({ purpose }) => ({ rows: purpose === "broadcast" ? [row] : [], hasMore: false, nextCursor: null }) } };
  return { options, pages, recipients, row };
}
test("compact verification streams all members with digest/proof checks and preserves row budgets", async () => {
  const f = verificationFixture(), report = await verifyBackupData(f.options);
  assert.equal(report.complete && report.healthy, true); assert.equal(report.counts.broadcastRecipients, 250);
  assert.deepEqual(f.pages, [100, 100, 50]);
  const limited = await verifyBackupData({ ...verificationFixture().options, limits: { maxRows: 2 } });
  assert.equal(limited.complete, false); assert.ok(limited.issues.some(issue => issue.code === "row_limit"));
  for (const change of [
    { page: (page, n) => { if (n === 0) page[0].clientId = id(999); return page; } },
    { page: (page, n) => n === 0 ? page.slice(1) : page },
    { page: (page, n) => n === 0 ? [...page].reverse() : page },
    { row: row => { row.recipientPages = undefined; } },
  ]) {
    const bad = await verifyBackupData(verificationFixture(change).options);
    assert.equal(bad.healthy, false); assert.ok(bad.issues.some(issue => issue.purpose === "broadcast"));
  }
});

test("the SELECT-only compact reader opens bounded member pages after releasing the campaign page connection", async () => {
  const f = verificationFixture(), queries = []; let releases = 0;
  const raw = { id: f.row.id, admin_id: f.row.adminId, encrypted: f.row.encrypted,
    request_fingerprint: f.row.fingerprint, media_id: null, allow_repeat_media: 0 };
  const pool = { getConnection: async () => ({ release() { releases++; }, async query(sql, parameters) {
    queries.push({ sql, parameters });
    if (sql.includes("FROM broadcast_campaigns")) return [raw];
    assert.ok(sql.includes("FROM broadcast_recipients") && sql.includes("LIMIT 100"));
    const after = parameters[1] ?? null;
    return f.recipients.filter(row => after === null || Buffer.compare(row.conversationId, after) > 0).slice(0, 100)
      .map(row => ({ conversation_id: row.conversationId, client_id: row.clientId, proposed_message_id: row.messageId,
        client_message_id: row.proof, actual_client: row.actualClientId, actual_admin: row.actualAdminId }));
  } }) };
  const store = createBackupCryptoStore({ pool }), page = await store.page({ purpose: "broadcast", limit: 1 });
  assert.equal(releases, 1); assert.equal(queries.length, 1); assert.equal(page.rows[0].conversationIds, undefined);
  const sizes = []; for await (const members of page.rows[0].recipientPages()) sizes.push(members.length);
  assert.deepEqual(sizes, [100, 100, 50]); assert.equal(releases, 4);
  assert.ok(queries.every(query => /^SELECT\b/.test(query.sql)));
});
