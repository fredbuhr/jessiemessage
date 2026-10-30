import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { startMailWorker } from '../server/mail/worker.mjs';
import { sealVerificationPayload } from '../server/mail/crypto.mjs';

const tick = async (t, ms = 0) => { t.mock.timers.tick(ms); await new Promise(setImmediate); };
function fixture(t, { batchSize = 5, claim } = {}) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const key = randomBytes(32), queue = [], sent = [], states = [];
  let claims = 0;
  const store = { async claim() { claims++; return claim ? claim() : queue.shift() ?? null; },
    async markSent() { return true; }, async markFailed() { return true; }, async prune() {} };
  const worker = startMailWorker({ key, store, batchSize, clock: () => 10000,
    onState: event => states.push(event), transport: {
      async sendVerification(value) { sent.push(value.email); return true; }, async close() {}
    } });
  t.after(() => worker.close());
  function enqueue(number) {
    const id = randomBytes(16), email = `synthetic-${number}@example.invalid`;
    queue.push({ id, recipientEmail: email, payloadEncrypted: sealVerificationPayload({ email, token: randomBytes(32).toString('base64url') }, key, id),
      leaseToken: randomBytes(16), leaseUntil: 120000, expiresAt: 180000 });
  }
  return { worker, queue, sent, states, enqueue, claims: () => claims };
}

test('newly queued verification wakes an idle worker without the 15-second poll delay', async t => {
  const f = fixture(t); await tick(t); assert.equal(f.claims(), 1);
  f.enqueue(1); f.worker.wake(); await tick(t);
  assert.deepEqual(f.sent, ['synthetic-1@example.invalid']);
});

test('full mail batches drain a ready backlog immediately between event-loop turns', async t => {
  const f = fixture(t); for (let i = 0; i < 12; i++) f.enqueue(i);
  await tick(t); assert.equal(f.sent.length, 5);
  await tick(t); assert.equal(f.sent.length, 10);
  await tick(t); assert.equal(f.sent.length, 12);
  const before = f.claims(); await tick(t, 14999); assert.equal(f.claims(), before);
  await tick(t, 1); assert.equal(f.claims(), before + 1);
});

test('many enqueue signals coalesce and never overlap an active mail batch', async t => {
  let release, started = 0, outstanding = 0, maximum = 0;
  const f = fixture(t, { claim: async () => {
    started++; outstanding++; maximum = Math.max(maximum, outstanding);
    if (started === 1) await new Promise(resolve => { release = resolve; });
    outstanding--; return null;
  } });
  await tick(t); for (let i = 0; i < 100; i++) f.worker.wake();
  await tick(t); assert.equal(started, 1);
  release(); await new Promise(setImmediate); await tick(t);
  assert.equal(started, 2); assert.equal(maximum, 1);
  await tick(t); assert.equal(started, 2);
});

test('mail worker errors keep bounded polling rather than spinning immediately', async t => {
  const f = fixture(t, { claim: async () => { throw Error('synthetic private failure'); } });
  await tick(t); assert.equal(f.claims(), 1);
  await tick(t, 14999); assert.equal(f.claims(), 1);
  await tick(t, 1); assert.equal(f.claims(), 2);
  assert.ok(f.states.some(x => x.state === 'error' && x.code === 'MAIL_WORKER_FAILED'));
  assert.ok(!JSON.stringify(f.states).includes('private failure'));
});

test('wake after shutdown cannot restart delivery or database polling', async t => {
  const f = fixture(t); await tick(t); await f.worker.stop();
  f.enqueue(1); f.worker.wake(); await tick(t, 60000);
  assert.equal(f.claims(), 1); assert.equal(f.sent.length, 0);
});
