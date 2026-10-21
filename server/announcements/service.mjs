import { createHmac } from "node:crypto";
import { tokenDigest } from "../auth/crypto.mjs";
import { AnnouncementsError, bodyText, fields, fail, id, instant, revision, validateRemove, validateSave } from "./validation.mjs";

function checkedView(value, role = "admin", mutation = false) {
  fields(value, [...(role === "admin" ? ["serverTime", "revision", "announcement"] : ["serverTime", "announcement"]), ...(mutation ? ["duplicate"] : [])]);
  const serverTime = instant(value.serverTime);
  if (role === "admin") revision(value.revision);
  if (mutation && typeof value.duplicate !== "boolean") fail();
  let announcement = null;
  if (value.announcement !== null) {
    const a = value.announcement;
    fields(a, ["id", "revision", "body", "startsAt", "expiresAt", ...(role === "admin" ? ["status", "sendPrivateMessage", "campaignId"] : [])]);
    id(a.id); revision(a.revision, false); bodyText(a.body); instant(a.startsAt); instant(a.expiresAt);
    if (a.expiresAt <= a.startsAt || role === "client" && (serverTime < a.startsAt || serverTime >= a.expiresAt)) fail();
    announcement = { id: a.id, revision: a.revision, body: a.body, startsAt: a.startsAt, expiresAt: a.expiresAt };
    if (role === "admin") {
      if (value.revision !== a.revision || typeof a.sendPrivateMessage !== "boolean"
        || a.campaignId !== null && !a.sendPrivateMessage || !["scheduled", "visible", "expired"].includes(a.status)
        || a.status !== (serverTime < a.startsAt ? "scheduled" : serverTime < a.expiresAt ? "visible" : "expired")) fail();
      if (a.campaignId !== null) id(a.campaignId);
      Object.assign(announcement, { status: a.status, sendPrivateMessage: a.sendPrivateMessage, campaignId: a.campaignId });
    }
  }
  return { serverTime, ...(role === "admin" ? { revision: value.revision } : {}), announcement, ...(mutation ? { duplicate: value.duplicate } : {}) };
}
export function announcementView(value, role = "admin", mutation = false) {
  try { return checkedView(value, role, mutation); } catch { fail(); }
}

export async function createAnnouncementsService({ store, broadcastService, chatService, authService, authStore, key, clock = Date.now } = {}) {
  if (!["current", "save", "remove"].every(name => typeof store?.[name] === "function") || typeof broadcastService?.preview !== "function"
    || typeof chatService?.actor !== "function" || typeof authService?.session !== "function" || typeof authStore?.consumeRateLimit !== "function"
    || !Buffer.isBuffer(key) || key.length !== 32 || typeof clock !== "function") fail("ANNOUNCEMENTS_CONFIG");
  key = Buffer.from(key);
  async function guarded(operation) {
    try { return await operation(); }
    catch (error) {
      if (error instanceof AnnouncementsError) throw error;
      if (["AUTH_INVALID", "CHAT_UNAUTHORIZED", "BROADCAST_UNAUTHORIZED"].includes(error?.code)) fail("ANNOUNCEMENTS_UNAUTHORIZED");
      if (["CHAT_FORBIDDEN", "ACCESS_EXPIRED", "ACCESS_PREREQUISITES"].includes(error?.code)) fail("ANNOUNCEMENTS_FORBIDDEN");
      if (["AUTH_RATE_LIMIT", "AUTH_BUSY", "BROADCAST_RATE_LIMIT", "CHAT_RATE_LIMIT"].includes(error?.code)) throw new AnnouncementsError("ANNOUNCEMENTS_RATE_LIMIT", error.retryAfter);
      if (["BROADCAST_CONFLICT", "BROADCAST_LIMIT", "BROADCAST_RECIPIENTS"].includes(error?.code)) fail("ANNOUNCEMENTS_CONFLICT");
      fail();
    }
  }
  async function actor(role, token) {
    if (!["admin", "client"].includes(role)) fail("ANNOUNCEMENTS_UNAUTHORIZED");
    try { tokenDigest(token); } catch { fail("ANNOUNCEMENTS_UNAUTHORIZED"); }
    const session = await (role === "admin" ? authService.session(token) : chatService.actor("client", token));
    if (!session?.user || session.user.role !== role) fail("ANNOUNCEMENTS_UNAUTHORIZED");
    try { id(session.user.id); tokenDigest(session.csrf); instant(session.expiresAt); } catch { fail(); }
    if (typeof session.user.pseudonym !== "string" || session.user.pseudonym.length > 64 || !session.user.pseudonym.isWellFormed()) fail();
    return { user: { id: session.user.id, role, pseudonym: session.user.pseudonym }, csrf: session.csrf, expiresAt: session.expiresAt };
  }
  async function context(role, token, mutation = false) {
    const nowValue = () => { try { return instant(clock()); } catch { fail(); } };
    const session = await actor(role, token), now = nowValue();
    const budgets = mutation ? [["user-write", session.user.id, 30]] : [["user-read", session.user.id, 120], ["global-read", "all", 300]];
    for (const [name, identity, limit] of budgets) {
      const bucket = createHmac("sha256", key).update("jessiemessage:announcements-rate:v1:").update(name).update("\0").update(identity).digest();
      const allowed = await authStore.consumeRateLimit(bucket, { now, windowSeconds: 60, limit });
      if (!allowed || typeof allowed.allowed !== "boolean") fail();
      if (!allowed.allowed) throw new AnnouncementsError("ANNOUNCEMENTS_RATE_LIMIT", allowed.retryAfter);
    }
    return { tokenHash: tokenDigest(token), now: nowValue() };
  }
  return Object.freeze({
    actor: (role, token) => guarded(() => actor(role, token)),
    current: (role, token) => guarded(async () => announcementView(await store.current({ role, ...await context(role, token) }), role)),
    preview: (token, input) => guarded(async () => {
      fields(input, []); await context("admin", token);
      const value = await broadcastService.preview(token, { audience: { mode: "all" }, mediaId: null });
      if (![value.totalCount, value.eligibleCount, value.excludedCount].every(number => Number.isSafeInteger(number) && number >= 0)
        || value.totalCount !== value.eligibleCount + value.excludedCount || typeof value.previewToken !== "string"
        || value.previewToken.length < 1 || value.previewToken.length > 4096) fail();
      return { totalCount: value.totalCount, eligibleCount: value.eligibleCount, excludedCount: value.excludedCount, previewToken: value.previewToken };
    }),
    save: (token, input) => guarded(async () => {
      input = validateSave(input); return announcementView(await store.save({ ...await context("admin", token, true), input }), "admin", true);
    }),
    remove: (token, input) => guarded(async () => {
      input = validateRemove(input); return announcementView(await store.remove({ ...await context("admin", token, true), input }), "admin", true);
    }),
  });
}
