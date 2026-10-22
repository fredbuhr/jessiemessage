import test from "node:test";
import assert from "node:assert/strict";
import { createServer, request as httpRequest } from "node:http";
import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, open, readFile, rm, statfs, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";
import { createAppServer } from "../server/index.mjs";
import { createCopyCatalog } from "../server/backup/copy-catalog.mjs";
import { createManualBackupRequests } from "../server/backup/manual-backup-files.mjs";
import { createManualBackupHandler } from "../server/backup/manual-backup-http.mjs";
import { createManualBackupService } from "../server/backup/manual-backup-service.mjs";

const origin = "https://jessiemessage.com", token = "A".repeat(43), csrf = Buffer.alloc(32, 2).toString("base64url");
const id = "1".repeat(32), requestId = "2".repeat(32), startedAt = 1792340000000, captureId = `capture-${startedAt}-${"c".repeat(16)}`;
const admin = { Cookie: `__Host-jessie_session=${token}`, Origin: origin, "X-CSRF-Token": csrf };
const session = () => ({ user: { id, role: "admin", pseudonym: "Synthetic operator" }, csrf, expiresAt: startedAt + 3600000 });
async function withDirectory(directory, callback) {
  const before = await lstat(directory, { bigint: true });
  const assertReady = async () => { const after = await lstat(directory, { bigint: true }); assert.equal(after.dev, before.dev); assert.equal(after.ino, before.ino); assert.equal(after.mode & 0o7777n, 0o700n); };
  await assertReady(); const result = await callback({ path: directory, file: name => join(directory, name), assertReady }); await assertReady(); return result;
}
async function fixture(t, options = {}) {
  const base = resolve("../audit"); await mkdir(base, { recursive: true, mode: 0o700 });
  const directory = await mkdtemp(join(base, "manual-backup-http-")); await chmod(directory, 0o700);
  const capture = join(directory, captureId); await mkdir(capture, { mode: 0o700 });
  const bytes = Buffer.alloc(1048589, 97), sha256 = createHash("sha256").update(bytes).digest("hex"), recipientSha256 = "a".repeat(64);
  const ciphertext = join(capture, "checkpoint.tar.gz.gpg"); await writeFile(ciphertext, bytes, { mode: 0o600 });
  await writeFile(join(capture, "encryption-receipt.json"), JSON.stringify({ format: "jessiemessage-checkpoint-encryption", version: 1,
    createdAt: startedAt + 10, encrypted: true, protection: "mdc", decryptionVerified: false, independentCopyPending: true,
    source: { file: "checkpoint.tar.gz", bytes: 10, sha256: "d".repeat(64) },
    recipient: { file: "recipient-public.asc", sha256: recipientSha256, fingerprint: "B".repeat(40) },
    ciphertext: { file: "checkpoint.tar.gz.gpg", bytes: bytes.length, sha256 } }), { mode: 0o600 });
  let stored = { version: 1, revision: 0, requestIds: [], current: null }, saves = 0, transferCalls = 0, currentSession = session();
  const requests = createManualBackupRequests({ operationsDirectory: directory, clock: () => startedAt + 100 }, options.native ? {} : {
    read: async () => structuredClone(stored), save: async value => { await options.beforeSave?.(); stored = structuredClone({ ...value, revision: value.revision + 1 }); saves++; } });
  const realCatalog = createCopyCatalog(directory, { readConfiguration: async () => ({ version: 1, recipientSha256, enabled: true, hourUtc: 5, minuteUtc: 15 }),
    readHistory: async () => ({ records: [{ status: "succeeded", startedAt }] }),
    ...(options.native ? {} : { withDirectory, capturePath: (root, selected) => root.file(selected) }) });
  const catalog = { list: () => realCatalog.list(), transfer: async (selected, consume, settings) => {
    transferCalls++; await options.beforeTransfer?.(settings);
    if (options.hanging) {
      const archive = (await realCatalog.list()).archives[0];
      return consume(archive, { createReadStream() { return new Readable({ read() { this.push(Buffer.from("x")); this._read = () => {}; } }); } });
    }
    return realCatalog.transfer(selected, consume, settings);
  } };
  const service = createManualBackupService(directory, { requests, catalog, clock: () => startedAt + 100 });
  let actorCalls = 0;
  const handler = createManualBackupHandler(service, { origin, actor: async value => {
    actorCalls++; await options.beforeActor?.(actorCalls);
    return value === token ? currentSession : null;
  } });
  const server = createServer(async (request, response) => { if (!await handler(request, response)) { response.writeHead(404); response.end(); } });
  await new Promise(yes => server.listen(0, "127.0.0.1", yes)); const url = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { handler.close(); server.closeAllConnections(); await new Promise(yes => server.close(yes)); await rm(directory, { recursive: true, force: true }); });
  const get = (path, headers = admin) => fetch(url + path, { headers });
  const post = (body = { requestId }, headers = admin, path = "/api/admin/backups/captures") => fetch(url + path,
    { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
  return { directory, ciphertext, bytes, sha256, handler, service, requests, server, get, post, setSession: value => { currentSession = value; },
    saves: () => saves, transferCalls: () => transferCalls };
}

test("manual backup page, assets and metadata require the current administrator and never expose schedule, credentials or paths", async t => {
  const f = await fixture(t);
  for (const path of ["/admin/backups", "/manual-backups.js", "/manual-backups.css", "/i18n-manual-backups.js", "/api/admin/backups"]) {
    const anonymous = await f.get(path, {}); assert.equal(anonymous.status, 401, path); assert.equal(anonymous.headers.get("set-cookie"), null);
    const authorized = await f.get(path); assert.equal(authorized.status, 200, path); assert.equal(authorized.headers.get("cache-control"), "no-store");
    assert.equal(authorized.headers.get("access-control-allow-origin"), null); await authorized.arrayBuffer();
  }
  const result = await (await f.get("/api/admin/backups")).json();
  assert.equal(result.mode, "manual"); assert.equal(result.request, null); assert.equal(result.archiveCount, 1);
  assert.equal(result.latestArchive.id, captureId); assert.equal(result.latestArchive.sha256, f.sha256);
  assert.doesNotMatch(JSON.stringify(result), /schedule|destination|recipient|\/|password|token|csrf|privateKey/i);
  f.setSession({ ...session(), user: { ...session().user, role: "client" } });
  assert.equal((await f.get("/api/admin/backups")).status, 401);
  assert.equal((await f.post()).status, 401); assert.equal(f.saves(), 0);
});

test("strict mutation origin, CSRF, closed fields and bounded JSON reject requests before durable intent", async t => {
  const f = await fixture(t);
  for (const headers of [{}, { ...admin, Origin: "https://other.invalid" }, { ...admin, "Sec-Fetch-Site": "cross-site" }, { ...admin, "X-CSRF-Token": "wrong" }]) {
    assert.equal((await f.post({ requestId }, headers)).status, 403);
  }
  for (const body of [{}, { requestId: requestId.toUpperCase().replace(/2/g, "A") }, { requestId: "../key" }, { requestId, directory: "/private" }, { requestId, token }]) {
    assert.equal((await f.post(body)).status, 400);
  }
  assert.equal((await f.post({ requestId }, { ...admin, "Content-Type": "text/plain" })).status, 415);
  assert.equal((await f.post({ requestId: "x".repeat(5000) })).status, 413);
  assert.equal((await f.post({ requestId }, admin, "/api/admin/backups/captures?token=private")).status, 400);
  assert.equal(f.saves(), 0); assert.equal(await f.requests.status(), null);
  for (const cookie of ["__Host-jessie_session=invalid", `__Host-jessie_session=${token}; __Host-jessie_session=${token}`]) {
    const response = await f.get("/api/admin/backups", { Cookie: cookie });
    assert.equal(response.status, 401); assert.match(response.headers.get("set-cookie"), /Max-Age=0/);
  }
  const clientCookie = await f.get("/api/admin/backups", { Cookie: `__Host-jessie_client=${token}` });
  assert.equal(clientCookie.status, 401); assert.equal(clientCookie.headers.get("set-cookie"), null);
});

test("202 follows the durable write; retries reuse one intent and another active request cannot start a capture", async t => {
  let release, entered;
  const saving = new Promise(yes => { entered = yes; }), gate = new Promise(yes => { release = yes; });
  const f = await fixture(t, { beforeSave: async () => { entered(); await gate; } });
  let replied = false;
  const response = f.post().then(value => { replied = true; return value; });
  await saving; assert.equal(replied, false); assert.equal(await f.requests.status(), null);
  release(); const accepted = await response; assert.equal(accepted.status, 202);
  const result = await accepted.json(); assert.equal(result.mode, "manual"); assert.equal(result.request.status, "queued");
  assert.equal((await f.post()).status, 202); assert.equal(f.saves(), 1);
  const busy = await f.post({ requestId: "3".repeat(32) }); assert.equal(busy.status, 429); assert.equal(busy.headers.get("retry-after"), "60");
  assert.deepEqual(await busy.json(), { error: "backup_in_progress" }); assert.equal(f.saves(), 1);
  assert.equal(f.transferCalls(), 0); assert.equal((await f.requests.status()).requestId, requestId);
});

test("session revocation while reading a POST body prevents recording a backup request", async t => {
  let f;
  f = await fixture(t, { beforeActor: calls => { if (calls === 2) f.setSession(null); } });
  assert.equal((await f.post()).status, 401); assert.equal(f.saves(), 0);
});

test("download streams only the verified encrypted descriptor and rechecks the administrator after prehash", async t => {
  const f = await fixture(t), path = `/api/admin/backups/archives/${captureId}`;
  assert.equal((await f.get(path, { Authorization: `Bearer ${token}` })).status, 401);
  assert.equal((await f.get(path + `?token=${token}`)).status, 400);
  const downloaded = await f.get(path); assert.equal(downloaded.status, 200); assert.equal(downloaded.headers.get("x-backup-sha256"), f.sha256);
  assert.equal(downloaded.headers.get("content-length"), String(f.bytes.length)); assert.equal(downloaded.headers.get("content-type"), "application/octet-stream");
  assert.equal(downloaded.headers.get("cache-control"), "no-store"); assert.match(downloaded.headers.get("content-disposition"), /\.tar\.gz\.gpg"$/);
  assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), f.bytes);
  f.setSession(null); assert.equal((await f.get(path)).status, 401); assert.equal(f.transferCalls(), 1);
  let revoked;
  revoked = await fixture(t, { beforeActor: calls => { if (calls === 2) revoked.setSession({ ...session(), csrf: Buffer.alloc(32, 7).toString("base64url") }); } });
  const denied = await revoked.get(path); assert.equal(denied.status, 401); assert.equal(denied.headers.get("x-backup-sha256"), null);
  assert.deepEqual(await denied.json(), { error: "authentication_required" });
});

test("tampered ciphertext and symbolic links are refused before any encrypted download headers", async t => {
  for (const defect of ["hash", "symlink"]) await t.test(defect, async step => {
    const f = await fixture(step);
    if (defect === "hash") await writeFile(f.ciphertext, Buffer.alloc(f.bytes.length, 98), { mode: 0o600 });
    else { const outside = join(f.directory, "outside"); await writeFile(outside, f.bytes, { mode: 0o600 }); await rm(f.ciphertext); await symlink(outside, f.ciphertext); }
    const response = await f.get(`/api/admin/backups/archives/${captureId}`);
    assert.ok([409, 503].includes(response.status)); assert.equal(response.headers.get("x-backup-sha256"), null);
    assert.deepEqual(Object.keys(await response.json()), ["error"]);
  });
});

test("two streaming slots are bounded and shutdown cancels incomplete streams before an offline capture", { timeout: 5000 }, async t => {
  const f = await fixture(t, { hanging: true }), path = `/api/admin/backups/archives/${captureId}`;
  const first = await f.get(path), second = await f.get(path);
  const reader = first.body.getReader(); assert.equal((await reader.read()).done, false);
  const limited = await f.get(path); assert.equal(limited.status, 429); assert.equal(limited.headers.get("retry-after"), "60");
  f.handler.close(); await assert.rejects(reader.read()); await assert.rejects(second.arrayBuffer());
  assert.equal((await f.get("/api/admin/backups")).status, 503);
});

test("manual mode exposes no PC pairing, copy, Windows kit or verification kit route", async t => {
  const f = await fixture(t);
  for (const path of ["/api/backup-copy/manifest", `/api/backup-copy/archives/${captureId}`, "/api/backup-copy/pair", "/api/backup-copy/receipt",
    "/api/admin/backups/destinations", `/api/admin/backups/destinations/${id}/windows-kit`, "/api/admin/backups/verification-kit", "/backups.js"]) {
    assert.equal((await f.get(path)).status, 404, path);
    assert.equal((await f.post({}, admin, path)).status, 404, path);
  }
  assert.equal(f.saves(), 0); assert.equal(f.transferCalls(), 0);
});

test("manual backup assets remain private on a neutral server and on the former origin", async t => {
  const f = await fixture(t), neutral = createAppServer(), legacy = createAppServer({ backupHandler: f.handler, requestOrigin: origin,
    legacyHandlers: { entryHandler: async () => false } });
  for (const server of [neutral, legacy]) {
    await new Promise(yes => server.listen(0, "127.0.0.1", yes));
    t.after(async () => { server.closeAllConnections(); await new Promise(yes => server.close(yes)); });
    for (const path of ["/manual-backups.js", "/manual-backups.css", "/i18n-manual-backups.js", "/admin/backups", "/api/admin/backups"]) {
      const status = await new Promise((yes, no) => {
        const request = httpRequest({ host: "127.0.0.1", port: server.address().port, path, headers: { Host: "recette.jessiemessage.com", ...admin } }, response => { response.resume(); response.once("end", () => yes(response.statusCode)); });
        request.once("error", no); request.end();
      });
      assert.equal(status, 404, path);
    }
  }
});

let nativeUnavailable;
try { if (process.platform !== "linux" || (await statfs("/proc/self/fd", { bigint: true })).type !== 0x9fa0n) nativeUnavailable = "native procfs unavailable"; }
catch { nativeUnavailable = "native procfs unavailable"; }
test("a native durable manual request survives a new reader and the HTTP download uses its pinned ciphertext", { skip: nativeUnavailable }, async t => {
  const f = await fixture(t, { native: true });
  assert.equal((await f.post()).status, 202);
  const persisted = createManualBackupRequests({ operationsDirectory: f.directory });
  assert.equal((await persisted.status()).requestId, requestId);
  const raw = await readFile(join(f.directory, "manual-backup-request.json"), "utf8");
  assert.equal(JSON.parse(raw).current.status, "queued"); assert.doesNotMatch(raw, /token|csrf|\/|key/i);
  const response = await f.get(`/api/admin/backups/archives/${captureId}`); assert.equal(response.status, 200);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), f.bytes);
});
