import test from "node:test";
import assert from "node:assert/strict";
import { ADMIN_SESSION_SECONDS, CLIENT_SESSION_SECONDS, adminSessionExpiry, createSessionClock, sessionIsValid } from "../server/auth/session-policy.mjs";
import { createAuthStore } from "../server/auth/store.mjs";
import { createAccessStore } from "../server/access/store.mjs";
import { createChatStore } from "../server/chat/store.mjs";
import { sessionCookie } from "../server/auth/http.mjs";

const now = Date.UTC(2026, 9, 16, 20), userId = Buffer.alloc(16, 1), sessionId = Buffer.alloc(16, 2), hash = Buffer.alloc(32, 3);
const date = (value) => new Date(value);
function fixture(role = "admin", { at = now, seen = now - 3600000, expires = adminSessionExpiry(now), waitTo = null } = {}) {
  const state = { at, seen, expires, revoked: null, mfaVersion: 1, proofVersion: 1, waitTo, records: null, queried: [], committed: 0, rolledBack: 0 };
  const user = { id: userId, role, status: "active", pseudonym: "Test", email_verified_at: date(now - 7200000), access_approved_at: date(now - 7200000),
    age_assured_at: null, access_expires_at: null, invitation_consumed_at: date(now - 7200000) };
  const session = () => ({ id: sessionId, user_id: userId, created_at: date(now - 7200000), expires_at: date(state.expires), revoked_at: state.revoked,
    last_seen_at: date(state.seen), mfa_verified_at: date(now - 7200000), mfa_version: state.proofVersion, credential_version: state.proofVersion });
  const connection = { async beginTransaction() {}, async commit() { state.committed++; }, async rollback() { state.rolledBack++; }, release() {},
    async query(sql, values = []) {
      state.queried.push([sql, values]);
      if (sql.startsWith("SET TRANSACTION")) return [];
      if (sql.startsWith("SELECT user_id FROM sessions")) return [{ user_id: userId }];
      if (sql.includes("FROM users") && sql.includes("FOR UPDATE")) return [user];
      if (sql.includes("FROM admin_mfa")) return [{ version: state.mfaVersion, enabled_at: date(now - 7200000) }];
      if (sql.includes("FROM client_auth_state")) return [{ credential_version: state.mfaVersion }];
      if (sql.startsWith("SELECT s.id, s.created_at")) return state.records ?? [session()];
      if (sql.startsWith("SELECT s.id FROM sessions")) {
        assert.deepEqual(values[1], userId, "device revocation must be scoped to the locked actor");
        return values[0].equals(sessionId) ? [{ id: sessionId }] : [];
      }
      if (sql.includes("JOIN auth_session_state") || sql.includes("JOIN client_session_state")) {
        if (state.waitTo !== null) { state.at = state.waitTo; state.seen = state.waitTo - 100; }
        return [session()];
      }
      if (sql.startsWith("UPDATE auth_session_state") || sql.startsWith("UPDATE client_session_state")) { state.seen = Date.parse(`${values[0].replace(" ", "T")}Z`); return { affectedRows: 1 }; }
      if (sql.startsWith("UPDATE sessions SET expires_at")) { state.expires = Date.parse(`${values[0].replace(" ", "T")}Z`); return { affectedRows: 1 }; }
      if (sql.startsWith("UPDATE sessions SET revoked_at")) { state.revoked = values[0]; return { affectedRows: 1 }; }
      if (sql.startsWith("INSERT INTO invitations")) return { affectedRows: 1 };
      throw new Error(`Unexpected test SQL: ${sql}`);
    } };
  return { state, session, pool: { async getConnection() { return connection; } }, clock: () => state.at };
}

test("one policy gives administrators 180 sliding days and preserves client idle and absolute limits", () => {
  const base = { createdAt: now - 7200000, lastSeenAt: now - 3600000, expiresAt: now + 1000, now };
  assert.equal(sessionIsValid({ ...base, role: "admin" }), true);
  assert.equal(sessionIsValid({ ...base, role: "client" }), false);
  assert.equal(sessionIsValid({ ...base, role: "admin", expiresAt: now }), false);
  assert.equal(sessionIsValid({ ...base, role: "admin", lastSeenAt: now + 1 }), false);
  assert.equal(sessionIsValid({ ...base, role: "admin", createdAt: now + 1 }), false);
  assert.equal(adminSessionExpiry(now), now + 180 * 86400000);
  assert.throws(() => adminSessionExpiry(253402300799999));
});

test("injected session clocks are monotone and reject corrupt clock values", () => {
  let at = now;
  const read = createSessionClock(() => at);
  assert.equal(read(0), now); at -= 100; assert.equal(read(0), now);
  at = NaN; assert.throws(() => read(0));
  assert.equal(createSessionClock()(123), 123);
});

test("administrator cookies last 180 days, client cookies keep their eight-hour maximum", () => {
  const token = Buffer.alloc(32, 7).toString("base64url");
  assert.match(sessionCookie(token, adminSessionExpiry(now), undefined, { now }), new RegExp(`Max-Age=${ADMIN_SESSION_SECONDS};`));
  assert.match(sessionCookie(token, adminSessionExpiry(now), "__Host-jessie_client", { now }), new RegExp(`Max-Age=${CLIENT_SESSION_SECONDS};`));
});

test("administrator SQL reads survive idle and refresh only their own opaque session", async () => {
  const f = fixture();
  const record = await createAuthStore(f.pool, { clock: f.clock }).getSession(hash, { now, idleSeconds: 1800 });
  assert.equal(record.userId.equals(userId), true);
  assert.equal(record.expiresAt, adminSessionExpiry(now));
  assert.equal(f.state.seen, now);
  assert.equal(f.state.queried.some(([sql]) => /UPDATE sessions SET token_hash|DELETE FROM sessions/.test(sql)), false);
  assert.equal(f.state.committed, 1);
});

test("session authority is read after SQL lock waits, without accepting actually future rows", async () => {
  for (const kind of ["auth", "client", "chat", "access"]) {
    const role = kind === "client" ? "client" : "admin";
    const f = fixture(role, { seen: now, waitTo: now + 120000, expires: now + CLIENT_SESSION_SECONDS * 1000 });
    const options = { clock: f.clock };
    if (kind === "auth") assert.ok(await createAuthStore(f.pool, options).getSession(hash, { now, idleSeconds: 1800 }));
    if (kind === "client") assert.ok(await createAccessStore(f.pool, options).getClientSession(hash, { now, idleSeconds: 1800 }));
    if (kind === "chat") assert.equal(await createChatStore(f.pool, options).withActor({ role, tokenHash: hash, now }, async (_connection, actor) => actor.now), now + 120000);
    if (kind === "access") assert.ok(await createAccessStore(f.pool, options).createInvitation({ actorTokenHash: hash, now, id: Buffer.alloc(16, 4), tokenHash: Buffer.alloc(32, 4), expiresAt: now + 3600000, accessDays: 1 }));
  }
  const future = fixture("admin", { seen: now + 1000 });
  assert.equal(await createAuthStore(future.pool, { clock: future.clock }).getSession(hash, { now, idleSeconds: 1800 }), null);
  await assert.rejects(createChatStore(future.pool, { clock: future.clock }).withActor({ role: "admin", tokenHash: hash, now }, async () => true), { code: "CHAT_UNAUTHORIZED" });
});

test("client idle expiry and stale MFA generations still fail after authority moves", async () => {
  const f = fixture("client", { seen: now - 1800000 });
  assert.equal(await createAccessStore(f.pool, { clock: f.clock }).getClientSession(hash, { now, idleSeconds: 1800 }), null);
  const admin = fixture(); admin.state.proofVersion = 2;
  assert.equal(await createAuthStore(admin.pool, { clock: admin.clock }).getSession(hash, { now, idleSeconds: 1800 }), null);
});

test("device listing filters invalid proofs and leaks no session hashes, revocation scopes the same account", async () => {
  const f = fixture("admin", { seen: now });
  const good = f.session();
  f.state.records = [good, { ...good, id: Buffer.alloc(16, 7), last_seen_at: date(now + 1) }, { ...good, id: Buffer.alloc(16, 8), mfa_verified_at: date(now - 8000000) }];
  const store = createAuthStore(f.pool, { clock: f.clock });
  assert.deepEqual(await store.listDevices(hash, { now }), { devices: [{ id: sessionId, createdAt: now - 7200000, lastSeenAt: now, current: true }], nextCursor: null, hasMore: false });
  assert.deepEqual(await store.revokeDevice(hash, Buffer.alloc(16, 99), { now }), { found: false, current: false });
  assert.deepEqual(await store.revokeDevice(hash, sessionId, { now }), { found: true, current: true });
  assert.equal(await store.getSession(hash, { now, idleSeconds: 1800 }), null);
});

test("revoking all sessions waits for the account owner before touching any device", async () => {
  for (const role of ["admin", "client"]) {
    const f = fixture(role);
    const connection = await f.pool.getConnection(), query = connection.query.bind(connection);
    let entered = false, release;
    const gate = new Promise((resolve) => { release = resolve; });
    connection.query = async (sql, values) => {
      if (sql.startsWith("SELECT id FROM users") && sql.endsWith("FOR UPDATE")) { entered = true; await gate; }
      return query(sql, values);
    };
    const store = role === "admin" ? createAuthStore(f.pool, { clock: f.clock }) : createAccessStore(f.pool, { clock: f.clock });
    const pending = role === "admin" ? store.revokeAllSessions(userId, { now }) : store.revokeAllClientSessions(userId, { now });
    try {
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(entered, true, "global revocation must acquire the account lock used by device operations");
      assert.equal(f.state.queried.some(([sql]) => sql.startsWith("UPDATE sessions")), false, "no session may be locked while the account lock is pending");
    } finally { release(); }
    await pending; assert.equal(f.state.committed, 1);
  }
});
