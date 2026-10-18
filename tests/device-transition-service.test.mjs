import test from "node:test";
import assert from "node:assert/strict";
import { createDeviceTransitionService, DEVICE_TRANSITION_MILLISECONDS } from "../server/transition/service.mjs";

const instant = Date.UTC(2026, 9, 17), csrf = Buffer.alloc(32, 8).toString("base64url");
const token = (n) => Buffer.alloc(32, n).toString("base64url");
const source = { admin: token(1), client: token(2) }, target = { admin: token(3), client: token(4) };
const identity = { admin: "a".repeat(32), client: "b".repeat(32) }, notification = "f".repeat(32);
const dto = (role, changes = {}) => ({ user: { id: identity[role], role, pseudonym: "Fictional account" }, csrf, expiresAt: instant + 86400000,
  ...(role === "client" ? { access: { state: "active", admissionPolicy: "manual_invitation", invitationConsumed: true, emailVerified: true, ageAssured: false, approved: true, expiresAt: null } } : {}), ...changes });
function fixture(extra = {}) {
  let time = instant;
  const values = new Map(Object.entries(source).map(([role, raw]) => [raw, dto(role)]));
  const calls = [];
  const options = { clock: () => time, authService: { async session(raw) { calls.push(["admin", raw]); const row = values.get(raw); return row?.user.role === "admin" ? row : null; } },
    accessService: { async session(raw) { calls.push(["client", raw]); const row = values.get(raw); return row?.user.role === "client" ? row : null; } }, ...extra };
  const service = createDeviceTransitionService(options);
  return { service, values, calls, options, advance: (milliseconds) => { time += milliseconds; } };
}
async function issued(f, role = "admin", reference = null) {
  const begun = f.service.begin(role, { notification: reference });
  const authorized = await f.service.authorize(role, source[role], csrf, { challenge: begun.challenge });
  return { ...begun, ...authorized };
}
const rejected = (operation, status) => assert.rejects(operation, (error) => error.httpStatus === status && !error.message.includes(source.admin));

test("device handoff preserves the same valid session, role and exact notification reference without new credentials", async () => {
  for (const role of ["admin", "client"]) {
    const f = fixture(), flow = await issued(f, role, notification);
    for (const opaque of [flow.challenge, flow.ticket]) {
      assert.doesNotMatch(opaque, /[+/=]/); assert.ok(opaque.length < 2048);
      assert.equal(Buffer.from(opaque, "base64url").includes(Buffer.from(source[role])), false);
    }
    const result = await f.service.complete(role, flow.nonce, null, { ticket: flow.ticket });
    assert.equal(result.token, source[role]); assert.equal(result.expiresAt, dto(role).expiresAt); assert.equal(result.keptExisting, false);
    assert.equal(result.destination, `${role === "admin" ? "/admin/messages" : "/messages"}#notification=${notification}`);
    await rejected(() => f.service.complete(role, flow.nonce, null, { ticket: flow.ticket }), 400);
  }
});

test("authorize requires the current source role cookie and current source CSRF, not challenge possession", async () => {
  const f = fixture(), begun = f.service.begin("admin", { notification: null });
  for (const raw of [null, "invalid", source.client]) await rejected(() => f.service.authorize("admin", raw, csrf, { challenge: begun.challenge }), 401);
  for (const wrong of [undefined, "invalid", token(12)]) await rejected(() => f.service.authorize("admin", source.admin, wrong, { challenge: begun.challenge }), 403);
  await rejected(() => f.service.authorize("client", source.client, csrf, { challenge: begun.challenge }), 400);
  const result = await f.service.authorize("admin", source.admin, csrf, { challenge: begun.challenge });
  assert.deepEqual(Object.keys(result), ["ticket"]);
});

test("missing source authentication retains only a fixed role login and validated notification reference", async () => {
  const f = fixture(), begun = f.service.begin("client", { notification });
  await assert.rejects(() => f.service.authorize("client", null, null, { challenge: begun.challenge }), (error) => error.httpStatus === 401 && error.loginDestination === `/access#notification=${notification}`);
});

test("redemption requires the destination nonce and authenticates every sealed field", async () => {
  const f = fixture(), flow = await issued(f);
  await rejected(() => f.service.complete("admin", token(20), null, { ticket: flow.ticket }), 400);
  await rejected(() => f.service.complete("client", flow.nonce, null, { ticket: flow.ticket }), 400);
  const bytes = Buffer.from(flow.ticket, "base64url"); bytes[bytes.length - 1] ^= 1;
  for (const ticket of [bytes.toString("base64url"), flow.ticket + "=", flow.challenge, "x".repeat(2049)]) await rejected(() => f.service.complete("admin", flow.nonce, null, { ticket }), 400);
  assert.equal((await f.service.complete("admin", flow.nonce, null, { ticket: flow.ticket })).token, source.admin);
});

test("restarting the single process invalidates outstanding challenges and tickets", async () => {
  const f = fixture(), flow = await issued(f), restarted = createDeviceTransitionService(f.options);
  await rejected(() => restarted.authorize("admin", source.admin, csrf, { challenge: flow.challenge }), 400);
  await rejected(() => restarted.complete("admin", flow.nonce, null, { ticket: flow.ticket }), 400);
});

test("expired challenges, tickets and sessions never regain authority", async () => {
  const f = fixture(), flow = await issued(f); f.advance(DEVICE_TRANSITION_MILLISECONDS);
  await rejected(() => f.service.authorize("admin", source.admin, csrf, { challenge: flow.challenge }), 400);
  await rejected(() => f.service.complete("admin", flow.nonce, null, { ticket: flow.ticket }), 400);
  const g = fixture(), second = await issued(g); g.values.set(source.admin, dto("admin", { expiresAt: instant }));
  await rejected(() => g.service.complete("admin", second.nonce, null, { ticket: second.ticket }), 401);
});

test("source revocation or a changed credential identity after export prevents handoff", async () => {
  for (const value of [null, dto("admin", { user: { id: "e".repeat(32), role: "admin", pseudonym: "Changed identity" } })]) {
    const f = fixture(), flow = await issued(f); f.values.set(source.admin, value);
    await rejected(() => f.service.complete("admin", flow.nonce, null, { ticket: flow.ticket }), 401);
  }
});

test("existing valid target session of the same account is kept; a different account refuses replacement", async () => {
  const f = fixture(), flow = await issued(f); f.values.set(target.admin, dto("admin"));
  const result = await f.service.complete("admin", flow.nonce, target.admin, { ticket: flow.ticket });
  assert.equal(result.token, target.admin); assert.equal(result.keptExisting, true);
  const g = fixture(), second = await issued(g); g.values.set(target.admin, dto("admin", { user: { id: "c".repeat(32), role: "admin", pseudonym: "Other account" } }));
  await rejected(() => g.service.complete("admin", second.nonce, target.admin, { ticket: second.ticket }), 409);
  await rejected(() => g.service.complete("admin", second.nonce, null, { ticket: second.ticket }), 400);
});

test("pending and expired client access migrate as account access without granting message access", async () => {
  for (const state of ["pending", "expired"]) {
    const f = fixture(), access = { ...dto("client").access, state, approved: false };
    f.values.set(source.client, dto("client", { access }));
    const flow = await issued(f, "client", notification), result = await f.service.complete("client", flow.nonce, null, { ticket: flow.ticket });
    assert.equal(result.destination, `/access#notification=${notification}`);
  }
});

test("bounded live challenge state cannot be evicted to reset replay protection", async () => {
  const f = fixture({ maxChallenges: 1 }), flow = await issued(f);
  await f.service.complete("admin", flow.nonce, null, { ticket: flow.ticket });
  assert.throws(() => f.service.begin("client", { notification: null }), (error) => error.httpStatus === 429);
  f.advance(DEVICE_TRANSITION_MILLISECONDS);
  assert.ok(f.service.begin("client", { notification: null }).challenge);
});

test("a challenge is reserved synchronously before credential lookup so concurrent consumption has one winner", async () => {
  const f = fixture(), flow = await issued(f);
  let release; const wait = new Promise((resolve) => { release = resolve; });
  f.options.authService.session = async (raw) => { await wait; return f.values.get(raw) ?? null; };
  const first = f.service.complete("admin", flow.nonce, null, { ticket: flow.ticket });
  await rejected(() => f.service.complete("admin", flow.nonce, null, { ticket: flow.ticket }), 400);
  release(); assert.equal((await first).token, source.admin);
});

test("a newer destination sign-in or begin cancels an outstanding completion before any cookie can be chosen", async () => {
  for (const operation of ["cancel", "begin"]) {
    const f = fixture(), flow = await issued(f);
    let release; const wait = new Promise((resolve) => { release = resolve; });
    f.options.authService.session = async (raw) => { await wait; return f.values.get(raw) ?? null; };
    const completion = f.service.complete("admin", flow.nonce, null, { ticket: flow.ticket });
    if (operation === "cancel") f.service.cancel("admin", flow.nonce);
    else f.service.begin("admin", { notification: null }, flow.nonce);
    release(); await rejected(() => completion, 400);
  }
});

test("all request shapes and trusted origin configuration stay closed", async () => {
  const f = fixture();
  for (const input of [{}, { notification, next: "https://evil.invalid" }, { notification: "F".repeat(32) }, { notification: "/messages" }, []]) assert.throws(() => f.service.begin("admin", input));
  assert.throws(() => f.service.begin("operator", { notification: null }));
  for (const extra of [{ primaryOrigin: "https://evil.invalid" }, { legacyOrigin: "https://foo.jessiemessage.com" }, { maxChallenges: 0 },
    { primaryOrigin: "https://jessiemessage.localhost:1234", legacyOrigin: "https://recette.jessiemessage.localhost:4321" }]) assert.throws(() => createDeviceTransitionService({ ...f.options, ...extra }));
  const local = createDeviceTransitionService({ ...f.options, primaryOrigin: "https://jessiemessage.localhost:1234", legacyOrigin: "https://recette.jessiemessage.localhost:1234" });
  assert.ok(local.begin("client", { notification: null }).challenge);
  const flow = await issued(f);
  await rejected(() => f.service.authorize("admin", source.admin, csrf, { challenge: flow.challenge, token: source.admin }), 400);
  await rejected(() => f.service.complete("admin", flow.nonce, null, { ticket: flow.ticket, role: "admin" }), 400);
});
