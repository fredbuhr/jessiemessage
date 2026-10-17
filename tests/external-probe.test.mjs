import test from "node:test";
import assert from "node:assert/strict";
import { probePrivateService, ExternalProbeError, EXTERNAL_PROBE_CODES, validateExternalProbeReport } from "../server/operations/external-probe.mjs";

const EPOCH = 1792279800000;
const body = (url) => JSON.stringify({ status: url.endsWith("/health") ? "ok" : "ready" });
const response = (url, overrides = {}) => new Response(body(url), { status: 200, headers: { "Cache-Control": "no-store" }, ...overrides });
const probe = (fetch, options = {}) => probePrivateService({ fetch, clock: () => EPOCH, timeoutMilliseconds: 5000, ...options });
const codes = (value) => value.checks.map((item) => item.code);

test("one anonymous pass checks precisely the fixed public endpoints and returns a closed report", async () => {
  const calls = [];
  const value = await probe(async (url, options) => { calls.push([url, options]); return response(url); });
  assert.deepEqual(calls.map(([url]) => url), ["https://jessiemessage.com/api/health", "https://jessiemessage.com/api/ready"]);
  for (const [, options] of calls) {
    assert.deepEqual(Object.keys(options).sort(), ["cache", "credentials", "headers", "method", "redirect", "referrerPolicy", "signal"]);
    assert.equal(options.method, "GET"); assert.equal(options.redirect, "error"); assert.equal(options.credentials, "omit");
    assert.equal(options.cache, "no-store"); assert.equal(options.referrerPolicy, "no-referrer");
    assert.deepEqual(options.headers, { Accept: "application/json" }); assert.ok(options.signal instanceof AbortSignal);
  }
  assert.deepEqual(Object.keys(value), ["version", "type", "status", "checkedAt", "durationMilliseconds", "checks"]);
  assert.equal(value.version, 1); assert.equal(value.type, "private_service_probe"); assert.equal(value.status, "healthy"); assert.equal(value.checkedAt, EPOCH);
  assert.ok(Number.isInteger(value.durationMilliseconds) && value.durationMilliseconds >= 0 && value.durationMilliseconds <= 10000);
  assert.deepEqual(value.checks, [{ name: "http", status: "pass", code: "ok" }, { name: "readiness", status: "pass", code: "ok" }]);
});

test("HTTP life alone cannot hide unavailable readiness or a misleading HTTP200", async () => {
  const failed = await probe(async (url) => response(url, { status: url.endsWith("/ready") ? 503 : 200 }));
  assert.equal(failed.status, "unavailable"); assert.deepEqual(codes(failed), ["ok", "http_status"]);
  const falseGreen = await probe(async () => new Response('{"status":"unavailable"}', { headers: { "Cache-Control": "no-store" } }));
  assert.equal(falseGreen.status, "unavailable"); assert.deepEqual(codes(falseGreen), ["invalid_status", "invalid_status"]);
});

test("network, DNS, TLS and redirect fetch errors never expose their private details", async () => {
  for (const cause of ["DNS private-host 10.0.0.1", "TLS certificate private", "redirect token=secret"]) {
    const value = await probe(async () => { throw new Error(cause); });
    assert.deepEqual(codes(value), ["network_unavailable", "network_unavailable"]);
    assert.doesNotMatch(JSON.stringify(value), /private-host|secret|10\.0\.0\.1|certificate/);
  }
});

test("custom fetch cannot supply a response already redirected or from another URL", async () => {
  const value = await probe(async (url) => ({ status: 200, headers: new Headers({ "Cache-Control": "no-store" }), redirected: true,
    body: response(url).body }));
  assert.deepEqual(codes(value), ["redirect_rejected", "redirect_rejected"]);
  const other = await probe(async (url) => ({ status: 200, headers: new Headers({ "Cache-Control": "no-store" }), url: "https://other.invalid/private", body: response(url).body }));
  assert.deepEqual(codes(other), ["redirect_rejected", "redirect_rejected"]);
});

test("no-store is an exact cache directive and returned cookies are refused", async () => {
  for (const cache of [null, "private", "x-no-store", "no-store=secret"]) {
    const value = await probe(async (url) => response(url, { headers: cache === null ? {} : { "Cache-Control": cache } }));
    assert.deepEqual(codes(value), ["cache_policy", "cache_policy"]);
  }
  const good = await probe(async (url) => response(url, { headers: { "Cache-Control": "private, NO-STORE" } }));
  assert.equal(good.status, "healthy");
  const cookie = await probe(async (url) => response(url, { headers: { "Cache-Control": "no-store", "Set-Cookie": "private=secret" } }));
  assert.deepEqual(codes(cookie), ["unexpected_cookie", "unexpected_cookie"]); assert.doesNotMatch(JSON.stringify(cookie), /secret|cookie=/);
});

test("JSON must contain exactly the expected status and valid UTF-8", async () => {
  for (const value of ["null", "[]", "\"ready\"", "{}", "no JSON", '{"status":"ready","private":"secret"}']) {
    const report = await probe(async () => new Response(value, { headers: { "Cache-Control": "no-store" } }));
    assert.equal(report.status, "unavailable"); assert.doesNotMatch(JSON.stringify(report), /secret/);
  }
  const invalid = await probe(async () => new Response(Uint8Array.of(0xff), { headers: { "Cache-Control": "no-store" } }));
  assert.deepEqual(codes(invalid), ["invalid_json", "invalid_json"]);
});

test("both advertised and chunked bodies are capped at 1024 bytes and cancelled", async () => {
  let cancelled = 0;
  const advertised = await probe(async (url) => response(url, { headers: { "Cache-Control": "no-store", "Content-Length": "1025" } }));
  assert.deepEqual(codes(advertised), ["body_too_large", "body_too_large"]);
  const chunked = await probe(async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(700)); controller.enqueue(new Uint8Array(325)); },
    cancel() { cancelled++; },
  }), { headers: { "Cache-Control": "no-store" } }));
  assert.deepEqual(codes(chunked), ["body_too_large", "body_too_large"]); assert.equal(cancelled, 2);
  const exact = await probe(async (url) => new Response(body(url).padEnd(1024, " "), { headers: { "Cache-Control": "no-store" } }));
  assert.equal(exact.status, "healthy");
});

test("timeout bounds a non-cooperative fetch and aborts each request", async () => {
  const signals = [];
  const value = await probe(async (_url, options) => { signals.push(options.signal); return new Promise(() => {}); }, { timeoutMilliseconds: 10 });
  assert.deepEqual(codes(value), ["request_timeout", "request_timeout"]); assert.ok(signals.every((signal) => signal.aborted));
});

test("timeout also covers chunked body reads and cancels readers", async () => {
  let cancelled = 0;
  const value = await probe(async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode("{")); }, cancel() { cancelled++; },
  }), { headers: { "Cache-Control": "no-store" } }), { timeoutMilliseconds: 10 });
  assert.deepEqual(codes(value), ["request_timeout", "request_timeout"]); assert.equal(cancelled, 2);
});

test("an endless empty stream cannot starve the timeout with read microtasks", async () => {
  let cancelled = 0;
  const value = await probe(async () => new Response(new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array()); }, cancel() { cancelled++; },
  }), { headers: { "Cache-Control": "no-store" } }), { timeoutMilliseconds: 10 });
  assert.deepEqual(codes(value), ["request_timeout", "request_timeout"]); assert.equal(cancelled, 2);
});

test("a fetch resolving after timeout is cancelled without changing the completed report", async () => {
  const resolvers = []; let cancelled = 0;
  const value = await probe(() => new Promise((resolve) => resolvers.push(resolve)), { timeoutMilliseconds: 10 });
  assert.deepEqual(codes(value), ["request_timeout", "request_timeout"]);
  for (const resolve of resolvers) resolve(new Response(new ReadableStream({ cancel() { cancelled++; } }), { headers: { "Cache-Control": "no-store" } }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(cancelled, 2); assert.deepEqual(codes(value), ["request_timeout", "request_timeout"]);
});

test("malformed responses and read errors remain unavailable without raw exceptions", async () => {
  for (const fetch of [async () => null, async () => ({ status: 200, headers: { get() { throw new Error("private token"); } } }),
    async () => ({ status: 200, headers: new Headers({ "Cache-Control": "no-store" }), get body() { throw new Error("private body getter"); } }),
    async () => new Response(new ReadableStream({ start(controller) { controller.error(new Error("private body token")); } }), { headers: { "Cache-Control": "no-store" } })]) {
    const value = await probe(fetch); assert.equal(value.status, "unavailable"); assert.doesNotMatch(JSON.stringify(value), /private body|private token/);
  }
});

test("malformed configuration or initial clock fails safely before requests", async () => {
  let calls = 0; const fetch = async (url) => { calls++; return response(url); };
  for (const options of [{ fetch: null }, { clock: null }, { timeoutMilliseconds: 0 }, { timeoutMilliseconds: 30001 }, { timeoutMilliseconds: 1.5 },
    ...[NaN, -1, Infinity, "123", 253402300800000].map((value) => ({ clock: () => value })), { clock() { throw new Error("private credential"); } }]) {
    await assert.rejects(() => probePrivateService({ fetch, ...options }), (error) => error instanceof ExternalProbeError
      && error.code === "EXTERNAL_PROBE_CONFIGURATION" && !/credential/.test(error.message));
  }
  assert.equal(calls, 0);
});

test("a clock failing after requests cannot manufacture a healthy timestamp", async () => {
  let calls = 0;
  const value = await probe(async (url) => response(url), { clock: () => ++calls === 1 ? EPOCH : NaN });
  assert.equal(value.status, "unavailable"); assert.equal(value.checkedAt, EPOCH); assert.deepEqual(codes(value), ["clock_invalid", "clock_invalid"]);
});

test("report validator owns its strict projection and refuses unknown fields or inconsistent state", async () => {
  const source = await probe(async (url) => response(url));
  const owned = validateExternalProbeReport(source);
  assert.deepEqual(owned, source); assert.notEqual(owned, source); assert.notEqual(owned.checks, source.checks); assert.notEqual(owned.checks[0], source.checks[0]);
  assert.ok(Object.isFrozen(EXTERNAL_PROBE_CODES));
  for (const change of [
    (value) => { value.secret = "private"; }, (value) => { value.version = 2; }, (value) => { value.type = "other"; },
    (value) => { value.status = "unavailable"; }, (value) => { value.checkedAt = Infinity; }, (value) => { value.durationMilliseconds = 60001; },
    (value) => { value.checks[0].code = "raw secret"; }, (value) => { value.checks[0].status = "fail"; },
    (value) => { value.checks.reverse(); }, (value) => { value.checks.push(value.checks[0]); },
    (value) => { value.checks[0].body = "private"; }, (value) => { value.checks.extra = "private"; },
  ]) { const value = structuredClone(source); change(value); assert.throws(() => validateExternalProbeReport(value), ExternalProbeError); }
});

test("report projection never executes getters or copies inherited or symbolic fields", async () => {
  const source = await probe(async (url) => response(url)); let reads = 0;
  for (const change of [
    (value) => { Object.defineProperty(value, "status", { get() { reads++; return "healthy"; } }); },
    (value) => { Object.defineProperty(value.checks, "0", { get() { reads++; return source.checks[0]; } }); },
    (value) => { Object.defineProperty(value.checks[0], "name", { get() { reads++; return "http"; } }); },
    (value) => { Object.setPrototypeOf(value, { private: "secret" }); },
    (value) => { value[Symbol("secret")] = "private"; },
  ]) { const value = structuredClone(source); change(value); assert.throws(() => validateExternalProbeReport(value), ExternalProbeError); }
  assert.equal(reads, 0);
});
