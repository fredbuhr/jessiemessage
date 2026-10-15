import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { constants } from "node:fs";
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, statfs, symlink, writeFile } from "node:fs/promises";
import { inspectDirectoryIdentities, openPrivateDirectory, privatePathMode, withPrivateDirectory } from "../server/files/private-directory.mjs";

const KEY = "JESSIEMESSAGE_PRIVATE_PATH_MODE";
const hidden = (error) => error?.code === "PRIVATE_PATH_UNAVAILABLE"
  && error.message === "Private filesystem path is unavailable." && error.cause === undefined;
const reject = (promise) => assert.rejects(promise, hidden);

function model() {
  let nextFd = 20, nextInode = 1n;
  const entries = new Map(), opened = [], handles = new Map();
  const add = (name, mode, uid = 33, gid = 33) => {
    const entry = { dev: 42n, ino: nextInode++, mode: 0o40000n | BigInt(mode), uid: BigInt(uid), gid: BigInt(gid), nlink: 2n };
    entries.set(name, entry); return entry;
  };
  add("/", 0o755, 0, 0); add("/srv", 0o2775, 0); add("/srv/customer", 0o2755); add("/srv/customer/private", 0o700);
  const state = { entries, opened, handles, closed: [], synced: [], procType: 0x9fa0n, closeFailure: false };
  const fs = {
    async statfs(name, options) {
      assert.equal(name, "/proc/self/fd"); assert.equal(options.bigint, true);
      if (state.procFailure) throw new Error("native path /private-secret/failure");
      return { type: state.procType };
    },
    async open(name, flags) {
      assert.ok(flags & constants.O_DIRECTORY); assert.ok(flags & constants.O_NOFOLLOW); assert.ok(flags & constants.O_NONBLOCK);
      let target = "/";
      if (name !== "/") {
        const match = /^\/proc\/self\/fd\/(\d+)\/([^/]+)$/.exec(name);
        assert.ok(match, "each next component is opened through its parent descriptor");
        const parent = handles.get(Number(match[1])); assert.ok(parent && !parent.closed);
        target = path.posix.join(parent.target, match[2]);
      }
      const entry = entries.get(target);
      if (!entry || entry.symlink) throw new Error(`native path ${target}`);
      const fd = nextFd++, record = { fd, target, closed: false };
      opened.push(record); handles.set(fd, record);
      return {
        fd,
        async stat(options) {
          assert.equal(options.bigint, true); if (record.closed) throw new Error("closed native path");
          return { ...entry, isDirectory() { return (this.mode & 0o170000n) === 0o40000n; }, isSymbolicLink() { return false; } };
        },
        async sync() { if (record.closed) throw new Error("closed"); state.synced.push(fd); state.onSync?.(entry); },
        async close() { assert.equal(record.closed, false); record.closed = true; state.closed.push(fd); if (state.closeFailure) throw new Error("native close /private-secret"); },
      };
    },
  };
  return { state, options: { fs, platform: "linux", uid: 33, gid: 33 } };
}

test("private filesystem mode is strict unless the single explicit Linux opt-in is selected", () => {
  assert.equal(privatePathMode({}), "strict"); assert.equal(privatePathMode({ [KEY]: "strict" }), "strict");
  assert.equal(privatePathMode({ [KEY]: "linux-dirfd" }), "linux-dirfd");
  for (const value of ["", "STRICT", "linux-dirfd ", "relative", true, 1, null]) assert.throws(() => privatePathMode({ [KEY]: value }), hidden);
});

test("descriptor traversal validates every component and awaits the complete callback", async () => {
  const { state, options } = model(); let enter, finish;
  const entered = new Promise((resolve) => { enter = resolve; }); const gate = new Promise((resolve) => { finish = resolve; });
  const pending = withPrivateDirectory("/srv/customer/private", async (scope) => {
    assert.match(scope.path, /^\/proc\/self\/fd\/\d+$/); assert.equal(scope.file("clé.enc"), `${scope.path}/clé.enc`);
    const stats = await scope.assertReady(); assert.equal(stats.uid, 33n); assert.equal(stats.mode & 0o7777n, 0o700n);
    assert.equal(stats.isDirectory(), true); assert.equal(stats.isSymbolicLink(), false); assert.ok(Object.isFrozen(stats));
    enter(); await gate; assert.equal(state.closed.length, 0); await scope.sync(); return "complete";
  }, options);
  await entered; assert.equal(state.opened.length, 4); assert.equal(state.closed.length, 0); finish();
  assert.equal(await pending, "complete"); assert.equal(state.closed.length, 4); assert.equal(state.synced.length, 1);
  assert.deepEqual(state.closed, state.opened.map(({ fd }) => fd).reverse());
});

test("scope paths, basename generation, assertions and synchronization refuse use after close", async () => {
  const { options } = model(); let previous;
  await withPrivateDirectory("/srv/customer/private", async (scope) => { previous = scope; }, options);
  assert.throws(() => previous.path, hidden); assert.throws(() => previous.file("later"), hidden);
  await reject(previous.assertReady()); await reject(previous.sync());
});

test("a long-lived directory anchor closes once and invalidates its scope before cleanup completes", async () => {
  const { state, options } = model(); const scope = await openPrivateDirectory("/srv/customer/private", options);
  const closing = scope.close(); assert.throws(() => scope.path, hidden); assert.throws(() => scope.file("late"), hidden);
  await Promise.all([closing, scope.close(), scope.close()]);
  assert.equal(state.closed.length, 4); await reject(scope.assertReady()); await reject(scope.sync()); await scope.close();
  assert.equal(state.closed.length, 4);
});

test("directory identity inspection permits a protected 755 root while exposing no I/O capability", async () => {
  const { state, options } = model();
  const result = await inspectDirectoryIdentities("/srv/customer", options);
  assert.deepEqual(result, ["/", "/srv", "/srv/customer"].map((name) => {
    const { dev, ino } = state.entries.get(name); return { dev, ino };
  }));
  assert.ok(Object.isFrozen(result)); for (const item of result) { assert.ok(Object.isFrozen(item)); assert.deepEqual(Object.keys(item), ["dev", "ino"]); }
  assert.equal(state.closed.length, state.opened.length);
  await reject(openPrivateDirectory("/srv/customer", options));
  state.entries.get("/srv/customer").mode = 0o40775n;
  await reject(inspectDirectoryIdentities("/srv/customer", options));
});

test("scope only produces a single safe basename", async () => {
  const { options } = model();
  await withPrivateDirectory("/srv/customer/private", async (scope) => {
    for (const name of ["", ".", "..", "../file", "/file", "a/b", "a\\b", "a\0b", "a\nb", null, 42]) assert.throws(() => scope.file(name), hidden);
    for (const name of [".temporary", "a..b", "image.full.enc", "é space"]) assert.ok(scope.file(name).endsWith(`/${name}`));
  }, options);
});

test("only clean absolute roots on supported Linux procfs are accepted", async () => {
  for (const root of [undefined, "relative", "/", "//srv/customer/private", "/srv/./customer/private", "/srv/customer/../private", "/srv/customer/private/", "/srv/customer//private", "/srv/\\private", "/srv/private\0"]) {
    const { state, options } = model(); await reject(withPrivateDirectory(root, () => {}, options)); assert.equal(state.opened.length, 0);
  }
  for (const change of [{ platform: "darwin" }, { uid: undefined, platform: "win32" }, { gid: -1 }]) {
    const { options } = model(); await reject(withPrivateDirectory("/srv/customer/private", () => {}, { ...options, ...change }));
  }
  for (const value of [0xef53n, 0, null]) {
    const { state, options } = model(); state.procType = value; await reject(withPrivateDirectory("/srv/customer/private", () => {}, options)); assert.equal(state.opened.length, 0);
  }
  const { state, options } = model(); state.procFailure = true; await reject(withPrivateDirectory("/srv/customer/private", () => {}, options));
});

test("root-owned primary-group ancestors and root-owned sticky ancestors are narrowly allowed", async () => {
  const { state, options } = model(); state.entries.get("/srv").mode = 0o41777n; state.entries.get("/srv").gid = 999n;
  await withPrivateDirectory("/srv/customer/private", async (scope) => { await scope.assertReady(); }, options);
  for (const edit of [
    { uid: 33n, mode: 0o40775n }, { uid: 999n, mode: 0o40755n },
    { uid: 0n, gid: 999n, mode: 0o42775n }, { uid: 0n, mode: 0o40777n },
    { uid: 33n, mode: 0o41777n },
  ]) {
    const fixture = model(); Object.assign(fixture.state.entries.get("/srv"), edit);
    await reject(withPrivateDirectory("/srv/customer/private", () => {}, fixture.options));
    assert.equal(fixture.state.closed.length, fixture.state.opened.length);
  }
});

test("symlinks, foreign roots, inherited setgid and all non-exact private modes are refused", async () => {
  for (const target of ["/srv", "/srv/customer", "/srv/customer/private"]) {
    const { state, options } = model(); state.entries.get(target).symlink = true;
    await reject(withPrivateDirectory("/srv/customer/private", () => {}, options)); assert.equal(state.closed.length, state.opened.length);
  }
  for (const edit of [{ uid: 0n }, { uid: 999n }, ...[0o755, 0o750, 0o770, 0o2700, 0o1700].map((mode) => ({ mode: 0o40000n | BigInt(mode) }))]) {
    const { state, options } = model(); Object.assign(state.entries.get("/srv/customer/private"), edit);
    await reject(withPrivateDirectory("/srv/customer/private", () => {}, options)); assert.equal(state.closed.length, state.opened.length);
  }
});

test("every pinned descriptor is rechecked for identity, owner, group and mode drift", async () => {
  for (const field of ["dev", "ino", "uid", "gid", "mode"]) {
    const { state, options } = model();
    await reject(withPrivateDirectory("/srv/customer/private", async (scope) => {
      state.entries.get("/srv")[field] += 1n; await scope.assertReady();
    }, options));
    assert.equal(state.closed.length, state.opened.length);
  }
  const { state, options } = model(); state.onSync = (entry) => { entry.mode = 0o40755n; };
  await reject(withPrivateDirectory("/srv/customer/private", (scope) => scope.sync(), options));
  const links = model();
  await reject(withPrivateDirectory("/srv/customer/private", async (scope) => {
    links.state.entries.get("/srv/customer/private").nlink = 0n; await scope.assertReady();
  }, links.options));
  const children = model();
  await withPrivateDirectory("/srv/customer/private", async (scope) => {
    children.state.entries.get("/srv/customer/private").nlink += 1n; await scope.assertReady();
  }, children.options);
});

test("callback failures survive cleanup while native helper and close failures stay generic", async () => {
  const { state, options } = model(); const sentinel = new Error("consumer boundary"); state.closeFailure = true;
  await assert.rejects(withPrivateDirectory("/srv/customer/private", () => { throw sentinel; }, options), (error) => error === sentinel);
  assert.equal(state.closed.length, 4);
  const another = model(); another.state.closeFailure = true;
  await reject(withPrivateDirectory("/srv/customer/private", () => "ok", another.options)); assert.equal(another.state.closed.length, 4);
  const drift = model();
  await reject(withPrivateDirectory("/srv/customer/private", () => { drift.state.entries.get("/srv/customer/private").ino += 1n; }, drift.options));
});

let realUnavailable;
if (process.platform !== "linux") realUnavailable = "real descriptor tests require Linux";
else {
  try { if ((await statfs("/proc/self/fd", { bigint: true })).type !== 0x9fa0n) realUnavailable = "real descriptor tests require procfs at /proc/self/fd"; }
  catch { realUnavailable = "real descriptor tests unavailable: /proc/self/fd is absent or inaccessible in this sandbox"; }
}

test("Linux CI must run the descriptor filesystem scenarios with real procfs", { skip: !process.env.CI || process.platform !== "linux" }, () => {
  assert.equal(realUnavailable, undefined, realUnavailable);
});

async function fixture(t) {
  const base = await mkdtemp(path.join(process.cwd(), "private-directory-test-"));
  await chmod(base, 0o700); t.after(() => rm(base, { recursive: true, force: true }));
  const parent = path.join(base, "parent"), root = path.join(parent, "private");
  await mkdir(parent, { mode: 0o700 }); await mkdir(root, { mode: 0o700 }); await chmod(root, 0o700);
  return { base, parent, root };
}

test("real descriptors keep writes, reads and cleanup in the original tree after an ancestor is replaced", { skip: realUnavailable }, async (t) => {
  const { base, parent, root } = await fixture(t); const original = path.join(base, "original-parent"); let retained;
  await withPrivateDirectory(root, async (scope) => {
    retained = scope.path; await writeFile(scope.file("before"), "original", { mode: 0o600, flag: "wx" });
    await rename(parent, original); await mkdir(parent, { mode: 0o700 }); await mkdir(root, { mode: 0o700 });
    await writeFile(path.join(root, "before"), "replacement", { mode: 0o600 });
    await scope.assertReady(); await writeFile(scope.file("after"), "still-original", { mode: 0o600, flag: "wx" }); await scope.sync();
    assert.equal(await readFile(scope.file("before"), "utf8"), "original");
  });
  assert.equal(await readFile(path.join(original, "private/after"), "utf8"), "still-original");
  assert.deepEqual(await readdir(root), ["before"]); assert.equal(await readFile(path.join(root, "before"), "utf8"), "replacement");
  await assert.rejects(lstat(retained), { code: "ENOENT" });
});

test("real descriptors reject symlink traversal and exact private permission drift", { skip: realUnavailable }, async (t) => {
  const { base, parent, root } = await fixture(t); const alias = path.join(base, "alias"); await symlink(parent, alias);
  await reject(withPrivateDirectory(path.join(alias, "private"), () => {}));
  await chmod(root, 0o2700); await reject(withPrivateDirectory(root, () => {})); await chmod(root, 0o700);
  await reject(withPrivateDirectory(root, async (scope) => { await chmod(root, 0o750); await scope.assertReady(); }));
});
