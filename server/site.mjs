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
