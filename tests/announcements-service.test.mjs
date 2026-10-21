import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { newToken, tokenDigest } from "../server/auth/crypto.mjs";
import { ChatStoreError } from "../server/chat/store.mjs";
import { BroadcastStoreError } from "../server/broadcast/store.mjs";
import { issuePreviewToken, audienceSelectorHash } from "../server/broadcast/audience.mjs";
import { createAnnouncementsStore } from "../server/announcements/store.mjs";
import { createAnnouncementsService } from "../server/announcements/service.mjs";

const now = 1792594800000, admin = "a".repeat(32), client = "b".repeat(32), token = newToken(), clientToken = newToken(), csrf = newToken(), key = randomBytes(32);
const current = { serverTime: now, revision: "0", announcement: null };
const input = changes => ({ mutationId: "c".repeat(32), expectedRevision: "0", body: "Je commence ce soir 💋", startsAt: null,
  expiresAt: now + 3600000, sendPrivateMessage: false, previewToken: null, ...changes });
async function fixture(changes = {}) {
  const calls = [], store = { current: async value => { calls.push(["current", value]); return value.role === "admin" ? current : { serverTime: now, announcement: null }; },
    save: async value => { calls.push(["save", value]); return { ...current, duplicate: false }; }, remove: async value => { calls.push(["remove", value]); return { ...current, duplicate: false }; }, ...changes.store };
  const actor = (id, role) => ({ user: { id, role, pseudonym: "Jessie", email: "private" }, csrf, expiresAt: now + 3600000 });
  const dependencies = { store, broadcastService: { preview: async () => ({ totalCount: 3, eligibleCount: 2, excludedCount: 1, previewToken: "preview", recipients: [{ private: "names" }] }) },
    authService: { session: async value => value === token ? actor(admin, "admin") : null },
    chatService: { actor: async (role, value) => role === "client" && value === clientToken ? actor(client, "client") : null },
    authStore: { consumeRateLimit: async (bucket, options) => { calls.push(["limit", bucket, options]); return { allowed: true }; } }, key, clock: () => now, ...changes.dependencies };
  return { service: await createAnnouncementsService(dependencies), store, dependencies, calls };
}
test("announcement service validates dependencies and requests before any private store operation", async () => {
  const f = await fixture();
  for (const name of ["store", "broadcastService", "chatService", "authService", "authStore", "key", "clock"]) await assert.rejects(createAnnouncementsService({ ...f.dependencies, [name]: null }), { code: "ANNOUNCEMENTS_CONFIG" });
  await assert.rejects(f.service.save(token, { ...input(), unexpected: true }), { code: "ANNOUNCEMENTS_INPUT" });
  await assert.rejects(f.service.remove(token, { mutationId: "c".repeat(32), expectedRevision: 0 }), { code: "ANNOUNCEMENTS_INPUT" });
  assert.equal(f.calls.length, 0);
});
test("announcement roles, opaque budgets, requests and output boundaries remain separate", async () => {
  const f = await fixture();
  assert.deepEqual(await f.service.current("admin", token), current);
  assert.deepEqual(await f.service.current("client", clientToken), { serverTime: now, announcement: null });
  await assert.rejects(f.service.current("admin", clientToken), { code: "ANNOUNCEMENTS_UNAUTHORIZED" });
  await assert.rejects(f.service.current("client", token), { code: "ANNOUNCEMENTS_UNAUTHORIZED" });
  assert.deepEqual(await f.service.preview(token, {}), { totalCount: 3, eligibleCount: 2, excludedCount: 1, previewToken: "preview" });
  await f.service.save(token, input());
  const request = f.calls.find(call => call[0] === "save")[1]; assert.ok(request.tokenHash.equals(tokenDigest(token))); assert.deepEqual(request.input, input());
  assert.ok(f.calls.filter(call => call[0] === "limit").every(call => Buffer.isBuffer(call[1]) && call[1].length === 32));
  assert.ok(!JSON.stringify(await f.service.actor("admin", token)).includes("private"));
});
test("rate refusal precedes SQL and untrusted backend details stay opaque", async () => {
  const limits = [];
  const limited = await fixture({ dependencies: { authStore: { consumeRateLimit: async (bucket, options) => { limits.push(options.limit); return { allowed: false, retryAfter: 12 }; } } } });
  await assert.rejects(limited.service.current("admin", token), { code: "ANNOUNCEMENTS_RATE_LIMIT", retryAfter: 12 }); assert.equal(limited.calls.length, 0);
  assert.deepEqual(limits, [120], "an exhausted account must not spend the shared global budget");
  const broken = await fixture({ store: { current: async () => { throw new Error("private SQL secret"); } } });
  await assert.rejects(broken.service.current("admin", token), error => error.code === "ANNOUNCEMENTS_UNAVAILABLE" && !error.message.includes("secret"));
  for (const malformed of [{ ...current, revision: 0 }, { ...current, extra: "private" }, { ...current, announcement: { body: "bad" } }]) {
    const f = await fixture({ store: { current: async () => malformed } }); await assert.rejects(f.service.current("admin", token), { code: "ANNOUNCEMENTS_UNAVAILABLE" });
  }
  const invalidClock = await fixture({ dependencies: { clock: () => NaN } });
  await assert.rejects(invalidClock.service.current("admin", token), { code: "ANNOUNCEMENTS_UNAVAILABLE" });
  assert.equal(invalidClock.calls.length, 0);
});
test("store preserves a typed stale-preview conflict through rollback, but not a driver impersonation", async () => {
  const issuedAt = now - 11 * 60000;
  const previewToken = issuePreviewToken(key, { adminId: admin, selectorHash: audienceSelectorHash({ mode: "all" }), mediaId: null,
    count: 1, digest: "d".repeat(64), repeatCount: 0, issuedAt });
  for (const typed of [true, false]) {
    let rolledBack = false, inserted = false;
    const connection = { query: async sql => { if (sql.includes("FROM announcements")) return []; inserted = true; throw new Error("unexpected mutation"); } };
    const chatStore = { withActor: async (request, operation) => {
      try { return await operation(connection, { actor: { id: Buffer.from(admin, "hex"), role: "admin" }, admin: { id: Buffer.from(admin, "hex") }, now, mfaVersion: 1 }); }
      catch { rolledBack = true; throw new ChatStoreError("CHAT_UNAVAILABLE"); }
    } };
    const broadcastStore = { cancelInTransaction: async () => {}, createAudienceInTransaction: async (conn, context, value) => {
      assert.equal(conn, connection); assert.equal(context.now, now);
      assert.throws(() => value.verifyPreview(now));
      throw typed ? new BroadcastStoreError("BROADCAST_CONFLICT") : Object.assign(new Error("private driver error"), { code: "BROADCAST_CONFLICT" });
    } };
    const store = createAnnouncementsStore({ pool: { getConnection() {} }, chatStore, broadcastStore, key, clock: () => now });
    await assert.rejects(store.save({ tokenHash: tokenDigest(token), now, input: input({ sendPrivateMessage: true, previewToken }) }), { code: typed ? "ANNOUNCEMENTS_CONFLICT" : "CHAT_UNAVAILABLE" });
    assert.equal(rolledBack, true); assert.equal(inserted, false);
  }
});
