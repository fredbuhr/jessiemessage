import { constants } from "node:fs";
import { lstat, open, opendir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { withPrivateDirectory } from "../files/private-directory.mjs";
import { readCheckpointHistory, readRecurringConfiguration } from "./recurring-checkpoint-files.mjs";
import { captureId, copyFields, copyHash, copyDate, failCopy } from "./copy-state.mjs";

const CIPHERTEXT = "checkpoint.tar.gz.gpg", RECEIPT = "encryption-receipt.json", MAX_BYTES = 2151677952;
const FIELDS = ["dev", "ino", "mode", "uid", "gid", "nlink", "size", "mtimeNs", "ctimeNs"];
const same = (a, b) => FIELDS.every(key => a[key] === b[key]);
function regular(stats, maximum) {
  if (!stats.isFile() || stats.uid !== BigInt(process.getuid()) || (stats.mode & 0o7777n) !== 0o600n || stats.nlink !== 1n
    || stats.size < 1n || stats.size > BigInt(maximum)) failCopy();
}

// Pin the capture relative to an already pinned operations directory. No path
// supplied by an HTTP caller is ever opened, and only the two fixed files exist here.
export async function withCopyCapture(directory, id, callback, internal = {}) {
  if (!captureId(id)) failCopy("input");
  return (internal.withDirectory ?? withPrivateDirectory)(directory, async root => {
    await root.assertReady();
    const handle = await open(root.file(id), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const before = await handle.stat({ bigint: true });
      if (!before.isDirectory() || before.uid !== BigInt(process.getuid()) || (before.mode & 0o7777n) !== 0o700n) failCopy();
      const ready = async () => {
        await root.assertReady();
        const after = await handle.stat({ bigint: true }), visible = await lstat(root.file(id), { bigint: true });
        if (![after, visible].every(value => value.isDirectory() && value.dev === before.dev && value.ino === before.ino
          && value.uid === before.uid && value.gid === before.gid && value.mode === before.mode)) failCopy("changed");
      };
      const result = await callback({ file(name) {
        if (![CIPHERTEXT, RECEIPT].includes(name)) failCopy("input");
        return `${internal.capturePath?.(root, id, handle) ?? `/proc/self/fd/${handle.fd}`}/${name}`;
      }, assertReady: ready });
      await ready(); return result;
    } finally { await handle.close(); }
  });
}
async function withStableFile(scope, name, maximum, callback) {
  await scope.assertReady();
  const file = await open(scope.file(name), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await file.stat({ bigint: true }); regular(before, maximum);
    const unchanged = async () => {
      const after = await file.stat({ bigint: true }), visible = await lstat(scope.file(name), { bigint: true });
      regular(after, maximum); regular(visible, maximum);
      if (!same(before, after) || !same(after, visible)) failCopy("changed");
      await scope.assertReady();
    };
    const result = await callback(file, Number(before.size), unchanged);
    await unchanged(); return result;
  } finally { await file.close(); }
}
function receipt(value, id, configuration) {
  const result = copyFields(value, ["format", "version", "createdAt", "encrypted", "protection", "decryptionVerified", "independentCopyPending", "source", "recipient", "ciphertext"]);
  const ciphertext = copyFields(result.ciphertext, ["file", "bytes", "sha256"]);
  const recipient = copyFields(result.recipient, ["file", "sha256", "fingerprint"]);
  const source = copyFields(result.source, ["file", "bytes", "sha256"]);
  const startedAt = Number(id.split("-")[1]);
  if (result.format !== "jessiemessage-checkpoint-encryption" || result.version !== 1 || result.encrypted !== true
    || !["mdc", "ocb-aead"].includes(result.protection) || !copyDate(result.createdAt) || result.createdAt < startedAt
    || result.decryptionVerified !== false || result.independentCopyPending !== true
    || recipient.file !== "recipient-public.asc" || recipient.sha256 !== configuration.recipientSha256
    || !/^(?:[A-F0-9]{40}|[A-F0-9]{64})$/.test(recipient.fingerprint ?? "")
    || source.file !== "checkpoint.tar.gz" || !copyHash(source.sha256) || !Number.isSafeInteger(source.bytes) || source.bytes < 1
    || ciphertext.file !== CIPHERTEXT || !Number.isSafeInteger(ciphertext.bytes) || ciphertext.bytes < 1 || ciphertext.bytes > MAX_BYTES
    || !copyHash(ciphertext.sha256)) failCopy();
  return { id, startedAt, bytes: ciphertext.bytes, sha256: ciphertext.sha256, filename: `JessieMessage-${id}.tar.gz.gpg` };
}

export function createCopyCatalog(directory, internal = {}) {
  const withDirectory = internal.withDirectory ?? withPrivateDirectory;
  const withCapture = (id, callback) => withCopyCapture(directory, id, callback, internal);
  const configuration = () => (internal.readConfiguration ?? readRecurringConfiguration)(directory);
  const history = () => (internal.readHistory ?? readCheckpointHistory)(directory);
  async function inspect(id, config) {
    return withCapture(id, scope => withStableFile(scope, RECEIPT, 4096, async (file, size) => {
      const bytes = Buffer.alloc(size + 1); let offset = 0;
      try {
        while (offset < bytes.length) { const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset); if (!bytesRead) break; offset += bytesRead; }
        if (offset !== size) failCopy("changed");
        const record = receipt(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, size))), id, config);
        return await withStableFile(scope, CIPHERTEXT, MAX_BYTES, async (_file, length) => { if (length !== record.bytes) failCopy("changed"); return record; });
      }
      finally { bytes.fill(0); }
    }));
  }
  async function list() {
    const config = await configuration(), journal = await history();
    const succeeded = new Set(journal.records.filter(record => record.status === "succeeded").map(record => record.startedAt));
    const entries = await withDirectory(directory, async scope => {
      const iterator = await opendir(`${scope.path}/.`), names = []; let count = 0;
      for await (const entry of iterator) {
        if (++count > 4096) failCopy();
        if (captureId(entry.name) && succeeded.has(Number(entry.name.split("-")[1]))) names.push(entry.name);
      }
      await scope.assertReady(); return names;
    });
    if (entries.length > 2000 || new Set(entries.map(id => id.split("-")[1])).size !== entries.length) failCopy();
    const records = [];
    for (const id of entries) records.push(await inspect(id, config));
    records.sort((a, b) => a.startedAt - b.startedAt);
    return { version: 1, schedule: { enabled: config.enabled, hourUtc: config.hourUtc, minuteUtc: config.minuteUtc }, archives: records };
  }
  async function transfer(id, consume, { signal } = {}) {
    if (!captureId(id) || typeof consume !== "function") failCopy("input");
    const catalog = await list(), expected = catalog.archives.find(item => item.id === id);
    if (!expected) failCopy("missing");
    return withCapture(id, scope => withStableFile(scope, CIPHERTEXT, MAX_BYTES, async (file, size, unchanged) => {
      if (size !== expected.bytes || signal?.aborted) failCopy();
      // Prehash before sending HTTP headers. The download is rehashed on the PC
      // before its atomic rename and before it can send an acknowledgement.
      const digest = createHash("sha256"), chunk = Buffer.alloc(65536); let offset = 0;
      try {
        while (offset < size) {
          if (signal?.aborted) failCopy();
          const { bytesRead } = await file.read(chunk, 0, Math.min(chunk.length, size - offset), offset);
          if (!bytesRead) failCopy("changed");
          digest.update(chunk.subarray(0, bytesRead)); offset += bytesRead;
        }
        if (digest.digest("hex") !== expected.sha256) failCopy("changed");
        await unchanged();
        return await consume(expected, file);
      } finally { chunk.fill(0); }
    }));
  }
  return Object.freeze({ list, transfer });
}
