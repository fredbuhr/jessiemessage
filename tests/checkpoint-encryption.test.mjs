import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { chmod, link, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CheckpointEncryptionError, encryptCheckpointArchive, inspectCheckpointRecipient } from "../server/backup/checkpoint-encryption.mjs";

const repository = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const marker = "synthetic_private_SQL_never_report_this";
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const fingerprint = "A".repeat(40);
const publicArmor = bytes => Buffer.from(`-----BEGIN PGP PUBLIC KEY BLOCK-----\n\n${bytes.toString("base64")}\n-----END PGP PUBLIC KEY BLOCK-----\n`);
const syntheticPublic = publicArmor(Buffer.from([0xc6, 1, 4]));
const listing = ({ validity = "-", expiry = "", capabilities = "eE", keyFingerprint = fingerprint } = {}) =>
  `pub:${validity}:3072:1:AAAAAAAAAAAAAAAA:1700000000:${expiry}:::::${capabilities}:\nfpr:::::::::${keyFingerprint}:\nuid:-::::::::Synthetic fixture:\n`;
const supported = process.platform === "linux" && fs.existsSync("/proc/self/fd") && fs.existsSync("/usr/bin/gpg");
const closedFailure = error => error instanceof CheckpointEncryptionError && /^CHECKPOINT_ENCRYPTION_[A-Z]+$/.test(error.code)
  && error.message === "Private checkpoint encryption could not be confirmed." && !String(error).includes(marker) && !String(error).includes(repository);

async function fixture(t, publicKey = syntheticPublic) {
  const base = path.resolve(repository, "../audit"); await mkdir(base, { mode: 0o700, recursive: true });
  const root = await mkdtemp(path.join(base, "checkpoint-encryption-")); await chmod(root, 0o700);
  t.after(() => rm(root, { recursive: true, force: true }));
  const checkpointDirectory = path.join(root, "checkpoint"), recipientDirectory = path.join(root, "recipient");
  for (const directory of [checkpointDirectory, recipientDirectory]) await mkdir(directory, { mode: 0o700 });
  const source = Buffer.from(`${marker}\n`.repeat(100));
  await writeFile(path.join(checkpointDirectory, "checkpoint.tar.gz"), source, { mode: 0o600, flag: "wx" });
  await writeFile(path.join(recipientDirectory, "recipient-public.asc"), publicKey, { mode: 0o600, flag: "wx" });
  const selected = { checkpointDirectory, recipientDirectory, recipientSha256: digest(publicKey) };
  return { root, source, selected, checkpointDirectory, recipientDirectory };
}
const recipientSelection = f => ({ recipientDirectory: f.recipientDirectory, recipientSha256: f.selected.recipientSha256 });
async function noReceipt(f) { await assert.rejects(lstat(path.join(f.checkpointDirectory, "encryption-receipt.json")), { code: "ENOENT" }); }

function fakeGpg({ inspectText = listing(), ciphertext = Buffer.from("synthetic encrypted archive"), code = 0,
  status = "[GNUPG:] BEGIN_ENCRYPTION 2 9\n[GNUPG:] END_ENCRYPTION\n", before, hang = false, throwSpawn = false } = {}) {
  const observed = [];
  const spawnClient = (executable, args, options) => {
    observed.push({ executable, args, options });
    if (throwSpawn) throw new Error(marker);
    const inspect = args.includes("--show-keys"), child = new EventEmitter();
    child.stdout = new PassThrough(); child.stdio = [null, child.stdout, null, null, null, new PassThrough()];
    let ended = false;
    child.kill = () => { if (!ended) { ended = true; child.stdout.end(); child.stdio[5].end(); queueMicrotask(() => child.emit("close", null, "SIGKILL")); } return true; };
    queueMicrotask(async () => {
      try {
        await before?.({ inspect, args, options });
        if (hang && !inspect || ended) return;
        if (inspect) child.stdout.end(inspectText);
        else { child.stdout.end(ciphertext); child.stdio[5].write(status); }
        child.stdio[5].end(); ended = true;
        setImmediate(() => child.emit("close", inspect ? 0 : code, null));
      } catch { child.kill(); }
    });
    return child;
  };
  return { spawnClient, observed };
}

test("public-recipient preflight uses no checkpoint source, encryption or persistent keyring", { skip: !supported }, async t => {
  const f = await fixture(t), gpg = fakeGpg();
  await rm(f.checkpointDirectory, { recursive: true });
  const actual = await inspectCheckpointRecipient(recipientSelection(f), { spawnClient: gpg.spawnClient });
  assert.deepEqual(actual, { format: "jessiemessage-checkpoint-recipient", version: 1, sha256: f.selected.recipientSha256, fingerprint, usable: true });
  assert.equal(Object.isFrozen(actual), true);
  assert.deepEqual(await readdir(f.recipientDirectory), ["recipient-public.asc"]);
  assert.equal(gpg.observed.length, 1);
  assert.equal(gpg.observed[0].args.includes("--encrypt"), false);
});

test("encryption publishes closed honest metadata and verifies byte hashes on disk", { skip: !supported }, async t => {
  const f = await fixture(t), gpg = fakeGpg(), now = 1792278000000;
  const actual = await encryptCheckpointArchive(f.selected, { spawnClient: gpg.spawnClient, clock: () => now });
  const ciphertext = await readFile(path.join(f.checkpointDirectory, "checkpoint.tar.gz.gpg"));
  assert.deepEqual(actual, { format: "jessiemessage-checkpoint-encryption", version: 1, createdAt: now,
    encrypted: true, decryptionVerified: false, independentCopyPending: true,
    source: { file: "checkpoint.tar.gz", bytes: f.source.length, sha256: digest(f.source) },
    recipient: { file: "recipient-public.asc", sha256: f.selected.recipientSha256, fingerprint },
    ciphertext: { file: "checkpoint.tar.gz.gpg", bytes: ciphertext.length, sha256: digest(ciphertext) } });
  assert.deepEqual(JSON.parse(await readFile(path.join(f.checkpointDirectory, "encryption-receipt.json"), "utf8")), actual);
  assert.equal(Object.isFrozen(actual), true); assert.equal(Object.isFrozen(actual.ciphertext), true);
  assert.equal(JSON.stringify(actual).includes(marker), false);
  assert.deepEqual(await readFile(path.join(f.checkpointDirectory, "checkpoint.tar.gz")), f.source);
  for (const name of ["checkpoint.tar.gz.gpg", "encryption-receipt.json"]) {
    const stat = await lstat(path.join(f.checkpointDirectory, name)); assert.equal(stat.mode & 0o7777, 0o600); assert.equal(stat.nlink, 1);
  }
  assert.deepEqual((await readdir(f.checkpointDirectory)).sort(), ["checkpoint.tar.gz", "checkpoint.tar.gz.gpg", "encryption-receipt.json"]);
  for (const call of gpg.observed) {
    assert.equal(call.executable, "/usr/bin/gpg"); assert.equal(call.options.cwd, "/");
    assert.deepEqual(call.options.env, { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" });
    for (const flag of ["--no-options", "--no-keyring", "--no-autostart", "--no-auto-key-retrieve", "--no-auto-key-import", "--no-encrypt-to", "--no-default-recipient"]) assert.ok(call.args.includes(flag));
    assert.equal(call.args.includes("--import"), false); assert.equal(JSON.stringify(call).includes(marker), false);
  }
  assert.ok(gpg.observed[1].args.includes("--recipient-file"));
  assert.equal(gpg.observed[1].args[gpg.observed[1].args.indexOf("--cipher-algo") + 1], "AES256");
});

test("encryption and preflight reject unsafe or accessor configuration before reading it", async t => {
  const f = await fixture(t);
  for (const changed of [{ checkpointDirectory: repository }, { checkpointDirectory: "/" }, { recipientDirectory: "relative" },
    { recipientDirectory: `${f.recipientDirectory}/` }, { recipientSha256: "A".repeat(64) }, { recipientSha256: "a".repeat(63) },
    { signal: {} }, { extra: marker }]) await assert.rejects(encryptCheckpointArchive({ ...f.selected, ...changed }), closedFailure);
  let read = false;
  const accessor = { ...f.selected }; Object.defineProperty(accessor, "recipientDirectory", { enumerable: true, get() { read = true; throw new Error(marker); } });
  await assert.rejects(encryptCheckpointArchive(accessor), { code: "CHECKPOINT_ENCRYPTION_INPUT" }); assert.equal(read, false);
  await assert.rejects(inspectCheckpointRecipient({ ...recipientSelection(f), extra: marker }), closedFailure);
  for (const clock of [() => NaN, () => -1, () => "today"]) await assert.rejects(encryptCheckpointArchive(f.selected, { clock }), closedFailure);
});

test("public key pin and packet checks refuse secrets, mixed keys and malformed armor before GPG", { skip: !supported }, async t => {
  for (const publicKey of [Buffer.from(marker), Buffer.from(syntheticPublic.toString().replaceAll("PUBLIC", "PRIVATE")),
    publicArmor(Buffer.from([0xc5, 1, 4])), publicArmor(Buffer.from([0xc6, 1, 4, 0xc7, 1, 4])),
    publicArmor(Buffer.from([0xc6, 1, 4, 0xc6, 1, 4])), publicArmor(Buffer.from([0xc6, 255, 0, 1])),
    publicArmor(Buffer.from([0xc6, 224, 4]))]) {
    const f = await fixture(t, publicKey), gpg = fakeGpg();
    await assert.rejects(encryptCheckpointArchive(f.selected, gpg), { code: "CHECKPOINT_ENCRYPTION_RECIPIENT" });
    assert.equal(gpg.observed.length, 0); await noReceipt(f);
  }
  const f = await fixture(t), gpg = fakeGpg();
  await assert.rejects(inspectCheckpointRecipient({ ...recipientSelection(f), recipientSha256: "0".repeat(64) }, gpg), { code: "CHECKPOINT_ENCRYPTION_RECIPIENT" });
  assert.equal(gpg.observed.length, 0);
});

test("key inspection rejects expired revoked disabled unencryptable or multiple recipients", { skip: !supported }, async t => {
  for (const inspectText of [listing({ validity: "e" }), listing({ validity: "r" }), listing({ validity: "d" }), listing({ expiry: "1" }),
    listing({ capabilities: "sS" }), listing({ keyFingerprint: "bad" }), listing() + listing(), listing() + "sec:-::::::::secret:\n"]) {
    const f = await fixture(t), gpg = fakeGpg({ inspectText });
    await assert.rejects(inspectCheckpointRecipient(recipientSelection(f), gpg), { code: "CHECKPOINT_ENCRYPTION_RECIPIENT" });
    assert.equal(gpg.observed.length, 1); await noReceipt(f);
  }
});

test("unsafe modes links and nonregular sources are refused", { skip: !supported }, async t => {
  for (const target of ["source", "key"]) {
    for (const kind of ["mode", "symlink", "hardlink", "directory"]) {
      const f = await fixture(t), filename = path.join(target === "source" ? f.checkpointDirectory : f.recipientDirectory, target === "source" ? "checkpoint.tar.gz" : "recipient-public.asc");
      if (kind === "mode") await chmod(filename, 0o640);
      else if (kind === "hardlink") await link(filename, path.join(f.root, "other-link"));
      else { await rm(filename); if (kind === "symlink") await symlink(path.join(f.root, "absent"), filename); else await mkdir(filename, { mode: 0o700 }); }
      const gpg = fakeGpg(); await assert.rejects(encryptCheckpointArchive(f.selected, gpg), closedFailure); assert.equal(gpg.observed.length, 0); await noReceipt(f);
    }
  }
  const f = await fixture(t); await chmod(f.recipientDirectory, 0o750);
  await assert.rejects(inspectCheckpointRecipient(recipientSelection(f), fakeGpg()), closedFailure);
});

test("existing ciphertext or receipt is preserved and prevents all subprocesses", { skip: !supported }, async t => {
  for (const name of ["checkpoint.tar.gz.gpg", "encryption-receipt.json"]) {
    const f = await fixture(t), prior = Buffer.from("previous independent backup metadata");
    await writeFile(path.join(f.checkpointDirectory, name), prior, { mode: 0o600, flag: "wx" });
    const gpg = fakeGpg(); await assert.rejects(encryptCheckpointArchive(f.selected, gpg), { code: "CHECKPOINT_ENCRYPTION_OUTPUT" });
    assert.equal(gpg.observed.length, 0); assert.deepEqual(await readFile(path.join(f.checkpointDirectory, name)), prior);
  }
});

test("GPG failure missing final status or empty ciphertext never publishes success", { skip: !supported }, async t => {
  for (const config of [{ code: 2 }, { status: "[GNUPG:] BEGIN_ENCRYPTION 2 9\n" },
    { status: "[GNUPG:] BEGIN_ENCRYPTION 0 9\n[GNUPG:] END_ENCRYPTION\n" },
    { status: "[GNUPG:] BEGIN_ENCRYPTION 2 9\n[GNUPG:] END_ENCRYPTION\n[GNUPG:] FAILURE encrypt 1\n" },
    { ciphertext: Buffer.alloc(0) }, { throwSpawn: true }]) {
    const f = await fixture(t); await assert.rejects(encryptCheckpointArchive(f.selected, fakeGpg(config)), closedFailure); await noReceipt(f);
    assert.equal((await readdir(f.checkpointDirectory)).some(name => name.startsWith(".checkpoint-gpg-")), false);
  }
});

test("empty or oversized private inputs are rejected before GPG", { skip: !supported }, async t => {
  for (const target of ["source", "key"]) {
    const f = await fixture(t), filename = path.join(target === "source" ? f.checkpointDirectory : f.recipientDirectory, target === "source" ? "checkpoint.tar.gz" : "recipient-public.asc");
    await writeFile(filename, Buffer.alloc(0)); const gpg = fakeGpg();
    await assert.rejects(encryptCheckpointArchive(f.selected, gpg), { code: "CHECKPOINT_ENCRYPTION_LIMIT" }); assert.equal(gpg.observed.length, 0); await noReceipt(f);
  }
  const f = await fixture(t); await writeFile(path.join(f.recipientDirectory, "recipient-public.asc"), Buffer.alloc(65537));
  const gpg = fakeGpg(); await assert.rejects(inspectCheckpointRecipient(recipientSelection(f), gpg), { code: "CHECKPOINT_ENCRYPTION_LIMIT" }); assert.equal(gpg.observed.length, 0);
});

test("ciphertext overflow timeout and cancellation are bounded and keep no receipt", { skip: !supported }, async t => {
  const overflow = await fixture(t);
  await assert.rejects(encryptCheckpointArchive(overflow.selected, { ...fakeGpg({ ciphertext: Buffer.alloc(128) }), maximumCiphertextBytes: 32 }), { code: "CHECKPOINT_ENCRYPTION_LIMIT" }); await noReceipt(overflow);
  const timeout = await fixture(t);
  await assert.rejects(encryptCheckpointArchive(timeout.selected, { ...fakeGpg({ hang: true }), timeoutMilliseconds: 15 }), { code: "CHECKPOINT_ENCRYPTION_TIMEOUT" }); await noReceipt(timeout);
  const cancelled = await fixture(t), controller = new AbortController();
  const gpg = fakeGpg({ hang: true, before({ inspect }) { if (!inspect) setImmediate(() => controller.abort()); } });
  await assert.rejects(encryptCheckpointArchive({ ...cancelled.selected, signal: controller.signal }, gpg), { code: "CHECKPOINT_ENCRYPTION_ABORTED" }); await noReceipt(cancelled);
  const initial = await fixture(t), stopped = new AbortController(); stopped.abort(); const unopened = fakeGpg();
  await assert.rejects(encryptCheckpointArchive({ ...initial.selected, signal: stopped.signal }, unopened), { code: "CHECKPOINT_ENCRYPTION_ABORTED" }); assert.equal(unopened.observed.length, 0);
});

test("source or recipient drift during GPG blocks the encryption receipt", { skip: !supported }, async t => {
  for (const target of ["source", "recipient"]) {
    const f = await fixture(t), filename = target === "source" ? path.join(f.checkpointDirectory, "checkpoint.tar.gz") : path.join(f.recipientDirectory, "recipient-public.asc");
    const gpg = fakeGpg({ async before({ inspect }) { if (!inspect) await writeFile(filename, marker); } });
    await assert.rejects(encryptCheckpointArchive(f.selected, gpg), closedFailure); await noReceipt(f);
  }
});

test("Linux CI has the real GPG required by roundtrip verification", { skip: !process.env.CI || process.platform !== "linux" }, () => assert.equal(supported, true));

test("standard GPG public-only encryption roundtrips independently with a synthetic private key", { skip: !supported, timeout: 60000 }, async t => {
  const f = await fixture(t), home = path.join(f.root, "key"); await mkdir(home, { mode: 0o700 });
  const env = { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" };
  const base = ["--no-options", "--batch", "--no-tty", "--pinentry-mode", "loopback", "--homedir", home];
  try {
    execFileSync("/usr/bin/gpg", [...base, "--passphrase", "", "--quick-generate-key", "Checkpoint synthetic fixture only", "rsa3072", "encr", "0"], { env, timeout: 30000, stdio: "pipe" });
    const publicKey = execFileSync("/usr/bin/gpg", [...base, "--armor", "--export"], { env, timeout: 5000, maxBuffer: 65536 });
    await writeFile(path.join(f.recipientDirectory, "recipient-public.asc"), publicKey);
    f.selected.recipientSha256 = digest(publicKey);
    const preflight = await inspectCheckpointRecipient(recipientSelection(f)); assert.equal(preflight.usable, true);
    const result = await encryptCheckpointArchive(f.selected);
    assert.equal(result.recipient.fingerprint, preflight.fingerprint);
    const filename = path.join(f.checkpointDirectory, "checkpoint.tar.gz.gpg");
    const recovered = execFileSync("/usr/bin/gpg", [...base, "--decrypt", filename], { env, timeout: 10000, maxBuffer: 65536, stdio: ["ignore", "pipe", "pipe"] });
    assert.deepEqual(recovered, f.source);
    const ciphertext = await readFile(filename); assert.equal(ciphertext.includes(Buffer.from(marker)), false);
    assert.equal(result.decryptionVerified, false); assert.equal(result.independentCopyPending, true);
    assert.deepEqual(await readdir(f.recipientDirectory), ["recipient-public.asc"]);
  } finally {
    try { execFileSync("/usr/bin/gpgconf", ["--homedir", home, "--kill", "gpg-agent"], { env, stdio: "ignore", timeout: 3000 }); } catch { /* Fixture cleanup only. */ }
  }
});
