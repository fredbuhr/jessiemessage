import { AuthStoreError } from "./store.mjs";
import { canonicalEmail } from "./config.mjs";

const fail = (code = "AUTH_RECOVERY_INPUT") => {
  throw new AuthStoreError(code, "Controlled administrator recovery could not be completed.");
};
const checkId = (id) => { if (!Buffer.isBuffer(id) || id.length !== 16) fail(); };
const checkEmail = (email) => { try { if (canonicalEmail(email) !== email) fail(); } catch { fail(); } };
const checkInstant = (now) => { if (!Number.isSafeInteger(now) || now < 0 || now > 253402300799999) fail(); };
const sqlDate = (now) => new Date(now).toISOString().replace("T", " ").replace("Z", "000");

// This store has no HTTP route. It is used only by the explicit operator CLI.
// Lock order matches administrator login: users, then admin_mfa, then factors.
export function createAdminRecoveryStore(pool) {
  async function withConnection(operation, transaction = false) {
    let connection;
    let begun = false;
    let commitAttempted = false;
    try {
      connection = await pool.getConnection();
      if (transaction) { await connection.beginTransaction(); begun = true; }
      const result = await operation(connection);
      if (begun) { commitAttempted = true; await connection.commit(); }
      return result;
    } catch (error) {
      if (begun) { try { await connection.rollback(); } catch {} }
      if (commitAttempted) {
        const uncertain = new AuthStoreError("AUTH_RECOVERY_UNCERTAIN", "Recovery outcome requires private database inspection; preserve the private setup file.");
        uncertain.preserveSetupFile = true;
        throw uncertain;
      }
      if (error instanceof AuthStoreError) throw error;
      fail("AUTH_RECOVERY_OPERATION");
    } finally {
      // A release failure cannot undo a commit or discard the only new factors.
      if (connection) { try { connection.release(); } catch {} }
    }
  }

  return Object.freeze({
    async getAdminForRecovery(id, email) {
      checkId(id); checkEmail(email);
      return withConnection(async (connection) => {
        const row = (await connection.query(`SELECT u.id, u.email, u.pseudonym, m.version
          FROM users u JOIN admin_mfa m ON m.user_id = u.id
          WHERE u.id = ? AND u.email = ? AND u.role = 'admin' AND u.status = 'active'
            AND m.role = 'admin' LIMIT 1`, [id, email]))[0];
        if (!row) return null;
        const version = Number(row.version);
        if (!Number.isInteger(version) || version < 1 || version >= 4294967295) fail("AUTH_RECOVERY_STATE");
        return { id: row.id, email: row.email, pseudonym: row.pseudonym, version };
      });
    },

    async resetAdmin({ id, email, passwordHash, secretEncrypted, recoveryDigests, now, expectedVersion }) {
      checkId(id); checkEmail(email); checkInstant(now);
      if (!Number.isInteger(expectedVersion) || expectedVersion < 1 || expectedVersion >= 4294967295
        || typeof passwordHash !== "string" || !passwordHash.length || passwordHash.length > 255
        || typeof secretEncrypted !== "string" || !secretEncrypted.length || secretEncrypted.length > 512
        || !Array.isArray(recoveryDigests) || recoveryDigests.length !== 8
        || recoveryDigests.some((digest) => !Buffer.isBuffer(digest) || digest.length !== 32)) fail();
      return withConnection(async (connection) => {
        const user = (await connection.query("SELECT role, status, email FROM users WHERE id = ? FOR UPDATE", [id]))[0];
        if (!user || user.role !== "admin" || user.status !== "active" || user.email !== email) fail("AUTH_RECOVERY_TARGET");
        const mfa = (await connection.query("SELECT role, version FROM admin_mfa WHERE user_id = ? FOR UPDATE", [id]))[0];
        if (!mfa || mfa.role !== "admin") fail("AUTH_RECOVERY_TARGET");
        if (Number(mfa.version) !== expectedVersion) fail("AUTH_RECOVERY_STALE");
        const nextVersion = expectedVersion + 1;
        const timestamp = sqlDate(now);
        await connection.query("UPDATE users SET password_hash = ?, updated_at = GREATEST(updated_at, ?) WHERE id = ?", [passwordHash, timestamp, id]);
        await connection.query("UPDATE admin_mfa SET secret_encrypted = ?, version = ?, last_totp_step = -1, enabled_at = NULL WHERE user_id = ?", [secretEncrypted, nextVersion, id]);
        await connection.query("DELETE FROM admin_recovery_codes WHERE user_id = ?", [id]);
        for (const digest of recoveryDigests) await connection.query("INSERT INTO admin_recovery_codes (user_id, code_hash, mfa_version, created_at) VALUES (?, ?, ?, ?)", [id, digest, nextVersion, timestamp]);
        // Even anomalous future-dated sessions are revoked; honour their CHECK.
        await connection.query("UPDATE sessions SET revoked_at = GREATEST(created_at, ?) WHERE user_id = ? AND revoked_at IS NULL", [timestamp, id]);
        return { id, version: nextVersion };
      }, true);
    },
  });
}
