import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createMailStore } from '../server/mail/store.mjs';
import { createResetMailStore } from '../server/reset/mail-store.mjs';
import { runMailBatch } from '../server/mail/worker.mjs';
import { sealVerificationPayload } from '../server/mail/crypto.mjs';
import { sealResetPayload } from '../server/reset/mail-crypto.mjs';

// No database, sockets, DNS, real email, filesystem mutation or account access.
// Real mail stores and worker execute against a SQL-shaped synthetic fixture.
// Advancing the injected worker clock represents waiting on the user row lock.
const startedAt = Date.UTC(2026, 9, 22, 12);
const expiresAt = startedAt + 1000;
const date = value => new Date(value).toISOString().replace('T', ' ').replace('Z', '000');
const parsed = value => Date.parse(value.replace(' ', 'T') + 'Z');
const bytes = number => Buffer.alloc(16, number);
const email = 'synthetic-expired-link@example.invalid';
const token = Buffer.alloc(32, 10).toString('base64url');
const key = Buffer.alloc(32, 11);

for (const purpose of ['verification', 'password-reset']) for (const [lockWaitMilliseconds, commitWaitMilliseconds, proofLifetime] of [
  [0, 0, 1000], [999, 0, 1000], [1000, 0, 1000], [2000, 0, 1000], [0, 1000, 1000], [499, 0, 500], [500, 0, 500],
]) {
  test(`${purpose}: lock ${lockWaitMilliseconds}ms, commit ${commitWaitMilliseconds}ms, proof ${proofLifetime}ms never starts an expired send`, async () => {
    let current = startedAt;
    const proofName = purpose === 'verification' ? 'verification_id' : 'reset_id';
    const table = purpose === 'verification' ? 'mail_outbox' : 'password_reset_outbox';
    const job = { id: bytes(1), recipient_user_id: bytes(2), [proofName]: bytes(3),
      status: 'pending', attempts: 0, created_at: date(startedAt - 1000), available_at: date(startedAt),
      expires_at: date(expiresAt), lease_token: null, lease_until: null };
    const seal = purpose === 'verification' ? sealVerificationPayload : sealResetPayload;
    job.payload_encrypted = seal({ email, token }, key, job.id);
    const proof = { id: bytes(3), user_id: bytes(2), credential_version: 1,
      email_hash: createHash('sha256').update(email).digest(),
      created_at: date(startedAt - 1000), expires_at: date(startedAt + proofLifetime), consumed_at: null, revoked_at: null };
    const user = { id: bytes(2), role: 'client', status: purpose === 'verification' ? 'pending' : 'active', email,
      email_verified_at: purpose === 'verification' ? null : date(startedAt - 1000), password_hash: 'synthetic-password-hash' };
    const events = [];
    const connection = {
      async beginTransaction() {}, async commit() { current += commitWaitMilliseconds; }, async rollback() {}, release() {},
      async query(sql, parameters) {
        if (sql.startsWith(`SELECT id, recipient_user_id, ${proofName}`)) return [job];
        if (sql.includes('FROM users WHERE id = ? FOR UPDATE')) {
          await Promise.resolve(); // actual async boundary before releasing the simulated lock
          current = startedAt + lockWaitMilliseconds;
          events.push({ type: 'user_lock_acquired', now: current });
          return [user];
        }
        if (sql.includes('FROM client_auth_state')) return [{ credential_version: 1 }];
        if (sql.includes('FROM email_verifications') || sql.includes('FROM client_password_resets')) return [proof];
        if (sql.startsWith(`SELECT * FROM ${table} WHERE id = ? FOR UPDATE`) || sql.startsWith('SELECT status, attempts,')) return [job];
        if (sql.startsWith(`UPDATE ${table} SET status = 'sending'`)) {
          [job.lease_token, job.lease_until] = parameters;
          job.status = 'sending'; job.attempts++;
          events.push({ type: 'lease_written', leaseUntil: parsed(job.lease_until), now: current });
          return { affectedRows: 1 };
        }
        if (sql.startsWith(`UPDATE ${table} SET status = 'sent'`)) {
          const acknowledgementAt = parsed(parameters[0]);
          const valid = job.status === 'sending' && job.lease_token.equals(parameters[2])
            && parsed(job.lease_until) > acknowledgementAt;
          if (valid) job.status = 'sent';
          return { affectedRows: Number(valid) };
        }
        if (sql.startsWith(`DELETE FROM ${table} WHERE`)) return { affectedRows: 0 };
        if (sql.startsWith(`UPDATE ${table} SET status = 'cancelled'`)) {
          job.status = 'cancelled'; job.lease_token = null; job.lease_until = null;
          return { affectedRows: 1 };
        }
        throw new Error('Unexpected synthetic SQL');
      },
    };
    const pool = { async getConnection() { return connection; } };
    const store = purpose === 'verification' ? createMailStore(pool, { clock: () => current }) : createResetMailStore(pool, { clock: () => current });
    const sent = [];
    const capture = async input => {
      assert.equal(input.email, email); assert.equal(input.token, token);
      sent.push({ sentAt: current, expiredByMilliseconds: current - expiresAt });
      return true;
    };
    const counts = await runMailBatch({ store, transport: { sendVerification: capture, sendPasswordReset: capture },
      key, clock: () => current, batchSize: 1, purpose });
    if (lockWaitMilliseconds + commitWaitMilliseconds < proofLifetime) {
      assert.equal(sent.length, 1);
      assert.ok(sent[0].sentAt < startedAt + proofLifetime);
      assert.deepEqual(counts, { sent: 1, failed: 0 });
      assert.equal(job.status, 'sent');
      const lease = events.find(event => event.type === 'lease_written');
      assert.ok(lease.leaseUntil > lease.now);
    } else {
      assert.equal(sent.length, 0);
      assert.deepEqual(counts, { sent: 0, failed: commitWaitMilliseconds ? 1 : 0 });
      if (commitWaitMilliseconds) {
        // The lease was valid under lock, but expired while commit was awaited.
        assert.equal(job.status, 'sending');
        assert.equal(events.some(event => event.type === 'lease_written'), true);
      } else {
        assert.equal(job.status, 'cancelled');
        assert.equal(events.some(event => event.type === 'lease_written'), false);
      }
    }
  });
}
