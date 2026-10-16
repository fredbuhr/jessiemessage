import test, { before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createAccessService } from "../server/access/service.mjs";
import { hashPassword, newToken, tokenDigest, verifyPassword } from "../server/auth/crypto.mjs";
import { openVerificationPayload } from "../server/mail/crypto.mjs";
import { encodeAccessCursor } from "../server/access/pagination.mjs";

const key = randomBytes(32); const mailKey = randomBytes(32); const userId = randomBytes(16);
const password = " Testé8 "; const token = newToken();
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
      expiresAt: now + 100000, access: { state: state.access, admissionPolicy: "manual_invitation", invitationConsumed: true, emailVerified: true, ageAssured: state.access === "active",
        approved: state.access === "active", expiresAt: null } } : null,
    revokeClientSession: async () => { state.tokenHash = null; },
    revokeAllClientSessions: async (id) => { assert.deepEqual(id, userId); state.tokenHash = null; },
    listClients: async (hash, options) => {
      captured.push({ kind: "listClients", hash, options });
      if (state.storeError) throw Object.assign(new Error("Sensitive SQL detail"), { code: state.storeError });
      return state.storeForbidden ? null : state.clients;
    },
    listInvitations: async (hash, options) => {
      captured.push({ kind: "listInvitations", hash, options });
      if (state.storeError) throw Object.assign(new Error("Sensitive SQL detail"), { code: state.storeError });
      return state.storeForbidden ? null : state.invitations;
    },
    renewClient: async (hash, id, options) => {
      captured.push({ kind: "renewClient", hash, id, options });
      if (state.storeError) throw Object.assign(new Error("Sensitive SQL detail"), { code: state.storeError });
      return state.renewed === undefined ? { id: id.toString("hex"), accessExpiresAt: Math.max(options.now, options.expectedExpiresAt) + options.accessDays * 86400000 } : state.renewed;
    },
    createInvitation: async (options) => ({ id: options.id, expiresAt: options.expiresAt, accessDays: options.accessDays }),
  };
  const authStore = { consumeRateLimit: async (hash, options) => {
    captured.push({ hash, options });
    if (state.quotaAdvance) now += state.quotaAdvance;
    return state.quotaResults?.length ? state.quotaResults.shift() : { allowed: state.allowed, retryAfter: 45 };
  } };
  const authService = { session: async () => {
    state.sessionCalls += 1;
    return state.admin ? { user: { id: state.adminId, role: state.adminRole } } : null;
  } };
  service = await createAccessService({ store, authStore, authService, totpKey: key, mailKey, origin: "https://example.invalid", clock: () => now });
});
beforeEach(() => {
  now = Date.now(); captured = [];
  state = { invitation: true, registered: true, record: true, verified: false, loginAllowed: true,
    allowed: true, admin: true, adminId: "1".repeat(32), adminRole: "admin", sessionCalls: 0, tokenHash: null, access: "pending",
    clients: { clients: [], nextCursor: null, hasMore: false }, invitations: { invitations: [], nextCursor: null, hasMore: false } };
});
test("registration returns no email challenge, encrypts the atomic job and never forwards asserted age proof", async () => {
  const result = await service.register({ invitationToken: token, email: "CLIENT@Example.INVALID", pseudonym: "Synthetic client",
    password, ageDeclared: true, ageAssured: true, peerAddress: "127.0.0.1" });
  assert.deepEqual(result, { status: "verification_pending" });
  const command = captured.find((item) => item.user);
  assert.deepEqual(Object.keys(command.user).sort(), ["email", "id", "passwordHash", "pseudonym"]);
  assert.equal(command.user.email, "client@example.invalid");
  assert.notEqual(command.user.passwordHash, password);
  assert.equal(password.length, 8);
  assert.equal(await verifyPassword(password, command.user.passwordHash), true);
  assert.equal(await verifyPassword(password.trim(), command.user.passwordHash), false);
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

const syntheticClient = (overrides = {}) => ({ id: "a".repeat(32), createdAt: now - 1000, pseudonym: "Synthetic client",
  email: "client@example.invalid", status: "active", admissionPolicy: "manual_invitation", invitationConsumed: true, emailVerified: true, ageAssured: true, approved: true,
  accessExpiresAt: now + 86400000, ...overrides });
const syntheticInvitation = (overrides = {}) => ({ id: "b".repeat(32), createdAt: now - 1000, expiresAt: now + 100000,
  accessDays: 30, state: "pending", consumedById: null, ...overrides });
const sqlTimestamp = (milliseconds, suffix = "000") => new Date(milliseconds).toISOString().replace("T", " ").replace("Z", suffix);

test("admin pagination validates scoped canonical cursors and bounded options before any session or quota SQL", async () => {
  const wrongKind = encodeAccessCursor("invitations", { createdAt: sqlTimestamp(now), id: "a".repeat(32) });
  for (const input of [null, [], { limit: 0 }, { limit: 101 }, { limit: 1.5 }, { limit: "50" }, { cursor: "" },
    { cursor: wrongKind }, { cursor: wrongKind + "=" }, { cursor: "!".repeat(400) }, { extra: true }]) {
    await assert.rejects(service.listClients(token, input), { code: "ACCESS_INPUT" });
  }
  assert.equal(state.sessionCalls, 0); assert.equal(captured.length, 0);
});

test("admin reads authenticate before consuming stable user-first quotas shared by both lists", async () => {
  state.admin = false;
  await assert.rejects(service.listClients(token), { code: "ACCESS_FORBIDDEN" });
  assert.equal(captured.length, 0);
  state.admin = true;
  assert.deepEqual(await service.listClients(token), state.clients);
  const first = captured.filter((item) => !item.kind);
  assert.deepEqual(first.map((item) => item.options.limit), [60, 240]);
  assert.ok(first.every((item) => item.hash.length === 32 && item.options.windowSeconds === 60));
  assert.notDeepEqual(first[0].hash, first[1].hash);
  captured = [];
  assert.deepEqual(await service.listInvitations(newToken()), state.invitations);
  const second = captured.filter((item) => !item.kind);
  assert.deepEqual(second.map((item) => item.hash), first.map((item) => item.hash));
  state.adminId = "2".repeat(32); captured = [];
  await service.listClients(token);
  const otherAdmin = captured.filter((item) => !item.kind);
  assert.notDeepEqual(otherAdmin[0].hash, first[0].hash);
  assert.deepEqual(otherAdmin[1].hash, first[1].hash);
});

test("a denied admin user budget preserves Retry-After without charging the aggregate or listing", async () => {
  state.quotaResults = [{ allowed: false, retryAfter: 17 }];
  await assert.rejects(service.listClients(token), (error) => error.code === "AUTH_RATE_LIMIT" && error.retryAfter === 17);
  assert.equal(captured.length, 1); assert.equal(captured[0].options.limit, 60);
  state.quotaResults = [{ allowed: true }, { allowed: false, retryAfter: 23 }]; captured = [];
  await assert.rejects(service.listInvitations(token), (error) => error.code === "AUTH_RATE_LIMIT" && error.retryAfter === 23);
  assert.equal(captured.length, 2); assert.equal(captured.some((item) => item.kind), false);
});

test("admin quota storage failures and malformed denials fail closed before private queries", async () => {
  for (const result of [null, {}, { allowed: "yes" }, { allowed: false, retryAfter: 0 }, { allowed: false, retryAfter: "20" }, { allowed: false, retryAfter: 61 }]) {
    state.quotaResults = [result]; captured = [];
    await assert.rejects(service.listClients(token), { code: "AUTH_UNAVAILABLE" });
    assert.equal(captured.some((item) => item.kind), false);
  }
});

test("admin lists pass a fresh clock after quota waits and rely on persisted authorization again", async () => {
  const started = now; state.quotaAdvance = 2500;
  await service.listClients(token, { limit: 7 });
  const command = captured.find((item) => item.kind === "listClients");
  assert.deepEqual(command.options, { now: started + 5000, cursor: null, limit: 7 });
  assert.deepEqual(command.hash, tokenDigest(token));
  state.storeForbidden = true;
  await assert.rejects(service.listInvitations(token), { code: "ACCESS_FORBIDDEN" });
});

test("admin page DTOs discard secrets and retain exact scoped cursors across same-millisecond microsecond ties", async () => {
  const createdAt = now - 1000, client = syntheticClient({ createdAt });
  const second = syntheticClient({ id: "f".repeat(32), createdAt, passwordHash: "private password hash", verificationToken: "private token" });
  const cursor = encodeAccessCursor("clients", { createdAt: sqlTimestamp(createdAt, "100"), id: second.id });
  state.clients = { clients: [{ ...client, notes: "private CRM notes" }, second], hasMore: true, nextCursor: cursor, rawToken: token };
  assert.deepEqual(await service.listClients(token, { limit: 2 }), { clients: [client, syntheticClient({ id: second.id, createdAt })], hasMore: true, nextCursor: cursor });
  const invitation = syntheticInvitation();
  state.invitations = { invitations: [{ ...invitation, tokenHash: "secret digest", url: "secret invitation link" }], hasMore: false, nextCursor: null, issuerPassword: "secret" };
  assert.deepEqual(await service.listInvitations(token), { invitations: [invitation], hasMore: false, nextCursor: null });
});

test("admin page DTOs reject duplicates, overflow, wrong cursor ownership and malformed fields", async () => {
  const client = syntheticClient();
  const cursor = encodeAccessCursor("clients", { createdAt: sqlTimestamp(client.createdAt), id: client.id });
  const wrongCursor = encodeAccessCursor("clients", { createdAt: sqlTimestamp(client.createdAt), id: "c".repeat(32) });
  const cases = [
    { clients: [client, client], hasMore: false, nextCursor: null },
    { clients: [client], hasMore: false, nextCursor: cursor },
    { clients: [client], hasMore: true, nextCursor: cursor },
    { clients: [], hasMore: true, nextCursor: cursor },
    { clients: [client], hasMore: true, nextCursor: wrongCursor },
    { clients: [client], hasMore: true, nextCursor: "malformed" },
    { clients: [{ ...client, email: "CLIENT@example.invalid" }], hasMore: false, nextCursor: null },
    { clients: [{ ...client, createdAt: NaN }], hasMore: false, nextCursor: null },
    { clients: [{ ...client, emailVerified: 1 }], hasMore: false, nextCursor: null },
    { clients: [{ ...client, status: "admin" }], hasMore: false, nextCursor: null },
  ];
  for (const page of cases) {
    state.clients = page;
    await assert.rejects(service.listClients(token), { code: "AUTH_UNAVAILABLE" });
  }
  state.clients = { clients: [client, { ...client, id: "c".repeat(32) }], hasMore: false, nextCursor: null };
  await assert.rejects(service.listClients(token, { limit: 1 }), { code: "AUTH_UNAVAILABLE" });
});

test("admin page boundaries compare exact cursor precision and reject newer dates", async () => {
  const client = syntheticClient();
  const cursor = encodeAccessCursor("clients", { createdAt: sqlTimestamp(client.createdAt, "900"), id: "1".repeat(32) });
  const next = encodeAccessCursor("clients", { createdAt: sqlTimestamp(client.createdAt, "100"), id: client.id });
  state.clients = { clients: [client], hasMore: true, nextCursor: next };
  assert.equal((await service.listClients(token, { cursor, limit: 1 })).nextCursor, next);
  state.clients.nextCursor = cursor;
  state.clients.clients = [syntheticClient({ id: "1".repeat(32) })];
  await assert.rejects(service.listClients(token, { cursor }), { code: "AUTH_UNAVAILABLE" });
  state.clients = { clients: [syntheticClient({ createdAt: client.createdAt + 1 })], hasMore: false, nextCursor: null };
  await assert.rejects(service.listClients(token, { cursor }), { code: "AUTH_UNAVAILABLE" });
});

test("invitation DTOs validate finite dates, lifecycle state, duration and consumed identities", async () => {
  const invitation = syntheticInvitation();
  for (const row of [{ ...invitation, accessDays: 0 }, { ...invitation, expiresAt: invitation.createdAt },
    { ...invitation, state: "used" }, { ...invitation, consumedById: "d".repeat(32) }, { ...invitation, state: "active" }]) {
    state.invitations = { invitations: [row], nextCursor: null, hasMore: false };
    await assert.rejects(service.listInvitations(token), { code: "AUTH_UNAVAILABLE" });
  }
});

test("renewal validates the snapshot, identifier, finite extension and options before authentication or SQL", async () => {
  const valid = { expectedExpiresAt: now, accessDays: 30 };
  for (const input of [null, [], {}, { ...valid, expectedExpiresAt: null }, { ...valid, expectedExpiresAt: -1 },
    { ...valid, expectedExpiresAt: 1.2 }, { ...valid, expectedExpiresAt: Number.MAX_SAFE_INTEGER },
    { ...valid, accessDays: null }, { ...valid, accessDays: 0 }, { ...valid, accessDays: 3651 },
    { ...valid, accessDays: "30" }, { ...valid, overrideAge: true }]) {
    await assert.rejects(service.renewClient(token, "a".repeat(32), input), { code: "ACCESS_INPUT" });
  }
  await assert.rejects(service.renewClient(token, "not-an-id", valid), { code: "ACCESS_INPUT" });
  await assert.rejects(service.renewClient(token, "a".repeat(32), { expectedExpiresAt: now + 86400000, accessDays: 3650 }), { code: "ACCESS_INPUT" });
  assert.equal(state.sessionCalls, 0); assert.equal(captured.length, 0);
});

test("renewals use distinct stable user-first write budgets and a fresh time without changing any gates", async () => {
  const started = now, expectedExpiresAt = now + 100000; state.quotaAdvance = 1000;
  const result = await service.renewClient(token, "A".repeat(32), { expectedExpiresAt, accessDays: 30 });
  assert.deepEqual(result, { id: "a".repeat(32), accessExpiresAt: expectedExpiresAt + 30 * 86400000 });
  const command = captured.find((item) => item.kind === "renewClient");
  assert.deepEqual(command.options, { now: started + 2000, expectedExpiresAt, accessDays: 30 });
  assert.deepEqual(command.id, Buffer.from("a".repeat(32), "hex"));
  assert.deepEqual(command.hash, tokenDigest(token));
  const writes = captured.filter((item) => !item.kind);
  assert.deepEqual(writes.map((item) => item.options.limit), [30, 120]);
  captured = []; await service.listClients(token);
  const reads = captured.filter((item) => !item.kind);
  assert.ok(writes.every((write) => reads.every((read) => !write.hash.equals(read.hash))));
});

test("expired snapshots extend from the fresh present time, and missing clients return null", async () => {
  const started = now; state.quotaAdvance = 1000;
  assert.deepEqual(await service.renewClient(token, "a".repeat(32), { expectedExpiresAt: started - 10000, accessDays: 1 }),
    { id: "a".repeat(32), accessExpiresAt: started + 2000 + 86400000 });
  state.renewed = null;
  assert.equal(await service.renewClient(token, "a".repeat(32), { expectedExpiresAt: now, accessDays: 1 }), null);
});

test("renewal propagates only neutral business conflicts, gate refusals and authorization failures", async () => {
  for (const code of ["ACCESS_CONFLICT", "ACCESS_PREREQUISITES", "ACCESS_FORBIDDEN", "ACCESS_INPUT", "UNKNOWN_SQL_FAILURE"]) {
    state.storeError = code;
    await assert.rejects(service.renewClient(token, "a".repeat(32), { expectedExpiresAt: now, accessDays: 1 }),
      (error) => error.code === (code === "UNKNOWN_SQL_FAILURE" ? "AUTH_UNAVAILABLE" : code) && !error.message.includes("Sensitive"));
  }
});

test("renewal never reaches persistence for an unauthorized actor or denied user budget", async () => {
  state.adminRole = "client";
  await assert.rejects(service.renewClient(token, "a".repeat(32), { expectedExpiresAt: now, accessDays: 1 }), { code: "ACCESS_FORBIDDEN" });
  assert.equal(captured.length, 0);
  state.adminRole = "admin"; state.quotaResults = [{ allowed: false, retryAfter: 9 }];
  await assert.rejects(service.renewClient(token, "a".repeat(32), { expectedExpiresAt: now, accessDays: 1 }),
    (error) => error.code === "AUTH_RATE_LIMIT" && error.retryAfter === 9);
  assert.equal(captured.length, 1); assert.equal(captured[0].options.limit, 30);
});

test("renewal rebuilds its DTO and rejects mismatched identities, shortening or fabricated expiration", async () => {
  const expectedExpiresAt = now + 100000, accessExpiresAt = expectedExpiresAt + 86400000;
  state.renewed = { id: "a".repeat(32), accessExpiresAt, session: "private session", approved: true };
  assert.deepEqual(await service.renewClient(token, "a".repeat(32), { expectedExpiresAt, accessDays: 1 }), { id: "a".repeat(32), accessExpiresAt });
  for (const result of [false, {}, { id: "b".repeat(32), accessExpiresAt }, { id: "a".repeat(32), accessExpiresAt: null },
    { id: "a".repeat(32), accessExpiresAt: expectedExpiresAt - 1 }, { id: "a".repeat(32), accessExpiresAt: accessExpiresAt + 1 }]) {
    state.renewed = result;
    await assert.rejects(service.renewClient(token, "a".repeat(32), { expectedExpiresAt, accessDays: 1 }), { code: "AUTH_UNAVAILABLE" });
  }
});
