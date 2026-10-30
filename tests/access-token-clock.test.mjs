import test from "node:test";
import assert from "node:assert/strict";
import { createAccessStore } from "../server/access/store.mjs";

const NOW = Date.UTC(2026, 9, 14, 12);
const id = value => Buffer.alloc(16, value);
const hash = value => Buffer.alloc(32, value);
const sqlDate = value => new Date(value).toISOString().replace("T", " ").replace("Z", "000");
const passwordHash = "synthetic-client-hash";

function barrier() {
  let entered, release;
  const waiting = new Promise(resolve => { entered = resolve; });
  const held = new Promise(resolve => { release = resolve; });
  return { waiting, release, async hold() { entered(); await held; } };
}

function fixture({ clock = true, invitationExpiresAt = NOW + 1000, verificationExpiresAt = NOW + 1000 } = {}) {
  const state = { at: NOW, reads: [], writes: [], connections: 0, commits: 0, rollbacks: 0, poolWait: null, afterRead: null };
  const invitation = { id: id(1), created_by_id: id(2), created_at: new Date(NOW - 1000),
    expires_at: new Date(invitationExpiresAt), consumed_at: null, revoked_at: null, access_days: 2 };
  const user = { id: id(3), role: "client", status: "pending", email_verified_at: null, password_hash: passwordHash };
  const verification = { id: id(4), user_id: user.id, created_at: new Date(NOW - 1000),
    expires_at: new Date(verificationExpiresAt), consumed_at: null, revoked_at: null };
  function read(sql, parameters) {
    if (sql.startsWith("SELECT i.expires_at, i.access_days")) {
      const requestedAt = Date.parse(`${parameters[1].replace(" ", "T")}Z`);
      return requestedAt >= invitation.created_at.getTime() && requestedAt < invitationExpiresAt ? [invitation] : [];
    }
    if (sql.startsWith("SELECT created_by_id FROM invitations")) return [{ created_by_id: invitation.created_by_id }];
    if (sql.startsWith("SELECT role, status FROM users")) return [{ role: "admin", status: "active" }];
    if (sql.startsWith("SELECT enabled_at FROM admin_mfa")) return [{ enabled_at: new Date(NOW - 1000) }];
    if (sql.startsWith("SELECT id, created_by_id, created_at, expires_at")) return [invitation];
    if (sql.startsWith("SELECT user_id FROM email_verifications")) return [{ user_id: user.id }];
    if (sql.startsWith("SELECT i.created_by_id FROM invitations i JOIN users")) return [{ created_by_id: invitation.created_by_id }];
    if (sql.startsWith("SELECT access_days, consumed_at, created_by_id FROM invitations")) return [{ ...invitation, consumed_at: new Date(NOW - 1000) }];
    if (sql.startsWith("SELECT id, admin_id, closed_at FROM conversations")) return [];
    if (sql.startsWith("SELECT id, role, status, email_verified_at FROM users")) return [user];
    if (sql.startsWith("SELECT id, user_id, created_at, expires_at")) return [verification];
    if (sql.startsWith("SELECT role, status, password_hash, email_verified_at FROM users")) return [user];
    if (sql.startsWith("SELECT credential_version FROM client_auth_state")) return [{ credential_version: 1 }];
    throw new Error(`Unexpected synthetic query: ${sql}`);
  }
  const connection = {
    async beginTransaction() {},
    async commit() { state.commits += 1; },
    async rollback() { state.rollbacks += 1; },
    release() {},
    async query(sql, parameters) {
      if (/^(?:INSERT|UPDATE)\b/.test(sql)) {
        state.writes.push({ sql, parameters });
        return { affectedRows: 1 };
      }
      state.reads.push({ sql, parameters });
      const rows = read(sql, parameters);
      await state.afterRead?.(sql);
      return rows;
    },
  };
  const pool = { async getConnection() {
    state.connections += 1;
    await state.poolWait?.();
    return connection;
  } };
  const store = createAccessStore(pool, clock ? { clock: () => state.at } : {});
  const challenge = expiresAt => ({ id: id(5), tokenHash: hash(5), expiresAt });
  const mail = { id: id(6), payloadEncrypted: "synthetic-encrypted-verification" };
  const registration = (expiresAt = NOW + 10000) => ({ invitationHash: hash(1), now: NOW,
    user: { id: user.id, email: "clock@example.invalid", pseudonym: "Synthetic client", passwordHash },
    verification: challenge(expiresAt), mail });
  const reissue = (expiresAt = NOW + 10000) => ({ userId: user.id, expectedPasswordHash: passwordHash,
    expectedVersion: 1, verification: challenge(expiresAt), mail, now: NOW });
  return { state, store, invitation, user, verification, registration, reissue };
}

const lastInvitationLock = sql => sql.startsWith("SELECT id, created_by_id, created_at, expires_at");
const lastVerificationLock = sql => sql.startsWith("SELECT id, user_id, created_at, expires_at");
const lastCredentialLock = sql => sql.startsWith("SELECT credential_version FROM client_auth_state");

test("invitation inspection refreshes its query time after waiting for a connection", async () => {
  const f = fixture(), gate = barrier();
  f.state.poolWait = () => gate.hold();
  const pending = f.store.inspectInvitation(hash(1), { now: NOW });
  await gate.waiting;
  f.state.at = NOW + 1000;
  gate.release();
  assert.equal(await pending, null);
  assert.equal(f.state.reads[0].parameters[1], sqlDate(f.state.at));
  assert.deepEqual(f.state.writes, []);
});

test("invitation inspection rejects a result whose expiry elapsed during its query", async () => {
  const f = fixture(), gate = barrier();
  f.state.afterRead = () => gate.hold();
  const pending = f.store.inspectInvitation(hash(1), { now: NOW });
  await gate.waiting;
  f.state.at = NOW + 1000;
  gate.release();
  assert.equal(await pending, null);
  assert.deepEqual(f.state.writes, []);
});

test("invitation inspection still returns a challenge before the refreshed expiry", async () => {
  const f = fixture();
  f.state.at = NOW + 999;
  assert.deepEqual(await f.store.inspectInvitation(hash(1), { now: NOW }), { expiresAt: NOW + 1000, accessDays: 2 });
  assert.deepEqual(f.state.writes, []);
});

test("registration refuses an invitation expiring while its final row lock is pending", async () => {
  const f = fixture();
  f.state.afterRead = sql => { if (lastInvitationLock(sql)) f.state.at = NOW + 1000; };
  assert.equal(await f.store.register(f.registration()), false);
  assert.deepEqual(f.state.writes, []);
});

test("registration records fresh timestamps without extending its verification challenge", async () => {
  const f = fixture(), at = NOW + 999, command = f.registration();
  f.state.afterRead = sql => { if (lastInvitationLock(sql)) f.state.at = at; };
  assert.equal(await f.store.register(command), true);
  assert.equal(f.state.commits, 1);
  const users = f.state.writes.find(write => write.sql.startsWith("INSERT INTO users"));
  assert.deepEqual(users.parameters.slice(-2), [sqlDate(at), sqlDate(at)]);
  const consumption = f.state.writes.find(write => write.sql.startsWith("UPDATE invitations SET consumed_at"));
  assert.equal(consumption.parameters[0], sqlDate(at));
  const challenge = f.state.writes.find(write => write.sql.startsWith("INSERT INTO email_verifications"));
  assert.deepEqual(challenge.parameters.slice(-2), [sqlDate(at), sqlDate(command.verification.expiresAt)]);
  const mail = f.state.writes.find(write => write.sql.startsWith("INSERT INTO mail_outbox"));
  assert.deepEqual(mail.parameters.slice(-3), [sqlDate(at), sqlDate(command.verification.expiresAt), sqlDate(at)]);
});

test("registration does not consume a valid invitation when its proposed verification expired during the lock wait", async () => {
  const f = fixture({ invitationExpiresAt: NOW + 10000 });
  f.state.afterRead = sql => { if (lastInvitationLock(sql)) f.state.at = NOW + 1000; };
  assert.equal(await f.store.register(f.registration(NOW + 1000)), false);
  assert.deepEqual(f.state.writes, []);
});

test("email verification refuses a challenge expiring while the final token lock is pending", async () => {
  const f = fixture();
  f.state.afterRead = sql => { if (lastVerificationLock(sql)) f.state.at = NOW + 1000; };
  assert.equal(await f.store.verifyEmail(hash(4), { now: NOW }), false);
  assert.deepEqual(f.state.writes, []);
});

test("email verification consumes and revokes at the fresh time obtained after its token lock", async () => {
  const f = fixture(), at = NOW + 999;
  f.state.afterRead = sql => { if (lastVerificationLock(sql)) f.state.at = at; };
  assert.equal(await f.store.verifyEmail(hash(4), { now: NOW }), true);
  const user = f.state.writes.find(write => write.sql.startsWith("UPDATE users SET status = 'active', email_verified_at"));
  assert.deepEqual(user.parameters, [sqlDate(at), sqlDate(at), sqlDate(at + 2 * 86400000), sqlDate(at), f.user.id]);
  const consumed = f.state.writes.find(write => write.sql.startsWith("UPDATE email_verifications SET consumed_at"));
  assert.deepEqual(consumed.parameters, [sqlDate(at), f.verification.id]);
  const revoked = f.state.writes.find(write => write.sql.startsWith("UPDATE email_verifications SET revoked_at"));
  assert.deepEqual(revoked.parameters, [sqlDate(at), f.user.id, sqlDate(at)]);
  assert.equal(f.state.writes.filter(write => write.sql.startsWith("UPDATE mail_outbox SET status = 'cancelled'")).length, 1);
  assert.equal(f.state.commits, 1);
});

test("automatic activation rechecks challenge expiry after waiting for its conversation lock", async () => {
  const f = fixture();
  f.state.afterRead = sql => { if (sql.startsWith("SELECT id, admin_id, closed_at FROM conversations")) f.state.at = NOW + 1000; };
  assert.equal(await f.store.verifyEmail(hash(4), { now: NOW }), false);
  assert.deepEqual(f.state.writes, []);
});

test("verification resend leaves old links and mail intact when its new challenge expired during the credential lock", async () => {
  const f = fixture();
  f.state.afterRead = sql => { if (lastCredentialLock(sql)) f.state.at = NOW + 1000; };
  assert.equal(await f.store.reissueVerification(f.reissue(NOW + 1000)), false);
  assert.deepEqual(f.state.writes, []);
});

test("verification resend revokes old links and queues its unchanged challenge using fresh timestamps", async () => {
  const f = fixture(), at = NOW + 999, command = f.reissue();
  f.state.afterRead = sql => { if (lastCredentialLock(sql)) f.state.at = at; };
  assert.equal(await f.store.reissueVerification(command), true);
  const revoked = f.state.writes.find(write => write.sql.startsWith("UPDATE email_verifications SET revoked_at"));
  assert.deepEqual(revoked.parameters, [sqlDate(at), f.user.id, sqlDate(at)]);
  assert.equal(f.state.writes.filter(write => write.sql.startsWith("UPDATE mail_outbox SET status = 'cancelled'")).length, 1);
  const challenge = f.state.writes.find(write => write.sql.startsWith("INSERT INTO email_verifications"));
  assert.deepEqual(challenge.parameters.slice(-2), [sqlDate(at), sqlDate(command.verification.expiresAt)]);
  const mail = f.state.writes.find(write => write.sql.startsWith("INSERT INTO mail_outbox"));
  assert.deepEqual(mail.parameters.slice(-3), [sqlDate(at), sqlDate(command.verification.expiresAt), sqlDate(at)]);
});

test("a store without an injected clock retains the caller's synthetic instant", async () => {
  const f = fixture({ clock: false });
  f.state.at = NOW + 10000;
  assert.deepEqual(await f.store.inspectInvitation(hash(1), { now: NOW }), { expiresAt: NOW + 1000, accessDays: 2 });
  assert.equal(await f.store.register(f.registration()), true);
  assert.equal(f.state.writes.find(write => write.sql.startsWith("UPDATE invitations SET consumed_at")).parameters[0], sqlDate(NOW));
});

test("malformed challenge inputs still fail before any connection or mutation", async () => {
  const f = fixture();
  for (const command of [
    () => f.store.inspectInvitation(Buffer.alloc(31), { now: NOW }),
    () => f.store.register({ ...f.registration(), verification: { id: id(5), tokenHash: hash(5), expiresAt: NaN } }),
    () => f.store.verifyEmail(Buffer.alloc(31), { now: NOW }),
    () => f.store.reissueVerification({ ...f.reissue(), verification: { id: id(5), tokenHash: hash(5), expiresAt: NaN } }),
  ]) await assert.rejects(command(), { code: "ACCESS_STORE_INPUT" });
  assert.equal(f.state.connections, 0);
  assert.deepEqual(f.state.writes, []);
});
