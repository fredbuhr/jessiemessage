import { readdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { extname, join, relative } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const files = [];
async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error("Source syntax checks do not follow symbolic links.");
    if (entry.isDirectory()) await collect(filename);
    else if (entry.isFile() && [".mjs", ".js", ".sh"].includes(extname(entry.name))) files.push(filename);
  }
}
for (const directory of ["server", "public", "scripts", "design", "tests"]) await collect(join(root, directory));
for (const filename of files.sort()) {
  const shell = extname(filename) === ".sh";
  try {
    execFileSync(shell ? "bash" : process.execPath, [shell ? "-n" : "--check", filename], { cwd: root, stdio: "pipe", timeout: 10000 });
  } catch (error) {
    console.error(`Syntax check failed: ${relative(root, filename)}`);
    if (error.stderr) process.stderr.write(error.stderr);
    process.exitCode = 1;
    break;
  }
}
if (!process.exitCode) console.log(`Syntax verified: ${files.length} JavaScript and shell source files.`);
