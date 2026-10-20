import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { captureRelease, safeRelease } from "../server/release.mjs";

const startedAt = 1750000000000;
const identity = () => ({ version: "1.0.0", commit: "a".repeat(40), nodeVersion: "v24.22.0", startedAt });

test("release observation uses the actual clean checkout and stays frozen after later file or branch changes", async () => {
  const root = await mkdtemp(join(process.cwd(), ".jessie-release-"));
  const git = (...args) => execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "user.name=Synthetic test", "-c", "user.email=synthetic@example.invalid", ...args],
    { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  try {
    await writeFile(join(root, "package.json"), JSON.stringify({ version: "1.0.0" }));
    git("init", "--quiet"); git("add", "package.json"); git("commit", "--quiet", "-m", "Synthetic release");
    const expected = git("rev-parse", "HEAD"), snapshot = captureRelease({ root, startedAt, nodeVersion: "v24.22.0" });
    assert.deepEqual(snapshot, { ...identity(), commit: expected }); assert.ok(Object.isFrozen(snapshot));
    await writeFile(join(root, "package.json"), JSON.stringify({ version: "1.1.0" }));
    const dirty = captureRelease({ root, startedAt, nodeVersion: "v24.22.0" });
    assert.equal(dirty.version, "1.1.0"); assert.equal(dirty.commit, null);
    assert.equal(snapshot.version, "1.0.0"); assert.equal(snapshot.commit, expected);
    git("add", "package.json"); git("commit", "--quiet", "-m", "Synthetic next release");
    assert.notEqual(captureRelease({ root }).commit, expected); assert.equal(snapshot.commit, expected);
    await writeFile(join(root, "untracked-source.mjs"), "export const value = 1;");
    assert.equal(captureRelease({ root }).commit, null, "untracked code cannot receive a clean-commit identity");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("exported sources and malformed package versions report unknown metadata instead of an expected release", async () => {
  const root = await mkdtemp(join(process.cwd(), ".jessie-release-export-"));
  try {
    await writeFile(join(root, "package.json"), '{"version":"1.0.0"}');
    assert.deepEqual(captureRelease({ root, startedAt, nodeVersion: "v24.22.0" }), { ...identity(), commit: null });
    for (const value of ["1.0.0\n", "01.0.0", "<script>", "1.0", 1, null]) {
      await writeFile(join(root, "package.json"), JSON.stringify({ version: value }));
      assert.equal(captureRelease({ root }).version, null);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("release DTO keeps four bounded identity fields and rejects arbitrary versions, commits, runtimes or dates", () => {
  assert.deepEqual(safeRelease({ ...identity(), privatePath: "/private/source", secret: "private" }), identity());
  for (const [field, values] of Object.entries({ version: ["01.0.0", "1.0.0\n", "x".repeat(65), 1],
    commit: ["main", "a".repeat(40) + "\n", "A".repeat(40), "a".repeat(39)],
    nodeVersion: ["node", "v24.22.0\n", null], startedAt: [null, -1, Infinity, 1.1, "1750000000000"] })) {
    for (const value of values) assert.throws(() => safeRelease({ ...identity(), [field]: value }), /invalid_release_identity/);
  }
  assert.deepEqual(safeRelease({ ...identity(), version: null, commit: null }), { ...identity(), version: null, commit: null });
});

test("importing validators and runtime shims does not inspect Git; the startup snapshot is captured once", () => {
  const source = `import childProcess from 'node:child_process';
    import { syncBuiltinESMExports } from 'node:module';
    let calls = 0;
    childProcess.execFileSync = () => { calls++; throw new Error('Synthetic Git unavailable'); };
    syncBuiltinESMExports();
    await import(${JSON.stringify(new URL("../server/readiness/http.mjs", import.meta.url).href)});
    await import(${JSON.stringify(new URL("../server/index.mjs", import.meta.url).href)});
    const { getProcessRelease } = await import(${JSON.stringify(new URL("../server/release.mjs", import.meta.url).href)});
    const atImport = calls, first = getProcessRelease(), afterFirst = calls, second = getProcessRelease();
    console.log(JSON.stringify({atImport,afterFirst,afterSecond:calls,same:first===second,frozen:Object.isFrozen(first),commit:first.commit}));`;
  const output = execFileSync(process.execPath, ["--input-type=module", "-e", source],
    { encoding: "utf8", timeout: 8000, maxBuffer: 16384, stdio: ["ignore", "pipe", "pipe"] });
  assert.deepEqual(JSON.parse(output), { atImport: 0, afterFirst: 1, afterSecond: 1, same: true, frozen: true, commit: null });
});

test("the listening application emits the same private startup snapshot used by its readiness service", { timeout: 10000 }, async () => {
  const reservation = createServer();
  await new Promise(resolve => reservation.listen(0, "127.0.0.1", resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const source = `import { start } from ${JSON.stringify(new URL("../server/index.mjs", import.meta.url).href)};
    import { getProcessRelease } from ${JSON.stringify(new URL("../server/release.mjs", import.meta.url).href)};
    const runtime = await start({PORT:${JSON.stringify(String(port))}});
    console.log(JSON.stringify({type:'synthetic_expected_snapshot',release:getProcessRelease()}));
    await runtime.drain();`;
  const output = execFileSync(process.execPath, ["--input-type=module", "-e", source],
    { encoding: "utf8", timeout: 8000, maxBuffer: 16384, stdio: ["ignore", "pipe", "pipe"] });
  const records = output.split("\n").filter(line => line.startsWith("{")).map(line => JSON.parse(line));
  const started = records.filter(value => value.type === "application_started");
  assert.equal(started.length, 1); assert.equal(started[0].version, 1);
  assert.deepEqual(started[0].release, records.find(value => value.type === "synthetic_expected_snapshot").release);
  assert.equal(started[0].release.nodeVersion, process.version);
  assert.deepEqual(Object.keys(started[0].release).sort(), ["commit", "nodeVersion", "startedAt", "version"]);
  assert.doesNotMatch(JSON.stringify(started[0]), /password|\/srv\/|csrf/);
});
