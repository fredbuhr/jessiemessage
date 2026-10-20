import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { createResetService, ResetError } from "../server/reset/service.mjs";
import { newToken, tokenDigest, verifyPassword } from "../server/auth/crypto.mjs";
import { openResetPayload } from "../server/reset/mail-crypto.mjs";

const initialNow = 1750000000000;
const userId = Buffer.alloc(16, 0x27);
const password = "  Exact secret e\u0301 2026!  ";
const hasCode = (code) => (error) => error instanceof ResetError && error.code === code;

async function fixture() {
  const mailKey = randomBytes(32), token = newToken(), calls = [], rates = [];
  const state = { now: initialNow, requested: true, record: { userId, credentialVersion: 7 }, consumed: true,
    rawError: null, rateError: null, rateResults: [], rateHook: null, inspect: null, consume: null };
  const record = (name, options) => { calls.push({ name, options }); if (state.rawError) throw state.rawError; };
  const store = {
    requestReset: async (options) => { record("requestReset", options); return state.requested; },
    inspectReset: async (options) => { record("inspectReset", options); return state.inspect ? state.inspect(options) : state.record; },
    consumeReset: async (options) => { record("consumeReset", options); return state.consume ? state.consume(options) : state.consumed; },
  };
  const authStore = { consumeRateLimit: async (bucket, options) => {
    rates.push({ bucket, options }); if (state.rateError) throw state.rateError;
    if (state.rateHook) await state.rateHook(options, rates.length);
    return state.rateResults.length ? state.rateResults.shift() : { allowed: true, retryAfter: 0 };
  } };
  const options = { store, authStore, mailKey, clock: () => state.now };
  return { options, store, state, mailKey, token, calls, rates, service: await createResetService(options) };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test("recovery service requires an explicit mail key, complete store and safe clock dependency", async () => {
  const f = await fixture();
  for (const mailKey of [undefined, null, "private-key", Buffer.alloc(31), Buffer.alloc(33)]) {
    await assert.rejects(createResetService({ ...f.options, mailKey }), hasCode("RESET_CONFIG"));
  }
  for (const dependency of ["store", "authStore"]) await assert.rejects(createResetService({ ...f.options, [dependency]: null }), hasCode("RESET_CONFIG"));
  for (const method of Object.keys(f.store)) await assert.rejects(createResetService({ ...f.options, store: { ...f.store, [method]: undefined } }), hasCode("RESET_CONFIG"));
  await assert.rejects(createResetService({ ...f.options, authStore: {} }), hasCode("RESET_CONFIG"));
  await assert.rejects(createResetService({ ...f.options, clock: null }), hasCode("RESET_CONFIG"));
  assert.ok(Object.isFrozen(f.service));
});

test("reset requests return only acceptance and put only encrypted mail and token digests in the atomic command", async () => {
  const f = await fixture(), email = "CLIENT@Example.INVALID";
  const result = await f.service.requestReset({ email, peerAddress: "192.0.2.41" });
  assert.deepEqual(result, { status: "accepted" });
  const command = f.calls.at(-1).options;
  assert.deepEqual(Object.keys(command).sort(), ["email", "mail", "now", "reset"]);
  assert.equal(command.email, email.toLowerCase()); assert.equal(command.now, initialNow);
  assert.deepEqual(Object.keys(command.reset).sort(), ["expiresAt", "id", "tokenHash"]);
  assert.ok(Buffer.isBuffer(command.reset.id)); assert.equal(command.reset.id.length, 16);
  assert.ok(Buffer.isBuffer(command.reset.tokenHash)); assert.equal(command.reset.tokenHash.length, 32);
  assert.equal(command.reset.expiresAt, initialNow + 30 * 60000);
  assert.deepEqual(Object.keys(command.mail).sort(), ["id", "payloadEncrypted"]);
  assert.equal(command.mail.id.length, 16);
  const decoded = openResetPayload(command.mail.payloadEncrypted, f.mailKey, command.mail.id);
  assert.equal(decoded.email, email.toLowerCase()); assert.deepEqual(tokenDigest(decoded.token), command.reset.tokenHash);
  assert.equal(JSON.stringify(command).includes(decoded.token), false);
  for (const secret of [decoded.token, email, email.toLowerCase(), "password", "session", "userId"]) assert.equal(JSON.stringify(result).includes(secret), false);
  assert.equal(f.calls.some((call) => call.name !== "requestReset"), false);
});

test("reset requests start the complete link lifetime after a suspended quota finishes", async () => {
  const f = await fixture(), entered = deferred(), resume = deferred(), current = initialNow + 2 * 3600000;
  f.state.rateHook = async (_options, count) => { if (count === 1) { entered.resolve(); await resume.promise; } };
  const pending = f.service.requestReset({ email: "client@example.invalid" });
  await entered.promise; f.state.now = current; resume.resolve();
  assert.deepEqual(await pending, { status: "accepted" });
  assert.deepEqual(f.rates.map(({ options }) => options.now), [initialNow, initialNow]);
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].name, "requestReset");
  assert.equal(f.calls[0].options.now, current); assert.equal(f.calls[0].options.reset.expiresAt, current + 30 * 60000);
});

test("a clock that becomes invalid or overflows link lifetime during quotas cannot enqueue reset mail", async () => {
  for (const current of [NaN, -1, 1.5, 253402300800000, 253402300799999]) {
    const f = await fixture(), entered = deferred(), resume = deferred();
    f.state.rateHook = async (_options, count) => { if (count === 1) { entered.resolve(); await resume.promise; } };
    const pending = f.service.requestReset({ email: "client@example.invalid" });
    await entered.promise; f.state.now = current; resume.resolve();
    await assert.rejects(pending, hasCode("RESET_UNAVAILABLE"));
    assert.equal(f.rates.length, 2); assert.equal(f.calls.length, 0);
  }
});

test("unknown and ineligible accounts receive the same acceptance while malformed canonical email never queues a mail", async () => {
  const f = await fixture();
  f.state.requested = false;
  assert.deepEqual(await f.service.requestReset({ email: "unknown@example.invalid" }), { status: "accepted" });
  const first = f.calls.at(-1).options;
  assert.equal(openResetPayload(first.mail.payloadEncrypted, f.mailKey, first.mail.id).email, "unknown@example.invalid");
  const before = f.calls.length;
  for (const email of ["missing-at", "client@localhost", " client@example.invalid", "client@example.invalid ", "a..b@example.invalid", "é@example.invalid"]) {
    assert.deepEqual(await f.service.requestReset({ email }), { status: "accepted" });
  }
  assert.equal(f.calls.length, before);
});

test("reset service rejects untrusted request shapes and malformed tokens or passwords before SQL or scrypt", async () => {
  const f = await fixture();
  for (const input of [undefined, null, [], {}, { email: "" }, { email: "a".repeat(255) }, { email: "x\ud800@example.invalid" },
    { email: 1 }, { email: "client@example.invalid", userId: userId.toString("hex") }, { email: "client@example.invalid", token: f.token }]) {
    await assert.rejects(f.service.requestReset(input), hasCode("RESET_INPUT"));
  }
  const canonical = Buffer.alloc(32).toString("base64url"), alias = `${canonical.slice(0, -1)}B`;
  for (const token of [undefined, null, "", "A".repeat(42), `${f.token}=`, `${f.token}\n`, alias]) {
    await assert.rejects(f.service.resetPassword({ token, password }), hasCode("RESET_INPUT"));
  }
  for (const value of [undefined, null, 1, "x".repeat(7), "x".repeat(129), `long-password-\ud800`, `long-password-\udc00`]) {
    await assert.rejects(f.service.resetPassword({ token: f.token, password: value }), hasCode("RESET_INPUT"));
  }
  for (const input of [undefined, null, [], {}, { token: f.token, password, userId }, { token: f.token, password, expectedVersion: 7 }]) {
    await assert.rejects(f.service.resetPassword(input), hasCode("RESET_INPUT"));
  }
  assert.equal(f.calls.length, 0); assert.equal(f.rates.length, 0);
});

test("opaque persistent quotas have bounded global, network and normalized account or token scopes", async () => {
  const f = await fixture(), email = "private-client@example.invalid", peerAddress = "192.0.2.99";
  await f.service.requestReset({ email, peerAddress });
  assert.equal(f.rates.length, 2);
  assert.deepEqual(f.rates.map(({ options }) => options), [
    { now: initialNow, windowSeconds: 60, limit: 60,
      network: { bucketHash: f.rates[0].options.network.bucketHash, windowSeconds: 900, limit: 10 } },
    { now: initialNow, windowSeconds: 1800, limit: 3 },
  ]);
  const requestBuckets = [f.rates[0].bucket, f.rates[0].options.network.bucketHash, f.rates[1].bucket].map((value) => Buffer.from(value));
  f.state.record = null;
  await assert.rejects(f.service.resetPassword({ token: f.token, password, peerAddress }), hasCode("RESET_INVALID"));
  assert.deepEqual(f.rates.slice(2).map(({ options }) => options), [
    { now: initialNow, windowSeconds: 60, limit: 60,
      network: { bucketHash: f.rates[2].options.network.bucketHash, windowSeconds: 900, limit: 20 } },
    { now: initialNow, windowSeconds: 900, limit: 5 },
  ]);
  assert.deepEqual(f.rates[2].bucket, requestBuckets[0]);
  assert.equal(new Set(requestBuckets.map((bucket) => bucket.toString("hex"))).size, 3);
  assert.notDeepEqual(f.rates[2].options.network.bucketHash, requestBuckets[1]);
  for (const bucket of f.rates.flatMap((item) => [item.bucket, ...(item.options.network ? [item.options.network.bucketHash] : [])])) {
    assert.ok(Buffer.isBuffer(bucket)); assert.equal(bucket.length, 32);
    for (const secret of [email, peerAddress, f.token]) assert.notDeepEqual(bucket, createHash("sha256").update(secret).digest());
  }
  const json = JSON.stringify(f.rates);
  for (const secret of [email, peerAddress, f.token, password]) assert.equal(json.includes(secret), false);
  await f.service.requestReset({ email: email.toUpperCase(), peerAddress });
  assert.deepEqual(f.rates[5].bucket, requestBuckets[2]);
  const other = await fixture();
  await other.service.requestReset({ email, peerAddress });
  assert.notDeepEqual(other.rates[0].bucket, requestBuckets[0]);
});

test("the global quota rejects before per-identity expansion and never reaches reset lookup or password work", async () => {
  const f = await fixture();
  for (const operation of [() => f.service.requestReset({ email: "client@example.invalid" }),
    () => f.service.resetPassword({ token: f.token, password })]) {
    const before = f.rates.length;
    f.state.rateResults = [{ allowed: false, retryAfter: 37 }];
    await assert.rejects(operation(), (error) => hasCode("RESET_RATE_LIMIT")(error) && error.retryAfter === 37);
    assert.equal(f.rates.length, before + 1);
  }
  assert.equal(f.calls.length, 0);
  f.state.rateResults = [{ allowed: true }, { allowed: false, retryAfter: 19 }];
  await assert.rejects(f.service.requestReset({ email: "client@example.invalid" }), (error) => hasCode("RESET_RATE_LIMIT")(error) && error.retryAfter === 19);
  assert.equal(f.calls.length, 0);
});

test("invalid or consumed links stop at fresh inspection without creating a password hash or calling consume", async () => {
  const f = await fixture(); f.state.record = null;
  await assert.rejects(f.service.resetPassword({ token: f.token, password }), hasCode("RESET_INVALID"));
  assert.deepEqual(f.calls.map((call) => call.name), ["inspectReset"]);
  assert.deepEqual(f.calls[0].options, { tokenHash: tokenDigest(f.token), now: initialNow });
});

test("password length boundaries preserve the shared policy while corrupt current proof fails before hashing", async () => {
  const f = await fixture(); f.state.record = null;
  for (const value of ["x".repeat(8), "x".repeat(13), "é".repeat(128), "😀".repeat(64), " ".repeat(8)]) {
    await assert.rejects(f.service.resetPassword({ token: f.token, password: value }), hasCode("RESET_INVALID"));
  }
  for (const proof of [undefined, false, {}, { userId: Buffer.alloc(15), credentialVersion: 7 },
    { userId, credentialVersion: "7" }, { userId, credentialVersion: 0 }, { userId, credentialVersion: 4294967295 }]) {
    f.state.record = proof;
    await assert.rejects(f.service.resetPassword({ token: f.token, password }), hasCode("RESET_UNAVAILABLE"));
  }
  assert.equal(f.calls.some((call) => call.name === "consumeReset"), false);
});

test("malformed backend acknowledgments and quota records cannot report successful recovery", async () => {
  const f = await fixture();
  for (const result of [undefined, null, 1, "true", { status: "accepted" }]) {
    f.state.requested = result;
    await assert.rejects(f.service.requestReset({ email: "client@example.invalid" }), hasCode("RESET_UNAVAILABLE"));
  }
  const before = f.calls.length;
  for (const result of [null, {}, { allowed: "true" }, { allowed: 1 }]) {
    f.state.rateResults = [result];
    await assert.rejects(f.service.requestReset({ email: "client@example.invalid" }), hasCode("RESET_UNAVAILABLE"));
  }
  assert.equal(f.calls.length, before);
  for (const [retryAfter, expected] of [[-4, 1], [2.1, 3], [999999, 3600], [undefined, 60]]) {
    f.state.rateResults = [{ allowed: false, retryAfter }];
    await assert.rejects(f.service.requestReset({ email: "client@example.invalid" }),
      (error) => hasCode("RESET_RATE_LIMIT")(error) && error.retryAfter === expected);
  }
});

test("successful reset hashes the exact password and passes only current inspected proof to atomic consumption", async () => {
  const f = await fixture();
  const result = await f.service.resetPassword({ token: f.token, password, peerAddress: "192.0.2.42" });
  assert.deepEqual(result, { status: "password_changed" });
  assert.deepEqual(f.calls.map((call) => call.name), ["inspectReset", "consumeReset"]);
  const command = f.calls[1].options;
  assert.deepEqual(Object.keys(command).sort(), ["expectedUserId", "expectedVersion", "now", "passwordHash", "tokenHash"]);
  assert.deepEqual(command.tokenHash, tokenDigest(f.token)); assert.deepEqual(command.expectedUserId, userId); assert.equal(command.expectedVersion, 7);
  assert.match(command.passwordHash, /^\$scrypt\$v1\$N=131072,r=8,p=1\$/);
  assert.equal(await verifyPassword(password, command.passwordHash), true);
  assert.equal(await verifyPassword(password.trim(), command.passwordHash), false);
  assert.equal(await verifyPassword(password.normalize("NFC"), command.passwordHash), false);
  assert.equal(JSON.stringify(command).includes(password), false);
  for (const secret of [f.token, password, command.passwordHash, "userId", "session", "access"]) assert.equal(JSON.stringify(result).includes(secret), false);
});

test("reset re-samples time after hashing and a failed current-state compare cannot report success", async () => {
  const f = await fixture();
  f.state.inspect = () => { f.state.now = initialNow + 31 * 60000; return { userId, credentialVersion: 7 }; };
  f.state.consumed = false;
  await assert.rejects(f.service.resetPassword({ token: f.token, password }), hasCode("RESET_INVALID"));
  assert.equal(f.calls[0].options.now, initialNow);
  assert.equal(f.calls[1].options.now, initialNow + 31 * 60000);
});

test("an invalid current clock or overflowing recovery deadline cannot enqueue a link or consume a token", async () => {
  const f = await fixture();
  for (const now of [-1, NaN, 1.5, 253402300800000, Number.MAX_SAFE_INTEGER]) {
    f.state.now = now;
    await assert.rejects(f.service.requestReset({ email: "client@example.invalid" }), hasCode("RESET_UNAVAILABLE"));
    await assert.rejects(f.service.resetPassword({ token: f.token, password }), hasCode("RESET_UNAVAILABLE"));
  }
  f.state.now = 253402300799999;
  await assert.rejects(f.service.requestReset({ email: "client@example.invalid" }), hasCode("RESET_UNAVAILABLE"));
  assert.equal(f.calls.length, 0);
});

test("backend and quota failures never expose SQL, email, password, token or nested causes", async () => {
  const f = await fixture(), privateMessage = `SQL private-client@example.invalid password=${password} token=${f.token}`;
  const safeUnavailable = (error) => {
    assert.ok(hasCode("RESET_UNAVAILABLE")(error)); assert.equal(error.cause, undefined);
    for (const secret of ["SQL", "private-client@example.invalid", password, f.token]) assert.equal(error.message.includes(secret), false);
    return true;
  };
  f.state.rawError = Object.assign(new Error(privateMessage), { code: "ER_PRIVATE_DATABASE_ERROR" });
  await assert.rejects(f.service.requestReset({ email: "client@example.invalid" }), safeUnavailable);
  await assert.rejects(f.service.resetPassword({ token: f.token, password }), safeUnavailable);
  f.state.rawError = null; f.state.rateError = Object.assign(new Error(privateMessage), { code: "ER_PRIVATE_QUOTA_ERROR" });
  await assert.rejects(f.service.requestReset({ email: "client@example.invalid" }), safeUnavailable);
});

test("recovery copies the supplied mail key so external mutation cannot corrupt queued mail", async () => {
  const f = await fixture(), original = Buffer.from(f.mailKey);
  f.mailKey.fill(0);
  await f.service.requestReset({ email: "client@example.invalid" });
  const command = f.calls.at(-1).options;
  assert.equal(openResetPayload(command.mail.payloadEncrypted, original, command.mail.id).email, "client@example.invalid");
});
