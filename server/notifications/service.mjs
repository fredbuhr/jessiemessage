import { createHmac } from "node:crypto";
import { tokenDigest } from "../auth/crypto.mjs";
import { endpointDigest } from "./crypto.mjs";
import { validatePushEndpoint, validateSubscription, validateLocale } from "./validation.mjs";

const MAX_INSTANT = 253402300799999;
const MAX_STATUS_ROWS = 64;
const id = (value) => typeof value === "string" && value.length === 32 && /^[a-f0-9]{32}$/.test(value);
const instant = (value) => Number.isSafeInteger(value) && value >= 0 && value <= MAX_INSTANT;
const allowedErrors = new Set(["CHAT_UNAUTHORIZED", "CHAT_FORBIDDEN", "CHAT_RATE_LIMIT", "AUTH_BUSY", "AUTH_RATE_LIMIT",
  "ACCESS_EXPIRED", "ACCESS_PREREQUISITES", "NOTIFICATIONS_CONFLICT", "NOTIFICATIONS_LIMIT", "NOTIFICATIONS_NOT_FOUND"]);

export class NotificationsError extends Error {
  constructor(code, retryAfter) {
    super("Message notifications could not be updated."); this.name = "NotificationsError"; this.code = code;
    if (retryAfter !== undefined) this.retryAfter = retryAfter;
  }
}
const fail = (code) => { throw new NotificationsError(code); };

function shape(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== keys.length
    || keys.some((key) => !Object.hasOwn(value, key))) fail("NOTIFICATIONS_INPUT");
}
function subscriptionDTO(value, now) {
  if (!value || !id(value.id) || typeof value.enabled !== "boolean" || !instant(value.createdAt) || !instant(value.updatedAt)
    || value.updatedAt < value.createdAt || value.updatedAt > now) fail("NOTIFICATIONS_UNAVAILABLE");
  return { id: value.id, enabled: value.enabled, createdAt: value.createdAt, updatedAt: value.updatedAt };
}
function statusDTO(value, now, current = false) {
  if (!value || !Array.isArray(value.subscriptions) || value.subscriptions.length > MAX_STATUS_ROWS) fail("NOTIFICATIONS_UNAVAILABLE");
  const subscriptions = value.subscriptions.map((row) => subscriptionDTO(row, now));
  if (new Set(subscriptions.map((row) => row.id)).size !== subscriptions.length
    || subscriptions.filter((row) => row.enabled).length > 16) fail("NOTIFICATIONS_UNAVAILABLE");
  if (current && !(value.currentId === null || id(value.currentId)
    && subscriptions.some((row) => row.id === value.currentId))) fail("NOTIFICATIONS_UNAVAILABLE");
  return { subscriptions, currentId: current ? value.currentId : null };
}
function publicKey(value) {
  if (typeof value !== "string" || value.length !== 87 || !/^[A-Za-z0-9_-]{87}$/.test(value)) return false;
  const bytes = Buffer.from(value, "base64url");
  return bytes.length === 65 && bytes[0] === 4 && bytes.toString("base64url") === value;
}

/** No network transport belongs to the authenticated subscription service. */
export async function createNotificationsService({ store, config, chatService, authStore, clock = Date.now }) {
  if (config?.enabled !== true || !Buffer.isBuffer(config.key) || config.key.length !== 32 || !publicKey(config.vapid?.publicKey)
    || typeof clock !== "function" || typeof chatService?.actor !== "function" || typeof authStore?.consumeRateLimit !== "function"
    || ["status", "subscribe", "disable", "open"].some((method) => typeof store?.[method] !== "function")) fail("NOTIFICATIONS_CONFIG");
  const key = Buffer.from(config.key), vapidPublicKey = config.vapid.publicKey;
  const nowValue = () => { const now = clock(); if (!instant(now)) fail("NOTIFICATIONS_UNAVAILABLE"); return now; };
  async function guarded(operation) {
    try { return await operation(); }
    catch (error) {
      if (error instanceof NotificationsError) throw error;
      if (error?.code === "AUTH_INVALID") fail("CHAT_UNAUTHORIZED");
      if (["NOTIFICATIONS_INPUT", "NOTIFICATIONS_STORE_INPUT"].includes(error?.code)) fail("NOTIFICATIONS_INPUT");
      if (allowedErrors.has(error?.code)) throw new NotificationsError(error.code, error.retryAfter);
      fail("NOTIFICATIONS_UNAVAILABLE");
    }
  }
  async function actor(role, raw) {
    if (!["admin", "client"].includes(role)) fail("NOTIFICATIONS_INPUT");
    try { tokenDigest(raw); } catch { fail("CHAT_UNAUTHORIZED"); }
    const result = await chatService.actor(role, raw);
    if (!result || result.user?.role !== role) fail("CHAT_UNAUTHORIZED");
    if (!id(result.user.id)) fail("NOTIFICATIONS_UNAVAILABLE");
    return result;
  }
  async function context(role, raw) {
    const session = await actor(role, raw);
    return { session, request: { role, tokenHash: tokenDigest(raw) } };
  }
  async function limit(session, kind, now) {
    // Pay the account budget first; one exhausted account must not spend the
    // global allowance. Sessions on the same account share this fixed ceiling.
    const budgets = [[`user-${kind}`, `${session.user.role}:${session.user.id}`, kind === "read" ? 120 : 30],
      [`global-${kind}`, "all", kind === "read" ? 600 : 300]];
    for (const [name, identity, maximum] of budgets) {
      const bucket = createHmac("sha256", key).update("jessiemessage:notifications-rate:v1:").update(name).update("\0").update(identity).digest();
      const result = await authStore.consumeRateLimit(bucket, { now, windowSeconds: 60, limit: maximum });
      if (!result || typeof result.allowed !== "boolean") fail("NOTIFICATIONS_UNAVAILABLE");
      if (!result.allowed) throw new NotificationsError("NOTIFICATIONS_RATE_LIMIT", Number.isFinite(result.retryAfter)
        ? Math.max(1, Math.min(3600, Math.ceil(result.retryAfter))) : 60);
    }
  }
  return Object.freeze({
    actor: (role, raw) => guarded(() => actor(role, raw)),
    open: (role, raw, input = {}) => guarded(async () => {
      shape(input, ["notification"]);
      if (!id(input.notification)) fail("NOTIFICATIONS_INPUT");
      const { session, request } = await context(role, raw);
      await limit(session, "read", nowValue());
      const result = await store.open({ ...request, notificationId: Buffer.from(input.notification, "hex"), now: nowValue() });
      if (!result || !id(result.conversationId) || !id(result.messageId) || typeof result.sequence !== "string"
        || !/^[1-9][0-9]{0,19}$/.test(result.sequence) || BigInt(result.sequence) > 18446744073709551615n) fail("NOTIFICATIONS_UNAVAILABLE");
      return { conversationId: result.conversationId, messageId: result.messageId, sequence: result.sequence };
    }),
    capabilities: (role, raw) => guarded(async () => {
      const { session, request } = await context(role, raw);
      await limit(session, "read", nowValue());
      const stored = await store.status({ ...request, now: nowValue() });
      const result = statusDTO(stored, nowValue());
      return { enabled: true, vapidPublicKey, subscriptions: result.subscriptions };
    }),
    status: (role, raw, input = {}) => guarded(async () => {
      shape(input, ["endpoint"]);
      const { session, request } = await context(role, raw);
      const endpoint = validatePushEndpoint(input.endpoint);
      await limit(session, "read", nowValue());
      const stored = await store.status({ ...request, now: nowValue(), endpointDigest: endpointDigest(endpoint, key) });
      const result = statusDTO(stored, nowValue(), true);
      const current = result.subscriptions.find((row) => row.id === result.currentId && row.enabled);
      return { enabled: Boolean(current), subscriptionId: current?.id ?? null };
    }),
    subscribe: (role, raw, input = {}) => guarded(async () => {
      shape(input, ["subscription", "language"]);
      const { session, request } = await context(role, raw);
      const subscription = validateSubscription(input.subscription), locale = validateLocale(input.language);
      await limit(session, "update", nowValue());
      const stored = await store.subscribe({ ...request, now: nowValue(), subscription, locale });
      const result = subscriptionDTO(stored, nowValue());
      if (!result.enabled) fail("NOTIFICATIONS_UNAVAILABLE");
      return { enabled: true, subscriptionId: result.id };
    }),
    disable: (role, raw, input = {}) => guarded(async () => {
      shape(input, ["id"]);
      if (!id(input.id)) fail("NOTIFICATIONS_INPUT");
      const { session, request } = await context(role, raw);
      await limit(session, "update", nowValue());
      const result = await store.disable({ ...request, now: nowValue(), id: Buffer.from(input.id, "hex") });
      if (result === false) fail("NOTIFICATIONS_NOT_FOUND");
      if (result !== true) fail("NOTIFICATIONS_UNAVAILABLE");
      return { enabled: false };
    }),
  });
}
