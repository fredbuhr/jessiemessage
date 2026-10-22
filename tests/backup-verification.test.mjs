import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { crc32 } from "node:zlib";
import { createVerificationKit, validateVerification } from "../server/backup/verification-kit.mjs";
import { createBackupCopyHandler } from "../server/backup/copy-http.mjs";

const id = `capture-1792340000000-${"c".repeat(16)}`, userId = "1".repeat(32), token = "A".repeat(43), csrf = Buffer.alloc(32, 2).toString("base64url"), origin = "https://jessiemessage.com";
const record = { format: "jessiemessage-backup-verification", version: 1,
  archive: { id, startedAt: 1792340000000, filename: `JessieMessage-${id}.tar.gz.gpg`, bytes: 402792, sha256: "a".repeat(64) },
  source: { bytes: 402240, sha256: "d".repeat(64) }, recipient: { fingerprint: "F".repeat(40) }, protection: "mdc" };
function extract(zip) {
  const files = new Map(); let offset = 0;
  while (zip.readUInt32LE(offset) === 0x04034b50) {
    const size = zip.readUInt32LE(offset + 18), length = zip.readUInt16LE(offset + 26), extra = zip.readUInt16LE(offset + 28);
    const name = zip.subarray(offset + 30, offset + 30 + length).toString(), start = offset + 30 + length + extra;
    const bytes = zip.subarray(start, start + size); assert.equal(crc32(bytes), zip.readUInt32LE(offset + 14));
    files.set(name, bytes); offset = start + size;
  }
  return files;
}
test("offline Windows kit contains exact closed metadata and fixed source, with no delegated credential", async () => {
  const bytes = await createVerificationKit(record), files = extract(bytes);
  assert.deepEqual([...files.keys()], ["Verifier.cmd", "JessieMessage-verifier-056.ps1", "verification.json", "LIRE-MOI.txt"]);
  assert.deepEqual(JSON.parse(files.get("verification.json")), record); assert.ok(bytes.length < 131072);
  assert.match(files.get("Verifier.cmd").toString(), /-NoProfile -STA/);
  assert.doesNotMatch(files.get("JessieMessage-verifier-056.ps1").toString(), /Invoke-WebRequest|HttpWebRequest|export-secret|quick-generate-key|passphrase-fd|pinentry-mode.*loopback/);
  for (const invalid of [{ ...record, token }, { ...record, source: { ...record.source, path: "/private" } }, { ...record, recipient: { fingerprint: "invalid" } },
    { ...record, archive: { ...record.archive, filename: "../checkpoint.tar.gz" } }, { ...record, source: { ...record.source, bytes: 2151677953 } }]) {
    assert.throws(() => validateVerification(invalid), { code: "input" }); await assert.rejects(createVerificationKit(invalid), { code: "input" });
  }
});
async function fixture(t, revokeWhilePreparing = false) {
  let revoked = false, reads = 0;
  const actor = async value => value === token && !revoked ? { user: { id: userId, role: "admin", pseudonym: "Fixture" }, csrf, expiresAt: Date.now() + 60000 } : null;
  const service = { async verification(selected) { reads++; assert.equal(selected, id); if (revokeWhilePreparing) revoked = true; return record; } };
  const handler = createBackupCopyHandler(service, { origin, actor });
  const server = createServer(async (request, response) => { if (!await handler(request, response)) { response.writeHead(404); response.end(); } });
  await new Promise(yes => server.listen(0, "127.0.0.1", yes));
  t.after(async () => { server.closeAllConnections(); await new Promise(yes => server.close(yes)); });
  const path = `http://127.0.0.1:${server.address().port}/api/admin/backups/verification-kit`;
  const admin = { Origin: origin, Cookie: `__Host-jessie_session=${token}`, "X-CSRF-Token": csrf, "Content-Type": "application/json" };
  return { path, admin, reads: () => reads, post: (body, headers = admin) => fetch(path, { method: "POST", headers, body: JSON.stringify(body) }) };
}
test("verification download requires current admin, origin, CSRF and closed bounded JSON", async t => {
  const f = await fixture(t);
  assert.equal((await fetch(f.path, { headers: f.admin })).status, 405);
  assert.equal((await f.post({ captureId: id }, {})).status, 403);
  assert.equal((await f.post({ captureId: id }, { ...f.admin, Cookie: "" })).status, 401);
  assert.equal((await f.post({ captureId: id }, { ...f.admin, "X-CSRF-Token": "bad" })).status, 403);
  assert.equal((await f.post({ captureId: id, key: "must never reach the service" })).status, 400);
  assert.equal((await f.post({ captureId: "x".repeat(5000) })).status, 413);
  assert.equal(f.reads(), 0);
  const response = await f.post({ captureId: id }); assert.equal(response.status, 200); assert.equal(f.reads(), 1);
  assert.equal(response.headers.get("content-type"), "application/zip"); assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("set-cookie"), null); assert.match(response.headers.get("content-disposition"), /JessieMessage-verifier-Windows.zip/);
  const files = extract(Buffer.from(await response.arrayBuffer())); assert.deepEqual(JSON.parse(files.get("verification.json")), record);
});
test("revocation while preparing verification suppresses the entire ZIP", async t => {
  const f = await fixture(t, true), response = await f.post({ captureId: id });
  assert.equal(response.status, 401); assert.equal(f.reads(), 1); assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
  assert.equal(response.headers.get("set-cookie"), null); assert.doesNotMatch(await response.text(), /PK|fingerprint|sha256/);
});
