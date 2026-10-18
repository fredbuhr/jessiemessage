import { createECDH } from "node:crypto";
import { chatConfiguration } from "../chat/config.mjs";

export class NotificationsConfigError extends Error {
  constructor() {
    super("Explicit and valid private notifications configuration is required.");
    this.name = "NotificationsConfigError";
    this.code = "NOTIFICATIONS_CONFIG";
  }
}

function decode(value, length) {
  if (typeof value !== "string" || value.length !== Math.ceil(length * 8 / 6) || !/^[A-Za-z0-9_-]+$/.test(value)) throw new NotificationsConfigError();
  const decoded = Buffer.from(value, "base64url");
  if (decoded.length !== length || decoded.toString("base64url") !== value) throw new NotificationsConfigError();
  return decoded;
}

export function validateNotificationVapid(vapid) {
  try {
    if (vapid?.subject !== "mailto:contact@jessiemessage.com") throw new Error();
    const publicKey = decode(vapid.publicKey, 65), privateKey = decode(vapid.privateKey, 32);
    const curve = createECDH("prime256v1");
    curve.setPrivateKey(privateKey);
    if (publicKey[0] !== 4 || !curve.getPublicKey().equals(publicKey)) throw new Error();
    return Object.freeze({ publicKey: vapid.publicKey, privateKey: vapid.privateKey, subject: vapid.subject });
  } catch { throw new NotificationsConfigError(); }
}

export function loadNotificationsConfig(env = process.env) {
  const flag = env.JESSIEMESSAGE_ENABLE_NOTIFICATIONS;
  if (flag === undefined || flag === "0") return { enabled: false };
  if (flag !== "1") throw new NotificationsConfigError();
  try {
    const chat = chatConfiguration(env);
    if (!chat.enabled) throw new Error();
    const key = decode(env.JESSIEMESSAGE_NOTIFICATIONS_KEY, 32);
    const vapid = validateNotificationVapid({
      publicKey: env.JESSIEMESSAGE_VAPID_PUBLIC_KEY,
      privateKey: env.JESSIEMESSAGE_VAPID_PRIVATE_KEY,
      subject: env.JESSIEMESSAGE_VAPID_SUBJECT,
    });
    const privateKey = decode(vapid.privateKey, 32);
    const domainKeys = ["MFA", "MAIL", "MESSAGE", "MEDIA", "CRM"].flatMap((name) => {
      const value = env[`JESSIEMESSAGE_${name}_KEY`];
      return value === undefined ? [] : [decode(value, 32)];
    });
    if (key.equals(privateKey) || domainKeys.some((other) => key.equals(other) || privateKey.equals(other))) throw new Error();
    return Object.freeze({ enabled: true, origin: chat.origin, key, vapid,
      worker: Object.freeze({ batchSize: 5, pollMilliseconds: 2000, leaseMilliseconds: 90000, maxAttempts: 6 }),
      transport: Object.freeze({ deadlineMilliseconds: 10000, maxResponseBytes: 8192, ttlSeconds: 86400 }),
    });
  } catch { throw new NotificationsConfigError(); }
}
