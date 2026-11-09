import { createHash, createHmac } from "node:crypto";
import { constants } from "node:fs";
import { access, open, opendir, lstat, realpath } from "node:fs/promises";
import { dirname, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { loadRuntimeVideoEnvironment, VIDEO_RUNTIME_OPTIONS } from "./server/config/runtime-video.mjs";
import { clearRuntimeMessagingSecrets } from "./server/config/runtime-messaging.mjs";
import { assertDistinctVideoRoots } from "./server/config/runtime-video-storage.mjs";
import { createRuntimePool } from "./server/db/runtime.mjs";
import { mediaConfiguration } from "./server/media/config.mjs";
import { createMediaStorage } from "./server/media/storage.mjs";
import { createVideoStorage } from "./server/video/storage.mjs";
import { inspectVideoBackupInventory } from "./server/backup/video-inventory.mjs";
import { withPrivateDirectory } from "./server/files/private-directory.mjs";
import { erasureJournalBindings, readErasureJournalBatch } from "./server/data/erasure-journal.mjs";

const privatePath = "/srv/customer/jessiemessage-private";
const maxRows = 5000;
const maxFiles = maxRows * 2 + 1;
const maxBytes = 4 * 1024 ** 3;
const deadline = AbortSignal.timeout(175000);
const report = { status: "storage_binding_install_incomplete", inventoryVerified: false,
  sqlMutated: false, mediaMutated: false, runtimeStarted: false, markerWriteAttempts: 0, markersConfirmed: 0 };
const fail = () => { throw new Error(); };
const assert = condition => { if (!condition) fail(); };
const digest = value => createHash("sha256").update(JSON.stringify(value, (_key, entry) =>
  typeof entry === "bigint" ? String(entry) : entry)).digest("hex");
const hex = (value, length) => {
  assert(Buffer.isBuffer(value) && value.length === length);
  return value.toString("hex");
};
function integer(value, min = 0, max = Number.MAX_SAFE_INTEGER) {
  assert(typeof value === "number" || typeof value === "bigint" || typeof value === "string" && /^(?:0|[1-9][0-9]*)$/.test(value));
  const number = Number(value);
  assert(Number.isSafeInteger(number) && number >= min && number <= max);
  return number;
}
const same = (left, right, length) => hex(left, length) === hex(right, length);

async function catalogue(pool, database) {
  let connection;
  try {
    deadline.throwIfAborted();
    connection = await pool.getConnection();
    await connection.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    await connection.query("START TRANSACTION READ ONLY, WITH CONSISTENT SNAPSHOT");
    assert((await connection.query("SELECT DATABASE() AS name"))[0]?.name === database);
    const limit = maxRows + 1;
    const stateColumns = "id,owner_bytes,total_bytes,held_bytes,root_fingerprint,DATE_FORMAT(initialized_at,'%Y-%m-%d %H:%i:%s.%f') AS initialized_at";
    const dates = "DATE_FORMAT(created_at,'%Y-%m-%d %H:%i:%s.%f') AS created_at,DATE_FORMAT(updated_at,'%Y-%m-%d %H:%i:%s.%f') AS updated_at,DATE_FORMAT(released_at,'%Y-%m-%d %H:%i:%s.%f') AS released_at";
    const mediaState = await connection.query("SELECT " + stateColumns + " FROM media_storage_state ORDER BY id LIMIT 2");
    const videoState = await connection.query("SELECT " + stateColumns + " FROM video_storage_state ORDER BY id LIMIT 2");
    const photos = await connection.query("SELECT id,owner_id,owner_role,storage_key,content_digest,full_bytes,thumbnail_bytes,deleted_at FROM media_assets ORDER BY id LIMIT " + limit);
    const objects = await connection.query("SELECT id,owner_id,owner_role,storage_key,content_digest,full_bytes,thumbnail_bytes,stored_bytes,state,asset_id FROM media_storage_objects ORDER BY id LIMIT " + limit);
    const videos = await connection.query("SELECT id,owner_id,owner_role,storage_key,reserve_token_hash,content_digest,bytes,stored_bytes,mime,state," + dates + " FROM video_assets ORDER BY id LIMIT " + limit);
    assert(mediaState.length === 1 && integer(mediaState[0].id) === 1 && videoState.length === 1 && integer(videoState[0].id) === 1
      && photos.length + objects.length + videos.length <= maxRows);
    return { media: mediaState[0], video: videoState[0], photos, objects, videos };
  } finally {
    if (connection) {
      try { await connection.rollback(); } finally { await connection.release(); }
    }
  }
}

function previousDevice(roots, states) {
  assert(roots[0].stats.dev === roots[1].stats.dev && roots[0].stats.ino !== roots[1].stats.ino
  );
  const calculate = ({ kind, path, key, stats }, device) => createHmac("sha256", key)
    .update("jessiemessage:" + kind + "-root:v1:\0", "ascii").update(path, "utf8")
    .update("\0").update(String(device)).update("\0").update(String(stats.ino)).digest();
  for (let minor = 1; minor < 2 ** 20; minor++) {
    if ((minor & 1023) === 0) deadline.throwIfAborted();
    const device = (((minor & 0xfff00) << 12) | (minor & 255)) >>> 0;
    if (BigInt(device) === roots[0].stats.dev) continue;
    if (calculate(roots[0], device).equals(states[0].root_fingerprint)
      && calculate(roots[1], device).equals(states[1].root_fingerprint)) return String(device);
  }
  fail();
}

async function privateParent(root) {
  const parent = await lstat(dirname(root), { bigint: true });
  return parent.isDirectory() && parent.uid === BigInt(process.getuid()) && (parent.mode & 0o7777n) === 0o700n;
}

async function fileSignature(root, journalOnly = false) {
  return withPrivateDirectory(root, async scope => {
    const rootStats = await scope.assertReady();
    const entries = [];
    for await (const entry of await opendir(scope.path)) {
      deadline.throwIfAborted();
      if (journalOnly && !/^\.?erasure-/.test(entry.name)) continue;
      assert(entries.length < maxFiles);
      const stats = await lstat(scope.file(entry.name), { bigint: true });
      assert(stats.isFile());
      entries.push([entry.name, stats.dev, stats.ino, stats.size, stats.mode, stats.uid, stats.gid, stats.nlink, stats.mtimeNs, stats.ctimeNs]);
    }
    entries.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
    return digest([rootStats.dev, rootStats.ino, rootStats.mtimeNs, rootStats.ctimeNs, entries]);
  });
}

async function journals(binding, key) {
  const directory = privatePath + "/recurring-backup-052";
  const files = await fileSignature(directory, true);
  const records = [], clients = new Set(), counts = { version1: 0, version2: 0, pending: 0, completed: 0 };
  let afterName = null;
  do {
    deadline.throwIfAborted();
    const page = await readErasureJournalBatch({ directory,
      key, ...erasureJournalBindings(binding), afterName, limit: 100 });
    for (const job of page.jobs) {
      assert(records.length < 1000 && !clients.has(job.clientId) && [1, 2].includes(job.version));
      clients.add(job.clientId);
      records.push(job);
      counts["version" + job.version]++;
      counts[job.phase === "completed" ? "completed" : "pending"]++;
    }
    assert(page.nextCursor === null || (afterName === null || page.nextCursor > afterName));
    afterName = page.nextCursor;
  } while (afterName !== null);
  assert(files === await fileSignature(directory, true));
  return { counts, signature: digest([files, records]) };
}

function validateCapacity(row, owner, total) {
  assert(integer(row.owner_bytes, 1) === integer(owner, 1) && integer(row.total_bytes, 1) === integer(total, 1)
    && integer(row.held_bytes) <= integer(row.total_bytes, 1));
  return { ownerBytes: integer(row.owner_bytes), totalBytes: integer(row.total_bytes), heldBytes: integer(row.held_bytes),
    rootFingerprint: hex(row.root_fingerprint, 32), initializedAt: row.initialized_at };
}

async function verifyPhotos(data, storage, capacity) {
  const expected = new Map(), objects = new Map(), ownerCharges = new Map();
  let charged = 0;
  for (const object of data.objects) {
    deadline.throwIfAborted();
    const storageKey = hex(object.storage_key, 32);
    assert(!objects.has(storageKey) && ["registered", "released"].includes(object.state)
      && ["admin", "client"].includes(object.owner_role));
    objects.set(storageKey, object);
    const stored = integer(object.stored_bytes, 82, 11010128);
    assert(stored === integer(object.full_bytes, 1, 10485760) + integer(object.thumbnail_bytes, 1, 524288) + 80);
    if (object.state === "registered") {
      assert(same(object.id, object.asset_id, 16));
      const owner = object.owner_role + ":" + hex(object.owner_id, 16);
      const ownerCharge = (ownerCharges.get(owner) ?? 0) + stored;
      assert(ownerCharge <= capacity.ownerBytes);
      ownerCharges.set(owner, ownerCharge);
      charged += stored;
    }
  }
  assert(charged === capacity.heldBytes);
  let authenticated = 0;
  for (const asset of data.photos) {
    deadline.throwIfAborted();
    const storageKey = hex(asset.storage_key, 32), object = objects.get(storageKey);
    assert(object && same(object.id, asset.id, 16) && same(object.owner_id, asset.owner_id, 16)
      && object.owner_role === asset.owner_role && same(object.content_digest, asset.content_digest, 32)
      && integer(object.full_bytes) === integer(asset.full_bytes) && integer(object.thumbnail_bytes) === integer(asset.thumbnail_bytes));
    if (asset.deleted_at !== null) { assert(object.state === "released"); continue; }
    assert(object.state === "registered");
    for (const [variant, bytes] of [["full", integer(asset.full_bytes)], ["thumb", integer(asset.thumbnail_bytes)]]) {
      let plain;
      try {
        plain = await storage.get({ assetId: asset.id, storageKey: asset.storage_key, variant });
        assert(Buffer.isBuffer(plain) && plain.length === bytes
          && (variant === "thumb" || createHash("sha256").update(plain).digest().equals(asset.content_digest)));
        const name = storageKey + ":" + variant;
        assert(!expected.has(name));
        expected.set(name, BigInt(bytes + 40));
      } finally { plain?.fill(0); }
    }
    authenticated++;
  }
  assert(authenticated === data.objects.filter(object => object.state === "registered").length);
  for await (const entry of storage.scanEntries({ maxEntries: maxFiles, signal: deadline })) {
    const key = entry.storageKey?.toString("hex") + ":" + entry.variant;
    assert(entry.kind === "published" && entry.status === "structural_ok" && expected.get(key) === entry.encryptedBytes);
    expected.delete(key);
  }
  assert(expected.size === 0);
  return authenticated;
}

const activeCheckout = "/srv/customer/jessiemessage-operator/production-1151-a4a07f9f";
const activeSource = "a4a07f9f31c47a7185b57d11b8277be1d87fd2c1";
const activeTree = "568530e702fa4d0a8a6b1743988c5e20b8656c40";
const candidateSource = "d2b57fb88d58aacf64dd51c5d1952c65f5c327ae";
const candidateTree = "632ec530d812fa75cf2aa4b603c91c81dcaf7e8e";
const candidateCheckout = "/srv/customer/jessiemessage-operator/production-1160-" + candidateSource.slice(0, 8);
const gitFiles = ["package.json", "server/files/storage-root-binding.mjs", "server/files/private-directory.mjs",
  "server/files/private-json.mjs", "server/media/storage.mjs", "server/video/storage.mjs"];
const gitExec = promisify(execFile);

async function gitRead(checkout, ...args) {
  deadline.throwIfAborted();
  const result = await gitExec("/usr/bin/git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "-C", checkout, ...args], {
    env: { PATH: "/usr/bin:/bin", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_NO_REPLACE_OBJECTS: "1" },
    encoding: "buffer", maxBuffer: 2 * 1024 ** 2, timeout: 12000,
  });
  return result.stdout;
}

async function pinnedCheckout(checkout, source, tree, version, files) {
  assert(/^[0-9a-f]{40}$/.test(source) && /^[0-9a-f]{40}$/.test(tree) && await realpath(checkout) === checkout);
  const root = await lstat(checkout, { bigint: true });
  assert(root.isDirectory() && root.uid === BigInt(process.getuid()) && (root.mode & 0o7777n) === 0o700n);
  const identity = (await gitRead(checkout, "rev-parse", "--verify", "HEAD^{commit}")).toString().trim();
  const observedTree = (await gitRead(checkout, "rev-parse", "--verify", "HEAD^{tree}")).toString().trim();
  assert(identity === source && observedTree === tree
    && (await gitRead(checkout, "rev-parse", "--show-toplevel")).toString().trim() === checkout);
  assert((await gitRead(checkout, "status", "--porcelain=v1", "--untracked-files=normal", "--ignore-submodules=none")).length === 0);
  for (const file of files) {
    const name = join(checkout, file);
    assert(await realpath(name) === name);
    const expected = await gitRead(checkout, "show", source + ":" + file);
    const stats = await lstat(name, { bigint: true });
    assert(stats.isFile() && stats.uid === BigInt(process.getuid()) && stats.nlink === 1n
      && stats.size === BigInt(expected.length) && (stats.mode & 0o022n) === 0n);
    const handle = await open(name, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const observed = await handle.readFile();
      const after = await handle.stat({ bigint: true });
      const named = await lstat(name, { bigint: true });
      assert(observed.equals(expected) && [after, named].every(value => ["dev","ino","size","mode","uid","nlink","mtimeNs","ctimeNs"]
        .every(field => value[field] === stats[field])));
      if (file === "package.json") assert(JSON.parse(observed).version === version);
    } finally { await handle.close(); }
  }
}

async function candidateComponents() {
  await pinnedCheckout(candidateCheckout, candidateSource, candidateTree, "1.16.0", gitFiles);
  const load = file => import(pathToFileURL(join(candidateCheckout, file)).href);
  const [{ provisionStorageRootBinding }, { createMediaStorage: candidatePhoto }, { createVideoStorage: candidateVideo }] =
    await Promise.all([load(gitFiles[1]), load(gitFiles[4]), load(gitFiles[5])]);
  assert([provisionStorageRootBinding, candidatePhoto, candidateVideo].every(value => typeof value === "function"));
  return { provisionStorageRootBinding, factories: [candidatePhoto, candidateVideo] };
}

async function prevalidateMarkers(storage, raw, expected) {
  const observed = await Promise.all(storage.map(item => item.fingerprint()));
  assert(observed.every((value, index) => Buffer.isBuffer(value) && (value.equals(raw[index]) || value.equals(expected[index]))));
  return observed.filter((value, index) => value.equals(expected[index])).length;
}

let phase = "pinned_active", config, media, videoKey, crmKey, pool;
try {
  assert(process.cwd() === activeCheckout && process.version === "v24.22.1");
  await pinnedCheckout(activeCheckout, activeSource, activeTree, "1.15.1",
    gitFiles.filter(file => file !== "server/files/storage-root-binding.mjs"));
  phase = "configuration";
  config = await loadRuntimeVideoEnvironment(privatePath + "/runtime-video-180", { ...VIDEO_RUNTIME_OPTIONS, port: "3000" });
  const originalConfiguration = digest(config);
  media = mediaConfiguration(config);
  videoKey = Buffer.from(config.JESSIEMESSAGE_VIDEO_KEY, "base64url");
  crmKey = Buffer.from(config.JESSIEMESSAGE_CRM_KEY, "base64url");
  const videoRoot = config.JESSIEMESSAGE_VIDEO_ROOT;
  assert(media.enabled === true && videoKey.length === 32 && crmKey.length === 32);
  phase = "roots";
  await assertDistinctVideoRoots(media.root, videoRoot);
  report.photoParentPrivate = await privateParent(media.root);
  report.videoParentPrivate = await privateParent(videoRoot);
  const photoStorage = await createMediaStorage({ root: media.root, key: media.key, pathMode: "linux-dirfd" });
  const videoStorage = await createVideoStorage({ root: videoRoot, key: videoKey, pathMode: "linux-dirfd" });
  const storage = [photoStorage, videoStorage];
  const roots = [
    { kind: "media", path: media.root, key: media.key, stats: await lstat(media.root, { bigint: true }) },
    { kind: "video", path: videoRoot, key: videoKey, stats: await lstat(videoRoot, { bigint: true }) },
  ];
  const raw = await Promise.all(storage.map(item => item.fingerprint()));
  phase = "catalogue";
  pool = await createRuntimePool(config);
  const database = config.JESSIEMESSAGE_DB_NAME;
  const data = await catalogue(pool, database), sqlSignature = digest(data);
  const photoCapacity = validateCapacity(data.media, media.capacity.ownerBytes, media.capacity.totalBytes);
  const videoCapacity = validateCapacity(data.video, config.JESSIEMESSAGE_VIDEO_OWNER_BYTES, config.JESSIEMESSAGE_VIDEO_TOTAL_BYTES);
  report.photoHeldBytes = photoCapacity.heldBytes;
  report.videoHeldBytes = videoCapacity.heldBytes;
  phase = "inventory_budget";
  assert(photoCapacity.heldBytes + videoCapacity.heldBytes <= maxBytes);
  phase = "prior_binding";
  assert(!raw[0].equals(data.media.root_fingerprint) && !raw[1].equals(data.video.root_fingerprint));
  const priorDevice = previousDevice(roots, [data.media, data.video]);
  report.priorBindingVerified = true;
  report.photo = { catalogued: data.photos.length, objects: data.objects.length,
    reserved: data.objects.filter(row => row.state === "reserved").length,
    cleanupPending: data.objects.filter(row => row.state === "cleanup_pending").length };
  report.video = { catalogued: data.videos.length, reserved: data.videos.filter(row => row.state === "reserved").length,
    cleanupPending: data.videos.filter(row => row.state === "cleanup_pending").length };
  const binding = { database, rootFingerprint: photoCapacity.rootFingerprint, videoRootFingerprint: videoCapacity.rootFingerprint };
  phase = "closure_journals";
  const initialJournals = await journals(binding, crmKey);
  report.closures = initialJournals.counts;
  phase = "pending_operations";
  assert(report.photo.reserved === 0 && report.photo.cleanupPending === 0 && report.video.reserved === 0
    && report.video.cleanupPending === 0 && report.closures.pending === 0);
  phase = "filesystem_snapshot";
  const beforeFiles = await Promise.all(roots.map(root => fileSignature(root.path)));
  phase = "photo_inventory";
  report.photo.authenticated = await verifyPhotos(data, photoStorage, photoCapacity);
  phase = "video_inventory";
  const assets = data.videos.map(row => ({
    id: hex(row.id, 16), owner_id: hex(row.owner_id, 16), owner_role: row.owner_role, storage_key: hex(row.storage_key, 32),
    reserve_token_hash: hex(row.reserve_token_hash, 32), content_digest: row.content_digest === null ? null : hex(row.content_digest, 32),
    bytes: integer(row.bytes), stored_bytes: integer(row.stored_bytes), mime: row.mime, state: row.state,
    created_at: row.created_at, updated_at: row.updated_at, released_at: row.released_at,
  }));
  const video = await inspectVideoBackupInventory({ video: { capacity: videoCapacity, assets }, storage: videoStorage,
    expectedRootFingerprint: hex(raw[1], 32), signal: deadline, limits: { maxObjects: maxRows, maxEntries: maxFiles, maxIssues: 3 } });
  assert(video.complete && video.healthy && video.counts.authenticated === assets.filter(asset => asset.state === "committed").length);
  report.video.authenticated = video.counts.authenticated;
  phase = "stability";
  const afterJournals = await journals(binding, crmKey);
  const afterFiles = await Promise.all(roots.map(root => fileSignature(root.path)));
  assert(afterJournals.signature === initialJournals.signature && afterFiles.every((value, index) => value === beforeFiles[index])
    && digest(await catalogue(pool, database)) === sqlSignature);
  for (const [index, root] of roots.entries()) {
    const stat = await lstat(root.path, { bigint: true });
    assert(stat.dev === root.stats.dev && stat.ino === root.stats.ino && (await storage[index].fingerprint()).equals(raw[index]));
  }
  report.inventoryVerified = true;
  phase = "candidate_pin";
  const candidate = await candidateComponents();
  const candidateStorage = await Promise.all(roots.map((root, index) =>
    candidate.factories[index]({ root: root.path, key: root.key, pathMode: "linux-dirfd" })));
  const expected = [data.media.root_fingerprint, data.video.root_fingerprint];

  async function recheck() {
    deadline.throwIfAborted();
    let current;
    try {
      current = await loadRuntimeVideoEnvironment(privatePath + "/runtime-video-180", { ...VIDEO_RUNTIME_OPTIONS, port: "3000" });
      assert(digest(current) === originalConfiguration);
    } finally { clearRuntimeMessagingSecrets(current); }
    assert(digest(await catalogue(pool, database)) === sqlSignature
      && (await journals(binding, crmKey)).signature === initialJournals.signature);
    for (const [index, root] of roots.entries()) {
      assert(await fileSignature(root.path) === beforeFiles[index] && (await storage[index].fingerprint()).equals(raw[index]));
      await access(dirname(root.path), constants.W_OK);
    }
  }

  phase = "prevalidate_both_markers";
  await recheck();
  report.markersPresentBefore = await prevalidateMarkers(candidateStorage, raw, expected);
  for (const [index, root] of roots.entries()) {
    phase = index === 0 ? "photo_marker" : "video_marker";
    await pinnedCheckout(candidateCheckout, candidateSource, candidateTree, "1.16.0", gitFiles);
    await recheck();
    await prevalidateMarkers(candidateStorage, raw, expected);
    const before = await candidateStorage[index].fingerprint();
    if (before.equals(raw[index])) report.markerWriteAttempts++;
    await candidate.provisionStorageRootBinding({
      kind: root.kind, root: root.path, key: root.key, previousDevice: priorDevice,
      currentDevice: String(root.stats.dev), inode: String(root.stats.ino), expectedFingerprint: expected[index],
    });
    assert((await candidateStorage[index].fingerprint()).equals(expected[index]));
    report.markersConfirmed++;
  }
  phase = "final_verification";
  await recheck();
  assert(await prevalidateMarkers(candidateStorage, raw, expected) === 2);
  phase = "close";
  await pool.end(); pool = undefined;
  report.status = "storage_bindings_installed";
} catch {
  report.phase = phase;
  process.exitCode = 1;
} finally {
  try { await pool?.end(); } catch { process.exitCode = 1; }
  media?.key?.fill(0);
  videoKey?.fill(0);
  crmKey?.fill(0);
  clearRuntimeMessagingSecrets(config);
  console.log(JSON.stringify(report));
}
