import test from "node:test";
import assert from "node:assert/strict";
import { createECDH, randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import { createNotificationTransport, isPublicPushAddress, notificationRetryAfter } from "../server/notifications/transport.mjs";

const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
function fixture() {
  const vapid = createECDH("prime256v1"), client = createECDH("prime256v1"); vapid.generateKeys(); client.generateKeys();
  return { config: { enabled: true, vapid: { publicKey: vapid.getPublicKey().toString("base64url"), privateKey: Buffer.concat([Buffer.alloc(32), vapid.getPrivateKey()]).subarray(-32).toString("base64url"), subject: "mailto:contact@jessiemessage.com" },
    transport: { deadlineMilliseconds: 10000, maxResponseBytes: 8192 } },
  subscription: { endpoint: "https://fcm.googleapis.com/wp/synthetic-token", expirationTime: null,
    keys: { p256dh: client.getPublicKey().toString("base64url"), auth: randomBytes(16).toString("base64url") } } };
}
function requestMock({ statusCode = 201, headers = {}, chunks = [], stall = false } = {}) {
  const calls = [], began = deferred();
  const request = (url, options, callback) => {
    const outgoing = new EventEmitter(), incoming = new EventEmitter();
    outgoing.destroyed = false; incoming.destroyed = false;
    outgoing.destroy = () => { outgoing.destroyed = true; };
    incoming.destroy = () => { incoming.destroyed = true; };
    Object.assign(incoming, { statusCode, headers });
    const call = { url, options, outgoing, incoming, body: null, pinned: null }; calls.push(call);
    options.lookup(url.hostname, { all: true }, (error, addresses) => { if (error) throw error; call.pinned = addresses; });
    outgoing.end = (body) => {
      call.body = body;
      queueMicrotask(() => {
        if (outgoing.destroyed) return;
        callback(incoming);
        began.resolve();
        if (!stall) { for (const chunk of chunks) incoming.emit("data", chunk); incoming.emit("end"); }
      });
    };
    return outgoing;
  };
  return { request, calls, began: began.promise };
}
const publicLookup = async () => [{ address: "142.250.74.202", family: 4 }];

test("push destinations reject private, reserved and mapped IPv4/IPv6 addresses", () => {
  for (const address of ["8.8.8.8", "142.250.74.202", "17.57.144.10", "2606:4700::1111", "2001:4860:4860::8888"]) assert.equal(isPublicPushAddress(address), true, address);
  for (const address of ["127.0.0.1", "0.0.0.0", "10.1.2.3", "100.64.0.1", "169.254.169.254", "172.31.0.1", "192.168.1.1", "192.0.0.9", "192.0.2.1", "198.18.0.1",
    "198.51.100.1", "203.0.113.1", "224.1.1.1", "255.255.255.255", "::1", "::", "fe80::1", "fc00::1", "::ffff:8.8.8.8", "64:ff9b::808:808", "2001:db8::1", "2002:808:808::1", "3fff::1", "fe80::1%lo", "invalid"]) assert.equal(isPublicPushAddress(address), false, address);
});

test("real Web Push encryption uses vetted DNS once, preserved SNI/query and explicit bounded transport settings", async () => {
  const { config, subscription } = fixture(), mock = requestMock({ headers: { "retry-after": "120" } });
  subscription.endpoint = "https://wns2-ln2p.notify.windows.com/w/?token=opaque%2Bvalue";
  let lookups = 0;
  const transport = createNotificationTransport(config, { request: mock.request, lookup: async (...args) => { lookups += 1; assert.equal(args[0], "wns2-ln2p.notify.windows.com"); return publicLookup(); } });
  assert.deepEqual(await transport.send(subscription, '{"type":"message"}', { ttl: 50, topic: "JessieMessage" }), { statusCode: 201, retryAfterSeconds: 120 });
  const { url, options, body } = mock.calls[0];
  assert.equal(lookups, 1); assert.equal(url.href, subscription.endpoint); assert.equal(options.servername, url.hostname);
  assert.equal(options.agent, false); assert.equal(options.rejectUnauthorized, true); assert.equal(options.minVersion, "TLSv1.2");
  assert.equal(options.headers.TTL, 50); assert.equal(options.headers.Topic, "JessieMessage"); assert.equal(options.headers["Content-Encoding"], "aes128gcm");
  assert.ok(Buffer.isBuffer(body)); assert.equal(body.includes(Buffer.from('{"type":"message"}')), false);
  assert.deepEqual(mock.calls[0].pinned, [{ address: "142.250.74.202", family: 4 }]);
  await transport.close();
});

test("SSRF URL and every DNS answer are checked before any outgoing request", async () => {
  const { config, subscription } = fixture();
  for (const endpoint of ["http://fcm.googleapis.com/wp/token", "https://fcm.googleapis.com:444/wp/token", "https://user@fcm.googleapis.com/wp/token", "https://fcm.googleapis.com/wp/token#fragment", "https://fcm.googleapis.com.evil.invalid/wp/token", "https://push.apple.com/token", "https://notify.windows.com/w/?x=1", "https://127.0.0.1/wp/token"]) {
    const mock = requestMock(), transport = createNotificationTransport(config, { request: mock.request, lookup: publicLookup });
    await assert.rejects(transport.send({ ...subscription, endpoint }, "{}"), { code: "NOTIFICATIONS_PAYLOAD_INVALID" });
    assert.equal(mock.calls.length, 0); await transport.close();
  }
  for (const addresses of [[], [{ address: "127.0.0.1", family: 4 }], [{ address: "8.8.8.8", family: 4 }, { address: "::1", family: 6 }], [{ address: "8.8.8.8", family: 6 }]]) {
    const mock = requestMock(), transport = createNotificationTransport(config, { request: mock.request, lookup: async () => addresses });
    await assert.rejects(transport.send(subscription, "{}"), { code: "NOTIFICATIONS_DESTINATION_INVALID" });
    assert.equal(mock.calls.length, 0); await transport.close();
  }
});

test("total deadline includes DNS and a late resolution cannot start a request", async () => {
  const { config, subscription } = fixture(), dns = deferred(), mock = requestMock(); config.transport.deadlineMilliseconds = 15;
  const transport = createNotificationTransport(config, { request: mock.request, lookup: () => dns.promise });
  await Promise.all([assert.rejects(transport.send(subscription, "{}"), { code: "NOTIFICATIONS_TRANSPORT_TIMEOUT" }), new Promise((resolve) => setTimeout(resolve, 30))]);
  dns.resolve(await publicLookup()); await new Promise((resolve) => setImmediate(resolve));
  assert.equal(mock.calls.length, 0); await transport.close();
});

test("deadline, external abort and close destroy a hanging HTTP request and drain its promise", async () => {
  for (const mode of ["deadline", "abort", "close"]) {
    const { config, subscription } = fixture(), mock = requestMock({ stall: true }), controller = new AbortController(); config.transport.deadlineMilliseconds = mode === "deadline" ? 15 : 10000;
    const transport = createNotificationTransport(config, { request: mock.request, lookup: publicLookup });
    const sending = transport.send(subscription, "{}", { signal: controller.signal });
    const rejection = assert.rejects(sending, { code: mode === "deadline" ? "NOTIFICATIONS_TRANSPORT_TIMEOUT" : "NOTIFICATIONS_TRANSPORT_ABORTED" });
    await mock.began;
    if (mode === "abort") controller.abort();
    if (mode === "close") await transport.close();
    await Promise.all([rejection, new Promise((resolve) => setTimeout(resolve, 20))]);
    assert.equal(mock.calls[0].outgoing.destroyed, true); assert.equal(mock.calls[0].incoming.destroyed, true);
    await transport.close();
    await assert.rejects(transport.send(subscription, "{}"), { code: "NOTIFICATIONS_TRANSPORT_CLOSED" });
  }
});

test("response bounds, redirect refusal and safe result omit provider bodies and sensitive details", async () => {
  const { config, subscription } = fixture();
  const tooLarge = requestMock({ chunks: [Buffer.alloc(8193, "sensitive-provider-body")] });
  const oversized = createNotificationTransport(config, { request: tooLarge.request, lookup: publicLookup });
  await assert.rejects(oversized.send(subscription, "{}"), (error) => {
    assert.equal(error.code, "NOTIFICATIONS_RESPONSE_TOO_LARGE"); assert.equal(error.cause, undefined);
    assert.equal(JSON.stringify(error).includes(subscription.endpoint), false); return true;
  });
  await oversized.close();
  const redirect = requestMock({ statusCode: 307, headers: { location: "http://127.0.0.1/secret" }, chunks: [Buffer.from("sensitive-provider-body")] });
  const transport = createNotificationTransport(config, { request: redirect.request, lookup: publicLookup });
  assert.deepEqual(await transport.send(subscription, "{}"), { statusCode: 307, retryAfterSeconds: null });
  assert.equal(redirect.calls.length, 1); await transport.close();
  for (const payload of ["x".repeat(1025), "\ud800", Buffer.from("{}")]) {
    await assert.rejects(createNotificationTransport(config, { request: redirect.request, lookup: publicLookup }).send(subscription, payload), { code: "NOTIFICATIONS_PAYLOAD_INVALID" });
  }
});

test("Retry-After accepts seconds/date and bounds untrusted values", () => {
  const now = Date.UTC(2026, 9, 16, 20);
  assert.equal(notificationRetryAfter("120", now), 120); assert.equal(notificationRetryAfter("999999999999", now), 3600);
  assert.equal(notificationRetryAfter("0", now), 1); assert.equal(notificationRetryAfter(new Date(now + 60000).toUTCString(), now), 60);
  assert.equal(notificationRetryAfter("invalid", now), null); assert.equal(notificationRetryAfter(["10"], now), null);
});
