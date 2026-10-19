import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { copyFile, mkdir, symlink, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertRuntimeSource } from "../server/backup/recurring-supervisor.mjs";
import { erasureDirectory } from "./fixtures/erasure-files.mjs";

test("reviewed Git source accepts linked dependencies while rejecting unexpected links and tracked changes", { skip: process.platform !== "linux" }, async t => {
  const root = await erasureDirectory(t), directory = path.join(root, "runtime"), dependencies = path.join(root, "dependencies");
  await mkdir(directory); await mkdir(dependencies);
  const environment = { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_AUTHOR_NAME: "Synthetic source test", GIT_AUTHOR_EMAIL: "synthetic@example.invalid",
    GIT_COMMITTER_NAME: "Synthetic source test", GIT_COMMITTER_EMAIL: "synthetic@example.invalid" };
  const execute = promisify(execFile);
  const git = async (...args) => (await execute("/usr/bin/git", ["-C", directory, ...args],
    { env: environment, encoding: "utf8", timeout: 10000, maxBuffer: 8192 })).stdout.trim();
  await git("init", "--quiet");
  await copyFile(new URL("../.gitignore", import.meta.url), path.join(directory, ".gitignore"));
  const source = path.join(directory, "runtime.mjs");
  await writeFile(source, "export const synthetic = true;\n");
  await git("add", ".gitignore", "runtime.mjs");
  await git("-c", "core.hooksPath=/dev/null", "-c", "commit.gpgSign=false", "commit", "--quiet", "-m", "Synthetic reviewed source");
  const options = { runtimeDirectory: directory, runtimeHead: await git("rev-parse", "HEAD"), runtimeTree: await git("rev-parse", "HEAD^{tree}") };

  await writeFile(path.join(dependencies, "synthetic.mjs"), "export default null;\n");
  await symlink(dependencies, path.join(directory, "node_modules"), "dir");
  assert.equal(await git("status", "--porcelain", "--untracked-files=normal"), "");
  await assertRuntimeSource(options);

  const unexpected = path.join(directory, "unexpected-link");
  await symlink(dependencies, unexpected, "dir");
  await assert.rejects(assertRuntimeSource(options), { code: "RECURRING_SUPERVISOR_SOURCE" });
  await unlink(unexpected);
  await writeFile(source, "export const synthetic = false;\n");
  await assert.rejects(assertRuntimeSource(options), { code: "RECURRING_SUPERVISOR_SOURCE" });
});
