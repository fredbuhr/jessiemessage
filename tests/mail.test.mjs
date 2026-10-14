import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mailConfiguration, MailConfigError } from "../server/mail/config.mjs";
import { sealVerificationPayload, openVerificationPayload, MailCryptoError } from "../server/mail/crypto.mjs";
import { createVerificationTransport, MailDeliveryError } from "../server/mail/transport.mjs";
import { runMailBatch, startMailWorker } from "../server/mail/worker.mjs";
import { createMailStore } from "../server/mail/store.mjs";
import { newToken } from "../server/auth/crypto.mjs";

const origin = "https://example.invalid";
const email = "synthetic-client@example.invalid";
const configured = () => ({
  JESSIEMESSAGE_ENABLE_MAIL_DELIVERY: "1", JESSIEMESSAGE_SITE_ORIGIN: origin,
  JESSIEMESSAGE_MAIL_KEY: randomBytes(32).toString("base64url"),
  JESSIEMESSAGE_SMTP_HOST: "mail.example.invalid", JESSIEMESSAGE_SMTP_PORT: "587",
  JESSIEMESSAGE_SMTP_USER: "synthetic-mail-user", JESSIEMESSAGE_SMTP_PASSWORD: "synthetic-mail-password",
  JESSIEMESSAGE_SMTP_FROM: "access@example.invalid",
});
const jobFixture = (key, overrides = {}) => {
  const id = randomBytes(16);
  return { id, leaseToken: randomBytes(16), recipientEmail: email,
    payloadEncrypted: sealVerificationPayload({ email, token: newToken() }, key, id), ...overrides };
};

test("verification delivery is explicitly opt-in and configuration errors contain no supplied values", () => {
  assert.deepEqual(mailConfiguration({}), { enabled: false });
  assert.deepEqual(mailConfiguration({ JESSIEMESSAGE_ENABLE_MAIL_DELIVERY: "0" }), { enabled: false });
  for (const flag of ["", "true", "2"]) assert.throws(() => mailConfiguration({ JESSIEMESSAGE_ENABLE_MAIL_DELIVERY: flag }), MailConfigError);
  for (const field of ["JESSIEMESSAGE_MAIL_KEY", "JESSIEMESSAGE_SMTP_USER", "JESSIEMESSAGE_SMTP_PASSWORD", "JESSIEMESSAGE_SMTP_FROM", "JESSIEMESSAGE_SMTP_HOST", "JESSIEMESSAGE_SMTP_PORT"]) {
    assert.throws(() => mailConfiguration({ ...configured(), [field]: undefined }), { code: "MAIL_CONFIG" });
  }
});

test("mail configuration requires a canonical HTTPS origin, key, sender and encrypted SMTP port", () => {
  const env = configured();
  const result = mailConfiguration(env);
  assert.equal(result.key.length, 32);
  assert.equal(result.smtp.port, 587);
  assert.equal(result.smtp.from, "access@example.invalid");
  assert.equal(mailConfiguration({ ...env, JESSIEMESSAGE_SMTP_FROM: "ACCESS@EXAMPLE.INVALID" }).smtp.from, "access@example.invalid");
  for (const invalid of ["http://example.invalid", `${origin}/`, `${origin}/private`, "https://user:pass@example.invalid", `${origin}?x=1`]) {
    assert.throws(() => mailConfiguration({ ...env, JESSIEMESSAGE_SITE_ORIGIN: invalid }), { code: "MAIL_CONFIG" });
  }
  for (const invalid of ["25", "465.0", "587 ", "2525", "0"]) assert.throws(() => mailConfiguration({ ...env, JESSIEMESSAGE_SMTP_PORT: invalid }), { code: "MAIL_CONFIG" });
  for (const invalid of [env.JESSIEMESSAGE_MAIL_KEY + "=", "a".repeat(43), "short"]) assert.throws(() => mailConfiguration({ ...env, JESSIEMESSAGE_MAIL_KEY: invalid }), { code: "MAIL_CONFIG" });
  for (const invalid of ["mail.example.invalid/path", "smtp://mail.example.invalid", "mail.example.invalid\n", "-mail.example.invalid", ""]) assert.throws(() => mailConfiguration({ ...env, JESSIEMESSAGE_SMTP_HOST: invalid }), { code: "MAIL_CONFIG" });
  assert.throws(() => mailConfiguration({ ...env, JESSIEMESSAGE_SMTP_USER: "private-user\r\n" }), { code: "MAIL_CONFIG" });
  assert.throws(() => mailConfiguration({ ...env, JESSIEMESSAGE_SMTP_PASSWORD: "private-password\0" }), { code: "MAIL_CONFIG" });
  assert.throws(() => mailConfiguration({ ...env, JESSIEMESSAGE_SMTP_TLS_CA_PATH: "" }), { code: "MAIL_CONFIG" });
});

test("mail payload encryption is randomized, authenticated and bound to the exact job id and key", () => {
  const key = randomBytes(32), id = randomBytes(16), payload = { email, token: newToken() };
  const first = sealVerificationPayload(payload, key, id);
  const second = sealVerificationPayload(payload, key, id);
  assert.notEqual(first, second);
  assert.ok(first.length <= 1024);
  assert.ok(!first.includes(payload.email) && !first.includes(payload.token));
  assert.deepEqual(openVerificationPayload(first, key, id), payload);
  for (const [sealed, otherKey, otherId] of [[first, key, randomBytes(16)], [first, randomBytes(32), id], [`${first.slice(0, 30)}${first[30] === "A" ? "B" : "A"}${first.slice(31)}`, key, id], [`v2${first.slice(2)}`, key, id], [first + "=", key, id]]) {
    assert.throws(() => openVerificationPayload(sealed, otherKey, otherId), (error) => error instanceof MailCryptoError && error.code === "PAYLOAD_INVALID" && error.cause === undefined && !error.message.includes(payload.token));
  }
});

test("encrypted payload validation rejects canonical aliases, extra fields, invalid tokens and context sizes", () => {
  const key = randomBytes(32), id = randomBytes(16), token = newToken();
  for (const payload of [null, [], { email: email.toUpperCase(), token }, { email, token: token + "=" }, { email: "a@example.invalid\n", token }, { email, token, password: "private" }, { email, token: "x" }]) {
    assert.throws(() => sealVerificationPayload(payload, key, id), { code: "PAYLOAD_INVALID" });
  }
  assert.throws(() => sealVerificationPayload({ email, token }, randomBytes(31), id), { code: "PAYLOAD_INVALID" });
  assert.throws(() => openVerificationPayload("x".repeat(1025), key, id), { code: "PAYLOAD_INVALID" });
  assert.throws(() => openVerificationPayload("v1.a.b.c", key, randomBytes(15)), { code: "PAYLOAD_INVALID" });
});

test("SMTP transport enforces TLS verification, bounded timeouts and disabled external content/debug access", async () => {
  for (const port of ["465", "587"]) {
    let options;
    const transport = await createVerificationTransport(mailConfiguration({ ...configured(), JESSIEMESSAGE_SMTP_PORT: port }), {
      createTransport(value) { options = value; return { async sendMail() { return { accepted: [email] }; }, close() {} }; },
    });
    assert.equal(options.secure, port === "465");
    assert.equal(options.requireTLS, true);
    assert.deepEqual(options.tls, { rejectUnauthorized: true, minVersion: "TLSv1.2" });
    assert.equal(options.logger, false); assert.equal(options.debug, false); assert.equal(options.pool, false);
    assert.equal(options.disableFileAccess, true); assert.equal(options.disableUrlAccess, true);
    assert.ok(options.connectionTimeout <= 15000 && options.greetingTimeout <= 15000 && options.socketTimeout <= 45000);
    await transport.close();
  }
});

test("verification message is neutral, addresses only its intended recipient and puts the token in a URL fragment", async () => {
  const config = mailConfiguration(configured()), token = newToken(), jobId = randomBytes(16);
  const captured = [];
  const transport = await createVerificationTransport(config, { createTransport: () => ({
    async sendMail(message) { captured.push(message); return { accepted: [email.toUpperCase()] }; }, close() {},
  }) });
  assert.equal(await transport.sendVerification({ email, token, jobId }), true);
  assert.equal(await transport.sendVerification({ email, token, jobId }), true);
  assert.equal(captured[0].messageId, captured[1].messageId);
  assert.equal(captured[0].messageId, `<verification-${jobId.toString("hex")}@example.invalid>`);
  assert.equal(captured[0].to, email);
  assert.deepEqual(captured[0].envelope, { from: config.smtp.from, to: [email] });
  assert.ok(captured[0].text.includes(`${origin}/access#verification=${token}`));
  assert.ok(!captured[0].text.includes(`?verification=${token}`));
  assert.ok(!/stripchat|porn|sexe|adulte|photo|conversation|mot de passe/i.test(captured[0].text + captured[0].subject));
  assert.equal(captured[0].html, undefined);
  await transport.close();
});

test("SMTP success requires acceptance of the exact recipient and failure details never escape", async () => {
  const token = newToken(), input = { email, token, jobId: randomBytes(16) };
  for (const result of [{ accepted: [] }, { accepted: ["another@example.invalid"] }, { rejected: [email] }, null]) {
    const transport = await createVerificationTransport(mailConfiguration(configured()), { createTransport: () => ({ async sendMail() { return result; }, close() {} }) });
    await assert.rejects(transport.sendVerification(input), { code: "MAIL_DELIVERY_FAILED" });
    await transport.close();
  }
  const transport = await createVerificationTransport(mailConfiguration(configured()), { createTransport: () => ({
    async sendMail() { throw new Error(`SMTP private password ${token} ${email}`); }, close() {},
  }) });
  await assert.rejects(transport.sendVerification(input), (error) => error instanceof MailDeliveryError && error.cause === undefined && !JSON.stringify(error).includes(token) && !error.message.includes(email));
  await assert.rejects(transport.sendVerification({ ...input, token: "malformed" }), { code: "PAYLOAD_INVALID" });
  await transport.close();
});

test("SMTP setup and close failures are sanitized and close is idempotent", async () => {
  await assert.rejects(createVerificationTransport(mailConfiguration({ ...configured(), JESSIEMESSAGE_SMTP_TLS_CA_PATH: "/nonexistent/private-smtp-ca.pem" })), (error) => error.code === "MAIL_TRANSPORT_CONFIG" && error.cause === undefined && !error.message.includes("private-smtp-ca"));
  let closed = 0;
  const transport = await createVerificationTransport(mailConfiguration(configured()), { createTransport: () => ({ async sendMail() { return { accepted: [email] }; }, close() { closed += 1; } }) });
  await transport.close(); await transport.close();
  assert.equal(closed, 1);
  await assert.rejects(transport.sendVerification({ email, token: newToken(), jobId: randomBytes(16) }), { code: "MAIL_DELIVERY_FAILED" });
});

test("mail worker records accepted delivery only through the active lease and performs bounded pruning", async () => {
  const key = randomBytes(32), job = jobFixture(key), events = [];
  let claimed = false;
  const result = await runMailBatch({ key, clock: () => 1000, store: {
    async claim() { if (claimed) return null; claimed = true; return job; },
    async markSent(id, lease, value) { events.push(["sent", id, lease, value]); return true; },
    async markFailed() { assert.fail("successful send must not record failure"); },
    async prune(value) { events.push(["prune", value]); },
  }, transport: { async sendVerification(value) { assert.equal(value.email, email); assert.deepEqual(value.jobId, job.id); return true; } } });
  assert.deepEqual(result, { sent: 1, failed: 0 });
  assert.deepEqual(events[0], ["sent", job.id, job.leaseToken, { now: 1000 }]);
  assert.deepEqual(events[1], ["prune", { now: 1000 }]);
});

test("mail worker permanently rejects tampered or stale-recipient payloads without sending", async () => {
  const key = randomBytes(32);
  for (const job of [jobFixture(key, { payloadEncrypted: "invalid-private-payload" }), jobFixture(key, { recipientEmail: "changed@example.invalid" })]) {
    const failures = [];
    const result = await runMailBatch({ key, batchSize: 1, clock: () => 1000, store: {
      async claim() { return job; }, async markFailed(...args) { failures.push(args); return true; }, async prune() {},
    }, transport: { async sendVerification() { assert.fail("invalid payload cannot be delivered"); } } });
    assert.deepEqual(result, { sent: 0, failed: 1 });
    assert.deepEqual(failures[0], [job.id, job.leaseToken, { now: 1000, code: "PAYLOAD_INVALID", permanent: true }]);
  }
});

test("mail worker schedules retry on SMTP failure and does not count a stale completion as sent", async () => {
  const key = randomBytes(32), job = jobFixture(key), failures = [];
  const base = { key, batchSize: 1, clock: () => 1000, store: {
    async claim() { return job; }, async markFailed(...args) { failures.push(args); }, async markSent() { return false; }, async prune() {},
  } };
  assert.deepEqual(await runMailBatch({ ...base, transport: { async sendVerification() { throw new Error("private SMTP response"); } } }), { sent: 0, failed: 1 });
  assert.deepEqual(failures[0], [job.id, job.leaseToken, { now: 1000, code: "MAIL_DELIVERY_FAILED" }]);
  assert.deepEqual(await runMailBatch({ ...base, transport: { async sendVerification() { return true; } } }), { sent: 0, failed: 1 });
});

test("worker exceptions are sanitized and invalid batch bounds cannot touch persistence", async () => {
  const key = randomBytes(32);
  for (const batchSize of [0, 21, 1.5]) await assert.rejects(runMailBatch({ key, batchSize }), { code: "MAIL_WORKER_FAILED" });
  await assert.rejects(runMailBatch({ key, store: { async claim() { throw new Error("private SQL values"); } } }), (error) => error.code === "MAIL_WORKER_FAILED" && error.cause === undefined && !error.message.includes("SQL"));
});

test("worker shutdown waits for an active batch and closes its transport once", async () => {
  let releaseClaim, announceClaim;
  const claimStarted = new Promise((resolve) => { announceClaim = resolve; });
  const claimCompletion = new Promise((resolve) => { releaseClaim = resolve; });
  let claims = 0, closes = 0;
  const worker = startMailWorker({ key: randomBytes(32), intervalMilliseconds: 1000, store: {
    async claim() { claims += 1; announceClaim(); await claimCompletion; return null; }, async prune() {},
  }, transport: { async close() { closes += 1; } } });
  // The worker timer is unref'd by design; this test-owned timer keeps the loop alive.
  const keepAlive = setTimeout(() => {}, 5000);
  try {
    await claimStarted;
    let finished = false;
    const closing = worker.close().then(() => { finished = true; });
    await Promise.resolve();
    assert.equal(finished, false);
    releaseClaim(); await closing; await worker.close();
    assert.equal(claims, 1); assert.equal(closes, 1);
  } finally { clearTimeout(keepAlive); releaseClaim(); await worker.close(); }
});

test("mail store validates bounded inputs before any database access", async () => {
  const store = createMailStore({ async getConnection() { assert.fail("invalid input cannot acquire a connection"); } });
  for (const leaseMilliseconds of [0, 999, 300001, 1.5]) await assert.rejects(store.claim({ now: 1000, leaseMilliseconds }), { code: "MAIL_STORE_INPUT" });
  await assert.rejects(store.claim({ now: NaN }), { code: "MAIL_STORE_INPUT" });
  await assert.rejects(store.markSent(randomBytes(15), randomBytes(16), { now: 1000 }), { code: "MAIL_STORE_INPUT" });
  await assert.rejects(store.markFailed(randomBytes(16), randomBytes(16), { now: 1000, code: "private SMTP error" }), { code: "MAIL_STORE_INPUT" });
  assert.equal(await store.prune({ now: 0 }), 0);
});

test("mail pruning uses two indexed bounds and reserves a five-minute interval before concurrent calls", async () => {
  const queries = [];
  let connections = 0, releaseFirst;
  const firstQueryGate = new Promise((resolve) => { releaseFirst = resolve; });
  const store = createMailStore({ async getConnection() {
    connections += 1;
    return { async query(sql, parameters) {
      queries.push({ sql, parameters });
      if (queries.length === 1) await firstQueryGate;
      return { affectedRows: 2 };
    }, release() {} };
  } });
  const now = Date.UTC(2026, 9, 14, 12);
  const first = store.prune({ now });
  assert.equal(await store.prune({ now }), 0);
  releaseFirst();
  assert.equal(await first, 4);
  assert.equal(connections, 1);
  assert.deepEqual(queries.map((query) => query.sql), [
    "DELETE FROM mail_outbox WHERE expires_at < ? LIMIT 1000",
    "DELETE FROM mail_outbox WHERE sent_at < ? LIMIT 1000",
  ]);
  assert.equal(await store.prune({ now: now + 299999 }), 0);
  assert.equal(connections, 1);
  assert.equal(await store.prune({ now: now + 300000 }), 4);
  assert.equal(connections, 2);
  assert.equal(queries.length, 4);
});
