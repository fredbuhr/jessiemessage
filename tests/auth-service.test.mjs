import test, { before } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createAuthService } from "../server/auth/service.mjs";
import { csrfToken, hashPassword, newToken, sealTotpSecret, tokenDigest, totpCode } from "../server/auth/crypto.mjs";

const password = "Synthetic test password 123!";
const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
const userId = randomBytes(16);
const key = randomBytes(32);
let passwordHash;
before(async () => { passwordHash = await hashPassword(password); });

async function fixture() {
  let now = 1800000000000;
  const calls = [];
  const state = { active: true, record: true, lastStep: -1, session: null, allowed: true, available: true };
  const store = {
    consumeRateLimit: async (digest, options) => { calls.push({ digest, options }); return { allowed: state.allowed, retryAfter: 77 }; },
    getLoginRecord: async () => state.record ? { id: userId, role: "admin", status: state.active ? "active" : "suspended", passwordHash } : null,
    completeAdminLogin: async (options) => {
      if (!state.active || options.expectedPasswordHash !== passwordHash) return false;
      const factor = options.factorCheck({ secretEncrypted: sealTotpSecret(secret, key, userId), version: 1, lastStep: state.lastStep, enabled: state.lastStep >= 0 });
      if (!factor || factor.step === undefined) return false;
      state.lastStep = factor.step;
      state.session = { digest: options.session.tokenHash, id: options.session.id, userId, role: "admin", pseudonym: "Synthetic Jessie", expiresAt: options.session.expiresAt, mfaVersion: 1 };
      return true;
    },
    getSession: async (digest, options) => {
      if (!state.available) throw new Error("private driver details MUST NOT appear");
      return state.active && state.session?.digest.equals(digest) && state.session.expiresAt > options.now ? state.session : null;
    },
    revokeSession: async (digest) => { if (state.session?.digest.equals(digest)) state.session = null; },
    revokeAllSessions: async (id) => { assert.deepEqual(id, userId); state.session = null; },
  };
  const service = await createAuthService({ store, totpKey: key, clock: () => now });
  return { service, state, calls, advance: (delta) => { now += delta; }, login: (extra = {}) => service.login({ email: "ADMIN@Example.INVALID", password, factor: totpCode(secret, { now }), peerAddress: "127.0.0.1", ...extra }) };
}

test("service requires the password and a fresh MFA factor before issuing a safe session", async () => {
  const f = await fixture();
  await assert.rejects(f.login({ password: "Wrong synthetic password!" }), { code: "AUTH_INVALID" });
  await assert.rejects(f.login({ factor: "bad factor" }), { code: "AUTH_INVALID" });
  assert.equal(f.state.session, null);
  const connected = await f.login();
  assert.equal(connected.token.length, 43);
  assert.deepEqual(tokenDigest(connected.token), f.state.session.digest);
  assert.equal(connected.csrf, csrfToken(connected.token));
  assert.deepEqual(connected.user, { id: userId.toString("hex"), role: "admin", pseudonym: "Synthetic Jessie" });
  assert.equal(JSON.stringify(connected).includes(passwordHash), false);
  assert.equal(JSON.stringify(connected).includes(secret), false);
  await assert.rejects(f.login(), { code: "AUTH_INVALID" });
});
test("unknown and suspended accounts receive the same invalid-credentials response", async () => {
  const f = await fixture();
  f.state.record = false;
  await assert.rejects(f.login(), { code: "AUTH_INVALID" });
  f.state.record = true; f.state.active = false;
  await assert.rejects(f.login(), { code: "AUTH_INVALID" });
  assert.equal(f.state.session, null);
});
test("persistent rate buckets are digests and throttle before expensive password work", async () => {
  const f = await fixture(); f.state.allowed = false;
  await assert.rejects(f.login(), (error) => error.code === "AUTH_RATE_LIMIT" && error.retryAfter === 77);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].digest.length, 32);
  assert.equal(f.calls[0].options.limit, 120);
  assert.equal(f.calls[0].digest.includes(Buffer.from("example.invalid")), false);
});
test("revocation, suspension and absolute expiry remove access without exposing the stored session hash", async () => {
  const f = await fixture(); const connected = await f.login();
  assert.equal((await f.service.session(connected.token)).token, undefined);
  f.state.active = false; assert.equal(await f.service.session(connected.token), null);
  f.state.active = true; await f.service.logout(connected.token); assert.equal(await f.service.session(connected.token), null);
  f.advance(30000); const second = await f.login(); await f.service.logoutAll(second.token);
  assert.equal(await f.service.session(second.token), null);
  f.advance(30000); const third = await f.login(); f.advance(8 * 60 * 60 * 1000);
  assert.equal(await f.service.session(third.token), null);
});
test("malformed cookies are anonymous and database failure yields only a sanitized unavailable error", async () => {
  const f = await fixture();
  for (const token of [undefined, "short", newToken() + "="]) assert.equal(await f.service.session(token), null);
  f.state.available = false;
  await assert.rejects(f.service.session(newToken()), (error) => error.code === "AUTH_UNAVAILABLE" && !error.message.includes("private driver"));
});
