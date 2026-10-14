import test, { before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createAccessService } from "../server/access/service.mjs";
import { hashPassword, newToken, tokenDigest } from "../server/auth/crypto.mjs";
import { openVerificationPayload } from "../server/mail/crypto.mjs";

const key = randomBytes(32); const mailKey = randomBytes(32); const userId = randomBytes(16);
const password = "Synthetic client password 2026!"; const token = newToken();
let now, service, passwordHash, captured, state;
before(async () => {
  passwordHash = await hashPassword(password);
  const store = {
    inspectInvitation: async () => state.invitation ? { expiresAt: now + 100000, accessDays: 30 } : null,
    register: async (options) => { captured.push(options); return state.registered; },
    getClientLoginRecord: async () => state.record ? { id: userId, role: "client", status: "pending", emailVerified: state.verified,
      credentialVersion: 1, passwordHash } : null,
    reissueVerification: async (options) => { captured.push(options); return true; },
    completeClientLogin: async (options) => { captured.push(options); state.tokenHash = options.session.tokenHash; return state.loginAllowed; },
    getClientSession: async (hash) => state.tokenHash?.equals(hash) ? { userId, role: "client", pseudonym: "Synthetic client",
      expiresAt: now + 100000, access: { state: state.access, emailVerified: true, ageAssured: state.access === "active",
        approved: state.access === "active", expiresAt: null } } : null,
    revokeClientSession: async () => { state.tokenHash = null; },
    revokeAllClientSessions: async (id) => { assert.deepEqual(id, userId); state.tokenHash = null; },
    listClients: async () => state.admin ? [] : null,
    createInvitation: async (options) => ({ id: options.id, expiresAt: options.expiresAt, accessDays: options.accessDays }),
  };
  const authStore = { consumeRateLimit: async (hash, options) => { captured.push({ hash, options }); return { allowed: state.allowed, retryAfter: 45 }; } };
  const authService = { session: async () => state.admin ? { user: { role: "admin" } } : null };
  service = await createAccessService({ store, authStore, authService, totpKey: key, mailKey, origin: "https://example.invalid", clock: () => now });
});
beforeEach(() => {
  now = Date.now(); captured = [];
  state = { invitation: true, registered: true, record: true, verified: false, loginAllowed: true,
    allowed: true, admin: true, tokenHash: null, access: "pending" };
});
test("registration returns no email challenge, encrypts the atomic job and never forwards asserted age proof", async () => {
  const result = await service.register({ invitationToken: token, email: "CLIENT@Example.INVALID", pseudonym: "Synthetic client",
    password, ageDeclared: true, ageAssured: true, peerAddress: "127.0.0.1" });
  assert.deepEqual(result, { status: "verification_pending" });
  const command = captured.find((item) => item.user);
  assert.deepEqual(Object.keys(command.user).sort(), ["email", "id", "passwordHash", "pseudonym"]);
  assert.equal(command.user.email, "client@example.invalid");
  assert.notEqual(command.user.passwordHash, password);
  const decrypted = openVerificationPayload(command.mail.payloadEncrypted, mailKey, command.mail.id);
  assert.equal(decrypted.email, "client@example.invalid");
  assert.deepEqual(tokenDigest(decrypted.token), command.verification.tokenHash);
  assert.equal(command.verification.expiresAt, now + 24 * 3600000);
  assert.equal(JSON.stringify(result).includes(decrypted.token), false);
});
test("invalid invitations, missing declarations and failed atomic registration never report success", async () => {
  const request = { invitationToken: token, email: "client@example.invalid", pseudonym: "Synthetic client", password, ageDeclared: true };
  state.invitation = false;
  await assert.rejects(service.register(request), { code: "ACCESS_REGISTRATION_FAILED" });
  assert.equal(captured.some((item) => item.user), false);
  state.invitation = true;
  await assert.rejects(service.register({ ...request, ageDeclared: false }), { code: "ACCESS_REGISTRATION_FAILED" });
  state.registered = false;
  await assert.rejects(service.register(request), { code: "ACCESS_REGISTRATION_FAILED" });
});
test("resending conceals unknown accounts and wrong passwords and creates a new job only for the eligible account", async () => {
  state.record = false;
  assert.deepEqual(await service.resendVerification({ email: "unknown@example.invalid", password }), { status: "accepted" });
  state.record = true;
  assert.deepEqual(await service.resendVerification({ email: "client@example.invalid", password: "Incorrect client password" }), { status: "accepted" });
  assert.equal(captured.some((item) => item.verification), false);
  assert.deepEqual(await service.resendVerification({ email: "client@example.invalid", password }), { status: "accepted" });
  assert.equal(captured.filter((item) => item.verification).length, 1);
});
test("email verification is required for login; limited and expired sessions cannot authorize private access", async () => {
  await assert.rejects(service.login({ email: "client@example.invalid", password }), { code: "AUTH_INVALID" });
  state.verified = true;
  const connected = await service.login({ email: "client@example.invalid", password });
  assert.equal(connected.user.role, "client"); assert.equal(connected.access.state, "pending");
  assert.equal((await service.session(connected.token)).token, undefined);
  await assert.rejects(service.requireActiveClient(connected.token), { code: "ACCESS_PREREQUISITES" });
  state.access = "expired";
  await assert.rejects(service.requireActiveClient(connected.token), { code: "ACCESS_EXPIRED" });
  state.access = "active"; assert.equal((await service.requireActiveClient(connected.token)).user.id, userId.toString("hex"));
  await service.logoutAll(connected.token); assert.equal(await service.session(connected.token), null);
});
test("the aggregate public quota blocks before account lookups and expensive password work", async () => {
  state.allowed = false;
  await assert.rejects(service.login({ email: "client@example.invalid", password }), (error) => error.code === "AUTH_RATE_LIMIT" && error.retryAfter === 45);
  assert.equal(captured.length, 1); assert.equal(captured[0].hash.length, 32); assert.equal(captured[0].options.limit, 60);
});
test("only a current administrator can obtain invitation links and stored lists cannot recreate them", async () => {
  state.admin = false;
  await assert.rejects(service.createInvitation(token), { code: "ACCESS_FORBIDDEN" });
  state.admin = true;
  const result = await service.createInvitation(token, { lifetimeHours: 72, accessDays: null });
  const link = new URL(result.url);
  assert.equal(link.origin, "https://example.invalid"); assert.equal(link.pathname, "/access"); assert.equal(link.search, "");
  assert.match(link.hash, /^#invitation=[A-Za-z0-9_-]{43}$/); assert.equal(result.accessDays, null);
  await assert.rejects(service.createInvitation(token, { lifetimeHours: 0, accessDays: 30 }), { code: "AUTH_INVALID" });
});
