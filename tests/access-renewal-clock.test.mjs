import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccessStore } from '../server/access/store.mjs';
import { createAccessService } from '../server/access/service.mjs';
import { newToken } from '../server/auth/crypto.mjs';

// Synthetic, in-memory SQL adapter. The actual store/service implementations
// run with an injected clock advance while the target-account lock is pending.
async function fixture({ initialExpiry, wait = 1 } = {}) {
  const base = 1792700000000;
  const adminId = Buffer.alloc(16, 1), clientId = Buffer.alloc(16, 2), sessionId = Buffer.alloc(16, 3);
  const sql = n => new Date(n).toISOString().replace('T', ' ').replace('Z', '000');
  let now = base, expiry = initialExpiry ?? base - 1000, commits = 0, updateCount = 0;
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
        now += wait; trace.push('target_lock_elapsed');
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
  return { service, base, clientId: clientId.toString('hex'), token: newToken(),
    state: () => ({ now, expiry, commits, updateCount, trace }) };
}

for (const remaining of [-1000, 100000]) for (const wait of [1, 5000]) {
  test(`renewal returns the committed expiry after ${wait}ms under lock, initial expiry ${remaining}ms`, async () => {
    const f = await fixture({ initialExpiry: 1792700000000 + remaining, wait });
    const expectedExpiresAt = f.state().expiry;
    const result = await f.service.renewClient(f.token, f.clientId, { expectedExpiresAt, accessDays: 1 });
    const expected = Math.max(f.base + wait, expectedExpiresAt) + 86400000;
    assert.deepEqual(result, { id: f.clientId, accessExpiresAt: expected });
    assert.equal(f.state().expiry, expected);
    assert.equal(f.state().commits, 1); assert.equal(f.state().updateCount, 1);
    assert.equal(f.state().trace.includes('rollback'), false);
    // Repeating the original uncertain command cannot prolong twice.
    await assert.rejects(f.service.renewClient(f.token, f.clientId, { expectedExpiresAt, accessDays: 1 }), { code: 'ACCESS_CONFLICT' });
    assert.equal(f.state().updateCount, 1);
    // An explicit new renewal using the freshly read expiry remains supported.
    const next = await f.service.renewClient(f.token, f.clientId, { expectedExpiresAt: expected, accessDays: 1 });
    assert.equal(next.accessExpiresAt, expected + 86400000);
    assert.equal(f.state().updateCount, 2);
  });
}

test('renewal still refuses an administrator expiring while the client lock is pending', async () => {
  const f = await fixture({ wait: 100001 });
  await assert.rejects(f.service.renewClient(f.token, f.clientId, { expectedExpiresAt: f.state().expiry, accessDays: 1 }), { code: 'ACCESS_FORBIDDEN' });
  assert.equal(f.state().updateCount, 0); assert.equal(f.state().commits, 0);
  assert.equal(f.state().trace.includes('rollback'), true);
});
