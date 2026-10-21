import test from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { createBroadcastService, BroadcastError } from "../server/broadcast/service.mjs";
import { openPayload, sealPayload, campaignFingerprint, createAudienceDigest } from "../server/broadcast/crypto.mjs";
import { newToken, tokenDigest } from "../server/auth/crypto.mjs";

const now = 1750000000000, adminId = Buffer.alloc(16, 1), clientId = Buffer.alloc(16, 2), conversationId = Buffer.alloc(16, 3);
const conversationHex = conversationId.toString("hex"), adminHex = adminId.toString("hex"), campaignId = Buffer.alloc(16, 4);
const hasCode = (code) => (error) => error instanceof BroadcastError && error.code === code;
const input = (changes = {}) => ({ clientCampaignId: "5".repeat(32), title: "Invitation privée", body: "Bonjour !", mediaId: null,
  allowRepeatMedia: false, conversationIds: [conversationHex], ...changes });

async function fixture({ mediaEnabled = false } = {}) {
  const key = randomBytes(32), token = newToken(), calls = [], authCalls = [], rateCalls = [];
  const { clientCampaignId, ...payload } = input();
  const state = { actor: { user: { id: adminHex, role: "admin", pseudonym: "Jess", email: "private@example.invalid" }, csrf: newToken(), expiresAt: now + 10000 },
    rates: [], error: null, authError: null,
    preview: { recipients: [{ conversationId, client: { id: clientId, pseudonym: "Client", email: "private@example.invalid" }, eligible: true, reason: null, repeatMedia: false, privateNotes: "private-notes" }], eligibleCount: 1, repeatCount: 0 },
    campaign: { id: campaignId, clientCampaignId: Buffer.from(clientCampaignId, "hex"), payloadEncrypted: sealPayload(payload, key, { campaignId, adminId }), mediaId: null,
      allowRepeatMedia: false, status: "queued", createdAt: now, updatedAt: now, expiresAt: now + 604800000,
      counts: { total: 1, pending: 1, sending: 0, delivered: 0, skipped: 0, cancelled: 0, failed: 0 },
      recipients: [{ conversationId, client: { id: clientId, pseudonym: "Client", email: "private@example.invalid" }, state: "pending", reason: null, messageId: null, deliveredAt: null }],
      adminId, mfaVersion: 5, privateProof: "private-proof" } };
  const record = (name, options) => { calls.push({ name, options }); if (state.error) throw state.error; };
  const store = {
    preview: async (options) => { record("preview", options); return state.preview; },
    create: async (options) => { record("create", options); if (state.createResult) return state.createResult;
      state.campaign = { ...state.campaign, ...options.campaign }; return { campaign: state.campaign, duplicate: false, privateProof: "private-proof" }; },
    activity: async (options) => { record("activity", options); return state.activity ?? { campaigns: [state.campaign] }; },
    list: async (options) => { record("list", options); return state.page ?? { campaigns: [state.campaign], nextCursor: null, hasMore: false }; },
    get: async (options) => { record("get", options); return state.campaign; },
    cancel: async (options) => { record("cancel", options); return state.campaign; },
  };
  const authService = { session: async (raw) => { authCalls.push(raw); if (state.authError) throw state.authError; return state.actor; } };
  const authStore = { consumeRateLimit: async (bucket, options) => { rateCalls.push({ bucket, options }); return state.rates.shift() ?? { allowed: true }; } };
  const options = { store, authService, authStore, key, mediaEnabled, clock: () => now };
  return { key, token, state, calls, authCalls, rateCalls, store, authStore, options, service: await createBroadcastService(options) };
}

const contextCommands = [
  { name: "preview", storeMethod: "preview", budgets: 2, invoke: (service, token) => service.preview(token, { conversationIds: [conversationHex], mediaId: null }) },
  { name: "create", storeMethod: "create", budgets: 1, mutation: true, invoke: (service, token) => service.create(token, input()) },
  { name: "activity", storeMethod: "activity", budgets: 2, invoke: (service, token) => service.activity(token) },
  { name: "list", storeMethod: "list", budgets: 2, invoke: (service, token) => service.list(token) },
  { name: "get", storeMethod: "get", budgets: 2, invoke: (service, token) => service.get(token, campaignId.toString("hex")) },
  { name: "cancel", storeMethod: "cancel", budgets: 1, mutation: true, invoke: (service, token) => service.cancel(token, campaignId.toString("hex")) },
];

function heldBudget(f, count) {
  let release, notify, consumed = 0;
  const hold = new Promise((resolve) => { release = resolve; });
  const blocked = new Promise((resolve) => { notify = resolve; });
  return { blocked, release, authStore: { consumeRateLimit: async (...args) => {
    const result = await f.authStore.consumeRateLimit(...args);
    if (++consumed === count) { notify(); await hold; }
    return result;
  } } };
}

test("broadcast service requires fixed key, complete dependencies and explicit valid options", async () => {
  const f = await fixture();
  for (const key of [undefined, null, f.key.toString("hex"), Buffer.alloc(31), Buffer.alloc(33)]) await assert.rejects(createBroadcastService({ ...f.options, key }), hasCode("BROADCAST_CONFIG"));
  for (const dependency of ["store", "authStore", "authService"]) await assert.rejects(createBroadcastService({ ...f.options, [dependency]: null }), hasCode("BROADCAST_CONFIG"));
  for (const method of Object.keys(f.store)) await assert.rejects(createBroadcastService({ ...f.options, store: { ...f.store, [method]: undefined } }), hasCode("BROADCAST_CONFIG"));
  for (const changes of [{ mediaEnabled: "1" }, { clock: null }]) await assert.rejects(createBroadcastService({ ...f.options, ...changes }), hasCode("BROADCAST_CONFIG"));
  assert.ok(Object.isFrozen(f.service));
});

test("broadcast service has no client surface or preference mutation", async () => {
  const f = await fixture();
  assert.equal(f.service.preference, undefined); assert.equal(f.service.savePreference, undefined);
  await assert.rejects(f.service.actor("client", f.token), hasCode("BROADCAST_UNAUTHORIZED"));
  assert.deepEqual(f.authCalls, []); assert.deepEqual(f.calls, []); assert.deepEqual(f.rateCalls, []);
});

test("invalid or wrong-role admin sessions reject before campaign access", async () => {
  const f = await fixture();
  f.state.actor = null; await assert.rejects(f.service.list(f.token), hasCode("BROADCAST_UNAUTHORIZED"));
  f.state.actor = { user: { id: adminHex, role: "client", pseudonym: "Wrong role" }, csrf: newToken(), expiresAt: now + 10000 };
  await assert.rejects(f.service.actor("admin", f.token), hasCode("BROADCAST_UNAUTHORIZED"));
  for (const token of [undefined, null, "", "a".repeat(42), `${f.token}=`, `${f.token}\n`]) await assert.rejects(f.service.actor("admin", token), hasCode("BROADCAST_UNAUTHORIZED"));
  assert.deepEqual(f.calls, []); assert.equal(f.rateCalls.length, 0);
});

test("broadcast preview and history expose canonical DTOs without private audience metadata", async () => {
  const f = await fixture(), actor = await f.service.actor("admin", f.token);
  assert.deepEqual(Object.keys(actor.user).sort(), ["id", "pseudonym", "role"]);
  const preview = await f.service.preview(f.token, { conversationIds: [conversationHex], mediaId: null });
  assert.deepEqual(preview, { recipients: [{ conversationId: conversationHex, client: { id: clientId.toString("hex"), pseudonym: "Client" }, eligible: true, reason: null, repeatMedia: false }], eligibleCount: 1, repeatCount: 0 });
  const page = await f.service.list(f.token), detail = await f.service.get(f.token, campaignId.toString("hex"));
  assert.equal(page.campaigns[0].body, input().body); assert.equal(detail.recipients[0].client.pseudonym, "Client");
  const json = JSON.stringify([actor, preview, page, detail]);
  for (const forbidden of ["private@example.invalid", "private-notes", "private-proof", "payloadEncrypted", "mfaVersion", "adminId", "requestFingerprint"]) assert.equal(json.includes(forbidden), false);
  for (const { options } of f.calls) { assert.deepEqual(options.tokenHash, tokenDigest(f.token)); assert.equal(options.now, now); assert.equal(options.token, undefined); }
});

test("broadcast creation encrypts and fingerprints a fixed sorted payload while regenerating safe retry proposals", async () => {
  const f = await fixture(), first = await f.service.create(f.token, input()), firstCommand = f.calls.at(-1).options.campaign;
  const payload = openPayload(firstCommand.payloadEncrypted, f.key, { campaignId: firstCommand.id, adminId });
  const { clientCampaignId, ...expected } = input();
  assert.deepEqual(payload, expected); assert.deepEqual(firstCommand.requestFingerprint, campaignFingerprint(expected, f.key, { adminId }));
  assert.equal(first.campaign.clientCampaignId, clientCampaignId); assert.equal(first.duplicate, false);
  assert.deepEqual(firstCommand.recipients[0].conversationId, conversationId);
  for (const id of [firstCommand.id, firstCommand.recipients[0].messageId, firstCommand.recipients[0].clientMessageId]) assert.equal(id.length, 16);
  assert.equal(JSON.stringify(firstCommand).includes(input().body), false);
  f.state.createResult = { campaign: f.state.campaign, duplicate: true };
  const retry = await f.service.create(f.token, input()), retryCommand = f.calls.at(-1).options.campaign;
  assert.equal(retry.duplicate, true); assert.deepEqual(retry.campaign, first.campaign);
  assert.notDeepEqual(retryCommand.id, firstCommand.id); assert.deepEqual(retryCommand.requestFingerprint, firstCommand.requestFingerprint);
  assert.notDeepEqual(retryCommand.recipients[0].messageId, firstCommand.recipients[0].messageId);
  assert.throws(() => openPayload(firstCommand.payloadEncrypted, f.key, { campaignId: retryCommand.id, adminId }));
});

test("broadcast service quotas are opaque scoped and reject before private data access", async () => {
  const f = await fixture();
  await f.service.list(f.token); await f.service.cancel(f.token, campaignId.toString("hex"));
  const expected = [["global-read", "all", 300], ["user-read", adminHex, 120], ["user-write", adminHex, 30]];
  for (const [index, [name, identity, limit]] of expected.entries()) {
    assert.deepEqual(f.rateCalls[index].bucket, createHmac("sha256", f.key).update("jessiemessage:broadcast-rate:v1:").update(name).update("\0").update(identity).digest());
    assert.deepEqual(f.rateCalls[index].options, { now, windowSeconds: 60, limit });
  }
  const count = f.calls.length;
  f.state.rates = [{ allowed: false, retryAfter: 29 }];
  await assert.rejects(f.service.list(f.token), (error) => hasCode("BROADCAST_RATE_LIMIT")(error) && error.retryAfter === 29);
  assert.equal(f.calls.length, count);
  f.state.rates = [{ allowed: "true" }];
  await assert.rejects(f.service.list(f.token), hasCode("BROADCAST_UNAVAILABLE"));
});

test("every broadcast context rechecks the operation time after a held quota crosses session expiry", async () => {
  for (const command of contextCommands) {
    const f = await fixture(), budget = heldBudget(f, command.budgets), observed = [], durable = [];
    let currentTime = now;
    const original = f.store[command.storeMethod], expiresAt = now + 10000;
    const store = { ...f.store, [command.storeMethod]: async (options) => {
      observed.push(options);
      if (options.now >= expiresAt) throw Object.assign(new Error("Current session expired"), { code: "CHAT_UNAUTHORIZED" });
      if (command.mutation) durable.push(command.name);
      return original(options);
    } };
    const service = await createBroadcastService({ ...f.options, store, authStore: budget.authStore, clock: () => currentTime });
    const pending = command.invoke(service, f.token);
    await budget.blocked;
    assert.deepEqual(observed, [], `${command.name}: private access must wait for all budgets`);
    assert.equal(f.rateCalls.length, command.budgets, command.name);
    currentTime = expiresAt + 1;
    budget.release();
    await assert.rejects(pending, hasCode("BROADCAST_UNAUTHORIZED"), command.name);
    assert.equal(observed.length, 1, command.name);
    assert.equal(observed[0].now, currentTime, `${command.name}: store must receive the final time`);
    assert.deepEqual(observed[0].tokenHash, tokenDigest(f.token), command.name);
    assert.deepEqual(durable, [], `${command.name}: expired authorization must not commit a mutation`);
  }
});

test("every broadcast context rejects a clock that becomes invalid during quota waits before operation access", async () => {
  for (const command of contextCommands) {
    for (const invalidTime of [NaN, -1, now + 0.5, 253402300800000]) {
      const f = await fixture(), budget = heldBudget(f, command.budgets), observed = [];
      let currentTime = now;
      const original = f.store[command.storeMethod];
      const store = { ...f.store, [command.storeMethod]: async (options) => { observed.push(options); return original(options); } };
      const service = await createBroadcastService({ ...f.options, store, authStore: budget.authStore, clock: () => currentTime });
      const pending = command.invoke(service, f.token);
      await budget.blocked;
      const before = f.calls.length;
      assert.deepEqual(observed, [], command.name);
      assert.equal(f.rateCalls.length, command.budgets, command.name);
      currentTime = invalidTime;
      budget.release();
      await assert.rejects(pending, hasCode("BROADCAST_UNAVAILABLE"), `${command.name}: ${invalidTime}`);
      assert.deepEqual(observed, [], `${command.name}: invalid final time must not reach the operation store`);
      assert.equal(f.calls.length, before, command.name);
    }
  }
});

test("creation rejects a cryptographically valid store response for a different confirmed immutable payload", async () => {
  const f = await fixture();
  for (const changes of [{ title: "Different title" }, { body: "Different body" }, { conversationIds: [clientId.toString("hex")] }, { allowRepeatMedia: true }]) {
    const { clientCampaignId, ...payload } = input(changes);
    f.state.createResult = { campaign: { ...f.state.campaign, allowRepeatMedia: payload.allowRepeatMedia,
      payloadEncrypted: sealPayload(payload, f.key, { campaignId, adminId }) }, duplicate: true };
    await assert.rejects(f.service.create(f.token, input()), hasCode("BROADCAST_UNAVAILABLE"));
  }
});

test("malformed input and disabled media reject before any actor lookup or quota", async () => {
  const f = await fixture();
  for (const value of [null, [], {}, input({ conversationIds: [] }), input({ body: "" }), { ...input(), owner: adminHex }]) await assert.rejects(f.service.create(f.token, value), hasCode("BROADCAST_INPUT"));
  for (const value of [null, [], "options", { limit: 0 }, { limit: 51 }, { limit: "20" }, { afterId: "A".repeat(32) }, { owner: adminHex }]) await assert.rejects(f.service.list(f.token, value), hasCode("BROADCAST_INPUT"));
  await assert.rejects(f.service.create(f.token, input({ mediaId: conversationHex, body: "" })), hasCode("BROADCAST_MEDIA"));
  await assert.rejects(f.service.preview(f.token, { conversationIds: [conversationHex], mediaId: conversationHex }), hasCode("BROADCAST_MEDIA"));
  assert.equal(f.calls.length, 0); assert.equal(f.authCalls.length, 0); assert.equal(f.rateCalls.length, 0);
});

test("preview mismatches and the retired consent reason fail closed", async () => {
  const f = await fixture();
  const original = f.state.preview;
  for (const changes of [{ eligibleCount: 2 }, { repeatCount: 1 }, { recipients: [original.recipients[0], original.recipients[0]] }, { recipients: [{ ...original.recipients[0], conversationId: clientId }] },
    { recipients: [{ ...original.recipients[0], eligible: true, reason: "opted_out" }] }, { recipients: [{ ...original.recipients[0], repeatMedia: true }] }]) {
    f.state.preview = { ...original, ...changes }; await assert.rejects(f.service.preview(f.token, { conversationIds: [conversationHex], mediaId: null }), hasCode("BROADCAST_UNAVAILABLE"));
  }
});

test("campaign ciphertext tampering, ownership rebinding, counts and malformed details fail closed", async () => {
  const f = await fixture(), original = f.state.campaign;
  const bad = [{ payloadEncrypted: "private-corrupted-envelope" }, { id: clientId }, { mediaId: clientId }, { allowRepeatMedia: true }, { status: "draft" }, { updatedAt: now - 1 },
    { counts: { ...original.counts, total: 2 } }, { counts: { ...original.counts, pending: 0 } }, { counts: { ...original.counts, pending: "1" } }, { recipients: [] },
    { recipients: [{ ...original.recipients[0], state: "delivered", messageId: null, deliveredAt: null }] },
    { recipients: [{ ...original.recipients[0], state: "pending", messageId: Buffer.alloc(16), deliveredAt: now }] },
    { recipients: [{ ...original.recipients[0], reason: "private-SQL-exception" }] }, { recipients: [{ ...original.recipients[0], conversationId: clientId }] },
    { recipients: [{ ...original.recipients[0], state: "delivered", messageId: Buffer.alloc(16), deliveredAt: now }] }];
  for (const changes of bad) {
    f.state.campaign = { ...original, ...changes };
    await assert.rejects(f.service.get(f.token, campaignId.toString("hex")), hasCode("BROADCAST_UNAVAILABLE"));
  }
});

test("history pagination enforces sorted IDs and bound cursors", async () => {
  const f = await fixture();
  for (const page of [{ campaigns: [f.state.campaign, f.state.campaign], hasMore: false, nextCursor: null }, { campaigns: [f.state.campaign], hasMore: true, nextCursor: null },
    { campaigns: [], hasMore: false, nextCursor: campaignId }, { campaigns: [f.state.campaign], hasMore: true, nextCursor: clientId }]) {
    f.state.page = page; await assert.rejects(f.service.list(f.token), hasCode("BROADCAST_UNAVAILABLE"));
  }
  f.state.page = { campaigns: [f.state.campaign], hasMore: true, nextCursor: campaignId };
  assert.equal((await f.service.list(f.token)).nextCursor, campaignId.toString("hex"));
  await assert.rejects(f.service.list(f.token, { afterId: campaignId.toString("hex") }), hasCode("BROADCAST_UNAVAILABLE"));
});

test("known scope failures expose only approved codes and unexpected private backend details are sanitized", async () => {
  const f = await fixture();
  for (const code of ["BROADCAST_NOT_FOUND", "BROADCAST_CONFLICT", "BROADCAST_LIMIT", "BROADCAST_RECIPIENTS", "BROADCAST_REPEAT", "BROADCAST_MEDIA", "BROADCAST_RATE_LIMIT", "CHAT_UNAUTHORIZED", "AUTH_INVALID", "AUTH_BUSY", "ER_PRIVATE_DATABASE_ERROR"]) {
    f.state.error = Object.assign(new Error("SQL private@example.invalid password=private-secret"), { code });
    await assert.rejects(f.service.list(f.token), (error) => {
      const expected = ["CHAT_UNAUTHORIZED", "AUTH_INVALID"].includes(code) ? "BROADCAST_UNAUTHORIZED" : code === "AUTH_BUSY" ? "BROADCAST_RATE_LIMIT" : code.startsWith("BROADCAST_") ? code : "BROADCAST_UNAVAILABLE";
      assert.ok(hasCode(expected)(error)); assert.equal(error.cause, undefined); assert.equal(error.message.includes("private-secret"), false); return true;
    });
  }
});

test("service copies encryption key and rejects invalid clocks before store mutation", async () => {
  const f = await fixture(); f.key.fill(0);
  assert.equal((await f.service.list(f.token)).campaigns[0].body, input().body);
  for (const clock of [() => -1, () => NaN, () => 1.5, () => 253402300800000]) {
    const service = await createBroadcastService({ ...f.options, clock }), before = f.calls.length;
    await assert.rejects(service.cancel(f.token, campaignId.toString("hex")), hasCode("BROADCAST_UNAVAILABLE")); assert.equal(f.calls.length, before);
  }
});

test("live activity authenticates, consumes one read budget and rebuilds a bounded recent/active feed", async () => {
  const f = await fixture();
  const result = await f.service.activity(f.token);
  assert.equal(result.campaigns[0].id, campaignId.toString("hex"));
  assert.deepEqual(f.calls.map((call) => call.name), ["activity"]);
  assert.equal(f.authCalls.length, 1); assert.equal(f.rateCalls.length, 2);
  assert.doesNotMatch(JSON.stringify(result), /private-proof|private@example|payloadEncrypted|recipients/);
  f.state.actor = null;
  await assert.rejects(f.service.activity(f.token), hasCode("BROADCAST_UNAUTHORIZED"));
  assert.equal(f.calls.length, 1);
});

test("live activity refuses duplicate, wrongly ordered, oversized, foreign or inconsistent stored campaigns", async () => {
  const f = await fixture(), { clientCampaignId: _retry, ...payload } = input();
  function row(value, status = "cancelled", createdAt = now) {
    const id = Buffer.alloc(16, value);
    return { ...f.state.campaign, id, status, createdAt, updatedAt: createdAt,
      payloadEncrypted: sealPayload(payload, f.key, { campaignId: id, adminId }),
      counts: { total: 1, pending: status === "queued" ? 1 : 0, sending: 0, delivered: 0, skipped: 0, cancelled: status === "cancelled" ? 1 : 0, failed: 0 } };
  }
  const recent = Array.from({ length: 20 }, (_, index) => row(100 - index));
  const active = Array.from({ length: 10 }, (_, index) => row(40 - index, "queued", now - 1));
  f.state.activity = { campaigns: [...recent, ...active] };
  assert.equal((await f.service.activity(f.token)).campaigns.length, 30);
  for (const campaigns of [[row(2), row(2)], [row(1), row(2)], [row(2, "cancelled", now - 1), row(1)],
    Array.from({ length: 11 }, (_, index) => row(80 - index, "queued")),
    Array.from({ length: 21 }, (_, index) => row(80 - index)),
    [...recent, ...active, row(1)], [{ ...row(2), id: Buffer.alloc(16, 3) }]]) {
    f.state.activity = { campaigns };
    await assert.rejects(f.service.activity(f.token), hasCode("BROADCAST_UNAVAILABLE"));
  }
});

const orderedId = (number) => { const value = Buffer.alloc(16); value.writeUInt32BE(number, 12); return value; };
async function largeFixture() {
  const f = await fixture({ mediaEnabled: true });
  f.state.clock = now; f.state.largeCreates = 0; f.state.largeRows = [];
  const candidates = Array.from({ length: 2500 }, (_, index) => ({ conversationId: orderedId(index + 1),
    client: { id: orderedId(index + 10001), pseudonym: `Synthetic ${index}` }, eligible: true, reason: null, repeatMedia: false }));
  const digest = createAudienceDigest(); for (const row of candidates) digest.update(row.conversationId, row.client.id);
  const summary = { recipients: candidates.slice(0, 50), totalCount: 2500, eligibleCount: 2500, excludedCount: 0, repeatCount: 0, digest: digest.digest() };
  Object.assign(f.store, {
    previewAudience: async () => summary,
    createAudience: async (options) => {
      f.calls.push({ name: "createAudience", options });
      if (f.state.largeStored) {
        if (!options.campaign.requestFingerprint.equals(f.state.largeStored.requestFingerprint)) throw { code: "BROADCAST_CONFLICT" };
        return { campaign: f.state.largeStored, duplicate: true };
      }
      options.verifyPreview(f.state.clock); f.state.largeCreates++;
      const command = options.campaign;
      f.state.largeStored = { ...command, status: "queued", createdAt: f.state.clock, updatedAt: f.state.clock, expiresAt: f.state.clock + 604800000,
        counts: { total: 2500, pending: 2500, sending: 0, delivered: 0, skipped: 0, cancelled: 0, failed: 0 } };
      f.state.largeRows = candidates.map((row, index) => { const messageId = orderedId(index + 50001);
        return { conversationId: row.conversationId, client: row.client, proposedMessageId: messageId,
          clientMessageId: command.recipientProof({ campaignId: command.id, adminId, conversationId: row.conversationId, clientId: row.client.id, messageId }),
          state: "pending", reason: null, messageId: null, deliveredAt: null, privateLease: "never-public" }; });
      return { campaign: f.state.largeStored, duplicate: false };
    },
    summary: async () => f.state.largeStored,
    recipients: async ({ afterId, limit }) => {
      const index = afterId === null ? 0 : f.state.largeRows.findIndex(row => row.conversationId.equals(afterId)) + 1;
      if (afterId !== null && index === 0) throw { code: "BROADCAST_NOT_FOUND" };
      const recipients = f.state.largeRows.slice(index, index + limit), hasMore = index + limit < f.state.largeRows.length;
      return { campaign: f.state.largeStored, recipients, hasMore, nextCursor: hasMore ? recipients.at(-1).conversationId : null };
    },
  });
  f.options = { ...f.options, clock: () => f.state.clock, largeAudiencesEnabled: true };
  f.service = await createBroadcastService(f.options); f.candidates = candidates; f.largeSummary = summary;
  f.largeInput = (previewToken, changes = {}) => ({ clientCampaignId: "9".repeat(32), title: "Synthetic large campaign", body: "Synthetic body", mediaId: null,
    allowRepeatMedia: false, audience: { mode: "all" }, previewToken, ...changes });
  return f;
}

test("large audiences are a readonly explicit opt-in while compatibility can inspect existing v2", async () => {
  const f = await largeFixture(), compat = await createBroadcastService({ ...f.options, largeAudiencesEnabled: false });
  assert.equal(compat.largeAudiencesEnabled, false); assert.equal(f.service.largeAudiencesEnabled, true);
  assert.throws(() => { compat.largeAudiencesEnabled = true; }, TypeError);
  await assert.rejects(compat.preview(f.token, { audience: { mode: "all" }, mediaId: null }), hasCode("BROADCAST_INPUT"));
  await assert.rejects(compat.create(f.token, f.largeInput("opaque")), hasCode("BROADCAST_INPUT"));
  assert.equal(f.authCalls.length, 0);
  const preview = await f.service.preview(f.token, { audience: { mode: "all" }, mediaId: null });
  const result = await f.service.create(f.token, f.largeInput(preview.previewToken));
  const summary = await compat.summary(f.token, result.campaign.id);
  assert.equal(summary.counts.total, 2500); assert.equal(summary.formatVersion, 2); assert.equal(summary.audienceMode, "all");
  assert.equal(Object.hasOwn(summary, "recipients"), false);
  const page = await compat.recipients(f.token, summary.id, { afterId: null, limit: 50 });
  assert.equal(page.recipients.length, 50); assert.equal(page.hasMore, true);
  assert.doesNotMatch(JSON.stringify(page), /proposedMessageId|clientMessageId|privateLease|payloadEncrypted/);
});

test("large preview returns only the first 50 and confirmation creates a compact authenticated snapshot", async () => {
  const f = await largeFixture();
  const preview = await f.service.preview(f.token, { audience: { mode: "all" }, mediaId: null });
  assert.equal(preview.totalCount, 2500); assert.equal(preview.eligibleCount, 2500); assert.equal(preview.excludedCount, 0);
  assert.equal(preview.recipients.length, 50); assert.equal(preview.repeatCount, 0); assert.ok(preview.previewToken.length < 2048);
  const result = await f.service.create(f.token, f.largeInput(preview.previewToken));
  assert.equal(result.campaign.counts.total, 2500); assert.equal(result.duplicate, false);
  const command = f.calls.find(call => call.name === "createAudience").options;
  const payload = openPayload(command.campaign.payloadEncrypted, f.key, { campaignId: command.campaign.id, adminId });
  assert.equal(payload.version, 2); assert.equal(payload.audience.count, 2500); assert.equal(payload.audience.digest, f.largeSummary.digest);
  assert.equal(Object.hasOwn(payload, "conversationIds"), false); assert.ok(command.campaign.payloadEncrypted.length < 1000);
  assert.deepEqual(command.campaign.requestFingerprint, campaignFingerprint(payload, f.key, { adminId }));
});

test("committed v2 retries survive expired previews and current audience drift without creating another campaign", async () => {
  const f = await largeFixture(), preview = await f.service.preview(f.token, { audience: { mode: "all" }, mediaId: null });
  const body = f.largeInput(preview.previewToken), first = await f.service.create(f.token, body);
  f.state.clock += 600001; f.largeSummary.eligibleCount = 0;
  const repeated = await f.service.create(f.token, body);
  assert.equal(repeated.duplicate, true); assert.equal(repeated.campaign.id, first.campaign.id); assert.equal(f.state.largeCreates, 1);
  await assert.rejects(f.service.create(f.token, { ...body, title: "Changed content" }), hasCode("BROADCAST_CONFLICT"));
  f.state.largeStored = null;
  await assert.rejects(f.service.create(f.token, { ...body, clientCampaignId: "8".repeat(32) }), hasCode("BROADCAST_CONFLICT"));
  assert.equal(f.state.largeCreates, 1);
});

test("preview proof rejects tampering and different selectors or media before any campaign persistence", async () => {
  const f = await largeFixture(), preview = await f.service.preview(f.token, { audience: { mode: "all" }, mediaId: null });
  const body = f.largeInput(preview.previewToken);
  const token = preview.previewToken.slice(0, -1) + (preview.previewToken.endsWith("A") ? "B" : "A");
  for (const changes of [{ previewToken: token }, { mediaId: "a".repeat(32) }, { audience: { mode: "selected", conversationIds: f.candidates.map(row => row.conversationId.toString("hex")) } }]) {
    await assert.rejects(f.service.create(f.token, { ...body, ...changes }), hasCode("BROADCAST_CONFLICT"));
  }
  assert.equal(f.state.largeCreates, 0); assert.equal(f.calls.some(call => call.name === "createAudience"), false);
});

test("v2 recipient pages authenticate individual rows and reject foreign cursors or swapped queue identities", async () => {
  const f = await largeFixture(), preview = await f.service.preview(f.token, { audience: { mode: "all" }, mediaId: null });
  const { campaign } = await f.service.create(f.token, f.largeInput(preview.previewToken));
  const one = await f.service.recipients(f.token, campaign.id, { limit: 50 });
  const two = await f.service.recipients(f.token, campaign.id, { afterId: one.nextCursor, limit: 50 });
  assert.equal(two.recipients.length, 50); assert.ok(two.recipients[0].conversationId > one.recipients.at(-1).conversationId);
  await assert.rejects(f.service.recipients(f.token, campaign.id, { afterId: "f".repeat(32), limit: 50 }), hasCode("BROADCAST_NOT_FOUND"));
  const row = f.state.largeRows[0], proof = row.clientMessageId;
  f.state.largeRows[0].clientMessageId = randomBytes(16);
  await assert.rejects(f.service.recipients(f.token, campaign.id, { limit: 50 }), hasCode("BROADCAST_UNAVAILABLE"));
  Object.assign(row, { clientMessageId: proof, state: "delivered", messageId: randomBytes(16), deliveredAt: now });
  await assert.rejects(f.service.recipients(f.token, campaign.id, { limit: 50 }), hasCode("BROADCAST_UNAVAILABLE"));
});

test("authenticated v2 total is enforced independently of paginated recipient sample size", async () => {
  const f = await largeFixture(), preview = await f.service.preview(f.token, { audience: { mode: "all" }, mediaId: null });
  const { campaign } = await f.service.create(f.token, f.largeInput(preview.previewToken));
  f.state.largeStored.counts = { ...f.state.largeStored.counts, total: 2501, pending: 2501 };
  await assert.rejects(f.service.summary(f.token, campaign.id), hasCode("BROADCAST_UNAVAILABLE"));
});
