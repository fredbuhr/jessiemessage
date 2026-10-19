import test from "node:test";
import assert from "node:assert/strict";
import { createServer, request as httpRequest } from "node:http";
import { once } from "node:events";
import { createWitnessEnrollmentHandler } from "../server/backup/witness-enrollment-http.mjs";
import { WitnessEnrollmentError } from "../server/backup/witness-enrollment.mjs";
import { createBackupCopyService } from "../server/backup/copy-service.mjs";
import { BackupCopyError, digestCopyToken } from "../server/backup/copy-state.mjs";

const token = "A".repeat(43), attemptId = "d".repeat(32), contractSha256 = "f".repeat(64);
const contract = { contractId: "a".repeat(64), registryId: "b".repeat(64), initialSnapshotSha256: "c".repeat(64),
  destination: { destinationId: "a".repeat(32), pairedAt: 1792407500000, pairingFingerprint: "e".repeat(64) } };
const body = () => ({ version: 1, destinationId: contract.destination.destinationId, attemptId });
const packet = initialize => ({ version: 1, initialize, destinationId: contract.destination.destinationId, attemptId, contractSha256,
  contractId: contract.contractId, registryId: contract.registryId, initialSnapshotSha256: contract.initialSnapshotSha256 });
const ROUTE = "/api/backup-copy/witness/enroll";
async function fixture(t, changes = {}) {
  const events = []; let spent = false;
  const enrollment = { async reserve(value) { events.push("reserve"); assert.deepEqual(value, body()); const result = packet(!spent); spent = true; return result; } };
  const authorize = async value => { events.push("authorize"); assert.equal(value, token); return { ...contract.destination }; };
  const handler = createWitnessEnrollmentHandler({ enrollment, contract, authorize, ...changes });
  const server = createServer((request, response) => { void handler(request, response).then(handled => {
    if (!handled) { response.writeHead(404); response.end(); }
  }).catch(error => { response.destroy(error); }); });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(async () => { handler.close(); await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); });
  async function send({ method = "POST", target = ROUTE, value = body(), text, headers = {}, remove = [], chunked = false } = {}) {
    const bytes = Buffer.from(text ?? JSON.stringify(value));
    const selected = { Host: "jessiemessage.com", "X-Forwarded-Proto": "https", "X-Jessie-Backup": "1", Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8", ...(chunked ? {} : { "Content-Length": bytes.length }), ...headers };
    for (const name of remove) delete selected[name];
    return new Promise((yes, no) => {
      const request = httpRequest({ host: "127.0.0.1", port: server.address().port, method, path: target, headers: selected, agent: false }, response => {
        const chunks = []; response.on("data", chunk => chunks.push(chunk)); response.on("error", no);
        response.on("end", () => { const text = Buffer.concat(chunks).toString("utf8"); yes({ status: response.statusCode, headers: response.headers, text, value: text ? JSON.parse(text) : null }); });
      });
      request.once("error", no); if (chunked) { request.write(bytes.subarray(0, 2000)); request.end(bytes.subarray(2000)); } else request.end(bytes);
    });
  }
  return { handler, events, enrollment, send };
}

test("native enrollment authenticates exact pairing before and after durable reservation and returns only the fixed packet", async t => {
  const f = await fixture(t), result = await f.send();
  assert.equal(result.status, 200); assert.deepEqual(result.value, packet(true));
  assert.deepEqual(f.events, ["authorize", "authorize", "reserve", "authorize"]);
  assert.equal(result.headers["cache-control"], "no-store"); assert.equal(result.headers["set-cookie"], undefined);
  assert.equal(result.text.includes(token), false); assert.equal(result.text.includes(contract.destination.pairingFingerprint), false);
  assert.deepEqual((await f.send()).value, packet(false));
});

test("authority, browser credentials, methods, query and malformed requests never reserve enrollment", async t => {
  const cases = [
    [{ method: "GET" }, 405], [{ target: ROUTE + "?repair=1" }, 404], [{ target: ROUTE + "/" }, 404],
    [{ headers: { Host: "recette.jessiemessage.com" } }, 404], [{ headers: { "X-Forwarded-Proto": "http" } }, 404],
    [{ headers: { Origin: "https://jessiemessage.com" } }, 403], [{ headers: { Cookie: "session=synthetic" } }, 403],
    [{ headers: { "Sec-Fetch-Mode": "cors" } }, 403], [{ headers: { "X-Jessie-Backup": "0" } }, 403],
    [{ remove: ["Authorization"] }, 401], [{ headers: { "Content-Type": "text/plain" } }, 415],
    [{ value: { ...body(), extra: true } }, 400], [{ value: { ...body(), attemptId: "bad" } }, 400],
    [{ value: { ...body(), destinationId: "9".repeat(32) } }, 400], [{ text: "{" }, 400],
    [{ text: JSON.stringify(body()).replace('"version":1', '"version":1,"version":1') }, 400],
    [{ text: "x".repeat(4097) }, 413], [{ text: "x".repeat(4097), chunked: true }, 413],
  ];
  const f = await fixture(t);
  for (const [input, expected] of cases) {
    const result = await f.send(input); assert.equal(result.status, expected, JSON.stringify(input));
    assert.equal(result.headers["set-cookie"], undefined); assert.equal(result.text.includes(token), false);
  }
  assert.equal(f.events.includes("reserve"), false);
});

test("capability changes before or after reserve prevent packet disclosure without rolling back spent enrollment", async t => {
  for (const mode of ["wrong-id", "wrong-time", "wrong-fingerprint", "revoked-after-reserve"]) await t.test(mode, async step => {
    let calls = 0, spent = false;
    const f = await fixture(step, {
      enrollment: { async reserve() { spent = true; return packet(true); } },
      authorize: async () => {
        calls++; const value = { ...contract.destination };
        if (mode === "wrong-id") value.destinationId = "9".repeat(32);
        if (mode === "wrong-time") value.pairedAt++;
        if (mode === "wrong-fingerprint" || mode === "revoked-after-reserve" && calls === 3) value.pairingFingerprint = "9".repeat(64);
        return value;
      },
    });
    const result = await f.send(); assert.equal(result.status, 403); assert.equal(result.text.includes(contractSha256), false);
    assert.equal(spent, mode === "revoked-after-reserve");
  });
});

test("recovery and arbitrary private failures expose only neutral codes", async t => {
  const recovery = await fixture(t, { enrollment: { async reserve() { throw new WitnessEnrollmentError("RECOVERY_REQUIRED"); } } });
  const blocked = await recovery.send(); assert.equal(blocked.status, 409); assert.deepEqual(blocked.value, { error: "witness_recovery_required" });
  for (const service of ["authorize", "reserve"]) {
    const error = Object.assign(new Error("Synthetic SQL password private cause"), { status: 403, publicCode: "private-secret" });
    const changes = service === "authorize" ? { authorize: async () => { throw error; } } : { enrollment: { async reserve() { throw error; } } };
    const f = await fixture(t, changes), result = await f.send();
    assert.equal(result.status, 503); assert.deepEqual(result.value, { error: "witness_enrollment_unavailable" });
    assert.doesNotMatch(result.text, /Synthetic|SQL|password|private-secret/);
  }
});

test("closed enrollment handler never reserves and unrelated routes remain available to the parent", async t => {
  const f = await fixture(t); f.handler.close(); assert.equal((await f.send()).status, 503);
  const unrelated = await f.send({ target: "/api/backup-copy/witness/poll" }); assert.equal(unrelated.status, 404);
  assert.equal(f.events.includes("reserve"), false);
});

test("real backup capability rejection and pause return 403 before or after reservation without disclosing a packet", async t => {
  for (const code of ["unauthorized", "paused"]) for (const phase of ["before-reserve", "after-reserve"]) await t.test(`${code}/${phase}`, async step => {
    let rejected = phase === "before-reserve", spent = false;
    const fingerprint = digestCopyToken(token), pinned = { ...contract, destination: { ...contract.destination, pairingFingerprint: fingerprint } };
    const copies = createBackupCopyService("/synthetic-unused-directory", {
      read: async () => ({ version: 1, revision: 1, destinations: rejected && code === "unauthorized" ? [] : [{ id: pinned.destination.destinationId,
        label: "Synthetic computer", kind: "computer", enabled: !(rejected && code === "paused"), pairHash: null, pairExpiresAt: null,
        tokenHash: fingerprint, pairedAt: pinned.destination.pairedAt, lastSeenAt: null, locationId: null, lastReceipt: null }] }),
    });
    const f = await fixture(step, { contract: pinned,
      authorize: async value => {
        try { return await copies.authorizeWitness(value); }
        catch (error) { assert.equal(error instanceof BackupCopyError, true); assert.equal(error.code, code); throw error; }
      },
      enrollment: { async reserve() { spent = true; rejected = true; return packet(true); } },
    });
    const result = await f.send(); assert.equal(result.status, 403); assert.deepEqual(result.value, { error: "copy_authorization_rejected" });
    assert.equal(spent, phase === "after-reserve"); assert.equal(result.text.includes(contractSha256), false); assert.equal(result.text.includes(token), false);
  });
});

test("plain errors imitating backup capability codes stay neutral 503 failures at both authorization boundaries", async t => {
  for (const code of ["unauthorized", "paused"]) for (const phase of ["before-reserve", "after-reserve"]) await t.test(`${code}/${phase}`, async step => {
    let rejectNow = phase === "before-reserve", spent = false;
    const imitation = Object.assign(new Error("Synthetic SQL password private failure"), { code, status: 403, publicCode: "private-secret" });
    const f = await fixture(step, {
      authorize: async () => { if (rejectNow) throw imitation; return { ...contract.destination }; },
      enrollment: { async reserve() { spent = true; rejectNow = true; return packet(true); } },
    });
    const result = await f.send(); assert.equal(result.status, 503); assert.deepEqual(result.value, { error: "witness_enrollment_unavailable" });
    assert.equal(spent, phase === "after-reserve"); assert.doesNotMatch(result.text, /Synthetic|SQL|password|private-secret/);
  });
  const unavailable = await fixture(t, { authorize: async () => { throw new BackupCopyError("unavailable"); } });
  assert.equal((await unavailable.send()).status, 503);
});
