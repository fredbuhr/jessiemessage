import test from "node:test";
import assert from "node:assert/strict";
import { chmod, lstat, readFile, readdir, statfs, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { createManualBackupRequests, MANUAL_BACKUP_REQUEST_MAX_AGE } from "../server/backup/manual-backup-files.mjs";
import { erasureDirectory, withErasureDirectory } from "./fixtures/erasure-files.mjs";

const NOW = Date.UTC(2026, 9, 22, 12), ID = "a".repeat(32), OTHER = "b".repeat(32);
const archive = `capture-${NOW}-0123456789abcdef`;
async function fixture(t) {
  const directory = await erasureDirectory(t); let time = NOW;
  const create = () => createManualBackupRequests({ operationsDirectory: directory, clock: () => time }, { withDirectory: withErasureDirectory });
  return { directory, requests: create(), create, advance(milliseconds) { time += milliseconds; } };
}

test("manual request is durable/private and the same identity cannot create another capture", async t => {
  const f = await fixture(t);
  assert.equal(await f.requests.status(), null);
  const queued = await f.requests.request({ requestId: ID });
  assert.equal(queued.status, "queued"); assert.equal(queued.captureId, null);
  assert.deepEqual(await f.create().request({ requestId: ID }), queued);
  assert.equal((await lstat(path.join(f.directory, "manual-backup-request.json"))).mode & 0o7777, 0o600);
  assert.deepEqual(await readdir(f.directory), ["manual-backup-request.json"]);
  await assert.rejects(f.requests.request({ requestId: OTHER }), { code: "MANUAL_BACKUP_BUSY" });
  assert.equal((await f.requests.claim(ID)).status, "running");
  await assert.rejects(f.requests.request({ requestId: OTHER }), { code: "MANUAL_BACKUP_BUSY" });
  const complete = await f.requests.complete(ID, archive);
  assert.equal(complete.status, "complete"); assert.equal(complete.captureId, archive);
  assert.deepEqual(await f.create().request({ requestId: ID }), complete);
  assert.equal((await f.requests.request({ requestId: OTHER })).status, "queued");
  await assert.rejects(f.requests.request({ requestId: ID }), { code: "MANUAL_BACKUP_CHANGED" });
});

let native = false;
try { native = (await statfs("/proc/self/fd", { bigint: true })).type === 0x9fa0n; } catch {}
test("Linux CI exercises native private manual request storage", { skip: !process.env.CI || process.platform !== "linux" }, () => assert.equal(native, true));
test("native private directory persists and reloads a manual demand", { skip: !native }, async t => {
  const directory = await erasureDirectory(t), make = () => createManualBackupRequests({ operationsDirectory: directory, clock: () => NOW });
  const queued = await make().request({ requestId: ID }); assert.deepEqual(await make().status(), queued);
});

test("startup never retries an uncertain running capture or an expired queued request", async t => {
  const f = await fixture(t);
  await f.requests.request({ requestId: ID }); await f.requests.claim(ID);
  const interrupted = await f.create().recover();
  assert.equal(interrupted.status, "failed"); assert.equal(interrupted.code, "INTERRUPTED"); assert.equal(interrupted.captureId, null);
  assert.deepEqual(await f.create().recover(), interrupted);
  await f.requests.request({ requestId: OTHER }); f.advance(MANUAL_BACKUP_REQUEST_MAX_AGE + 1);
  const expired = await f.create().recover();
  assert.equal(expired.status, "failed"); assert.equal(expired.code, "EXPIRED");
  await assert.rejects(f.requests.claim(OTHER), { code: "MANUAL_BACKUP_CHANGED" });
});

test("queued demand remains bounded when the parent claims it and no failure exposes an archive", async t => {
  const f = await fixture(t); await f.requests.request({ requestId: ID });
  f.advance(MANUAL_BACKUP_REQUEST_MAX_AGE + 1);
  assert.equal((await f.requests.claim(ID)).code, "EXPIRED");
  await f.requests.request({ requestId: OTHER }); await f.requests.claim(OTHER);
  const failed = await f.requests.fail(OTHER, "PREFLIGHT_FAILED");
  assert.equal(failed.status, "failed"); assert.equal(failed.captureId, null);
  await assert.rejects(f.requests.complete(OTHER, archive), { code: "MANUAL_BACKUP_CHANGED" });
});

test("untrusted fields, paths, getters and terminal mutation are refused", async t => {
  const f = await fixture(t);
  for (const value of [{}, { requestId: ID, path: "/private" }, { requestId: "../capture" }, { requestId: ID.toUpperCase() },
    { get requestId() { assert.fail("No getter invoked"); } }]) {
    await assert.rejects(async () => f.requests.request(value), { code: "MANUAL_BACKUP_INPUT" });
  }
  await f.requests.request({ requestId: ID });
  await assert.rejects(f.requests.complete(ID, archive), { code: "MANUAL_BACKUP_CHANGED" });
  await assert.rejects(f.requests.claim(OTHER), { code: "MANUAL_BACKUP_CHANGED" });
  await f.requests.claim(ID); await f.requests.fail(ID, "CANCELLED");
  await assert.rejects(f.requests.fail(ID, "CANCELLED"), { code: "MANUAL_BACKUP_CHANGED" });
});

test("two processes cannot replace an acknowledged request with a competing identity", async t => {
  const f = await fixture(t);
  const results = await Promise.allSettled([f.requests.request({ requestId: ID }), f.create().request({ requestId: OTHER })]);
  assert.equal(results.filter(value => value.status === "fulfilled").length, 1);
  assert.equal(results.filter(value => value.status === "rejected").length, 1);
  const saved = await f.requests.status();
  assert.ok([ID, OTHER].includes(saved.requestId)); assert.equal(saved.status, "queued");
  assert.deepEqual(await readdir(f.directory), ["manual-backup-request.json"]);
});

test("tampered and linked request files fail closed without changing their contents", async t => {
  for (const defect of ["duplicate", "symlink", "permissions"]) {
    const f = await fixture(t), name = path.join(f.directory, "manual-backup-request.json");
    await f.requests.request({ requestId: ID }); let bytes = await readFile(name, "utf8");
    if (defect === "duplicate") { bytes = bytes.trimEnd().slice(0, -1) + ',"revision":1}\n'; await writeFile(name, bytes, { mode: 0o600 }); }
    if (defect === "symlink") {
      const outside = path.join(f.directory, "outside.json"); await writeFile(outside, bytes, { mode: 0o600 });
      const { unlink } = await import("node:fs/promises"); await unlink(name); await symlink(outside, name);
    }
    if (defect === "permissions") await chmod(name, 0o640);
    await assert.rejects(f.requests.status());
    assert.equal(await readFile(name, "utf8"), bytes);
  }
});
