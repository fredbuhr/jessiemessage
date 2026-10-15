import { isIP } from "node:net";
import { canonicalEmail } from "../auth/config.mjs";
import { SITE_CONTACT_EMAIL, isOfficialOrigin } from "../site.mjs";

export class MailConfigError extends Error {
  constructor() {
    super("Explicit and valid private verification mail configuration is required.");
    this.name = "MailConfigError";
    this.code = "MAIL_CONFIG";
  }
}

const fail = () => { throw new MailConfigError(); };
const credential = (value, max) => typeof value === "string" && value.length > 0
  && value.length <= max && value.isWellFormed() && !/[\x00-\x1f\x7f]/.test(value);

export function mailConfiguration(env = process.env) {
  const flag = env.JESSIEMESSAGE_ENABLE_MAIL_DELIVERY;
  if (flag === undefined || flag === "0") return { enabled: false };
  if (flag !== "1") fail();
  const origin = env.JESSIEMESSAGE_SITE_ORIGIN;
  try {
    const url = new URL(origin);
    if (url.protocol !== "https:" || url.origin !== origin || url.username || url.password) fail();
  } catch { fail(); }
  const encodedKey = env.JESSIEMESSAGE_MAIL_KEY;
  if (typeof encodedKey !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(encodedKey)) fail();
  const key = Buffer.from(encodedKey, "base64url");
  if (key.length !== 32 || key.toString("base64url") !== encodedKey) fail();
  const host = env.JESSIEMESSAGE_SMTP_HOST;
  if (typeof host !== "string" || host.length > 253 || (!isIP(host)
    && host.split(".").some((label) => !/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(label)))) fail();
  const portText = env.JESSIEMESSAGE_SMTP_PORT;
  if (!["465", "587"].includes(portText)) fail();
  const user = env.JESSIEMESSAGE_SMTP_USER;
  const password = env.JESSIEMESSAGE_SMTP_PASSWORD;
  if (!credential(user, 256) || !credential(password, 1024)) fail();
  let from;
  try {
    from = canonicalEmail(env.JESSIEMESSAGE_SMTP_FROM === undefined
      ? SITE_CONTACT_EMAIL : env.JESSIEMESSAGE_SMTP_FROM);
  } catch { fail(); }
  if (isOfficialOrigin(origin) && from !== SITE_CONTACT_EMAIL) fail();
  const caPath = env.JESSIEMESSAGE_SMTP_TLS_CA_PATH;
  if (caPath !== undefined && (typeof caPath !== "string" || !caPath.length
    || caPath.length > 4096 || caPath.includes("\0"))) fail();
  return Object.freeze({ enabled: true, origin, key, smtp: Object.freeze({
    host, port: Number(portText), user, password, from, replyTo: from,
    ...(caPath === undefined ? {} : { caPath }),
  }) });
}
