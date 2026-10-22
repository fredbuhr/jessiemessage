import { createHash, timingSafeEqual } from "node:crypto";
import { campaignFingerprint, openPayload, sealPayload, createAudienceDigest, verifyRecipientProof } from "../broadcast/crypto.mjs";
import { lockMediaCapacity, validateMediaCapacity } from "../media/capacity-store.mjs";
import { readDeletionFacts } from "./deletion-store.mjs";
import { assertErasureSchema } from "./erasure-schema.mjs";
import { AccountErasureError, erasureBinding, erasureCursor, erasureId, erasureSqlDate, failErasure } from "./erasure-state.mjs";

const bytes = (value, size = 16) => {
  if (!Buffer.isBuffer(value) || value.length !== size) failErasure("ERASURE_STATE"); return Buffer.from(value);
};
const number = value => {
  const n = Number(value); if (!Number.isSafeInteger(n) || n < 0) failErasure("ERASURE_STATE"); return n;
};
const hex = value => bytes(value).toString("hex");
const terminal = row => !["queued", "running"].includes(row.status);
const states = ["pending", "sending", "delivered", "skipped", "cancelled", "failed"];

/** SQL phase adapter for an externally quiesced runtime. The advisory lock only
 * serializes erasers; it is deliberately NOT represented as stopping workers. */
export function createErasureStore({ pool, database, capacity, broadcastKey, video }) {
  if (typeof pool?.getConnection !== "function" || typeof database !== "string" || !/^[a-zA-Z0-9_]{1,64}$/.test(database)
    || !Buffer.isBuffer(broadcastKey) || broadcastKey.length !== 32) failErasure("ERASURE_INPUT");
  capacity = validateMediaCapacity(capacity); broadcastKey = Buffer.from(broadcastKey);
  if (video !== undefined && (!video || typeof video.rootFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(video.rootFingerprint)
    || ["assertSchema", "snapshot", "inspect", "prepare", "next", "release", "finish", "verifyAbsent"].some(name => typeof video[name] !== "function")))
    failErasure("ERASURE_INPUT");
  const binding = Object.freeze(erasureBinding({ database, rootFingerprint: capacity.rootFingerprint.toString("hex"),
    ...(video === undefined ? {} : { videoRootFingerprint: video.rootFingerprint }) }));
  const lockName = `jm:account-erasure:${createHash("sha256").update(database).digest("hex").slice(0, 32)}`;
  return Object.freeze({ binding,
    async withLease(clientHex, work) {
      erasureId(clientHex); if (typeof work !== "function") failErasure("ERASURE_INPUT");
      const target = Buffer.from(clientHex, "hex");
      let connection, lockAttempted = false, locked = false, active = false, busy = false, poisoned = false; const pending = new Set();
      try {
        connection = await pool.getConnection();
        if ((await connection.query("SELECT DATABASE() AS name"))[0]?.name !== database) failErasure("ERASURE_BINDING");
        lockAttempted = true;
        if (Number((await connection.query("SELECT GET_LOCK(?, 0) AS acquired", [lockName]))[0]?.acquired) !== 1) failErasure("ERASURE_BUSY");
        locked = true;
        if (video === undefined) await assertErasureSchema(connection, database);
        else await video.assertSchema(connection, database);
        active = true;
        async function capacityState() {
          const value = await lockMediaCapacity(connection, capacity);
          const total = number((await connection.query("SELECT COALESCE(SUM(stored_bytes), 0) AS value FROM media_storage_objects WHERE state <> 'released' FOR UPDATE"))[0]?.value);
          if (value.heldBytes !== total) failErasure("ERASURE_CAPACITY");
          if (video !== undefined) await video.snapshot(connection);
          return value.heldBytes;
        }
        async function user(required = true) {
          const rows = await connection.query("SELECT id, role, status, created_at, updated_at FROM users WHERE id = ? FOR UPDATE", [target]);
          if (!rows.length) { if (required) failErasure("ERASURE_NOT_FOUND"); return null; }
          if (rows.length !== 1 || rows[0].role !== "client" || !bytes(rows[0].id).equals(target)) failErasure("ERASURE_TARGET");
          return rows[0];
        }
        async function conversation() {
          const rows = await connection.query("SELECT id, client_id, admin_id FROM conversations WHERE client_id = ? FOR UPDATE", [target]);
          if (rows.length > 1) failErasure("ERASURE_STATE");
          if (!rows.length) return null;
          const row = rows[0];
          return { id: bytes(row.id), clientId: bytes(row.client_id), adminId: bytes(row.admin_id) };
        }
        async function facts(context, nowSql) {
          const rows = await readDeletionFacts({ connection, clientId: target, conversation: context, nowSql });
          if (rows.some(row => row.truncated || (row.name.startsWith("foreign") || ["ownedMediaOutsideConversationLinks", "ownedMediaCampaignLinks"].includes(row.name)) && row.count !== 0)) failErasure("ERASURE_BINDINGS");
          if (video !== undefined) await video.inspect(connection, { clientId: target, conversation: context, nowSql });
        }
        async function campaigns(context, nowSql, redact) {
          const rows = await connection.query("SELECT * FROM broadcast_campaigns ORDER BY id LIMIT 10001 FOR UPDATE");
          if (rows.length > 10000) failErasure("ERASURE_LIMIT");
          async function compactCampaign(row, payload, associated) {
            const complete = createAudienceDigest(), remaining = createAudienceDigest();
            let afterId = null, selected = false, pending = false;
            while (true) {
              const page = await connection.query(`SELECT r.*, c.client_id AS actual_client, c.admin_id AS actual_admin FROM broadcast_recipients r
                JOIN conversations c ON c.id = r.conversation_id WHERE r.campaign_id = ?
                ${afterId === null ? "" : "AND r.conversation_id > ?"} ORDER BY r.conversation_id ASC LIMIT 100 FOR UPDATE`,
              [row.id, ...(afterId === null ? [] : [afterId])]);
              if (!Array.isArray(page) || page.length > 100) failErasure("ERASURE_CAMPAIGN");
              for (const recipient of page) {
                const conversationId = bytes(recipient.conversation_id), clientId = bytes(recipient.client_id);
                if (afterId !== null && Buffer.compare(afterId, conversationId) >= 0
                  || !clientId.equals(bytes(recipient.actual_client)) || !associated.adminId.equals(bytes(recipient.actual_admin))
                  || !states.includes(recipient.state) || terminal(row) && ["pending", "sending"].includes(recipient.state)
                  || !verifyRecipientProof(broadcastKey, { ...associated, conversationId, clientId, messageId: bytes(recipient.proposed_message_id) }, recipient.client_message_id))
                  failErasure("ERASURE_CAMPAIGN");
                afterId = conversationId;
                complete.update(conversationId, clientId);
                if (complete.count > payload.audience.count) failErasure("ERASURE_CAMPAIGN");
                if (clientId.equals(target)) {
                  if (selected || context === null || !conversationId.equals(context.id)) failErasure("ERASURE_BINDINGS");
                  selected = true;
                } else {
                  remaining.update(conversationId, clientId);
                  if (["pending", "sending"].includes(recipient.state)) pending = true;
                }
              }
              if (page.length < 100) break;
            }
            if (complete.count !== payload.audience.count || complete.digest() !== payload.audience.digest) failErasure("ERASURE_CAMPAIGN");
            if (!selected || !redact) return;
            // Validate the complete immutable snapshot before deleting one row.
            // The prior create fingerprint changes, preserving the old retry
            // conflict rather than recreating a permanently erased recipient.
            const removed = await connection.query("DELETE FROM broadcast_recipients WHERE campaign_id = ? AND client_id = ? AND conversation_id = ?", [row.id, target, context.id]);
            if (Number(removed.affectedRows) !== 1) failErasure("ERASURE_CAMPAIGN");
            if (remaining.count === 0) {
              await connection.query("UPDATE announcements SET campaign_id = NULL WHERE campaign_id = ?", [row.id]);
              await connection.query("DELETE FROM broadcast_campaigns WHERE id = ?", [row.id]);
            }
            else {
              const next = { ...payload, audience: { ...payload.audience, count: remaining.count, digest: remaining.digest() } };
              const status = !terminal(row) && !pending ? "completed" : row.status;
              await connection.query("UPDATE broadcast_campaigns SET payload_encrypted = ?, request_fingerprint = ?, status = ?, updated_at = ? WHERE id = ?",
                [sealPayload(next, broadcastKey, associated, { video: video !== undefined }), campaignFingerprint(next, broadcastKey, associated, { video: video !== undefined }), status, nowSql, row.id]);
            }
          }
          for (const row of rows) {
            const associated = { campaignId: bytes(row.id), adminId: bytes(row.admin_id) };
            const payload = openPayload(row.payload_encrypted, broadcastKey, associated, { video: video !== undefined });
            if (!timingSafeEqual(bytes(row.request_fingerprint, 32), campaignFingerprint(payload, broadcastKey, associated, { video: video !== undefined }))
              || payload.mediaId !== (row.media_id === null ? null : hex(row.media_id)) || payload.allowRepeatMedia !== (Number(row.allow_repeat_media) === 1)
              || row.updated_at > nowSql) failErasure("ERASURE_CAMPAIGN");
            if (payload.version >= 2) { await compactCampaign(row, payload, associated); continue; }
            const recipients = await connection.query(`SELECT r.*, c.client_id AS actual_client, c.admin_id AS actual_admin FROM broadcast_recipients r
              JOIN conversations c ON c.id = r.conversation_id WHERE r.campaign_id = ? ORDER BY r.conversation_id FOR UPDATE`, [row.id]);
            if (JSON.stringify(recipients.map(r => hex(r.conversation_id))) !== JSON.stringify(payload.conversationIds)
              || recipients.some(r => !bytes(r.client_id).equals(bytes(r.actual_client)) || !bytes(r.actual_admin).equals(associated.adminId)
                || !states.includes(r.state) || terminal(row) && ["pending", "sending"].includes(r.state))) failErasure("ERASURE_CAMPAIGN");
            const selected = recipients.filter(r => bytes(r.client_id).equals(target));
            if (selected.some(r => context === null || !bytes(r.conversation_id).equals(context.id))) failErasure("ERASURE_BINDINGS");
            if (!selected.length || !redact) continue;
            // Re-encrypt the reduced audience and its fingerprint atomically.
            // An old create retry now conflicts rather than recreating a removed recipient.
            const remaining = recipients.filter(r => !bytes(r.client_id).equals(target));
            await connection.query("DELETE FROM broadcast_recipients WHERE campaign_id = ? AND client_id = ? AND conversation_id = ?", [row.id, target, context.id]);
            if (!remaining.length) {
              await connection.query("UPDATE announcements SET campaign_id = NULL WHERE campaign_id = ?", [row.id]);
              await connection.query("DELETE FROM broadcast_campaigns WHERE id = ?", [row.id]);
            }
            else {
              const next = { ...payload, conversationIds: remaining.map(r => hex(r.conversation_id)) };
              const status = !terminal(row) && remaining.every(r => !["pending", "sending"].includes(r.state)) ? "completed" : row.status;
              await connection.query("UPDATE broadcast_campaigns SET payload_encrypted = ?, request_fingerprint = ?, status = ?, updated_at = ? WHERE id = ?",
                [sealPayload(next, broadcastKey, associated, { video: video !== undefined }), campaignFingerprint(next, broadcastKey, associated, { video: video !== undefined }), status, nowSql, row.id]);
            }
          }
        }
        async function noContent(context, nowSql) {
          await facts(context, nowSql);
          const checks = [["invitations", "consumed_by_id"], ["sessions", "user_id"], ["email_verifications", "user_id"], ["mail_outbox", "recipient_user_id"],
            ["client_password_resets", "user_id"], ["password_reset_outbox", "recipient_user_id"], ["broadcast_preferences", "user_id"],
            ["push_subscriptions", "user_id"], ["broadcast_recipients", "client_id"], ["conversations", "client_id"], ["messages", "sender_id"], ["chat_receipts", "user_id"], ["user_profiles", "user_id"]];
          for (const [table, column] of checks) if ((await connection.query(`SELECT 1 AS present FROM ${table} WHERE ${column} = ? LIMIT 1`, [target])).length) failErasure("ERASURE_RESIDUAL");
        }
        function transaction(operation) {
          if (!active || busy || poisoned) return Promise.reject(new AccountErasureError("ERASURE_BUSY"));
          busy = true;
          const task = (async () => {
            let begun = false;
            try {
              if (!active) failErasure();
              if (Number((await connection.query("SELECT IS_USED_LOCK(?) = CONNECTION_ID() AS owned", [lockName]))[0]?.owned) !== 1) failErasure("ERASURE_BUSY");
              begun = true; await connection.beginTransaction();
              const result = await operation(); await connection.commit(); begun = false; return result;
            } catch (error) {
              poisoned = true;
              if (begun) { try { await connection.rollback(); } catch {} }
              if (error instanceof AccountErasureError) throw error;
              failErasure();
            } finally { busy = false; }
          })();
          pending.add(task); task.then(() => pending.delete(task), () => pending.delete(task)); return task;
        }
        const scope = Object.freeze({ binding,
          // A receipt can concern an identity created and closed after the
          // restored checkpoint. This read-only probe is specific to explicit
          // source-to-target reconciliation; normal erasure still requires an
          // existing client when it creates a new local intent.
          inspectReconciliation: now => transaction(async () => {
            const nowSql = erasureSqlDate(now), row = await user(false);
            await capacityState();
            if (row) {
              if (row.created_at > nowSql || row.updated_at > nowSql) failErasure("ERASURE_CLOCK");
              await facts(await conversation(), nowSql); return { present: true, clientId: clientHex };
            }
            await noContent(null, nowSql); await campaigns(null, nowSql, false);
            for (const table of ["media_assets", "media_storage_objects"]) if ((await connection.query(`SELECT 1 AS present FROM ${table} WHERE owner_id = ? LIMIT 1`, [target])).length) failErasure("ERASURE_RESIDUAL");
            if ((await connection.query("SELECT 1 AS present FROM client_auth_state WHERE user_id = ? LIMIT 1", [target])).length) failErasure("ERASURE_RESIDUAL");
            if (video !== undefined) await video.verifyAbsent(connection, { clientId: target });
            return { present: false, absent: true, clientId: clientHex };
          }),
          inspect: now => transaction(async () => {
            const nowSql = erasureSqlDate(now), row = await user();
            if (row.created_at > nowSql || row.updated_at > nowSql) failErasure("ERASURE_CLOCK");
            await capacityState(); await facts(await conversation(), nowSql); return { clientId: clientHex };
          }),
          prepare: now => transaction(async () => {
            const nowSql = erasureSqlDate(now), row = await user();
            if (row.created_at > nowSql || row.updated_at > nowSql) failErasure("ERASURE_CLOCK");
            await capacityState(); const context = await conversation(); await facts(context, nowSql);
            // All validation/changes are in this transaction: any bad campaign rolls back everything.
            await campaigns(context, nowSql, true);
            if (video !== undefined) await video.prepare(connection, { clientId: target, conversation: context, nowSql });
            await connection.query(`DELETE o FROM push_outbox o JOIN push_subscriptions p ON p.id = o.subscription_id JOIN messages m ON m.id = o.message_id
              WHERE p.user_id = ?${context ? " OR m.conversation_id = ?" : ""}`, [target, ...(context ? [context.id] : [])]);
            await connection.query("DELETE FROM push_subscriptions WHERE user_id = ? AND role = 'client'", [target]);
            if (context) {
              for (const table of ["message_media", "chat_events", "chat_receipts", "crm_memberships", "crm_tasks", "crm_profiles", "messages"])
                await connection.query(`DELETE FROM ${table} WHERE conversation_id = ?`, [context.id]);
              await connection.query("DELETE FROM conversations WHERE id = ? AND client_id = ?", [context.id, target]);
            }
            for (const [table, column] of [["mail_outbox", "recipient_user_id"], ["password_reset_outbox", "recipient_user_id"],
              ["email_verifications", "user_id"], ["client_password_resets", "user_id"], ["broadcast_preferences", "user_id"]])
              await connection.query(`DELETE FROM ${table} WHERE ${column} = ?`, [target]);
            await connection.query("DELETE cs FROM client_session_state cs JOIN sessions s ON s.id = cs.session_id WHERE s.user_id = ?", [target]);
            await connection.query("DELETE FROM sessions WHERE user_id = ?", [target]);
            // Remove the consumed invitation as one row: never split its coupled fields or reopen its token.
            await connection.query("DELETE FROM invitations WHERE consumed_by_id = ?", [target]);
            // Drop the selected user's avatar reference before media tombstones/files are removed.
            await connection.query("DELETE FROM user_profiles WHERE user_id = ?", [target]);
            await connection.query(`UPDATE users SET status = 'deleted', password_hash = NULL, pseudonym = 'Compte fermé', email = ?,
              email_verified_at = NULL, age_assured_at = NULL, access_approved_at = NULL, access_expires_at = NULL, updated_at = ? WHERE id = ? AND role = 'client'`,
            [`closed-${clientHex}@jessiemessage.invalid`, nowSql, target]);
            await connection.query("UPDATE media_assets SET active_digest = NULL, deleted_at = COALESCE(deleted_at, GREATEST(created_at, ?)) WHERE owner_id = ? AND owner_role = 'client'", [nowSql, target]);
            await connection.query("UPDATE media_storage_objects SET state = 'cleanup_pending', updated_at = GREATEST(updated_at, ?) WHERE owner_id = ? AND owner_role = 'client' AND state <> 'released'", [nowSql, target]);
            await noContent(null, nowSql); return { prepared: true };
          }),
          nextMedia: (afterId, now) => transaction(async () => {
            if (afterId !== null) video === undefined ? erasureId(afterId) : erasureCursor(afterId, 2);
            const row = await user(); if (row.status !== "deleted") failErasure("ERASURE_STATE");
            await capacityState(); await noContent(null, erasureSqlDate(now));
            if (video !== undefined && afterId?.startsWith("v:")) {
              const object = await video.next(connection, { clientId: target, afterId: afterId.slice(2), nowSql: erasureSqlDate(now) });
              return object === null ? null : { ...object, kind: "video", cursor: `v:${object.id}` };
            }
            const afterPhotoId = video === undefined || afterId === null ? afterId : afterId.slice(2);
            const rows = await connection.query(`SELECT id, storage_key, state FROM media_storage_objects WHERE owner_id = ? AND owner_role = 'client'
              ${afterPhotoId === null ? "" : "AND id > ?"} ORDER BY id LIMIT 1 FOR UPDATE`, [target, ...(afterPhotoId === null ? [] : [Buffer.from(afterPhotoId, "hex")])]);
            if (!rows.length) {
              if (video === undefined) return null;
              const object = await video.next(connection, { clientId: target, afterId: null, nowSql: erasureSqlDate(now) });
              return object === null ? null : { ...object, kind: "video", cursor: `v:${object.id}` };
            }
            if (!["cleanup_pending", "released"].includes(rows[0].state)) failErasure("ERASURE_STATE");
            const object = { id: hex(rows[0].id), storageKey: bytes(rows[0].storage_key, 32) };
            return video === undefined ? object : { ...object, kind: "photo", cursor: `p:${object.id}` };
          }),
          releaseMedia: (objectId, storageKey, now, kind) => transaction(async () => {
            erasureId(objectId); bytes(storageKey, 32);
            if (video !== undefined && !["photo", "video"].includes(kind) || video === undefined && kind !== undefined) failErasure("ERASURE_INPUT");
            if ((await user()).status !== "deleted") failErasure("ERASURE_STATE");
            const held = await capacityState(); await facts(null, erasureSqlDate(now));
            if (video !== undefined && kind === "video")
              return video.release(connection, { clientId: target, objectId, storageKey, nowSql: erasureSqlDate(now) });
            const object = (await connection.query("SELECT owner_id, owner_role, storage_key, stored_bytes, state FROM media_storage_objects WHERE id = ? FOR UPDATE", [Buffer.from(objectId, "hex")]))[0];
            if (!object || !bytes(object.owner_id).equals(target) || object.owner_role !== "client" || !bytes(object.storage_key, 32).equals(storageKey)
              || !["cleanup_pending", "released"].includes(object.state)) failErasure("ERASURE_BINDINGS");
            if (object.state !== "released") {
              const amount = number(object.stored_bytes); if (held < amount) failErasure("ERASURE_CAPACITY");
              await connection.query("UPDATE media_storage_objects SET state = 'released', updated_at = GREATEST(updated_at, ?), released_at = GREATEST(created_at, ?) WHERE id = ?", [erasureSqlDate(now), erasureSqlDate(now), Buffer.from(objectId, "hex")]);
              await connection.query("UPDATE media_storage_state SET held_bytes = held_bytes - ? WHERE id = 1", [amount]);
            }
            return { released: true };
          }),
          finish: now => transaction(async () => {
            const row = await user(false); await capacityState(); await noContent(null, erasureSqlDate(now)); await campaigns(null, erasureSqlDate(now), false);
            if (row && row.status !== "deleted") failErasure("ERASURE_STATE");
            if ((await connection.query("SELECT 1 AS present FROM media_storage_objects WHERE owner_id = ? AND state <> 'released' LIMIT 1 FOR UPDATE", [target])).length) failErasure("ERASURE_RESIDUAL");
            await connection.query("DELETE FROM media_storage_objects WHERE owner_id = ? AND owner_role = 'client'", [target]);
            await connection.query("DELETE FROM media_assets WHERE owner_id = ? AND owner_role = 'client'", [target]);
            if (video !== undefined) await video.finish(connection, { clientId: target });
            await connection.query("DELETE FROM client_auth_state WHERE user_id = ?", [target]);
            await connection.query("DELETE FROM users WHERE id = ? AND role = 'client' AND status = 'deleted'", [target]);
            return { completed: true };
          }),
          verifyAbsent: now => transaction(async () => {
            if (await user(false)) failErasure("ERASURE_RESTORE_REPLAY_REQUIRED");
            await capacityState(); await noContent(null, erasureSqlDate(now)); await campaigns(null, erasureSqlDate(now), false);
            for (const table of ["media_assets", "media_storage_objects"]) if ((await connection.query(`SELECT 1 AS present FROM ${table} WHERE owner_id = ? LIMIT 1`, [target])).length) failErasure("ERASURE_RESIDUAL");
            if (video !== undefined) await video.verifyAbsent(connection, { clientId: target });
            return { absent: true };
          }),
        });
        return await work(scope);
      } catch (error) { if (error instanceof AccountErasureError) throw error; failErasure(); }
      finally {
        active = false; await Promise.allSettled([...pending]);
        try {
          if (lockAttempted) {
            const released = await connection.query("SELECT RELEASE_LOCK(?) AS released", [lockName]);
            if (locked && Number(released[0]?.released) !== 1) failErasure("ERASURE_BUSY");
          }
        } catch { failErasure("ERASURE_BUSY");
        } finally {
          if (connection) { try { await connection.release(); } catch { failErasure(); } }
        }
      }
    },
  });
}
