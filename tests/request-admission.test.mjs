import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createRequestAdmission, RequestAdmissionError, REQUEST_ADMISSION_LIMITS as limits } from "../server/http/admission.mjs";

const token = (value) => { const bytes = Buffer.alloc(32); bytes.writeUInt32BE(value); return bytes.toString("base64url"); };
const peer = (value) => `192.0.${Math.floor(value / 256)}.${value % 256}`;
const cookie = (value, name = "__Host-jessie_session") => `${name}=${token(value)}`;
const request = (address = peer(1), header = "", extra = {}) => ({ socket: { remoteAddress: address }, headers: { cookie: header, ...extra } });
class Response extends EventEmitter {
  writableFinished = false;
  destroyed = false;
  finish() { this.writableFinished = true; this.emit("finish"); }
  close() { this.destroyed = true; this.emit("close"); }
}
function fixture() {
  const time = { now: 60_000 };
  return { time, admission: createRequestAdmission({ clock: () => time.now }) };
}
function complete(admission, req = request()) {
  const response = new Response(), done = admission.enter(req, response);
  assert.equal(typeof done, "function"); assert.equal(done instanceof Promise, false);
  done(); response.finish();
  return response;
}
function denied(admission, req, code, retryAfter) {
  assert.throws(() => admission.enter(req, new Response()), (error) => {
    assert.ok(error instanceof RequestAdmissionError); assert.equal(error.code, code);
    assert.ok(Number.isInteger(error.retryAfter) && error.retryAfter >= 1 && error.retryAfter <= 60);
    if (retryAfter !== undefined) assert.equal(error.retryAfter, retryAfter);
    return true;
  });
}
function hold(admission, req) {
  const response = new Response(), done = admission.enter(req, response);
  return { response, done, finish() { done(); response.finish(); } };
}

test("admission is synchronous, keeps its interface private and samples its clock only at entry", () => {
  let samples = 0;
  const admission = createRequestAdmission({ clock: () => { samples++; return 60_000; } });
  assert.deepEqual(Object.keys(admission), ["enter"]); assert.ok(Object.isFrozen(admission));
  const response = complete(admission);
  assert.equal(samples, 1); assert.equal(response.listenerCount("finish"), 0); assert.equal(response.listenerCount("close"), 0);
  assert.throws(() => createRequestAdmission({ clock: null }), TypeError);
  assert.throws(() => admission.enter(request(), {}), TypeError);
});

test("per-cookie requests cannot bypass their budget by rotating real peers", () => {
  const { admission } = fixture();
  for (let index = 0; index < limits.tokenRequests; index++) complete(admission, request(peer(index), cookie(1)));
  denied(admission, request(peer(700), cookie(1)), "REQUEST_RATE_LIMIT", 60);
  complete(admission, request(peer(700), cookie(2)));
});

test("each cookie has its own counter when both roles are present; rotating the other cookie cannot reset it", () => {
  for (const stableRole of ["__Host-jessie_session", "__Host-jessie_client"]) {
    const otherRole = stableRole === "__Host-jessie_session" ? "__Host-jessie_client" : "__Host-jessie_session";
    const { admission } = fixture();
    for (let index = 0; index < limits.tokenRequests; index++) {
      complete(admission, request(peer(index), `${cookie(1, stableRole)}; ${cookie(100 + index, otherRole)}`));
    }
    denied(admission, request(peer(2), `${cookie(1, stableRole)}; ${cookie(900, otherRole)}`), "REQUEST_RATE_LIMIT");
    complete(admission, request(peer(2), `${cookie(2, stableRole)}; ${cookie(901, otherRole)}`));
  }
});

test("real socket peer limits survive rotated cookies and all forged forwarded headers", () => {
  const { admission } = fixture();
  for (let index = 0; index < limits.peerRequests; index++) {
    complete(admission, request(peer(1), cookie(index % 4), {
      "x-forwarded-for": peer(index), forwarded: `for=${peer(index)}`, "x-real-ip": peer(index), "cf-connecting-ip": peer(index),
    }));
  }
  denied(admission, request(peer(1), cookie(8000), { "x-forwarded-for": peer(900) }), "REQUEST_RATE_LIMIT");
  complete(admission, request(peer(2), cookie(8000)));
});

test("IPv4-mapped sockets share the real IPv4 peer bucket; missing peers share a conservative fallback", () => {
  const { admission } = fixture();
  for (let index = 0; index < limits.peerRequests; index++) complete(admission, request("192.0.2.12"));
  denied(admission, request("::ffff:192.0.2.12"), "REQUEST_RATE_LIMIT");
  const other = fixture().admission;
  for (let index = 0; index < limits.peerRequests; index++) complete(other, { headers: { "x-forwarded-for": peer(index) } });
  denied(other, { socket: { remoteAddress: "not-an-ip" }, headers: {} }, "REQUEST_RATE_LIMIT");
});

test("one peer cannot exhaust the token table by rotating both cookie identities; known tokens and new peers still work", () => {
  const { admission, time } = fixture();
  for (let index = 0; index < limits.peerNewTokens / 2; index++) {
    complete(admission, request(peer(1), `${cookie(index * 2)}; ${cookie(index * 2 + 1, "__Host-jessie_client")}`));
  }
  denied(admission, request(peer(1), cookie(9000)), "REQUEST_RATE_LIMIT", 60);
  complete(admission, request(peer(1), cookie(0)));
  complete(admission, request(peer(2), cookie(9000)));
  complete(admission, request(peer(3), `${cookie(9001)}; ${cookie(9002, "__Host-jessie_client")}`));
  // The allocation budget is local to the current peer. An identity already
  // admitted by a different peer requires no new global table entry.
  complete(admission, request(peer(1), cookie(9000)));
  time.now = 120_000; complete(admission, request(peer(1), cookie(9003)));
});

test("rejected requests with a rotating second cookie cannot consume the peer's allocation budget", () => {
  const { admission } = fixture();
  for (let index = 0; index < limits.tokenRequests; index++) complete(admission, request(peer(index), cookie(1)));
  for (let index = 0; index < 500; index++) {
    denied(admission, request(peer(900), `${cookie(1)}; ${cookie(9000 + index, "__Host-jessie_client")}`), "REQUEST_RATE_LIMIT");
  }
  for (let index = 0; index < limits.peerNewTokens; index++) complete(admission, request(peer(900), cookie(12000 + index)));
  denied(admission, request(peer(900), cookie(13000)), "REQUEST_RATE_LIMIT");
});

test("invalid, duplicated, oversized and noncanonical cookies never create an authenticated identity bucket", () => {
  const { admission } = fixture();
  const invalid = ["", cookie(1) + "; " + cookie(1), "__Host-jessie_session=" + "A".repeat(42) + "B",
    `__Host-jessie_session=${token(1)}=`, "wrong=" + token(1), "x".repeat(8193)];
  for (let index = 0; index < limits.tokenRequests + 1; index++) complete(admission, request(peer(1), invalid[index % invalid.length]));
  // A malformed header did not exhaust the canonical identity's own counter.
  for (let index = 0; index < limits.tokenRequests; index++) complete(admission, request(peer(2), cookie(1)));
  denied(admission, request(peer(3), cookie(1)), "REQUEST_RATE_LIMIT");
});

test("process budget bounds distributed peers even when each individual peer stays below its limit", () => {
  const { admission } = fixture();
  for (let index = 0; index < limits.globalRequests; index++) complete(admission, request(peer(Math.floor(index / 500))));
  denied(admission, request(peer(20)), "REQUEST_RATE_LIMIT", 60);
});

test("refused actor requests cannot burn another actor's remaining global budget", () => {
  const { admission } = fixture();
  for (let index = 0; index < limits.tokenRequests; index++) complete(admission, request(peer(1), cookie(1)));
  for (let index = 0; index < 1000; index++) denied(admission, request(peer(1), cookie(1)), "REQUEST_RATE_LIMIT");
  for (let index = 0; index < limits.globalRequests - limits.tokenRequests; index++) {
    complete(admission, request(peer(10 + Math.floor(index / 1000))));
  }
  denied(admission, request(peer(20)), "REQUEST_RATE_LIMIT");
});

test("fixed windows expose deterministic Retry-After and reset exactly at the boundary", () => {
  const { admission, time } = fixture(); time.now = 119_000;
  for (let index = 0; index < limits.tokenRequests; index++) complete(admission, request(peer(1), cookie(1)));
  denied(admission, request(peer(1), cookie(1)), "REQUEST_RATE_LIMIT", 1);
  time.now = 119_999; denied(admission, request(peer(1), cookie(1)), "REQUEST_RATE_LIMIT", 1);
  time.now = 120_000; complete(admission, request(peer(1), cookie(1)));
  for (let index = 1; index < limits.tokenRequests; index++) complete(admission, request(peer(1), cookie(1)));
  time.now = 121_001; denied(admission, request(peer(1), cookie(1)), "REQUEST_RATE_LIMIT", 59);
});

test("a backward or broken clock cannot reopen counters or admit unbounded work", () => {
  const { admission, time } = fixture(); time.now = 119_000;
  for (let index = 0; index < limits.tokenRequests; index++) complete(admission, request(peer(1), cookie(1)));
  time.now = 60_000; denied(admission, request(peer(1), cookie(1)), "REQUEST_RATE_LIMIT", 1);
  for (const value of [-1, NaN, Infinity, 0.5, "120000", 253402300800000]) {
    time.now = value; denied(admission, request(peer(2)), "REQUEST_BUSY");
  }
  const broken = createRequestAdmission({ clock: () => { throw new Error("private-clock"); } });
  assert.throws(() => broken.enter(request(), new Response()), (error) => error.code === "REQUEST_BUSY" && !error.message.includes("private-clock"));
});

test("global slots stay reserved until both operation and response finish, in either order", () => {
  const { admission } = fixture();
  const pending = Array.from({ length: limits.globalConcurrent }, (_, index) => hold(admission, request(peer(index))));
  denied(admission, request(peer(900)), "REQUEST_BUSY");
  pending[0].response.close(); denied(admission, request(peer(900)), "REQUEST_BUSY");
  pending[1].done(); denied(admission, request(peer(900)), "REQUEST_BUSY");
  pending[0].done(); const replacement = hold(admission, request(peer(900)));
  denied(admission, request(peer(901)), "REQUEST_BUSY");
  pending[1].response.finish(); complete(admission, request(peer(901)));
  pending.forEach((item) => item.finish()); replacement.finish();
  complete(admission, request(peer(902)));
});

test("a single peer cannot reserve every global slot", () => {
  const { admission } = fixture();
  const pending = Array.from({ length: limits.peerConcurrent }, () => hold(admission, request(peer(1))));
  denied(admission, request(peer(1)), "REQUEST_BUSY");
  complete(admission, request(peer(2)));
  pending.forEach((item) => item.finish());
});

test("token concurrency survives changed peers, duplicate completion signals and rate-window changes", () => {
  const { admission, time } = fixture();
  const pending = Array.from({ length: limits.tokenConcurrent }, (_, index) => hold(admission, request(peer(index), cookie(1))));
  time.now = 120_000;
  denied(admission, request(peer(900), cookie(1)), "REQUEST_BUSY");
  pending[0].done(); pending[0].done(); denied(admission, request(peer(900), cookie(1)), "REQUEST_BUSY");
  pending[0].response.finish(); pending[0].response.close(); pending[0].done();
  const replacement = hold(admission, request(peer(900), cookie(1)));
  denied(admission, request(peer(901), cookie(1)), "REQUEST_BUSY");
  assert.equal(pending[0].response.listenerCount("finish"), 0); assert.equal(pending[0].response.listenerCount("close"), 0);
  complete(admission, request(peer(901), cookie(2)));
  pending.forEach((item) => item.finish()); replacement.finish();
});

test("already closed/finished responses still retain an unfinished operation; writableEnded alone is insufficient", () => {
  const { admission } = fixture();
  const closed = new Response(); closed.close(); const done = admission.enter(request(peer(1), cookie(1)), closed);
  const rest = Array.from({ length: limits.tokenConcurrent - 1 }, () => hold(admission, request(peer(1), cookie(1))));
  denied(admission, request(peer(1), cookie(1)), "REQUEST_BUSY"); done();
  const ended = new Response(); ended.writableEnded = true; const endedDone = admission.enter(request(peer(1), cookie(1)), ended);
  endedDone(); denied(admission, request(peer(1), cookie(1)), "REQUEST_BUSY");
  ended.finish(); complete(admission, request(peer(1), cookie(1)));
  rest.forEach((item) => item.finish());
});

test("peer table capacity fails closed without evicting a live-window counter and recovers after expiry", () => {
  const { admission, time } = fixture();
  for (let index = 0; index < limits.peerCapacity; index++) complete(admission, request(peer(index)));
  denied(admission, request(peer(limits.peerCapacity)), "REQUEST_BUSY");
  complete(admission, request(peer(0)));
  denied(admission, request(peer(limits.peerCapacity)), "REQUEST_BUSY");
  time.now = 120_000; complete(admission, request(peer(limits.peerCapacity)));
});

test("token table capacity neither evicts current counters nor partially admits two newly supplied cookies", () => {
  const { admission, time } = fixture();
  for (let index = 0; index < limits.tokenCapacity; index++) complete(admission, request(peer(Math.floor(index / 100)), cookie(index)));
  denied(admission, request(peer(10), cookie(9000)), "REQUEST_BUSY");
  denied(admission, request(peer(10), `${cookie(9000)}; ${cookie(9001, "__Host-jessie_client")}`), "REQUEST_BUSY");
  for (let index = 1; index < limits.tokenRequests; index++) complete(admission, request(peer(10), cookie(0)));
  denied(admission, request(peer(11), cookie(0)), "REQUEST_RATE_LIMIT");
  time.now = 120_000; complete(admission, request(peer(10), `${cookie(0)}; ${cookie(9001, "__Host-jessie_client")}`));
  complete(admission, request(peer(10), cookie(9000)));
});

test("capacity cleanup never discards an expired entry whose old operation is still active", () => {
  const { admission, time } = fixture();
  const active = Array.from({ length: 8 }, (_, index) => hold(admission, request(peer(index), cookie(index))));
  for (let index = 8; index < limits.tokenCapacity; index++) complete(admission, request(peer(20 + Math.floor(index / 100)), cookie(index)));
  time.now = 120_000; complete(admission, request(peer(50), cookie(9000)));
  const additional = Array.from({ length: limits.tokenConcurrent - 1 }, () => hold(admission, request(peer(0), cookie(0))));
  denied(admission, request(peer(0), cookie(0)), "REQUEST_BUSY");
  active.forEach((item) => item.finish()); additional.forEach((item) => item.finish());
});

test("a fresh process guard resets its private counters while the original guard remains limited", () => {
  const first = fixture(), second = fixture();
  for (let index = 0; index < limits.tokenRequests; index++) complete(first.admission, request(peer(1), cookie(1)));
  denied(first.admission, request(peer(1), cookie(1)), "REQUEST_RATE_LIMIT");
  complete(second.admission, request(peer(1), cookie(1)));
  denied(first.admission, request(peer(1), cookie(1)), "REQUEST_RATE_LIMIT");
  assert.throws(() => first.admission.enter(request(peer(1), cookie(1)), new Response()), (error) => {
    assert.doesNotMatch(String(error), /192\.0\.|__Host|AAAAAAAA/); return true;
  });
});
