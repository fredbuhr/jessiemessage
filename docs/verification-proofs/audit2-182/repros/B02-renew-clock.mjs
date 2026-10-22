import assert from 'node:assert/strict';
import { createAccessStore } from '../../../../server/access/store.mjs';
import { createAccessService } from '../../../../server/access/service.mjs';
import { newToken } from '../../../../server/auth/crypto.mjs';

// Synthetic, in-memory SQL adapter. The actual store/service implementations
// run unchanged; only a 1 ms elapsed target-account lock is injected.
const base = 1792700000000;
const adminId = Buffer.alloc(16, 1), clientId = Buffer.alloc(16, 2), sessionId = Buffer.alloc(16, 3);
const sql = n => new Date(n).toISOString().replace('T', ' ').replace('Z', '000');
let now = base, expiry = base - 1000, commits = 0, updateCount = 0;
const trace = [];
const connection = {
  async beginTransaction() { trace.push('begin'); },
  async commit() { commits++; trace.push('commit'); },
  async rollback() { trace.push('rollback'); }, release() {},
  async query(query, args = []) {
    if (query.startsWith('SELECT user_id FROM sessions')) return [{ user_id: adminId }];
    if (query.startsWith('SELECT id, role, status FROM users')) return [{ id: adminId, role: 'admin', status: 'active' }];
    if (query.startsWith('SELECT version, enabled_at FROM admin_mfa')) return [{ version: 1, enabled_at: sql(base - 100000) }];
    if (query.includes('JOIN auth_session_state')) return [{ id: sessionId, created_at: sql(base - 100000), expires_at: sql(base + 100000), revoked_at: null,
      last_seen_at: sql(base), mfa_verified_at: sql(base - 100000), mfa_version: 1 }];
    if (query.startsWith('SELECT role, status, email_verified_at')) {
      now++; trace.push('target_lock_elapsed_1ms');
      return [{ role: 'client', status: 'active', email_verified_at: sql(base - 100000), age_assured_at: null,
        access_approved_at: sql(base - 50000), access_expires_at: sql(expiry), exact_expiry: sql(expiry), invitation_consumed_at: sql(base - 60000) }];
    }
    if (query.startsWith('UPDATE users SET access_expires_at')) {
      expiry = Date.parse(args[0].replace(' ', 'T') + 'Z'); updateCount++; trace.push('expiry_updated');
      return { affectedRows: 1 };
    }
    throw new Error('Unexpected synthetic SQL: ' + query);
  }
};
const store = createAccessStore({ getConnection: async () => connection }, { clock: () => now });
const service = await createAccessService({ store,
  authStore: { consumeRateLimit: async () => ({ allowed: true }) },
  authService: { session: async () => ({ user: { id: adminId.toString('hex'), role: 'admin' } }) },
  totpKey: Buffer.alloc(32, 7), mailKey: Buffer.alloc(32, 8), origin: 'https://example.invalid', clock: () => now });
let error;
try { await service.renewClient(newToken(), clientId.toString('hex'), { expectedExpiresAt: base - 1000, accessDays: 1 }); }
catch (caught) { error = caught; }
assert.equal(error?.code, 'AUTH_UNAVAILABLE');
assert.equal(expiry, base + 1 + 86400000);
assert.equal(commits, 1); assert.equal(updateCount, 1); assert.ok(!trace.includes('rollback'));
console.log(JSON.stringify({ scenario: 'expired renewal crosses 1ms at target lock', clockBefore: base, clockAfter: now,
  serviceExpectedExpiry: base + 86400000, storedExpiry: expiry, commits, updateCount,
  outwardError: error.code, mappedHttpStatus: 503, trace, syntheticOnly: true }));
