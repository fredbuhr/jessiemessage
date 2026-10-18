import { AuthConfigError, authConfiguration } from "../auth/config.mjs";
import { accessConfiguration } from "../access/config.mjs";

export function chatConfiguration(env = process.env) {
  const flag = env.JESSIEMESSAGE_ENABLE_CHAT;
  if (flag === undefined || flag === "0") return { enabled: false };
  if (flag !== "1") throw new AuthConfigError("CHAT_CONFIG");
  const auth = authConfiguration(env);
  const access = accessConfiguration(env);
  const encoded = env.JESSIEMESSAGE_MESSAGE_KEY;
  if (!auth.enabled || !access.enabled || typeof encoded !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(encoded)) throw new AuthConfigError("CHAT_CONFIG");
  const key = Buffer.from(encoded, "base64url");
  if (key.length !== 32 || key.toString("base64url") !== encoded || key.equals(auth.totpKey) || key.equals(access.mail.key)) throw new AuthConfigError("CHAT_CONFIG");
  return { enabled: true, origin: auth.origin, key };
}
