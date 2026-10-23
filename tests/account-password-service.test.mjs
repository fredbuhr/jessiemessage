import test, { before } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createPasswordService } from "../server/account-password/service.mjs";
import { csrfToken, hashPassword, newToken, tokenDigest, verifyPassword } from "../server/auth/crypto.mjs";

const password = "Original synthetic password", changed = " Testé8 ";
let originalHash;
before(async () => { originalHash = await hashPassword(password); });
function fixture(role = "client") {
  let now = Date.UTC(2026, 9, 23);
  const userId = randomBytes(16), token = newToken(), calls = [];
  const state = { live: true, hash: originalHash, generation: 1, allowed: true, beforeCommit: null, quotaHook: null };
  const user = { id: userId.toString("hex"), role, pseudonym: "Synthetic" };
  const access = { state: "active", admissionPolicy: "manual_invitation", invitationConsumed: true, emailVerified: true, ageAssured: false, approved: true, expiresAt: null };
  const principal = () => ({ user, csrf: csrfToken(token), expiresAt: now + 100000, ...(role === "client" ? { access } : {}) });
  const store = {
    consumeRateLimit: async (bucket, options) => { calls.push({ bucket, options }); await state.quotaHook?.(); return { allowed: state.allowed, retryAfter: 90 }; },
    getPasswordChangeRecord: async hash => state.live && hash.equals(tokenDigest(token)) ? { userId, passwordHash: state.hash, generation: state.generation } : null,
    changePassword: async input => {
      await state.beforeCommit?.(input); calls.push({ commit: input });
      if (!state.live || input.expectedPasswordHash !== state.hash || input.expectedGeneration !== state.generation) return null;
      state.hash = input.passwordHash; state.generation++; state.live = false;
      return { userId, role, pseudonym: user.pseudonym, expiresAt: now + 100000, ...(role === "client" ? { access } : {}) };
    },
  };
  const session = async raw => state.live && raw === token ? principal() : null;
  const service = createPasswordService({ authService: { session }, accessService: { session }, authStore: store, accessStore: store, key: randomBytes(32), clock: () => now });
  return { service, state, token, calls, user, store, advance: delta => { now += delta; }, input: { currentPassword: password, newPassword: changed, confirmation: changed } };
}
for (const role of ["admin", "client"]) {
  test(`${role}: correct current password permits eight-character replacement and rotated session`, async () => {
    const f = fixture(role); const result = await f.service.change(role, f.token, f.input);
    assert.equal(result.status, "password_changed"); assert.deepEqual(result.user, f.user);
    assert.notEqual(result.token, f.token); assert.equal(result.csrf, csrfToken(result.token));
    assert.equal(await verifyPassword(changed, f.state.hash), true); assert.equal(await verifyPassword(password, f.state.hash), false);
    const write = f.calls.find(x => x.commit).commit;
    assert.equal(write.expectedPasswordHash, originalHash); assert.equal(write.expectedGeneration, 1);
    assert.deepEqual(write.tokenHash, tokenDigest(f.token)); assert.deepEqual(write.session.tokenHash, tokenDigest(result.token));
    for (const secret of [originalHash, changed, password]) assert.equal(JSON.stringify(result).includes(secret), false);
  });
  test(`${role}: failed old password, confirmation mismatch and unknown owner never write`, async () => {
    const f = fixture(role);
    await assert.rejects(f.service.change(role, f.token, { ...f.input, currentPassword: "Wrong synthetic password" }), { code: "PASSWORD_CURRENT_INVALID" });
    await assert.rejects(f.service.change(role, f.token, { ...f.input, confirmation: "different" }), { code: "PASSWORD_MISMATCH" });
    await assert.rejects(f.service.change(role, f.token, { ...f.input, userId: "other" }), { code: "PASSWORD_INPUT" });
    assert.equal(f.state.hash, originalHash); assert.equal(f.calls.some(x => x.commit), false);
  });
  test(`${role}: stale session or concurrent credential replacement cannot overwrite new credentials`, async () => {
    const f = fixture(role);f.state.beforeCommit = () => { f.state.hash = "different concurrent hash"; };
    await assert.rejects(f.service.change(role, f.token, f.input), { code: "PASSWORD_AUTH_INVALID" });
    assert.equal(f.state.hash, "different concurrent hash");
    f.state.live = false; await assert.rejects(f.service.change(role, f.token, f.input), { code: "PASSWORD_AUTH_INVALID" });
  });
  test(`${role}: revocation during queued quota/password work refuses mutation`, async () => {
    const f = fixture(role); f.state.quotaHook = () => { f.state.live = false; };
    await assert.rejects(f.service.change(role, f.token, f.input), { code: "PASSWORD_AUTH_INVALID" });
    assert.equal(f.calls.some(x => x.commit), false);
  });
}
test("policy rejects short/long/malformed passwords and leaves the current value unchanged", async () => {
  const f = fixture();
  for (const value of ["1234567", "x".repeat(129), "1234567\ud800", 12345678, null]) {
    await assert.rejects(f.service.change("client", f.token, { ...f.input, newPassword: value, confirmation: value }), { code: "PASSWORD_INVALID" });
  }
  assert.equal(f.state.hash, originalHash); assert.equal(f.calls.some(x => x.commit), false);
});
test("persistent quotas run before password hashing, hide their bucket identities and sanitize failures", async () => {
  const f = fixture(); f.state.allowed = false;
  await assert.rejects(f.service.change("client", f.token, f.input), { code: "PASSWORD_RATE_LIMIT", retryAfter: 90 });
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].bucket.length, 32);
  assert.equal(f.calls[0].bucket.toString().includes(f.user.id), false);
  f.state.allowed = true; f.store.getPasswordChangeRecord = () => { throw new Error("private driver SQL password hash"); };
  await assert.rejects(f.service.change("client", f.token, f.input), error => error.code === "PASSWORD_UNAVAILABLE" && !String(error).includes("driver"));
});
