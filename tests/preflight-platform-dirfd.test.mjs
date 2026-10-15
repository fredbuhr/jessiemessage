import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { constants } from "node:fs";
import * as fs from "node:fs/promises";
import { inspectPlatform, PLATFORM_CHECK_NAMES } from "../server/preflight/platform.mjs";

const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../audit");
const status = (report) => report.checks.find((check) => check.name === "scratch_filesystem").status;
let procfs = false;
try { procfs = process.platform === "linux" && (await fs.statfs("/proc/self/fd", { bigint: true })).type === 0x9fa0n; } catch {}
const linux = { skip: procfs ? false : "Real Linux procfs /proc/self/fd is unavailable in this execution environment." };
const methods = ["lstat", "realpath", "mkdir", "open", "rename", "link", "unlink", "rmdir"];

function neutral(report) {
  assert.deepEqual(Object.keys(report).sort(), ["checks", "valid"]);
  assert.deepEqual(report.checks.map((check) => check.name), [...PLATFORM_CHECK_NAMES]);
  for (const check of report.checks) assert.deepEqual(Object.keys(check).sort(), ["name", "status"]);
  assert.doesNotMatch(JSON.stringify(report), /\/proc|\/workspace|private-password|sentinel|probe-/);
  return report;
}
function wrapped(handle, overrides) {
  return new Proxy(handle, { get(target, key) {
    if (Object.hasOwn(overrides, key)) return overrides[key];
    const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
  } });
}
// Recursive teardown is restricted to a synthetic directory owned by this test.
// The platform probe itself never lists or recursively removes directories.
async function removeFixture(target) {
  const stats = await fs.lstat(target);
  if (stats.isDirectory() && !stats.isSymbolicLink()) {
    for (const name of await fs.readdir(target)) await removeFixture(path.join(target, name));
    await fs.rmdir(target);
  } else await fs.unlink(target);
}
async function fixture(t) {
  await fs.mkdir(base, { recursive: true, mode: 0o700 });
  const root = await fs.mkdtemp(path.join(base, "platform-dirfd-"));
  const parent = path.join(root, "private"), mediaRoot = path.join(root, "media");
  await fs.mkdir(parent, { mode: 0o700 }); await fs.mkdir(mediaRoot, { mode: 0o700 });
  const scratch = path.join(parent, "new-probe");
  t.after(() => removeFixture(root));
  return { root, parent, scratch, mediaRoot, options: { scratch, mediaRoot, pathMode: "linux-dirfd" } };
}
async function absent(target) { await assert.rejects(fs.lstat(target), { code: "ENOENT" }); }

test("unknown private path modes fail before native codec or injected filesystem work", async () => {
  let work = 0;
  const dependencies = { loadSharp: () => { work++; throw Error(); }, fs: { mkdir: () => { work++; throw Error(); } } };
  for (const pathMode of [null, true, 1, {}, "", "STRICT", "linux-dirfd-private-password", "linux-dirfd\n"]) {
    const report = neutral(await inspectPlatform({ pathMode }, dependencies));
    assert.equal(report.valid, false); assert.equal(status(report), "fail");
    assert.equal(report.checks[0].status, "not_checked");
  }
  const previous = process.env.JESSIEMESSAGE_PRIVATE_PATH_MODE;
  try {
    process.env.JESSIEMESSAGE_PRIVATE_PATH_MODE = "unknown-private-password";
    assert.equal(status(neutral(await inspectPlatform({}, dependencies))), "fail");
  } finally {
    if (previous === undefined) delete process.env.JESSIEMESSAGE_PRIVATE_PATH_MODE;
    else process.env.JESSIEMESSAGE_PRIVATE_PATH_MODE = previous;
  }
  assert.equal(work, 0);
});

test("explicit Linux dirfd selection fails closed when real procfs is absent", { skip: procfs }, async (t) => {
  const f = await fixture(t); let filesystemWork = 0;
  const report = neutral(await inspectPlatform(f.options, { fs: Object.fromEntries(methods.map((name) => [name, () => { filesystemWork++; throw Error(); }])) }));
  assert.equal(status(report), "fail"); assert.equal(filesystemWork, 0); await absent(f.scratch);
});

test("the real dirfd probe uses only FD-relative paths and preserves strict defaults and media contents", linux, async (t) => {
  const f = await fixture(t), calls = [];
  await fs.writeFile(path.join(f.mediaRoot, "sentinel"), "existing-media", { mode: 0o600 });
  const strict = neutral(await inspectPlatform({ scratch: f.scratch, mediaRoot: f.mediaRoot, pathMode: "strict" }));
  assert.equal(status(strict), "pass"); await absent(f.scratch);
  const filesystem = Object.fromEntries(methods.map((name) => [name, async (...args) => {
    calls.push([name, ...args]); return fs[name](...args);
  }]));
  const report = neutral(await inspectPlatform(f.options, { fs: filesystem }));
  assert.equal(report.valid, true); assert.equal(status(report), "pass"); await absent(f.scratch);
  assert.equal(await fs.readFile(path.join(f.mediaRoot, "sentinel"), "utf8"), "existing-media");
  assert.deepEqual(await fs.readdir(f.parent), []);
  assert.equal(calls.some(([name]) => name === "realpath"), false);
  for (const [name, ...args] of calls) {
    for (const candidate of args.slice(0, name === "rename" || name === "link" ? 2 : 1)) {
      assert.match(candidate, /^\/proc\/self\/fd\/[0-9]+\/(?:\.|new-probe(?:\/probe-(?:staging|renamed|published))?)$/);
    }
  }
  for (const name of ["mkdir", "rename", "link", "unlink", "rmdir"]) assert.ok(calls.some(([method]) => method === name), name);
});

test("the explicit environment mode is supported without changing the returned DTO", linux, async (t) => {
  const f = await fixture(t), previous = process.env.JESSIEMESSAGE_PRIVATE_PATH_MODE;
  try {
    process.env.JESSIEMESSAGE_PRIVATE_PATH_MODE = "linux-dirfd";
    const report = neutral(await inspectPlatform({ scratch: f.scratch, mediaRoot: f.mediaRoot }));
    assert.equal(status(report), "pass"); await absent(f.scratch);
  } finally {
    if (previous === undefined) delete process.env.JESSIEMESSAGE_PRIVATE_PATH_MODE;
    else process.env.JESSIEMESSAGE_PRIVATE_PATH_MODE = previous;
  }
});

test("dirfd mode refuses nonprivate or symbolic parents and every preexisting probe leaf", linux, async (t) => {
  const f = await fixture(t), alias = path.join(f.root, "alias");
  await fs.chmod(f.parent, 0o755);
  assert.equal(status(neutral(await inspectPlatform(f.options))), "fail"); await absent(f.scratch);
  await fs.chmod(f.parent, 0o700); await fs.symlink(f.parent, alias);
  assert.equal(status(neutral(await inspectPlatform({ ...f.options, scratch: path.join(alias, "new-probe") }))), "fail"); await absent(f.scratch);
  const sentinel = path.join(f.mediaRoot, "sentinel"); await fs.writeFile(sentinel, "foreign-content", { mode: 0o600 });
  for (const type of ["file", "directory", "symlink"]) {
    if (type === "file") await fs.writeFile(f.scratch, "foreign-content", { mode: 0o600 });
    if (type === "directory") await fs.mkdir(f.scratch, { mode: 0o700 });
    if (type === "symlink") await fs.symlink(sentinel, f.scratch);
    assert.equal(status(neutral(await inspectPlatform(f.options))), "fail");
    if (type === "directory") { assert.deepEqual(await fs.readdir(f.scratch), []); await fs.rmdir(f.scratch); }
    else {
      assert.equal(await fs.readFile(f.scratch, "utf8"), "foreign-content");
      if (type === "symlink") assert.equal((await fs.lstat(f.scratch)).isSymbolicLink(), true);
      await fs.unlink(f.scratch);
    }
  }
  assert.equal(await fs.readFile(sentinel, "utf8"), "foreign-content");
});

test("replacing the original parent pathname cannot redirect anchored probe operations", linux, async (t) => {
  const f = await fixture(t), moved = path.join(f.root, "retained-original"); let replaced = false;
  const report = neutral(await inspectPlatform(f.options, { fs: { async open(...args) {
    const handle = await fs.open(...args);
    if (!replaced && /\/\.$/.test(args[0])) {
      replaced = true; await fs.rename(f.parent, moved); await fs.mkdir(f.parent, { mode: 0o700 });
      await fs.writeFile(path.join(f.parent, "sentinel"), "replacement-parent", { mode: 0o600 });
    }
    return handle;
  } } }));
  assert.equal(replaced, true); assert.equal(status(report), "pass");
  assert.deepEqual(await fs.readdir(moved), []);
  assert.deepEqual(await fs.readdir(f.parent), ["sentinel"]);
  assert.equal(await fs.readFile(path.join(f.parent, "sentinel"), "utf8"), "replacement-parent");
});

test("anchored root replacement still refuses cleanup in its replacement", linux, async (t) => {
  const f = await fixture(t), moved = path.join(f.parent, "retained-probe");
  const report = neutral(await inspectPlatform(f.options, { fs: { async link(source, target) {
    await fs.rename(f.scratch, moved); await fs.mkdir(f.scratch, { mode: 0o700 });
    await fs.writeFile(path.join(f.scratch, "sentinel"), "replacement-root", { mode: 0o600 });
    return fs.link(source, target);
  } } }));
  assert.equal(status(report), "fail");
  assert.equal(await fs.readFile(path.join(f.scratch, "sentinel"), "utf8"), "replacement-root");
  assert.deepEqual(await fs.readdir(moved), ["probe-renamed"]);
});

test("anchored publication conflicts preserve foreign files with nonrecursive cleanup", linux, async (t) => {
  const f = await fixture(t);
  const report = neutral(await inspectPlatform(f.options, { fs: { async link(source, target) {
    await fs.writeFile(target, "foreign-publication", { flag: "wx", mode: 0o600 }); return fs.link(source, target);
  } } }));
  assert.equal(status(report), "fail"); assert.deepEqual(await fs.readdir(f.scratch), ["probe-published"]);
  assert.equal(await fs.readFile(path.join(f.scratch, "probe-published"), "utf8"), "foreign-publication");
});

test("dirfd cancellation stops operations while identity-checked cleanup remains active", linux, async (t) => {
  for (const stage of ["parent-open", "mkdir", "rename", "read", "link", "parent-close"]) {
    const f = await fixture(t), controller = new AbortController(); let cancelled = false;
    const cancel = () => { cancelled = true; controller.abort(Error("private-password")); };
    const report = neutral(await inspectPlatform(f.options, { signal: controller.signal, fs: {
      async mkdir(...args) { const result = await fs.mkdir(...args); if (stage === "mkdir") cancel(); return result; },
      async rename(...args) { const result = await fs.rename(...args); if (stage === "rename") cancel(); return result; },
      async link(...args) { const result = await fs.link(...args); if (stage === "link") cancel(); return result; },
      async open(...args) {
        const handle = await fs.open(...args), parent = /\/\.$/.test(args[0]);
        if (stage === "parent-open" && parent) cancel();
        return wrapped(handle, {
          async read(...values) { const result = await handle.read(...values); if (stage === "read") cancel(); return result; },
          async close() { const result = await handle.close(); if (stage === "parent-close" && parent) cancel(); return result; },
        });
      },
    } }));
    assert.equal(cancelled, true, stage); assert.equal(status(report), "fail", stage); await absent(f.scratch);
  }
});

test("anchored directory sync and close failures cannot produce successful evidence", linux, async (t) => {
  for (const stage of ["parent-sync", "file-sync", "parent-close"]) {
    const f = await fixture(t); let injected = false;
    const report = neutral(await inspectPlatform(f.options, { fs: { async open(...args) {
      const handle = await fs.open(...args), parent = /\/\.$/.test(args[0]), creation = args[2] === 0o600;
      return wrapped(handle, {
        async sync() {
          if (!injected && (stage === "parent-sync" && parent || stage === "file-sync" && creation)) { injected = true; throw Error(); }
          return handle.sync();
        },
        async close() { await handle.close(); if (!injected && stage === "parent-close" && parent) { injected = true; throw Error(); } },
      });
    } } }));
    assert.equal(injected, true, stage); assert.equal(status(report), "fail", stage); await absent(f.scratch);
  }
});

test("competing dirfd probes cannot reuse another probe's existing leaf", linux, async (t) => {
  const f = await fixture(t); let ready, release;
  const created = new Promise((resolve) => { ready = resolve; }), gate = new Promise((resolve) => { release = resolve; });
  const owner = inspectPlatform(f.options, { fs: { async mkdir(...args) { await fs.mkdir(...args); ready(); await gate; } } });
  let contender, result;
  try {
    await Promise.race([created, owner.then(() => assert.fail("owner completed before its held creation"))]);
    contender = neutral(await inspectPlatform(f.options));
    assert.equal(status(contender), "fail");
  } finally { release(); result = neutral(await owner); }
  assert.equal(status(result), "pass"); await absent(f.scratch);
});
