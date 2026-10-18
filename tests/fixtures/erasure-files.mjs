import { constants } from "node:fs";
import { chmod, lstat, mkdir, mkdtemp, open, rm } from "node:fs/promises";
import path from "node:path";

// Real private files and fsync in scratch; native procfs anchoring is exercised
// separately and mandatorily in Linux CI. This seam is never runtime configuration.
export async function withErasureDirectory(directory, work) {
  const before = await lstat(directory, { bigint: true });
  const scope = { path: directory, file: name => path.join(directory, name),
    async assertReady() {
      const after = await lstat(directory, { bigint: true });
      if (after.ino !== before.ino || after.dev !== before.dev || (after.mode & 0o7777n) !== 0o700n) throw new Error("Synthetic directory changed");
    },
    async sync() { const fd = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY); try { await fd.sync(); } finally { await fd.close(); } },
  };
  const result = await work(scope); await scope.assertReady(); return result;
}
export async function erasureDirectory(t) {
  const base = path.resolve("../audit"); await mkdir(base, { recursive: true, mode: 0o700 });
  const directory = await mkdtemp(path.join(base, "erasure-")); await chmod(directory, 0o700);
  t.after(() => rm(directory, { recursive: true, force: true })); return directory;
}
