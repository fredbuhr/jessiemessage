import test, { before } from "node:test";
import assert from "node:assert/strict";
import { createAccessService } from "../server/access/service.mjs";
import { hashPassword, newToken } from "../server/auth/crypto.mjs";

const password = "Synthetic-mail-password8", email = "synthetic@example.invalid";
const invitationToken = newToken(), userId = Buffer.alloc(16, 4), now = Date.now();
let passwordHash;
before(async () => { passwordHash = await hashPassword(password); });

async function fixture(onVerificationQueued, changes = {}) {
  const state = { committed: false, queued: 0, accepted: true, verified: false, ...changes };
  const options = {
    store: {
      inspectInvitation: async () => ({ expiresAt: now + 3600000, accessDays: null }),
      register: async () => { if (state.fail) throw Error("synthetic transaction failure"); state.committed = state.accepted; return state.accepted; },
      getClientLoginRecord: async () => ({ id: userId, role: "client", status: "pending", emailVerified: state.verified, passwordHash, credentialVersion: 1 }),
      reissueVerification: async () => { if (state.fail) throw Error("synthetic transaction failure"); state.committed = state.accepted; return state.accepted; },
    },
    authStore: { consumeRateLimit: async () => ({ allowed: true }) },
    authService: {}, totpKey: Buffer.alloc(32, 1), mailKey: Buffer.alloc(32, 2),
    origin: "https://example.invalid", clock: () => now,
    onVerificationQueued: onVerificationQueued === undefined ? undefined : () => {
      assert.equal(state.committed, true, "notification must follow the successful database transaction");
      state.queued++;
      return onVerificationQueued();
    },
  };
  return { service: await createAccessService(options), state, options };
}
const registration = () => ({ invitationToken, email, pseudonym: "Synthetic client", password, ageDeclared: true });

test("registration wakes verification delivery only after a successful committed enqueue", async () => {
  const f = await fixture(() => {});
  assert.deepEqual(await f.service.register(registration()), { status: "verification_pending" });
  assert.equal(f.state.queued, 1);
  const refused = await fixture(() => {}, { accepted: false });
  await assert.rejects(refused.service.register(registration()));
  assert.equal(refused.state.queued, 0);
  const failed = await fixture(() => {}, { fail: true });
  await assert.rejects(failed.service.register(registration()));
  assert.equal(failed.state.queued, 0);
});

test("verification resend wakes only an eligible account with a successful new outbox entry", async () => {
  for (const [changes, expected] of [[{}, 1], [{ accepted: false }, 0], [{ verified: true }, 0]]) {
    const f = await fixture(() => {}, changes);
    assert.deepEqual(await f.service.resendVerification({ email, password }), { status: "accepted" });
    assert.equal(f.state.queued, expected);
  }
  const failed = await fixture(() => {}, { fail: true });
  await assert.rejects(failed.service.resendVerification({ email, password }));
  assert.equal(failed.state.queued, 0);
});

test("delivery wake-up failure or a pending worker never blocks an accepted registration", async () => {
  for (const wake of [() => { throw Error("synthetic wake failure"); },
    () => Promise.reject(Error("synthetic asynchronous wake failure")), () => new Promise(() => {})]) {
    const f = await fixture(wake);
    assert.deepEqual(await f.service.register(registration()), { status: "verification_pending" });
    assert.equal(f.state.queued, 1);
  }
});

test("optional delivery hook preserves the existing API and rejects invalid configuration", async () => {
  const f = await fixture();
  assert.deepEqual(await f.service.register(registration()), { status: "verification_pending" });
  await assert.rejects(createAccessService({ ...f.options, onVerificationQueued: true }), { code: "AUTH_UNAVAILABLE" });
});
