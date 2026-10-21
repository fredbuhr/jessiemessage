import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { newToken } from "../server/auth/crypto.mjs";
import { sealVerificationPayload, openVerificationPayload } from "../server/mail/crypto.mjs";
import { sealResetPayload, openResetPayload, ResetMailCryptoError } from "../server/reset/mail-crypto.mjs";
import { createVerificationTransport, MailDeliveryError } from "../server/mail/transport.mjs";
import { runMailBatch, startMailWorker } from "../server/mail/worker.mjs";

const email = "synthetic-client@example.invalid";
const origin = "https://example.invalid";
const config = () => ({ enabled: true, origin, smtp: {
  host: "mail.example.invalid", port: 587, user: "synthetic-user", password: "synthetic-password", from: "access@example.invalid",
} });
function jobFixture(key, seal = sealResetPayload) {
  const id = randomBytes(16), token = newToken();
  return { id, recipientEmail: email, leaseToken: randomBytes(16), payloadEncrypted: seal({ email, token }, key, id) };
}

test("reset mail encryption hides its payload, binds the job and key, and rejects verification-purpose interchange", () => {
  const key = randomBytes(32), id = randomBytes(16), value = { email, token: newToken() };
  const sealed = sealResetPayload(value, key, id), other = sealResetPayload(value, key, id);
  assert.notEqual(sealed, other);
  assert.ok(sealed.length <= 1024 && !sealed.includes(email) && !sealed.includes(value.token));
  assert.deepEqual(openResetPayload(sealed, key, id), value);
  assert.throws(() => openVerificationPayload(sealed, key, id), { code: "PAYLOAD_INVALID" });
  assert.throws(() => openResetPayload(sealVerificationPayload(value, key, id), key, id), { code: "PAYLOAD_INVALID" });
  for (const [candidate, candidateKey, candidateId] of [
    [sealed, key, randomBytes(16)], [sealed, randomBytes(32), id],
    [`${sealed.slice(0, 30)}${sealed[30] === "A" ? "B" : "A"}${sealed.slice(31)}`, key, id],
    [`v2${sealed.slice(2)}`, key, id], [sealed + "=", key, id], [sealed + "\n", key, id],
  ]) assert.throws(() => openResetPayload(candidate, candidateKey, candidateId), (error) =>
    error instanceof ResetMailCryptoError && error.code === "PAYLOAD_INVALID" && error.cause === undefined
      && !error.message.includes(email) && !error.message.includes(value.token));
});

test("reset mail payloads reject extra fields, aliases, malformed tokens and invalid context sizes", () => {
  const key = randomBytes(32), id = randomBytes(16), token = newToken();
  for (const value of [null, [], { email: email.toUpperCase(), token }, { email, token: token + "=" },
    { email, token: token + "\n" }, { email: "a@example.invalid\n", token }, { email, token, password: "private" }, { email, token: "x" }]) {
    assert.throws(() => sealResetPayload(value, key, id), { code: "PAYLOAD_INVALID" });
  }
  assert.throws(() => sealResetPayload({ email, token }, randomBytes(31), id), { code: "PAYLOAD_INVALID" });
  assert.throws(() => sealResetPayload({ email, token }, key, randomBytes(15)), { code: "PAYLOAD_INVALID" });
  assert.throws(() => openResetPayload("x".repeat(1025), key, id), { code: "PAYLOAD_INVALID" });
  assert.throws(() => openResetPayload("v1.a.b.c", key, randomBytes(15)), { code: "PAYLOAD_INVALID" });
});

test("reset SMTP message keeps its token in a fragment and uses a distinct stable message id and exact recipient", async () => {
  const captured = [], token = newToken(), jobId = randomBytes(16), settings = config();
  const transport = await createVerificationTransport(settings, { createTransport: () => ({
    async sendMail(message) { captured.push(message); return { accepted: [email.toUpperCase()] }; }, close() {},
  }) });
  try {
    assert.equal(await transport.sendPasswordReset({ email, token, jobId }), true);
    assert.equal(await transport.sendPasswordReset({ email, token, jobId }), true);
    assert.equal(captured[0].messageId, captured[1].messageId);
    assert.equal(captured[0].messageId, `<password-reset-${jobId.toString("hex")}@example.invalid>`);
    assert.equal(captured[0].to, email);
    assert.deepEqual(captured[0].envelope, { from: settings.smtp.from, to: [email] });
    assert.ok(captured[0].text.includes(`${origin}/recover#reset=${token}`));
    assert.ok(!captured[0].text.includes(`?reset=${token}`));
    assert.match(captured[0].text, /30 minutes/);
    assert.match(captured[0].text, /une seule fois/);
    assert.equal(captured[0].subject, "Retrouver ton accès — Jessie");
    assert.match(captured[0].text, /Pour retrouver ton accès à mon espace/);
    assert.match(captured[0].text, /Si tu n'as pas demandé ce lien, tu peux ignorer cet e-mail\./);
    assert.match(captured[0].text, /Ton mot de passe reste inchangé tant que tu n'en choisis pas un nouveau\./);
    assert.doesNotMatch(captured[0].text, /\b(?:vous|votre)\b/i);
    assert.ok(!/stripchat|porn|sexe|adulte|photo|conversation/i.test(captured[0].text + captured[0].subject));
    assert.equal(captured[0].html, undefined);
    await transport.sendVerification({ email, token, jobId });
    assert.notEqual(captured[0].messageId, captured[2].messageId);
  } finally { await transport.close(); }
});

test("reset SMTP requires exact acceptance and sanitizes delivery, payload and closed-transport errors", async () => {
  const input = { email, token: newToken(), jobId: randomBytes(16) };
  for (const result of [null, { accepted: [] }, { accepted: ["another@example.invalid"] }, { rejected: [email] }]) {
    const transport = await createVerificationTransport(config(), { createTransport: () => ({
      async sendMail() { return result; }, close() {},
    }) });
    try { await assert.rejects(transport.sendPasswordReset(input), { code: "MAIL_DELIVERY_FAILED" }); }
    finally { await transport.close(); }
  }
  const transport = await createVerificationTransport(config(), { createTransport: () => ({
    async sendMail() { throw new Error(`private SMTP ${email} ${input.token}`); }, close() {},
  }) });
  await assert.rejects(transport.sendPasswordReset(input), (error) => error instanceof MailDeliveryError
    && error.cause === undefined && !error.message.includes(email) && !JSON.stringify(error).includes(input.token));
  await assert.rejects(transport.sendPasswordReset({ ...input, token: "bad" }), { code: "PAYLOAD_INVALID" });
  await transport.close();
  await assert.rejects(transport.sendPasswordReset(input), { code: "MAIL_DELIVERY_FAILED" });
});

test("reset worker purpose sends only reset mail and persists delivery through its active lease", async () => {
  const key = randomBytes(32), job = jobFixture(key), events = [];
  let claimed = false;
  const result = await runMailBatch({ key, purpose: "password-reset", clock: () => 1000, store: {
    async claim() { if (claimed) return null; claimed = true; return job; },
    async markSent(...args) { events.push(["sent", ...args]); return true; },
    async markFailed() { assert.fail("successful reset send must not record failure"); },
    async prune(value) { events.push(["prune", value]); },
  }, transport: {
    async sendPasswordReset(value) { assert.equal(value.email, email); assert.deepEqual(value.jobId, job.id); return true; },
    async sendVerification() { assert.fail("reset worker must not send verification mail"); },
  } });
  assert.deepEqual(result, { sent: 1, failed: 0 });
  assert.deepEqual(events, [["sent", job.id, job.leaseToken, { now: 1000 }], ["prune", { now: 1000 }]]);
});

test("workers permanently reject cross-purpose, corrupt and changed-recipient reset payloads before SMTP", async () => {
  const key = randomBytes(32);
  for (const [purpose, job] of [
    ["password-reset", jobFixture(key, sealVerificationPayload)],
    ["verification", jobFixture(key)],
    ["password-reset", { ...jobFixture(key), payloadEncrypted: "private-corrupt-payload" }],
    ["password-reset", { ...jobFixture(key), recipientEmail: "changed@example.invalid" }],
  ]) {
    const failures = [];
    const result = await runMailBatch({ key, purpose, batchSize: 1, clock: () => 1000, store: {
      async claim() { return job; }, async markFailed(...args) { failures.push(args); }, async prune() {},
    }, transport: {
      async sendPasswordReset() { assert.fail("invalid payload cannot be delivered"); },
      async sendVerification() { assert.fail("invalid payload cannot be delivered"); },
    } });
    assert.deepEqual(result, { sent: 0, failed: 1 });
    assert.deepEqual(failures, [[job.id, job.leaseToken, { now: 1000, code: "PAYLOAD_INVALID", permanent: true }]]);
  }
});

test("reset workers retry sanitized SMTP failures and cannot mark a stale lease as delivered", async () => {
  const key = randomBytes(32), job = jobFixture(key), failures = [];
  const options = { key, purpose: "password-reset", batchSize: 1, clock: () => 1000, store: {
    async claim() { return job; }, async markFailed(...args) { failures.push(args); },
    async markSent() { return false; }, async prune() {},
  } };
  assert.deepEqual(await runMailBatch({ ...options, transport: {
    async sendPasswordReset() { throw new Error("private SMTP server details"); },
  } }), { sent: 0, failed: 1 });
  assert.deepEqual(failures, [[job.id, job.leaseToken, { now: 1000, code: "MAIL_DELIVERY_FAILED" }]]);
  assert.deepEqual(await runMailBatch({ ...options, transport: { async sendPasswordReset() { return true; } } }), { sent: 0, failed: 1 });
});

test("unknown worker purpose and invalid transport ownership cannot start persistence or SMTP", async () => {
  for (const purpose of [null, "", "reset", "password-reset\n", true]) {
    await assert.rejects(runMailBatch({ key: randomBytes(32), purpose }), { code: "MAIL_WORKER_FAILED" });
    assert.throws(() => startMailWorker({ purpose }), { code: "MAIL_WORKER_FAILED" });
  }
  for (const closeTransport of [null, 0, "false", {}]) {
    assert.throws(() => startMailWorker({ closeTransport }), { code: "MAIL_WORKER_FAILED" });
  }
});

test("shared-transport worker shutdown waits for its active batch and leaves SMTP ownership to its caller", async () => {
  let releaseClaim, announceClaim;
  const claimStarted = new Promise((resolve) => { announceClaim = resolve; });
  const claimCompletion = new Promise((resolve) => { releaseClaim = resolve; });
  let closes = 0, claims = 0;
  const worker = startMailWorker({ key: randomBytes(32), purpose: "password-reset", closeTransport: false,
    intervalMilliseconds: 1000, store: {
      async claim() { claims += 1; announceClaim(); await claimCompletion; return null; }, async prune() {},
    }, transport: { async close() { closes += 1; } },
  });
  const keepAlive = setTimeout(() => {}, 5000);
  try {
    await claimStarted;
    let finished = false;
    const closing = worker.close().then(() => { finished = true; });
    await Promise.resolve();
    assert.equal(finished, false);
    releaseClaim(); await closing; await worker.close();
    assert.equal(claims, 1); assert.equal(closes, 0);
  } finally { clearTimeout(keepAlive); releaseClaim(); await worker.close(); }
});
