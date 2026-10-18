import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, realpath, rmdir, unlink } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { withPrivateDirectory } from "../files/private-directory.mjs";

const REPOSITORY = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const SOURCE = "checkpoint.tar.gz", PUBLIC_KEY = "recipient-public.asc";
const OUTPUT = "checkpoint.tar.gz.gpg", RECEIPT = "encryption-receipt.json";
const MAX_SOURCE = 2 * 1024 * 1024 * 1024, MAX_OUTPUT = MAX_SOURCE + 4 * 1024 * 1024;
const MAX_KEY = 65536, CHUNK = 65536, TIMEOUT = 180000;
const STATS = ["dev", "ino", "mode", "uid", "gid", "nlink", "size", "mtimeNs", "ctimeNs"];
const CODES = new Set(["INPUT", "UNSAFE", "CHANGED", "LIMIT", "RECIPIENT", "GPG", "TIMEOUT", "ABORTED", "OUTPUT", "IO"].map(code => `CHECKPOINT_ENCRYPTION_${code}`));
const ENV = Object.freeze({ PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" });

export class CheckpointEncryptionError extends Error {
  constructor(code = "CHECKPOINT_ENCRYPTION_IO") {
    super("Private checkpoint encryption could not be confirmed.");
    this.name = "CheckpointEncryptionError";
    this.code = CODES.has(code) ? code : "CHECKPOINT_ENCRYPTION_IO";
  }
}
const fail = suffix => { throw new CheckpointEncryptionError(`CHECKPOINT_ENCRYPTION_${suffix}`); };
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const same = (a, b) => STATS.every(name => a[name] === b[name]);
const inside = (filename, root) => { const suffix = relative(root, filename); return suffix === "" || suffix !== ".." && !suffix.startsWith(`..${sep}`) && !suffix.startsWith(sep); };
const canonicalPath = value => typeof value === "string" && value.startsWith("/") && value !== "/" && value.length <= 4096
  && resolve(value) === value && !/[\\\x00-\x1f\x7f]/.test(value) && !inside(value, REPOSITORY);

function fields(value, names) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) fail("INPUT");
  const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
  if (keys.length !== names.length || keys.some(key => typeof key !== "string" || !names.includes(key)
    || !descriptors[key].enumerable || !Object.hasOwn(descriptors[key], "value"))) fail("INPUT");
  return Object.fromEntries(names.map(name => [name, descriptors[name].value]));
}
function options(value) {
  const names = ["checkpointDirectory", "recipientDirectory", "recipientSha256", ...(value && Object.hasOwn(value, "signal") ? ["signal"] : [])];
  const selected = fields(value, names);
  if (!canonicalPath(selected.checkpointDirectory) || !canonicalPath(selected.recipientDirectory)
    || typeof selected.recipientSha256 !== "string" || !/^[a-f0-9]{64}$/.test(selected.recipientSha256)
    || selected.signal !== undefined && !(selected.signal instanceof AbortSignal)) fail("INPUT");
  return selected;
}
function recipientOptions(value) {
  const names = ["recipientDirectory", "recipientSha256", ...(value && Object.hasOwn(value, "signal") ? ["signal"] : [])];
  const selected = fields(value, names);
  if (!canonicalPath(selected.recipientDirectory) || typeof selected.recipientSha256 !== "string" || !/^[a-f0-9]{64}$/.test(selected.recipientSha256)
    || selected.signal !== undefined && !(selected.signal instanceof AbortSignal)) fail("INPUT");
  return selected;
}
function dependencies(internal) {
  const { spawnClient = spawn, clock = Date.now, timeoutMilliseconds = TIMEOUT, maximumCiphertextBytes = MAX_OUTPUT } = internal;
  if (typeof spawnClient !== "function" || typeof clock !== "function" || !Number.isSafeInteger(timeoutMilliseconds) || timeoutMilliseconds < 1 || timeoutMilliseconds > TIMEOUT
    || !Number.isSafeInteger(maximumCiphertextBytes) || maximumCiphertextBytes < 1 || maximumCiphertextBytes > MAX_OUTPUT) fail("INPUT");
  const now = clock();
  if (!Number.isSafeInteger(now) || now < 0 || now > 253402300799999) fail("INPUT");
  return { spawnClient, timeoutMilliseconds, maximumCiphertextBytes, now, deadline: performance.now() + timeoutMilliseconds };
}
function activity(signal, deadline) {
  return () => { if (signal?.aborted) fail("ABORTED"); if (performance.now() >= deadline) fail("TIMEOUT"); };
}
function regular(stats, maximum) {
  if (!stats?.isFile?.() || typeof process.getuid !== "function" || STATS.some(name => typeof stats[name] !== "bigint")
    || stats.uid !== BigInt(process.getuid()) || (stats.mode & 0o7777n) !== 0o600n || stats.nlink !== 1n) fail("UNSAFE");
  if (stats.size < 0n || stats.size > BigInt(maximum)) fail("LIMIT");
}
function checkSame(before, after) { if (!same(before, after)) fail("CHANGED"); }
async function absent(scope, name) {
  await scope.assertReady();
  try { await lstat(scope.file(name)); } catch (error) { if (error.code === "ENOENT") return; throw error; }
  fail("OUTPUT");
}
async function stableOpen(scope, name, maximum) {
  let file;
  try {
    await scope.assertReady();
    const initial = await lstat(scope.file(name), { bigint: true }); regular(initial, maximum);
    if (initial.size === 0n) fail("LIMIT");
    file = await open(scope.file(name), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const before = await file.stat({ bigint: true }); regular(before, maximum); checkSame(initial, before);
    return { file, before, name, scope, maximum };
  } catch (error) { await file?.close(); throw error; }
}
async function unchanged(record) {
  const after = await record.file.stat({ bigint: true }); regular(after, record.maximum); checkSame(record.before, after);
  const visible = await lstat(record.scope.file(record.name), { bigint: true }); regular(visible, record.maximum); checkSame(after, visible);
  await record.scope.assertReady();
}
async function readHash(record, active, collect = false) {
  const buffer = Buffer.alloc(CHUNK), collected = collect ? Buffer.alloc(Number(record.before.size)) : undefined;
  const digest = createHash("sha256"); let bytes = 0;
  try {
    while (bytes < Number(record.before.size)) {
      active();
      const amount = Math.min(buffer.length, Number(record.before.size) - bytes);
      const { bytesRead } = await record.file.read(buffer, 0, amount, bytes);
      if (!Number.isSafeInteger(bytesRead) || bytesRead < 1 || bytesRead > amount) fail("CHANGED");
      digest.update(buffer.subarray(0, bytesRead)); collected?.set(buffer.subarray(0, bytesRead), bytes);
      bytes += bytesRead; buffer.fill(0);
    }
    active(); await unchanged(record); active();
    return { bytes, sha256: digest.digest("hex"), ...(collect ? { content: collected } : {}) };
  } catch (error) { collected?.fill(0); throw error; }
  finally { buffer.fill(0); }
}

// Reject secret packets even if someone changes their ASCII armor label.
function publicPackets(content) {
  const text = content.toString("ascii");
  if (content.some(byte => byte > 127) || !/^-----BEGIN PGP PUBLIC KEY BLOCK-----\r?\n(?:[A-Za-z0-9-]+: [^\r\n]*\r?\n)*\r?\n(?:[A-Za-z0-9+/]+={0,2}\r?\n)+(?:=[A-Za-z0-9+/]{4}\r?\n)?-----END PGP PUBLIC KEY BLOCK-----\r?\n?$/.test(text)) fail("RECIPIENT");
  const section = text.split(/\r?\n\r?\n/)[1].split("-----END PGP PUBLIC KEY BLOCK-----")[0];
  const encoded = section.split(/\r?\n/).filter(line => line && !line.startsWith("=")).join("");
  const binary = Buffer.from(encoded, "base64");
  try {
    if (binary.toString("base64") !== encoded) fail("RECIPIENT");
    let offset = 0, primary = 0;
    while (offset < binary.length) {
      const header = binary[offset++]; if (!(header & 128)) fail("RECIPIENT");
      let tag, size;
      if (header & 64) {
        tag = header & 63; const first = binary[offset++];
        if (first === undefined) fail("RECIPIENT");
        if (first < 192) size = first;
        else if (first < 224) { if (offset >= binary.length) fail("RECIPIENT"); size = ((first - 192) << 8) + binary[offset++] + 192; }
        else if (first === 255) { if (offset + 4 > binary.length) fail("RECIPIENT"); size = binary.readUInt32BE(offset); offset += 4; }
        else fail("RECIPIENT");
      } else {
        tag = (header >> 2) & 15; const kind = header & 3, length = [1, 2, 4][kind];
        if (!length || offset + length > binary.length) fail("RECIPIENT");
        size = binary.readUIntBE(offset, length); offset += length;
      }
      if (![2, 6, 13, 14].includes(tag) || !Number.isSafeInteger(size) || size < 1 || offset + size > binary.length) fail("RECIPIENT");
      if (tag === 6 && ++primary !== 1 || primary !== 1) fail("RECIPIENT");
      offset += size;
    }
    if (primary !== 1) fail("RECIPIENT");
  } finally { binary.fill(0); }
}
function recipientFingerprint(stdout, now) {
  const lines = stdout.toString("ascii").split("\n").filter(Boolean), keys = lines.filter(line => line.startsWith("pub:"));
  if (keys.length !== 1 || lines.some(line => /^(?:sec|ssb):/.test(line))) fail("RECIPIENT");
  const key = keys[0].split(":"), index = lines.indexOf(keys[0]);
  const fingerprint = lines.slice(index + 1).find(line => line.startsWith("fpr:"))?.split(":")[9];
  const expired = key[6] !== "" && (!/^\d+$/.test(key[6]) || Number(key[6]) * 1000 <= now);
  if (["r", "e", "d", "i"].includes(key[1]) || expired || !key[11]?.includes("E")
    || !/^(?:[A-F0-9]{40}|[A-F0-9]{64})$/.test(fingerprint ?? "")) fail("RECIPIENT");
  return fingerprint;
}

async function gpg({ source, recipient, home, spawnClient, active, signal, timeoutMilliseconds, deadline, maximumOutput, output, inspect = false }) {
  active();
  const args = ["--no-options", "--batch", "--no-tty", "--no-autostart", "--no-keyring", "--no-random-seed-file", "--no-auto-check-trustdb",
    "--no-auto-key-locate", "--no-auto-key-retrieve", "--no-auto-key-import", "--no-encrypt-to", "--no-default-recipient",
    "--trust-model", "always", "--homedir", "/proc/self/fd/3", "--status-fd", "5"];
  if (inspect) args.push("--with-colons", "--fixed-list-mode", "--show-keys", "/proc/self/fd/4");
  else args.push("--rfc4880", "--compress-algo", "none", "--cipher-algo", "AES256", "--recipient-file", "/proc/self/fd/4", "--output", "-", "--encrypt");
  let child, timer, abort, failure, statusSize = 0, bytes = 0;
  const status = [], collected = [], digest = createHash("sha256");
  try {
    child = spawnClient("/usr/bin/gpg", args, { env: ENV, cwd: "/", stdio: [inspect ? "ignore" : source.file.fd, "pipe", "ignore", home.fd, recipient.file.fd, "pipe"] });
    const stop = code => { failure ??= new CheckpointEncryptionError(`CHECKPOINT_ENCRYPTION_${code}`); child.kill("SIGKILL"); };
    abort = () => stop("ABORTED"); signal?.addEventListener("abort", abort, { once: true });
    timer = setTimeout(() => stop("TIMEOUT"), Math.max(1, Math.min(timeoutMilliseconds, Math.ceil(deadline - performance.now()))));
    const closed = new Promise(resolveDone => {
      child.once("error", () => stop("GPG"));
      child.once("close", (code, termination) => resolveDone({ code, termination }));
    });
    child.stdio[5].on("error", () => stop("GPG"));
    child.stdio[5].on("data", chunk => {
      statusSize += chunk.length;
      if (statusSize > 16384) { chunk.fill(0); stop("GPG"); } else status.push(chunk);
    });
    if (signal?.aborted) abort();
    const consumer = (async () => {
      for await (const chunk of child.stdout) {
        try {
          active(); bytes += chunk.length;
          if (bytes > maximumOutput) fail("LIMIT");
          digest.update(chunk);
          if (inspect) collected.push(Buffer.from(chunk));
          else {
            let offset = 0;
            while (offset < chunk.length) {
              active(); const { bytesWritten } = await output.write(chunk, offset, chunk.length - offset, bytes - chunk.length + offset);
              if (!Number.isSafeInteger(bytesWritten) || bytesWritten < 1 || bytesWritten > chunk.length - offset) fail("OUTPUT");
              offset += bytesWritten;
            }
          }
        } finally { chunk.fill(0); }
      }
    })().catch(error => { failure ??= error instanceof CheckpointEncryptionError ? error : new CheckpointEncryptionError("CHECKPOINT_ENCRYPTION_GPG"); child.kill("SIGKILL"); });
    const [{ code, termination }] = await Promise.all([closed, consumer]);
    active(); if (failure) throw failure;
    if (code !== 0 || termination !== null || bytes < 1) fail("GPG");
    const states = Buffer.concat(status).toString("ascii");
    // GnuPG DETAILS permits an optional AEAD identifier. Zero still means
    // the required MDC/AES-256 profile; a nonzero AEAD mode is not accepted.
    if (!inspect && (!/^\[GNUPG:\] BEGIN_ENCRYPTION 2 9(?: 0)?\r?$/m.test(states) || !/^\[GNUPG:\] END_ENCRYPTION\r?$/m.test(states)
      || /^\[GNUPG:\] (?:FAILURE|ERROR|INV_RECP|NO_RECP)\b/m.test(states))) fail("GPG");
    return { bytes, sha256: digest.digest("hex"), ...(inspect ? { content: Buffer.concat(collected) } : {}) };
  } catch (error) { child?.kill("SIGKILL"); if (error instanceof CheckpointEncryptionError) throw error; fail("GPG"); }
  finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); for (const chunk of [...status, ...collected]) chunk.fill(0); }
}

async function isolatedHome(scope, active, callback) {
  const name = `.checkpoint-gpg-${randomBytes(16).toString("hex")}`; let home, identity, result, failure;
  try {
    active(); await scope.assertReady(); await mkdir(scope.file(name), { mode: 0o700 });
    home = await open(scope.file(name), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    identity = await home.stat({ bigint: true });
    if (!identity.isDirectory() || identity.uid !== BigInt(process.getuid()) || (identity.mode & 0o7777n) !== 0o700n) fail("UNSAFE");
    result = await callback(home);
  } catch (error) { failure = error; }
  finally {
    try {
      if (identity) {
        const visible = await lstat(scope.file(name), { bigint: true });
        if (!visible.isDirectory() || visible.dev !== identity.dev || visible.ino !== identity.ino || visible.mode !== identity.mode || visible.uid !== identity.uid) fail("CHANGED");
        if ((await readdir(`/proc/self/fd/${home.fd}`)).length !== 0) fail("GPG");
        await rmdir(scope.file(name)); await scope.sync();
      }
    } catch (error) { failure ??= error; }
    finally { try { await home?.close(); } catch { failure ??= new CheckpointEncryptionError(); } }
  }
  if (failure) throw failure;
  return result;
}

/** Inspect only the pinned public recipient before an operator stops writers. */
export async function inspectCheckpointRecipient(value, internal = {}) {
  let recipient, keyContent;
  try {
    const selected = recipientOptions(value), { spawnClient, timeoutMilliseconds, deadline, now } = dependencies(internal);
    const active = activity(selected.signal, deadline);
    active();
    return await withPrivateDirectory(selected.recipientDirectory, async scope => {
      if (inside(await realpath(scope.path), await realpath(REPOSITORY))) fail("INPUT");
      recipient = await stableOpen(scope, PUBLIC_KEY, MAX_KEY);
      const key = await readHash(recipient, active, true); keyContent = key.content;
      if (key.sha256 !== selected.recipientSha256) fail("RECIPIENT");
      publicPackets(keyContent);
      const result = await isolatedHome(scope, active, async home => {
        const shown = await gpg({ recipient, home, spawnClient, active, signal: selected.signal, timeoutMilliseconds, deadline, inspect: true, maximumOutput: MAX_KEY });
        try { return Object.freeze({ format: "jessiemessage-checkpoint-recipient", version: 1, sha256: key.sha256,
          fingerprint: recipientFingerprint(shown.content, now), usable: true }); }
        finally { shown.content.fill(0); }
      });
      await unchanged(recipient); active();
      return result;
    });
  } catch (error) { if (error instanceof CheckpointEncryptionError) throw error; throw new CheckpointEncryptionError(); }
  finally { keyContent?.fill(0); try { await recipient?.file.close(); } catch { throw new CheckpointEncryptionError(); } }
}

/** Encrypt a previously verified checkpoint; no private recovery key is read. */
export async function encryptCheckpointArchive(value, internal = {}) {
  let source, recipient, output, keyContent;
  try {
    const selected = options(value), { spawnClient, timeoutMilliseconds, maximumCiphertextBytes, deadline, now: createdAt } = dependencies(internal);
    const active = activity(selected.signal, deadline);
    active();
    return await withPrivateDirectory(selected.checkpointDirectory, async checkpoint => withPrivateDirectory(selected.recipientDirectory, async recipientScope => {
      for (const scope of [checkpoint, recipientScope]) if (inside(await realpath(scope.path), await realpath(REPOSITORY))) fail("INPUT");
      await absent(checkpoint, OUTPUT); await absent(checkpoint, RECEIPT);
      source = await stableOpen(checkpoint, SOURCE, MAX_SOURCE);
      recipient = await stableOpen(recipientScope, PUBLIC_KEY, MAX_KEY);
      const original = await readHash(source, active), key = await readHash(recipient, active, true); keyContent = key.content;
      if (key.sha256 !== selected.recipientSha256) fail("RECIPIENT");
      publicPackets(keyContent);
      const result = await isolatedHome(checkpoint, active, async home => {
        const common = { source, recipient, home, spawnClient, active, signal: selected.signal, timeoutMilliseconds, deadline };
        const shown = await gpg({ ...common, inspect: true, maximumOutput: MAX_KEY });
        let fingerprint;
        try { fingerprint = recipientFingerprint(shown.content, createdAt); } finally { shown.content.fill(0); }
        await unchanged(source); await unchanged(recipient); active();
        await absent(checkpoint, OUTPUT); await absent(checkpoint, RECEIPT);
        output = await open(checkpoint.file(OUTPUT), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
        const first = await output.stat({ bigint: true }); regular(first, maximumCiphertextBytes);
        const encrypted = await gpg({ ...common, maximumOutput: maximumCiphertextBytes, output });
        await output.sync();
        const written = await output.stat({ bigint: true }); regular(written, maximumCiphertextBytes);
        if (written.dev !== first.dev || written.ino !== first.ino || written.size !== BigInt(encrypted.bytes)) fail("OUTPUT");
        checkSame(written, await lstat(checkpoint.file(OUTPUT), { bigint: true }));
        await output.close(); output = null; await checkpoint.sync();
        const saved = await stableOpen(checkpoint, OUTPUT, maximumCiphertextBytes);
        try { const reread = await readHash(saved, active); if (reread.bytes !== encrypted.bytes || reread.sha256 !== encrypted.sha256) fail("OUTPUT"); }
        finally { await saved.file.close(); }
        const after = await readHash(source, active); await unchanged(recipient);
        if (after.bytes !== original.bytes || after.sha256 !== original.sha256) fail("CHANGED");
        return Object.freeze({ format: "jessiemessage-checkpoint-encryption", version: 1, createdAt, encrypted: true,
          decryptionVerified: false, independentCopyPending: true,
          source: Object.freeze({ file: SOURCE, bytes: original.bytes, sha256: original.sha256 }),
          recipient: Object.freeze({ file: PUBLIC_KEY, sha256: key.sha256, fingerprint }),
          ciphertext: Object.freeze({ file: OUTPUT, bytes: encrypted.bytes, sha256: encrypted.sha256 }) });
      });
      active(); await unchanged(source); await unchanged(recipient);
      const bytes = Buffer.from(`${JSON.stringify(result)}\n`); let receiptIdentity, completed = false;
      try {
        output = await open(checkpoint.file(RECEIPT), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
        const first = await output.stat({ bigint: true }); regular(first, MAX_KEY);
        receiptIdentity = { dev: first.dev, ino: first.ino };
        await output.writeFile(bytes); await output.sync(); active();
        const written = await output.stat({ bigint: true }); regular(written, MAX_KEY);
        if (written.dev !== first.dev || written.ino !== first.ino || written.size !== BigInt(bytes.length)) fail("OUTPUT");
        checkSame(written, await lstat(checkpoint.file(RECEIPT), { bigint: true }));
        await output.close(); output = null; await checkpoint.sync();
        const saved = await stableOpen(checkpoint, RECEIPT, MAX_KEY);
        try { const reread = await readHash(saved, active); if (reread.sha256 !== hash(bytes)) fail("OUTPUT"); }
        finally { await saved.file.close(); }
        await unchanged(source); await unchanged(recipient); active();
        completed = true;
        return result;
      } finally {
        bytes.fill(0);
        if (!completed && receiptIdentity) {
          await output?.close(); output = null;
          const visible = await lstat(checkpoint.file(RECEIPT), { bigint: true }); regular(visible, MAX_KEY);
          if (visible.dev !== receiptIdentity.dev || visible.ino !== receiptIdentity.ino) fail("CHANGED");
          await unlink(checkpoint.file(RECEIPT)); await checkpoint.sync();
        }
      }
    }));
  } catch (error) { if (error instanceof CheckpointEncryptionError) throw error; throw new CheckpointEncryptionError(); }
  finally {
    keyContent?.fill(0);
    let failed = false;
    for (const handle of [output, source?.file, recipient?.file]) { try { await handle?.close(); } catch { failed = true; } }
    if (failed) throw new CheckpointEncryptionError();
  }
}
