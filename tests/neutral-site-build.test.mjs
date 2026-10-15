import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const checkout = fileURLToPath(new URL("../", import.meta.url)).replace(/\/$/, "");
// Independent expected publishing surface. Adding a new source requires review;
// never derive this expectation by enumerating the implementation's whitelist.
const sourceNames = [
  "index.html", "styles.css", "app.js", "entry.html", "entry.js", "entry-model.js", "entry.css", "i18n.js", "i18n.css",
  "manifest.webmanifest", "favicon.ico", "apple-touch-icon.png", "brand/brand.css", "brand/icon-16.png", "brand/icon-32.png",
  "brand/icon-48.png", "brand/icon-64.png", "brand/icon-128.png", "brand/icon-192.png", "brand/icon-512.png", "brand/icon-maskable-512.png",
];
const outputNames = [...sourceNames, ".htaccess", "_neutral/entry.json", "_neutral/health.json", "_neutral/unavailable.json"].sort();
const script = join(checkout, "scripts/build-neutral-site.mjs");
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const missing = async (path) => (await lstat(path).catch((error) => { if (error.code === "ENOENT") return null; throw error; })) === null;

async function sandbox(t) {
  const root = await mkdtemp(join(dirname(checkout), "neutral-site-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const project = join(root, "checkout");
  await mkdir(join(project, "scripts"), { recursive: true });
  await copyFile(script, join(project, "scripts/build-neutral-site.mjs"));
  for (const name of sourceNames) {
    const target = join(project, "public", name);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(join(checkout, "public", name), target);
  }
  const module = await import(pathToFileURL(join(project, "scripts/build-neutral-site.mjs")).href);
  return { root, project, build: module.buildNeutralSite };
}
async function fileNames(root, prefix = "") {
  const result = [];
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) result.push(...await fileNames(root, name));
    else { assert.equal(entry.isFile(), true, "only ordinary output files"); result.push(name); }
  }
  return result.sort();
}
async function rejected(operation) {
  await assert.rejects(operation, (error) => {
    assert.equal(error.code, "NEUTRAL_SITE_BUILD_FAILED");
    assert.equal(error.cause, undefined);
    assert.equal(/synthetic-private|neutral-site-test-|credential|example\.invalid/.test(error.message), false, "error never contains source bytes or machine paths");
    return true;
  });
}

test("neutral export contains exactly the reviewed public surface, copied byte-for-byte, with a reproducible manifest", async (t) => {
  const { root, project, build } = await sandbox(t);
  const marker = "synthetic-private-do-not-export";
  await mkdir(join(project, "server"));
  await writeFile(join(project, "server/credentials.json"), marker);
  await writeFile(join(project, "public/admin-login.js"), marker);
  await writeFile(join(project, "public/personal-photo.jpg"), marker);
  await writeFile(join(project, "private.env"), marker);
  const output = join(root, "first"), manifest = await build({ output });
  assert.deepEqual(await fileNames(output), outputNames);
  assert.deepEqual(manifest.files.map((file) => file.name).sort(), outputNames);
  assert.equal(manifest.format, "jessiemessage-neutral-site"); assert.equal(manifest.version, 1);
  let totalBytes = 0;
  for (const entry of manifest.files) {
    const bytes = await readFile(join(output, entry.name)); totalBytes += bytes.length;
    assert.equal(entry.bytes, bytes.length); assert.equal(entry.sha256, digest(bytes));
    assert.equal(bytes.includes(Buffer.from(marker)), false);
    assert.equal((await lstat(join(output, entry.name))).mode & 0o111, 0, "public copies are not executable");
    if (sourceNames.includes(entry.name)) assert.deepEqual(bytes, await readFile(join(project, "public", entry.name)), `${entry.name} remains unchanged`);
  }
  assert.equal(manifest.totalBytes, totalBytes);
  assert.equal(JSON.stringify(manifest).includes(root), false, "manifest has no absolute output / source paths");
  assert.deepEqual(await build({ output: join(root, "second") }), manifest, "destination and build time cannot change published bytes");
  const webmanifest = JSON.parse(await readFile(join(output, "manifest.webmanifest"), "utf8"));
  assert.equal(webmanifest.id, "/"); assert.equal(webmanifest.start_url, "/app");
  assert.deepEqual(JSON.parse(await readFile(join(output, "_neutral/entry.json"), "utf8")), { status: "unavailable", client: null, administrator: null });
  assert.deepEqual(JSON.parse(await readFile(join(output, "_neutral/health.json"), "utf8")), { status: "ok" });
  assert.deepEqual(JSON.parse(await readFile(join(output, "_neutral/unavailable.json"), "utf8")), { status: "unavailable" });
});

test("Apache export declares a closed public route set and internal neutral JSON, without arbitrary-file or proxy fallback", async (t) => {
  const { root, build } = await sandbox(t), output = join(root, "site");
  await build({ output });
  const apache = await readFile(join(output, ".htaccess"), "utf8");
  // This checks the generated policy, not Apache execution. The target host must
  // still verify its modules, AllowOverride, error documents and HEAD handling.
  const allow = apache.split("\n").find((line) => line.startsWith("RewriteRule ^(?:"));
  assert.ok(allow);
  const pattern = new RegExp(allow.split(" ")[1]);
  for (const name of sourceNames.filter((name) => name !== "entry.html")) assert.equal(pattern.test(name), true, name);
  for (const name of ["entry.html", "admin", "admin/login", "access", "messages", "chat.js", "admin-login.js", "server/index.mjs", "brand/asset-manifest.json", ".htaccess", "_neutral/entry.json", "../index.html", "brand/../../private.env", "index.html/extra", "stylesXcss"]) {
    assert.equal(pattern.test(name), false, `not an allowed direct file: ${name}`);
  }
  assert.match(apache, /Options -Indexes -MultiViews/);
  assert.match(apache, /RewriteRule \^\$ index\.html \[END\]/);
  assert.match(apache, /RewriteRule \^app\$ entry\.html \[END\]/);
  assert.match(apache, /RewriteCond %\{REQUEST_METHOD\} !\^GET\$\nRewriteRule \^api\/entry\$ - \[R=405,END\]/);
  assert.match(apache, /RewriteRule \^api\/entry\$ _neutral\/entry\.json \[END\]/);
  assert.match(apache, /RewriteRule \^api\/health\$ _neutral\/health\.json \[END\]/);
  assert.match(apache, /RewriteRule \^api\/ready\$ - \[R=503,END\]/);
  assert.match(apache, /ErrorDocument 503 \/_neutral\/unavailable\.json/);
  assert.match(apache, /RewriteCond %\{ENV:REDIRECT_STATUS\} \^503\$\nRewriteRule \^_neutral\/unavailable\\\.json\$ - \[END\]/);
  assert.equal(apache.trim().endsWith("RewriteRule ^ - [R=404,END]"), true);
  assert.doesNotMatch(apache, /REQUEST_FILENAME|\s-f\b|\s-d\b|RewriteRule[^\n]*(?:https?:|\[P\]|\.php)/);
  assert.match(apache, /Header always set Cache-Control "no-store"/);
  assert.match(apache, /Header always set X-Content-Type-Options "nosniff"/);
  assert.doesNotMatch(apache, /<IfModule/, "required host directives must fail visibly instead of silently omitting protections");
});

test("Apache root has an explicit index and both Allow tables are cleared before the 405 replacements", async (t) => {
  const { root, build } = await sandbox(t), output = join(root, "site");
  await build({ output });
  const lines = (await readFile(join(output, ".htaccess"), "utf8")).split("\n");
  assert.deepEqual(lines.filter((line) => line.startsWith("DirectoryIndex ")), ["DirectoryIndex disabled", "DirectoryIndex index.html"], "reset inherited index candidates, then retain only the explicit public index while listings stay disabled");
  assert.ok(lines.includes("Options -Indexes -MultiViews"));
  assert.deepEqual(lines.filter((line) => /^Header (onsuccess|always) (unset|set) Allow(?: |$)/.test(line)), [
    "Header onsuccess unset Allow",
    "Header always unset Allow",
    'Header always set Allow "GET, HEAD" "expr=%{REQUEST_STATUS} == 405"',
    'Header always set Allow "GET" "expr=%{REQUEST_STATUS} == 405 && %{REQUEST_URI} == \'/api/entry\'"',
  ], "clear both response-header tables before setting the route-specific Allow value");
});

test("output is a new absolute leaf; existing directories / files, checkout paths and traversal are refused without overwrite", async (t) => {
  const { root, project, build } = await sandbox(t);
  const directory = join(root, "existing"); await mkdir(directory); await writeFile(join(directory, "keep.txt"), "untouched");
  const file = join(root, "existing-file"); await writeFile(file, "untouched");
  for (const output of [undefined, "relative-site", directory, file, project, join(project, "public/export"), join(project, "export"), `${root}/temporary/../traversal`]) await rejected(() => build({ output }));
  assert.equal(await readFile(join(directory, "keep.txt"), "utf8"), "untouched");
  assert.equal(await readFile(file, "utf8"), "untouched");
  assert.deepEqual(await readdir(directory), ["keep.txt"]);
  assert.equal(await missing(join(project, "export")), true); assert.equal(await missing(join(root, "traversal")), true);
  const output = join(root, "new-site"), first = await build({ output });
  await rejected(() => build({ output }));
  assert.deepEqual(await fileNames(output), first.files.map((entry) => entry.name).sort());
});

test("output symlink leaf and ancestor are refused, leaving their targets untouched", async (t) => {
  const { root, build } = await sandbox(t);
  const actual = join(root, "actual"); await mkdir(actual); await writeFile(join(actual, "keep.txt"), "untouched");
  const link = join(root, "link"); await symlink(actual, link);
  await rejected(() => build({ output: link }));
  await rejected(() => build({ output: join(link, "new-site") }));
  assert.deepEqual(await readdir(actual), ["keep.txt"]); assert.equal(await readFile(join(actual, "keep.txt"), "utf8"), "untouched");
});

for (const kind of ["missing file", "file symlink", "directory symlink"]) {
  test(`required source ${kind} fails before creating an export`, async (t) => {
    const { root, project, build } = await sandbox(t), output = join(root, "site");
    if (kind === "directory symlink") {
      await rename(join(project, "public/brand"), join(root, "brand"));
      await symlink(join(root, "brand"), join(project, "public/brand"));
    } else {
      await unlink(join(project, "public/index.html"));
      if (kind === "file symlink") { await writeFile(join(root, "synthetic-private.txt"), "synthetic-private-do-not-export"); await symlink(join(root, "synthetic-private.txt"), join(project, "public/index.html")); }
    }
    await rejected(() => build({ output })); assert.equal(await missing(output), true);
  });
}

test("operator CLI accepts only explicit output, reports public deterministic metadata, and never reads credential environment", async (t) => {
  const { root, project } = await sandbox(t), output = join(root, "synthetic-user-marker-site");
  const command = join(project, "scripts/build-neutral-site.mjs");
  const env = { ...process.env, JESSIEMESSAGE_DB_PASSWORD: "synthetic-private-env-marker", JESSIEMESSAGE_MFA_KEY: "synthetic-private-key-marker" };
  const success = spawnSync(process.execPath, [command, "--output", output], { encoding: "utf8", env, timeout: 30000 });
  assert.equal(success.status, 0, success.stderr); assert.equal(success.stderr, "");
  assert.deepEqual(JSON.parse(success.stdout).files.map((file) => file.name).sort(), outputNames);
  assert.equal(/synthetic-private|synthetic-user-marker|neutral-site-test-/.test(success.stdout), false);
  const help = spawnSync(process.execPath, [command, "--help"], { encoding: "utf8", timeout: 5000 });
  assert.equal(help.status, 0); assert.match(help.stdout, /--output \/absolute\/new-directory/);
  for (const args of [[], ["--output", output], ["--output", join(root, "unused"), "--include-private"], ["--source", project]]) {
    const failure = spawnSync(process.execPath, [command, ...args], { encoding: "utf8", env, timeout: 30000 });
    assert.equal(failure.status, 1); assert.equal(failure.stdout, "");
    assert.equal(/synthetic-private|synthetic-user-marker|neutral-site-test-/.test(failure.stderr), false);
  }
  assert.equal(await missing(join(root, "unused")), true);
});
