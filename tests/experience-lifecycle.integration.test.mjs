import test from "node:test";
import assert from "node:assert/strict";
import { loadMigrations } from "../server/db/migrations.mjs";
import { loadVideoMigrations } from "../server/video/migrations.mjs";
import { createChatStore } from "../server/chat/store.mjs";
import { createReplyTracking } from "../server/tasks/reply.mjs";
import { openTask } from "../server/tasks/crypto.mjs";
import { openPreferences } from "../server/preferences/crypto.mjs";
import { verifyPhotoNotificationRecoveryCrmBroadcastVideoBackupData } from "../server/backup/verify.mjs";
import { createErasureStore } from "../server/data/erasure-store.mjs";
import { createErasureJournal } from "../server/data/erasure-journal.mjs";
import { createAccountErasure } from "../server/data/erasure.mjs";
import { createVideoStore } from "../server/video/store.mjs";
import { createVideoErasureExtension } from "../server/video/erasure-store.mjs";
import { composeVideoErasureStorage } from "../server/video/erasure-storage.mjs";
import { videoBackupFixture } from "./fixtures/video-backup-flow.mjs";

const enabled = process.env.JESSIEMESSAGE_DB_TEST === "1";
const hex = value => value.toString("hex");
const serialize = rows => JSON.stringify(rows.map(row => JSON.stringify(row, (_name, value) => typeof value === "bigint" ? value.toString() : value)).sort());

test("native SQL38 capture, crypto verification and closure preserve private preferences and reply tasks of other accounts", {
  skip: enabled ? false : "Requires two explicit disposable loopback databases, native SQL/tar tools and procfs.", timeout: 240000,
}, async t => {
  const f = await videoBackupFixture(t, { experience: true });
  const selected = f.clients[0], peer = f.clients[1], selectedId = hex(selected.id), closeAt = f.now + 30000;
  const verify = target => verifyPhotoNotificationRecoveryCrmBroadcastVideoBackupData({
    pool: target.pool, storage: target.storage, videoStorage: target.videoStorage, keys: f.keys, experience: true,
  });
  const preferences = connection => connection.query("SELECT * FROM profile_preferences ORDER BY user_id");
  const tasks = connection => connection.query("SELECT * FROM crm_tasks ORDER BY id");
  let initialPreferences, initialTasks;

  await t.test("real capture includes three encrypted selections and two authenticated SQL38 reply tasks", async () => {
    initialPreferences = await preferences(f.sourceConnection); initialTasks = await tasks(f.sourceConnection);
    assert.equal(initialPreferences.length, 3); assert.equal(initialTasks.length, 2);
    for (const saved of f.preferenceSelections) {
      const row = initialPreferences.find(value => value.user_id.equals(saved.owner.id));
      assert.ok(row); assert.equal(row.selection_encrypted, saved.encrypted);
      assert.deepEqual(openPreferences(row.selection_encrypted, f.keys.crmKey, hex(saved.owner.id), String(row.version)), saved.value);
      assert.equal(saved.value.selectedIds.some(value => row.selection_encrypted.includes(value)), false);
    }
    for (const task of initialTasks) {
      const manuallyReopened = task.conversation_id.equals(f.conversations[1]);
      assert.equal(task.reply_kind, "reply"); assert.equal(String(task.reply_through), manuallyReopened ? "3" : "0");
      assert.equal(Number(task.reply_reopened), manuallyReopened ? 1 : 0);
      assert.equal(Number(task.done), 0);
      assert.equal(openTask(task.title_encrypted, f.keys.crmKey, { adminId: f.admin.id, conversationId: task.conversation_id,
        taskId: task.id, version: String(task.version), dueAt: null, done: false }), "À répondre");
    }
    const healthy = await verify(f.source);
    assert.equal(healthy.complete, true); assert.equal(healthy.healthy, true); assert.deepEqual(healthy.issues, []);
    assert.equal(healthy.counts.preferences, 3); assert.equal(healthy.counts.tasks, 2);
    const report = await f.capture();
    assert.equal(report.status, "application_checkpoint_saved"); assert.equal(report.tables, 37); assert.equal(report.migrations, 38);
    assert.deepEqual(f.receipt.schema, { tables: 37, migrations: 38 });
    assert.equal(f.payload.snapshot.counts.tables, 37); assert.equal(f.payload.snapshot.coverage.tables, 37);
    assert.equal((await loadMigrations()).length, 33); assert.equal((await loadVideoMigrations()).length, 36);
    await f.assertSourceUnchanged();
  });

  await t.test("native import and bounded crypto verification retain selections and every reply-state column", async () => {
    const imported = await f.import(); assert.equal(imported.applicationSnapshotMatched, true);
    await f.copy(); const restored = await f.backup("restore"); assert.equal(restored.verified, true);
    assert.equal(serialize(await preferences(f.targetConnection)), serialize(initialPreferences));
    assert.equal(serialize(await tasks(f.targetConnection)), serialize(initialTasks));
    const healthy = await verify(f.target);
    assert.equal(healthy.healthy, true); assert.equal(healthy.counts.preferences, 3); assert.equal(healthy.counts.tasks, 2);
    const chat = createChatStore(f.target.pool, { clock: f.clock, replyTracking: createReplyTracking({ key: f.keys.crmKey }) });
    for (const [index, conversationId] of f.conversations.entries()) {
      const view = await chat.readMessages({ role: "admin", tokenHash: f.admin.tokenHash, now: f.clock(), conversationId, limit: 50 });
      assert.equal(view.conversation.reply.needed, true); assert.equal(view.conversation.reply.handledThrough, index === 1 ? "3" : "0");
      assert.ok(BigInt(view.conversation.reply.through) > 0n);
    }
    await f.assertSourceUnchanged();
  });

  await t.test("a wrong-owner ciphertext fails real preferences authentication without source mutation", async () => {
    const original = initialPreferences.find(value => value.user_id.equals(selected.id)).selection_encrypted,
      substituted = initialPreferences.find(value => value.user_id.equals(peer.id)).selection_encrypted;
    try {
      await f.targetConnection.query("UPDATE profile_preferences SET selection_encrypted = ? WHERE user_id = ?", [substituted, selected.id]);
      const rejected = await verify(f.target);
      assert.equal(rejected.complete, true); assert.equal(rejected.healthy, false);
      assert.ok(rejected.issues.some(value => value.purpose === "preferences"));
    } finally {
      await f.targetConnection.query("UPDATE profile_preferences SET selection_encrypted = ? WHERE user_id = ?", [original, selected.id]);
    }
    assert.equal((await verify(f.target)).healthy, true); await f.assertSourceUnchanged();
  });

  await t.test("closure38 removes the selected preference FK and reply task, preserving peer and admin rows and media", async () => {
    const retainedSnapshot = async () => {
      const values = [];
      for (const owner of [f.admin, peer]) for (const [table, column] of [["users", "id"], ["profile_preferences", "user_id"],
        ["sessions", "user_id"], ["media_assets", "owner_id"], ["media_storage_objects", "owner_id"], ["video_assets", "owner_id"]])
        values.push([table, hex(owner.id), serialize(await f.targetConnection.query(`SELECT * FROM ${table} WHERE ${column} = ?`, [owner.id]))]);
      for (const table of ["conversations", "messages", "chat_events", "chat_receipts", "message_media", "message_video", "crm_tasks"])
        values.push([table, serialize(await f.targetConnection.query(`SELECT * FROM ${table} WHERE ${table === "conversations" ? "id" : "conversation_id"} = ?`, [f.conversations[1]]))]);
      return values;
    };
    const retained = await retainedSnapshot(), capacity = { ...f.limits, rootFingerprint: await f.target.storage.fingerprint() },
      videoCapacity = { ...f.limits, rootFingerprint: await f.target.videoStorage.fingerprint() };
    const extension = createVideoErasureExtension({
      videoStore: createVideoStore({ pool: f.target.pool, chatStore: createChatStore(f.target.pool), capacity: videoCapacity, experience: true }),
      videoStorage: f.target.videoStorage, capacity: videoCapacity, experience: true,
    });
    const store = createErasureStore({ pool: f.target.pool, database: f.target.database, capacity, broadcastKey: f.keys.messageKey, video: extension, experience: true });
    // This fixture never creates a runtime, worker or delivery transport. All
    // native capture/import operations have completed before this sole writer.
    const noProducers = async () => { assert.equal(f.operator.imports, 1); assert.equal(f.operator.resumes, 1); };
    const eraser = createAccountErasure({ store, storage: composeVideoErasureStorage({ storage: f.target.storage, videoStorage: f.target.videoStorage }),
      journalFor: clientId => createErasureJournal({ directory: f.dirs.targetOperations, key: f.keys.crmKey, binding: store.binding, clientId }),
      clock: () => closeAt, maintenance: { async withQuiescedProducers(work) { await noProducers(); return work(noProducers, noProducers); } },
    });
    let result, passes = 0;
    do { assert.ok(++passes <= 10); result = await eraser.resume({ clientId: selectedId, maxMedia: 1 }); } while (!result.completed);
    await store.withLease(selectedId, scope => scope.verifyAbsent(closeAt));
    assert.equal(Number((await f.targetConnection.query("SELECT COUNT(*) AS count FROM users WHERE id = ?", [selected.id]))[0].count), 0);
    assert.equal(Number((await f.targetConnection.query("SELECT COUNT(*) AS count FROM profile_preferences WHERE user_id = ?", [selected.id]))[0].count), 0);
    assert.equal(Number((await f.targetConnection.query("SELECT COUNT(*) AS count FROM crm_tasks WHERE conversation_id = ?", [f.conversations[0]]))[0].count), 0);
    assert.deepEqual(await retainedSnapshot(), retained);
    for (const variant of ["full", "thumb"]) {
      assert.equal((await f.target.storage.inspectEntry({ storageKey: f.clientPhoto.storageKey, variant })).exists, false);
      assert.equal((await f.target.storage.inspectEntry({ storageKey: f.photo.storageKey, variant })).exists, true);
    }
    assert.equal((await f.target.videoStorage.inspectEntry({ storageKey: f.clientVideos[0].storageKey })).exists, false);
    for (const asset of [f.sharedVideo, f.clientVideos[1]]) assert.equal((await f.target.videoStorage.inspectEntry({ storageKey: asset.storageKey })).exists, true);
    const healthy = await verify(f.target);
    assert.equal(healthy.healthy, true); assert.equal(healthy.counts.preferences, 2); assert.equal(healthy.counts.tasks, 1);
    const repeated = await eraser.resume({ clientId: selectedId, maxMedia: 1 });
    assert.equal(repeated.completed, true); assert.equal(repeated.processedMedia, 0); assert.deepEqual(await retainedSnapshot(), retained);
    await f.assertSourceUnchanged();
  });
});
