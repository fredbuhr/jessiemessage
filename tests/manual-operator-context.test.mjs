import test from "node:test";
import assert from "node:assert/strict";
import { createECDH, createHash } from "node:crypto";
import { chmod, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadManualOperatorContext, ManualOperatorContextError } from "../server/backup/manual-operator-context.mjs";
import { createErasureJournal } from "../server/data/erasure-journal.mjs";
import { captureOperationalState, operationalStateHash } from "../server/backup/operational-checkpoint.mjs";
import { erasureDirectory, withErasureDirectory } from "./fixtures/erasure-files.mjs";

const hash = value => createHash("sha256").update(value).digest("hex");
const keyFields = { totpKey: "JESSIEMESSAGE_MFA_KEY", mailKey: "JESSIEMESSAGE_MAIL_KEY", messageKey: "JESSIEMESSAGE_MESSAGE_KEY",
  mediaKey: "JESSIEMESSAGE_MEDIA_KEY", crmKey: "JESSIEMESSAGE_CRM_KEY", notificationKey: "JESSIEMESSAGE_NOTIFICATIONS_KEY" };
const secretFields = [...Object.values(keyFields), "JESSIEMESSAGE_RUNTIME_DB_PASSWORD", "JESSIEMESSAGE_SMTP_USER",
  "JESSIEMESSAGE_SMTP_PASSWORD", "JESSIEMESSAGE_VAPID_PRIVATE_KEY"];
const environment = { JESSIEMESSAGE_PRIVATE_PATH_MODE: "linux-dirfd" };
const clientId = "a".repeat(32), at = Date.parse("2026-10-19T20:00:00Z");
function transientCopiesCleared(fixture, context) {
  for (const copy of fixture.loaded.filter(value => value !== context.sourceEnvironment && value !== context.targetEnvironment))
    for (const name of secretFields) assert.equal(copy[name], "", `Temporary ${name} is cleared before the guard returns`);
}

async function tree(directory) {
  const result = [];
  async function visit(current, prefix = "") {
    for (const entry of (await readdir(current, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, "en"))) {
      const name = `${prefix}${entry.name}`, full = path.join(current, entry.name);
      if (entry.isDirectory()) { result.push([name, "directory"]); await visit(full, `${name}/`); }
      else result.push([name, hash(await readFile(full))]);
    }
  }
  await visit(directory); return result;
}

async function fixture(t) {
  const root = await erasureDirectory(t), operatorDirectory = path.join(root, "operator"), sourceMedia = path.join(root, "source-media");
  const locations = Object.fromEntries(["runtime", "source-private", "source-operations", "checkpoint", "target-private"]
    .map(name => [name, path.join(root, name)]));
  for (const directory of [operatorDirectory, sourceMedia, ...Object.values(locations)]) await mkdir(directory, { mode: 0o700 });
  const paths = { targetDirectory: path.join(operatorDirectory, "target"), rootPath: path.join(operatorDirectory, "target/media"),
    journalDirectory: path.join(operatorDirectory, "target/operations"), progressDirectory: path.join(operatorDirectory, "target/progress"),
    quarantineDirectory: path.join(operatorDirectory, "target/quarantine") };
  const keys = Object.fromEntries(Object.keys(keyFields).map((name, index) => [name, Buffer.alloc(32, index + 1)]));
  const curve = createECDH("prime256v1"); curve.setPrivateKey(Buffer.alloc(32, 7));
  function config(database, mediaRoot, user) {
    return { PORT: "3000", JESSIEMESSAGE_DB_HOST: "sql.synthetic.invalid", JESSIEMESSAGE_DB_PORT: "3306", JESSIEMESSAGE_DB_NAME: database,
      JESSIEMESSAGE_APPLICATION_DATABASE: database, JESSIEMESSAGE_RUNTIME_DB_USER: user, JESSIEMESSAGE_RUNTIME_DB_PASSWORD: `synthetic-${user}-password`,
      JESSIEMESSAGE_PRIVATE_PATH_MODE: "linux-dirfd", JESSIEMESSAGE_SITE_ORIGIN: "https://jessiemessage.com", JESSIEMESSAGE_MEDIA_ROOT: mediaRoot,
      JESSIEMESSAGE_MEDIA_ACCOUNT_BYTES: "1048576", JESSIEMESSAGE_MEDIA_TOTAL_BYTES: "104857600", JESSIEMESSAGE_MEDIA_MIN_FREE_BYTES: "0",
      ...Object.fromEntries(Object.keys(keyFields).map(name => [keyFields[name], keys[name].toString("base64url")])),
      ...Object.fromEntries(["AUTH", "ACCESS", "CHAT", "MEDIA", "CRM", "CLIENT_RECOVERY", "BROADCAST", "MAIL_DELIVERY", "NOTIFICATIONS"]
        .map(name => [`JESSIEMESSAGE_ENABLE_${name}`, "1"])),
      JESSIEMESSAGE_SMTP_HOST: "smtp.synthetic.invalid", JESSIEMESSAGE_SMTP_PORT: "587", JESSIEMESSAGE_SMTP_USER: "synthetic-smtp-user",
      JESSIEMESSAGE_SMTP_PASSWORD: "synthetic-smtp-password", JESSIEMESSAGE_SMTP_FROM: "contact@jessiemessage.com",
      JESSIEMESSAGE_VAPID_PUBLIC_KEY: curve.getPublicKey().toString("base64url"), JESSIEMESSAGE_VAPID_PRIVATE_KEY: curve.getPrivateKey().toString("base64url"),
      JESSIEMESSAGE_VAPID_SUBJECT: "mailto:contact@jessiemessage.com" };
  }
  const source = config("synthetic_source", sourceMedia, "synthetic_source_runtime"), target = config("synthetic_restore", paths.rootPath, "synthetic_restore_runtime");
  const state = { fingerprint: Buffer.alloc(32, 9), sourceChanged: false }, loaded = [], sourceChecks = [], storageCalls = [];
  const sourceBinding = { database: source.JESSIEMESSAGE_DB_NAME, rootFingerprint: state.fingerprint.toString("hex") };
  async function advance(phase) {
    const journal = createErasureJournal({ directory: locations["source-operations"], key: keys.crmKey, binding: sourceBinding, clientId }, { withDirectory: withErasureDirectory });
    try {
      const current = await journal.read();
      await journal.save(current.record ? { ...current.record, phase, updatedAt: at + current.revision }
        : { version: 1, clientId, binding: sourceBinding, phase, cursor: null, startedAt: at, updatedAt: at }, current.revision, async () => {});
    } finally { journal.close(); }
  }
  await advance("requested");
  const registry = () => withErasureDirectory(locations["source-operations"], scope => captureOperationalState(scope, { key: keys.crmKey, binding: sourceBinding }));
  const recentRegistry = await registry();
  const job = { version: 1, runtimeDirectory: locations.runtime, runtimeHead: "b".repeat(40), runtimeTree: "c".repeat(40),
    sourcePrivateDirectory: locations["source-private"], sourceOperationsDirectory: locations["source-operations"], checkpointDirectory: locations.checkpoint,
    targetPrivateDirectory: locations["target-private"], targetDatabase: target.JESSIEMESSAGE_DB_NAME, importUser: "synthetic_restore_import",
    sqlSha256: "d".repeat(64), registrySha256: operationalStateHash(recentRegistry) };
  const jobFile = path.join(operatorDirectory, "job.json");
  const writeJob = async (value = job, text = `${JSON.stringify(value)}\n`) => writeFile(jobFile, text, { mode: 0o600 });
  await writeJob();
  const internal = {
    withDirectory: withErasureDirectory,
    async loadEnvironment(directory, parameters) {
      assert.equal(parameters.originProfile, "primary"); assert.equal(parameters.recovery, true);
      const original = directory === job.sourcePrivateDirectory ? source : directory === job.targetPrivateDirectory ? target : null;
      assert.ok(original, "Only the selected source and target configurations are read");
      const copy = { ...original }; loaded.push(copy); return copy;
    },
    async makeStorage({ root: rootPath, key, pathMode }) {
      assert.equal(rootPath, sourceMedia); assert.deepEqual(key, keys.mediaKey); assert.equal(pathMode, "linux-dirfd");
      storageCalls.push(rootPath); return { async fingerprint() { return Buffer.from(state.fingerprint); } };
    },
    async assertSource(selected) {
      assert.deepEqual(selected, { runtimeDirectory: job.runtimeDirectory, runtimeHead: job.runtimeHead, runtimeTree: job.runtimeTree });
      sourceChecks.push(selected); if (state.sourceChanged) throw new Error("Synthetic reviewed checkout changed");
    },
  };
  const load = (options = {}, overrides = {}) => loadManualOperatorContext(operatorDirectory, { environment, ...options }, { ...internal, ...overrides });
  const cleared = () => { for (const copy of loaded) for (const name of secretFields) assert.equal(copy[name], "", `Owned ${name} is cleared`); };
  return { root, operatorDirectory, sourceMedia, locations, paths, keys, source, target, sourceBinding, recentRegistry, job, jobFile,
    state, loaded, sourceChecks, storageCalls, writeJob, advance, registry, load, cleared };
}

test("manual operator context reads a real private job and encrypted current registry without creating a target or contacting SQL", async t => {
  const f = await fixture(t), before = await tree(f.root), sourceBefore = { ...f.source }, targetBefore = { ...f.target };
  const context = await f.load();
  try {
    assert.deepEqual(context.job, f.job); assert.match(context.jobSha256, /^[a-f0-9]{64}$/); assert.deepEqual(context.paths, f.paths);
    assert.deepEqual(context.sourceBinding, f.sourceBinding); assert.deepEqual(context.recentRegistry, f.recentRegistry);
    assert.deepEqual(context.importSelection, { command: "check", privateDirectory: f.job.sourcePrivateDirectory, privatePathMode: "linux-dirfd",
      checkpointDirectory: f.job.checkpointDirectory, database: f.job.targetDatabase, confirmation: f.job.targetDatabase,
      user: f.job.importUser, profile: "photos-notify-recovery-crm-broadcast", sqlSha256: f.job.sqlSha256 });
    assert.deepEqual(context.sourceEnvironment, f.source); assert.deepEqual(context.targetEnvironment, f.target);
    for (const name of Object.keys(keyFields)) { assert.deepEqual(context.keys[name], f.keys[name]); assert.notEqual(context.keys[name], f.keys[name]); }
    await context.assertReady(); transientCopiesCleared(f, context); assert.ok(f.sourceChecks.length >= 2); assert.ok(f.storageCalls.length >= 1);
    assert.deepEqual(await tree(f.root), before, "Loading and rechecking create no target, lock or progress file");
  } finally { context.close(); }
  f.cleared(); for (const key of Object.values(context.keys)) assert.ok(key.every(value => value === 0));
  assert.deepEqual(f.source, sourceBefore); assert.deepEqual(f.target, targetBefore);
  await assert.rejects(context.assertReady(), { code: "MANUAL_OPERATOR_CONTEXT_ABORTED" }); context.close();
});

test("manual jobs reject malformed canonical data, unsafe file permissions and overlapping selections before configuration loading", async t => {
  for (const [name, change] of [
    ["unknown member", async f => f.writeJob({ ...f.job, extra: true })],
    ["missing reviewed commit", async f => { const { runtimeHead: _head, ...job } = f.job; await f.writeJob(job); }],
    ["noncanonical JSON", async f => f.writeJob(f.job, JSON.stringify(f.job))],
    ["corrupted JSON", async f => f.writeJob(f.job, '{"secret":"synthetic-corrupted-private-job"')],
    ["public job", async f => chmod(f.jobFile, 0o644)],
    ["source and target configuration overlap", async f => f.writeJob({ ...f.job, targetPrivateDirectory: f.job.sourcePrivateDirectory })],
  ]) await t.test(name, async step => {
    const f = await fixture(step); await change(f);
    await assert.rejects(f.load(), error => {
      assert.ok(error instanceof ManualOperatorContextError); assert.equal(error.cause, undefined); assert.equal(error.message.includes("synthetic"), false);
      assert.equal(error.code, ["public job", "corrupted JSON"].includes(name) ? "MANUAL_OPERATOR_CONTEXT_UNAVAILABLE" : "MANUAL_OPERATOR_CONTEXT_INPUT"); return true;
    });
    assert.equal(f.loaded.length, 0); assert.deepEqual(await readdir(f.operatorDirectory), ["job.json"]);
  });
});

test("source and target configuration must select distinct databases, the derived media root, matching keys and a separate import identity", async t => {
  for (const [name, change] of [
    ["database alias", f => { f.target.JESSIEMESSAGE_DB_NAME = f.source.JESSIEMESSAGE_DB_NAME.toUpperCase(); f.target.JESSIEMESSAGE_APPLICATION_DATABASE = f.target.JESSIEMESSAGE_DB_NAME; }],
    ["unexpected target media", f => { f.target.JESSIEMESSAGE_MEDIA_ROOT = f.sourceMedia; }],
    ["different recovery key", f => { f.target.JESSIEMESSAGE_CRM_KEY = Buffer.alloc(32, 23).toString("base64url"); }],
    ["import identity equals source runtime", f => { f.source.JESSIEMESSAGE_RUNTIME_DB_USER = f.job.importUser; }],
  ]) await t.test(name, async step => {
    const f = await fixture(step); change(f); const before = await tree(f.root);
    await assert.rejects(f.load(), { code: "MANUAL_OPERATOR_CONTEXT_CONFIGURATION" }); f.cleared();
    assert.deepEqual(await tree(f.root), before);
  });
});

test("the operator must pin the authenticated current registry and unavailable configuration copies are cleared", async t => {
  const f = await fixture(t); await f.writeJob({ ...f.job, registrySha256: "0".repeat(64) });
  await assert.rejects(f.load(), { code: "MANUAL_OPERATOR_CONTEXT_REGISTRY" }); f.cleared();
  await f.writeJob(); let calls = 0;
  await assert.rejects(f.load({}, { async loadEnvironment(directory, parameters) {
    if (++calls === 2) throw new Error("Synthetic target configuration unavailable");
    assert.equal(directory, f.job.sourcePrivateDirectory); assert.equal(parameters.originProfile, "primary");
    const copy = { ...f.source }; f.loaded.push(copy); return copy;
  } }), { code: "MANUAL_OPERATOR_CONTEXT_UNAVAILABLE" }); f.cleared();
});

test("fresh guards reject job, configuration, registry, media-root or reviewed-source drift and retain no owned secrets", async t => {
  for (const [name, change] of [
    ["job", f => f.writeJob({ ...f.job, importUser: "synthetic_other_import" })],
    ["configuration", f => { f.source.JESSIEMESSAGE_SMTP_PASSWORD = "synthetic-new-smtp-password"; }],
    ["registry", f => f.advance("prepared")],
    ["media root", f => { f.state.fingerprint = Buffer.alloc(32, 10); }],
    ["reviewed source", f => { f.state.sourceChanged = true; }],
  ]) await t.test(name, async step => {
    const f = await fixture(step), context = await f.load();
    try {
      await change(f);
      await assert.rejects(context.assertReady(), { code: name === "reviewed source" ? "MANUAL_OPERATOR_CONTEXT_UNAVAILABLE" : "MANUAL_OPERATOR_CONTEXT_CHANGED" });
      transientCopiesCleared(f, context);
    } finally { context.close(); }
    f.cleared(); assert.deepEqual(await readdir(f.operatorDirectory), ["job.json"]);
  });
});

test("the review hash remains stable across contexts and changes when an admissible selected configuration changes", async t => {
  const f = await fixture(t), jobBefore = await readFile(f.jobFile), hashes = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt === 2) f.target.JESSIEMESSAGE_RUNTIME_DB_PASSWORD = "synthetic-rotated-target-password";
    const context = await f.load();
    try { hashes.push(context.jobSha256); await context.assertReady(); }
    finally { context.close(); }
  }
  assert.equal(hashes[0], hashes[1]); assert.notEqual(hashes[1], hashes[2]);
  assert.deepEqual(await readFile(f.jobFile), jobBefore); f.cleared();
  assert.deepEqual(await readdir(f.operatorDirectory), ["job.json"]);
});

test("cancellation rejects loading and a later guard without creating target state", async t => {
  const f = await fixture(t), cancellation = new AbortController(); cancellation.abort();
  await assert.rejects(f.load({ signal: cancellation.signal }), { code: "MANUAL_OPERATOR_CONTEXT_ABORTED" }); assert.equal(f.loaded.length, 0);
  const active = new AbortController(), context = await f.load({ signal: active.signal });
  try { active.abort(); await assert.rejects(context.assertReady(), { code: "MANUAL_OPERATOR_CONTEXT_ABORTED" }); }
  finally { context.close(); }
  f.cleared(); assert.deepEqual(await readdir(f.operatorDirectory), ["job.json"]);
});
