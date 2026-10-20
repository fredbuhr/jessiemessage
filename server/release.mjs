import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const VERSION = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/;
const COMMIT = /^[a-f0-9]{40}$/;
const NODE = /^v[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/;

/** Private display fields only; absence of a verified source identity stays explicit. */
export function safeRelease(value) {
  if (!value || !(value.version === null || typeof value.version === "string" && value.version.length <= 64 && value.version.trim() === value.version && VERSION.test(value.version))
    || !(value.commit === null || typeof value.commit === "string" && value.commit.length === 40 && COMMIT.test(value.commit))
    || typeof value.nodeVersion !== "string" || value.nodeVersion.length > 64 || value.nodeVersion.trim() !== value.nodeVersion || !NODE.test(value.nodeVersion)
    || !Number.isSafeInteger(value.startedAt) || value.startedAt < 0 || value.startedAt > 253402300799999) throw new TypeError("invalid_release_identity");
  return { version: value.version, commit: value.commit, nodeVersion: value.nodeVersion, startedAt: value.startedAt };
}

/** Observe the source once at process startup, without an expected-commit environment variable. */
export function captureRelease({ root = ROOT, startedAt = Date.now(), nodeVersion = process.version } = {}) {
  let version = null, commit = null;
  try {
    const bytes = readFileSync(join(root, "package.json"));
    if (bytes.length <= 65536) {
      const candidate = JSON.parse(bytes.toString("utf8")).version;
      if (typeof candidate === "string" && candidate.length <= 64 && candidate.trim() === candidate && VERSION.test(candidate)) version = candidate;
    }
  } catch { /* An exported or damaged source tree remains identifiable as unknown. */ }
  try {
    const git = (...args) => execFileSync("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", ...args],
      { cwd: root, encoding: "utf8", timeout: 2000, maxBuffer: 4096, stdio: ["ignore", "pipe", "pipe"] }).trim();
    const candidate = git("rev-parse", "HEAD");
    if (COMMIT.test(candidate) && realpathSync(git("rev-parse", "--show-toplevel")) === realpathSync(root)
      && git("status", "--porcelain", "--untracked-files=normal") === "" && git("rev-parse", "HEAD") === candidate) commit = candidate;
  } catch { /* No Git, modified tree, timeout or unrelated parent repository: no claimed commit. */ }
  return Object.freeze(safeRelease({ version, commit, nodeVersion, startedAt }));
}

// Validators and runtime shims can import this module without spawning Git.
// The real server/service explicitly captures one immutable startup snapshot.
let processRelease;
export function getProcessRelease() { return processRelease ??= captureRelease(); }
