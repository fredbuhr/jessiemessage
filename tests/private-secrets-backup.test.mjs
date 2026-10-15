import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import childProcess, { spawnSync } from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { chmod, link, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { parseArguments, check, run, verifyCiphertext, main } from "../scripts/private-secrets-backup.mjs";

const repository = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const password = "five synthetic words for private recovery";
const marker = "synthetic_SQL_secret_not_for_reports";
const sourceNames = ["runtime-auth.json", "admin-setup.json", "runtime-database.json"];
const unavailable = (error) => /^PRIVATE_SECRETS_[A-Z]+$/.test(error.code) && error.message === error.code;
const authentication = () => ({ format: "jessiemessage-runtime-auth", version: 1, origin: "https://recette.jessiemessage.com", mfaKey: Buffer.alloc(32, 31).toString("base64url") });
const database = () => ({ format: "jessiemessage-runtime-database", version: 1, host: "sql.example.invalid", port: "3306", database: "synthetic_database", user: "synthetic_runtime", password: marker, privilegeProfile: "strict" });
const setup = () => ({ schema: "jessiemessage-admin-setup-v1", createdAt: "2026-10-15T22:00:00.000Z", email: "contact@jessiemessage.com", pseudonym: "Jess", totp: { issuer: "JessieMessage", algorithm: "SHA1", digits: 6, period: 30, secret: "A".repeat(32), uri: "otpauth://totp/synthetic" }, recoveryCodes: Array.from({ length: 8 }, (_, index) => Array(8).fill(index.toString(16).repeat(4)).join("-")), instructions: ["Synthetic fixture only"] });
const supported = process.platform === "linux" && fs.existsSync("/proc/self/fd") && fs.existsSync("/usr/bin/gpg");

async function fixture(t) {
  const base = path.resolve(repository, "../audit");
  await mkdir(base, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(path.join(base, "private-secrets-")); await chmod(root, 0o700);
  const directory = path.join(root, "private"); await mkdir(directory, { mode: 0o700 }); await chmod(directory, 0o700);
  t.after(() => rm(root, { recursive: true, force: true }));
  const content = [authentication(), setup(), database()].map((value) => JSON.stringify(value) + "\n");
  for (let index = 0; index < sourceNames.length; index += 1) await writeFile(path.join(directory, sourceNames[index]), content[index], { mode: 0o600 });
  return { root, directory, content, selected: { privateDirectory: directory, output: "synthetic-private-secrets.json.gpg" } };
}

async function hookOpen(callback, operation) {
  const original = fs.promises.open;
  fs.promises.open = async (...args) => callback(original, args); syncBuiltinESMExports();
  try { return await operation(); }
  finally { fs.promises.open = original; syncBuiltinESMExports(); }
}

test("private secrets options only allow a canonical external directory and a safe .json.gpg basename", () => {
  const good = ["--private-directory", path.resolve(repository, "../private-example"), "--output", "recovery-2026.json.gpg"];
  assert.deepEqual(parseArguments(good), { privateDirectory: good[1], output: good[3] });
  for (const args of [[], [...good, "--password", password], ["--unknown", good[1], ...good.slice(2)],
    ...[repository, path.join(repository, "public"), "/", "relative", "/tmp/../private", "/tmp//private", "/tmp/private/", "/tmp/a\\b"].map((directory) => [good[0], directory, ...good.slice(2)]),
    ...["../out.json.gpg", "/out.json.gpg", "-out.json.gpg", "a/b.json.gpg", "out.gpg", "out.json.gpg\n"].map((name) => [...good.slice(0, 3), name])]) assert.throws(() => parseArguments(args), unavailable);
});

test("Linux CI requires the real GPG and anchored path tests", { skip: !process.env.CI || process.platform !== "linux" }, () => assert.equal(supported, true));

test("check reads only source metadata, creates nothing and exposes no content", { skip: !supported }, async (t) => {
  const f = await fixture(t); let sourceReads = 0, opened = 0, closed = 0;
  const result = await hookOpen(async (original, args) => {
    const handle = await original(...args), close = handle.close.bind(handle); opened += 1;
    handle.close = async () => { await close(); closed += 1; };
    if (sourceNames.includes(path.basename(String(args[0])))) handle.read = async () => { sourceReads += 1; throw new Error(marker); };
    return handle;
  }, () => check(f.selected));
  assert.equal(sourceReads, 0); assert.equal(opened, closed);
  assert.deepEqual(result, { status: "checked", files: 3, sourceContentsRead: false, gpgAvailable: true, secretsOnly: true, databaseBackup: false });
  assert.deepEqual((await readdir(f.directory)).sort(), [...sourceNames].sort());
  assert.equal(JSON.stringify(result).includes(marker), false);
  let cliOutput = "";
  const cli = await main(["check", "--private-directory", f.directory, "--output", f.selected.output], {
    inputStream: { isTTY: true, [Symbol.asyncIterator]() { throw new Error("check must not consume stdin"); } },
    outputStream: { write(value) { cliOutput += value; } },
  });
  assert.equal(cli.sourceContentsRead, false); assert.equal(JSON.parse(cliOutput).status, "checked");
});

test("real GPG makes a portable authenticated three-file JSON coffre without disk plaintext or secret argv/env", { skip: !supported }, async (t) => {
  const f = await fixture(t), original = childProcess.spawn; const observed = [];
  childProcess.spawn = (...args) => {
    observed.push({ executable: args[0], args: args[1], env: args[2].env });
    assert.equal(JSON.stringify(args).includes(password), false); assert.equal(JSON.stringify(args).includes(marker), false);
    return original(...args);
  }; syncBuiltinESMExports();
  let result;
  try { result = await run(f.selected, password); }
  finally { childProcess.spawn = original; syncBuiltinESMExports(); }
  assert.equal(observed.length, 2);
  for (const command of observed) {
    assert.equal(command.executable, "/usr/bin/gpg");
    for (const flag of ["--no-options", "--batch", "--pinentry-mode", "--no-symkey-cache", "--no-autostart", "--passphrase-fd"]) assert.ok(command.args.includes(flag));
    assert.equal(command.args[command.args.indexOf("--passphrase-fd") + 1], "3");
  }
  const encrypted = await readFile(path.join(f.directory, f.selected.output));
  assert.equal(result.status, "saved"); assert.equal(result.output, f.selected.output); assert.equal(result.verified, true); assert.equal(result.databaseBackup, false);
  assert.equal(result.bytes, encrypted.length); assert.equal(result.sha256, createHash("sha256").update(encrypted).digest("hex"));
  for (const secret of [password, marker, authentication().mfaKey, setup().totp.secret]) {
    assert.equal(encrypted.includes(Buffer.from(secret)), false); assert.equal(JSON.stringify(result).includes(secret), false);
  }
  const stats = await lstat(path.join(f.directory, f.selected.output));
  assert.equal(stats.mode & 0o7777, 0o600); assert.equal(stats.nlink, 1); assert.equal(stats.uid, process.getuid());
  assert.deepEqual((await readdir(f.directory)).sort(), [...sourceNames, f.selected.output].sort());
  for (let index = 0; index < sourceNames.length; index += 1) assert.equal(await readFile(path.join(f.directory, sourceNames[index]), "utf8"), f.content[index]);
  // Independent standard GPG consumer proves the result needs no bespoke decryptor.
  const home = path.join(f.root, "independent-gpg"); await mkdir(home, { mode: 0o700 });
  const opened = spawnSync("/usr/bin/gpg", ["--no-options", "--batch", "--no-tty", "--no-autostart", "--no-symkey-cache", "--pinentry-mode", "loopback", "--homedir", home, "--passphrase-fd", "0", "--decrypt", path.join(f.directory, f.selected.output)], { input: password, encoding: "utf8", timeout: 30000, maxBuffer: 131072, env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" } });
  assert.equal(opened.status, 0); const payload = JSON.parse(opened.stdout);
  assert.equal(payload.format, "jessiemessage-private-secrets-backup"); assert.equal(payload.version, 1); assert.equal(payload.applicationVersion, "0.24.0");
  assert.equal(new Date(payload.createdAt).toISOString(), payload.createdAt);
  assert.deepEqual(payload.files.map((file) => file.name), sourceNames);
  for (let index = 0; index < sourceNames.length; index += 1) {
    assert.equal(payload.files[index].content, f.content[index]); assert.equal(payload.files[index].encoding, "utf-8");
    assert.equal(payload.files[index].sha256, createHash("sha256").update(f.content[index]).digest("hex"));
  }
});

test("real GPG verification refuses wrong phrases, corruption and truncation without returning plaintext", { skip: !supported }, async (t) => {
  const f = await fixture(t); await run(f.selected, password);
  const ciphertext = await readFile(path.join(f.directory, f.selected.output));
  const verification = { ...f.selected, output: "verification-never-written.json.gpg" };
  assert.deepEqual(await verifyCiphertext(verification, ciphertext, password), { verified: true, files: 3, secretsOnly: true, databaseBackup: false });
  const corrupted = Buffer.from(ciphertext); corrupted[Math.floor(corrupted.length / 2)] ^= 1;
  for (const [bytes, phrase] of [[ciphertext, "a different synthetic recovery password"], [corrupted, password], [ciphertext.subarray(0, ciphertext.length - 16), password]]) {
    await assert.rejects(verifyCiphertext(verification, bytes, phrase), (error) => unavailable(error) && !String(error).includes(password) && !String(error).includes(marker));
  }
  assert.deepEqual((await readdir(f.directory)).sort(), [...sourceNames, f.selected.output].sort());
});

test("existing output of any type is refused without replacement or passphrase processing", { skip: !supported }, async (t) => {
  const f = await fixture(t), output = path.join(f.directory, f.selected.output);
  await writeFile(output, "keep-existing-ciphertext", { mode: 0o600 });
  await assert.rejects(check(f.selected), unavailable); await assert.rejects(run(f.selected, password), unavailable);
  assert.equal(await readFile(output, "utf8"), "keep-existing-ciphertext"); await unlink(output);
  await symlink(path.join(f.root, "missing"), output); await assert.rejects(check(f.selected), unavailable); await unlink(output);
  await mkdir(output, { mode: 0o700 }); await assert.rejects(check(f.selected), unavailable);
});

test("unsafe source modes, symlinks, hardlinks, nonregular files and bounds fail before publication", { skip: !supported }, async (t) => {
  const f = await fixture(t), source = path.join(f.directory, sourceNames[0]), foreign = path.join(f.root, "foreign");
  await chmod(source, 0o640); await assert.rejects(check(f.selected), unavailable); await chmod(source, 0o600);
  await rename(source, foreign); await symlink(foreign, source); await assert.rejects(check(f.selected), unavailable); await unlink(source);
  await link(foreign, source); await assert.rejects(check(f.selected), unavailable); await unlink(source);
  await mkdir(source, { mode: 0o700 }); await assert.rejects(check(f.selected), unavailable); await rm(source, { recursive: true });
  for (const content of ["", Buffer.alloc(16385, 32), Buffer.from([0xc3, 0x28]), "not-json", JSON.stringify(database())]) {
    await writeFile(source, content, { mode: 0o600 }); await assert.rejects(run(f.selected, password), unavailable);
  }
  await assert.rejects(lstat(path.join(f.directory, f.selected.output)), { code: "ENOENT" });
});

test("private root permissions and symlink aliases are refused", { skip: !supported }, async (t) => {
  const f = await fixture(t); await chmod(f.directory, 0o750); await assert.rejects(check(f.selected), unavailable); await chmod(f.directory, 0o700);
  const alias = path.join(f.root, "alias"); await symlink(f.directory, alias);
  await assert.rejects(check({ ...f.selected, privateDirectory: alias }), unavailable);
});

test("source mutation during a read is refused and every descriptor closes", { skip: !supported }, async (t) => {
  const f = await fixture(t); let changed = false, opened = 0, closed = 0;
  await hookOpen(async (original, args) => {
    const handle = await original(...args), close = handle.close.bind(handle); opened += 1;
    handle.close = async () => { await close(); closed += 1; };
    if (path.basename(String(args[0])) === "runtime-auth.json") {
      const read = handle.read.bind(handle);
      handle.read = async (...parameters) => {
        const result = await read(...parameters);
        if (!changed) { changed = true; await writeFile(String(args[0]), JSON.stringify(authentication()) + "changed", { mode: 0o600 }); }
        return result;
      };
    }
    return handle;
  }, () => assert.rejects(run(f.selected, password), unavailable));
  assert.equal(changed, true); assert.equal(opened, closed);
  await assert.rejects(lstat(path.join(f.directory, f.selected.output)), { code: "ENOENT" });
});

test("source mutation while GPG runs is detected before publishing the ciphertext", { skip: !supported }, async (t) => {
  const f = await fixture(t), original = childProcess.spawn; let mutated = false;
  childProcess.spawn = (...args) => {
    const child = original(...args);
    child.once("close", () => {
      if (!mutated) { mutated = true; fs.writeFileSync(path.join(f.directory, sourceNames[0]), JSON.stringify({ ...authentication(), mfaKey: Buffer.alloc(32, 42).toString("base64url") })); }
    });
    return child;
  }; syncBuiltinESMExports();
  try { await assert.rejects(run(f.selected, password), unavailable); }
  finally { childProcess.spawn = original; syncBuiltinESMExports(); }
  assert.equal(mutated, true); await assert.rejects(lstat(path.join(f.directory, f.selected.output)), { code: "ENOENT" });
  assert.deepEqual((await readdir(f.directory)).sort(), [...sourceNames].sort());
});

test("an output created after preflight is preserved and never overwritten", { skip: !supported }, async (t) => {
  const f = await fixture(t), original = childProcess.spawn; let raced = false;
  childProcess.spawn = (...args) => {
    const child = original(...args);
    child.once("close", () => {
      if (!raced) { raced = true; fs.writeFileSync(path.join(f.directory, f.selected.output), "concurrent-file-keep", { mode: 0o600 }); }
    });
    return child;
  }; syncBuiltinESMExports();
  try { await assert.rejects(run(f.selected, password), unavailable); }
  finally { childProcess.spawn = original; syncBuiltinESMExports(); }
  assert.equal(raced, true); assert.equal(await readFile(path.join(f.directory, f.selected.output), "utf8"), "concurrent-file-keep");
});

test("unknown GPG artifacts remain private and are never recursively removed", { skip: !supported }, async (t) => {
  const f = await fixture(t), original = childProcess.spawn; let artifact;
  childProcess.spawn = (...args) => {
    const child = original(...args), homeFd = args[2].stdio[4];
    child.once("close", () => {
      if (!artifact) {
        const homeName = fs.readdirSync(f.directory).find((name) => name.startsWith(".secrets-gpg-"));
        artifact = path.join(f.directory, homeName, "unknown-keep");
        fs.writeFileSync(`/proc/self/fd/${homeFd}/unknown-keep`, "retain-unknown-artifact", { mode: 0o600 });
      }
    });
    return child;
  }; syncBuiltinESMExports();
  try { await assert.rejects(run(f.selected, password), unavailable); }
  finally { childProcess.spawn = original; syncBuiltinESMExports(); }
  assert.equal(await readFile(artifact, "utf8"), "retain-unknown-artifact");
  await assert.rejects(lstat(path.join(f.directory, f.selected.output)), { code: "ENOENT" });
});

test("replacing the GPG home name preserves both directories and refuses publication", { skip: !supported }, async (t) => {
  const f = await fixture(t), original = childProcess.spawn; let replacement;
  childProcess.spawn = (...args) => {
    const child = original(...args);
    child.once("close", () => {
      if (!replacement) {
        const homeName = fs.readdirSync(f.directory).find((name) => name.startsWith(".secrets-gpg-"));
        const current = path.join(f.directory, homeName);
        replacement = current; fs.renameSync(current, path.join(f.root, "original-gpg-home"));
        fs.mkdirSync(current, { mode: 0o700 }); fs.writeFileSync(path.join(current, "foreign-keep"), "foreign-directory-keep", { mode: 0o600 });
      }
    });
    return child;
  }; syncBuiltinESMExports();
  try { await assert.rejects(run(f.selected, password), unavailable); }
  finally { childProcess.spawn = original; syncBuiltinESMExports(); }
  assert.equal(await readFile(path.join(replacement, "foreign-keep"), "utf8"), "foreign-directory-keep");
  assert.equal((await lstat(path.join(f.root, "original-gpg-home"))).isDirectory(), true);
  await assert.rejects(lstat(path.join(f.directory, f.selected.output)), { code: "ENOENT" });
});

test("replacing the root cannot mix source files from two directories", { skip: !supported }, async (t) => {
  const f = await fixture(t), previous = path.join(f.root, "original"); let replaced = false;
  await hookOpen(async (original, args) => {
    if (!replaced && path.basename(String(args[0])) === "admin-setup.json") {
      replaced = true; await rename(f.directory, previous); await mkdir(f.directory, { mode: 0o700 });
      for (let index = 0; index < sourceNames.length; index += 1) await writeFile(path.join(f.directory, sourceNames[index]), f.content[index].replaceAll("Jess", "Other"), { mode: 0o600 });
    }
    return original(...args);
  }, () => run(f.selected, password));
  assert.equal(replaced, true);
  assert.equal((await lstat(path.join(previous, f.selected.output))).isFile(), true);
  await assert.rejects(lstat(path.join(f.directory, f.selected.output)), { code: "ENOENT" });
});

test("short, malformed and control-containing phrases refuse before output or GPG work", { skip: !supported }, async (t) => {
  const f = await fixture(t);
  for (const phrase of ["", "nineteencharacters!", password + "\n", password + "\0", "\ud800" + password, "x".repeat(4097)]) await assert.rejects(run(f.selected, phrase), unavailable);
  assert.deepEqual((await readdir(f.directory)).sort(), [...sourceNames].sort());
});

test("CLI success prints only ciphertext receipt and failures do not echo input secrets", { skip: !supported }, async (t) => {
  const f = await fixture(t); let output = "";
  await main(["--private-directory", f.directory, "--output", f.selected.output], { inputStream: Readable.from([Buffer.from(password)]), outputStream: { write(value) { output += value; } } });
  assert.equal(JSON.parse(output).status, "saved");
  for (const secret of [password, marker, authentication().mfaKey, setup().totp.secret]) assert.equal(output.includes(secret), false);
  const result = spawnSync(process.execPath, ["scripts/private-secrets-backup.mjs", "--private-directory", f.directory, "--output", f.selected.output], { cwd: repository, input: password, encoding: "utf8", timeout: 10000 });
  assert.equal(result.status, 1); assert.equal(JSON.parse(result.stdout).status, "blocked");
  assert.equal((result.stdout + result.stderr).includes(password), false); assert.equal((result.stdout + result.stderr).includes(marker), false);
});
