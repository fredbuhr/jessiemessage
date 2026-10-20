import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createResetStore } from "../server/reset/store.mjs";

const now = Date.UTC(2026, 9, 20, 12), userId = Buffer.alloc(16, 1), tokenHash = Buffer.alloc(32, 2), resetId = Buffer.alloc(16, 3);
const date = value => new Date(value), sqlDate = value => date(value).toISOString().replace("T", " ").replace("Z", "000");

function fixture({ waitAt = null, waitTo = now, expiresAt = now + 1000, injected = true } = {}) {
  const state = { at: now, writes: [], committed: 0, rolledBack: 0 };
  const user = { id: userId, role: "client", status: "active", email: "clock@example.invalid", password_hash: "synthetic-original-hash", email_verified_at: date(now - 1000) };
  const auth = { credential_version: 1 };
  const reset = { id: resetId, user_id: userId, created_at: date(now - 1000), expires_at: date(expiresAt), consumed_at: null, revoked_at: null,
    credential_version: 1, email_hash: createHash("sha256").update(user.email).digest() };
  async function wait(point) { if (waitAt === point) { await Promise.resolve(); state.at = waitTo; } }
  const connection = {
    async beginTransaction() {}, async commit() { state.committed++; }, async rollback() { state.rolledBack++; }, release() {},
    async query(sql, values = []) {
      if (sql.startsWith("SELECT user_id FROM client_password_resets")) return [{ user_id: userId }];
      if (sql.startsWith("SELECT id, role, status, email")) { await wait("user"); return [user]; }
      if (sql.startsWith("SELECT credential_version")) { await wait("auth"); return [auth]; }
      if (sql.startsWith("SELECT * FROM client_password_resets")) { await wait("reset"); return [reset]; }
      if (/^(?:UPDATE|INSERT)/.test(sql)) {
        state.writes.push([sql, values]);
        if (sql.startsWith("UPDATE users SET password_hash")) user.password_hash = values[0];
        if (sql.startsWith("UPDATE client_auth_state")) auth.credential_version++;
        if (sql.startsWith("UPDATE client_password_resets SET consumed_at")) reset.consumed_at = values[0];
        return { affectedRows: 1 };
      }
      throw new Error("Unexpected synthetic reset-store query");
    },
  };
  const store = createResetStore({ async getConnection() { await wait("pool"); return connection; } }, injected ? { clock: () => state.at } : {});
  const inspect = () => store.inspectReset({ tokenHash, now });
  const consume = () => store.consumeReset({ tokenHash, expectedUserId: userId, expectedVersion: 1, passwordHash: "synthetic-new-hash", now });
  const request = () => store.requestReset({ email: user.email, now, reset: { id: resetId, tokenHash, expiresAt }, mail: { id: Buffer.alloc(16, 4), payloadEncrypted: "synthetic-encrypted-mail" } });
  return { state, user, auth, reset, inspect, consume, request };
}

for (const waitAt of ["pool", "user", "auth", "reset"]) test(`reset inspection and consumption reject expiry crossed while awaiting ${waitAt}`, async () => {
  for (const action of ["inspect", "consume"]) {
    const f = fixture({ waitAt, waitTo: now + 1000 });
    assert.equal(await f[action](), action === "inspect" ? null : false);
    assert.equal(f.user.password_hash, "synthetic-original-hash");
    assert.equal(f.auth.credential_version, 1); assert.equal(f.reset.consumed_at, null);
    assert.deepEqual(f.state.writes, []);
  }
});

test("a reset completed before expiry uses the locked instant for every credential and revocation timestamp", async () => {
  const f = fixture({ waitAt: "reset", waitTo: now + 999 });
  assert.equal(await f.consume(), true);
  assert.equal(f.auth.credential_version, 2); assert.equal(f.reset.consumed_at, sqlDate(now + 999));
  const timedWrites = f.state.writes.filter(([sql]) => /UPDATE users|UPDATE client_password_resets|UPDATE sessions/.test(sql));
  for (const [sql, values] of timedWrites) assert.equal(values[sql.startsWith("UPDATE users") ? 1 : 0], sqlDate(now + 999));
  assert.equal(await f.consume(), false, "the same proof cannot increment credentials twice");
  assert.equal(f.auth.credential_version, 2);
});

test("reset inspection remains read-only before expiry and current generation, revocation and consumption still govern access", async () => {
  const live = fixture({ waitAt: "reset", waitTo: now + 999 });
  assert.deepEqual(await live.inspect(), { userId, credentialVersion: 1 }); assert.deepEqual(live.state.writes, []);
  for (const kind of ["generation", "revoked", "consumed"]) {
    const f = fixture({ waitAt: "reset", waitTo: now + 999 });
    if (kind === "generation") f.auth.credential_version = 2;
    else f.reset[kind === "revoked" ? "revoked_at" : "consumed_at"] = date(now);
    assert.equal(await f.consume(), false, kind); assert.deepEqual(f.state.writes, []);
  }
});

for (const waitAt of ["pool", "user", "auth"]) test(`an unissued reset expiring during ${waitAt} leaves older links and queued mail untouched`, async () => {
  const f = fixture({ waitAt, waitTo: now + 1000 });
  assert.equal(await f.request(), false); assert.deepEqual(f.state.writes, []);
});

test("a still-live reset request uses the current creation instant without extending its supplied deadline", async () => {
  const f = fixture({ waitAt: "auth", waitTo: now + 500 });
  assert.equal(await f.request(), true);
  const reset = f.state.writes.find(([sql]) => sql.startsWith("INSERT INTO client_password_resets"))[1];
  assert.equal(reset[5], sqlDate(now + 500)); assert.equal(reset[6], sqlDate(now + 1000));
  const mail = f.state.writes.find(([sql]) => sql.startsWith("INSERT INTO password_reset_outbox"))[1];
  assert.deepEqual(mail.slice(4), [sqlDate(now + 500), sqlDate(now + 1000), sqlDate(now + 500)]);
});

test("direct reset-store callers retain their explicit historical instant when no clock is injected", async () => {
  const f = fixture({ waitAt: "reset", waitTo: now + 2000, injected: false });
  assert.equal(await f.consume(), true); assert.equal(f.reset.consumed_at, sqlDate(now));
});

test("an invalid injected reset clock fails closed before credential mutations", async () => {
  const f = fixture({ waitAt: "reset", waitTo: NaN });
  await assert.rejects(f.consume(), { code: "RESET_DATABASE_OPERATION" });
  assert.deepEqual(f.state.writes, []); assert.equal(f.state.rolledBack, 1);
});
