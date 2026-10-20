import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { chmod, link, lstat, mkdir, mkdtemp, open, readFile, readdir, rename, rm, symlink, truncate, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CheckpointFilesError, copyCheckpointMedia, resumeCheckpointMedia, verifyCheckpointMedia } from "../server/backup/checkpoint-files.mjs";

const repository = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const name = (number, variant = "full") => `${number.toString(16).padStart(64, "0")}.${variant}.enc`;
const digest = (content) => createHash("sha256").update(content).digest("hex");
const privateMarker = "synthetic private ciphertext must not appear in an error";
const unavailable = (error) => error instanceof CheckpointFilesError && /^CHECKPOINT_FILES_[A-Z]+$/.test(error.code)
  && error.message === "Private checkpoint files could not be verified." && !String(error).includes(privateMarker);

async function fixture(t) {
  const base = path.resolve(repository, "../audit");
  await mkdir(base, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(path.join(base, "checkpoint-files-"));
  await chmod(root, 0o700);
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, "source"), target = path.join(root, "target");
  await mkdir(source, { mode: 0o700 });
  await mkdir(target, { mode: 0o700 });
  return { root, source, target, sourceScope: await scope(source), targetScope: await scope(target) };
}

// The production caller provides pinned directory scopes. These real-filesystem
// unit scopes check the same root identity without requiring procfs availability.
async function scope(directory) {
  const original = await lstat(directory, { bigint: true });
  let syncs = 0;
  return {
    path: directory,
    file(basename) {
      assert.equal(typeof basename, "string");
      assert.equal(/[/\\\0]/.test(basename), false);
      return path.join(directory, basename);
    },
    async assertReady() {
      const current = await lstat(directory, { bigint: true });
      assert.equal(current.dev, original.dev);
      assert.equal(current.ino, original.ino);
      return current;
    },
    async sync() {
      const handle = await open(directory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY);
      try { await handle.sync(); syncs += 1; }
      finally { await handle.close(); }
    },
    get syncs() { return syncs; },
  };
}

async function put(directory, basename, content = Buffer.from(privateMarker)) {
  await writeFile(path.join(directory, basename), content, { mode: 0o600, flag: "wx" });
  return content;
}

const inventoryOf = records => ({ files: records.map(([name, contents]) => ({ name, bytes: contents.length, sha256: digest(contents) })),
  bytes: records.reduce((sum, [, contents]) => sum + contents.length, 0) });
const fileState = stats => Object.fromEntries(["dev", "ino", "mode", "uid", "gid", "nlink", "size", "mtimeNs", "ctimeNs"].map(key => [key, stats[key]]));

async function hookOpen(callback, operation) {
  const original = fs.promises.open;
  fs.promises.open = async (...args) => callback(original, args);
  syncBuiltinESMExports();
  try { return await operation(); }
  finally { fs.promises.open = original; syncBuiltinESMExports(); }
}

test("checkpoint copies exact ciphertext bytes into distinct private inodes, sorts its closed receipt and re-reads both roots", async (t) => {
  const f = await fixture(t);
  const first = await put(f.source, name(2), Buffer.alloc(150000, 29));
  const second = await put(f.source, name(1, "thumb"));
  const originals = new Map(await Promise.all([name(1, "thumb"), name(2)].map(async (basename) => [basename, await lstat(path.join(f.source, basename), { bigint: true })])));
  const inventory = await copyCheckpointMedia(f.sourceScope, f.targetScope);
  assert.deepEqual(inventory, { files: [
    { name: name(1, "thumb"), bytes: second.length, sha256: digest(second) },
    { name: name(2), bytes: first.length, sha256: digest(first) },
  ], bytes: first.length + second.length });
  assert.deepEqual(Object.keys(inventory).sort(), ["bytes", "files"]);
  assert.equal(Object.isFrozen(inventory), true);
  assert.equal(Object.isFrozen(inventory.files), true);
  assert.equal(f.targetScope.syncs, 1);
  for (const entry of inventory.files) {
    const source = await lstat(path.join(f.source, entry.name), { bigint: true });
    const target = await lstat(path.join(f.target, entry.name), { bigint: true });
    assert.equal(source.ino, originals.get(entry.name).ino);
    assert.equal(source.ctimeNs, originals.get(entry.name).ctimeNs);
    assert.equal(source.mtimeNs, originals.get(entry.name).mtimeNs);
    assert.equal(target.dev === source.dev && target.ino === source.ino, false);
    assert.equal(target.mode & 0o7777n, 0o600n);
    assert.equal(target.nlink, 1n);
    assert.equal(target.uid, BigInt(process.getuid()));
    assert.deepEqual(await readFile(path.join(f.source, entry.name)), await readFile(path.join(f.target, entry.name)));
  }
  assert.deepEqual(await verifyCheckpointMedia(f.targetScope, JSON.parse(JSON.stringify(inventory))), inventory);
  assert.equal(JSON.stringify(inventory).includes(privateMarker), false);
});

test("checkpoint accepts empty private storage and refuses a source/target alias", async (t) => {
  const f = await fixture(t);
  assert.deepEqual(await copyCheckpointMedia(f.sourceScope, f.targetScope), { files: [], bytes: 0 });
  assert.deepEqual(await verifyCheckpointMedia(f.targetScope, { files: [], bytes: 0 }), { files: [], bytes: 0 });
  await assert.rejects(copyCheckpointMedia(f.sourceScope, f.sourceScope), { code: "CHECKPOINT_FILES_INPUT" });
});

test("checkpoint rejects staging, unknown names, directories, symlinks, hardlinks and non-private modes before copying", async (t) => {
  const defects = [
    async (f) => put(f.source, `.${"a".repeat(64)}.full.${"b".repeat(32)}.tmp`),
    async (f) => put(f.source, "unrelated.json"),
    async (f) => mkdir(path.join(f.source, name(1)), { mode: 0o700 }),
    async (f) => { const outside = await put(f.root, "outside"); await symlink(path.join(f.root, "outside"), path.join(f.source, name(1))); return outside; },
    async (f) => { await put(f.source, name(1)); await link(path.join(f.source, name(1)), path.join(f.root, "hardlink")); },
    async (f) => { await put(f.source, name(1)); await chmod(path.join(f.source, name(1)), 0o640); },
    async (f) => put(f.source, name(1), Buffer.alloc(0)),
  ];
  for (const defect of defects) {
    const f = await fixture(t);
    await defect(f);
    await assert.rejects(copyCheckpointMedia(f.sourceScope, f.targetScope), unavailable);
    assert.deepEqual(await readdir(f.target), []);
  }
});

test("checkpoint rejects a descriptor whose ownership no longer matches the private owner", async (t) => {
  const f = await fixture(t);
  await put(f.source, name(1));
  // Reproduce the checked fstat boundary without requiring chown privileges or
  // changing ownership of files that the test account must clean up afterward.
  await hookOpen(async (original, args) => {
    const handle = await original(...args);
    if (String(args[0]) === path.join(f.source, name(1))) {
      const stat = handle.stat.bind(handle);
      handle.stat = async (...parameters) => {
        const value = await stat(...parameters);
        value.uid += 1n;
        return value;
      };
    }
    return handle;
  }, () => assert.rejects(copyCheckpointMedia(f.sourceScope, f.targetScope), { code: "CHECKPOINT_FILES_UNSAFE" }));
  assert.deepEqual(await readdir(f.target), []);
});

test("checkpoint enforces the individual and aggregate byte budgets before creating output", async (t) => {
  const oversized = await fixture(t);
  await put(oversized.source, name(1));
  await truncate(path.join(oversized.source, name(1)), 10 * 1024 * 1024 + 129);
  await assert.rejects(copyCheckpointMedia(oversized.sourceScope, oversized.targetScope), { code: "CHECKPOINT_FILES_LIMIT" });
  assert.deepEqual(await readdir(oversized.target), []);
  const aggregate = await fixture(t);
  for (let index = 0; index < 103; index += 1) {
    await put(aggregate.source, name(index), Buffer.alloc(0));
    await truncate(path.join(aggregate.source, name(index)), 10 * 1024 * 1024);
  }
  await assert.rejects(copyCheckpointMedia(aggregate.sourceScope, aggregate.targetScope), { code: "CHECKPOINT_FILES_LIMIT" });
  assert.deepEqual(await readdir(aggregate.target), []);
});

test("checkpoint never overwrites or removes an existing destination", async (t) => {
  const f = await fixture(t), source = await put(f.source, name(1));
  const previous = await put(f.target, name(1), Buffer.from("existing private checkpoint"));
  await assert.rejects(copyCheckpointMedia(f.sourceScope, f.targetScope), unavailable);
  assert.deepEqual(await readFile(path.join(f.target, name(1))), previous);
  assert.deepEqual(await readFile(path.join(f.source, name(1))), source);
});

test("verification rejects missing, extra, changed, linked and incorrectly protected copies without modifying them", async (t) => {
  const mutations = [
    async (f) => rename(path.join(f.target, name(1)), path.join(f.root, "removed")),
    async (f) => put(f.target, name(2)),
    async (f) => writeFile(path.join(f.target, name(1)), Buffer.alloc(privateMarker.length, 5)),
    async (f) => chmod(path.join(f.target, name(1)), 0o400),
    async (f) => link(path.join(f.target, name(1)), path.join(f.root, "copy-link")),
  ];
  for (const mutate of mutations) {
    const f = await fixture(t);
    await put(f.source, name(1));
    const inventory = await copyCheckpointMedia(f.sourceScope, f.targetScope);
    await mutate(f);
    const names = await readdir(f.target);
    let writes = 0;
    await hookOpen(async (original, args) => {
      assert.equal((args[1] & (fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT)) === 0, true);
      const handle = await original(...args);
      handle.write = async () => { writes += 1; throw new Error(privateMarker); };
      return handle;
    }, () => assert.rejects(verifyCheckpointMedia(f.targetScope, inventory), unavailable));
    assert.equal(writes, 0);
    assert.deepEqual(await readdir(f.target), names);
  }
});

test("verification accepts only a closed canonical inventory and does not invoke field accessors", async (t) => {
  const f = await fixture(t);
  let accessed = false;
  const accessor = { bytes: 1, sha256: "a".repeat(64) };
  Object.defineProperty(accessor, "name", { enumerable: true, get() { accessed = true; throw new Error(privateMarker); } });
  for (const inventory of [null, { files: [], bytes: 0, extra: true }, { files: [], bytes: 1 },
    { files: [accessor], bytes: 1 }, { files: [{ name: "../outside", bytes: 1, sha256: "a".repeat(64) }], bytes: 1 },
    { files: [{ name: name(1), bytes: 1, sha256: "A".repeat(64) }], bytes: 1 },
    { files: [{ name: name(2), bytes: 1, sha256: "a".repeat(64) }, { name: name(1), bytes: 1, sha256: "b".repeat(64) }], bytes: 2 }]) {
    await assert.rejects(verifyCheckpointMedia(f.targetScope, inventory), { code: "CHECKPOINT_FILES_INPUT" });
  }
  const options = {};
  Object.defineProperty(options, "signal", { enumerable: true, get() { accessed = true; throw new Error(privateMarker); } });
  await assert.rejects(copyCheckpointMedia(f.sourceScope, f.targetScope, options), { code: "CHECKPOINT_FILES_INPUT" });
  assert.equal(accessed, false);
});

test("a cancelled checkpoint creates no files, and a mid-copy cancellation closes descriptors and clears read buffers", async (t) => {
  const f = await fixture(t), controller = new AbortController();
  await put(f.source, name(1), Buffer.alloc(200000, 57));
  controller.abort();
  await assert.rejects(copyCheckpointMedia(f.sourceScope, f.targetScope, { signal: controller.signal }), { code: "CHECKPOINT_FILES_ABORTED" });
  assert.deepEqual(await readdir(f.target), []);
  const running = new AbortController(), buffers = [];
  let opened = 0, closed = 0, reads = 0;
  await hookOpen(async (original, args) => {
    const handle = await original(...args), close = handle.close.bind(handle);
    opened += 1;
    handle.close = async () => { await close(); closed += 1; };
    if (String(args[0]) === path.join(f.source, name(1))) {
      const read = handle.read.bind(handle);
      handle.read = async (...parameters) => {
        buffers.push(parameters[0]);
        const result = await read(...parameters);
        if (++reads === 2) running.abort();
        return result;
      };
    }
    return handle;
  }, () => assert.rejects(copyCheckpointMedia(f.sourceScope, f.targetScope, { signal: running.signal }), { code: "CHECKPOINT_FILES_ABORTED" }));
  assert.equal(opened, closed);
  assert.equal(buffers.length, 2);
  assert.equal(buffers.every((buffer) => buffer.every((byte) => byte === 0)), true);
  assert.deepEqual(await readdir(f.source), [name(1)]);
  assert.deepEqual(await readdir(f.target), [name(1)]);
  assert.equal((await lstat(path.join(f.target, name(1)))).mode & 0o7777, 0o600);
});

test("checkpoint detects a source inode swapped during an open read even when replacement bytes are identical", async (t) => {
  const f = await fixture(t), contents = await put(f.source, name(1));
  let swapped = false;
  await hookOpen(async (original, args) => {
    const handle = await original(...args);
    if (String(args[0]) === path.join(f.source, name(1))) {
      const read = handle.read.bind(handle);
      handle.read = async (...parameters) => {
        if (!swapped) {
          swapped = true;
          await rename(path.join(f.source, name(1)), path.join(f.root, "retained-original"));
          await put(f.source, name(1), contents);
        }
        return read(...parameters);
      };
    }
    return handle;
  }, () => assert.rejects(copyCheckpointMedia(f.sourceScope, f.targetScope), { code: "CHECKPOINT_FILES_CHANGED" }));
  assert.equal(swapped, true);
  assert.deepEqual(await readFile(path.join(f.root, "retained-original")), contents);
  assert.deepEqual(await readFile(path.join(f.source, name(1))), contents);
  assert.deepEqual(await readdir(f.target), [name(1)]);
});

test("checkpoint detects a source replacement after its first copy and never deletes the failed private artifact", async (t) => {
  const f = await fixture(t), contents = await put(f.source, name(1));
  const sync = f.targetScope.sync.bind(f.targetScope);
  f.targetScope.sync = async () => {
    await sync();
    await rename(path.join(f.source, name(1)), path.join(f.root, "previous-source"));
    await put(f.source, name(1), contents);
  };
  await assert.rejects(copyCheckpointMedia(f.sourceScope, f.targetScope), { code: "CHECKPOINT_FILES_CHANGED" });
  assert.deepEqual(await readFile(path.join(f.target, name(1))), contents);
  assert.deepEqual(await readFile(path.join(f.root, "previous-source")), contents);
});

test("checkpoint re-reads the destination and rejects a changed digest before returning a receipt", async (t) => {
  const f = await fixture(t);
  await put(f.source, name(1));
  const sync = f.targetScope.sync.bind(f.targetScope);
  f.targetScope.sync = async () => {
    await sync();
    await writeFile(path.join(f.target, name(1)), Buffer.alloc(privateMarker.length, 17));
  };
  await assert.rejects(copyCheckpointMedia(f.sourceScope, f.targetScope), { code: "CHECKPOINT_FILES_CHANGED" });
  assert.deepEqual(await readdir(f.target), [name(1)]);
});

test("checkpoint checks the destination again after its final source verification", async (t) => {
  const f = await fixture(t), contents = await put(f.source, name(1));
  let sourceOpens = 0, mutated = false;
  await hookOpen(async (original, args) => {
    const handle = await original(...args);
    if (String(args[0]) === path.join(f.source, name(1)) && ++sourceOpens === 2) {
      const read = handle.read.bind(handle);
      handle.read = async (...parameters) => {
        if (!mutated) {
          mutated = true;
          await writeFile(path.join(f.target, name(1)), Buffer.alloc(contents.length, 71));
        }
        return read(...parameters);
      };
    }
    return handle;
  }, () => assert.rejects(copyCheckpointMedia(f.sourceScope, f.targetScope), { code: "CHECKPOINT_FILES_CHANGED" }));
  assert.equal(mutated, true);
});

test("read-only verification detects an inode replaced while its descriptor is open", async (t) => {
  const f = await fixture(t), contents = await put(f.source, name(1));
  const inventory = await copyCheckpointMedia(f.sourceScope, f.targetScope);
  let swapped = false;
  await hookOpen(async (original, args) => {
    const handle = await original(...args);
    if (String(args[0]) === path.join(f.target, name(1))) {
      const read = handle.read.bind(handle);
      handle.read = async (...parameters) => {
        if (!swapped) {
          swapped = true;
          await rename(path.join(f.target, name(1)), path.join(f.root, "previous-copy"));
          await put(f.target, name(1), contents);
        }
        return read(...parameters);
      };
    }
    return handle;
  }, () => assert.rejects(verifyCheckpointMedia(f.targetScope, inventory), { code: "CHECKPOINT_FILES_CHANGED" }));
  assert.equal(swapped, true);
});

test("filesystem failures never expose a private name, path or underlying exception", async (t) => {
  const f = await fixture(t);
  f.sourceScope.assertReady = async () => { throw new Error(privateMarker); };
  await assert.rejects(copyCheckpointMedia(f.sourceScope, f.targetScope), unavailable);
  await assert.rejects(verifyCheckpointMedia(f.sourceScope, { files: [], bytes: 0 }), unavailable);
  assert.deepEqual(await readdir(f.target), []);
});

test("restore resumes an interrupted real-file copy by creating only missing files and retaining verified inodes", async t => {
  const f = await fixture(t), controller = new AbortController();
  const records = [[name(1), Buffer.alloc(150000, 21)], [name(2), Buffer.alloc(70000, 39)], [name(3, "thumb"), Buffer.alloc(55, 81)]];
  for (const [basename, contents] of records) await put(f.source, basename, contents);
  const expected = inventoryOf(records);
  await hookOpen(async (original, args) => {
    const handle = await original(...args);
    if (String(args[0]) === path.join(f.target, name(1))) {
      const sync = handle.sync.bind(handle);
      handle.sync = async () => { await sync(); controller.abort(); };
    }
    return handle;
  }, () => assert.rejects(resumeCheckpointMedia(f.sourceScope, f.targetScope, expected, { signal: controller.signal }), { code: "CHECKPOINT_FILES_ABORTED" }));
  assert.deepEqual(await readdir(f.target), [name(1)]);
  assert.deepEqual(await readFile(path.join(f.target, name(1))), records[0][1]);
  const retained = fileState(await lstat(path.join(f.target, name(1)), { bigint: true })), created = [];
  await hookOpen(async (original, args) => {
    if (String(args[0]).startsWith(`${f.target}/`) && (args[1] & fs.constants.O_CREAT)) created.push(path.basename(String(args[0])));
    return original(...args);
  }, async () => assert.deepEqual(await resumeCheckpointMedia(f.sourceScope, f.targetScope, expected), expected));
  assert.deepEqual(created, [name(2), name(3, "thumb")]);
  assert.deepEqual(fileState(await lstat(path.join(f.target, name(1)), { bigint: true })), retained);
  assert.deepEqual(await verifyCheckpointMedia(f.targetScope, expected), expected);
  assert.deepEqual(await resumeCheckpointMedia(f.sourceScope, f.targetScope, expected), expected);
});

test("restore refuses truncated, divergent, unexpected or unsafe existing files before creating any missing file", async t => {
  const defects = [
    async f => put(f.target, name(1), Buffer.alloc(1, 31)),
    async f => put(f.target, name(1), Buffer.alloc(100, 32)),
    async f => put(f.target, name(4), Buffer.alloc(100, 31)),
    async f => { await put(f.target, name(1), Buffer.alloc(100, 31)); await chmod(path.join(f.target, name(1)), 0o640); },
    async f => { await put(f.target, name(1), Buffer.alloc(100, 31)); await link(path.join(f.target, name(1)), path.join(f.root, "retained-hardlink")); },
    async f => { await symlink(path.join(f.source, name(1)), path.join(f.target, name(1))); },
    async f => put(f.target, name(1), Buffer.alloc(0)),
  ];
  for (const defect of defects) {
    const f = await fixture(t), records = [[name(1), Buffer.alloc(100, 31)], [name(2), Buffer.alloc(20, 41)]];
    for (const [basename, contents] of records) await put(f.source, basename, contents);
    await defect(f);
    const before = await readdir(f.target), states = await Promise.all(before.map(async basename => fileState(await lstat(path.join(f.target, basename), { bigint: true }))));
    await assert.rejects(resumeCheckpointMedia(f.sourceScope, f.targetScope, inventoryOf(records)), unavailable);
    assert.deepEqual(await readdir(f.target), before);
    assert.deepEqual(await Promise.all(before.map(async basename => fileState(await lstat(path.join(f.target, basename), { bigint: true })))), states);
  }
});

test("restore preserves and refuses a file actually truncated by mid-write cancellation", async t => {
  const f = await fixture(t), controller = new AbortController(), records = [[name(1), Buffer.alloc(150000, 31)], [name(2), Buffer.alloc(20, 41)]];
  for (const [basename, contents] of records) await put(f.source, basename, contents);
  const expected = inventoryOf(records);
  await hookOpen(async (original, args) => {
    const handle = await original(...args);
    if (String(args[0]) === path.join(f.target, name(1)) && (args[1] & fs.constants.O_CREAT)) {
      const write = handle.write.bind(handle);
      handle.write = async (...parameters) => { const result = await write(...parameters); controller.abort(); return result; };
    }
    return handle;
  }, () => assert.rejects(resumeCheckpointMedia(f.sourceScope, f.targetScope, expected, { signal: controller.signal }), { code: "CHECKPOINT_FILES_ABORTED" }));
  const partial = await readFile(path.join(f.target, name(1))), retained = fileState(await lstat(path.join(f.target, name(1)), { bigint: true }));
  assert.ok(partial.length > 0 && partial.length < records[0][1].length);
  await assert.rejects(resumeCheckpointMedia(f.sourceScope, f.targetScope, expected), { code: "CHECKPOINT_FILES_CHANGED" });
  assert.deepEqual(await readdir(f.target), [name(1)]); assert.deepEqual(await readFile(path.join(f.target, name(1))), partial);
  assert.deepEqual(fileState(await lstat(path.join(f.target, name(1)), { bigint: true })), retained);
});

test("restore authenticates the complete source before adding files to a partial target", async t => {
  const f = await fixture(t), records = [[name(1), Buffer.alloc(100, 31)], [name(2), Buffer.alloc(20, 41)]];
  await put(f.source, name(1), records[0][1]); await put(f.source, name(2), Buffer.alloc(20, 42));
  await put(f.target, name(1), records[0][1]);
  await assert.rejects(resumeCheckpointMedia(f.sourceScope, f.targetScope, inventoryOf(records)), { code: "CHECKPOINT_FILES_CHANGED" });
  assert.deepEqual(await readdir(f.target), [name(1)]);
  await assert.rejects(resumeCheckpointMedia(f.sourceScope, f.sourceScope, inventoryOf(records)), { code: "CHECKPOINT_FILES_INPUT" });
});

test("restore refuses changes to a retained target inode while a missing file is copied", async t => {
  const f = await fixture(t), records = [[name(1), Buffer.alloc(100, 31)], [name(2), Buffer.alloc(20, 41)]];
  for (const [basename, contents] of records) await put(f.source, basename, contents);
  await put(f.target, name(1), records[0][1]); let changed = false;
  await hookOpen(async (original, args) => {
    if (String(args[0]) === path.join(f.target, name(2)) && (args[1] & fs.constants.O_CREAT)) {
      await rename(path.join(f.target, name(1)), path.join(f.root, "retained-original"));
      await put(f.target, name(1), records[0][1]); changed = true;
    }
    return original(...args);
  }, () => assert.rejects(resumeCheckpointMedia(f.sourceScope, f.targetScope, inventoryOf(records)), { code: "CHECKPOINT_FILES_CHANGED" }));
  assert.equal(changed, true); assert.deepEqual(await readFile(path.join(f.root, "retained-original")), records[0][1]);
});

test("restore refuses source inode and root drift during a resumed copy", async t => {
  for (const drift of ["source", "root"]) {
    const f = await fixture(t), records = [[name(1), Buffer.alloc(100, 31)], [name(2), Buffer.alloc(20, 41)]];
    for (const [basename, contents] of records) await put(f.source, basename, contents);
    await put(f.target, name(1), records[0][1]);
    const sync = f.targetScope.sync.bind(f.targetScope);
    f.targetScope.sync = async () => {
      await sync();
      if (drift === "source") {
        await rename(path.join(f.source, name(1)), path.join(f.root, "previous-source")); await put(f.source, name(1), records[0][1]);
      } else {
        const assertReady = f.targetScope.assertReady.bind(f.targetScope);
        f.targetScope.assertReady = async () => { const stats = await assertReady(); return { ...stats, ino: stats.ino + 1n, isDirectory: () => true }; };
      }
    };
    await assert.rejects(resumeCheckpointMedia(f.sourceScope, f.targetScope, inventoryOf(records)), { code: "CHECKPOINT_FILES_CHANGED" });
    assert.deepEqual(await readdir(f.target), [name(1), name(2)]);
  }
});
