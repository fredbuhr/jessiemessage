import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { createSecureContext, TLSSocket } from "node:tls";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { performance } from "node:perf_hooks";
import { createVerificationTransport, MailDeliveryError } from "../server/mail/transport.mjs";
import { createReadinessService } from "../server/readiness/service.mjs";

// Public synthetic localhost-only certificate/key. These are test fixtures,
// never production credentials or a way to disable certificate verification.
const key = `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQCpQIZY37QvM7L8
DlHDuCAD8A1/rhJy016VwcWm2K7LZAxz7O7B5ii+WGnDU4C6V+GMPsK/LK6cT0eA
+Z0MVertP+0hpSQayHimz+N+R5I9ngm1jPQ3rsEhbgYx27NsvNrxZ7XgOrEAUWad
RL1Tfn3zNibs4aRxxcPkUfTgiv/SXgku/ZKnuHXarHas923kTghAjrCbFNw47a/9
kN2MbCTv7SWnO1xmWHSI821gRtDb+RLcxOMZYgLD0pDjEiNvlN+tySHZMYn/QZhI
ALTB2EMgYfj9a51OZbM1NONqVofqGGZtvvCBEr56B12zmAqaqeV5HHYeDM7FmP8T
iRJUQhd7AgMBAAECggEANt0Pr6d0RQjBMCuEHamF10DtX0ISAN67flf9tgPvRUb9
MmbPTlNJScpnHkXnKIBsQIXnowjc4RZh21EOs3z2VkmumIVrmrL5STmCSODyar7b
7tnuIE6plCiSIX9SPiFJ547yyei8j5nTZY9uv631Le2T2J2cLLUqtsxKUK8+FfaW
dO1bSKyq54IbGg8ZZNrfsxsRJXV+iDKNuP2XPGlw/AFkY+LpfRr8kx8a0y1onDZm
MC7aeyKAmgtisPITrIzpfEtFLSvqcjpbvOT8xCSNu8XPNTAWqgLGyz8cqX+L1FCX
+LETBFlYK4EeCrnvNYmTMBmaRgAoKU+r/tavd1nkYQKBgQDZyTng2A5ff6V1/4rx
NYzmtocTtB5itNWpwKva/h+hHxyM13V1UzQHDd90qfQzW7jjJp7Hk2ysVVTZZH9v
OdxN1REqydDktF3yi1ClLv1fi6NivlEOku7TwDbzQRiLAYrkzHyKFHbGJN7hQGyv
eAHgSVKr2Yg+DPXUx3Wfl8D6dwKBgQDG8zDehJ1d+zz1Dw3fl+dM2UnW1aBi45GQ
9+C3oEUfidVEihTjjkrTBEOq+7sF4vrkMkGM6xLvzaRE9n1wgLdKu/swXeKaOn2t
Q/tIreFfpg3wfhBXLa9zv+w/yH+fcltTJdmc4Axe2QXby4YMbZnKvvAtqiVv4Mqg
dTVCE34IHQKBgQCqu/hl7ruF3pomoYmZg/PMQzguGDziAQaoJ+YSrrq5I5zMRXVN
30agaR3PZhWN1dBiM7qylz7Q86yrKQBGgEPXuLvWoZTkVwp3xQQaG3aDWwNhu/Xr
yQD2fHAXz+afwzvSFwVjcpuSxwD78ffCsAA4hwMKumT20E5A24W48c1WDQKBgHjq
Hx5ubRJMeszZ3G2zbfGH8leuuG7Brpvz+1C/CKPVapfgcDepKJK9eb72hcFbJW8B
mFNkH7s9OYRsZuq0YDH8s/q+ZNWljPJ8acHPZDV0v+4VQCsr6gGoeJZ/bgljQFv1
mh+9D+epcOUX+h2dkyXlDCZEzcIEVkJVWgwRuryFAoGBANVy/1Yguzw0PdE3IF59
SU3nTI6+mKkp3b1gkUOXJzXXMjAa43mbR39m4vs0R/0/TC7wm4epIO2H6v6ZJvGk
Dg//fu2YBb7A/pZb0eIgWPWGLfqZnEklt878NKCoZ2iKZSs1k4FuOngx5qMsGHik
w4QLCZUBRdFwpYB+HdK2JHbd
-----END PRIVATE KEY-----
`;
const cert = `-----BEGIN CERTIFICATE-----
MIIDJTCCAg2gAwIBAgIUE5pCNpttoVYPtbFdnfMyl0lSVuQwDQYJKoZIhvcNAQEL
BQAwFDESMBAGA1UEAwwJbG9jYWxob3N0MB4XDTI2MTAxNTAxMTMzMloXDTM2MTAx
MjAxMTMzMlowFDESMBAGA1UEAwwJbG9jYWxob3N0MIIBIjANBgkqhkiG9w0BAQEF
AAOCAQ8AMIIBCgKCAQEAqUCGWN+0LzOy/A5Rw7ggA/ANf64SctNelcHFptiuy2QM
c+zuweYovlhpw1OAulfhjD7CvyyunE9HgPmdDFXq7T/tIaUkGsh4ps/jfkeSPZ4J
tYz0N67BIW4GMduzbLza8We14DqxAFFmnUS9U3598zYm7OGkccXD5FH04Ir/0l4J
Lv2Sp7h12qx2rPdt5E4IQI6wmxTcOO2v/ZDdjGwk7+0lpztcZlh0iPNtYEbQ2/kS
3MTjGWICw9KQ4xIjb5Tfrckh2TGJ/0GYSAC0wdhDIGH4/WudTmWzNTTjalaH6hhm
bb7wgRK+egdds5gKmqnleRx2HgzOxZj/E4kSVEIXewIDAQABo28wbTAdBgNVHQ4E
FgQUj4WoUa23ZZn+2D6rUAckgf/hV/4wHwYDVR0jBBgwFoAUj4WoUa23ZZn+2D6r
UAckgf/hV/4wGgYDVR0RBBMwEYIJbG9jYWxob3N0hwR/AAABMA8GA1UdEwEB/wQF
MAMBAf8wDQYJKoZIhvcNAQELBQADggEBABfM4HHCzpwwMZqb+CAfJI0KgXLB1yln
D/4OKBPaRaICDpMhXPNmaF/7P+U2V/FI1lAtaYPYT5JgPTPI+kzV1hWqkGI3m1kw
LNWDANK1OxqJ/8ghYHZpwTllFOrwSjNSKKpTbEA3HZdxcg8jpC9GOkbFcbUelS+q
tuvgBG2bhQzDdUQRdx9CApzQ8QS+MMQz5Xog1a0Q2csDSQMgsJXeEjWaAcnuhXH8
0kOWM1d1YN4Swtr8F3Ilykr4dSTcPildSpw6zl5ZpF0E0ZRDYnOwqbtClSpdxjWI
pcd3xp1zmP5ibBEz5VIet/TQY3y97vCuHQceUMKjTBLhZlLk3WThGAc=
-----END CERTIFICATE-----
`;

const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
const input = () => ({ email: "synthetic-client@example.invalid", token: randomBytes(32).toString("base64url"), jobId: randomBytes(16) });
const config = (port, caPath) => ({ enabled: true, origin: "https://example.invalid", smtp: {
  host: "localhost", port, user: "synthetic-user", password: "synthetic-password", from: "access@example.invalid",
  ...(caPath ? { caPath } : {}),
} });
const hasCode = (code) => (error) => error instanceof MailDeliveryError && error.code === code && error.cause === undefined;

async function fixture({ port = 587, mode = "success" } = {}) {
  const sockets = new Set(), clients = [], commands = [], tlsInfo = [], content = [], accepted = { count: 0 };
  const stalled = deferred(), ended = deferred();
  const context = createSecureContext({ key, cert });
  function own(socket) { sockets.add(socket); socket.on("error", () => {}); socket.once("close", () => { sockets.delete(socket); if (!sockets.size) ended.resolve(); }); return socket; }
  function protocol(socket, encrypted) {
    let buffer = "", data = false;
    const onData = (chunk) => {
      buffer += chunk.toString("utf8");
      while (buffer.includes("\r\n")) {
        const boundary = buffer.indexOf("\r\n"), line = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
        if (data) {
          if (line === ".") {
            data = false;
            if (mode === "stall-data") stalled.resolve();
            else socket.write("250 2.0.0 Synthetic accepted\r\n");
          } else content.push(line);
          continue;
        }
        commands.push({ line, encrypted });
        if (/^EHLO /i.test(line)) socket.write(encrypted
          ? "250-localhost\r\n250 AUTH PLAIN\r\n" : "250-localhost\r\n250-STARTTLS\r\n250 AUTH PLAIN\r\n");
        else if (line === "STARTTLS") {
          socket.off("data", onData); socket.write("220 2.0.0 Ready for TLS\r\n");
          if (mode === "stall-starttls") { socket.on("data", () => stalled.resolve()); }
          else upgrade(socket);
          return;
        } else if (/^AUTH PLAIN /i.test(line) && encrypted) socket.write("235 2.7.0 Synthetic authenticated\r\n");
        else if (/^(?:MAIL FROM:|RCPT TO:)/i.test(line) && encrypted) socket.write("250 2.1.0 Synthetic accepted\r\n");
        else if (line === "DATA" && encrypted) { data = true; socket.write("354 Synthetic data\r\n"); }
        else if (line === "QUIT") { socket.end("221 2.0.0 Bye\r\n"); }
        else socket.end("554 5.7.0 Synthetic rejected\r\n");
      }
    };
    socket.on("data", onData);
  }
  function upgrade(raw) {
    const secure = own(new TLSSocket(raw, { isServer: true, secureContext: context }));
    secure.once("secure", () => { tlsInfo.push({ servername: secure.servername, protocol: secure.getProtocol() }); if (port === 465) secure.write("220 localhost synthetic SMTP\r\n"); });
    protocol(secure, true);
  }
  const server = createServer((socket) => {
    accepted.count += 1;
    own(socket);
    if (mode === "stall-greeting") { stalled.resolve(); return; }
    if (port === 465) {
      if (mode === "stall-tls") socket.on("data", () => stalled.resolve());
      else upgrade(socket);
    } else { protocol(socket, false); socket.write("220 localhost synthetic SMTP\r\n"); }
  });
  const folder = await mkdtemp(join(process.cwd(), ".jessiemessage-smtp-unit-")), caPath = join(folder, "localhost-ca.pem");
  await writeFile(caPath, cert, { mode: 0o600 });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { commands, tlsInfo, content, clients, sockets, accepted, actualPort: server.address().port, stalled: stalled.promise, ended: ended.promise,
    settings: config(port, caPath),
    connectSocket(socket, options) { assert.equal(options.host, "localhost"); assert.equal(options.port, port); clients.push(socket); socket.connect({ host: "127.0.0.1", port: server.address().port }); },
    async close() { for (const socket of sockets) socket.destroy(); await new Promise((resolve) => server.close(resolve)); await rm(folder, { recursive: true, force: true }); },
  };
}

test("real Nodemailer verify deadline tears down an unfinished STARTTLS socket", { timeout: 5000 }, async () => {
  const f = await fixture({ mode: "stall-starttls" });
  const transport = await createVerificationTransport(f.settings, { verifyTimeoutMilliseconds: 200, connectSocket: f.connectSocket });
  try {
    const started = performance.now(), result = assert.rejects(transport.verify(), hasCode("MAIL_VERIFY_FAILED"));
    await f.stalled; await result; await transport.close(); await f.ended;
    assert.ok(performance.now() - started < 2000);
    assert.equal(f.sockets.size, 0); assert.ok(f.clients.every((socket) => socket.destroyed));
    assert.ok(f.commands.some(({ line }) => line === "STARTTLS"));
    assert.equal(f.commands.some(({ line }) => line.startsWith("AUTH")), false);
    assert.equal(f.content.length, 0);
  } finally { await transport.close(); await f.close(); }
});

test("explicit transport close immediately cancels a real verify during implicit TLS negotiation", { timeout: 5000 }, async () => {
  const f = await fixture({ port: 465, mode: "stall-tls" });
  const transport = await createVerificationTransport(f.settings, { connectSocket: f.connectSocket });
  try {
    const result = assert.rejects(transport.verify(), hasCode("MAIL_VERIFY_FAILED"));
    await f.stalled;
    const started = performance.now(), first = transport.close(); assert.equal(transport.close(), first);
    await first; await result; await f.ended;
    assert.ok(performance.now() - started < 1000); assert.equal(f.sockets.size, 0); assert.ok(f.clients[0].destroyed);
    assert.equal(f.commands.length, 0);
    await assert.rejects(transport.verify(), hasCode("MAIL_VERIFY_FAILED"));
  } finally { await transport.close(); await f.close(); }
});

test("transport shutdown closes concurrent real SMTP sends waiting for final acceptance", { timeout: 5000 }, async () => {
  const f = await fixture({ mode: "stall-data" });
  const transport = await createVerificationTransport(f.settings, { connectSocket: f.connectSocket });
  try {
    const first = assert.rejects(transport.sendVerification(input()), hasCode("MAIL_DELIVERY_FAILED"));
    const second = assert.rejects(transport.sendPasswordReset(input()), hasCode("MAIL_DELIVERY_FAILED"));
    await f.stalled;
    // Both independent workers can use the shared transport concurrently.
    while (f.clients.length < 2) await new Promise((resolve) => setImmediate(resolve));
    const started = performance.now(); await transport.close(); await Promise.all([first, second]); await f.ended;
    assert.ok(performance.now() - started < 1000); assert.equal(f.sockets.size, 0); assert.ok(f.clients.every((socket) => socket.destroyed));
    assert.ok(f.commands.some(({ line }) => line === "DATA"));
    assert.equal(f.commands.some(({ line, encrypted }) => !encrypted && /^(?:AUTH |MAIL FROM:|RCPT TO:|DATA)/i.test(line)), false);
    await assert.rejects(transport.sendVerification(input()), hasCode("MAIL_DELIVERY_FAILED"));
  } finally { await transport.close(); await f.close(); }
});

test("real SMTP retains verified localhost SNI, supplied CA and encrypted authentication on both ports", { timeout: 5000 }, async () => {
  for (const port of [465, 587]) {
    const f = await fixture({ port });
    const transport = await createVerificationTransport(f.settings, { connectSocket: f.connectSocket });
    try {
      assert.equal(await transport.verify(), true);
      assert.equal(await transport.sendVerification(input()), true);
      assert.equal(await transport.sendPasswordReset(input()), true);
      assert.ok(f.tlsInfo.length >= 3); assert.ok(f.tlsInfo.every((info) => info.servername === "localhost" && ["TLSv1.2", "TLSv1.3"].includes(info.protocol)));
      assert.equal(f.commands.some(({ line, encrypted }) => !encrypted && /^(?:AUTH |MAIL FROM:|RCPT TO:|DATA)/i.test(line)), false);
      assert.ok(f.content.some((line) => line.includes("/access#verification=")));
      assert.ok(f.content.some((line) => line.includes("/recover#reset=")));
    } finally { await transport.close(); await f.close(); }
  }
});

test("owning a socket cannot bypass certificate validation when the synthetic CA is absent", { timeout: 5000 }, async () => {
  for (const port of [465, 587]) {
    const f = await fixture({ port });
    const settings = config(port);
    const transport = await createVerificationTransport(settings, { connectSocket: f.connectSocket });
    try {
      await assert.rejects(transport.verify(), hasCode("MAIL_VERIFY_FAILED"));
      assert.equal(f.commands.some(({ line }) => line.startsWith("AUTH")), false); assert.equal(f.content.length, 0);
    } finally { await transport.close(); await f.close(); }
  }
});

test("a supplied trusted CA does not bypass verification of the original SMTP hostname", { timeout: 5000 }, async () => {
  for (const port of [465, 587]) {
    const f = await fixture({ port });
    const transport = await createVerificationTransport({ ...f.settings, smtp: { ...f.settings.smtp, host: "wrong-name.example.invalid" } }, {
      connectSocket(socket, options) { assert.equal(options.host, "wrong-name.example.invalid"); f.clients.push(socket); socket.connect({ host: "127.0.0.1", port: f.actualPort }); },
    });
    try {
      await assert.rejects(transport.verify(), hasCode("MAIL_VERIFY_FAILED"));
      assert.equal(f.commands.some(({ line }) => line.startsWith("AUTH")), false); assert.equal(f.content.length, 0);
    } finally { await transport.close(); await f.close(); }
  }
});

test("close during a pending DNS lookup cannot connect after the lookup returns late", { timeout: 5000 }, async () => {
  const f = await fixture({ mode: "stall-greeting" }); let releaseLookup, client;
  const lookupStarted = deferred();
  const transport = await createVerificationTransport(f.settings, {
    connectSocket(socket) { client = socket; socket.connect({ host: "synthetic-dns.example.invalid", port: f.actualPort,
      lookup(_host, _options, done) { releaseLookup = done; lookupStarted.resolve(); } }); },
  });
  try {
    const result = assert.rejects(transport.sendVerification(input()), hasCode("MAIL_DELIVERY_FAILED"));
    await lookupStarted.promise; await transport.close(); await result;
    releaseLookup(null, [{ address: "127.0.0.1", family: 4 }]); await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(client.destroyed, true); assert.equal(f.accepted.count, 0); assert.equal(f.sockets.size, 0); assert.equal(f.commands.length, 0);
  } finally { await transport.close(); await f.close(); }
});

test("readiness service shutdown closes its real isolated SMTP diagnostic before its wall deadline", { timeout: 5000 }, async () => {
  const f = await fixture({ mode: "stall-starttls" });
  const service = await createReadinessService({ key: randomBytes(32),
    authService: { session: async () => ({ user: { id: "1".repeat(32), role: "admin", pseudonym: "Jess synthétique" },
      csrf: "A".repeat(43), expiresAt: Date.now() + 60000 }) }, authStore: { consumeRateLimit: async () => ({ allowed: true }) },
    features: { clientAccess: false, chat: false, photos: false, clientFiles: false, passwordRecovery: false, broadcasts: false, notifications: false },
    mailConfig: { ...f.settings, smtp: { ...f.settings.smtp, replyTo: f.settings.smtp.from } },
    createTransport: (settings) => createVerificationTransport(settings, { connectSocket: f.connectSocket }),
  });
  try {
    const pending = assert.rejects(service.verifySmtp(randomBytes(32).toString("base64url")), { code: "READINESS_UNAVAILABLE" });
    await f.stalled; const started = performance.now(); await service.close(); await pending; await f.ended;
    assert.ok(performance.now() - started < 1000); assert.equal(f.sockets.size, 0); assert.ok(f.clients.every((socket) => socket.destroyed));
  } finally { await service.close(); await f.close(); }
});
