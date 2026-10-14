import { AuthConfigError, authConfiguration } from "../auth/config.mjs";
import { mailConfiguration } from "../mail/config.mjs";

export function accessConfiguration(env = process.env) {
  const flag = env.JESSIEMESSAGE_ENABLE_ACCESS;
  if (flag === undefined || flag === "0") return { enabled: false };
  if (flag !== "1") throw new AuthConfigError();
  const auth = authConfiguration(env);
  if (!auth.enabled) throw new AuthConfigError();
  const mail = mailConfiguration(env);
  if (!mail.enabled || mail.origin !== auth.origin || mail.key.equals(auth.totpKey)) throw new AuthConfigError();
  return { enabled: true, origin: auth.origin, mail };
}
