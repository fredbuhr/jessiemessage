import test from "node:test";
import assert from "node:assert/strict";
import { createServer, request as httpRequest } from "node:http";
import { Readable } from "node:stream";
import { mkdir, mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createBackupCopyHandler } from "../server/backup/copy-http.mjs";
import { createBackupCopyService } from "../server/backup/copy-service.mjs";
import { digestCopyToken, emptyCopyState, validateCopyState } from "../server/backup/copy-state.mjs";
import { createAppServer } from "../server/index.mjs";

const token = "A".repeat(43), csrf = Buffer.alloc(32, 2).toString("base64url"), origin = "https://jessiemessage.com", id = "1".repeat(32), generation = "2".repeat(32);
const actor = async value => value === token ? { user: { id, role: "admin", pseudonym: "Synthetic operator" }, csrf, expiresAt: Date.now() + 3600000 } : null;
async function fixture(t, hangingTransfer = false) {
  const base = resolve("../audit"); await mkdir(base, { recursive: true }); const directory = await mkdtemp(join(base, "copy-http-")), filePath = join(directory, "encrypted-fixture"); await writeFile(filePath, "GPG fixture");
  const archive = { id: `capture-1792340000000-${"c".repeat(16)}`, startedAt: 1792340000000, bytes: 11, sha256: "d".repeat(64), filename: "fixture.tar.gz.gpg" };
  let stored = emptyCopyState(), transfers = 0;
  const service = createBackupCopyService("/synthetic", { read: async () => structuredClone(stored), save: async value => { stored = validateCopyState({ ...value, revision: value.revision + 1 }); },
    readCapacity: async () => ({ records: 2, rootEntries: 8 }),
    catalog: { async list() { return { version: 1, schedule: { enabled: true, hourUtc: 5, minuteUtc: 15 }, archives: [archive] }; }, async transfer(_id, consume) { transfers++; const file = await open(filePath); try { return await consume(archive, hangingTransfer ? { createReadStream() { return new Readable({ read() { this.push(Buffer.from("x")); this._read = () => {}; } }); } } : file); } finally { await file.close(); } } } });
  const handler = createBackupCopyHandler(service, { origin, actor });
  const server = createServer(async (request, response) => { if (!await handler(request, response)) { response.writeHead(404); response.end(); } });
  await new Promise(yes => server.listen(0, "127.0.0.1", yes)); const url = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { server.closeAllConnections(); await new Promise(yes => server.close(yes)); await rm(directory, { recursive: true, force: true }); });
  const get = (path, headers = {}) => fetch(url + path, { headers });
  const post = (path, body = {}, headers = {}) => fetch(url + path, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
  return { service, handler, archive, get, post, admin: { Cookie: `__Host-jessie_session=${token}`, Origin: origin, "X-CSRF-Token": csrf }, transfers: () => transfers };
}
test("all backup UI assets and settings require a current administrator with no-store headers", async t => {
  const f = await fixture(t);
  for (const path of ["/admin/backups", "/backups.js", "/backups.css", "/i18n-backups.js", "/api/admin/backups"]) {
    const anonymous = await f.get(path); assert.equal(anonymous.status, 401); assert.equal(anonymous.headers.get("cache-control"), "no-store"); assert.match(anonymous.headers.get("set-cookie"), /Max-Age=0/);
    const response = await f.get(path, f.admin); assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("access-control-allow-origin"), null); assert.equal(response.headers.get("set-cookie"), null); await response.arrayBuffer();
  }
});
test("origin, CSRF, bounded JSON and closed mutation fields are enforced before settings change", async t => {
  const f = await fixture(t), body = { label: "Mon PC", kind: "computer" }, path = "/api/admin/backups/destinations";
  for (const [headers, expected] of [[{}, 403], [{ ...f.admin, Origin: "https://other.invalid" }, 403], [{ ...f.admin, "X-CSRF-Token": "C".repeat(43) }, 403]]) assert.equal((await f.post(path, body, headers)).status, expected);
  assert.equal((await f.post(path, { ...body, directory: "/tmp" }, f.admin)).status, 400);
  assert.equal((await f.post(path, { label: "x".repeat(5000), kind: "computer" }, f.admin)).status, 413);
  assert.equal((await f.service.summary()).destinations.length, 0);
  const created = await f.post(path, body, f.admin); assert.equal(created.status, 201);
  assert.equal((await f.service.summary()).destinations.length, 1);
});
test("agent pairing rejects browsers; cookie authorization and credentials in URLs never download", async t => {
  const f = await fixture(t), destination = await f.service.create({ label: "Mon PC", kind: "computer" }), kit = await f.service.preparePairing(destination.id), pairBody = { destinationId: destination.id, pairingCode: kit.pairingCode };
  assert.equal((await f.post("/api/backup-copy/pair", pairBody, { Origin: origin, "X-Jessie-Backup": "1" })).status, 403);
  const paired = await f.post("/api/backup-copy/pair", pairBody, { "X-Jessie-Backup": "1" }); assert.equal(paired.status, 200); const credential = await paired.json();
  const agent = { "X-Jessie-Backup": "1", Authorization: `Bearer ${credential.token}`, "X-Backup-Location": generation };
  assert.equal((await f.get("/api/backup-copy/manifest", f.admin)).status, 403);
  assert.equal((await f.get("/api/backup-copy/manifest", { "X-Jessie-Backup": "1", ...f.admin, Origin: undefined })).status, 403);
  assert.equal((await f.get("/api/backup-copy/manifest?token=" + credential.token, agent)).status, 400);
  assert.equal((await f.get("/api/backup-copy/manifest", agent)).status, 200);
  const response = await f.get(`/api/backup-copy/archives/${f.archive.id}`, agent);
  assert.equal(response.status, 200); assert.equal(await response.text(), "GPG fixture"); assert.equal(response.headers.get("x-backup-sha256"), f.archive.sha256);
  assert.equal(response.headers.get("cache-control"), "no-store"); assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(f.transfers(), 1);
  await f.service.revoke(destination.id);
  assert.equal((await f.get(`/api/backup-copy/archives/${f.archive.id}`, agent)).status, 401); assert.equal(f.transfers(), 1);
});
test("Windows kit is an authenticated CSRF-protected download and never embeds an admin credential", async t => {
  const f = await fixture(t), destination = await f.service.create({ label: "Mon PC", kind: "computer" }), path = `/api/admin/backups/destinations/${destination.id}/windows-kit`;
  assert.equal((await f.post(path, {}, { ...f.admin, "X-CSRF-Token": "bad" })).status, 403);
  const response = await f.post(path, {}, f.admin); assert.equal(response.status, 200); assert.equal(response.headers.get("content-type"), "application/zip");
  const bytes = Buffer.from(await response.arrayBuffer()); assert.equal(bytes.readUInt32LE(0), 0x04034b50); assert.ok(bytes.includes(Buffer.from("Installer.cmd")));
  assert.ok(bytes.includes(Buffer.from("raccordement.json"))); assert.equal(bytes.includes(Buffer.from(token)), false); assert.equal(bytes.includes(Buffer.from(csrf)), false);
  assert.equal(bytes.includes(Buffer.from("BEGIN PGP PRIVATE KEY")), false); assert.ok(bytes.length < 131072);
});
test("legacy origin and unconfigured runtime cannot expose backup settings or agent endpoints", async t => {
  const f = await fixture(t), server = createAppServer({ backupHandler: f.handler, requestOrigin: origin, legacyHandlers: { entryHandler: async () => false } });
  await new Promise(yes => server.listen(0, "127.0.0.1", yes)); t.after(async () => { server.closeAllConnections(); await new Promise(yes => server.close(yes)); });
  for (const path of ["/admin/backups", "/api/admin/backups", "/api/backup-copy/manifest"]) {
    const status = await new Promise((yes, no) => {
      const request = httpRequest({ host: "127.0.0.1", port: server.address().port, path, headers: { Host: "recette.jessiemessage.com", "X-Forwarded-Proto": "https", ...f.admin } }, response => { response.resume(); response.once("end", () => yes(response.statusCode)); });
      request.once("error", no); request.end();
    });
    assert.equal(status, 404);
  }
});

test("runtime shutdown immediately cancels an unfinished ciphertext stream so it cannot block the offline capture", { timeout: 3000 }, async t => {
  const f = await fixture(t, true), destination = await f.service.create({ label: "Mon PC", kind: "computer" }), kit = await f.service.preparePairing(destination.id);
  const paired = await f.service.pair({ destinationId: destination.id, pairingCode: kit.pairingCode });
  const response = await f.get(`/api/backup-copy/archives/${f.archive.id}`, { "X-Jessie-Backup": "1", Authorization: `Bearer ${paired.token}` });
  const reader = response.body.getReader(); assert.equal((await reader.read()).done, false);
  f.handler.close(); await assert.rejects(reader.read());
  assert.equal((await f.get("/api/admin/backups", f.admin)).status, 503);
});

test("updating an already paired PC preserves capability, pairing and receipts without embedding a secret", async t => {
  const f = await fixture(t), destination = await f.service.create({ label: "PC", kind: "computer" });
  const unpaired = await f.post(`/api/admin/backups/destinations/${destination.id}/windows-update-kit`, {}, f.admin);
  assert.equal(unpaired.status, 409); assert.equal(unpaired.headers.get("set-cookie"), null, "Destination state must not log out the administrator.");
  const kit = await f.service.preparePairing(destination.id), paired = await f.service.pair({ destinationId: destination.id, pairingCode: kit.pairingCode });
  await f.service.manifest(paired.token, generation);
  await f.service.acknowledge(paired.token, { captureId: f.archive.id, bytes: f.archive.bytes, sha256: f.archive.sha256, locationId: generation });
  const before = (await f.service.summary()).destinations;
  const response = await f.post(`/api/admin/backups/destinations/${destination.id}/windows-update-kit`, {}, f.admin);
  assert.equal(response.status, 200); const bytes = Buffer.from(await response.arrayBuffer());
  for (const name of ["Mettre-a-jour.cmd", "mise-a-jour.json", "JessieMessage-temoin-067.ps1"]) assert.ok(bytes.includes(Buffer.from(name)));
  for (const secret of [paired.token, kit.pairingCode, token, csrf, "raccordement.json\""]) assert.equal(bytes.includes(Buffer.from(secret)), false);
  assert.deepEqual((await f.service.summary()).destinations, before);
  assert.deepEqual(await f.service.authorizeWitness(paired.token), { destinationId: destination.id, pairedAt: before[0].pairedAt, pairingFingerprint: digestCopyToken(paired.token) });
  await f.service.update(destination.id, { label: "PC", kind: "computer", enabled: false });
  await assert.rejects(f.service.authorizeWitness(paired.token), { code: "paused" });
  await f.service.revoke(destination.id); await assert.rejects(f.service.authorizeWitness(paired.token), { code: "unauthorized" });
});
