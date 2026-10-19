import test from "node:test";
import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import { connect } from "node:net";
import { createWitnessRecoveryServer } from "../server/backup/witness-recovery-server.mjs";

let unavailable;
async function freePort() {
  const probe = createServer();
  try {
    await new Promise((yes, no) => { probe.once("error", no); probe.listen(0, "127.0.0.1", yes); });
    return probe.address().port;
  } finally { await new Promise(done => probe.close(done)); }
}
try { await freePort(); } catch { unavailable = "Native loopback listeners unavailable"; }
test("Linux CI requires the actual recovery-only HTTP listener", { skip: !process.env.CI || process.platform !== "linux" }, () => assert.equal(unavailable, undefined));
function call(port, path) {
  return new Promise((yes, no) => {
    const req = request({ host: "127.0.0.1", port, path, agent: false, headers: { Host: "jessiemessage.com" } }, res => {
      res.resume(); res.once("end", () => yes({ status: res.statusCode, cache: res.headers["cache-control"] }));
    }); req.once("error", no); req.end();
  });
}
test("recovery HTTP serves only the selected control and refuses application readiness or arbitrary targets", { skip: unavailable }, async t => {
  const port = await freePort(), seen = [];
  const server = createWitnessRecoveryServer({ port, control: async (req, res) => {
    seen.push(req.url); if (req.url !== "/__synthetic_pc") return false;
    res.writeHead(204); res.end(); return true;
  } }); t.after(() => server.close());
  await server.start(); server.assertReady(); assert.equal((await call(port, "/__synthetic_pc")).status, 204);
  for (const resource of ["/", "/api/health", "/api/ready", "/api/auth/login", "/api/backups", "https://unselected.invalid/"]) {
    const result = await call(port, resource); assert.equal(result.status, 503); assert.equal(result.cache, "no-store");
  }
  assert.ok(!seen.includes("https://unselected.invalid/"));
  await server.close(); assert.deepEqual(await server.finished, { failed: false });
  assert.throws(() => server.assertReady(), { code: "WITNESS_RECOVERY_UNAVAILABLE" });
});
test("recovery listener port collision leaves the existing server available", { skip: unavailable }, async t => {
  const original = createServer((_req, res) => { res.writeHead(202); res.end(); });
  await new Promise(done => original.listen(0, "127.0.0.1", done)); t.after(() => new Promise(done => original.close(done)));
  const port = original.address().port, recovery = createWitnessRecoveryServer({ port, control: async () => false });
  await assert.rejects(recovery.start(), { code: "WITNESS_RECOVERY_UNAVAILABLE" }); await recovery.close();
  assert.equal((await call(port, "/api/ready")).status, 202);
});
test("closing recovery HTTP drops pending sockets and refuses restart", { skip: unavailable }, async t => {
  const port = await freePort(), server = createWitnessRecoveryServer({ port, control: async () => false });
  t.after(() => server.close()); await server.start();
  const client = connect(port, "127.0.0.1"); client.on("error", () => {});
  await new Promise(done => client.once("connect", done)); const ended = new Promise(done => client.once("close", done));
  await server.close(); await ended; await server.close();
  await assert.rejects(server.start(), { code: "WITNESS_RECOVERY_UNAVAILABLE" });
});
