import { createHmac } from "node:crypto";
import { tokenDigest } from "../auth/crypto.mjs";
import { createQuickRepliesFiles } from "./files.mjs";
import { QuickRepliesError, failQuickReplies, ownerId, quickRepliesView, validateSave } from "./validation.mjs";

const instant = value => { if (!Number.isSafeInteger(value) || value < 0 || value > 253402300799999) failQuickReplies(); return value; };
function actorView(value) {
  if (!value?.user || value.user.role !== "admin") failQuickReplies("QUICK_REPLIES_UNAUTHORIZED");
  try { ownerId(value.user.id); tokenDigest(value.csrf); instant(value.expiresAt); }
  catch { failQuickReplies(); }
  return value;
}
export function createQuickRepliesService({ directory, key, chatService, chatStore, authStore, clock = Date.now } = {}, internal = {}) {
  if (typeof directory !== "string" || typeof chatService?.actor !== "function" || typeof chatStore?.withActor !== "function"
    || typeof authStore?.consumeRateLimit !== "function" || !Buffer.isBuffer(key) || key.length !== 32 || typeof clock !== "function") throw new TypeError("A private saved replies configuration is required.");
  key = Buffer.from(key);
  const files = new Map(); let closed = false;
  const available = () => { if (closed) failQuickReplies(); };
  async function guarded(work) {
    try { available(); const result = await work(); available(); return result; }
    catch (error) {
      if (error instanceof QuickRepliesError) throw error;
      if (["AUTH_INVALID", "CHAT_UNAUTHORIZED"].includes(error?.code)) failQuickReplies("QUICK_REPLIES_UNAUTHORIZED");
      if (["CHAT_FORBIDDEN", "ACCESS_EXPIRED", "ACCESS_PREREQUISITES"].includes(error?.code)) failQuickReplies("QUICK_REPLIES_FORBIDDEN");
      if (["AUTH_RATE_LIMIT", "AUTH_BUSY", "CHAT_RATE_LIMIT"].includes(error?.code)) throw new QuickRepliesError("QUICK_REPLIES_RATE_LIMIT", error.retryAfter);
      failQuickReplies();
    }
  }
  async function actor(token) {
    try { tokenDigest(token); } catch { failQuickReplies("QUICK_REPLIES_UNAUTHORIZED"); }
    const value = actorView(await chatService.actor("admin", token));
    if (value.expiresAt <= instant(clock())) failQuickReplies("QUICK_REPLIES_UNAUTHORIZED");
    return value;
  }
  function filesFor(owner) {
    available();
    if (!files.has(owner)) files.set(owner, (internal.filesFor ?? (id => createQuickRepliesFiles(directory, key, id, internal.filesInternal)))(owner));
    return files.get(owner);
  }
  async function context(token, mutation) {
    const session = await actor(token), now = instant(clock());
    for (const [name, identity, limit] of [[mutation ? "user-save" : "user-read", session.user.id, mutation ? 30 : 120], [mutation ? "global-save" : "global-read", "all", mutation ? 120 : 1200]]) {
      const bucket = createHmac("sha256", key).update("jessiemessage:quick-replies-rate:v1:").update(name).update("\0").update(identity).digest();
      const result = await authStore.consumeRateLimit(bucket, { now, windowSeconds: 60, limit });
      if (!result || typeof result.allowed !== "boolean") failQuickReplies();
      if (!result.allowed) throw new QuickRepliesError("QUICK_REPLIES_RATE_LIMIT", result.retryAfter);
    }
    return { session, request: { role: "admin", tokenHash: tokenDigest(token), now: instant(clock()) } };
  }
  function dto(value, owner) {
    if (!value || value.ownerId !== owner || !Number.isSafeInteger(value.revision)) failQuickReplies();
    try { return quickRepliesView({ version: String(value.revision), replies: value.replies }); } catch { failQuickReplies(); }
  }
  async function authorized(token, mutation, work) {
    const current = await context(token, mutation);
    let ownError;
    try {
      return await chatStore.withActor(current.request, async (_connection, live) => {
        try {
          available();
          if (live?.actor?.role !== "admin" || !Buffer.isBuffer(live.actor.id) || live.actor.id.toString("hex") !== current.session.user.id) failQuickReplies("QUICK_REPLIES_UNAUTHORIZED");
          const authorize = async () => { available(); if (instant(clock()) >= current.session.expiresAt) failQuickReplies("QUICK_REPLIES_UNAUTHORIZED"); };
          const result = dto(await work(filesFor(current.session.user.id), authorize), current.session.user.id);
          await authorize(); return result;
        } catch (error) { ownError = error; throw error; }
      });
    } catch (error) { if (ownError) throw ownError; throw error; }
  }
  return Object.freeze({
    actor: token => guarded(() => actor(token)),
    read: token => guarded(() => authorized(token, false, async files => files.read())),
    save: (token, input) => guarded(async () => {
      input = validateSave(input);
      return authorized(token, true, (files, authorize) => files.save(input.replies, Number(input.expectedVersion), authorize));
    }),
    close() { closed = true; for (const file of files.values()) file.close(); files.clear(); key.fill(0); },
  });
}
