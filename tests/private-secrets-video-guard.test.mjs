import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { check, run } from "../scripts/private-secrets-backup.mjs";

test("historical coffre profiles refuse video before source reads, GPG or publication on a synthetic dirfd fixture", async t => {
  const base = fileURLToPath(new URL("../../audit/", import.meta.url));
  await mkdir(base, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(path.join(base, "video-profile-guard-")), directory = path.join(root, "private");
  await mkdir(directory, { mode: 0o700 }); t.after(() => rm(root, { recursive: true, force: true }));
  const marker = "synthetic video configuration must remain untouched";
  await writeFile(path.join(directory, "runtime-video.json"), marker, { mode: 0o600 });
  const names = ["runtime-auth.json", "runtime-database.json", "runtime-messaging.json", "runtime-media.json", "runtime-notifications.json", "runtime-crm.json", "admin-setup.json"];
  for (const name of names) await writeFile(path.join(directory, name), "synthetic source must not be read", { mode: 0o600 });
  const original = Object.fromEntries(["open", "lstat", "realpath", "statfs"].map(name => [name, fs.promises[name]]));
  const originalExec = childProcess.execFile, originalSpawn = childProcess.spawn;
  // Keep actual private fixture metadata, but emulate only Linux's dirfd path
  // spelling. This test exercises the refusal, not the OS /proc contract.
  const descriptors = new Map();
  const fixturePath = filename => {
    const match = /^\/proc\/self\/fd\/(\d+)(?:\/(.*))?$/.exec(String(filename));
    if (!match) return filename;
    assert.equal(descriptors.has(Number(match[1])), true);
    return path.join(descriptors.get(Number(match[1])), match[2] ?? "");
  };
  let sourceReads = 0, gpgCalls = 0;
  fs.promises.open = async (...args) => {
    const filename = fixturePath(args[0]), handle = await original.open(filename, ...args.slice(1)), descriptor = handle.fd;
    descriptors.set(descriptor, filename);
    const close = handle.close.bind(handle);
    handle.close = async () => { descriptors.delete(descriptor); return close(); };
    if (path.basename(String(filename)).startsWith("runtime-")) {
      handle.read = async () => { sourceReads++; throw new Error("source content forbidden"); };
    }
    return handle;
  };
  fs.promises.lstat = (...args) => original.lstat(fixturePath(args[0]), ...args.slice(1));
  fs.promises.realpath = (...args) => original.realpath(fixturePath(args[0]), ...args.slice(1));
  fs.promises.statfs = (...args) => args[0] === "/proc/self/fd" ? Promise.resolve({ type: 0x9fa0n }) : original.statfs(...args);
  childProcess.execFile = () => { gpgCalls++; throw new Error("GPG forbidden"); };
  childProcess.spawn = () => { gpgCalls++; throw new Error("GPG forbidden"); };
  syncBuiltinESMExports();
  try {
    for (const profile of [undefined, "auth", "messaging", "messaging-photos", "messaging-photos-notify", "primary-crm"]) {
      const selected = { privateDirectory: directory, output: "never-created.json.gpg", ...(profile === undefined ? {} : { profile }) };
      for (const [operationName, operation] of [["check", () => check(selected)], ["run", () => run(selected, "five synthetic words for recovery")]]) {
        await assert.rejects(operation(), { code: "PRIVATE_SECRETS_SOURCE" }, `${operationName} ${profile ?? "default"}`);
      }
    }
  } finally {
    Object.assign(fs.promises, original); childProcess.execFile = originalExec; childProcess.spawn = originalSpawn; syncBuiltinESMExports();
  }
  assert.equal(sourceReads, 0); assert.equal(gpgCalls, 0);
  assert.equal(descriptors.size, 0);
  assert.deepEqual((await readdir(directory)).sort(), [...names, "runtime-video.json"].sort());
  assert.equal(await readFile(path.join(directory, "runtime-video.json"), "utf8"), marker);
});
