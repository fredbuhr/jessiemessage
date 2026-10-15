import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { constants } from "node:fs";
import * as fs from "node:fs/promises";
import { inspectPlatform, PLATFORM_CHECK_NAMES } from "../server/preflight/platform.mjs";

const checkout = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const base = path.resolve(checkout, "../audit");
const status = (report, name) => report.checks.find((check) => check.name === name).status;
const privateFailure = () => new Error("private-password private@example.invalid /private/operator/path");
function neutral(report) {
  assert.deepEqual(Object.keys(report).sort(), ["checks", "valid"]);
  assert.equal(typeof report.valid, "boolean"); assert.deepEqual(report.checks.map((check) => check.name), [...PLATFORM_CHECK_NAMES]);
  for (const check of report.checks) {
    assert.deepEqual(Object.keys(check).sort(), ["name", "status"]);
    assert.ok(["pass", "fail", "not_checked"].includes(check.status));
  }
  assert.doesNotMatch(JSON.stringify(report), /private-password|private@example|\/private\/|\/workspace\/|probe-staging|probe-published|\.jpg|node_modules/);
  return report;
}
function wrapped(handle, methods) {
  return new Proxy(handle, { get(target, key) {
    if (Object.hasOwn(methods, key)) return methods[key];
    const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
  } });
}
// Test-only teardown is confined to a newly allocated synthetic fixture. The
// production probe never lists directories or recursively removes anything.
async function removeFixture(target) {
  const stats = await fs.lstat(target);
  if (stats.isDirectory() && !stats.isSymbolicLink()) {
    for (const name of await fs.readdir(target)) await removeFixture(path.join(target, name));
    await fs.rmdir(target);
  } else await fs.unlink(target);
}
async function fixture(t) {
  await fs.mkdir(base, { recursive: true, mode: 0o700 });
  const root = await fs.mkdtemp(path.join(base, "platform-preflight-"));
  const parent = path.join(root, "scratch-parent"), mediaRoot = path.join(root, "media-source");
  await fs.mkdir(parent, { mode: 0o700 }); await fs.mkdir(mediaRoot, { mode: 0o700 });
  const scratch = path.join(parent, "new-probe"); t.after(() => removeFixture(root));
  return { root, parent, mediaRoot, scratch, options: { scratch, mediaRoot } };
}
async function absent(target) { await assert.rejects(fs.lstat(target), { code: "ENOENT" }); }

test("default platform inspection checks real Node 24 and in-memory Sharp without a filesystem probe", async () => {
  const calls = [];
  const filesystem = Object.fromEntries(["lstat", "realpath", "mkdir", "open", "rename", "link", "unlink", "rmdir"]
    .map((name) => [name, () => { calls.push(name); throw privateFailure(); }]));
  const report = neutral(await inspectPlatform({}, { fs: filesystem }));
  assert.equal(report.valid, true); assert.equal(status(report, "node_runtime"), "pass");
  assert.equal(status(report, "sharp_jpeg"), "pass"); assert.equal(status(report, "scratch_filesystem"), "not_checked");
  assert.deepEqual(calls, []);
});

test("unsupported Node versions and native codec failures produce fixed independent diagnostics", async () => {
  for (const nodeVersion of ["18.20.8", "22.21.0", "25.0.0", "24.0.0-nightly-private", "private-password", "999999999999.0.0"]) {
    const report = neutral(await inspectPlatform({}, { nodeVersion }));
    assert.equal(report.valid, false); assert.equal(status(report, "node_runtime"), "fail"); assert.equal(status(report, "scratch_filesystem"), "not_checked");
  }
  for (const loadSharp of [async () => { throw privateFailure(); }, async () => ({ private: "unusable native module" }), async () => () => { throw privateFailure(); }]) {
    const report = neutral(await inspectPlatform({}, { loadSharp }));
    assert.equal(report.valid, false); assert.equal(status(report, "node_runtime"), "pass"); assert.equal(status(report, "sharp_jpeg"), "fail");
  }
});

test("an explicitly selected fresh directory verifies exact modes, sync, rename, read and exclusive hard-link publication, then disappears", async (t) => {
  const f = await fixture(t), calls = [];
  await fs.writeFile(path.join(f.mediaRoot, "existing-private-sentinel"), "existing-media-must-stay", { mode: 0o600 });
  const filesystem = Object.fromEntries(["lstat", "realpath", "mkdir", "rename", "link", "unlink", "rmdir"].map((name) => [name, async (...args) => {
    calls.push([name, ...args]); return fs[name](...args);
  }]));
  filesystem.open = async (...args) => {
    calls.push(["open", ...args]); const handle = await fs.open(...args);
    const stats = await handle.stat({ bigint: true });
    if (args[2] === 0o600) {
      assert.equal(stats.mode & 0o7777n, 0o600n); assert.ok(args[1] & constants.O_EXCL); assert.ok(args[1] & constants.O_NOFOLLOW);
    }
    return wrapped(handle, { async sync() { calls.push(["sync", args[0]]); return handle.sync(); } });
  };
  const report = neutral(await inspectPlatform(f.options, { fs: filesystem }));
  assert.equal(report.valid, true); assert.equal(status(report, "scratch_filesystem"), "pass"); await absent(f.scratch);
  assert.deepEqual(await fs.readdir(f.parent), []);
  assert.equal(await fs.readFile(path.join(f.mediaRoot, "existing-private-sentinel"), "utf8"), "existing-media-must-stay");
  for (const name of ["mkdir", "rename", "link", "unlink", "rmdir"]) assert.ok(calls.some((entry) => entry[0] === name), name);
  assert.ok(calls.filter((entry) => entry[0] === "sync").length >= 5);
  assert.ok(calls.every((entry) => typeof entry[1] !== "string" || entry[1] !== f.mediaRoot && !entry[1].startsWith(f.mediaRoot + path.sep)));
});

test("existing directories, files and symlink leaves are never reused or deleted", async (t) => {
  for (const type of ["directory", "file", "symlink"]) {
    const f = await fixture(t), sentinel = path.join(f.root, "outside-sentinel");
    await fs.writeFile(sentinel, "keep-synthetic-sentinel", { mode: 0o600 });
    if (type === "directory") { await fs.mkdir(f.scratch, { mode: 0o700 }); await fs.writeFile(path.join(f.scratch, "existing"), "keep-directory-content"); }
    if (type === "file") await fs.writeFile(f.scratch, "keep-file", { mode: 0o600 });
    if (type === "symlink") await fs.symlink(sentinel, f.scratch);
    const report = neutral(await inspectPlatform(f.options)); assert.equal(status(report, "scratch_filesystem"), "fail");
    if (type === "directory") assert.equal(await fs.readFile(path.join(f.scratch, "existing"), "utf8"), "keep-directory-content");
    if (type === "file") assert.equal(await fs.readFile(f.scratch, "utf8"), "keep-file");
    if (type === "symlink") assert.equal((await fs.lstat(f.scratch)).isSymbolicLink(), true);
    assert.equal(await fs.readFile(sentinel, "utf8"), "keep-synthetic-sentinel");
  }
});

test("invalid, protected, noncanonical and control-containing paths fail before codec or filesystem work", async (t) => {
  const f = await fixture(t); let work = 0;
  const dependencies = { loadSharp: async () => { work++; throw privateFailure(); }, fs: { lstat: () => { work++; throw privateFailure(); } } };
  for (const scratch of ["relative", "/", f.scratch + "/", f.scratch + "/../elsewhere", f.scratch + "\0secret", f.scratch + "\nsecret",
    checkout, path.join(checkout, "public/new-probe"), path.dirname(checkout), f.mediaRoot, path.join(f.mediaRoot, "probe"), f.root]) {
    const report = neutral(await inspectPlatform({ scratch, mediaRoot: f.mediaRoot }, dependencies));
    assert.equal(report.valid, false); assert.equal(status(report, "scratch_filesystem"), "fail");
  }
  for (const mediaRoot of ["relative", f.mediaRoot + "/", f.mediaRoot + "\nsecret", 1]) {
    assert.equal(neutral(await inspectPlatform({ mediaRoot }, dependencies)).valid, false);
  }
  assert.equal(work, 0); await absent(f.scratch);
});

test("media root paths are lexical exclusions, never targets of stat, listing, read or write", async (t) => {
  const f = await fixture(t); const calls = [];
  const report = neutral(await inspectPlatform({ mediaRoot: path.join(f.root, "does-not-exist-private-media") }, {
    fs: { lstat: (...args) => { calls.push(args); throw privateFailure(); } },
  }));
  assert.equal(report.valid, true); assert.equal(status(report, "scratch_filesystem"), "not_checked"); assert.deepEqual(calls, []);
});

test("unsafe parent permissions, writable ancestors and symbolic ancestors refuse creation", async (t) => {
  const f = await fixture(t);
  await fs.chmod(f.parent, 0o755); assert.equal(status(neutral(await inspectPlatform(f.options)), "scratch_filesystem"), "fail"); await absent(f.scratch);
  await fs.chmod(f.parent, 0o700);
  const alias = path.join(f.root, "parent-alias"); await fs.symlink(f.parent, alias);
  assert.equal(status(neutral(await inspectPlatform({ scratch: path.join(alias, "new-probe"), mediaRoot: f.mediaRoot })), "scratch_filesystem"), "fail"); await absent(f.scratch);
  const unsafe = path.join(f.root, "unsafe"), privateParent = path.join(unsafe, "private");
  await fs.mkdir(unsafe, { mode: 0o777 }); await fs.chmod(unsafe, 0o777); await fs.mkdir(privateParent, { mode: 0o700 });
  const candidate = path.join(privateParent, "new-probe");
  assert.equal(status(neutral(await inspectPlatform({ scratch: candidate, mediaRoot: f.mediaRoot })), "scratch_filesystem"), "fail"); await absent(candidate);
});

test("partial write, file sync, directory sync and bounded read failures fail neutrally and clean known creations", async (t) => {
  for (const failure of ["write", "file-sync", "directory-sync", "read"]) {
    const f = await fixture(t); let injected = false;
    const report = neutral(await inspectPlatform(f.options, { fs: { async open(...args) {
      const handle = await fs.open(...args), directory = Boolean(args[1] & constants.O_DIRECTORY), creation = args[2] === 0o600;
      return wrapped(handle, {
        async writeFile(bytes) { if (failure === "write" && !injected) { injected = true; await handle.writeFile(bytes.subarray(0, 12)); throw privateFailure(); } return handle.writeFile(bytes); },
        async sync() { if (!injected && (failure === "file-sync" && creation || failure === "directory-sync" && directory)) { injected = true; throw privateFailure(); } return handle.sync(); },
        async read(...values) { const result = await handle.read(...values); if (failure === "read" && !injected) { injected = true; values[0][0] ^= 1; } return result; },
      });
    } } }));
    assert.equal(injected, true, failure); assert.equal(report.valid, false); assert.equal(status(report, "scratch_filesystem"), "fail"); await absent(f.scratch);
  }
});

test("failed file and parent closes cannot report a successful platform probe", async (t) => {
  for (const failure of ["file-close", "parent-close"]) {
    const f = await fixture(t); let injected = false;
    const report = neutral(await inspectPlatform(f.options, { fs: { async open(...args) {
      const handle = await fs.open(...args);
      return wrapped(handle, { async close() {
        await handle.close();
        if (!injected && (failure === "file-close" && args[2] === 0o600 || failure === "parent-close" && args[0] === f.parent)) { injected = true; throw privateFailure(); }
      } });
    } } }));
    assert.equal(injected, true); assert.equal(status(report, "scratch_filesystem"), "fail"); await absent(f.scratch);
  }
});

test("a foreign conflicting publication is preserved and blocks cleanup instead of being overwritten or recursively deleted", async (t) => {
  const f = await fixture(t);
  const report = neutral(await inspectPlatform(f.options, { fs: { async link(source, target) {
    await fs.writeFile(target, "foreign-synthetic-sentinel", { flag: "wx", mode: 0o600 }); return fs.link(source, target);
  } } }));
  assert.equal(report.valid, false); assert.equal(status(report, "scratch_filesystem"), "fail");
  assert.deepEqual(await fs.readdir(f.scratch), ["probe-published"]);
  assert.equal(await fs.readFile(path.join(f.scratch, "probe-published"), "utf8"), "foreign-synthetic-sentinel");
});

test("root replacement prevents all cleanup in its replacement and leaves uncertain original creations intact", async (t) => {
  const f = await fixture(t), moved = path.join(f.parent, "moved-original");
  const report = neutral(await inspectPlatform(f.options, { fs: { async link(source, target) {
    await fs.rename(f.scratch, moved); await fs.mkdir(f.scratch, { mode: 0o700 });
    await fs.writeFile(path.join(f.scratch, "unrelated"), "keep-replacement", { mode: 0o600 });
    return fs.link(source, target);
  } } }));
  assert.equal(status(report, "scratch_filesystem"), "fail");
  assert.equal(await fs.readFile(path.join(f.scratch, "unrelated"), "utf8"), "keep-replacement");
  assert.deepEqual(await fs.readdir(moved), ["probe-renamed"]);
  assert.equal((await fs.readFile(path.join(moved, "probe-renamed"))).length, 1024);
});

test("simultaneous probes for one fresh path admit only its exclusive owner", async (t) => {
  const f = await fixture(t);
  const reports = await Promise.all([inspectPlatform(f.options), inspectPlatform(f.options)]);
  reports.forEach(neutral); assert.equal(reports.filter((report) => report.valid).length, 1);
  assert.equal(reports.filter((report) => status(report, "scratch_filesystem") === "fail").length, 1); await absent(f.scratch);
});

test("optional genuine AbortSignals are supported and an already cancelled check performs no probe work", async () => {
  for (const signal of [undefined, new AbortController().signal]) {
    assert.equal(neutral(await inspectPlatform({}, { signal })).valid, true);
  }
  const controller = new AbortController(); controller.abort(privateFailure()); let work = 0;
  const report = neutral(await inspectPlatform({}, { signal: controller.signal,
    loadSharp: () => { work++; throw privateFailure(); }, fs: { lstat: () => { work++; throw privateFailure(); } },
  }));
  assert.equal(work, 0); assert.equal(report.valid, false); assert.equal(status(report, "sharp_jpeg"), "fail");
  assert.equal(status(report, "scratch_filesystem"), "not_checked");
});

test("progressive cancellation stops native or filesystem probes but still removes only known creations", async (t) => {
  const native = new AbortController(); let factoryUsed = false;
  const nativeReport = neutral(await inspectPlatform({}, { signal: native.signal, async loadSharp() {
    native.abort(privateFailure()); return () => { factoryUsed = true; throw privateFailure(); };
  } }));
  assert.equal(status(nativeReport, "sharp_jpeg"), "fail"); assert.equal(factoryUsed, false);
  for (const stage of ["parent-open", "mkdir", "write", "rename", "read", "link", "parent-close"]) {
    const f = await fixture(t), controller = new AbortController(); let cancelled = false;
    const cancel = () => { cancelled = true; controller.abort(privateFailure()); };
    const report = neutral(await inspectPlatform(f.options, { signal: controller.signal, fs: {
      async mkdir(...args) { const result = await fs.mkdir(...args); if (stage === "mkdir") cancel(); return result; },
      async rename(...args) { const result = await fs.rename(...args); if (stage === "rename") cancel(); return result; },
      async link(...args) { const result = await fs.link(...args); if (stage === "link") cancel(); return result; },
      async open(...args) {
        const handle = await fs.open(...args); if (stage === "parent-open" && args[0] === f.parent) cancel();
        return wrapped(handle, {
          async writeFile(...values) { const result = await handle.writeFile(...values); if (stage === "write") cancel(); return result; },
          async read(...values) { const result = await handle.read(...values); if (stage === "read") cancel(); return result; },
          async close() { const result = await handle.close(); if (stage === "parent-close" && args[0] === f.parent) cancel(); return result; },
        });
      },
    } }));
    assert.equal(cancelled, true, stage); assert.equal(report.valid, false, stage);
    assert.equal(status(report, "scratch_filesystem"), "fail", stage); await absent(f.scratch);
  }
});

test("malformed options and injected dependencies cannot expose arbitrary values or invoke accessors", async () => {
  let reads = 0;
  for (const options of [null, [], { unknown: "private-password" }, { scratch: 1 }, { get scratch() { reads++; throw privateFailure(); } }]) {
    assert.equal(neutral(await inspectPlatform(options)).valid, false);
  }
  for (const dependencies of [null, [], { unknown: "private-password" }, { loadSharp: 1 }, { fs: { rm: () => {} } },
    { signal: null }, { signal: {} }, { signal: { get aborted() { reads++; throw privateFailure(); } } },
    { get nodeVersion() { reads++; throw privateFailure(); } }, { fs: { get open() { reads++; throw privateFailure(); } } }]) {
    assert.equal(neutral(await inspectPlatform({}, dependencies)).valid, false);
  }
  assert.equal(reads, 0);
});
