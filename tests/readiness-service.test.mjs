import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { newToken } from "../server/auth/crypto.mjs";
import { SITE_CONTACT_EMAIL } from "../server/site.mjs";
import { createReadinessService, ReadinessError } from "../server/readiness/service.mjs";

const now = 1750000000000;
const adminId = "11".repeat(16);
const hasCode = (code) => (error) => error instanceof ReadinessError && error.code === code;
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const features = () => ({ clientAccess: true, chat: true, photos: true, clientFiles: true, passwordRecovery: true, broadcasts: true });
const operationsView = () => ({ status: "unavailable", database: { state: "starting", checkedAt: null }, workers: [], queues: [], queuesCheckedAt: null });
const mail = () => ({ enabled: true, origin: "https://jessiemessage.com", key: randomBytes(32), smtp: {
  host: "private-smtp.example.invalid", port: 587, user: "private-smtp-user", password: "private-smtp-password",
  from: SITE_CONTACT_EMAIL, replyTo: SITE_CONTACT_EMAIL, caPath: "/private/smtp-ca.pem",
} });

async function fixture(overrides = {}) {
  const token = newToken(), key = randomBytes(32), sessionCalls = [], rateCalls = [], transports = [], events = [];
  const state = {
    now, session: { user: { id: adminId, role: "admin", pseudonym: "Jessie", email: "private-admin@example.invalid", mfaVersion: "private-mfa-version" },
      csrf: newToken(), expiresAt: now + 60000, tokenHash: "private-token-proof" },
    authError: null, sessionHook: null, rateError: null, rateHook: null, rateResults: [], factoryError: null, factoryHook: null,
    verifyHook: async () => true, closeHook: null,
  };
  const authService = { session: async (raw) => {
    sessionCalls.push(raw); events.push("session");
    if (state.sessionHook) await state.sessionHook();
    if (state.authError) throw state.authError;
    return state.session === null ? null : structuredClone(state.session);
  } };
  const authStore = { consumeRateLimit: async (bucket, options) => {
    rateCalls.push({ bucket: Buffer.from(bucket), options: { ...options } }); events.push("rate");
    if (state.rateHook) await state.rateHook();
    if (state.rateError) throw state.rateError;
    return state.rateResults.length ? state.rateResults.shift() : { allowed: true, retryAfter: 0 };
  } };
  const createTransport = async (config) => {
    events.push("factory");
    if (state.factoryError) throw state.factoryError;
    if (state.factoryHook) await state.factoryHook();
    const transport = { config, verified: 0, closed: 0, sent: 0,
      verify: async () => { events.push("verify"); transport.verified++; return state.verifyHook(); },
      close: async () => { events.push("close"); transport.closed++; if (state.closeHook) await state.closeHook(); },
      sendMail: async () => { transport.sent++; throw new Error("Readiness must never send mail."); },
    };
    transports.push(transport); return transport;
  };
  const options = { authService, authStore, mailConfig: mail(), features: features(), key, createTransport, clock: () => state.now, ...overrides };
  const service = await createReadinessService(options);
  return { token, key, state, sessionCalls, rateCalls, transports, events, options, service };
}

test("readiness service requires explicit dependencies, a 32-byte key and six boolean feature declarations", async () => {
  const f = await fixture();
  for (const key of [undefined, null, f.key.toString("hex"), Buffer.alloc(31), Buffer.alloc(33)]) {
    await assert.rejects(createReadinessService({ ...f.options, key }), hasCode("READINESS_CONFIG"));
  }
  for (const authService of [null, {}, { session: true }]) await assert.rejects(createReadinessService({ ...f.options, authService }), hasCode("READINESS_CONFIG"));
  for (const authStore of [null, {}, { consumeRateLimit: true }]) await assert.rejects(createReadinessService({ ...f.options, authStore }), hasCode("READINESS_CONFIG"));
  for (const value of [null, {}, [], "enabled"]) await assert.rejects(createReadinessService({ ...f.options, features: value }), hasCode("READINESS_CONFIG"));
  for (const name of Object.keys(features())) for (const value of [undefined, null, 0, 1, "true"]) {
    await assert.rejects(createReadinessService({ ...f.options, features: { ...features(), [name]: value } }), hasCode("READINESS_CONFIG"));
  }
  for (const mailConfig of [undefined, null, {}, { enabled: "1" }, { enabled: true }, { enabled: true, smtp: {} }]) {
    await assert.rejects(createReadinessService({ ...f.options, mailConfig }), hasCode("READINESS_CONFIG"));
  }
  for (const clock of [null, 1]) await assert.rejects(createReadinessService({ ...f.options, clock }), hasCode("READINESS_CONFIG"));
  for (const createTransport of [null, 1]) await assert.rejects(createReadinessService({ ...f.options, createTransport }), hasCode("READINESS_CONFIG"));
  assert.ok(Object.isFrozen(f.service));
});

test("malformed tokens are rejected without querying session state or allocating a transport", async () => {
  const f = await fixture();
  for (const token of [undefined, null, "", "A".repeat(42), `${f.token}=`, `${f.token}\n`, `${f.token}\r`, Buffer.alloc(32)]) {
    await assert.rejects(f.service.actor(token), hasCode("READINESS_UNAUTHORIZED"));
    await assert.rejects(f.service.verifySmtp(token), hasCode("READINESS_UNAUTHORIZED"));
  }
  assert.equal(f.sessionCalls.length, 0); assert.equal(f.rateCalls.length, 0); assert.equal(f.transports.length, 0);
});

test("only a current administrator can read progress or initiate verification", async () => {
  const f = await fixture();
  f.state.session = null;
  await assert.rejects(f.service.summary(f.token), hasCode("READINESS_UNAUTHORIZED"));
  await assert.rejects(f.service.verifySmtp(f.token), hasCode("READINESS_UNAUTHORIZED"));
  f.state.session = { user: { id: adminId, role: "client", pseudonym: "Synthetic client" }, csrf: newToken(), expiresAt: now + 60000 };
  await assert.rejects(f.service.actor(f.token), hasCode("READINESS_UNAUTHORIZED"));
  await assert.rejects(f.service.verifySmtp(f.token), hasCode("READINESS_UNAUTHORIZED"));
  f.state.authError = Object.assign(new Error("private-revocation-details"), { code: "AUTH_INVALID" });
  await assert.rejects(f.service.summary(f.token), hasCode("READINESS_UNAUTHORIZED"));
  assert.equal(f.rateCalls.length, 0); assert.equal(f.transports.length, 0);
});

test("malformed administrator proof is unavailable and private principal fields never enter actor DTOs", async () => {
  const f = await fixture(), good = structuredClone(f.state.session), actor = await f.service.actor(f.token);
  assert.deepEqual(actor, { user: { id: adminId, role: "admin", pseudonym: "Jessie" }, csrf: good.csrf, expiresAt: good.expiresAt });
  assert.equal(JSON.stringify(actor).includes("private-"), false);
  for (const id of [undefined, "AA".repeat(16), `${adminId}\n`, "invalid"]) {
    f.state.session = { ...good, user: { ...good.user, id } };
    await assert.rejects(f.service.actor(f.token), hasCode("READINESS_UNAVAILABLE"));
  }
  for (const csrf of [undefined, "", "A".repeat(42), `${good.csrf}\n`, `${good.csrf}=`]) {
    f.state.session = { ...good, csrf };
    await assert.rejects(f.service.actor(f.token), hasCode("READINESS_UNAVAILABLE"));
  }
  for (const expiresAt of [undefined, null, -1, NaN, Infinity, 1.5, 253402300800000]) {
    f.state.session = { ...good, expiresAt };
    await assert.rejects(f.service.actor(f.token), hasCode("READINESS_UNAVAILABLE"));
  }
  for (const pseudonym of [undefined, null, "x".repeat(65), "\ud800"]) {
    f.state.session = { ...good, user: { ...good.user, pseudonym } };
    await assert.rejects(f.service.actor(f.token), hasCode("READINESS_UNAVAILABLE"));
  }
  assert.equal(f.rateCalls.length, 0); assert.equal(f.transports.length, 0);
});

test("readiness summary is a strict progress inventory without SMTP secrets or an invented delivery result", async () => {
  const f = await fixture(), summary = await f.service.summary(f.token);
  assert.deepEqual(summary, { contactEmail: SITE_CONTACT_EMAIL,
    mail: { configured: true, sender: SITE_CONTACT_EMAIL, replyTo: SITE_CONTACT_EMAIL }, features: features(),
    checks: { ageAssurance: "pending", smtpDelivery: "not_checked", deviceAcceptance: "pending" } });
  const json = JSON.stringify(summary);
  for (const secret of [f.token, adminId, "private-", "smtp.host", '"password":', "caPath", f.options.mailConfig.key.toString("base64url")]) assert.equal(json.includes(secret), false);
  assert.equal(f.transports.length, 0);
  f.state.session = null;
  await assert.rejects(f.service.summary(f.token), hasCode("READINESS_UNAUTHORIZED"));
  assert.equal(f.sessionCalls.length, 3);
});

test("disabled mail and disabled features remain explicit metadata without creating an SMTP transport", async () => {
  const disabled = Object.fromEntries(Object.keys(features()).map((name) => [name, false]));
  const f = await fixture({ mailConfig: { enabled: false }, features: disabled });
  const summary = await f.service.summary(f.token);
  assert.deepEqual(summary.mail, { configured: false, sender: SITE_CONTACT_EMAIL, replyTo: SITE_CONTACT_EMAIL });
  assert.deepEqual(summary.features, disabled);
  assert.deepEqual(summary.checks, { ageAssurance: "pending", smtpDelivery: "not_checked", deviceAcceptance: "pending" });
  await assert.rejects(f.service.verifySmtp(f.token), hasCode("READINESS_MAIL_DISABLED"));
  assert.equal(f.transports.length, 0);
});

test("caller mutations cannot change captured feature declarations, mail identity or transport credentials", async () => {
  const f = await fixture(), originalMailKey = Buffer.from(f.options.mailConfig.key);
  f.options.features.photos = false;
  f.options.mailConfig.enabled = false;
  f.options.mailConfig.smtp.from = "changed@example.invalid";
  f.options.mailConfig.smtp.replyTo = "changed@example.invalid";
  f.options.mailConfig.smtp.password = "private-replacement-password";
  f.options.mailConfig.key.fill(0);
  const summary = await f.service.summary(f.token);
  assert.equal(summary.features.photos, true); assert.equal(summary.mail.configured, true); assert.equal(summary.mail.sender, SITE_CONTACT_EMAIL);
  summary.features.photos = false;
  assert.equal((await f.service.summary(f.token)).features.photos, true);
  await f.service.verifySmtp(f.token);
  assert.equal(f.transports[0].config.smtp.password, "private-smtp-password");
  assert.equal(f.transports[0].config.smtp.from, SITE_CONTACT_EMAIL);
  assert.deepEqual(f.transports[0].config.key, originalMailKey);
});

test("summary quotas are persistent, administrator scoped and opaque, using a private copy of the key", async () => {
  const f = await fixture();
  await f.service.summary(f.token);
  assert.equal(f.rateCalls.length, 2);
  assert.deepEqual(f.rateCalls[0].options, { now, windowSeconds: 60, limit: 240 });
  assert.deepEqual(f.rateCalls[1].options, { now, windowSeconds: 60, limit: 60 });
  const original = f.rateCalls.map(({ bucket }) => Buffer.from(bucket));
  assert.notDeepEqual(original[0], original[1]);
  f.key.fill(0); await f.service.summary(f.token);
  assert.deepEqual(f.rateCalls[2].bucket, original[0]); assert.deepEqual(f.rateCalls[3].bucket, original[1]);
  f.state.session.user.id = "22".repeat(16); await f.service.summary(f.token);
  assert.deepEqual(f.rateCalls[4].bucket, original[0]); assert.notDeepEqual(f.rateCalls[5].bucket, original[1]);
  for (const { bucket } of f.rateCalls) { assert.ok(Buffer.isBuffer(bucket)); assert.equal(bucket.length, 32); }
  const json = JSON.stringify(f.rateCalls);
  for (const secret of [f.token, adminId, "private-admin@example.invalid", "private-smtp"]) assert.equal(json.includes(secret), false);
});

test("SMTP quotas differ from summary quotas and stop verification before transport allocation", async () => {
  const f = await fixture();
  await f.service.summary(f.token); await f.service.verifySmtp(f.token);
  assert.deepEqual(f.rateCalls[2].options, { now, windowSeconds: 60, limit: 10 });
  assert.deepEqual(f.rateCalls[3].options, { now, windowSeconds: 900, limit: 3 });
  assert.notDeepEqual(f.rateCalls[0].bucket, f.rateCalls[2].bucket); assert.notDeepEqual(f.rateCalls[1].bucket, f.rateCalls[3].bucket);
  f.state.rateResults = [{ allowed: false, retryAfter: 37 }];
  await assert.rejects(f.service.verifySmtp(f.token), (error) => hasCode("READINESS_RATE_LIMIT")(error) && error.retryAfter === 37);
  assert.equal(f.transports.length, 1);
  f.state.rateResults = [{ allowed: false, retryAfter: 11 }];
  await assert.rejects(f.service.summary(f.token), (error) => hasCode("READINESS_RATE_LIMIT")(error) && error.retryAfter === 11);
});

for (const operation of ["summary", "verifySmtp"]) for (const loss of ["revoked", "expired"]) {
  test(`${operation} rejects a session ${loss} while its final quota waits before returning inventory or allocating SMTP`, async () => {
    const f = await fixture(), started = deferred(), release = deferred();
    f.state.rateHook = async () => {
      if (f.rateCalls.length === 2) { started.resolve(); await release.promise; }
    };
    // The real authentication service checks its current clock on every read;
    // this hook models expiry without returning an already invalid proof.
    f.state.sessionHook = async () => {
      if (f.state.session && f.state.session.expiresAt <= f.state.now) throw Object.assign(new Error("Expired session."), { code: "AUTH_INVALID" });
    };
    const pending = assert.rejects(f.service[operation](f.token), hasCode("READINESS_UNAUTHORIZED"));
    await started.promise;
    assert.equal(f.sessionCalls.length, 1); assert.equal(f.rateCalls.length, 2); assert.equal(f.transports.length, 0);
    if (loss === "revoked") f.state.session = null;
    else f.state.now = f.state.session.expiresAt;
    release.resolve(); await pending;
    assert.equal(f.transports.length, 0); assert.equal(f.events.includes("factory"), false); assert.equal(f.events.includes("verify"), false);
    assert.ok(f.sessionCalls.length >= 2);
    // A rejected diagnostic must release its reserved slot for a later, valid intent.
    f.state.now = now; f.state.session = { user: { id: adminId, role: "admin", pseudonym: "Jessie" }, csrf: newToken(), expiresAt: now + 60000 };
    assert.equal((await f.service.verifySmtp(f.token)).status, "verified");
    assert.equal(f.transports.length, 1); assert.equal(f.transports[0].closed, 1);
  });
}

test("the diagnostic slot stays reserved while its post-quota session proof waits", async () => {
  const f = await fixture(), started = deferred(), release = deferred();
  f.state.sessionHook = async () => {
    if (f.sessionCalls.length === 2) { started.resolve(); await release.promise; }
  };
  const first = f.service.verifySmtp(f.token); await started.promise;
  await assert.rejects(f.service.verifySmtp(f.token), (error) => hasCode("READINESS_BUSY")(error) && error.retryAfter === 5);
  assert.equal(f.transports.length, 0); assert.equal(f.rateCalls.length, 2);
  release.resolve(); assert.equal((await first).status, "verified");
  assert.equal(f.transports.length, 1); assert.equal(f.transports[0].verified, 1); assert.equal(f.transports[0].closed, 1);
});

for (const operation of ["summary", "verifySmtp"]) {
  test(`closing during ${operation}'s post-quota session proof withholds inventory and cannot allocate SMTP`, async () => {
    const f = await fixture(), started = deferred(), release = deferred();
    f.state.sessionHook = async () => {
      if (f.sessionCalls.length === 2) { started.resolve(); await release.promise; }
    };
    const pending = assert.rejects(f.service[operation](f.token), hasCode("READINESS_UNAVAILABLE")); await started.promise;
    const closing = f.service.close(); release.resolve(); await closing; await pending;
    assert.equal(f.transports.length, 0); assert.equal(f.events.includes("factory"), false);
    await assert.rejects(f.service.verifySmtp(f.token), hasCode("READINESS_UNAVAILABLE"));
  });
}

test("SMTP success uses a fresh verification-only transport, closes it and rechecks the session before issuing proof", async () => {
  const f = await fixture();
  const proof = await f.service.verifySmtp(f.token);
  assert.deepEqual(proof, { status: "verified", checkedAt: now, scope: "smtp_authentication", delivery: "not_checked" });
  assert.equal(f.transports.length, 1); assert.equal(f.transports[0].verified, 1); assert.equal(f.transports[0].closed, 1); assert.equal(f.transports[0].sent, 0);
  assert.equal(f.sessionCalls.length, 3); assert.ok(f.sessionCalls.every((raw) => raw === f.token));
  assert.deepEqual(f.events.slice(0, 5), ["session", "rate", "rate", "session", "factory"]);
  assert.ok(f.events.lastIndexOf("session") > f.events.lastIndexOf("close"));
  await f.service.verifySmtp(f.token);
  assert.equal(f.transports.length, 2); assert.notEqual(f.transports[0], f.transports[1]);
  assert.ok(f.transports.every((transport) => transport.closed === 1 && transport.verified === 1 && transport.sent === 0));
  assert.equal(JSON.stringify(proof).includes("private-"), false);
});

test("only a literal true verification result can yield SMTP authentication proof", async () => {
  const f = await fixture();
  for (const result of [false, undefined, null, 1, "true", {}, { accepted: true }]) {
    f.state.verifyHook = async () => result;
    await assert.rejects(f.service.verifySmtp(f.token), hasCode("READINESS_SMTP_FAILED"));
    assert.equal(f.transports.at(-1).closed, 1); assert.equal(f.transports.at(-1).sent, 0);
  }
  f.state.verifyHook = async () => true;
  assert.equal((await f.service.verifySmtp(f.token)).status, "verified");
});

test("SMTP errors are neutral, close their transport and release the service busy state", async () => {
  const f = await fixture();
  f.state.verifyHook = async () => { throw Object.assign(new Error("private-smtp.example.invalid password=private-password admin@example.invalid"), { code: "MAIL_VERIFY_FAILED", response: "private-transcript" }); };
  await assert.rejects(f.service.verifySmtp(f.token), (error) => {
    assert.ok(hasCode("READINESS_SMTP_FAILED")(error)); assert.equal(error.cause, undefined);
    assert.equal(error.message.includes("private-"), false); assert.equal(error.response, undefined); return true;
  });
  assert.equal(f.transports[0].closed, 1);
  f.state.verifyHook = async () => true;
  assert.equal((await f.service.verifySmtp(f.token)).status, "verified");
});

test("one in-flight verification blocks another even while its asynchronous factory is still pending", async () => {
  const f = await fixture(), started = deferred(), release = deferred();
  f.state.factoryHook = async () => { started.resolve(); await release.promise; };
  const first = f.service.verifySmtp(f.token); await started.promise;
  try {
    await assert.rejects(f.service.verifySmtp(f.token), (error) => hasCode("READINESS_BUSY")(error) && error.retryAfter === 5);
    assert.equal(f.transports.length, 0); assert.equal(f.events.filter((event) => event === "factory").length, 1);
  } finally { release.resolve(); }
  assert.equal((await first).status, "verified"); assert.equal(f.transports[0].closed, 1);
});

test("factory and cleanup failures cannot leave verification permanently busy or expose backend details", async () => {
  const f = await fixture();
  f.state.factoryError = new Error("private-factory-password");
  await assert.rejects(f.service.verifySmtp(f.token), (error) => {
    assert.ok(hasCode("READINESS_UNAVAILABLE")(error)); assert.equal(error.cause, undefined); assert.equal(error.message.includes("private-"), false); return true;
  });
  f.state.factoryError = null;
  f.state.verifyHook = async () => { throw Object.assign(new Error("private-verification-password"), { code: "MAIL_VERIFY_FAILED" }); };
  f.state.closeHook = async () => { throw new Error("private-close-password"); };
  await assert.rejects(f.service.verifySmtp(f.token), (error) => {
    assert.ok(error instanceof ReadinessError); assert.equal(error.cause, undefined); assert.equal(error.message.includes("private-"), false); return true;
  });
  assert.equal(f.transports.at(-1).closed, 1);
  f.state.verifyHook = async () => true;
  await assert.rejects(f.service.verifySmtp(f.token), hasCode("READINESS_UNAVAILABLE"));
  assert.equal(f.transports.at(-1).closed, 1);
  f.state.closeHook = null; f.state.verifyHook = async () => true;
  assert.equal((await f.service.verifySmtp(f.token)).status, "verified");
});

test("administrator revocation during SMTP verification discards the network result after cleanup", async () => {
  const f = await fixture(), started = deferred(), release = deferred();
  f.state.verifyHook = async () => { started.resolve(); await release.promise; return true; };
  const pending = f.service.verifySmtp(f.token); await started.promise;
  f.state.session = null; release.resolve();
  await assert.rejects(pending, hasCode("READINESS_UNAUTHORIZED"));
  assert.equal(f.transports[0].closed, 1); assert.equal(f.sessionCalls.length, 3);
  assert.ok(f.events.lastIndexOf("session") > f.events.lastIndexOf("close"));
});

test("revocation during failed transport cleanup takes precedence over a successful network result", async () => {
  const f = await fixture();
  f.state.closeHook = async () => { f.state.session = null; throw new Error("private-close-password"); };
  await assert.rejects(f.service.verifySmtp(f.token), hasCode("READINESS_UNAUTHORIZED"));
  assert.equal(f.transports[0].closed, 1); assert.equal(f.sessionCalls.length, 3);
});

test("session backend errors and malformed persistent rate results remain sanitized and cannot reach SMTP", async () => {
  const f = await fixture();
  f.state.authError = new Error("private-session-database-password");
  await assert.rejects(f.service.summary(f.token), (error) => hasCode("READINESS_UNAVAILABLE")(error) && !error.message.includes("private-") && error.cause === undefined);
  f.state.authError = null;
  for (const result of [null, {}, { allowed: "true" }]) {
    f.state.rateResults = [result];
    await assert.rejects(f.service.verifySmtp(f.token), hasCode("READINESS_UNAVAILABLE"));
  }
  f.state.rateError = new Error("private-rate-database-password");
  await assert.rejects(f.service.verifySmtp(f.token), (error) => hasCode("READINESS_UNAVAILABLE")(error) && !error.message.includes("private-") && error.cause === undefined);
  assert.equal(f.transports.length, 0);
});

test("invalid sampled clocks cannot produce progress or SMTP proof", async () => {
  const f = await fixture();
  for (const value of [-1, NaN, Infinity, 1.5, 253402300800000]) {
    f.state.now = value;
    await assert.rejects(f.service.summary(f.token), hasCode("READINESS_UNAVAILABLE"));
    await assert.rejects(f.service.verifySmtp(f.token), hasCode("READINESS_UNAVAILABLE"));
  }
  assert.equal(f.rateCalls.length, 0); assert.equal(f.transports.length, 0);
});

test("a clock that becomes invalid while verification runs cannot stamp a successful proof", async () => {
  const f = await fixture();
  f.state.verifyHook = async () => { f.state.now = NaN; return true; };
  await assert.rejects(f.service.verifySmtp(f.token), hasCode("READINESS_UNAVAILABLE"));
  assert.equal(f.transports[0].closed, 1); assert.equal(f.sessionCalls.length, 3);
  f.state.now = now;
  f.state.verifyHook = async () => true;
  assert.equal((await f.service.verifySmtp(f.token)).checkedAt, now);
});

test("readiness close is idempotent and rejects new diagnostics before session, quota or transport work", async () => {
  const f = await fixture(), first = f.service.close();
  assert.equal(f.service.close(), first); await first;
  await assert.rejects(f.service.verifySmtp(f.token), hasCode("READINESS_UNAVAILABLE"));
  assert.equal(f.sessionCalls.length, 0); assert.equal(f.rateCalls.length, 0); assert.equal(f.transports.length, 0);
});

test("readiness close immediately closes the active diagnostic and never returns its result as proof", async () => {
  const f = await fixture(), started = deferred(), verification = deferred();
  f.state.verifyHook = async () => { started.resolve(); return verification.promise; };
  f.state.closeHook = async () => { verification.reject(new Error("private-shutdown-smtp-details")); };
  const pending = assert.rejects(f.service.verifySmtp(f.token), hasCode("READINESS_UNAVAILABLE")); await started.promise;
  const closing = f.service.close(); assert.equal(f.transports[0].closed, 1);
  await closing; await pending;
  assert.equal(f.transports[0].closed, 1); assert.equal(f.sessionCalls.length, 2);
  await assert.rejects(f.service.verifySmtp(f.token), hasCode("READINESS_UNAVAILABLE"));
  assert.equal(f.transports.length, 1);
});

test("closing during factory work waits for the late transport then closes it without verifying", async () => {
  const f = await fixture(), started = deferred(), release = deferred();
  f.state.factoryHook = async () => { started.resolve(); await release.promise; };
  const pending = assert.rejects(f.service.verifySmtp(f.token), hasCode("READINESS_UNAVAILABLE")); await started.promise;
  let drained = false; const closing = f.service.close(); void closing.then(() => { drained = true; });
  await Promise.resolve(); assert.equal(drained, false);
  await assert.rejects(f.service.verifySmtp(f.token), hasCode("READINESS_UNAVAILABLE"));
  release.resolve(); await closing; await pending;
  assert.equal(drained, true); assert.equal(f.transports.length, 1); assert.equal(f.transports[0].closed, 1); assert.equal(f.transports[0].verified, 0);
});

test("closing during quota acquisition stops subsequent budgets and cannot allocate SMTP", async () => {
  const started = deferred(), release = deferred(); let budgets = 0;
  const f = await fixture({ authStore: { consumeRateLimit: async () => { budgets += 1; started.resolve(); await release.promise; return { allowed: true }; } } });
  const pending = assert.rejects(f.service.verifySmtp(f.token), hasCode("READINESS_UNAVAILABLE")); await started.promise;
  const closing = f.service.close(); release.resolve(); await closing; await pending;
  assert.equal(budgets, 1); assert.equal(f.transports.length, 0);
});

test("shutdown shares an already running cleanup and waits for it exactly once", async () => {
  const f = await fixture(), started = deferred(), release = deferred();
  f.state.closeHook = async () => { started.resolve(); await release.promise; };
  const pending = assert.rejects(f.service.verifySmtp(f.token), hasCode("READINESS_UNAVAILABLE")); await started.promise;
  let drained = false; const closing = f.service.close(); void closing.then(() => { drained = true; });
  await Promise.resolve(); assert.equal(drained, false); assert.equal(f.transports[0].closed, 1);
  release.resolve(); await closing; await pending;
  assert.equal(f.transports[0].closed, 1); assert.equal(f.sessionCalls.length, 2);
});

test("late transport cleanup failures during shutdown are sanitized and do not produce verification proof", async () => {
  const f = await fixture(), started = deferred(), release = deferred();
  f.state.factoryHook = async () => { started.resolve(); await release.promise; };
  f.state.closeHook = async () => { throw new Error("private-smtp-password-and-transcript"); };
  const pending = assert.rejects(f.service.verifySmtp(f.token), hasCode("READINESS_UNAVAILABLE")); await started.promise;
  const closing = assert.rejects(f.service.close(), (error) => hasCode("READINESS_UNAVAILABLE")(error)
    && error.cause === undefined && !error.message.includes("private-"));
  release.resolve(); await closing; await pending;
  assert.equal(f.transports[0].closed, 1); assert.equal(f.transports[0].verified, 0);
});

test("operations are cached metadata read only after current administrator proofs and quotas", async () => {
  let reads = 0;
  const f = await fixture({ operations: { snapshot() { reads++; return { ...operationsView(), secret: "private" }; } } });
  const result = await f.service.summary(f.token);
  assert.deepEqual(result.operations, operationsView()); assert.equal(reads, 1);
  assert.equal(f.transports.length, 0); assert.equal(f.rateCalls.length, 2);
  f.state.session = null;
  await assert.rejects(f.service.summary(f.token), hasCode("READINESS_UNAUTHORIZED")); assert.equal(reads, 1);
});

test("a session revoked during quota storage cannot read cached operational details", async () => {
  let reads = 0;
  const f = await fixture({ operations: { snapshot() { reads++; return operationsView(); } } });
  f.state.rateHook = async () => { f.state.session = null; };
  await assert.rejects(f.service.summary(f.token), hasCode("READINESS_UNAUTHORIZED"));
  assert.equal(reads, 0);
});

test("invalid or failing operational providers never expose their exception or raw snapshot", async () => {
  for (const operations of [undefined, {}, { snapshot: 1 }]) {
    if (operations === undefined) continue;
    const f = await fixture();
    await assert.rejects(createReadinessService({ ...f.options, operations }), hasCode("READINESS_CONFIG"));
  }
  for (const read of [() => { throw new Error("SQL private-secret"); }, () => ({ ...operationsView(), status: "ready" })]) {
    const f = await fixture({ operations: { snapshot: read } });
    await assert.rejects(f.service.summary(f.token), (error) => hasCode("READINESS_UNAVAILABLE")(error) && !error.message.includes("private-secret"));
  }
});
