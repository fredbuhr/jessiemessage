export const SITE_DOMAIN = "jessiemessage.com";
export const SITE_CONTACT_EMAIL = `contact@${SITE_DOMAIN}`;

export function isOfficialOrigin(origin) {
  if (typeof origin !== "string") return false;
  try {
    const url = new URL(origin);
    return url.protocol === "https:" && url.origin === origin && !url.username && !url.password
      && (url.hostname === SITE_DOMAIN || url.hostname.endsWith(`.${SITE_DOMAIN}`));
  } catch { return false; }
}

// Private recipe configuration and its offline diagnostic must agree on the
// same canonical host syntax. The primary-origin candidate is a separate opt-in.
export function isPreproductionOrigin(origin) {
  if (!isOfficialOrigin(origin)) return false;
  const url = new URL(origin);
  return url.hostname !== SITE_DOMAIN && url.hostname !== `www.${SITE_DOMAIN}` && url.port === ""
    && url.hostname.length <= 253
    && url.hostname.split(".").every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
}
