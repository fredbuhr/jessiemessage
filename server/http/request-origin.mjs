import { isIP } from "node:net";

export class RequestOriginError extends TypeError {
  constructor() {
    super("A canonical HTTPS request origin with an explicit authentication service is required.");
    this.name = "RequestOriginError";
    this.code = "REQUEST_ORIGIN_CONFIG";
  }
}

/** Check the wire request-target before URL normalization can change its form. */
export function isOriginFormTarget(value) {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//")
    && !/[\u0000-\u0020\u007f-\u009f\\#]/u.test(value);
}

/**
 * Restrict the actual HTTP authority; forwarding headers grant no authority.
 * This is an additional deployment guard, not a substitute for session, Origin
 * or CSRF checks. Callers explicitly opt in; existing neutral servers stay so.
 */
export function createRequestOriginGuard(origin) {
  let url;
  try {
    if (typeof origin !== "string" || origin.length > 2048) throw new Error();
    url = new URL(origin);
    if (url.protocol !== "https:" || url.origin !== origin || url.username || url.password
      || url.hostname.length > 253 || isIP(url.hostname) !== 0
      || url.hostname.split(".").some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) throw new Error();
  } catch { throw new RequestOriginError(); }
  const authorities = new Set([url.host]);
  if (url.port === "") authorities.add(`${url.hostname}:443`);
  return function requestOriginAllowed(request) {
    if (!isOriginFormTarget(request?.url) || typeof request?.headers?.host !== "string" || !Array.isArray(request.rawHeaders)
      || request.rawHeaders.length % 2 !== 0 || !authorities.has(request.headers.host.toLowerCase())) return false;
    let hosts = 0;
    for (let index = 0; index < request.rawHeaders.length; index += 2) {
      const name = request.rawHeaders[index], value = request.rawHeaders[index + 1];
      if (typeof name !== "string" || typeof value !== "string") return false;
      if (name.toLowerCase() === "host") {
        hosts += 1;
        if (!authorities.has(value.toLowerCase())) return false;
      }
    }
    return hosts === 1;
  };
}
