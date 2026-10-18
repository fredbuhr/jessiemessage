import test from "node:test";
import assert from "node:assert/strict";
import { constants } from "node:fs";
import { chmod, link, lstat, mkdir, mkdtemp, open, readFile, readdir, rm, statfs, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { readBackupAlertState as realRead, saveBackupAlertState as realSave } from "../server/backup/alert-files.mjs";
import { emptyBackupAlertState } from "../server/backup/alert-state.mjs";

const NAME = "backup-alert-state.json";
async function withDirectory(directory, callback) {
  const initial = await lstat(directory, { bigint: true });
  const valid = value => value.isDirectory() && value.uid === BigInt(process.getuid()) && (value.mode & 0o7777n) === 0o700n;
  assert.ok(valid(initial));
  const scope = { path: directory, file: name => { assert.equal(/[/\\\0]/.test(name), false); return path.join(directory, name); },
    async assertReady() { const current = await lstat(directory, { bigint: true });
      assert.ok(valid(current)); assert.equal(current.dev, initial.dev); assert.equal(current.ino, initial.ino); return current; },
    async sync() { await this.assertReady(); const handle = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY);
      try { await handle.sync(); } finally { await handle.close(); } },
  };
  const result = await callback(scope); await scope.assertReady(); return result;
}
const internal = { withDirectory };
const read = directory => realRead(directory, internal);
const save = (directory, state, revision) => realSave(directory, state, revision, internal);
async function fixture(t) {
  const base = path.resolve("../audit"); await mkdir(base, { recursive: true, mode: 0o700 });
  const directory = await mkdtemp(path.join(base, "backup-alert-files-")); await chmod(directory, 0o700);
  t.after(() => rm(directory, { recursive: true, force: true })); return directory;
}
test("queue creation/replacement is canonical, private, fsynced and leaves no writer lock", async t => {
  const directory = await fixture(t), empty = emptyBackupAlertState();
  assert.deepEqual(await read(directory), empty); assert.deepEqual(await readdir(directory), []);
  const first = await save(directory, empty, 0); assert.equal(first.revision, 1);
  const second = await save(directory, first, 1); assert.equal(second.revision, 2);
  assert.deepEqual(await read(directory), second);
  const stats = await lstat(path.join(directory, NAME)); assert.equal(stats.mode & 0o7777, 0o600); assert.equal(stats.nlink, 1);
  assert.deepEqual(await readdir(directory), [NAME]);
  assert.equal(await readFile(path.join(directory, NAME), "utf8"), `${JSON.stringify(second)}\n`);
});
test("stale revisions and an existing writer lock cannot overwrite or remove state", async t => {
  const directory = await fixture(t), first = await save(directory, emptyBackupAlertState(), 0);
  await assert.rejects(save(directory, emptyBackupAlertState(), 0), { code: "ALERT_CHANGED" });
  await writeFile(path.join(directory, "backup-alert-state.lock"), "existing-owner", { flag: "wx", mode: 0o600 });
  await assert.rejects(save(directory, first, 1), { code: "ALERT_LOCKED" });
  assert.equal(await readFile(path.join(directory, "backup-alert-state.lock"), "utf8"), "existing-owner");
  assert.deepEqual(await read(directory), first);
});
test("linked, multi-linked, nonprivate and nonregular queue entries are refused without modifying their target", async t => {
  for (const defect of ["symlink", "hardlink", "mode", "directory"]) {
    const directory = await fixture(t), name = path.join(directory, NAME), text = `${JSON.stringify(emptyBackupAlertState())}\n`;
    if (defect === "symlink") { await writeFile(path.join(directory, "outside"), text, { mode: 0o600 }); await symlink("outside", name); }
    if (defect === "hardlink") { await writeFile(name, text, { mode: 0o600 }); await link(name, path.join(directory, "alias")); }
    if (defect === "mode") await writeFile(name, text, { mode: 0o640 });
    if (defect === "directory") await mkdir(name, { mode: 0o700 });
    await assert.rejects(read(directory), { code: "ALERT_UNAVAILABLE" });
    await assert.rejects(save(directory, emptyBackupAlertState(), 0), { code: "ALERT_UNAVAILABLE" });
    if (defect !== "directory") assert.equal(await readFile(name, "utf8"), text);
    assert.equal((await readdir(directory)).includes("backup-alert-state.lock"), false);
  }
});
test("duplicate keys, escaped aliases, private fields, malformed bytes and oversized state are rejected", async t => {
  const text = JSON.stringify(emptyBackupAlertState());
  for (const bytes of [text, `${text.slice(0, -1)},"revision":0}\n`, `${text.slice(0, -1)},"revis\\u0069on":0}\n`,
    `${text.slice(0, -1)},"private":"secret"}\n`, " ".repeat(32769), Buffer.from([0xff]), "{\n"]) {
    const directory = await fixture(t); await writeFile(path.join(directory, NAME), bytes, { mode: 0o600 });
    await assert.rejects(read(directory));
  }
});
test("concurrent writers are serialized by exclusive lock and cannot lose an acknowledged revision", async t => {
  const directory = await fixture(t), empty = emptyBackupAlertState();
  const results = await Promise.allSettled([save(directory, empty, 0), save(directory, empty, 0)]);
  assert.equal(results.filter(x => x.status === "fulfilled").length, 1);
  assert.equal(results.filter(x => x.status === "rejected").length, 1);
  assert.equal((await read(directory)).revision, 1); assert.deepEqual(await readdir(directory), [NAME]);
});
let unavailable;
if (process.platform !== "linux") unavailable = "Linux required";
else { try { if ((await statfs("/proc/self/fd", { bigint: true })).type !== 0x9fa0n) unavailable = "procfs unavailable"; } catch { unavailable = "procfs unavailable"; } }
test("Linux CI must exercise the production alert directory anchor", { skip: !process.env.CI || process.platform !== "linux" }, () => assert.equal(unavailable, undefined));
test("real pinned directory descriptors persist and reload the alert queue", { skip: unavailable }, async t => {
  const directory = await fixture(t);
  const first = await realSave(directory, emptyBackupAlertState(), 0);
  assert.deepEqual(await realRead(directory), first);
  const alias = `${directory}-alias`; await symlink(directory, alias); t.after(() => rm(alias, { force: true }));
  await assert.rejects(realRead(alias), { code: "ALERT_UNAVAILABLE" });
  await chmod(directory, 0o750); await assert.rejects(realRead(directory), { code: "ALERT_UNAVAILABLE" });
});
