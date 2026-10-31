// Historical offline CLI: SQL33, or SQL36 for its explicit video export.
// It intentionally refuses the SQL38 experience profile. Do not use it as
// the current hosted data operator or weaken its schema guard.
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runtimeDatabaseOptions } from "../server/db/runtime.mjs";
import { withClientData } from "../server/data/store.mjs";
import { DATA_POLICY, DATA_POLICY_METADATA } from "../server/data/policy.mjs";
import { exportClientContent } from "../server/data/export.mjs";
import { createDataWriter } from "../server/data/writer.mjs";
import { buildDeletionPlan } from "../server/data/deletion.mjs";
import { loadMigrations } from "../server/db/migrations.mjs";
import { runtimeVideoConfiguration, assertDistinctVideoRoots } from "../server/config/runtime-video-storage.mjs";
import { createVideoDataReader } from "../server/video/data-store.mjs";

const CHECKOUT = fileURLToPath(new URL("../", import.meta.url));
const MAX_DATE = 253402300799999;
const VIDEO_PROFILE = "photos-notify-recovery-crm-broadcast-video";
export class DataCliError extends Error {
  constructor(code = "DATA_OPERATION") {
    super("Private client data operation failed. Consult the offline data procedure.");
    this.name = "DataCliError"; this.code = code;
  }
}
const fail = (code) => { throw new DataCliError(code); };
const pathValue = (value) => typeof value === "string" && value.length <= 4096 && isAbsolute(value)
  && resolve(value) === value && !/[\x00-\x1f\x7f]/.test(value);
function key(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value)) fail("DATA_CONFIG");
  const result = Buffer.from(value, "base64url");
  if (result.length !== 32 || result.toString("base64url") !== value) fail("DATA_CONFIG");
  return result;
}
export function parseArguments(args) {
  if (!Array.isArray(args) || ![10, 12].includes(args.length) || args.some((value) => typeof value !== "string")
    || !["inventory", "export", "plan"].includes(args[0]) || args[1] !== "--offline" || args[2] !== "--database"
    || !/^[a-zA-Z0-9_]{1,64}$/.test(args[3]) || args[4] !== "--client" || !/^[a-f0-9]{32}$/.test(args[5])
    || args[6] !== "--confirm-client" || args[7] !== args[5] || args[8] !== "--output" || !pathValue(args[9])
    || args.length === 12 && (args[0] !== "export" || args[10] !== "--profile" || args[11] !== VIDEO_PROFILE)) fail("DATA_USAGE");
  return { command: args[0], offline: true, databaseName: args[3], clientId: Buffer.from(args[5], "hex"), output: args[9],
    ...(args.length === 12 ? { video: true } : {}) };
}
function configuration(env, command, { video = false } = {}) {
  const databaseName = runtimeDatabaseOptions(env).database;
  const mediaRoot = env.JESSIEMESSAGE_MEDIA_ROOT ?? null;
  if (mediaRoot !== null && !pathValue(mediaRoot)) fail("DATA_CONFIG");
  const candidate = video ? runtimeVideoConfiguration(env) : null;
  return { databaseName, mediaRoot, messageKey: command === "export" ? key(env.JESSIEMESSAGE_MESSAGE_KEY) : null,
    ...(video ? { videoRoot: candidate.root, videoKey: candidate.key } : {}) };
}
function inventoryDTO(value, policy) {
  if (!Array.isArray(policy) || policy.length !== 32 || !Array.isArray(value) || value.length !== policy.length) fail("DATA_OPERATION");
  const seen = new Set();
  return value.map((item) => {
    const category = policy.find((candidate) => candidate.table === item?.table);
    if (!category || seen.has(item.table) || item.scope !== category.scope || typeof item.truncated !== "boolean") fail("DATA_OPERATION");
    seen.add(item.table);
    if (item.scope === "subject") {
      if (!Number.isSafeInteger(item.count) || item.count < 0 || item.count > 10000 || item.truncated && item.count !== 10000) fail("DATA_OPERATION");
    } else if (!["administrator", "global"].includes(item.scope) || item.count !== null || item.truncated !== false) fail("DATA_OPERATION");
    return { table: item.table, scope: item.scope, count: item.count, truncated: item.truncated };
  });
}
function safeSummary(value, command = "export", video = false) {
  const fields = command === "plan" ? ["inventoryCategories", "observations", "affectedCategories", "blockers"]
    : command === "inventory" ? ["inventoryCategories"] : ["messages", "mediaFiles", "libraryItems", "mediaBytes", "rows", ...(video ? ["videoFiles", "videoBytes", "videoLibraryItems"] : [])];
  if (!value || fields.some((field) => !Number.isSafeInteger(value[field]) || value[field] < 0)) fail("DATA_OPERATION");
  return Object.fromEntries(fields.map((field) => [field, value[field]]));
}

/** Privileged local operator only: --offline never claims that other producers were stopped. */
export async function main(args = process.argv.slice(2), env = process.env, dependencies = {}) {
  const options = parseArguments(args);
  let config, pool, writer, storage, storageTask, videoStorageTask, messageKey, videoKey, result, failure;
  const checkAbort = () => { if (dependencies.signal?.aborted) fail("DATA_ABORTED"); };
  try {
    checkAbort();
    config = (dependencies.configure ?? configuration)(env, options.command, ...(options.video ? [{ video: true }] : []));
    if (!config || config.databaseName !== options.databaseName || config.mediaRoot !== null && !pathValue(config.mediaRoot)
      || options.command === "export" && (!Buffer.isBuffer(config.messageKey) || config.messageKey.length !== 32)
      || options.video && (config.mediaRoot === null || !pathValue(config.videoRoot) || !Buffer.isBuffer(config.videoKey) || config.videoKey.length !== 32
        || config.videoKey.equals(config.messageKey))) fail("DATA_CONFIG");
    if (options.command === "export") messageKey = Buffer.from(config.messageKey);
    if (options.video) { videoKey = Buffer.from(config.videoKey); await (dependencies.inspectRoots ?? assertDistinctVideoRoots)(config.mediaRoot, config.videoRoot); }
    const now = (dependencies.clock ?? Date.now)();
    if (!Number.isSafeInteger(now) || now < 0 || now > MAX_DATE) fail("DATA_CONFIG");
    pool = await (dependencies.createPool ?? (await import("../server/db/runtime.mjs")).createRuntimePool)(env);
    const schema = dependencies.makeSchemaStore ? dependencies.makeSchemaStore(pool)
      : (await import("../server/auth/store.mjs")).createAuthStore(pool);
    await schema.assertSchema(...(options.video ? [{ video: true }] : [])); checkAbort();
    if (options.video) {
      const check = dependencies.checkVideoSchema ?? (async () => {
        const [{ assertErasureSchema }, { loadVideoMigrations }] = await Promise.all([import("../server/data/erasure-schema.mjs"), import("../server/video/migrations.mjs")]);
        const connection = await pool.getConnection();
        try { await assertErasureSchema(connection, options.databaseName, { candidateMigrations: await loadVideoMigrations() }); }
        finally { connection.release(); }
      });
      await check(pool, options.databaseName); checkAbort();
    }
    const policy = dependencies.policy ?? DATA_POLICY;
    const source = dependencies.withClientData ?? withClientData;
    const summary = await source({ pool, clientId: options.clientId, now, ...(options.video ? { video: createVideoDataReader() } : {}) }, async (reader) => {
      checkAbort();
      if (reader?.account?.role !== "client" || !Buffer.isBuffer(reader.account.id) || !reader.account.id.equals(options.clientId)) fail("DATA_OPERATION");
      writer = await (dependencies.makeWriter ?? createDataWriter)({ output: options.output,
        protectedRoots: [resolve(CHECKOUT), ...(config.mediaRoot === null ? [] : [config.mediaRoot]), ...(options.video ? [config.videoRoot] : [])],
        ...(options.video ? { video: true } : {}) });
      if (options.command === "plan") {
        const inventory = inventoryDTO(await reader.inventory(), policy); checkAbort();
        const facts = await reader.deletionFacts(); checkAbort();
        const migrations = await (dependencies.loadMigrations ?? loadMigrations)(); checkAbort();
        const plan = buildDeletionPlan({ inventory, facts, now, migrations });
        await writer.json("deletion-plan.json", plan); checkAbort();
        return { inventoryCategories: plan.categories.length, observations: plan.observations.length,
          affectedCategories: plan.affectedCategories, blockers: plan.blockers.length };
      }
      if (options.command === "inventory") {
        const categories = inventoryDTO(await reader.inventory(), policy); checkAbort();
        await writer.json("policy.json", { format: "jessiemessage-data-policy", version: 1, automaticPurge: false, categories: policy,
          existingBehavior: DATA_POLICY_METADATA });
        await writer.json("inventory.json", { format: "jessiemessage-client-inventory", version: 1, generatedAt: new Date(now).toISOString(), categories });
        return { inventoryCategories: categories.length };
      }
      const media = { async get(value) {
        checkAbort();
        if (!storageTask) storageTask = (async () => {
          if (config.mediaRoot === null) fail("DATA_CONFIG");
          const mediaKey = key(env.JESSIEMESSAGE_MEDIA_KEY);
          try {
            if (mediaKey.equals(messageKey) || videoKey?.equals(mediaKey)) fail("DATA_CONFIG");
            storage = await (dependencies.makeStorage ?? (await import("../server/media/storage.mjs")).createMediaStorage)({ root: config.mediaRoot, key: mediaKey });
            return storage;
          } finally { mediaKey.fill(0); }
        })();
        const current = await storageTask; checkAbort();
        return current.get(value);
      } };
      const videos = options.video ? { async open(value) {
        checkAbort();
        videoStorageTask ??= Promise.resolve().then(async () => (dependencies.makeVideoStorage
          ?? (await import("../server/video/storage.mjs")).createVideoStorage)({ root: config.videoRoot, key: videoKey }));
        const current = await videoStorageTask; checkAbort(); return current.open(value);
      } } : null;
      // The wrapper checks interruption between every file/record. Existing
      // crypto/storage operations still finish their bounded in-flight read.
      const guardedWriter = Object.fromEntries(["empty", "json", "line", "media", ...(options.video ? ["video"] : [])].map((name) => [name, async (...values) => {
        checkAbort(); return writer[name](...values);
      }]));
      const exported = await (dependencies.exportContent ?? exportClientContent)({ reader, clientId: options.clientId, now,
        messageKey, storage: media, writer: guardedWriter, ...(options.video ? { videoStorage: videos, signal: dependencies.signal } : {}) });
      checkAbort(); return safeSummary(exported, "export", options.video === true);
    });
    checkAbort();
    // Finish the read transaction and close its pool before declaring files
    // complete. A failed acknowledgement/cleanup never produces success output.
    const sourcePool = pool; pool = null; await sourcePool.end(); checkAbort();
    const aggregate = safeSummary(summary, options.command, options.video === true);
    await writer.finalize(aggregate);
    result = { command: options.command, status: "complete", ...aggregate };
  } catch (error) { failure = error instanceof DataCliError ? error : new DataCliError(); }
  finally {
    messageKey?.fill(0); videoKey?.fill(0);
    if (dependencies.configure === undefined) { config?.messageKey?.fill(0); config?.videoKey?.fill(0); }
    const outcomes = await Promise.allSettled([Promise.resolve().then(() => writer?.close()), Promise.resolve().then(() => pool?.end())]);
    if (outcomes.some((outcome) => outcome.status === "rejected")) failure = new DataCliError();
  }
  if (failure) throw failure;
  try { (dependencies.outputStream ?? process.stdout).write(`${JSON.stringify(result)}\n`); }
  catch { fail("DATA_OPERATION"); }
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    const code = error instanceof DataCliError ? error.code : "DATA_OPERATION";
    process.stderr.write(`${code}: Private client data operation failed.\n`); process.exitCode = 1;
  });
}
