import { createHash, randomBytes } from "node:crypto";
import { canonicalEmail } from "../auth/config.mjs";
import { assertResetSchema, ResetStoreError } from "./store.mjs";

const fail = (code) => { throw new ResetStoreError(code); };
const bytes = (value) => { if (!Buffer.isBuffer(value) || value.length !== 16) fail("RESET_STORE_INPUT"); return value; };
const instant = (value) => { if (!Number.isSafeInteger(value) || value < 0 || value > 253402300799999) fail("RESET_STORE_INPUT"); return value; };
const sqlDate = (value) => new Date(instant(value)).toISOString().replace("T", " ").replace("Z", "000");
const timestamp = (value) => {
  if (value instanceof Date && Number.isSafeInteger(value.getTime()) && value.getTime() >= 0) return value.getTime();
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/.test(value)) fail("RESET_DATABASE_STATE");
  const result = Date.parse(`${value.replace(" ", "T")}Z`); if (!Number.isSafeInteger(result) || result < 0) fail("RESET_DATABASE_STATE"); return result;
};
const version = (value) => { const result = Number(value); if (!Number.isSafeInteger(result) || result < 1 || result > 4294967295) fail("RESET_DATABASE_STATE"); return result; };

export function createResetMailStore(pool) {
  if (!pool || typeof pool.getConnection !== "function") fail("RESET_STORE_INPUT");
  let nextPruneAt = null;
  async function run(operation, transaction = false) {
    let connection, begun = false;
    try {
      connection = await pool.getConnection();
      if (transaction) { await connection.beginTransaction(); begun = true; }
      const result = await operation(connection);
      if (begun) await connection.commit();
      return result;
    } catch (error) {
      if (begun) { try { await connection.rollback(); } catch {} }
      if (error instanceof ResetStoreError) throw error;
      fail("RESET_DATABASE_OPERATION");
    } finally { if (connection) { try { connection.release(); } catch {} } }
  }
  return Object.freeze({
    assertSchema: (options) => assertResetSchema(pool, options),
    async claim({ now, leaseMilliseconds = 120000 }) {
      instant(now);
      if (!Number.isSafeInteger(leaseMilliseconds) || leaseMilliseconds < 1000 || leaseMilliseconds > 300000
        || now + leaseMilliseconds > 253402300799999) fail("RESET_STORE_INPUT");
      const candidates = await run((connection) => connection.query(`SELECT id, recipient_user_id, reset_id
        FROM password_reset_outbox WHERE (status = 'pending' AND available_at <= ?) OR (status = 'sending' AND lease_until <= ?)
        ORDER BY available_at, created_at, id LIMIT 16`, [sqlDate(now), sqlDate(now)]));
      for (const candidate of candidates) {
        bytes(candidate.id); bytes(candidate.recipient_user_id); bytes(candidate.reset_id);
        const claimed = await run(async (connection) => {
          // Each candidate gets a short transaction. The ordering matches reset
          // issuance/consumption and the existing client-login user lock.
          const user = (await connection.query("SELECT id, role, status, email, email_verified_at, password_hash FROM users WHERE id = ? FOR UPDATE", [candidate.recipient_user_id]))[0];
          const auth = (await connection.query("SELECT credential_version FROM client_auth_state WHERE user_id = ? FOR UPDATE", [candidate.recipient_user_id]))[0];
          const reset = (await connection.query("SELECT * FROM client_password_resets WHERE id = ? FOR UPDATE", [candidate.reset_id]))[0];
          const job = (await connection.query("SELECT * FROM password_reset_outbox WHERE id = ? FOR UPDATE", [candidate.id]))[0];
          if (!job || !job.recipient_user_id.equals(candidate.recipient_user_id) || !job.reset_id.equals(candidate.reset_id)) return null;
          const ready = (job.status === "pending" && timestamp(job.available_at) <= now)
            || (job.status === "sending" && timestamp(job.lease_until) <= now);
          if (!ready) return null;
          let recipientEmail = null;
          try { if (user) recipientEmail = canonicalEmail(user.email); } catch {}
          const expiresAt = timestamp(job.expires_at);
          if (!user || user.role !== "client" || !["active", "pending"].includes(user.status) || !auth
            || user.email_verified_at === null || timestamp(user.email_verified_at) > now
            || typeof user.password_hash !== "string" || !user.password_hash.length || !recipientEmail || recipientEmail !== user.email
            || version(auth.credential_version) >= 4294967295 || !reset || !reset.user_id.equals(candidate.recipient_user_id)
            || version(reset.credential_version) !== version(auth.credential_version) || !Buffer.isBuffer(reset.email_hash)
            || !reset.email_hash.equals(createHash("sha256").update(recipientEmail, "utf8").digest())
            || reset.consumed_at !== null || reset.revoked_at !== null || timestamp(reset.created_at) > now
            || timestamp(reset.expires_at) <= now || timestamp(reset.expires_at) > timestamp(reset.created_at) + 1800000
            || timestamp(job.created_at) > now || expiresAt <= now) {
            await connection.query(`UPDATE password_reset_outbox SET status = 'cancelled', lease_token = NULL,
              lease_until = NULL, last_error = NULL WHERE id = ?`, [job.id]);
            return null;
          }
          const attempts = Number(job.attempts);
          if (!Number.isInteger(attempts) || attempts < 0 || attempts > 8) fail("RESET_DATABASE_STATE");
          if (attempts >= 8) {
            await connection.query(`UPDATE password_reset_outbox SET status = 'failed', lease_token = NULL,
              lease_until = NULL, last_error = 'MAIL_DELIVERY_FAILED' WHERE id = ?`, [job.id]);
            return null;
          }
          const leaseToken = randomBytes(16), leaseUntil = Math.min(now + leaseMilliseconds, expiresAt, timestamp(reset.expires_at));
          await connection.query(`UPDATE password_reset_outbox SET status = 'sending', attempts = attempts + 1,
            lease_token = ?, lease_until = ?, last_error = NULL WHERE id = ?`, [leaseToken, sqlDate(leaseUntil), job.id]);
          return { id: job.id, resetId: job.reset_id, userId: job.recipient_user_id, recipientEmail,
            payloadEncrypted: job.payload_encrypted, leaseToken, attempts: attempts + 1, expiresAt };
        }, true);
        if (claimed) return claimed;
      }
      return null;
    },
    async releaseClaim(jobId, leaseToken, { now }) {
      bytes(jobId); bytes(leaseToken); instant(now);
      // Trusted worker use only: SMTP must not have started. This single CAS
      // takes only the outbox row, never later acquires an account/proof lock,
      // and cannot modify a replaced, expired or terminal reservation.
      return run(async (connection) => {
        const result = await connection.query(`UPDATE password_reset_outbox SET status = 'pending', attempts = attempts - 1,
          available_at = ?, lease_token = NULL, lease_until = NULL, last_error = NULL
          WHERE id = ? AND status = 'sending' AND lease_token = ? AND lease_until > ?
            AND created_at <= ? AND expires_at > ? AND attempts BETWEEN 1 AND 8`,
        [sqlDate(now), jobId, leaseToken, sqlDate(now), sqlDate(now), sqlDate(now)]);
        return Number(result.affectedRows) === 1;
      });
    },

    async markSent(jobId, leaseToken, { now }) {
      bytes(jobId); bytes(leaseToken); instant(now);
      return run(async (connection) => {
        const result = await connection.query(`UPDATE password_reset_outbox SET status = 'sent', sent_at = ?,
          lease_token = NULL, lease_until = NULL, last_error = NULL
          WHERE id = ? AND status = 'sending' AND lease_token = ? AND lease_until > ? AND created_at <= ? AND expires_at > ?`,
        [sqlDate(now), jobId, leaseToken, sqlDate(now), sqlDate(now), sqlDate(now)]);
        return Number(result.affectedRows) === 1;
      });
    },
    async markFailed(jobId, leaseToken, { now, code, permanent = false }) {
      bytes(jobId); bytes(leaseToken); instant(now);
      if (!["MAIL_DELIVERY_FAILED", "PAYLOAD_INVALID"].includes(code) || typeof permanent !== "boolean") fail("RESET_STORE_INPUT");
      return run(async (connection) => {
        const job = (await connection.query("SELECT status, attempts, expires_at, created_at, lease_token, lease_until FROM password_reset_outbox WHERE id = ? FOR UPDATE", [jobId]))[0];
        if (!job || job.status !== "sending" || !job.lease_token?.equals(leaseToken)
          || timestamp(job.lease_until) <= now || timestamp(job.created_at) > now) return false;
        const expiresAt = timestamp(job.expires_at), attempts = Number(job.attempts);
        if (!Number.isInteger(attempts) || attempts < 1 || attempts > 8) fail("RESET_DATABASE_STATE");
        const availableAt = Math.min(now + Math.min(3600, 30 * 2 ** (attempts - 1)) * 1000, expiresAt);
        const status = expiresAt <= now ? "cancelled" : (permanent || attempts >= 8 || availableAt >= expiresAt ? "failed" : "pending");
        await connection.query(`UPDATE password_reset_outbox SET status = ?, available_at = ?, lease_token = NULL,
          lease_until = NULL, last_error = ? WHERE id = ?`, [status, sqlDate(availableAt), code, jobId]);
        return true;
      }, true);
    },
    async prune({ now }) {
      instant(now);
      if (now < 7 * 86400000 || (nextPruneAt !== null && now < nextPruneAt)) return 0;
      nextPruneAt = now + 300000;
      return run(async (connection) => {
        const cutoff = sqlDate(now - 7 * 86400000);
        const expired = await connection.query("DELETE FROM password_reset_outbox WHERE expires_at < ? LIMIT 1000", [cutoff]);
        const sent = await connection.query("DELETE FROM password_reset_outbox WHERE sent_at < ? LIMIT 1000", [cutoff]);
        return Number(expired.affectedRows) + Number(sent.affectedRows);
      });
    },
  });
}
