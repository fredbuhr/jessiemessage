import test from "node:test";
import assert from "node:assert/strict";
import { chmod, link, lstat, readFile, symlink, unlink } from "node:fs/promises";
import path from "node:path";
import { videoBundle } from "./fixtures/video-private.mjs";
import { PRIMARY, key, fixture, names, supportedFiles } from "./fixtures/crm-private.mjs";
import { validateRuntimeVideoConfiguration, validateRuntimeVideoBundle, readRuntimeVideoBundle,
  writeRuntimeVideoConfiguration, readRuntimeVideoConfiguration, readRuntimeCrmBundle } from "../server/config/runtime-database-file.mjs";
import { loadRuntimeVideoEnvironment, copyRuntimeVideoEnvironment, VIDEO_RUNTIME_OPTIONS, VIDEO_ENV_FIELDS } from "../server/config/runtime-video.mjs";
import { copyRuntimeBroadcastEnvironment } from "../server/config/runtime-broadcast.mjs";
import { clearRuntimeMessagingSecrets } from "../server/config/runtime-messaging.mjs";

const load = source => loadRuntimeVideoEnvironment("/private/synthetic-video", VIDEO_RUNTIME_OPTIONS, { readBundle: async () => source });
test("the explicit video environment binds a seventh record and independent key without changing six-record profiles", async () => {
  const source = videoBundle(), original = structuredClone(source); let reads = 0;
  const env = await loadRuntimeVideoEnvironment("/private/synthetic-video", { ...VIDEO_RUNTIME_OPTIONS, port: "4321" }, {
    readBundle: async (_directory, options) => { reads++; assert.deepEqual(options, PRIMARY); return source; } });
  assert.equal(reads, 1); assert.deepEqual(source, original);
  assert.deepEqual(Object.keys(env).sort(), [...VIDEO_ENV_FIELDS].sort());
  assert.equal(env.PORT, "4321"); assert.equal(env.JESSIEMESSAGE_VIDEO_KEY, key(7));
  assert.equal(env.JESSIEMESSAGE_ENABLE_BROADCAST, "1"); assert.equal(env.JESSIEMESSAGE_ENABLE_CRM, "1");
  assert.equal(Object.hasOwn(env, "JESSIEMESSAGE_ENABLE_VIDEO"), false);
  assert.deepEqual(copyRuntimeVideoEnvironment(env, VIDEO_RUNTIME_OPTIONS), env);
  assert.throws(() => copyRuntimeBroadcastEnvironment(env, VIDEO_RUNTIME_OPTIONS));
  const cleared = { ...env, videoKey: key(7) }; clearRuntimeMessagingSecrets(cleared);
  assert.equal(cleared.JESSIEMESSAGE_VIDEO_KEY, ""); assert.equal(cleared.videoKey, "");
  assert.equal(env.JESSIEMESSAGE_VIDEO_KEY, key(7));
});

test("video configuration rejects root overlaps, noncanonical keys, wrong origin, malformed bounds and reused private keys", async () => {
  const original = videoBundle();
  assert.deepEqual(validateRuntimeVideoBundle(original, PRIMARY), original);
  for (const mutation of [
    b => { delete b.video; }, b => { b.video.format += "-extra"; }, b => { b.video.version = 2; },
    b => { b.video.origin = "https://recette.jessiemessage.com"; }, b => { b.video.videoKey = "B".repeat(43); },
    b => { b.video.videoRoot = b.media.mediaRoot; }, b => { b.video.videoRoot = path.join(b.media.mediaRoot, "child"); },
    b => { b.video.videoRoot = path.dirname(b.media.mediaRoot); }, b => { b.video.videoRoot = path.resolve("public"); },
    b => { b.video.minimumFreeBytes = "-1"; }, b => { b.video.ownerBytes = "64"; },
    b => { b.video.ownerBytes = "00100"; }, b => { b.video.totalBytes = "65"; },
    b => { b.video.extra = true; }, b => { b.extra = {}; }
  ]) {
    const source = structuredClone(original); mutation(source); const before = structuredClone(source);
    await assert.rejects(load(source), { code: "RUNTIME_VIDEO_ENVIRONMENT" }); assert.deepEqual(source, before);
  }
  for (const reused of [original.authentication.mfaKey, original.messaging.mailKey, original.messaging.messageKey,
    original.media.mediaKey, original.notifications.notificationKey, original.notifications.vapidPrivateKey, original.crm.crmKey]) {
    const source = structuredClone(original); source.video.videoKey = reused;
    await assert.rejects(load(source), { code: "RUNTIME_VIDEO_ENVIRONMENT" });
  }
  assert.throws(() => validateRuntimeVideoConfiguration(original.video), { code: "RUNTIME_VIDEO_CONFIGURATION" });
});

test("video configuration never invokes input getters and rejects inherited or extra capabilities", async () => {
  let invoked = 0; const source = videoBundle(), getter = { ...source };
  Object.defineProperty(getter, "video", { get() { invoked++; return source.video; } });
  await assert.rejects(load(getter), { code: "RUNTIME_VIDEO_ENVIRONMENT" });
  const env = await load(source), accessor = { ...env };
  Object.defineProperty(accessor, "JESSIEMESSAGE_VIDEO_KEY", { get() { invoked++; return key(7); } });
  assert.throws(() => copyRuntimeVideoEnvironment(accessor, VIDEO_RUNTIME_OPTIONS));
  for (const options of [{}, { originProfile: "primary" }, { originProfile: "preproduction", recovery: true },
    { ...VIDEO_RUNTIME_OPTIONS, extra: true }, Object.create(VIDEO_RUNTIME_OPTIONS)]) {
    await assert.rejects(loadRuntimeVideoEnvironment("/private/synthetic-video", options, { readBundle: () => assert.fail("Invalid options cannot read files") }));
  }
  assert.equal(invoked, 0);
});

test("Linux CI must run real anchored seventh-record publication", { skip: !process.env.CI || process.platform !== "linux" }, () => assert.equal(supportedFiles, true));
test("video publication is exclusive owner0600 and does not change any existing private file", { skip: !supportedFiles }, async t => {
  const f = await fixture(t), before = await Promise.all(names.map(name => readFile(path.join(f.directory, name))));
  const video = videoBundle(f.records.media.mediaRoot, path.join(f.root, "videos")).video;
  await assert.rejects(readRuntimeVideoBundle(f.directory, PRIMARY), { code: "RUNTIME_VIDEO_CONFIGURATION" });
  await writeRuntimeVideoConfiguration(f.directory, video, PRIMARY);
  const stat = await lstat(path.join(f.directory, "runtime-video.json"));
  assert.equal(stat.mode & 0o7777, 0o600); assert.equal(stat.nlink, 1); assert.equal(stat.uid, process.getuid());
  assert.deepEqual(await readRuntimeVideoBundle(f.directory, PRIMARY), { ...f.records, video });
  assert.deepEqual(await readRuntimeCrmBundle(f.directory, PRIMARY), f.records);
  assert.deepEqual(await Promise.all(names.map(name => readFile(path.join(f.directory, name)))), before);
  assert.equal((await loadRuntimeVideoEnvironment(f.directory, VIDEO_RUNTIME_OPTIONS)).JESSIEMESSAGE_VIDEO_KEY, video.videoKey);
  await assert.rejects(writeRuntimeVideoConfiguration(f.directory, { ...video, videoKey: key(8) }, PRIMARY), { code: "RUNTIME_VIDEO_CONFIGURATION" });
});
test("video anchored reads reject loose modes, hardlinks and symlinks", { skip: !supportedFiles }, async t => {
  const f = await fixture(t), video = videoBundle(f.records.media.mediaRoot, path.join(f.root, "videos")).video;
  await writeRuntimeVideoConfiguration(f.directory, video, PRIMARY);
  const filename = path.join(f.directory, "runtime-video.json"), alias = path.join(f.directory, "alias");
  await chmod(filename, 0o640); await assert.rejects(readRuntimeVideoConfiguration(f.directory, PRIMARY));
  await chmod(filename, 0o600); await link(filename, alias); await assert.rejects(readRuntimeVideoBundle(f.directory, PRIMARY));
  await unlink(alias); await unlink(filename); await symlink(names[0], filename);
  await assert.rejects(readRuntimeVideoBundle(f.directory, PRIMARY));
});
