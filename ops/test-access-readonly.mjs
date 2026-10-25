import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const script = readFileSync(new URL('./inspect-access1112.py', import.meta.url), 'utf8');
const source = script.split("NODE_MODULE = r'''\n")[1]?.split("\n'''\n")[0];
assert.ok(source);
const { inspectAccount, sql } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const now = Date.UTC(2026, 9, 25, 20);
const date = value => new Date(value).toISOString().replace('T', ' ').replace('Z', '000');
const email = 'synthetic-private@example.invalid';
const user = () => ({ id: randomBytes(16), role: 'client', status: 'active', password_present: 1,
  email_verified_at: date(now - 60000), access_approved_at: date(now - 10000), access_expires_at: null, credential_version: 1 });
const invitation = () => ({ total: 1, first_consumed: date(now - 120000), last_consumed: date(now - 120000) });
function fixture({ account = user(), inv = invitation(), fail } = {}) {
  const queries = [];
  return { queries, async query(query, params) {
    queries.push({ query, params });
    assert.ok(/^(SELECT|SET TRANSACTION READ ONLY|START TRANSACTION WITH CONSISTENT SNAPSHOT|ROLLBACK)\b/.test(query));
    assert.doesNotMatch(query, /FOR UPDATE|payload_encrypted|token_hash|SELECT \*/i);
    if (query === fail) throw Error('synthetic private error must not be printed');
    if (query === sql.clock) return [{ utc_now: date(now), session_timezone: '+00:00' }];
    if (query === sql.user) return account ? [account] : [];
    if (query === sql.invitations) return [inv];
    if (query === sql.sessions) return [{ total: '2', created_last_hour: '1', missing_client_state: '0', credential_mismatch: '0', revoked: '1', expired: '0', invalid_chronology: '0', usable_persisted: '1' }];
    if (query === sql.verifications) return [{ total: '1', consumed: '1', revoked: '0', expired_unused: '0', available: '0' }];
    if (query === sql.mail) return [{ total: '1', pending: '0', sending: '0', sent: '1', cancelled: '0', failed: '0', delivery_error: '0', payload_error: '0', expired_unsent: '0' }];
    return [];
  }};
}

test('active account diagnosis uses read-only snapshot, bound email and rolls back', async () => {
  const connection = fixture();
  const result = await inspectAccount(connection, email, () => now);
  assert.equal(result.account.freshLoginAccountGatesPass, true);
  assert.equal(result.account.resendVerificationEligibleWithoutPasswordCheck, false);
  assert.equal(result.passwordMatchChecked, false);
  assert.equal(result.sessions.usable_persisted, 1);
  assert.deepEqual(connection.queries.slice(0, 2).map(x => x.query), ['SET TRANSACTION READ ONLY', 'START TRANSACTION WITH CONSISTENT SNAPSHOT']);
  assert.equal(connection.queries.at(-1).query, 'ROLLBACK');
  const lookup = connection.queries.find(x => x.query === sql.user);
  assert.deepEqual(lookup.params, [email]); assert.ok(!lookup.query.includes(email));
  const output = JSON.stringify(result);
  assert.ok(!output.includes(email)); assert.ok(!output.includes('password_hash'));
  assert.ok(!output.includes('user_id')); assert.ok(!output.includes('token'));
});

test('not-found account gives no invented state and no client-table lookup', async () => {
  const connection = fixture({ account: null });
  const result = await inspectAccount(connection, email, () => now);
  assert.deepEqual(result.account, { found: false });
  assert.equal(connection.queries.length, 5);
  assert.equal(connection.queries.at(-1).query, 'ROLLBACK');
});

test('pending unverified account distinguishes resend from login eligibility', async () => {
  const result = await inspectAccount(fixture({ account: { ...user(), status: 'pending', email_verified_at: null, access_approved_at: null } }), email, () => now);
  assert.equal(result.account.resendVerificationEligibleWithoutPasswordCheck, true);
  assert.equal(result.account.loginEligibleWithoutPasswordCheck, false);
});

for (const [name, changes, inv] of [
  ['revoked', { status: 'revoked' }], ['administrator', { role: 'admin' }],
  ['missing auth state', { credential_version: null }], ['future verification', { email_verified_at: date(now + 60000) }],
  ['approval before invitation', { access_approved_at: date(now - 240000) }],
  ['missing invitation', {}, { total: 0, first_consumed: null, last_consumed: null }],
  ['duplicate invitations', {}, { ...invitation(), total: 2 }],
]) {
  test(`fresh login account gates report ${name}`, async () => {
    const result = await inspectAccount(fixture({ account: { ...user(), ...changes }, inv: inv ?? invitation() }), email, () => now);
    assert.equal(result.account.freshLoginAccountGatesPass, false);
  });
}

test('expiry is reported independently from ability to establish a limited session', async () => {
  const result = await inspectAccount(fixture({ account: { ...user(), access_expires_at: date(now - 1) } }), email, () => now);
  assert.equal(result.account.accessExpired, true);
  assert.equal(result.account.freshLoginAccountGatesPass, true);
});

test('query failure still rolls back', async () => {
  const connection = fixture({ fail: sql.sessions });
  await assert.rejects(inspectAccount(connection, email, () => now));
  assert.equal(connection.queries.at(-1).query, 'ROLLBACK');
});

const native = process.env.JM_ACCESS_DIAGNOSTIC_DB_TEST === '1';
test('same diagnosis SELECTs on disposable MariaDB, preserving all rows and enforcing READ ONLY', {
  skip: native ? false : 'Native MariaDB job required; no hosting fallback.', timeout: 60000
}, async t => {
  const root = pathToFileURL(resolve(process.env.JM_DIAGNOSTIC_REPOSITORY || '.') + '/');
  const { databaseOptions, connectDatabase } = await import(new URL('server/db/connection.mjs', root));
  const { applyMigrations, loadMigrations } = await import(new URL('server/db/migrations.mjs', root));
  const options = databaseOptions();
  assert.equal(options.host, '127.0.0.1'); assert.equal(options.database, 'jessiemessage_test_access_diagnostic');
  const connection = await connectDatabase();
  try {
    assert.equal((await connection.query('SHOW TABLES')).length, 0, 'refuse any reused database');
    await applyMigrations(connection, { database: options.database, migrations: await loadMigrations() });
    await connection.query("SET time_zone = '+00:00'");
    const admin = randomBytes(16), client = randomBytes(16), invitationId = randomBytes(16), verification = randomBytes(16), session = randomBytes(16);
    await connection.query("INSERT INTO users (id, role, status, pseudonym, email) VALUES (?, 'admin', 'active', 'synthetic administrator', 'admin@example.invalid')", [admin]);
    await connection.query(`INSERT INTO users (id, role, status, pseudonym, email, password_hash, email_verified_at, age_assured_at, access_approved_at)
      VALUES (?, 'client', 'active', 'synthetic private name', ?, 'synthetic private hash', ?, ?, ?)`, [client, email, date(now - 60000), date(now - 60000), date(now - 10000)]);
    await connection.query('INSERT INTO client_auth_state (user_id, age_declared_at) VALUES (?, ?)', [client, date(now - 120000)]);
    await connection.query(`INSERT INTO invitations (id, token_hash, created_by_id, created_at, expires_at, consumed_at, consumed_by_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)`, [invitationId, randomBytes(32), admin, date(now - 180000), date(now + 3600000), date(now - 120000), client]);
    await connection.query('INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)', [session, client, randomBytes(32), date(now - 5000), date(now + 3600000)]);
    await connection.query('INSERT INTO client_session_state (session_id, last_seen_at, credential_version) VALUES (?, ?, 1)', [session, date(now - 5000)]);
    await connection.query('INSERT INTO email_verifications (id, user_id, token_hash, created_at, expires_at, consumed_at) VALUES (?, ?, ?, ?, ?, ?)', [verification, client, randomBytes(32), date(now - 120000), date(now + 3600000), date(now - 60000)]);
    await connection.query(`INSERT INTO mail_outbox (id, verification_id, recipient_user_id, payload_encrypted, status, available_at, expires_at, created_at, sent_at)
      VALUES (?, ?, ?, 'synthetic private payload', 'sent', ?, ?, ?, ?)`, [randomBytes(16), verification, client, date(now - 120000), date(now + 3600000), date(now - 120000), date(now - 110000)]);
    const snapshot = async () => {
      const rows = {};
      for (const table of ['users', 'invitations', 'sessions', 'client_auth_state', 'client_session_state', 'email_verifications', 'mail_outbox']) {
        rows[table] = await connection.query(`SELECT * FROM ${table}`);
      }
      return rows;
    };
    const before = await snapshot();
    const result = await inspectAccount(connection, email, () => now);
    assert.equal(result.account.freshLoginAccountGatesPass, true);
    assert.equal(result.account.resendVerificationEligibleWithoutPasswordCheck, false);
    assert.equal(result.sessions.usable_persisted, 1);
    assert.equal(result.verifications.consumed, 1); assert.equal(result.verificationMail.sent, 1);
    assert.deepEqual(await snapshot(), before, 'diagnosis must not touch sessions, mail or account');
    for (const value of [email, 'synthetic private name', 'synthetic private hash', 'synthetic private payload']) {
      assert.ok(!JSON.stringify(result).includes(value), 'private fields must never escape');
    }
    await t.test('READ ONLY transaction rejects even a permitted DML operation', async () => {
      await connection.query('SET TRANSACTION READ ONLY'); await connection.beginTransaction();
      try { await assert.rejects(connection.query('UPDATE users SET pseudonym = pseudonym WHERE id = ?', [client]), error => error.errno === 1792); }
      finally { await connection.rollback(); }
      assert.deepEqual(await snapshot(), before);
    });
    await t.test('actual missing account returns false without exposing lookup address', async () => {
      const missing = await inspectAccount(connection, 'missing@example.invalid', () => now);
      assert.deepEqual(missing.account, { found: false }); assert.ok(!JSON.stringify(missing).includes('@'));
    });
  } finally { await connection.end(); }
});
