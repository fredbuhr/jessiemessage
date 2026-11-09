import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

assert.equal(process.argv.length, 5, "Usage: node test-install-storage-bindings.mjs INSTALLER ACTIVE_CHECKOUT CANDIDATE_CHECKOUT");
const [script, active, candidate] = process.argv.slice(2).map(path => realpathSync(path));
assert.equal(process.version, "v24.22.1");
const workspace = mkdtempSync(join(tmpdir(), "jm-bindings-test-"));
after(() => rmSync(workspace, { recursive: true, force: true }));
symlinkSync(join(active, "server"), join(workspace, "server"), "dir");

let implementation = readFileSync(script, "utf8");
function replace(source, target) {
  const position = implementation.indexOf(source);
  assert.ok(position >= 0 && implementation.indexOf(source, position + source.length) < 0, "Installer changed");
  implementation = implementation.replace(source, () => target);
}
replace('import { loadRuntimeVideoEnvironment, VIDEO_RUNTIME_OPTIONS } from "./server/config/runtime-video.mjs";',
  'const VIDEO_RUNTIME_OPTIONS = {}; const loadRuntimeVideoEnvironment = async () => ({ ...fixtureConfig });');
replace('import { createRuntimePool } from "./server/db/runtime.mjs";', 'const createRuntimePool = async () => fakePool;');
replace('import { mediaConfiguration } from "./server/media/config.mjs";', 'const mediaConfiguration = () => fixtureMedia;');
replace('const privatePath = "/srv/customer/jessiemessage-private";', 'const privatePath = process.cwd() + "/" + process.argv[2];');
replace('const activeCheckout = "/srv/customer/jessiemessage-operator/production-1151-a4a07f9f";',
  'const activeCheckout = ' + JSON.stringify(active) + ';');
replace('const candidateCheckout = "/srv/customer/jessiemessage-operator/production-1160-" + candidateSource.slice(0, 8);',
  'const candidateCheckout = ' + JSON.stringify(candidate) + ';');
replace('assert(process.cwd() === activeCheckout && process.version === "v24.22.1");',
  'assert(process.version === "v24.22.1");');
const tree = implementation.match(/const candidateTree = "[a-f0-9]{40}";/)?.[0];
assert.ok(tree);
replace(tree, tree.replace(/"[a-f0-9]{40}"/, 'process.argv[2] === "wrong_pin" ? "1".repeat(40) : $&'));
const preamble = "const mode = process.argv[2];\nconst { mkdir, appendFile } = await import(\"node:fs/promises\");\nconst { createErasureJournal } = await import(\"./server/data/erasure-journal.mjs\");\nconst { videoStoredBytes } = await import(\"./server/video/storage.mjs\");\nconst ops = privatePath + \"/recurring-backup-052\";\nconst photoRoot = privatePath + \"/photos\";\nconst videoRoot = privatePath + \"/videos\";\nawait mkdir(privatePath, { mode: 0o700 });\nfor (const path of [ops, photoRoot, videoRoot]) await mkdir(path, { mode: 0o700 });\nconst photoKey = Buffer.alloc(32, 1), vidKey = Buffer.alloc(32, 2), closureKey = Buffer.alloc(32, 3);\nconst owner = Buffer.alloc(16, 4), photoId = Buffer.alloc(16, 5), videoId = Buffer.alloc(16, 6);\nconst photoName = Buffer.alloc(32, 7), videoName = Buffer.alloc(32, 8);\nconst full = Buffer.from(\"photo\"), thumb = Buffer.from(\"thumb\"), videoData = Buffer.from(\"video\");\nconst readStorage = await createMediaStorage({ root: photoRoot, key: photoKey, pathMode: \"linux-dirfd\" });\nawait readStorage.put({ assetId: photoId, storageKey: photoName, full, thumbnail: thumb });\nconst writeVideo = await createVideoStorage({ root: videoRoot, key: vidKey, pathMode: \"linux-dirfd\" });\nconst videoResult = await writeVideo.put({ assetId: videoId, storageKey: videoName, bytes: videoData.length,\n  source: (async function* () { yield videoData; })() });\nif (mode === \"tamper\") await appendFile(photoRoot + \"/\" + photoName.toString(\"hex\") + \".full.enc\", Buffer.from(\"X\"));\nconst fixtureConfig = {\n  JESSIEMESSAGE_VIDEO_ROOT: videoRoot, JESSIEMESSAGE_VIDEO_KEY: vidKey.toString(\"base64url\"),\n  JESSIEMESSAGE_CRM_KEY: closureKey.toString(\"base64url\"), JESSIEMESSAGE_DB_NAME: \"fixture\",\n  JESSIEMESSAGE_VIDEO_OWNER_BYTES: \"2048\", JESSIEMESSAGE_VIDEO_TOTAL_BYTES: \"4096\",\n};\nconst fixtureMedia = { enabled: true, root: photoRoot, key: photoKey, capacity: { ownerBytes: 2048, totalBytes: 4096 } };\nconst old = async (kind, path, key) => createHmac(\"sha256\", key).update(\"jessiemessage:\" + kind + \"-root:v1:\\0\")\n  .update(path).update(\"\\0\").update(\"1\").update(\"\\0\").update(String((await lstat(path, { bigint: true })).ino)).digest();\nconst photoOld = await old(\"media\", photoRoot, photoKey), videoOld = await old(\"video\", videoRoot, vidKey);\nconst binding1 = { database: \"fixture\", rootFingerprint: photoOld.toString(\"hex\") };\nconst binding2 = { ...binding1, videoRootFingerprint: videoOld.toString(\"hex\") };\nfor (const version of [1, 2]) {\n  const binding = version === 1 ? binding1 : binding2;\n  const clientId = Buffer.alloc(16, 8 + version).toString(\"hex\");\n  const journal = createErasureJournal({ directory: ops, key: closureKey, binding, clientId });\n  const steps = mode === \"pending\" && version === 2 ? [\"requested\"] : [\"requested\",\"prepared\",\"files_erased\",\"completed\"];\n  for (const [revision, phase] of steps.entries()) await journal.save({ version, binding, clientId, phase, cursor: null,\n    startedAt: 100, updatedAt: 100 + revision }, revision, async () => {});\n  journal.close();\n}\nconst date = \"2026-11-09 11:50:01.000000\";\nconst state = { id: 1, owner_bytes: 2048, total_bytes: 4096, initialized_at: date };\nconst photo = { id: photoId, owner_id: owner, owner_role: \"admin\", storage_key: photoName,\n  content_digest: createHash(\"sha256\").update(full).digest(), full_bytes: full.length, thumbnail_bytes: thumb.length, deleted_at: null };\nconst object = { ...photo, stored_bytes: full.length + thumb.length + 80, state: \"registered\", asset_id: photoId };\nconst vrow = { id: videoId, owner_id: owner, owner_role: \"admin\", storage_key: videoName, reserve_token_hash: Buffer.alloc(32, 10),\n  content_digest: videoResult.digest, bytes: videoData.length, stored_bytes: videoStoredBytes(videoData.length), mime: \"video/mp4\",\n  state: \"committed\", created_at: date, updated_at: date, released_at: null };\nlet transactions = 0;\nconst fakePool = { end: async () => {}, getConnection: async () => ({\n  async query(sql) {\n    if (sql.startsWith(\"SET TRANSACTION\") || sql.startsWith(\"START TRANSACTION\")) return [];\n    if (sql.startsWith(\"SELECT DATABASE\")) { transactions++; return [{ name: mode === \"sql_drift\" && transactions === 5 ? \"other\" : \"fixture\" }]; }\n    if (sql.includes(\"FROM media_storage_state\")) return [{ ...state, root_fingerprint: photoOld, held_bytes: object.stored_bytes }];\n    if (sql.includes(\"FROM video_storage_state\")) return [{ ...state, root_fingerprint: videoOld, held_bytes: vrow.stored_bytes }];\n    if (sql.includes(\"FROM media_assets\")) return [photo];\n    if (sql.includes(\"FROM media_storage_objects\")) return [object];\n    if (sql.includes(\"FROM video_assets\")) return [vrow];\n    throw Error(\"unexpected query\");\n  },\n  rollback: async () => {}, release: async () => {},\n}) };\n\nconst markerPath = (kind, root) => join(dirname(root), \"binding-\" + createHash(\"sha256\").update(JSON.stringify([kind, root])).digest(\"hex\") + \".json\");\nconst checkPhotoMarker = markerPath(\"media\", photoRoot);\nconst checkVideoMarker = markerPath(\"video\", videoRoot);\nif (mode === \"bad_marker\") {\n  const { writeFile } = await import(\"node:fs/promises\");\n  await writeFile(checkVideoMarker, '{\"revision\":0}\\n', { mode: 0o600, flag: \"wx\" });\n}\nif (mode === \"existing\" || mode === \"partial\") {\n  const { provisionStorageRootBinding } = await import(pathToFileURL(join(candidateCheckout, gitFiles[1])).href);\n  for (const [kind, root, key, expectedFingerprint] of [[\"media\", photoRoot, photoKey, photoOld], ...(mode === \"existing\" ? [[\"video\", videoRoot, vidKey, videoOld]] : [])]) {\n    const stats = await lstat(root, { bigint: true });\n    await provisionStorageRootBinding({ kind, root, key, previousDevice: \"1\", currentDevice: String(stats.dev), inode: String(stats.ino), expectedFingerprint });\n  }\n}\nconst existingPhotos = await lstat(checkPhotoMarker, { bigint: true }).catch(() => null);\nconst existingVideos = await lstat(checkVideoMarker, { bigint: true }).catch(() => null);\n";
const postamble = "console.log(JSON.stringify({photoMarker: !!await lstat(checkPhotoMarker).catch(() => null), videoMarker: !!await lstat(checkVideoMarker).catch(() => null)}));\nconst stillSame = async (marker, before) => {\n  if (!before) return true;\n  const after = await lstat(marker, { bigint: true });\n  return [\"dev\",\"ino\",\"size\",\"mtimeNs\",\"ctimeNs\"].every(field => before[field] === after[field]);\n};\nconsole.log(JSON.stringify({existingMarkersPreserved: (await stillSame(checkPhotoMarker, existingPhotos)) && (await stillSame(checkVideoMarker, existingVideos))}));";

replace('let phase = "pinned_active"', preamble + 'let phase = "pinned_active"');
const fixture = join(workspace, "fixture.mjs");
writeFileSync(fixture, implementation + "\n" + postamble + "\n", { mode: 0o600, flag: "wx" });

const scenarios = {
  healthy: [0, 2, 2, true, true, null], tamper: [1, 0, 0, false, false, "photo_inventory"],
  pending: [1, 0, 0, false, false, "pending_operations"], bad_marker: [1, 0, 0, false, true, "prevalidate_both_markers"],
  existing: [0, 0, 2, true, true, null], partial: [0, 1, 2, true, true, null],
  wrong_pin: [1, 0, 0, false, false, "candidate_pin"], sql_drift: [1, 1, 1, true, false, "video_marker"],
};
for (const [mode, expected] of Object.entries(scenarios)) {
  test(mode, () => {
    const result = spawnSync(process.execPath, [fixture, mode], { cwd: workspace, encoding: "utf8",
      env: { PATH: "/usr/bin:/bin" }, timeout: 30000 });
    assert.equal(result.error, undefined);
    assert.equal(result.stderr, "");
    const [report, markers, immutable] = result.stdout.trim().split("\n").map(JSON.parse);
    assert.deepEqual([result.status, report.markerWriteAttempts, report.markersConfirmed,
      markers.photoMarker, markers.videoMarker, report.phase ?? null], expected);
    assert.equal(immutable.existingMarkersPreserved, true);
    assert.equal(report.sqlMutated, false);
    assert.equal(report.runtimeStarted, false);
  });
}
