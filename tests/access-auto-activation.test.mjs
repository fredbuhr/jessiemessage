import test from "node:test";
import assert from "node:assert/strict";
import { createAccessStore } from "../server/access/store.mjs";

const now = Date.UTC(2026, 9, 30, 20), client = Buffer.alloc(16, 1), owner = Buffer.alloc(16, 2), session = Buffer.alloc(16, 3), token = Buffer.alloc(32, 4);
const date = value => new Date(value).toISOString().replace("T", " ").replace("Z", "000");

function fixture({ status = "pending", verified = true, invitationCount = 1, conversation = null, expireDuringGrant = false } = {}) {
  const state = { at: now, commits: 0, rollbacks: 0, grantWrites: 0, conversationWrites: 0, committedGrant: false };
  const user = { id: client, role: "client", status, pseudonym: "Synthetic client", email_verified_at: verified ? date(now - 500) : null,
    age_assured_at: null, access_approved_at: null, access_expires_at: null, invitation_consumed_at: date(now - 1000) };
  const invitation = { created_by_id: owner, access_days: 2, consumed_at: date(now - 1000) };
  const connection = {
    async beginTransaction() {},
    async commit() { state.commits++; state.committedGrant = state.grantWrites > 0; },
    async rollback() { state.rollbacks++; state.committedGrant = false; }, release() {},
    async query(sql, params) {
      if (sql.startsWith("SELECT user_id FROM sessions")) return [{ user_id: client }];
      if (sql.startsWith("SELECT i.created_by_id FROM invitations i JOIN users")) return status === "pending" ? Array.from({ length: invitationCount }, () => ({ created_by_id: owner })) : [];
      if (sql.startsWith("SELECT role, status FROM users")) return [{ role: "admin", status: "active" }];
      if (sql.startsWith("SELECT enabled_at FROM admin_mfa")) return [{ enabled_at: date(now - 1000) }];
      if (sql.startsWith("SELECT id, role, status, pseudonym")) return [{ ...user }];
      if (sql.startsWith("SELECT credential_version FROM client_auth_state")) return [{ credential_version: 1 }];
      if (sql.startsWith("SELECT s.id, s.created_at")) return [{ id: session, created_at: date(now - 1000), expires_at: date(now + 1000),
        revoked_at: null, last_seen_at: date(now), credential_version: 1 }];
      if (sql.startsWith("SELECT access_days, consumed_at, created_by_id")) return Array.from({ length: invitationCount }, () => invitation);
      if (sql.startsWith("SELECT id, admin_id, closed_at FROM conversations")) return conversation ? [conversation] : [];
      if (sql.startsWith("UPDATE users SET status = 'active'")) { state.grantWrites++; return { affectedRows: 1 }; }
      if (sql.startsWith("INSERT INTO conversations")) {
        assert.deepEqual(params[1], client); assert.deepEqual(params[2], owner);
        state.conversationWrites++;
        if (expireDuringGrant) state.at = now + 1000;
        return { affectedRows: 1 };
      }
      if (/^UPDATE (?:client_session_state|sessions) /.test(sql)) return { affectedRows: 1 };
      throw Error("Unexpected synthetic query: " + sql);
    },
  };
  const store = createAccessStore({ getConnection: async () => connection }, { clock: () => state.at });
  return { state, read: () => store.getClientSession(token, { now, idleSeconds: 0 }) };
}

test("a legacy confirmed pending session activates its invitation and creates the owner's conversation", async () => {
  const f = fixture(); const result = await f.read();
  assert.equal(result.access.state, "active"); assert.equal(result.access.approved, true);
  assert.equal(result.access.expiresAt, now + 2 * 86400000);
  assert.equal(f.state.grantWrites, 1); assert.equal(f.state.conversationWrites, 1);
  assert.equal(f.state.committedGrant, true); assert.equal(f.state.rollbacks, 0);
});

test("expiry during the activation writes rolls back the rejected session and grant together", async () => {
  const f = fixture({ expireDuringGrant: true });
  assert.equal(await f.read(), null);
  assert.equal(f.state.grantWrites, 1, "exercise the post-write expiry guard");
  assert.equal(f.state.commits, 0); assert.equal(f.state.rollbacks, 1);
  assert.equal(f.state.committedGrant, false);
});

for (const [name, options] of [
  ["unverified mailbox", { verified: false }], ["missing invitation", { invitationCount: 0 }],
  ["duplicate invitation", { invitationCount: 2 }], ["revoked client", { status: "revoked" }],
  ["suspended client", { status: "suspended" }],
  ["closed conversation", { conversation: { id: session, admin_id: owner, closed_at: date(now - 1) } }],
  ["different conversation owner", { conversation: { id: session, admin_id: Buffer.alloc(16, 9), closed_at: null } }],
]) test(`automatic activation refuses ${name} without a grant or new conversation`, async () => {
  const f = fixture(options); assert.equal(await f.read(), null);
  assert.equal(f.state.grantWrites, 0); assert.equal(f.state.conversationWrites, 0);
});
