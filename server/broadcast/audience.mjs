import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { validateAudience } from "./validation.mjs";

const TOKEN_NAMESPACE = "jessiemessage:broadcast-preview:v2:";
const SELECTOR_NAMESPACE = "jessiemessage:broadcast-selector:v2:";
const MAX_DATE = 253402300799999;
const id = (value) => typeof value === "string" && /^[a-f0-9]{32}$/.test(value);
const digest = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const count = (value) => Number.isSafeInteger(value) && value >= 0;
const date = (value) => Number.isSafeInteger(value) && value >= 0 && value <= MAX_DATE;
function conflict() { throw Object.assign(new Error("Broadcast preview must be refreshed."), { code: "BROADCAST_CONFLICT" }); }
function keyBytes(key) { if (!Buffer.isBuffer(key) || key.length !== 32) conflict(); return key; }
function tokenValue(value) {
  const fields = ["version", "adminId", "selectorHash", "mediaId", "count", "digest", "repeatCount", "issuedAt"];
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== fields.length
    || fields.some((field) => !Object.hasOwn(value, field)) || value.version !== 1 || !id(value.adminId)
    || !digest(value.selectorHash) || !(value.mediaId === null || id(value.mediaId)) || !count(value.count)
    || !digest(value.digest) || !count(value.repeatCount) || value.repeatCount > value.count || !date(value.issuedAt)) conflict();
  return { version: 1, adminId: value.adminId, selectorHash: value.selectorHash, mediaId: value.mediaId,
    count: value.count, digest: value.digest, repeatCount: value.repeatCount, issuedAt: value.issuedAt };
}

export function audienceSelectorHash(audience) {
  return createHash("sha256").update(SELECTOR_NAMESPACE).update(JSON.stringify(validateAudience(audience))).digest("hex");
}

export function issuePreviewToken(key, input) {
  const value = tokenValue({ version: 1, ...input });
  const encoded = Buffer.from(JSON.stringify(value)).toString("base64url");
  const signature = createHmac("sha256", keyBytes(key)).update(TOKEN_NAMESPACE).update(encoded).digest("base64url");
  return `v1.${encoded}.${signature}`;
}

export function readPreviewToken(token, key, binding, { now, fresh = true } = {}) {
  if (typeof token !== "string" || token.length > 2048 || !date(now) || typeof fresh !== "boolean") conflict();
  const fields = token.split(".");
  if (fields.length !== 3 || fields[0] !== "v1" || !/^[A-Za-z0-9_-]+$/.test(fields[1]) || !/^[A-Za-z0-9_-]{43}$/.test(fields[2])) conflict();
  const signed = Buffer.from(fields[2], "base64url"), expected = createHmac("sha256", keyBytes(key)).update(TOKEN_NAMESPACE).update(fields[1]).digest();
  if (signed.length !== 32 || signed.toString("base64url") !== fields[2] || !timingSafeEqual(signed, expected)) conflict();
  let value;
  try {
    const bytes = Buffer.from(fields[1], "base64url");
    if (bytes.toString("base64url") !== fields[1]) conflict();
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    value = tokenValue(JSON.parse(text));
    if (JSON.stringify(value) !== text) conflict();
  } catch { conflict(); }
  if (value.adminId !== binding.adminId || value.selectorHash !== binding.selectorHash || value.mediaId !== binding.mediaId
    || fresh && (now < value.issuedAt || now - value.issuedAt > 600000)) conflict();
  return value;
}

