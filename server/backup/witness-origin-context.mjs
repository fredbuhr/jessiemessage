import { createHmac } from "node:crypto";
import { loadRuntimeBroadcastEnvironment, BROADCAST_RUNTIME_OPTIONS } from "../config/runtime-broadcast.mjs";
import { clearRuntimeMessagingSecrets } from "../config/runtime-messaging.mjs";
import { privateAuthenticationProcessOptions } from "../config/private-auth-environment.mjs";
import { mediaConfiguration } from "../media/config.mjs";
import { createMediaStorage } from "../media/storage.mjs";
import { createMediaCapacityStore } from "../media/capacity-store.mjs";
import { createRuntimePool } from "../db/runtime.mjs";

const fail = () => { throw Object.assign(new Error("The configured witness origin is unavailable."), { code: "WITNESS_ORIGIN_CONTEXT" }); };
const fingerprint = (env, key) => createHmac("sha256", key).update("jessiemessage:witness-origin:configuration:v1:")
  .update(JSON.stringify(Object.fromEntries(Object.keys(env).sort().map(name => [name, env[name]])))).digest("hex");

/** Reads the existing six private configurations and initialized media capacity.
 * No listener, delivery worker, key generation, schema change or SQL mutation.
 * The callback owns no key after this scope. No configuration is printed. */
export async function withConfiguredWitnessOrigin(options, { environment = process.env, signal } = {}, work, internal = {}) {
  const load = internal.loadEnvironment ?? loadRuntimeBroadcastEnvironment;
  let env, key, media, pool, rootFingerprint;
  const active = () => { if (signal?.aborted) fail(); };
  try {
    const processOptions = privateAuthenticationProcessOptions(environment, []);
    if (typeof work !== "function") fail(); active();
    const parameters = { ...processOptions, ...BROADCAST_RUNTIME_OPTIONS };
    env = await load(options.privateDirectory, parameters);
    key = Buffer.from(env.JESSIEMESSAGE_CRM_KEY ?? "", "base64url");
    if (key.length !== 32 || key.toString("base64url") !== env.JESSIEMESSAGE_CRM_KEY) fail();
    media = (internal.mediaConfiguration ?? mediaConfiguration)(env);
    if (media.enabled !== true) fail();
    const storage = await (internal.makeStorage ?? createMediaStorage)({ root: media.root, key: media.key, pathMode: "linux-dirfd" });
    rootFingerprint = await storage.fingerprint();
    if (!Buffer.isBuffer(rootFingerprint) || rootFingerprint.length !== 32) fail();
    pool = await (internal.createPool ?? createRuntimePool)(env);
    const capacity = (internal.makeCapacity ?? createMediaCapacityStore)({ pool, capacity: { ...media.capacity, rootFingerprint } });
    await capacity.assertSchema();
    const checkCapacity = async () => {
      active(); const state = await capacity.status();
      if (state.ready !== true || !Buffer.isBuffer(state.rootFingerprint) || !state.rootFingerprint.equals(rootFingerprint)
        || state.ownerBytes !== media.capacity.ownerBytes || state.totalBytes !== media.capacity.totalBytes) fail();
      active();
    };
    await checkCapacity();
    const configurationFingerprint = fingerprint(env, key);
    const context = Object.freeze({ key, mediaRoot: media.root, configurationFingerprint,
      binding: Object.freeze({ database: env.JESSIEMESSAGE_DB_NAME, rootFingerprint: rootFingerprint.toString("hex") }),
      async assertReady() {
        let current, observed;
        try {
          active(); current = await load(options.privateDirectory, parameters);
          if (fingerprint(current, key) !== configurationFingerprint) fail();
          observed = await storage.fingerprint();
          if (!Buffer.isBuffer(observed) || !observed.equals(rootFingerprint)) fail();
          active();
        } finally { observed?.fill(0); clearRuntimeMessagingSecrets(current); }
      },
      checkCapacity,
    });
    active(); const result = await work(context);
    await context.assertReady(); await checkCapacity(); active(); return result;
  } catch { fail(); }
  finally {
    key?.fill(0); rootFingerprint?.fill(0); media?.key?.fill(0); clearRuntimeMessagingSecrets(env);
    try { await pool?.end(); } catch { fail(); }
  }
}
