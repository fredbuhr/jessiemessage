import { resolve, isAbsolute, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { authConfiguration } from "../auth/config.mjs";
import { accessConfiguration } from "../access/config.mjs";
import { chatConfiguration } from "../chat/config.mjs";

export class MediaConfigError extends Error {
  constructor() { super("Explicit and valid private media configuration is required."); this.name = "MediaConfigError"; this.code = "MEDIA_CONFIG"; }
}
const within = (parent, child) => { const path = relative(parent, child); return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path)); };
const checkout = fileURLToPath(new URL("../../", import.meta.url));
const MAX_CAPACITY_BYTES = 1125899906842624;
function byteLimit(value, fallback, minimum) {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || value.length > 16 || !/^(?:0|[1-9][0-9]*)$/.test(value)) throw new MediaConfigError();
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < minimum || result > MAX_CAPACITY_BYTES || String(result) !== value) throw new MediaConfigError();
  return result;
}

export function mediaConfiguration(env = process.env) {
  const flag = env.JESSIEMESSAGE_ENABLE_MEDIA;
  if (flag === undefined || flag === "0") return { enabled: false };
  if (flag !== "1") throw new MediaConfigError();
  const chat = chatConfiguration(env), auth = authConfiguration(env), access = accessConfiguration(env);
  const encoded = env.JESSIEMESSAGE_MEDIA_KEY, root = env.JESSIEMESSAGE_MEDIA_ROOT;
  if (!chat.enabled || typeof encoded !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(encoded)) throw new MediaConfigError();
  const key = Buffer.from(encoded, "base64url");
  if (key.length !== 32 || key.toString("base64url") !== encoded || [chat.key, auth.totpKey, access.mail.key].some((other) => key.equals(other))) throw new MediaConfigError();
  if (typeof root !== "string" || root.length > 4096 || /[\x00-\x1f\x7f]/.test(root) || !isAbsolute(root) || root !== resolve(root)
    || within(checkout, root) || within(root, checkout)) throw new MediaConfigError();
  const ownerBytes = byteLimit(env.JESSIEMESSAGE_MEDIA_ACCOUNT_BYTES, 1073741824, 82);
  const totalBytes = byteLimit(env.JESSIEMESSAGE_MEDIA_TOTAL_BYTES, 10737418240, 82);
  const minimumFreeBytes = byteLimit(env.JESSIEMESSAGE_MEDIA_MIN_FREE_BYTES, 536870912, 0);
  if (ownerBytes > totalBytes) throw new MediaConfigError();
  return { enabled: true, origin: chat.origin, key, root, capacity: Object.freeze({ ownerBytes, totalBytes }), minimumFreeBytes };
}
