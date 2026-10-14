import { authConfiguration } from "../auth/config.mjs";
import { accessConfiguration } from "../access/config.mjs";
import { chatConfiguration } from "../chat/config.mjs";

export class CrmConfigError extends Error {
  constructor() { super("Explicit and valid private client tools configuration is required."); this.name = "CrmConfigError"; this.code = "CRM_CONFIG"; }
}
function keyValue(encoded) {
  if (typeof encoded !== "string" || encoded.length !== 43 || !/^[A-Za-z0-9_-]{43}$/.test(encoded)) throw new CrmConfigError();
  const key = Buffer.from(encoded, "base64url");
  if (key.length !== 32 || key.toString("base64url") !== encoded) throw new CrmConfigError();
  return key;
}
export function crmConfiguration(env = process.env) {
  const flag = env.JESSIEMESSAGE_ENABLE_CRM;
  if (flag === undefined || flag === "0") return { enabled: false };
  if (flag !== "1") throw new CrmConfigError();
  try {
    const auth = authConfiguration(env), access = accessConfiguration(env), chat = chatConfiguration(env);
    if (!chat.enabled || !auth.enabled || !access.enabled) throw new CrmConfigError();
    const key = keyValue(env.JESSIEMESSAGE_CRM_KEY);
    const others = [auth.totpKey, access.mail.key, chat.key];
    if (env.JESSIEMESSAGE_MEDIA_KEY !== undefined) others.push(keyValue(env.JESSIEMESSAGE_MEDIA_KEY));
    if (others.some((other) => key.equals(other))) throw new CrmConfigError();
    return { enabled: true, origin: chat.origin, key };
  } catch { throw new CrmConfigError(); }
}
