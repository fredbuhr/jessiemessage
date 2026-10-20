import test, { before } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { ADMIN_SESSION_SECONDS } from "../server/auth/session-policy.mjs";
import { createAuthService } from "../server/auth/service.mjs";
import { csrfToken, hashPassword, newToken, sealTotpSecret, tokenDigest, totpCode } from "../server/auth/crypto.mjs";

const password = "Synthetic test password 123!";
const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
const userId = randomBytes(16);
const key = randomBytes(32);
const initialNow = 1800000000000;
let passwordHash;
before(async () => { passwordHash = await hashPassword(password); });

async function fixture() {
  let now = initialNow;
  const calls = [], loginAttempts = [];
  const state = { active: true, record: true, lastStep: -1, session: null, allowed: true, available: true, rateHook: null };
  const store = {
    consumeRateLimit: async (digest, options) => { calls.push({ digest, options }); if (state.rateHook) await state.rateHook(options, calls.length); return { allowed: state.allowed, retryAfter: 77 }; },
    getLoginRecord: async () => state.record ? { id: userId, role: "admin", status: state.active ? "active" : "suspended", passwordHash } : null,
    completeAdminLogin: async (options) => {
      loginAttempts.push(options);
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
  return { service, state, calls, loginAttempts, advance: (delta) => { now += delta; }, setNow: (value) => { now = value; }, login: (extra = {}) => service.login({ email: "ADMIN@Example.INVALID", password, factor: totpCode(secret, { now }), peerAddress: "127.0.0.1", ...extra }) };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
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
  assert.equal(f.calls[0].options.network.limit, 20);
  assert.equal(f.calls[0].options.network.windowSeconds, 900);
  assert.equal(f.calls[0].options.network.bucketHash.length, 32);
  assert.notDeepEqual(f.calls[0].options.network.bucketHash, f.calls[0].digest);
  assert.equal(f.calls[0].digest.includes(Buffer.from("example.invalid")), false);
});
test("public quotas pair each network with the shared aggregate before charging a stable account", async () => {
  const f = await fixture();
  await assert.rejects(f.login({ password: "wrong" }), { code: "AUTH_INVALID" });
  assert.equal(f.calls.length, 2);
  const [aggregate, account] = f.calls;
  assert.equal(account.options.limit, 8); assert.equal(account.options.network, undefined);
  await assert.rejects(f.login({ email: "admin@example.invalid", password: "wrong", peerAddress: "192.0.2.22" }), { code: "AUTH_INVALID" });
  assert.deepEqual(f.calls[2].digest, aggregate.digest);
  assert.notDeepEqual(f.calls[2].options.network.bucketHash, aggregate.options.network.bucketHash);
  assert.deepEqual(f.calls[3].digest, account.digest);
});
test("revocation, suspension and absolute expiry remove access without exposing the stored session hash", async () => {
  const f = await fixture(); const connected = await f.login();
  assert.equal((await f.service.session(connected.token)).token, undefined);
  f.state.active = false; assert.equal(await f.service.session(connected.token), null);
  f.state.active = true; await f.service.logout(connected.token); assert.equal(await f.service.session(connected.token), null);
  f.advance(30000); const second = await f.login(); await f.service.logoutAll(second.token);
  assert.equal(await f.service.session(second.token), null);
  f.advance(30000); const third = await f.login(); f.advance(ADMIN_SESSION_SECONDS * 1000);
  assert.equal(await f.service.session(third.token), null);
});
test("malformed cookies are anonymous and database failure yields only a sanitized unavailable error", async () => {
  const f = await fixture();
  for (const token of [undefined, "short", newToken() + "="]) assert.equal(await f.service.session(token), null);
  f.state.available = false;
  await assert.rejects(f.service.session(newToken()), (error) => error.code === "AUTH_UNAVAILABLE" && !error.message.includes("private driver"));
});

test("an administrator TOTP that ages outside its window while a quota waits cannot create a session", async () => {
  const f = await fixture(), entered = deferred(), resume = deferred();
  f.state.rateHook = async (_options, count) => { if (count === 1) { entered.resolve(); await resume.promise; } };
  const pending = f.login({ factor: totpCode(secret, { now: initialNow }) });
  await entered.promise; f.advance(120000); resume.resolve();
  await assert.rejects(pending, { code: "AUTH_INVALID" });
  assert.deepEqual(f.calls.map(({ options }) => options.now), [initialNow, initialNow]);
  assert.equal(f.loginAttempts.length, 1); assert.equal(f.loginAttempts[0].now, initialNow + 120000);
  assert.equal(f.state.lastStep, -1); assert.equal(f.state.session, null);
});

test("administrator factors and the full session lifetime use the time after quota and password work", async () => {
  const f = await fixture(), entered = deferred(), resume = deferred(), current = initialNow + 120000;
  f.state.rateHook = async (_options, count) => { if (count === 1) { entered.resolve(); await resume.promise; } };
  const pending = f.login({ factor: totpCode(secret, { now: current }) });
  await entered.promise; f.setNow(current); resume.resolve();
  const connected = await pending;
  assert.equal(f.loginAttempts.length, 1); assert.equal(f.loginAttempts[0].now, current);
  assert.equal(f.state.lastStep, Math.floor(current / 30000));
  assert.equal(f.loginAttempts[0].session.expiresAt, current + ADMIN_SESSION_SECONDS * 1000);
  assert.equal(connected.expiresAt, current + ADMIN_SESSION_SECONDS * 1000);
  assert.deepEqual(f.calls.map(({ options }) => options.now), [initialNow, initialNow]);
});

test("an invalid or overflowing administrator clock after quotas stops before factor consumption or session mutation", async () => {
  const f = await fixture();
  for (const current of [NaN, -1, 1.5, 253402300800000, 253402300799999]) {
    f.setNow(initialNow);
    f.state.rateHook = async (_options, count) => { if (count % 2 === 0) f.setNow(current); };
    await assert.rejects(f.login(), (error) => error.code === "AUTH_UNAVAILABLE" && error.cause === undefined);
    assert.equal(f.loginAttempts.length, 0); assert.equal(f.state.lastStep, -1); assert.equal(f.state.session, null);
  }
  f.state.rateHook = null;
  for (const current of [NaN, -1, 1.5, 253402300800000]) {
    f.setNow(current); const before = f.calls.length;
    await assert.rejects(f.service.login({ email: "admin@example.invalid", password, factor: "123456" }), { code: "AUTH_UNAVAILABLE" });
    assert.equal(f.calls.length, before); assert.equal(f.loginAttempts.length, 0);
  }
});
