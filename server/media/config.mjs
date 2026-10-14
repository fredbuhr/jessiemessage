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
  return { enabled: true, origin: chat.origin, key, root };
}
