import assert from "node:assert/strict";
import path from "node:path";
import { lstat, mkdir, readFile, readdir } from "node:fs/promises";
import { campaignFingerprint, createAudienceDigest, openPayload, verifyRecipientProof } from "../../server/broadcast/crypto.mjs";
import { createChatStore } from "../../server/chat/store.mjs";
import { createErasureStore } from "../../server/data/erasure-store.mjs";
import { createErasureJournal } from "../../server/data/erasure-journal.mjs";
import { createAccountErasure } from "../../server/data/erasure.mjs";
import { createVideoStore } from "../../server/video/store.mjs";
import { createVideoErasureExtension } from "../../server/video/erasure-store.mjs";
import { composeVideoErasureStorage } from "../../server/video/erasure-storage.mjs";
import { withPrivateDirectory } from "../../server/files/private-directory.mjs";
import { captureOperationalState, operationalStateHash, readOperationalCheckpoint, restoreOperationalQuarantine,
  readOperationalQuarantine, OPERATIONAL_RESTORE_MARKER } from "../../server/backup/operational-checkpoint.mjs";
import { reconcileManualRestore, publishManualRestore } from "../../server/backup/manual-restore.mjs";
import { managedClosureFixture } from "./managed-closure-runtime.mjs";
import { fileHash, fileInventory } from "./video-backup-flow.mjs";

async function checkpointInventory(root, prefix = "") {
  const result = [];
  for (const name of (await readdir(root)).sort()) {
    const file = path.join(root, name), stat = await lstat(file), relative = `${prefix}${name}`;
    assert.equal(stat.isSymbolicLink(), false);
    if (stat.isDirectory()) result.push(...await checkpointInventory(file, `${relative}/`));
    else { assert.equal(stat.isFile(), true); result.push([relative, fileHash(await readFile(file))]); }
  }
  return result;
}

/** After a native capture, a real later closure is deliberately applied only
 * to this fixture's disposable source. A restore of the older SQL is then
 * reconciled into another database and both separate physical roots. */
export async function qualifyVideoManualRestore(t, f) {
  await f.resetTarget(); await f.import(); await f.copy(); await f.backup("restore");
  const sourceRuntimeDirectory = path.join(f.root, "source-closure-runtime"), targetRuntimeDirectory = path.join(f.root, "target-published-runtime"),
    progressDirectory = path.join(f.root, "manual-video-progress");
  for (const directory of [sourceRuntimeDirectory, targetRuntimeDirectory, progressDirectory]) await mkdir(directory, { mode: 0o700 });
  const sourceProducer = await managedClosureFixture(t, sourceRuntimeDirectory), targetProducer = await managedClosureFixture(t, targetRuntimeDirectory);
  const closeAt = f.now + 30000, client = f.clients[0], clientId = client.id.toString("hex"), peer = f.clients[1];
  const sourceCapacity = { ...f.limits, rootFingerprint: await f.source.storage.fingerprint() },
    sourceVideoCapacity = { ...f.limits, rootFingerprint: await f.source.videoStorage.fingerprint() };
  const extension = createVideoErasureExtension({ videoStore: createVideoStore({ pool: f.source.pool, chatStore: createChatStore(f.source.pool), capacity: sourceVideoCapacity }),
    videoStorage: f.source.videoStorage, capacity: sourceVideoCapacity });
  const sourceStore = createErasureStore({ pool: f.source.pool, database: f.source.database, capacity: sourceCapacity, broadcastKey: f.keys.messageKey, video: extension });
  const journalFor = id => createErasureJournal({ directory: f.dirs.sourceOperations, key: f.keys.crmKey, binding: f.binding, clientId: id });
  async function verifyRetainedVideoCampaign(connection) {
    const row = (await connection.query("SELECT * FROM broadcast_campaigns WHERE id = ?", [f.broadcastCampaignId]))[0];
    assert.ok(row); assert.equal(row.media_id, null); assert.match(row.payload_encrypted, /^v3\./);
    const associated = { campaignId: f.broadcastCampaignId, adminId: f.admin.id };
    const payload = openPayload(row.payload_encrypted, f.keys.messageKey, associated, { video: true });
    assert.equal(payload.version, 3); assert.equal(payload.videoId, f.sharedVideo.id.toString("hex"));
    assert.equal(payload.audience.count, 1); assert.equal(payload.allowRepeatMedia, true);
    assert.deepEqual(campaignFingerprint(payload, f.keys.messageKey, associated, { video: true }), row.request_fingerprint);
    const recipients = await connection.query("SELECT * FROM broadcast_recipients WHERE campaign_id = ? ORDER BY conversation_id", [f.broadcastCampaignId]);
    assert.equal(recipients.length, 1); const recipient = recipients[0];
    assert.ok(recipient.client_id.equals(peer.id)); assert.ok(recipient.conversation_id.equals(f.conversations[1]));
    assert.equal(recipient.state, "pending"); assert.equal(recipient.reason, null);
    assert.equal(verifyRecipientProof(f.keys.messageKey, { ...associated, conversationId: recipient.conversation_id,
      clientId: recipient.client_id, messageId: recipient.proposed_message_id }, recipient.client_message_id), true);
    assert.equal(payload.audience.digest, createAudienceDigest().update(recipient.conversation_id, recipient.client_id).digest());
    const asset = (await connection.query("SELECT owner_id,owner_role,state FROM video_assets WHERE id = ?", [f.sharedVideo.id]))[0];
    assert.ok(asset.owner_id.equals(f.admin.id)); assert.equal(asset.owner_role, "admin"); assert.equal(asset.state, "committed");
  }
  let latest, expectedRegistrySha256, sourceAfterClosure;
  try {
    await t.test("a real IPC producer drains before a post-capture client closure removes only its own photo and video", async () => {
      await sourceProducer.runtime.start();
      const request = await fetch(`${sourceProducer.origin}/slow`), body = request.text();
      assert.deepEqual(await sourceProducer.runtime.stop(), { exitCode: 0, signal: null }); assert.equal(await body, "starteddone");
      assert.equal(sourceProducer.children[0].exitCode, 0); assert.equal(sourceProducer.children[0].signalCode, null);
      const assertStopped = async () => assert.equal(sourceProducer.runtime.state().status, "stopped");
      const eraser = createAccountErasure({ store: sourceStore, storage: composeVideoErasureStorage({ storage: f.source.storage, videoStorage: f.source.videoStorage }),
        journalFor, clock: () => closeAt, maintenance: { async withQuiescedProducers(work) { await assertStopped(); return work(assertStopped, assertStopped); } } });
      let result, passes = 0;
      do { assert.ok(++passes <= 10); result = await eraser.resume({ clientId, maxMedia: 1 }); } while (!result.completed);
      await sourceStore.withLease(clientId, scope => scope.verifyAbsent(closeAt));
      for (const variant of ["full", "thumb"]) assert.equal((await f.source.storage.inspectEntry({ storageKey: f.clientPhoto.storageKey, variant })).exists, false);
      assert.equal((await f.source.videoStorage.inspectEntry({ storageKey: f.clientVideos[0].storageKey })).exists, false);
      assert.equal((await f.source.videoStorage.inspectEntry({ storageKey: f.sharedVideo.storageKey })).exists, true);
      assert.equal((await f.source.videoStorage.inspectEntry({ storageKey: f.clientVideos[1].storageKey })).exists, true);
      assert.equal(Number((await f.sourceConnection.query("SELECT COUNT(*) AS value FROM users WHERE id = ?", [peer.id]))[0].value), 1);
      assert.ok((await readFile(sourceProducer.marker, "utf8")).includes("producer-stopped"));
      await verifyRetainedVideoCampaign(f.sourceConnection);
      latest = await withPrivateDirectory(f.dirs.sourceOperations, scope => captureOperationalState(scope, { key: f.keys.crmKey, binding: f.binding }));
      expectedRegistrySha256 = operationalStateHash(latest); sourceAfterClosure = await f.sourceState();
    });
    assert.ok(latest); assert.ok(sourceAfterClosure);
    const targetBinding = { database: f.target.database, rootFingerprint: (await f.target.storage.fingerprint()).toString("hex"),
      videoRootFingerprint: (await f.target.videoStorage.fingerprint()).toString("hex") };
    const assertReady = async () => {
      assert.equal(sourceProducer.runtime.state().status, "stopped");
      const current = await withPrivateDirectory(f.dirs.sourceOperations, scope => captureOperationalState(scope, { key: f.keys.crmKey, binding: f.binding }));
      assert.equal(operationalStateHash(current), expectedRegistrySha256);
    };
    const backup = await withPrivateDirectory(f.dirs.checkpoint, scope => readOperationalCheckpoint(scope, f.receipt, f.keys.crmKey));
    assert.equal(backup.version, 2); assert.deepEqual(backup.legacyBinding, f.legacyBinding);
    const preserved = new Map(latest.files.map(file => [file.name, file.content]));
    await withPrivateDirectory(f.dirs.quarantine, scope => restoreOperationalQuarantine(scope, { backup, current: latest, targetBinding, key: f.keys.crmKey,
      expectedCurrentSha256: expectedRegistrySha256, assertCurrent: async actual => { assert.equal(actual, expectedRegistrySha256); await assertReady(); } }));
    const quarantineBefore = await fileInventory(f.dirs.quarantine), checkpointBefore = await checkpointInventory(f.dirs.checkpoint);
    const readRecentRegistry = () => withPrivateDirectory(f.dirs.sourceOperations, scope => captureOperationalState(scope, { key: f.keys.crmKey, binding: f.binding }));
    const input = { checkpointDirectory: f.dirs.checkpoint, quarantineDirectory: f.dirs.quarantine, journalDirectory: f.dirs.targetOperations, progressDirectory,
      recentRegistry: latest, expectedRegistrySha256, readRecentRegistry, target: f.target, keys: f.keys, clock: () => closeAt + 1000, assertReady,
      maintenance: { async withQuiescedProducers(work) {
        const quiescent = async () => { await assertReady(); assert.equal(targetProducer.runtime.state().status, "stopped"); };
        await quiescent(); return work(quiescent);
      } } };
    let reconciled;
    await t.test("restoring older SQL36 reconciles the later closure across both roots and preserves the administrator's shared media", async () => {
      assert.equal(Number((await f.targetConnection.query("SELECT COUNT(*) AS value FROM users WHERE id = ?", [client.id]))[0].value), 1);
      reconciled = await reconcileManualRestore(input);
      assert.equal(reconciled.status, "manual_restore_reconciled_quarantined"); assert.equal(reconciled.started, false);
      assert.equal(reconciled.reconciledReceipts, 3); assert.equal(reconciled.targetAbsenceVerified, true);
      assert.equal(reconciled.targetJournalQuarantined, true); assert.equal(targetProducer.children.length, 0);
      assert.equal(Number((await f.targetConnection.query("SELECT COUNT(*) AS value FROM users WHERE id = ?", [client.id]))[0].value), 0);
      assert.equal(Number((await f.targetConnection.query("SELECT COUNT(*) AS value FROM users WHERE id = ?", [peer.id]))[0].value), 1);
      assert.equal(Number((await f.targetConnection.query("SELECT COUNT(*) AS value FROM message_video WHERE conversation_id = ? AND video_id = ?", [f.conversations[1], f.sharedVideo.id]))[0].value), 1);
      for (const variant of ["full", "thumb"]) {
        assert.equal((await f.target.storage.inspectEntry({ storageKey: f.clientPhoto.storageKey, variant })).exists, false);
        assert.equal((await f.target.storage.inspectEntry({ storageKey: f.photo.storageKey, variant })).exists, true);
      }
      assert.equal((await f.target.videoStorage.inspectEntry({ storageKey: f.clientVideos[0].storageKey })).exists, false);
      assert.equal((await f.target.videoStorage.inspectEntry({ storageKey: f.sharedVideo.storageKey })).exists, true);
      assert.equal((await f.target.videoStorage.inspectEntry({ storageKey: f.clientVideos[1].storageKey })).exists, true);
      assert.equal(Number((await f.targetConnection.query("SELECT COUNT(*) AS value FROM sessions WHERE revoked_at IS NULL"))[0].value), 0);
      assert.deepEqual(await fileInventory(f.dirs.quarantine), quarantineBefore);
      for (const [name, content] of preserved) assert.equal((await readFile(path.join(f.dirs.quarantine, name))).toString("base64url"), content);
      await verifyRetainedVideoCampaign(f.targetConnection);
      assert.deepEqual(await f.sourceState(), sourceAfterClosure);
    });
    await t.test("an incorrect publication confirmation retains the v2 hold and cannot start the target", async () => {
      const hold = await readFile(path.join(f.dirs.targetOperations, OPERATIONAL_RESTORE_MARKER));
      await assert.rejects(publishManualRestore(input, { expectedPlanSha256: "0".repeat(64), runtime: targetProducer.runtime }), { code: "MANUAL_RESTORE_PLAN_CHANGED" });
      assert.deepEqual(await readFile(path.join(f.dirs.targetOperations, OPERATIONAL_RESTORE_MARKER)), hold); assert.equal(targetProducer.children.length, 0);
    });
    await t.test("explicit video publication verifies closure absence, retains source envelopes and drains the real target child", async () => {
      const report = await publishManualRestore(input, { expectedPlanSha256: reconciled.planSha256, runtime: targetProducer.runtime });
      assert.equal(report.status, "manual_restore_published"); assert.equal(report.ready, true); assert.equal(report.reconciledReceipts, 3);
      assert.equal(targetProducer.runtime.state().status, "running"); assert.equal(targetProducer.children.length, 1);
      assert.deepEqual(await (await fetch(`${targetProducer.origin}/api/ready`)).json(), { status: "ready" });
      assert.equal((await readdir(f.dirs.targetOperations)).includes(OPERATIONAL_RESTORE_MARKER), false);
      const quarantine = await withPrivateDirectory(f.dirs.quarantine, scope => readOperationalQuarantine(scope, { key: f.keys.crmKey, sourceBinding: f.binding, targetBinding }));
      assert.equal(quarantine.marker.version, 2); assert.equal(quarantine.state.files.length, 3);
      assert.deepEqual(await fileInventory(f.dirs.quarantine), quarantineBefore); assert.deepEqual(await checkpointInventory(f.dirs.checkpoint), checkpointBefore);
      assert.deepEqual(await f.sourceState(), sourceAfterClosure);
      assert.deepEqual(await targetProducer.runtime.stop(), { exitCode: 0, signal: null }); assert.equal(targetProducer.children[0].exitCode, 0);
    });
  } finally {
    await targetProducer.runtime.destroy(); await sourceProducer.runtime.destroy();
  }
}
