import test from "node:test";
import assert from "node:assert/strict";
import { createCipheriv, createHash, hkdfSync } from "node:crypto";
import { lstat, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createErasureJournal, readErasureJournalBatch, verifyErasureJournalEnvelope } from "../server/data/erasure-journal.mjs";
import { erasureBinding, erasureRecord, erasureTransition } from "../server/data/erasure-state.mjs";
import { erasureDirectory, withErasureDirectory } from "./fixtures/erasure-files.mjs";

const key = Buffer.alloc(32, 0x71), clientId = "a".repeat(32), at = 1792350000000;
const photoBinding = { database: "synthetic_video_closure", rootFingerprint: "b".repeat(64) };
const videoBinding = { ...photoBinding, videoRootFingerprint: "c".repeat(64) };
const record = (binding = videoBinding, version = 2) => ({ version, clientId, binding, phase: "requested", cursor: null, startedAt: at, updatedAt: at });
const allow = async () => {};
const internal = { withDirectory: withErasureDirectory };

async function fixture(t, binding = videoBinding) {
  const directory = await erasureDirectory(t), options = { directory, key, clientId, binding };
  const journal = createErasureJournal(options, internal); t.after(() => journal.close());
  return { directory, options, journal, async filename() {
    const files = (await readdir(directory)).filter(name => name.endsWith(".json"));
    assert.equal(files.length, 1); return path.join(directory, files[0]);
  } };
}

test("candidate erasure records couple version two to both roots and typed cursors", () => {
  assert.deepEqual(erasureBinding(videoBinding), videoBinding);
  assert.deepEqual(erasureRecord(record()), record());
  assert.deepEqual(erasureRecord(record(photoBinding, 1)), record(photoBinding, 1));
  const prepared = { ...record(), phase: "prepared", updatedAt: at + 1 };
  for (const cursor of [null, `p:${"1".repeat(32)}`, `v:${"f".repeat(32)}`]) {
    assert.equal(erasureRecord({ ...prepared, cursor }).cursor, cursor);
  }
  const invalid = [record(videoBinding, 1), record(photoBinding, 2),
    { ...record(), cursor: `v:${"1".repeat(32)}` },
    ...["1".repeat(32), "p:", `p:${"1".repeat(31)}`, `v:${"A".repeat(32)}`, `x:${"1".repeat(32)}`]
      .map(cursor => ({ ...prepared, cursor })),
    { ...record(), binding: { ...videoBinding, videoRootFingerprint: "d".repeat(63) } },
    { ...record(), binding: { ...videoBinding, extra: true } },
    { ...record(), binding: { ...photoBinding, videoRootFingerprint: undefined } },
  ];
  for (const value of invalid) assert.throws(() => erasureRecord(value));
  assert.throws(() => erasureBinding({ ...videoBinding, videoRootFingerprint: "C".repeat(64) }));
});

test("typed closure progress advances photos before videos without crossing journal versions", () => {
  const requested = record(), prepared = { ...requested, phase: "prepared", updatedAt: at + 1 };
  assert.deepEqual(erasureTransition(null, requested), requested);
  assert.deepEqual(erasureTransition(requested, prepared), prepared);
  const photo = { ...prepared, cursor: `p:${"f".repeat(32)}` };
  const video = { ...prepared, cursor: `v:${"0".repeat(32)}` };
  assert.deepEqual(erasureTransition(prepared, photo), photo);
  assert.deepEqual(erasureTransition(photo, video), video);
  assert.throws(() => erasureTransition(video, photo), { code: "ERASURE_CHANGED" });
  assert.throws(() => erasureTransition(video, { ...video, cursor: null }), { code: "ERASURE_CHANGED" });
  const later = { ...video, cursor: `v:${"2".repeat(32)}` };
  assert.deepEqual(erasureTransition(video, later), later);
  assert.throws(() => erasureTransition(later, { ...video, cursor: `v:${"1".repeat(32)}` }), { code: "ERASURE_CHANGED" });
  const legacy = record(photoBinding, 1);
  assert.throws(() => erasureTransition(legacy, prepared));
  assert.throws(() => erasureTransition(requested, { ...legacy, phase: "prepared", updatedAt: at + 1 }));
  const changedRoot = { ...prepared, binding: { ...videoBinding, videoRootFingerprint: "d".repeat(64) } };
  assert.throws(() => erasureTransition(requested, changedRoot), { code: "ERASURE_CHANGED" });
});

test("a private candidate journal survives reopening and authenticates the photo and video roots", async t => {
  const f = await fixture(t), requested = record();
  assert.deepEqual(await f.journal.read(), { revision: 0, record: null });
  await f.journal.save(requested, 0, allow);
  const prepared = { ...requested, phase: "prepared", updatedAt: at + 1 };
  await f.journal.save(prepared, 1, allow);
  const photo = { ...prepared, cursor: `p:${"f".repeat(32)}` };
  await f.journal.save(photo, 2, allow);
  const video = { ...prepared, cursor: `v:${"1".repeat(32)}`, updatedAt: at + 2 };
  const saved = await f.journal.save(video, 3, allow);
  assert.deepEqual(saved, { revision: 4, record: video });
  const filename = await f.filename(), content = await readFile(filename), envelope = JSON.parse(content);
  assert.equal(envelope.version, 2); assert.equal((await lstat(filename)).mode & 0o7777, 0o600);
  for (const plaintext of [clientId, videoBinding.database, videoBinding.rootFingerprint, videoBinding.videoRootFingerprint, video.cursor]) {
    assert.equal(content.includes(Buffer.from(plaintext)), false);
  }
  assert.equal(path.basename(filename).includes(clientId), false);
  assert.deepEqual(verifyErasureJournalEnvelope({ key, binding: videoBinding, filename: path.basename(filename), content }), saved);
  const reopened = createErasureJournal(f.options, internal); t.after(() => reopened.close());
  assert.deepEqual(await reopened.read(), saved);
  const before = await readFile(filename);
  await assert.rejects(reopened.save({ ...video, cursor: photo.cursor }, 4, allow));
  assert.deepEqual(await readFile(filename), before);
});

test("candidate journal discovery resumes bounded pages without an in-memory client index", async t => {
  const f = await fixture(t), clients = ["a", "d", "e"].map(value => value.repeat(32));
  for (const current of clients) {
    const journal = createErasureJournal({ ...f.options, clientId: current }, internal);
    try { await journal.save({ ...record(), clientId: current }, 0, allow); } finally { journal.close(); }
  }
  const first = await readErasureJournalBatch({ directory: f.directory, key, binding: videoBinding, limit: 2 }, internal);
  assert.equal(first.jobs.length, 2); assert.ok(first.nextCursor);
  const second = await readErasureJournalBatch({ directory: f.directory, key, binding: videoBinding, limit: 2, afterName: first.nextCursor }, internal);
  assert.equal(second.jobs.length, 1); assert.equal(second.nextCursor, null);
  assert.deepEqual([...first.jobs, ...second.jobs].map(value => value.clientId).sort(), clients);
  for (const job of [...first.jobs, ...second.jobs]) {
    assert.equal(job.phase, "requested"); assert.equal(job.revision, 1); assert.equal(job.updatedAt, at);
  }
  await assert.rejects(readErasureJournalBatch({ directory: f.directory, key, binding: photoBinding }, internal));
  await assert.rejects(readErasureJournalBatch({ directory: f.directory, key, binding: { ...videoBinding, videoRootFingerprint: "d".repeat(64) } }, internal));
});

test("candidate ciphertext cannot be rebound, downgraded or substituted with a legacy envelope", async t => {
  const f = await fixture(t); await f.journal.save(record(), 0, allow);
  const filename = await f.filename(), content = await readFile(filename), name = path.basename(filename);
  for (const binding of [photoBinding, { ...videoBinding, database: "other_database" },
    { ...videoBinding, rootFingerprint: "d".repeat(64) }, { ...videoBinding, videoRootFingerprint: "d".repeat(64) }]) {
    assert.throws(() => verifyErasureJournalEnvelope({ key, binding, filename: name, content }));
  }
  const downgraded = JSON.parse(content); downgraded.version = 1;
  await writeFile(filename, JSON.stringify(downgraded) + "\n", { mode: 0o600 });
  await assert.rejects(f.journal.read()); await assert.rejects(f.journal.save({ ...record(), phase: "prepared", updatedAt: at + 1 }, 1, allow));
  assert.deepEqual(await readFile(filename), Buffer.from(JSON.stringify(downgraded) + "\n"));
  const legacy = legacyEnvelope(); await writeFile(filename, legacy.content, { mode: 0o600 });
  await assert.rejects(f.journal.read());
  await assert.rejects(f.journal.save(record(), 1, allow));
  assert.deepEqual(await readFile(filename), legacy.content);
});

// Deterministic historical envelope, authored independently of journal creation.
// Keeping this v1 namespace and wire shape proves that opt-in video support
// does not silently rewrite or rebind already encrypted closure receipts.
function legacyEnvelope() {
  const namespace = "jessiemessage:account-erasure:https://jessiemessage.com:v1", value = record(photoBinding, 1);
  const name = `erasure-${createHash("sha256").update(`${namespace}:${JSON.stringify(photoBinding)}:${clientId}`).digest("hex")}`;
  const derived = Buffer.from(hkdfSync("sha256", key, Buffer.alloc(0), Buffer.from(namespace), 32));
  try {
    const iv = Buffer.alloc(12, 0x39), cipher = createCipheriv("aes-256-gcm", derived, iv);
    cipher.setAAD(Buffer.from(`${namespace}:${JSON.stringify(photoBinding)}:${name}:1`));
    const ciphertext = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(value))), cipher.final()]);
    const state = { version: 1, revision: 1, envelope: { iv: iv.toString("base64url"), ciphertext: ciphertext.toString("base64url"), tag: cipher.getAuthTag().toString("base64url") } };
    return { filename: `${name}.json`, content: Buffer.from(JSON.stringify(state) + "\n"), record: value };
  } finally { derived.fill(0); }
}

test("the historical version-one envelope remains valid and is never interpreted as a video receipt", () => {
  const fixture = legacyEnvelope();
  assert.deepEqual(verifyErasureJournalEnvelope({ key, binding: photoBinding, filename: fixture.filename, content: fixture.content }), { revision: 1, record: fixture.record });
  assert.throws(() => verifyErasureJournalEnvelope({ key, binding: videoBinding, filename: fixture.filename, content: fixture.content }));
});
