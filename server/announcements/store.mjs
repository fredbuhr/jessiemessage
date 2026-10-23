import { loadStoreMigrations } from "../db/store-migrations.mjs";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { createSessionClock } from "../auth/session-policy.mjs";
import { ChatStoreError, normalizedCheckTree, authoredMigrationCheck } from "../chat/store.mjs";
import { migrationStatus } from "../db/migrations.mjs";
import { campaignFingerprint, recipientProof, sealPayload } from "../broadcast/crypto.mjs";
import { audienceSelectorHash, readPreviewToken } from "../broadcast/audience.mjs";
import { BroadcastStoreError } from "../broadcast/store.mjs";
import { announcementFingerprint, openAnnouncement, sealAnnouncement } from "./crypto.mjs";
import { AnnouncementsError, MAX_REVISION, WINDOW_MILLISECONDS, fail, instant, revision, validateRemove, validateSave } from "./validation.mjs";

const COLUMNS = "admin_id, admin_role, id, revision, mutation_id, request_fingerprint, body_encrypted, starts_at, expires_at, send_private_message, campaign_id, removed_at, created_at, updated_at";
const sqlDate = value => new Date(instant(value)).toISOString().replace("T", " ").replace("Z", "000");
function bytes(value, length = 16) { if (!Buffer.isBuffer(value) || value.length !== length) fail(); return value; }
function timestamp(value) {
  if (value instanceof Date) return instant(value.getTime());
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/.test(value)) fail();
  return instant(Date.parse(value.replace(" ", "T") + "Z"));
}
function flag(value) { if (![0, 1, 0n, 1n].includes(value)) fail(); return Number(value) === 1; }
function storedRevision(value) { if (!["string", "number", "bigint"].includes(typeof value)) fail(); return revision(String(value), false); }
const schema = {
  admin_id: ["varbinary", false, 16], admin_role: ["varchar", false, 8], id: ["varbinary", false, 16],
  revision: ["bigint", false], mutation_id: ["varbinary", false, 16], request_fingerprint: ["varbinary", false, 32],
  body_encrypted: ["varchar", false, 8192], starts_at: ["datetime", false], expires_at: ["datetime", false],
  send_private_message: ["tinyint", false], campaign_id: ["varbinary", true, 16], removed_at: ["datetime", true],
  created_at: ["datetime", false], updated_at: ["datetime", false],
};

export function createAnnouncementsStore({ pool, chatStore, broadcastStore, key, clock } = {}) {
  if (typeof pool?.getConnection !== "function" || typeof chatStore?.withActor !== "function"
    || ["createAudienceInTransaction", "cancelInTransaction"].some(name => typeof broadcastStore?.[name] !== "function")
    || !Buffer.isBuffer(key) || key.length !== 32) fail("ANNOUNCEMENTS_CONFIG");
  key = Buffer.from(key);
  const readTime = createSessionClock(clock), nowAt = previous => Math.max(instant(previous), readTime(previous));
  async function withActor(request, operation) {
    if (!["admin", "client"].includes(request.role)) fail("ANNOUNCEMENTS_INPUT");
    bytes(request.tokenHash, 32); instant(request.now); let ownFailure;
    try {
      return await chatStore.withActor(request, async (connection, context) => {
        try { return await operation(connection, context); }
        catch (error) {
          // Preserve approved domain conflicts through the owning chat
          // transaction's sanitizer. Driver objects cannot impersonate them.
          if (error instanceof BroadcastStoreError && ["BROADCAST_CONFLICT", "BROADCAST_RECIPIENTS", "BROADCAST_REPEAT", "BROADCAST_MEDIA", "BROADCAST_LIMIT"].includes(error.code)) {
            ownFailure = new AnnouncementsError("ANNOUNCEMENTS_CONFLICT"); throw ownFailure;
          }
          if (error instanceof AnnouncementsError) ownFailure = error; throw error;
        }
      });
    } catch (error) {
      if (ownFailure) throw ownFailure;
      if (error instanceof AnnouncementsError || error instanceof ChatStoreError) throw error;
      fail();
    }
  }
  async function rowFor(connection, adminId) {
    return (await connection.query(`SELECT ${COLUMNS} FROM announcements WHERE admin_id = ? FOR UPDATE`, [bytes(adminId)]))[0] ?? null;
  }
  function decodedRow(row, adminId) {
    if (row === null) return null;
    if (!bytes(row.admin_id).equals(bytes(adminId)) || row.admin_role !== "admin") fail();
    bytes(row.id); bytes(row.mutation_id); bytes(row.request_fingerprint, 32);
    const binding = { adminId, id: row.id, revision: storedRevision(row.revision), startsAt: timestamp(row.starts_at),
      expiresAt: timestamp(row.expires_at), sendPrivateMessage: flag(row.send_private_message) };
    const createdAt = timestamp(row.created_at), updatedAt = timestamp(row.updated_at), removedAt = row.removed_at === null ? null : timestamp(row.removed_at);
    if (updatedAt < createdAt || removedAt !== null && removedAt < createdAt || row.campaign_id !== null && !binding.sendPrivateMessage) fail();
    const body = openAnnouncement(row.body_encrypted, key, binding).body;
    return { ...binding, body, id: row.id.toString("hex"), campaignId: row.campaign_id === null ? null : bytes(row.campaign_id).toString("hex"), removedAt };
  }
  function decode(row, adminId) { try { return decodedRow(row, adminId); } catch { fail(); } }
  function view(row, adminId, now, role = "admin") {
    const value = decode(row, adminId), rev = value?.revision ?? "0";
    if (!value || value.removedAt !== null || role === "client" && (value.startsAt > now || value.expiresAt <= now)) {
      return role === "client" ? { serverTime: now, announcement: null } : { serverTime: now, revision: rev, announcement: null };
    }
    const { id, revision, body, startsAt, expiresAt, sendPrivateMessage, campaignId } = value;
    const announcement = { id, revision, body, startsAt, expiresAt };
    if (role === "client") return { serverTime: now, announcement };
    return { serverTime: now, revision, announcement: { ...announcement, status: now < startsAt ? "scheduled" : now < expiresAt ? "visible" : "expired", sendPrivateMessage, campaignId } };
  }
  function identity(row, input, fingerprint) {
    if (row && bytes(row.mutation_id).equals(Buffer.from(input.mutationId, "hex"))) {
      if (!timingSafeEqual(bytes(row.request_fingerprint, 32), fingerprint)) fail("ANNOUNCEMENTS_CONFLICT");
      return true;
    }
    if ((row === null ? "0" : storedRevision(row.revision)) !== input.expectedRevision) fail("ANNOUNCEMENTS_CONFLICT");
    if (BigInt(input.expectedRevision) >= MAX_REVISION) fail("ANNOUNCEMENTS_CONFLICT");
    return false;
  }
  function checkWindow(input, now) {
    if (input.startsAt !== null && input.startsAt < now || input.expiresAt <= (input.startsAt ?? now)
      || input.expiresAt > now + WINDOW_MILLISECONDS) fail("ANNOUNCEMENTS_CONFLICT");
  }
  async function cancelPrevious(connection, context, row) {
    if (row?.campaign_id !== null && row?.campaign_id !== undefined) {
      const campaignId = bytes(row.campaign_id), now = nowAt(context.now);
      await broadcastStore.cancelInTransaction(connection, context, campaignId, now);
      // The caller already holds the administrator lock, also acquired first
      // by push preparation/settlement. No transport runs inside this transaction.
      // Messages already delivered stay intact; only their pending alerts stop.
      await connection.query(`UPDATE push_outbox o JOIN broadcast_recipients r ON r.delivered_message_id = o.message_id
        SET o.status = 'skipped', o.finished_at = ?, o.lease_token = NULL, o.lease_until = NULL
        WHERE r.campaign_id = ? AND o.status IN ('pending', 'sending')`, [sqlDate(now), campaignId]);
    }
  }
  return Object.freeze({
    async assertSchema(options = {}) {
      let connection;
      try {
        connection = await pool.getConnection();
        const database = (await connection.query("SELECT DATABASE() AS name"))[0]?.name;
        const migrations = await loadStoreMigrations(options), history = await migrationStatus(connection, { database, migrations });
        if (migrations.length !== (options.experience === true ? 38 : options.video === true ? 36 : 33) || history.length !== migrations.length || history.some(row => row.state !== "applied")) fail();
        const table = (await connection.query("SELECT ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'announcements'", [database]))[0];
        if (table?.engine !== "InnoDB") fail();
        const columns = await connection.query(`SELECT COLUMN_NAME AS name, DATA_TYPE AS type, IS_NULLABLE AS nullable,
          CHARACTER_MAXIMUM_LENGTH AS length_value, DATETIME_PRECISION AS precision_value, COLUMN_TYPE AS definition,
          COLLATION_NAME AS collation_name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'announcements'`, [database]);
        if (columns.length !== Object.keys(schema).length) fail();
        for (const [name, [type, nullable, length]] of Object.entries(schema)) {
          const actual = columns.find(row => row.name === name);
          if (!actual || actual.type !== type || (actual.nullable === "YES") !== nullable || length !== undefined && Number(actual.length_value) !== length
            || type === "datetime" && Number(actual.precision_value) !== 6 || ["bigint", "tinyint"].includes(type) && !actual.definition.includes("unsigned")
            || type === "varchar" && actual.collation_name !== "ascii_bin") fail();
        }
        const indexes = await connection.query("SELECT INDEX_NAME AS name, COLUMN_NAME AS column_name, NON_UNIQUE AS non_unique, SEQ_IN_INDEX AS position, SUB_PART AS prefix_length FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'announcements'", [database]);
        for (const [name, column, unique] of [["PRIMARY", "admin_id", true], ["announcements_id", "id", true], ["announcements_campaign", "campaign_id", false]]) {
          const actual = indexes.filter(row => row.name === name);
          if (actual.length !== 1 || actual[0].column_name !== column || Number(actual[0].position) !== 1 || Number(actual[0].non_unique) !== Number(!unique) || actual[0].prefix_length !== null) fail();
        }
        const migration = migrations.find(row => /^CREATE\s+TABLE\s+announcements\s*\(/i.test(row.sql.trim()));
        const checks = await connection.query("SELECT CONSTRAINT_NAME AS name, CHECK_CLAUSE AS clause FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = ? AND TABLE_NAME = 'announcements'", [database]);
        for (const match of migration.sql.matchAll(/CONSTRAINT\s+([a-z_]+)\s+CHECK\s*\(/gi)) {
          const actual = checks.find(row => row.name === match[1]);
          if (!actual || normalizedCheckTree(actual.clause) !== normalizedCheckTree(authoredMigrationCheck(migration.sql, match[1]))) fail();
        }
        const keys = await connection.query(`SELECT k.CONSTRAINT_NAME AS name, k.COLUMN_NAME AS child, k.REFERENCED_TABLE_NAME AS parent,
          k.REFERENCED_TABLE_SCHEMA AS parent_schema, k.REFERENCED_COLUMN_NAME AS parent_column, k.ORDINAL_POSITION AS position,
          r.UPDATE_RULE AS update_rule, r.DELETE_RULE AS delete_rule FROM information_schema.KEY_COLUMN_USAGE k
          JOIN information_schema.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.TABLE_NAME = k.TABLE_NAME AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
          WHERE k.TABLE_SCHEMA = ? AND k.TABLE_NAME = 'announcements' AND k.REFERENCED_TABLE_NAME IS NOT NULL`, [database]);
        const expected = [["announcements_owner_fk", "admin_id", "users", "id", 1], ["announcements_owner_fk", "admin_role", "users", "role", 2], ["announcements_campaign_fk", "campaign_id", "broadcast_campaigns", "id", 1]];
        if (keys.length !== expected.length || expected.some(([name, child, parent, parentColumn, position]) => !keys.some(row => row.name === name && row.child === child && row.parent === parent
          && row.parent_column === parentColumn && row.parent_schema === database && Number(row.position) === position && row.update_rule === "RESTRICT" && row.delete_rule === "RESTRICT"))) fail();
        const enforcement = (await connection.query("SELECT @@SESSION.foreign_key_checks AS fk, @@SESSION.check_constraint_checks AS ck"))[0];
        if (Number(enforcement?.fk) !== 1 || Number(enforcement?.ck) !== 1) fail();
        await connection.query(`SELECT ${COLUMNS} FROM announcements WHERE 1 = 0`); return true;
      } catch (error) { if (error instanceof AnnouncementsError) throw error; fail(); }
      finally { connection?.release(); }
    },
    current({ role, tokenHash, now }) {
      return withActor({ role, tokenHash, now }, async (connection, context) => {
        if (role === "client" && context.conversation.closed_at !== null) return { serverTime: nowAt(context.now), announcement: null };
        const row = await rowFor(connection, context.admin.id); return view(row, context.admin.id, nowAt(context.now), role);
      });
    },
    save({ tokenHash, now, input }) {
      input = validateSave(input);
      return withActor({ role: "admin", tokenHash, now }, async (connection, context) => {
        const row = await rowFor(connection, context.actor.id); decode(row, context.actor.id);
        const fingerprint = announcementFingerprint({ kind: "save", ...input }, key, { adminId: context.actor.id });
        if (identity(row, input, fingerprint)) return { ...view(row, context.actor.id, nowAt(context.now)), duplicate: true };
        now = nowAt(context.now); checkWindow(input, now);
        const startsAt = input.startsAt ?? now, nextRevision = String(BigInt(input.expectedRevision) + 1n), announcementId = randomBytes(16);
        await cancelPrevious(connection, context, row);
        let campaignId = null;
        if (input.sendPrivateMessage) {
          const audience = { mode: "all" }, selectorHash = audienceSelectorHash(audience);
          const previewBinding = { adminId: context.actor.id.toString("hex"), selectorHash, mediaId: null };
          let snapshot;
          try { snapshot = readPreviewToken(input.previewToken, key, previewBinding, { now, fresh: false }); } catch { fail("ANNOUNCEMENTS_CONFLICT"); }
          if (snapshot.count < 1) fail("ANNOUNCEMENTS_CONFLICT");
          campaignId = randomBytes(16);
          const payload = { version: 2, title: "Annonce", body: input.body, mediaId: null, allowRepeatMedia: false,
            audience: { mode: "all", count: snapshot.count, digest: snapshot.digest, selectorHash } };
          const result = await broadcastStore.createAudienceInTransaction(connection, { ...context, now }, { audience, snapshot,
            verifyPreview: value => readPreviewToken(input.previewToken, key, previewBinding, { now: value }),
            availableAt: startsAt, expiresAt: input.expiresAt,
            campaign: { id: campaignId, clientCampaignId: announcementId, requestFingerprint: campaignFingerprint(payload, key, { adminId: context.actor.id }),
              payloadEncrypted: sealPayload(payload, key, { campaignId, adminId: context.actor.id }), mediaId: null, allowRepeatMedia: false,
              recipientProof: binding => recipientProof(key, binding) } });
          if (result?.duplicate !== false || !result.campaign?.id?.equals(campaignId)) fail();
        }
        const completedAt = nowAt(now); checkWindow(input, completedAt);
        const encrypted = sealAnnouncement({ body: input.body }, key, { adminId: context.actor.id, id: announcementId, revision: nextRevision,
          startsAt, expiresAt: input.expiresAt, sendPrivateMessage: input.sendPrivateMessage });
        const values = [announcementId, nextRevision, Buffer.from(input.mutationId, "hex"), fingerprint, encrypted, sqlDate(startsAt), sqlDate(input.expiresAt),
          Number(input.sendPrivateMessage), campaignId, sqlDate(now), sqlDate(completedAt), context.actor.id];
        if (row) await connection.query(`UPDATE announcements SET id = ?, revision = ?, mutation_id = ?, request_fingerprint = ?, body_encrypted = ?,
          starts_at = ?, expires_at = ?, send_private_message = ?, campaign_id = ?, removed_at = NULL, created_at = ?, updated_at = ? WHERE admin_id = ?`, values);
        else await connection.query(`INSERT INTO announcements (id, revision, mutation_id, request_fingerprint, body_encrypted, starts_at, expires_at,
          send_private_message, campaign_id, created_at, updated_at, admin_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, values);
        const saved = await rowFor(connection, context.actor.id); checkWindow(input, nowAt(completedAt));
        return { ...view(saved, context.actor.id, nowAt(completedAt)), duplicate: false };
      });
    },
    remove({ tokenHash, now, input }) {
      input = validateRemove(input);
      return withActor({ role: "admin", tokenHash, now }, async (connection, context) => {
        const row = await rowFor(connection, context.actor.id), value = decode(row, context.actor.id);
        const fingerprint = announcementFingerprint({ kind: "remove", ...input }, key, { adminId: context.actor.id });
        if (identity(row, input, fingerprint)) return { ...view(row, context.actor.id, nowAt(context.now)), duplicate: true };
        if (!value) fail("ANNOUNCEMENTS_CONFLICT");
        await cancelPrevious(connection, context, row);
        const revision = String(BigInt(input.expectedRevision) + 1n), updatedAt = nowAt(context.now);
        const encrypted = sealAnnouncement({ body: value.body }, key, { adminId: context.actor.id, id: bytes(row.id), revision,
          startsAt: value.startsAt, expiresAt: value.expiresAt, sendPrivateMessage: value.sendPrivateMessage });
        await connection.query("UPDATE announcements SET revision = ?, mutation_id = ?, request_fingerprint = ?, body_encrypted = ?, removed_at = ?, updated_at = ? WHERE admin_id = ?",
          [revision, Buffer.from(input.mutationId, "hex"), fingerprint, encrypted, sqlDate(updatedAt), sqlDate(updatedAt), context.actor.id]);
        return { ...view(await rowFor(connection, context.actor.id), context.actor.id, nowAt(updatedAt)), duplicate: false };
      });
    },
  });
}
