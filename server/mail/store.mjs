import { randomBytes } from "node:crypto";
import { canonicalEmail } from "../auth/config.mjs";

export class MailStoreError extends Error {
  constructor(code = "MAIL_DATABASE_OPERATION") {
    super("Verification mail persistence could not be completed.");
    this.name = "MailStoreError";
    this.code = code;
  }
}

const fail = (code) => { throw new MailStoreError(code); };
const bytes = (value) => { if (!Buffer.isBuffer(value) || value.length !== 16) fail("MAIL_STORE_INPUT"); return value; };
const instant = (value) => {
  if (!Number.isSafeInteger(value) || value < 0 || value > 253402300799999) fail("MAIL_STORE_INPUT");
  return value;
};
const sqlDate = (value) => new Date(instant(value)).toISOString().replace("T", " ").replace("Z", "000");
const timestamp = (value) => {
  if (value instanceof Date) return instant(value.getTime());
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/.test(value)) fail("MAIL_DATABASE_STATE");
  const result = Date.parse(`${value.replace(" ", "T")}Z`);
  if (!Number.isSafeInteger(result) || result < 0) fail("MAIL_DATABASE_STATE");
  return result;
};

export function createMailStore(pool) {
  let nextPruneAt = null;
  async function connectionRun(operation, transaction = false) {
    let connection;
    let begun = false;
    try {
      connection = await pool.getConnection();
      if (transaction) { await connection.beginTransaction(); begun = true; }
      const result = await operation(connection);
      if (begun) await connection.commit();
      return result;
    } catch (error) {
      if (begun) { try { await connection.rollback(); } catch {} }
      if (error instanceof MailStoreError) throw error;
      fail("MAIL_DATABASE_OPERATION");
    } finally { if (connection) { try { connection.release(); } catch {} } }
  }

  return Object.freeze({
    async assertSchema() {
      return connectionRun(async (connection) => {
        await connection.query(`SELECT id, verification_id, recipient_user_id, payload_encrypted,
          status, attempts, available_at, expires_at, created_at, lease_token, lease_until,
          sent_at, last_error FROM mail_outbox WHERE 1 = 0`);
        const database = (await connection.query("SELECT DATABASE() AS name"))[0].name;
        const columns = await connection.query(`SELECT COLUMN_NAME AS name, DATA_TYPE AS type,
          IS_NULLABLE AS nullable, CHARACTER_MAXIMUM_LENGTH AS length, DATETIME_PRECISION AS precisionValue
          FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'mail_outbox'`, [database]);
        const expected = {
          id: ["varbinary", false, 16], verification_id: ["varbinary", false, 16], recipient_user_id: ["varbinary", false, 16],
          payload_encrypted: ["varchar", false, 1024], status: ["varchar", false, 16], attempts: ["smallint", false],
          available_at: ["datetime", false], expires_at: ["datetime", false], created_at: ["datetime", false],
          lease_token: ["varbinary", true, 16], lease_until: ["datetime", true], sent_at: ["datetime", true], last_error: ["varchar", true, 32],
        };
        for (const [name, [type, nullable, length]] of Object.entries(expected)) {
          const column = columns.find((item) => item.name === name);
          if (!column || column.type !== type || (column.nullable === "YES") !== nullable
            || (length !== undefined && Number(column.length) !== length)
            || (type === "datetime" && Number(column.precisionValue) !== 6)) fail("MAIL_DATABASE_STATE");
        }
        const keys = await connection.query(`SELECT COLUMN_NAME AS name, NON_UNIQUE AS nonUnique
          FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'mail_outbox'
          AND INDEX_NAME = 'PRIMARY' ORDER BY SEQ_IN_INDEX`, [database]);
        if (keys.length !== 1 || keys[0].name !== "id" || Number(keys[0].nonUnique) !== 0) fail("MAIL_DATABASE_STATE");
        return true;
      });
    },

    async claim({ now, leaseMilliseconds = 120000 }) {
      instant(now);
      if (!Number.isSafeInteger(leaseMilliseconds) || leaseMilliseconds < 1000 || leaseMilliseconds > 300000
        || now + leaseMilliseconds > 253402300799999) fail("MAIL_STORE_INPUT");
      // The initial read acquires no locks. Each candidate then has its own short
      // transaction so a batch never retains locks on several unrelated users.
      const candidates = await connectionRun((connection) => connection.query(`SELECT id, recipient_user_id, verification_id
        FROM mail_outbox WHERE (status = 'pending' AND available_at <= ?)
          OR (status = 'sending' AND lease_until <= ?)
        ORDER BY available_at, created_at, id LIMIT 16`, [sqlDate(now), sqlDate(now)]));
      for (const candidate of candidates) {
        bytes(candidate.id); bytes(candidate.recipient_user_id); bytes(candidate.verification_id);
        const claimed = await connectionRun(async (connection) => {
          // Enrollment, revocation and verification use this same lock order.
          const user = (await connection.query(`SELECT role, status, email, email_verified_at
            FROM users WHERE id = ? FOR UPDATE`, [candidate.recipient_user_id]))[0];
          const verification = (await connection.query(`SELECT user_id, created_at, expires_at, consumed_at, revoked_at
            FROM email_verifications WHERE id = ? FOR UPDATE`, [candidate.verification_id]))[0];
          const job = (await connection.query("SELECT * FROM mail_outbox WHERE id = ? FOR UPDATE", [candidate.id]))[0];
          if (!job || !job.recipient_user_id.equals(candidate.recipient_user_id)
            || !job.verification_id.equals(candidate.verification_id)) return null;
          const ready = (job.status === "pending" && timestamp(job.available_at) <= now)
            || (job.status === "sending" && timestamp(job.lease_until) <= now);
          if (!ready) return null;
          let recipientEmail;
          try { if (user) recipientEmail = canonicalEmail(user.email); } catch { recipientEmail = null; }
          const expiresAt = timestamp(job.expires_at);
          if (!user || user.role !== "client" || user.status !== "pending" || user.email_verified_at !== null
            || !recipientEmail || recipientEmail !== user.email || !verification
            || !verification.user_id.equals(candidate.recipient_user_id)
            || verification.consumed_at !== null || verification.revoked_at !== null
            || timestamp(verification.created_at) > now || timestamp(verification.expires_at) <= now
            || expiresAt <= now) {
            await connection.query(`UPDATE mail_outbox SET status = 'cancelled', lease_token = NULL,
              lease_until = NULL, last_error = NULL WHERE id = ?`, [job.id]);
            return null;
          }
          const attempts = Number(job.attempts);
          if (!Number.isInteger(attempts) || attempts < 0 || attempts > 8) fail("MAIL_DATABASE_STATE");
          if (attempts >= 8) {
            await connection.query(`UPDATE mail_outbox SET status = 'failed', lease_token = NULL,
              lease_until = NULL, last_error = 'MAIL_DELIVERY_FAILED' WHERE id = ?`, [job.id]);
            return null;
          }
          const leaseToken = randomBytes(16);
          const leaseUntil = Math.min(now + leaseMilliseconds, expiresAt, timestamp(verification.expires_at));
          await connection.query(`UPDATE mail_outbox SET status = 'sending', attempts = attempts + 1,
            lease_token = ?, lease_until = ?, last_error = NULL WHERE id = ?`, [leaseToken, sqlDate(leaseUntil), job.id]);
          return { id: job.id, verificationId: job.verification_id, userId: job.recipient_user_id,
            recipientEmail, payloadEncrypted: job.payload_encrypted, leaseToken, attempts: attempts + 1, expiresAt };
        }, true);
        if (claimed) return claimed;
      }
      return null;
    },

    async markSent(jobId, leaseToken, { now }) {
      bytes(jobId); bytes(leaseToken); instant(now);
      return connectionRun(async (connection) => {
        const result = await connection.query(`UPDATE mail_outbox SET status = 'sent', sent_at = ?,
          lease_token = NULL, lease_until = NULL, last_error = NULL
          WHERE id = ? AND status = 'sending' AND lease_token = ? AND lease_until > ? AND created_at <= ?`,
        [sqlDate(now), jobId, leaseToken, sqlDate(now), sqlDate(now)]);
        return result.affectedRows === 1;
      });
    },

    async markFailed(jobId, leaseToken, { now, code, permanent = false }) {
      bytes(jobId); bytes(leaseToken); instant(now);
      if (!["MAIL_DELIVERY_FAILED", "PAYLOAD_INVALID"].includes(code) || typeof permanent !== "boolean") fail("MAIL_STORE_INPUT");
      return connectionRun(async (connection) => {
        const job = (await connection.query("SELECT status, attempts, expires_at, created_at, lease_token, lease_until FROM mail_outbox WHERE id = ? FOR UPDATE", [jobId]))[0];
        if (!job || job.status !== "sending" || !job.lease_token?.equals(leaseToken)
          || timestamp(job.lease_until) <= now || timestamp(job.created_at) > now) return false;
        const expiresAt = timestamp(job.expires_at);
        const attempts = Number(job.attempts);
        if (!Number.isInteger(attempts) || attempts < 1 || attempts > 8) fail("MAIL_DATABASE_STATE");
        const availableAt = now + Math.min(3600, 30 * 2 ** (attempts - 1)) * 1000;
        const status = expiresAt <= now ? "cancelled" : (permanent || attempts >= 8 || availableAt >= expiresAt ? "failed" : "pending");
        await connection.query(`UPDATE mail_outbox SET status = ?, available_at = ?,
          lease_token = NULL, lease_until = NULL, last_error = ? WHERE id = ?`,
        [status, sqlDate(Math.min(availableAt, expiresAt)), code, jobId]);
        return true;
      }, true);
    },

    async prune({ now }) {
      instant(now);
      if (now < 7 * 86400000) return 0;
      if (nextPruneAt !== null && now < nextPruneAt) return 0;
      // Reserve the next interval before awaiting a connection so concurrent
      // calls on this instance cannot duplicate the same cleanup pass.
      nextPruneAt = now + 300000;
      const cutoff = sqlDate(now - 7 * 86400000);
      return connectionRun(async (connection) => {
        const expired = await connection.query("DELETE FROM mail_outbox WHERE expires_at < ? LIMIT 1000", [cutoff]);
        // The schema's sent_date CHECK guarantees that a non-NULL sent_at
        // belongs to a sent job. Separate indexed predicates avoid an OR scan.
        const sent = await connection.query("DELETE FROM mail_outbox WHERE sent_at < ? LIMIT 1000", [cutoff]);
        return expired.affectedRows + sent.affectedRows;
      });
    },
  });
}
