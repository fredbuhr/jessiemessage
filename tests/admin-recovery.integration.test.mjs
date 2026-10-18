import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { databaseOptions, connectDatabase } from "../server/db/connection.mjs";
import { createdMigrationTables, applyMigrations, loadMigrations } from "../server/db/migrations.mjs";
import { createRuntimePool } from "../server/db/runtime.mjs";
import { createAuthStore } from "../server/auth/store.mjs";
import { createAdminRecoveryStore } from "../server/auth/recovery-store.mjs";
import { createAuthService } from "../server/auth/service.mjs";
import { createRecoveryCodes, hashPassword, makeTotpSecret, openTotpSecret, recoveryCodeDigest, sealTotpSecret, totpCode, verifyTotp } from "../server/auth/crypto.mjs";

const enabled = process.env.JESSIEMESSAGE_DB_TEST === "1";
const codeIs = (code) => (error) => error.code === code;

test("real MariaDB controlled administrator recovery (synthetic disposable database only)", {
  skip: enabled ? false : "Set JESSIEMESSAGE_DB_TEST=1 with an explicit loopback test database.", timeout: 120000,
}, async (t) => {
  const options = databaseOptions();
  assert.ok(["127.0.0.1", "::1", "localhost"].includes(options.host), "integration tests require loopback");
  assert.match(options.database, /^jessiemessage_test(?:_[a-z0-9]+)*$/, "integration tests require a dedicated disposable schema");
  assert.ok(process.env.JESSIEMESSAGE_RUNTIME_DB_USER && process.env.JESSIEMESSAGE_RUNTIME_DB_PASSWORD, "separately provisioned runtime DML credentials are required");
  const migrations = await loadMigrations();
  // Only tables explicitly owned by the checked-in CREATE TABLE migrations are
  // eligible for cleanup. Reverse order respects their parent dependencies.
  const ownedTables = createdMigrationTables(migrations).reverse();
  const allowedTables = [...ownedTables, "migration_probe", "schema_migrations"];
  const connection = await connectDatabase();
  let pool;
  async function reset() {
    const tables = await connection.query("SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?", [options.database]);
    assert.ok(tables.every((table) => allowedTables.includes(table.name)), "refuse cleanup when unrelated tables are present");
    for (const table of allowedTables) await connection.query(`DROP TABLE IF EXISTS ${table}`);
  }
  try {
    await reset();
    await applyMigrations(connection, { database: options.database, migrations });
    pool = await createRuntimePool(process.env);
    const authStore = createAuthStore(pool);
    assert.equal(await authStore.assertSchema(), true);
    const store = createAdminRecoveryStore(pool);
    let now = Date.UTC(2026, 9, 14, 15);
    const adminId = randomBytes(16);
    const key = randomBytes(32);
    const email = "recovery-operator@example.invalid";
    const originalPassword = "Synthetic original administrator password 2026!";
    const originalHash = await hashPassword(originalPassword);
    const originalSecret = makeTotpSecret();
    const originalCodes = createRecoveryCodes();
    await authStore.initializeAdmin({ id: adminId, email, pseudonym: "Synthetic recovery administrator", passwordHash: originalHash,
      secretEncrypted: sealTotpSecret(originalSecret, key, adminId), recoveryDigests: originalCodes.map(recoveryCodeDigest), now });
    const service = await createAuthService({ store: authStore, totpKey: key, clock: () => now });
    const login = (password, factor) => service.login({ email, password, factor, peerAddress: "127.0.0.1" });
    const oldSession = await login(originalPassword, totpCode(originalSecret, { now }));
    const oldSecondSession = await login(originalPassword, originalCodes[0]);
    const lookup = () => store.getAdminForRecovery(adminId, email);
    const mfaRow = async () => (await connection.query("SELECT secret_encrypted, version, last_totp_step, enabled_at FROM admin_mfa WHERE user_id = ?", [adminId]))[0];

    await t.test("recovery identifies only the exact active administrator without changing its identity", async () => {
      assert.deepEqual(await lookup(), { id: adminId, email, pseudonym: "Synthetic recovery administrator", version: 1 });
      assert.equal(await store.getAdminForRecovery(randomBytes(16), email), null);
      assert.equal(await store.getAdminForRecovery(adminId, "different@example.invalid"), null);
      const clientId = randomBytes(16);
      await connection.query("INSERT INTO users (id, role, pseudonym, email) VALUES (?, 'client', 'Synthetic pending client', 'recovery-client@example.invalid')", [clientId]);
      assert.equal(await store.getAdminForRecovery(clientId, "recovery-client@example.invalid"), null);
      await connection.query("UPDATE users SET status = 'suspended' WHERE id = ?", [adminId]);
      assert.equal(await lookup(), null);
      await connection.query("UPDATE users SET status = 'active' WHERE id = ?", [adminId]);
    });

    const newPassword = "Synthetic replacement administrator password 2026!";
    const newHash = await hashPassword(newPassword);
    function candidate() {
      const secret = makeTotpSecret();
      const codes = createRecoveryCodes();
      return { secret, codes, record: { id: adminId, email, passwordHash: newHash, secretEncrypted: sealTotpSecret(secret, key, adminId),
        recoveryDigests: codes.map(recoveryCodeDigest), now, expectedVersion: 1 } };
    }

    await t.test("failed factor replacement rolls back password, MFA, consumed codes and existing sessions together", async () => {
      const before = await mfaRow();
      const replacement = candidate().record;
      await assert.rejects(store.resetAdmin({ ...replacement, recoveryDigests: Array(8).fill(replacement.recoveryDigests[0]) }), codeIs("AUTH_RECOVERY_OPERATION"));
      assert.deepEqual(await mfaRow(), before);
      assert.equal((await authStore.getLoginRecord(email)).passwordHash, originalHash);
      assert.equal((await connection.query("SELECT COUNT(*) AS count FROM admin_recovery_codes WHERE user_id = ?", [adminId]))[0].count, 8n);
      assert.equal((await connection.query("SELECT COUNT(*) AS count FROM admin_recovery_codes WHERE user_id = ? AND consumed_at IS NOT NULL", [adminId]))[0].count, 1n);
      assert.ok(await service.session(oldSession.token));
      assert.ok(await service.session(oldSecondSession.token));
    });

    let selected;
    await t.test("simultaneous resets permit one expected version, revoke all sessions and leave a fresh unconfirmed enrollment", async () => {
      now += 60000;
      const futureSession = randomBytes(16);
      await connection.query("INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, '2026-10-15 15:00:00', '2026-10-15 23:00:00')", [futureSession, adminId, randomBytes(32)]);
      const attempts = [candidate(), candidate()];
      const results = await Promise.allSettled(attempts.map((attempt) => store.resetAdmin(attempt.record)));
      assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
      assert.equal(results.find((result) => result.status === "rejected").reason.code, "AUTH_RECOVERY_STALE");
      selected = attempts[results.findIndex((result) => result.status === "fulfilled")];
      const mfa = await mfaRow();
      assert.equal(Number(mfa.version), 2);
      assert.equal(Number(mfa.last_totp_step), -1);
      assert.equal(mfa.enabled_at, null);
      assert.equal(openTotpSecret(mfa.secret_encrypted, key, adminId), selected.secret);
      assert.equal((await authStore.getLoginRecord(email)).passwordHash, newHash);
      assert.equal((await connection.query("SELECT COUNT(*) AS count FROM admin_recovery_codes WHERE user_id = ? AND mfa_version = 2 AND consumed_at IS NULL", [adminId]))[0].count, 8n);
      assert.equal((await connection.query("SELECT COUNT(*) AS count FROM sessions WHERE user_id = ? AND revoked_at IS NULL", [adminId]))[0].count, 0n);
      assert.equal(await service.session(oldSession.token), null);
      assert.equal(await service.session(oldSecondSession.token), null);
      assert.equal((await connection.query("SELECT id, role, status, email, pseudonym FROM users WHERE id = ?", [adminId]))[0].pseudonym, "Synthetic recovery administrator");
    });

    await t.test("stale recovery or a suspended target cannot mutate the successfully recovered administrator", async () => {
      const before = await mfaRow();
      await assert.rejects(store.resetAdmin(selected.record), codeIs("AUTH_RECOVERY_STALE"));
      assert.deepEqual(await mfaRow(), before);
      await connection.query("UPDATE users SET status = 'suspended' WHERE id = ?", [adminId]);
      await assert.rejects(store.resetAdmin({ ...selected.record, expectedVersion: 2 }), codeIs("AUTH_RECOVERY_TARGET"));
      await connection.query("UPDATE users SET status = 'active' WHERE id = ?", [adminId]);
      assert.deepEqual(await mfaRow(), before);
    });

    let recoveredSession;
    await t.test("new password and first fresh TOTP are mandatory; old factors and both OTP/recovery replays are refused", async () => {
      // Leave the original rate-limit window, preserving exactly the real limits.
      now += 15 * 60000;
      let oldOtp = totpCode(originalSecret, { now });
      // Six-digit codes from unrelated secrets can coincide. Keep the actual
      // old-secret code and choose an instant without that random coincidence.
      while (verifyTotp(selected.secret, oldOtp, { now }) !== null) {
        now += 30000;
        oldOtp = totpCode(originalSecret, { now });
      }
      const newOtp = totpCode(selected.secret, { now });
      await assert.rejects(login(originalPassword, newOtp), codeIs("AUTH_INVALID"));
      await assert.rejects(login(newPassword, oldOtp), codeIs("AUTH_INVALID"));
      await assert.rejects(login(newPassword, selected.codes[0]), codeIs("AUTH_INVALID"));
      recoveredSession = await login(newPassword, newOtp);
      assert.equal(recoveredSession.user.id, adminId.toString("hex"));
      await assert.rejects(login(newPassword, newOtp), codeIs("AUTH_INVALID"));
      await assert.rejects(login(newPassword, originalCodes[1]), codeIs("AUTH_INVALID"));
      const recoverySession = await login(newPassword, selected.codes[0]);
      assert.equal(recoverySession.user.role, "admin");
      await assert.rejects(login(newPassword, selected.codes[0]), codeIs("AUTH_INVALID"));
      assert.equal(Number((await mfaRow()).version), 2);
      assert.ok((await mfaRow()).enabled_at);
    });

    await t.test("a prior MFA version remains denied even if an old session revocation timestamp is removed manually", async () => {
      await connection.query("UPDATE sessions SET revoked_at = NULL WHERE user_id = ? AND created_at < '2026-10-14 15:01:00'", [adminId]);
      assert.equal(await service.session(oldSession.token), null);
      assert.equal(await service.session(oldSecondSession.token), null);
      assert.ok(await service.session(recoveredSession.token));
    });

    await t.test("lost COMMIT acknowledgement preserves the setup obligation and does not allow stale retry", async () => {
      const finalSecret = makeTotpSecret();
      const record = { ...selected.record, secretEncrypted: sealTotpSecret(finalSecret, key, adminId), recoveryDigests: createRecoveryCodes().map(recoveryCodeDigest), expectedVersion: 2, now };
      const uncertain = createAdminRecoveryStore({ async getConnection() {
        const borrowed = await pool.getConnection();
        return { ...borrowed, async commit() { await borrowed.commit(); throw new Error("synthetic lost recovery commit acknowledgement"); } };
      } });
      await assert.rejects(uncertain.resetAdmin(record), (error) => error.code === "AUTH_RECOVERY_UNCERTAIN" && error.preserveSetupFile === true && error.cause === undefined);
      assert.equal(Number((await mfaRow()).version), 3);
      assert.equal(openTotpSecret((await mfaRow()).secret_encrypted, key, adminId), finalSecret);
      assert.equal(await service.session(recoveredSession.token), null);
      await assert.rejects(store.resetAdmin(record), codeIs("AUTH_RECOVERY_STALE"));
      assert.equal((await connection.query("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'"))[0].count, 1n);
    });
  } finally {
    try { if (pool) await pool.end(); }
    finally { try { await reset(); } finally { await connection.end(); } }
  }
});
