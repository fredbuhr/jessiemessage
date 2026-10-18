import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { chmod, link, lstat, mkdir, mkdtemp, readFile, rename, rm, symlink, truncate, writeFile } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { gzipSync, gunzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CheckpointArchiveError, verifyCheckpointArchive } from "../server/backup/checkpoint-archive.mjs";

const repository = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const privateMarker = "synthetic private archive bytes must never be included in errors";
const mediaName = `media/${"a".repeat(64)}.full.enc`;
const hash = (content) => createHash("sha256").update(content).digest("hex");
const roots = () => [
  { name: "manifest.json", content: Buffer.from('{"synthetic":true}\n') },
  { name: "database.sql.gz", content: gzipSync(Buffer.from(privateMarker)) },
  { name: "receipt.json", content: Buffer.from('{"receipt":"synthetic"}\n') },
];
const expectedFor = (files) => files.map(({ name, content }) => ({ name, bytes: content.length, sha256: hash(content) }));
const closedFailure = (error) => error instanceof CheckpointArchiveError && /^CHECKPOINT_ARCHIVE_[A-Z]+$/.test(error.code)
  && error.message === "Private checkpoint archive could not be verified." && !String(error).includes(privateMarker)
  && !String(error).includes(repository) && !String(error).includes(mediaName);

async function fixture(t, files = roots(), archive = null) {
  const base = path.resolve(repository, "../audit");
  await mkdir(base, { mode: 0o700, recursive: true });
  const root = await mkdtemp(path.join(base, "checkpoint-archive-")); await chmod(root, 0o700);
  t.after(() => rm(root, { recursive: true, force: true }));
  const original = await lstat(root, { bigint: true });
  const scope = {
    file(name) { assert.equal(name, "checkpoint.tar.gz"); return path.join(root, name); },
    async assertReady() { const current = await lstat(root, { bigint: true }); assert.equal(current.ino, original.ino); assert.equal(current.dev, original.dev); return current; },
  };
  const filename = scope.file("checkpoint.tar.gz");
  const content = archive ?? gzipSync(tar(files));
  await writeFile(filename, content, { mode: 0o600, flag: "wx" });
  return { root, scope, filename, expected: expectedFor(files), archive: content };
}

function octal(buffer, offset, length, number) { buffer.write(`${number.toString(8).padStart(length - 1, "0")}\0`, offset, length, "ascii"); }
function checksum(header) {
  header.fill(32, 148, 156);
  const sum = header.reduce((total, byte) => total + byte, 0);
  header.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii");
  return header;
}
function header(name, bytes = 0, type = "0") {
  const result = Buffer.alloc(512); result.write(name, 0, 100, "ascii");
  octal(result, 100, 8, type === "5" ? 0o700 : 0o600); octal(result, 108, 8, 0); octal(result, 116, 8, 0);
  octal(result, 124, 12, bytes); octal(result, 136, 12, 1); result[156] = type === "\0" ? 0 : type.charCodeAt(0);
  result.write("ustar\0" + "00", 257, 8, "ascii"); return checksum(result);
}
function member({ name, content, type = "0" }) {
  return Buffer.concat([header(name, content.length, type), content, Buffer.alloc((512 - content.length % 512) % 512)]);
}
function tar(files, { directory = true, trailer = Buffer.alloc(1024) } = {}) {
  return Buffer.concat([...files.map(member), ...(directory ? [header("media/", 0, "5")] : []), trailer]);
}
async function replace(fixture, tarBytes) { await writeFile(fixture.filename, gzipSync(tarBytes)); }
async function hookOpen(callback, operation) {
  const original = fs.promises.open;
  fs.promises.open = async (...args) => callback(original, args); syncBuiltinESMExports();
  try { return await operation(); }
  finally { fs.promises.open = original; syncBuiltinESMExports(); }
}

test("archive verifies the actual GNU tar producer in GNU and USTAR formats, including empty media", async (t) => {
  for (const format of [null, "ustar"]) {
    for (const withMedia of [false, true]) {
      const files = roots(); if (withMedia) files.push({ name: mediaName, content: randomBytes(170123) });
      const f = await fixture(t, files); await rm(f.filename);
      await mkdir(path.join(f.root, "media"), { mode: 0o700 });
      for (const file of files) await writeFile(path.join(f.root, file.name), file.content, { mode: 0o600, flag: "wx" });
      execFileSync("/usr/bin/tar", [...(format ? [`--format=${format}`] : []), "-czf", f.filename, "-C", f.root,
        "manifest.json", "database.sql.gz", "receipt.json", "media"], { env: { ...process.env, TAR_OPTIONS: "", GZIP: "" }, stdio: "pipe" });
      await chmod(f.filename, 0o600);
      const bytes = await readFile(f.filename), actual = await verifyCheckpointArchive(f.scope, f.expected);
      assert.deepEqual(actual, { files: files.length, bytes: files.reduce((total, file) => total + file.content.length, 0), archiveBytes: bytes.length, archiveSha256: hash(bytes) });
      assert.equal(Object.isFrozen(actual), true);
      assert.equal(JSON.stringify(actual).includes(privateMarker), false);
      assert.equal(JSON.stringify(actual).includes(mediaName), false);
    }
  }
});

test("archive accepts NUL regular-file type and complete extra zero blocks", async (t) => {
  const files = roots().map((file) => ({ ...file, type: "\0" }));
  const f = await fixture(t, files, gzipSync(tar(files, { trailer: Buffer.alloc(8192) })));
  assert.equal((await verifyCheckpointArchive(f.scope, f.expected)).files, 3);
});

test("archive rejects changed payloads and declared sizes even with valid tar and gzip checksums", async (t) => {
  const files = roots(), f = await fixture(t, files);
  const changed = tar(files); changed[512] ^= 1; await replace(f, changed);
  await assert.rejects(verifyCheckpointArchive(f.scope, f.expected), { code: "CHECKPOINT_ARCHIVE_CONTENT" });
  const sized = tar(files); octal(sized, 124, 12, files[0].content.length + 1); checksum(sized.subarray(0, 512)); await replace(f, sized);
  await assert.rejects(verifyCheckpointArchive(f.scope, f.expected), { code: "CHECKPOINT_ARCHIVE_CONTENT" });
  const wrong = f.expected.map((file, index) => index === 0 ? { ...file, sha256: "0".repeat(64) } : file);
  await replace(f, tar(files));
  await assert.rejects(verifyCheckpointArchive(f.scope, wrong), { code: "CHECKPOINT_ARCHIVE_CONTENT" });
});

test("archive rejects links, extensions, devices, unsafe names, extras and duplicate members", async (t) => {
  const files = roots();
  const badMembers = [
    ...["1", "2", "3", "4", "6", "x", "g", "L", "K", "S"].map((type) => header("manifest.json", 0, type)),
    ...["/manifest.json", "../manifest.json", "./manifest.json", "media//x", "media/../receipt.json", "unknown", "media/"].map((name) => header(name)),
    header("media/", 1, "5"), header("media/extra/", 0, "5"),
  ];
  for (const bad of badMembers) {
    const f = await fixture(t, files, gzipSync(Buffer.concat([bad, tar(files)])));
    await assert.rejects(verifyCheckpointArchive(f.scope, f.expected), closedFailure);
  }
  for (const extra of [member(files[0]), header("media/", 0, "5")]) {
    const f = await fixture(t, files, gzipSync(Buffer.concat([tar(files, { trailer: Buffer.alloc(0) }), extra, Buffer.alloc(1024)])));
    await assert.rejects(verifyCheckpointArchive(f.scope, f.expected), { code: "CHECKPOINT_ARCHIVE_FORMAT" });
  }
});

test("archive validates headers, simple numeric fields, extension-free names and zero file padding", async (t) => {
  const files = roots();
  const changes = [
    (bytes) => { bytes[148] ^= 1; },
    (bytes) => { bytes[124] = 0x80; checksum(bytes.subarray(0, 512)); },
    (bytes) => { bytes[100] = 0x39; checksum(bytes.subarray(0, 512)); },
    (bytes) => { bytes[257] = 0; checksum(bytes.subarray(0, 512)); },
    (bytes) => { bytes[157] = 0x78; checksum(bytes.subarray(0, 512)); },
    (bytes) => { bytes[345] = 0x78; checksum(bytes.subarray(0, 512)); },
    (bytes) => { bytes[99] = 0x78; checksum(bytes.subarray(0, 512)); },
    (bytes) => { bytes[265] = 0xff; checksum(bytes.subarray(0, 512)); },
    (bytes) => { bytes[512 + files[0].content.length] = 1; },
  ];
  for (const change of changes) {
    const bytes = tar(files); change(bytes); const f = await fixture(t, files, gzipSync(bytes));
    await assert.rejects(verifyCheckpointArchive(f.scope, f.expected), { code: "CHECKPOINT_ARCHIVE_FORMAT" });
  }
  const oversized = tar(files); octal(oversized, 124, 12, 2 ** 31 + 1); checksum(oversized.subarray(0, 512));
  const bounded = await fixture(t, files, gzipSync(oversized));
  await assert.rejects(verifyCheckpointArchive(bounded.scope, bounded.expected), { code: "CHECKPOINT_ARCHIVE_LIMIT" });
});

test("archive requires every expected file, the media directory and a complete zero-only end marker", async (t) => {
  const files = roots();
  const invalid = [
    tar(files.slice(1)), tar(files, { directory: false }), tar(files, { trailer: Buffer.alloc(512) }),
    tar(files, { trailer: Buffer.alloc(1023) }), tar(files, { trailer: Buffer.alloc(1025) }),
    Buffer.concat([tar(files), member(files[0])]),
    Buffer.concat([header(files[0].name, files[0].content.length), files[0].content.subarray(0, 2)]),
  ];
  for (const bytes of invalid) {
    const f = await fixture(t, files, gzipSync(bytes));
    await assert.rejects(verifyCheckpointArchive(f.scope, f.expected), { code: "CHECKPOINT_ARCHIVE_FORMAT" });
  }
});

test("archive verifies gzip CRC, compressed completeness and refuses ignored compressed suffix bytes", async (t) => {
  const files = roots(), good = gzipSync(tar(files)), crc = Buffer.from(good); crc[crc.length - 8] ^= 1;
  for (const bytes of [crc, good.subarray(0, good.length - 1), Buffer.concat([good, Buffer.alloc(4)]), Buffer.concat([good, Buffer.from(privateMarker)])]) {
    const f = await fixture(t, files, bytes);
    await assert.rejects(verifyCheckpointArchive(f.scope, f.expected), { code: "CHECKPOINT_ARCHIVE_FORMAT" });
  }
});

test("archive input is closed, bounded, dense and accessor-free", async (t) => {
  const f = await fixture(t); let accessed = false;
  const accessor = { bytes: 1, sha256: "a".repeat(64) };
  Object.defineProperty(accessor, "name", { enumerable: true, get() { accessed = true; throw new Error(privateMarker); } });
  const arrayAccessor = [...f.expected]; Object.defineProperty(arrayAccessor, "1", { enumerable: true, get() { accessed = true; throw new Error(privateMarker); } });
  const sparse = [...f.expected]; delete sparse[1];
  const extra = [...f.expected]; extra.unexpected = true;
  const options = {}; Object.defineProperty(options, "signal", { enumerable: true, get() { accessed = true; throw new Error(privateMarker); } });
  for (const expected of [null, [], Array(100004), [accessor, ...f.expected], arrayAccessor, sparse, extra, [...f.expected, f.expected[0]],
    f.expected.map((entry, index) => index === 0 ? { ...entry, bytes: 2 ** 31 + 1 } : entry),
    f.expected.map((entry, index) => index === 0 ? { ...entry, bytes: 0 } : entry),
    f.expected.map((entry) => ({ ...entry, bytes: 1024 * 1024 * 1024 })),
    f.expected.map((entry, index) => index === 0 ? { ...entry, name: "../manifest.json" } : entry),
    f.expected.map((entry, index) => index === 0 ? { ...entry, extra: true } : entry),
    f.expected.map((entry, index) => index === 0 ? { ...entry, sha256: "A".repeat(64) } : entry)]) {
    await assert.rejects(verifyCheckpointArchive(f.scope, expected), { code: "CHECKPOINT_ARCHIVE_INPUT" });
  }
  await assert.rejects(verifyCheckpointArchive(f.scope, f.expected, options), { code: "CHECKPOINT_ARCHIVE_INPUT" });
  await assert.rejects(verifyCheckpointArchive(f.scope, f.expected, { signal: {} }), { code: "CHECKPOINT_ARCHIVE_INPUT" });
  await assert.rejects(verifyCheckpointArchive(f.scope, f.expected, { extra: true }), { code: "CHECKPOINT_ARCHIVE_INPUT" });
  assert.equal(accessed, false);
  const badScope = { file: f.scope.file };
  Object.defineProperty(badScope, "assertReady", { get() { accessed = true; throw new Error(privateMarker); } });
  await assert.rejects(verifyCheckpointArchive(badScope, f.expected), { code: "CHECKPOINT_ARCHIVE_INPUT" });
  assert.equal(accessed, false);
});

test("archive rejects non-private modes, links, non-files and an oversized compressed file", async (t) => {
  const mutations = [
    async (f) => chmod(f.filename, 0o640),
    async (f) => chmod(f.root, 0o750),
    async (f) => link(f.filename, path.join(f.root, "hardlink")),
    async (f) => { await rename(f.filename, path.join(f.root, "retained")); await symlink(path.join(f.root, "retained"), f.filename); },
    async (f) => { await rm(f.filename); await mkdir(f.filename, { mode: 0o700 }); },
    async (f) => truncate(f.filename, 2 ** 31 + 1),
  ];
  for (const mutate of mutations) {
    const f = await fixture(t); await mutate(f);
    await assert.rejects(verifyCheckpointArchive(f.scope, f.expected), closedFailure);
  }
});

test("archive detects a changed descriptor owner and a visible inode replacement", async (t) => {
  for (const change of ["owner", "replace"]) {
    const f = await fixture(t); let changed = false;
    await hookOpen(async (original, args) => {
      const file = await original(...args);
      if (change === "owner") {
        const stat = file.stat.bind(file); file.stat = async (...values) => { const stats = await stat(...values); stats.uid += 1n; return stats; };
      } else {
        const read = file.read.bind(file); file.read = async (...values) => {
          if (!changed) { changed = true; await rename(f.filename, path.join(f.root, "retained")); await writeFile(f.filename, f.archive, { mode: 0o600, flag: "wx" }); }
          return read(...values);
        };
      }
      return file;
    }, () => assert.rejects(verifyCheckpointArchive(f.scope, f.expected), { code: change === "owner" ? "CHECKPOINT_ARCHIVE_UNSAFE" : "CHECKPOINT_ARCHIVE_CHANGED" }));
  }
});

test("archive rechecks its pinned private root after the complete stream", async (t) => {
  const f = await fixture(t), original = f.scope.assertReady; let checks = 0;
  f.scope.assertReady = async () => { const stats = await original(); if (++checks > 1) stats.ino += 1n; return stats; };
  await assert.rejects(verifyCheckpointArchive(f.scope, f.expected), { code: "CHECKPOINT_ARCHIVE_CHANGED" });
  assert.equal(checks, 2);
});

test("archive streams through one bounded read buffer, uses no-follow read-only descriptors and clears it on success", async (t) => {
  const f = await fixture(t, [...roots(), { name: mediaName, content: randomBytes(270123) }]);
  const buffers = []; let opened = 0, closed = 0;
  await hookOpen(async (original, args) => {
    assert.equal(args[1] & (fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT), 0);
    assert.equal(args[1] & fs.constants.O_NOFOLLOW, fs.constants.O_NOFOLLOW);
    assert.equal(args[1] & fs.constants.O_NONBLOCK, fs.constants.O_NONBLOCK);
    const file = await original(...args), read = file.read.bind(file), close = file.close.bind(file); opened += 1;
    file.read = async (...values) => { assert.equal(values[2] <= 64 * 1024, true); buffers.push(values[0]); return read(...values); };
    file.close = async () => { await close(); closed += 1; }; return file;
  }, async () => assert.equal((await verifyCheckpointArchive(f.scope, f.expected)).files, 4));
  assert.equal(opened, closed); assert.equal(buffers.length > 3, true);
  assert.equal(new Set(buffers).size, 1);
  assert.equal(buffers.every((buffer) => buffer.every((byte) => byte === 0)), true);
});

test("archive cancellation closes its descriptor, clears compressed buffers and leaves the original untouched", async (t) => {
  const files = [...roots(), { name: mediaName, content: randomBytes(210123) }], f = await fixture(t, files);
  const before = await lstat(f.filename, { bigint: true }), cancelled = new AbortController(); cancelled.abort();
  await assert.rejects(verifyCheckpointArchive(f.scope, f.expected, { signal: cancelled.signal }), { code: "CHECKPOINT_ARCHIVE_ABORTED" });
  const running = new AbortController(), buffers = []; let reads = 0, opened = 0, closed = 0;
  await hookOpen(async (original, args) => {
    const file = await original(...args), read = file.read.bind(file), close = file.close.bind(file); opened += 1;
    file.read = async (...values) => { buffers.push(values[0]); const result = await read(...values); if (++reads === 2) running.abort(); return result; };
    file.close = async () => { await close(); closed += 1; }; return file;
  }, () => assert.rejects(verifyCheckpointArchive(f.scope, f.expected, { signal: running.signal }), { code: "CHECKPOINT_ARCHIVE_ABORTED" }));
  assert.equal(opened, closed); assert.equal(reads, 2);
  assert.equal(buffers.every((buffer) => buffer.length <= 64 * 1024 && buffer.every((byte) => byte === 0)), true);
  const after = await lstat(f.filename, { bigint: true });
  for (const field of ["dev", "ino", "mode", "uid", "gid", "nlink", "size", "mtimeNs", "ctimeNs"]) assert.equal(after[field], before[field]);
  assert.deepEqual(await readFile(f.filename), f.archive);
});

test("archive handles filesystem errors without exposing private data or underlying errors", async (t) => {
  const f = await fixture(t); f.scope.assertReady = async () => { throw new Error(privateMarker); };
  await assert.rejects(verifyCheckpointArchive(f.scope, f.expected), closedFailure);
  assert.equal(gunzipSync(f.archive).length % 512, 0);
});
