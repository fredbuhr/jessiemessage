export class AuthConfigError extends Error {
  constructor(code = "AUTH_CONFIG") {
    super("Explicit and valid private authentication configuration is required.");
    this.name = "AuthConfigError";
    this.code = code;
  }
}

export function canonicalEmail(value) {
  if (typeof value !== "string" || value.length > 254 || value !== value.trim() || !/^[\x21-\x7e]+$/.test(value)) throw new AuthConfigError("AUTH_INPUT");
  const parts = value.split("@");
  if (parts.length !== 2) throw new AuthConfigError("AUTH_INPUT");
  const [local, domain] = parts;
  if (!local.length || local.length > 64 || !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local)
    || local.startsWith(".") || local.endsWith(".") || local.includes("..") || !domain.includes(".")
    || domain.split(".").some((label) => !/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(label))) throw new AuthConfigError("AUTH_INPUT");
  return value.toLowerCase();
}

export function authConfiguration(env = process.env) {
  const flag = env.JESSIEMESSAGE_ENABLE_AUTH;
  if (flag === undefined || flag === "0") return { enabled: false };
  if (flag !== "1") throw new AuthConfigError();
  const origin = env.JESSIEMESSAGE_SITE_ORIGIN;
  try {
    const url = new URL(origin);
    if (url.protocol !== "https:" || url.origin !== origin || url.username || url.password) throw new Error();
  } catch { throw new AuthConfigError(); }
  const encoded = env.JESSIEMESSAGE_MFA_KEY;
  if (typeof encoded !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(encoded)) throw new AuthConfigError();
  const totpKey = Buffer.from(encoded, "base64url");
  if (totpKey.length !== 32 || totpKey.toString("base64url") !== encoded) throw new AuthConfigError();
  return { enabled: true, origin, totpKey };
}
