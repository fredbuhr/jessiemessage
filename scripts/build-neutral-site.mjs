#!/usr/bin/env node
// Public, static export only. No environment/configuration, database, private
// controller, authentication handler, PHP or general directory copy is used.
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const checkout = fileURLToPath(new URL("../", import.meta.url)).replace(/\/$/, "");
const sourceRoot = join(checkout, "public");
export const NEUTRAL_SOURCE_FILES = Object.freeze([
  "index.html", "styles.css", "app.js", "entry.html", "entry.js", "entry-model.js", "entry.css", "i18n.js", "i18n.css",
  "manifest.webmanifest", "favicon.ico", "apple-touch-icon.png", "brand/brand.css", "brand/icon-16.png", "brand/icon-32.png",
  "brand/icon-48.png", "brand/icon-64.png", "brand/icon-128.png", "brand/icon-192.png", "brand/icon-512.png", "brand/icon-maskable-512.png",
]);

const json = (value) => Buffer.from(`${JSON.stringify(value)}\n`);
const generated = new Map([
  ["_neutral/entry.json", json({ status: "unavailable", client: null, administrator: null })],
  ["_neutral/health.json", json({ status: "ok" })],
  ["_neutral/unavailable.json", json({ status: "unavailable" })],
]);
const escapePattern = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const staticRoutes = NEUTRAL_SOURCE_FILES.filter((name) => name !== "entry.html");
const apache = `# JessieMessage neutral public export. Apache 2.4; no PHP / Node proxy.
# Requires mod_rewrite, mod_headers, mod_mime, mod_dir and the corresponding AllowOverride.
# Unsupported directives must fail visibly. Verify the actual host before moving traffic.
# These fixed health/readiness responses do not measure Node, SQL or private services.
Options -Indexes -MultiViews
DirectoryIndex disabled
ErrorDocument 400 "Bad request"
ErrorDocument 404 "Not found"
ErrorDocument 405 "Method not allowed"
ErrorDocument 503 /_neutral/unavailable.json

AddType text/javascript .js
AddType application/manifest+json .webmanifest
AddType application/json .json
AddCharset UTF-8 .html .css .js .json .webmanifest

Header always set Cache-Control "no-store"
Header always set Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'"
Header always set X-Content-Type-Options "nosniff"
Header always set Referrer-Policy "no-referrer"
Header always set X-Frame-Options "DENY"
Header always set Cross-Origin-Resource-Policy "same-origin"
Header always set Permissions-Policy "camera=(), microphone=(), geolocation=()"
Header onsuccess unset Set-Cookie
Header always unset Set-Cookie
Header always set Allow "GET, HEAD" "expr=%{REQUEST_STATUS} == 405"
Header always set Allow "GET" "expr=%{REQUEST_STATUS} == 405 && %{REQUEST_URI} == '/api/entry'"
Header always set Retry-After "15" "expr=%{REQUEST_STATUS} == 503"

RewriteEngine On
# Only an internal 503 error document may expose this static JSON file.
RewriteCond %{ENV:REDIRECT_STATUS} ^503$
RewriteRule ^_neutral/unavailable\\.json$ - [END]

# Match the original neutral entry contract, including HEAD -> 405.
RewriteCond %{REQUEST_METHOD} !^GET$
RewriteRule ^api/entry$ - [R=405,END]
RewriteCond %{QUERY_STRING} !^$ [OR]
RewriteCond %{THE_REQUEST} "\\s/+api/entry\\?\\s"
RewriteRule ^api/entry$ - [R=400,END]
RewriteRule ^api/entry$ _neutral/entry.json [END]

# Apache handles response-body suppression for HEAD; assets remain ordinary files.
RewriteCond %{REQUEST_METHOD} !^(GET|HEAD)$
RewriteRule ^ - [R=405,END]
RewriteRule ^api/health$ _neutral/health.json [END]
RewriteRule ^api/ready$ - [R=503,END]
RewriteRule ^$ index.html [END]
RewriteRule ^app$ entry.html [END]
RewriteRule ^(?:${staticRoutes.map(escapePattern).join("|")})$ - [END]
# No arbitrary existing-file/directory bypass and no SPA / proxy fallback.
RewriteRule ^ - [R=404,END]
`;
generated.set(".htaccess", Buffer.from(apache));

export class NeutralSiteBuildError extends Error {
  constructor() { super("Unable to build the neutral site. Use a new absolute directory outside the checkout, with no symbolic-link ancestors."); this.name = "NeutralSiteBuildError"; this.code = "NEUTRAL_SITE_BUILD_FAILED"; }
}
const fail = () => { throw new NeutralSiteBuildError(); };
const identity = (left, right) => left.dev === right.dev && left.ino === right.ino;
const contains = (parent, child) => { const path = relative(parent, child); return path === "" || !path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path); };

async function ancestors(path) {
  const paths = [];
  for (let current = path;; current = dirname(current)) { paths.unshift(current); if (dirname(current) === current) break; }
  const records = [];
  for (const name of paths) {
    const stat = await lstat(name);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail();
    records.push({ name, stat });
  }
  return records;
}
async function unchanged(records) {
  for (const record of records) {
    const stat = await lstat(record.name);
    if (!stat.isDirectory() || stat.isSymbolicLink() || !identity(stat, record.stat)) fail();
  }
}
async function readPublicFile(name) {
  const path = join(sourceRoot, name), parents = await ancestors(dirname(path));
  const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink()) fail();
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || !identity(before, opened)) fail();
    const bytes = await handle.readFile();
    const after = await lstat(path);
    if (!after.isFile() || after.isSymbolicLink() || !identity(opened, after)) fail();
    await unchanged(parents);
    return bytes;
  } finally { await handle.close(); }
}

/** The manifest describes generated public bytes only, with no machine paths or
 * timestamps. Failures preserve an incomplete new directory; no broad cleanup.
 * Pre/post identity checks are portable, not an openat / bind-mount guarantee:
 * run with a quiescent operator-owned destination and no concurrent FS changes. */
export async function buildNeutralSite({ output } = {}) {
  let rootHandle;
  try {
    if (typeof output !== "string" || !isAbsolute(output) || output.includes("\0")
      || output.split(sep).some((part) => part === "." || part === "..")) fail();
    const target = resolve(output), project = await realpath(checkout);
    if (contains(project, target) || contains(target, project)) fail();
    const parents = await ancestors(dirname(target));
    // Validate every required source before creating any output. Extra public/
    // files are never enumerated and cannot enter this export.
    const sourceBytes = await Promise.all(NEUTRAL_SOURCE_FILES.map(async (name) => [name, await readPublicFile(name)]));
    await unchanged(parents);
    await mkdir(target, { mode: 0o755 }); // Exclusive leaf: no recursive mkdir or overwrite.
    const root = await lstat(target);
    if (!root.isDirectory() || root.isSymbolicLink()) fail();
    rootHandle = await open(target, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    if (!identity(root, await rootHandle.stat())) fail();
    const directories = [...parents, { name: target, stat: root }];
    for (const name of ["brand", "_neutral"]) {
      await unchanged(directories);
      const path = join(target, name);
      await mkdir(path, { mode: 0o755 });
      const stat = await lstat(path);
      if (!stat.isDirectory() || stat.isSymbolicLink()) fail();
      directories.push({ name: path, stat });
    }
    const entries = [];
    for (const [name, bytes] of [...sourceBytes, ...generated].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
      await unchanged(directories);
      const path = join(target, name);
      const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o644);
      try { await handle.writeFile(bytes); await handle.sync(); }
      finally { await handle.close(); }
      await unchanged(directories);
      entries.push({ name, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
    }
    await rootHandle.sync(); await rootHandle.close(); rootHandle = null;
    return { format: "jessiemessage-neutral-site", version: 1, files: entries, totalBytes: entries.reduce((sum, file) => sum + file.bytes, 0) };
  } catch { throw new NeutralSiteBuildError(); }
  finally { if (rootHandle) { try { await rootHandle.close(); } catch {} } }
}

async function main(args) {
  if (args.length === 1 && args[0] === "--help") { process.stdout.write("Usage: node scripts/build-neutral-site.mjs --output /absolute/new-directory\n"); return; }
  if (args.length !== 2 || args[0] !== "--output") fail();
  process.stdout.write(`${JSON.stringify(await buildNeutralSite({ output: args[1] }))}\n`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(() => { process.stderr.write("Neutral site build failed. Provide a new absolute directory outside the checkout with no symbolic links.\n"); process.exitCode = 1; });
}
