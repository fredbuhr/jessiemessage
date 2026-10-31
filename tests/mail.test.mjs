import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mailConfiguration, MailConfigError } from "../server/mail/config.mjs";
import { sealVerificationPayload, openVerificationPayload, MailCryptoError } from "../server/mail/crypto.mjs";
import { createVerificationTransport, MailDeliveryError } from "../server/mail/transport.mjs";
import { runMailBatch, startMailWorker } from "../server/mail/worker.mjs";
import { createMailStore } from "../server/mail/store.mjs";
import { sealResetPayload } from "../server/reset/mail-crypto.mjs";
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
  return { id, leaseToken: randomBytes(16), recipientEmail: email, expiresAt: 200000, leaseUntil: 121000,
    payloadEncrypted: sealVerificationPayload({ email, token: newToken() }, key, id), ...overrides };
};

test("verification delivery is explicitly opt-in and configuration errors contain no supplied values", () => {
  assert.deepEqual(mailConfiguration({}), { enabled: false });
  assert.deepEqual(mailConfiguration({ JESSIEMESSAGE_ENABLE_MAIL_DELIVERY: "0" }), { enabled: false });
  for (const flag of ["", "true", "2"]) assert.throws(() => mailConfiguration({ JESSIEMESSAGE_ENABLE_MAIL_DELIVERY: flag }), MailConfigError);
  for (const field of ["JESSIEMESSAGE_MAIL_KEY", "JESSIEMESSAGE_SMTP_USER", "JESSIEMESSAGE_SMTP_PASSWORD", "JESSIEMESSAGE_SMTP_HOST", "JESSIEMESSAGE_SMTP_PORT"]) {
    assert.throws(() => mailConfiguration({ ...configured(), [field]: undefined }), { code: "MAIL_CONFIG" });
  }
});

test("mail configuration requires a canonical HTTPS origin, key, sender and encrypted SMTP port", () => {
  const env = configured();
  const result = mailConfiguration(env);
  assert.equal(result.key.length, 32);
  assert.equal(result.smtp.port, 587);
  assert.equal(result.smtp.from, "access@example.invalid");
  assert.equal(result.smtp.replyTo, result.smtp.from);
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

test("the official contact identity defaults the sender without enabling mail or inventing credentials", () => {
  const env = configured();
  const defaults = mailConfiguration({ ...env, JESSIEMESSAGE_SMTP_FROM: undefined });
  assert.equal(defaults.smtp.from, "contact@jessiemessage.com");
  assert.equal(defaults.smtp.replyTo, "contact@jessiemessage.com");
  assert.equal(defaults.smtp.user, env.JESSIEMESSAGE_SMTP_USER);
  assert.deepEqual(mailConfiguration({ JESSIEMESSAGE_SMTP_FROM: "contact@jessiemessage.com" }), { enabled: false });
  assert.throws(() => mailConfiguration({ JESSIEMESSAGE_ENABLE_MAIL_DELIVERY: "1",
    JESSIEMESSAGE_SMTP_FROM: "contact@jessiemessage.com" }), { code: "MAIL_CONFIG" });
  for (const value of ["", null, "Contact <contact@jessiemessage.com>", "contact@jessiemessage.com\n"]) {
    assert.throws(() => mailConfiguration({ ...env, JESSIEMESSAGE_SMTP_FROM: value }), { code: "MAIL_CONFIG" });
  }
});

test("official site origins cannot select another sender while isolated synthetic origins keep theirs", () => {
  const env = configured();
  for (const siteOrigin of ["https://jessiemessage.com", "https://www.jessiemessage.com", "https://pilot.jessiemessage.com:8443"]) {
    const settings = { ...env, JESSIEMESSAGE_SITE_ORIGIN: siteOrigin };
    assert.throws(() => mailConfiguration(settings), { code: "MAIL_CONFIG" });
    assert.equal(mailConfiguration({ ...settings, JESSIEMESSAGE_SMTP_FROM: undefined }).smtp.from, "contact@jessiemessage.com");
    assert.equal(mailConfiguration({ ...settings, JESSIEMESSAGE_SMTP_FROM: "CONTACT@JESSIEMESSAGE.COM" }).smtp.replyTo, "contact@jessiemessage.com");
  }
  for (const siteOrigin of [origin, "https://eviljessiemessage.com", "https://jessiemessage.com.example.invalid"]) {
    assert.equal(mailConfiguration({ ...env, JESSIEMESSAGE_SITE_ORIGIN: siteOrigin }).smtp.from, "access@example.invalid");
  }
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
    assert.equal(options.forceAuth, true);
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
  assert.equal(captured[0].from, config.smtp.from);
  assert.equal(captured[0].replyTo, config.smtp.from);
  assert.deepEqual(captured[0].envelope, { from: config.smtp.from, to: [email] });
  assert.ok(captured[0].text.includes(`${origin}/access#verification=${token}`));
  assert.match(captured[0].text, /appuie sur « Vérifier mon e-mail ».*« Verify my email ».*terminer la confirmation/);
  assert.ok(!captured[0].text.includes(`?verification=${token}`));
  assert.ok(!/stripchat|porn|sexe|adulte|photo|conversation|mot de passe/i.test(captured[0].text + captured[0].subject));
  assert.equal(captured[0].html, undefined);
  await transport.close();
});

test("both mail purposes use one official sender, reply address and SMTP envelope", async () => {
  const config = mailConfiguration({ ...configured(), JESSIEMESSAGE_SITE_ORIGIN: "https://jessiemessage.com",
    JESSIEMESSAGE_SMTP_FROM: undefined });
  const captured = [];
  const transport = await createVerificationTransport(config, { createTransport: () => ({
    async sendMail(message) { captured.push(message); return { accepted: [email] }; }, close() {},
  }) });
  try {
    const input = { email, token: newToken(), jobId: randomBytes(16) };
    await transport.sendVerification(input);
    await transport.sendPasswordReset(input);
    for (const message of captured) {
      assert.equal(message.from, "contact@jessiemessage.com");
      assert.equal(message.replyTo, message.from);
      assert.deepEqual(message.envelope, { from: message.from, to: [email] });
    }
  } finally { await transport.close(); }
});

test("manual transport configuration cannot bypass the official sender or split its reply address", async () => {
  const config = mailConfiguration(configured());
  for (const settings of [
    { ...config, origin: "https://jessiemessage.com" },
    { ...config, origin: "https://www.jessiemessage.com", smtp: { ...config.smtp, from: "other@jessiemessage.com", replyTo: "other@jessiemessage.com" } },
    { ...config, smtp: { ...config.smtp, replyTo: "different@example.invalid" } },
    { ...config, smtp: { ...config.smtp, replyTo: "ACCESS@EXAMPLE.INVALID" } },
    { ...config, smtp: { ...config.smtp, from: "ACCESS@EXAMPLE.INVALID" } },
  ]) {
    await assert.rejects(createVerificationTransport(settings, { createTransport() {
      assert.fail("invalid identity cannot create an SMTP connection");
    } }), { code: "MAIL_TRANSPORT_CONFIG" });
  }
  const captured = [];
  const { replyTo: _, ...smtp } = config.smtp;
  const transport = await createVerificationTransport({ ...config, smtp }, { createTransport: () => ({
    async sendMail(message) { captured.push(message); return { accepted: [email] }; }, close() {},
  }) });
  try {
    await transport.sendPasswordReset({ email, token: newToken(), jobId: randomBytes(16) });
    assert.equal(captured[0].replyTo, "access@example.invalid");
  } finally { await transport.close(); }
});

test("SMTP verification calls authentication checking without sending a message and requires exact true", async () => {
  for (const result of [true, false, undefined, "true", { accepted: [email] }]) {
    let checks = 0, closes = 0;
    const transport = await createVerificationTransport(mailConfiguration(configured()), { createTransport: () => ({
      async verify() { checks += 1; return result; },
      async sendMail() { assert.fail("connection verification must never send mail"); },
      close() { closes += 1; },
    }) });
    try {
      if (result === true) assert.equal(await transport.verify(), true);
      else await assert.rejects(transport.verify(), { code: "MAIL_VERIFY_FAILED" });
      assert.equal(checks, 1);
    } finally { await transport.close(); await transport.close(); }
    assert.equal(closes, 1);
    await assert.rejects(transport.verify(), { code: "MAIL_VERIFY_FAILED" });
    assert.equal(checks, 1);
  }
});

test("SMTP verification sanitizes transport errors and rejects concurrent checks on one instance", async () => {
  const secret = "private-smtp-user-password-host";
  let release, checks = 0;
  const operation = new Promise((_, reject) => { release = reject; });
  const transport = await createVerificationTransport(mailConfiguration(configured()), { createTransport: () => ({
    verify() { checks += 1; return operation; }, close() {},
  }) });
  const first = transport.verify();
  await assert.rejects(transport.verify(), { code: "MAIL_VERIFY_FAILED" });
  release(new Error(secret));
  await assert.rejects(first, (error) => error instanceof MailDeliveryError && error.code === "MAIL_VERIFY_FAILED"
    && error.cause === undefined && !JSON.stringify(error).includes(secret) && !error.message.includes(secret));
  assert.equal(checks, 1);
  await transport.close();
});

test("a stalled SMTP check has a wall deadline, closes once and absorbs a late verification rejection", async () => {
  let rejectLate, closes = 0;
  const operation = new Promise((_, reject) => { rejectLate = reject; });
  const keepAlive = setTimeout(() => {}, 1000);
  const transport = await createVerificationTransport(mailConfiguration(configured()), {
    verifyTimeoutMilliseconds: 5,
    createTransport: () => ({ verify() { return operation; }, close() { closes += 1; } }),
  });
  try {
    await assert.rejects(transport.verify(), { code: "MAIL_VERIFY_FAILED" });
    await transport.close(); await transport.close();
    assert.equal(closes, 1);
    rejectLate(new Error("private late SMTP failure"));
    await new Promise((resolve) => setImmediate(resolve));
    await assert.rejects(transport.verify(), { code: "MAIL_VERIFY_FAILED" });
  } finally { clearTimeout(keepAlive); await transport.close(); }
});

test("SMTP verification deadline inputs are bounded before creating the transport", async () => {
  for (const verifyTimeoutMilliseconds of [0, -1, 1.5, 30001, NaN, null, "20"]) {
    await assert.rejects(createVerificationTransport(mailConfiguration(configured()), {
      verifyTimeoutMilliseconds, createTransport() { assert.fail("invalid deadline cannot create an SMTP transport"); },
    }), { code: "MAIL_TRANSPORT_CONFIG" });
  }
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

for (const purpose of ["verification", "password-reset"]) {
  test(`${purpose}: expired or replaced lease after claim never starts a transport`, async () => {
    const key = randomBytes(32), failures = [];
    for (const overrides of [{ expiresAt: 1000, leaseUntil: 1000 }, { expiresAt: 2000, leaseUntil: 1000 },
      { expiresAt: undefined }, { leaseUntil: undefined }, { expiresAt: 2000, leaseUntil: 2001 }]) {
      const job = jobFixture(key, overrides);
      if (purpose === "password-reset") job.payloadEncrypted = sealResetPayload({ email, token: newToken() }, key, job.id);
      const result = await runMailBatch({ key, purpose, batchSize: 1, clock: () => 1000, store: {
        async claim() { return job; }, async markFailed(...args) { failures.push(args); return false; }, async prune() {},
      }, transport: { async sendVerification() { assert.fail("expired job must not send"); }, async sendPasswordReset() { assert.fail("expired job must not send"); } } });
      assert.deepEqual(result, { sent: 0, failed: 1 });
    }
    assert.equal(failures.length, 5);
    assert.ok(failures.every(([, , input]) => input.now === 1000 && input.code === "MAIL_DELIVERY_FAILED"));
  });
}

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
