import test from "node:test";
import assert from "node:assert/strict";
import { createChatStore } from "../server/chat/store.mjs";
import { createPreferencesStore } from "../server/preferences/store.mjs";
import { createPreferencesService } from "../server/preferences/service.mjs";
import { openPreferences, sealPreferences } from "../server/preferences/crypto.mjs";
import { PreferencesError, preferencesIndex, PREFERENCES_CATALOGUE_VERSION } from "../server/preferences/validation.mjs";

const now = 1792748656772, owner = Buffer.alloc(16, 7), key = Buffer.alloc(32, 11), token = Buffer.alloc(32, 9).toString("base64url");
const choices = [...preferencesIndex.keys()].slice(0, 2), catalogueVersion = PREFERENCES_CATALOGUE_VERSION;
const sqlDate = value => new Date(value).toISOString().replace("T", " ").replace("Z", "000");

// Exercise the real chat transaction/sanitizer, not a preferences service
// stand-in which would incorrectly let foreign callback errors pass through.
function fixture({ driverFailure = false, revoked = false, beforeSelect = null, beforeCommit = null } = {}) {
  const encrypted = sealPreferences({ catalogueVersion, selectedIds: [choices[0]] }, key, owner.toString("hex"), "2");
  const state = { commits: 0, rollbacks: 0, releases: 0, selected: 0, writes: 0 };
  const connection = {
    async query(sql, parameters) {
      if (sql === "SET TRANSACTION ISOLATION LEVEL READ COMMITTED") return [];
      if (sql === "SELECT user_id FROM sessions WHERE token_hash = ? LIMIT 1") return revoked ? [] : [{ user_id: owner }];
      if (sql.includes("FROM users WHERE id = ? FOR UPDATE")) return [{ id: owner, role: "admin", status: "active" }];
      if (sql.includes("FROM admin_mfa WHERE user_id = ? FOR UPDATE")) return [{ version: 1, enabled_at: sqlDate(now - 1000) }];
      if (sql.includes("FROM sessions s JOIN auth_session_state")) return [{ id: Buffer.alloc(16, 8), user_id: owner, created_at: sqlDate(now - 1000),
        expires_at: sqlDate(now + 3600000), revoked_at: null, last_seen_at: sqlDate(now - 1000), mfa_verified_at: sqlDate(now - 1000), mfa_version: 1 }];
      if (sql.startsWith("SELECT user_id, version, selection_encrypted FROM profile_preferences")) {
        state.selected++;
        await beforeSelect?.();
        if (driverFailure) throw Object.assign(new Error("SELECT secret database details"), { code: "PREFERENCES_CONFLICT" });
        return [{ user_id: owner, version: 2, selection_encrypted: encrypted }];
      }
      if (sql.startsWith("UPDATE profile_preferences SET version")) {
        state.writes++; state.pendingEncrypted = parameters[1]; return { affectedRows: 1 };
      }
      if (/^(?:INSERT|UPDATE|DELETE)/.test(sql)) state.writes++;
      throw new Error("Unexpected synthetic SQL");
    },
    async beginTransaction() {},
    async commit() { await beforeCommit?.(); state.commits++; state.committedEncrypted = state.pendingEncrypted; },
    async rollback() { state.rollbacks++; state.pendingEncrypted = undefined; }, release() { state.releases++; },
  };
  const pool = { async getConnection() { return connection; } };
  const store = createPreferencesStore({ pool, chatStore: createChatStore(pool, { clock: () => now }) });
  const service = createPreferencesService({ store, key, clock: () => now,
    chatService: { async actor() { return { user: { id: owner.toString("hex"), role: "admin" } }; } },
    authStore: { async consumeRateLimit() { return { allowed: true }; } },
  });
  return { service, state };
}
const rejected = code => error => error instanceof PreferencesError && error.code === code && !/SELECT|secret|database details/.test(error.message);

test("real chat rollback preserves a typed preferences conflict and exact replay commits without a write", async () => {
  const f = fixture();
  try {
    await assert.rejects(f.service.save("admin", token, { expectedVersion: "1", catalogueVersion, selectedIds: [choices[1]] }), rejected("PREFERENCES_CONFLICT"));
    assert.equal(f.state.rollbacks, 1); assert.equal(f.state.commits, 0); assert.equal(f.state.writes, 0);
    assert.deepEqual(await f.service.save("admin", token, { expectedVersion: "1", catalogueVersion, selectedIds: [choices[0]] }),
      { version: "2", catalogueVersion, selectedIds: [choices[0]] });
    assert.equal(f.state.commits, 1); assert.equal(f.state.writes, 0); assert.equal(f.state.releases, 2);
  } finally { f.service.close(); }
});

test("driver code lookalikes remain sanitized after rollback rather than impersonating a preferences conflict", async () => {
  const f = fixture({ driverFailure: true });
  try {
    await assert.rejects(f.service.save("admin", token, { expectedVersion: "1", catalogueVersion, selectedIds: [choices[1]] }), rejected("PREFERENCES_UNAVAILABLE"));
    assert.equal(f.state.rollbacks, 1); assert.equal(f.state.commits, 0); assert.equal(f.state.writes, 0);
  } finally { f.service.close(); }
});

test("chat authentication failure remains unauthorized and never reaches private preferences", async () => {
  const f = fixture({ revoked: true });
  try {
    await assert.rejects(f.service.read("admin", token), rejected("PREFERENCES_UNAUTHORIZED"));
    assert.equal(f.state.selected, 0); assert.equal(f.state.rollbacks, 1); assert.equal(f.state.writes, 0);
  } finally { f.service.close(); }
});

function gate() {
  let entered, release;
  const started = new Promise(resolve => { entered = resolve; }), waiting = new Promise(resolve => { release = resolve; });
  return { started, release, async wait() { entered(); await waiting; } };
}

test("shutdown before preferences encryption rolls back the real chat transaction without writing a zero-key envelope", async () => {
  const held = gate(), f = fixture({ beforeSelect: held.wait });
  const saving = f.service.save("admin", token, { expectedVersion: "2", catalogueVersion, selectedIds: [choices[1]] });
  await held.started; f.service.close(); held.release();
  await assert.rejects(saving, rejected("PREFERENCES_UNAVAILABLE"));
  assert.equal(f.state.writes, 0); assert.equal(f.state.commits, 0); assert.equal(f.state.rollbacks, 1);
  assert.equal(f.state.pendingEncrypted, undefined); assert.equal(f.state.releases, 1);
});

test("shutdown during an acknowledged preferences commit preserves the original encryption key and successful result", async () => {
  const held = gate(), f = fixture({ beforeCommit: held.wait });
  const saving = f.service.save("admin", token, { expectedVersion: "2", catalogueVersion, selectedIds: [choices[1]] });
  await held.started; f.service.close(); held.release();
  assert.deepEqual(await saving, { version: "3", catalogueVersion, selectedIds: [choices[1]] });
  assert.equal(f.state.writes, 1); assert.equal(f.state.commits, 1); assert.equal(f.state.rollbacks, 0);
  assert.deepEqual(openPreferences(f.state.committedEncrypted, key, owner.toString("hex"), "3"), { catalogueVersion, selectedIds: [choices[1]] });
  assert.throws(() => openPreferences(f.state.committedEncrypted, Buffer.alloc(32), owner.toString("hex"), "3"), rejected("PREFERENCES_UNAVAILABLE"));
  await assert.rejects(f.service.read("admin", token), rejected("PREFERENCES_UNAVAILABLE"));
});

test("shutdown while a preferences read waits never decrypts or returns the late private selection", async () => {
  const held = gate(), f = fixture({ beforeSelect: held.wait });
  const reading = f.service.read("admin", token);
  await held.started; f.service.close(); held.release();
  await assert.rejects(reading, rejected("PREFERENCES_UNAVAILABLE"));
  assert.equal(f.state.writes, 0); assert.equal(f.state.commits, 1); assert.equal(f.state.releases, 1);
});
