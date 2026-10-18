import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { emptyCopyState, validateCopyState } from "../server/backup/copy-state.mjs";
import { createBackupCopyService } from "../server/backup/copy-service.mjs";

const t0 = 1792340000000, location = "a".repeat(32), otherLocation = "b".repeat(32);
const archive = (startedAt, text) => ({ id: `capture-${startedAt}-${"c".repeat(16)}`, startedAt, bytes: Buffer.byteLength(text), sha256: createHash("sha256").update(text).digest("hex"), filename: `JessieMessage-capture-${startedAt}-${"c".repeat(16)}.tar.gz.gpg` });
const archives = [archive(t0 - 100000, "encrypted fixture older"), archive(t0 - 1000, "encrypted fixture latest")];
function fixture() {
  let stored = emptyCopyState(), now = t0, transfers = 0;
  const service = createBackupCopyService("/synthetic", { clock: () => now,
    read: async () => structuredClone(stored), save: async (state, revision) => { assert.equal(revision, stored.revision); stored = validateCopyState({ ...state, revision: revision + 1 }); },
    catalog: { async list() { return { version: 1, schedule: { enabled: true, hourUtc: 5, minuteUtc: 15 }, archives }; }, async transfer(id, consume) { transfers++; return consume(archives.find(item => item.id === id)); } },
  });
  return { service, state: () => structuredClone(stored), advance: milliseconds => { now += milliseconds; }, transfers: () => transfers };
}
async function connected(f) {
  const destination = await f.service.create({ label: "Mon PC", kind: "computer" }), kit = await f.service.preparePairing(destination.id);
  const paired = await f.service.pair({ destinationId: destination.id, pairingCode: kit.pairingCode });
  await f.service.manifest(paired.token, location);
  return { ...paired, kit, destination };
}
const receipt = (index = 1, generation = location) => ({ captureId: archives[index].id, bytes: archives[index].bytes, sha256: archives[index].sha256, locationId: generation });
test("pairing is single use, expires, stores only digests and delegates no admin identity", async () => {
  const f = fixture(), c = await connected(f);
  assert.equal(c.token.length, 43); assert.equal(c.kit.origin, "https://jessiemessage.com");
  assert.doesNotMatch(JSON.stringify(f.state()), new RegExp(`${c.token}|${c.kit.pairingCode}`));
  await assert.rejects(f.service.pair({ destinationId: c.destination.id, pairingCode: c.kit.pairingCode }), { code: "unauthorized" });
  const next = await f.service.preparePairing(c.destination.id); f.advance(900000);
  await assert.rejects(f.service.pair({ destinationId: c.destination.id, pairingCode: next.pairingCode }), { code: "unauthorized" });
  const summary = await f.service.summary(); assert.doesNotMatch(JSON.stringify(summary), /Hash|token|pairingCode|locationId|csrf|private-directory/);
});
test("new device pairing replaces old capability only when consumed, resetting copied state", async () => {
  const f = fixture(), c = await connected(f); await f.service.acknowledge(c.token, receipt());
  const kit = await f.service.preparePairing(c.destination.id); assert.equal((await f.service.manifest(c.token, location)).archives.length, 2);
  const replacement = await f.service.pair({ destinationId: c.destination.id, pairingCode: kit.pairingCode });
  await assert.rejects(f.service.manifest(c.token, location), { code: "unauthorized" });
  assert.equal((await f.service.summary()).destinations[0].lastReceipt, null);
  assert.equal((await f.service.manifest(replacement.token, otherLocation)).paused, false);
});
test("only exact ciphertext receipts are recorded; old acknowledgements cannot roll back progress", async () => {
  const f = fixture(), c = await connected(f);
  for (const invalid of [{ ...receipt(), sha256: "0".repeat(64) }, { ...receipt(), bytes: 1 }, { ...receipt(), captureId: "checkpoint.tar.gz" }, { ...receipt(), privatePath: "/not-accepted" }])
    await assert.rejects(f.service.acknowledge(c.token, invalid), { code: "input" });
  assert.equal(f.state().destinations[0].lastReceipt, null);
  await f.service.acknowledge(c.token, receipt()); f.advance(10); await f.service.acknowledge(c.token, receipt(0));
  assert.equal(f.state().destinations[0].lastReceipt.captureId, archives[1].id);
  assert.equal((await f.service.summary()).decryptionStatus, "not_checked");
});
test("changing the local folder invalidates an old receipt and rejects a stale generation", async () => {
  const f = fixture(), c = await connected(f); await f.service.acknowledge(c.token, receipt());
  await f.service.manifest(c.token, otherLocation);
  assert.equal(f.state().destinations[0].lastReceipt, null);
  await assert.rejects(f.service.acknowledge(c.token, receipt()), { code: "changed" });
  await f.service.acknowledge(c.token, receipt(1, otherLocation)); assert.equal(f.state().destinations[0].lastReceipt.sha256, archives[1].sha256);
});
test("pause, resume and revocation protect both manifest and transfer without deleting files", async () => {
  const f = fixture(), c = await connected(f);
  await f.service.update(c.destination.id, { label: "Mon PC", kind: "synced_folder", enabled: false });
  assert.deepEqual(await f.service.manifest(c.token, location), { version: 1, paused: true, archives: [] });
  await assert.rejects(f.service.transfer(c.token, archives[1].id, () => {}), { code: "paused" });
  await assert.rejects(f.service.acknowledge(c.token, receipt()), { code: "paused" }); assert.equal(f.transfers(), 0);
  await f.service.update(c.destination.id, { label: "Mon PC", kind: "server", enabled: true });
  assert.equal(await f.service.transfer(c.token, archives[1].id, value => value.sha256), archives[1].sha256);
  await f.service.revoke(c.destination.id); assert.equal((await f.service.summary()).destinations.length, 0);
  await assert.rejects(f.service.transfer(c.token, archives[1].id, () => {}), { code: "unauthorized" });
});
test("concurrent edits persist without lost destinations and reject unsupported cloud providers", async () => {
  const f = fixture(); await Promise.all(["A", "B", "C", "D", "E"].map(label => f.service.create({ label, kind: "computer" })));
  assert.equal(f.state().destinations.length, 5); assert.equal(f.state().revision, 5);
  await assert.rejects(f.service.create({ label: "Six", kind: "computer" }), { code: "limit" });
  await assert.rejects(f.service.create({ label: "Drive", kind: "google-drive" }), { code: "input" });
  await assert.rejects(f.service.create({ label: "bad\nlabel", kind: "computer" }), { code: "input" });
});
