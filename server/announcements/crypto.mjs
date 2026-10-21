import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from "node:crypto";
import { bodyText, fields, instant, revision, fail } from "./validation.mjs";

const NAMESPACE = "jessiemessage:announcements:v1";
function purposeKey(key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) fail();
  return Buffer.from(hkdfSync("sha256", key, Buffer.alloc(0), Buffer.from(NAMESPACE), 32));
}
function bytes(value) { if (!Buffer.isBuffer(value) || value.length !== 16) fail(); return value; }
function aad(binding) {
  bytes(binding?.adminId); bytes(binding?.id); revision(binding.revision, false); instant(binding.startsAt); instant(binding.expiresAt);
  if (binding.expiresAt <= binding.startsAt || typeof binding.sendPrivateMessage !== "boolean") fail();
  return Buffer.from(JSON.stringify([NAMESPACE, binding.adminId.toString("hex"), binding.id.toString("hex"), binding.revision,
    binding.startsAt, binding.expiresAt, binding.sendPrivateMessage]));
}
function payload(value) { fields(value, ["body"]); return { body: bodyText(value.body) }; }
export function sealAnnouncement(value, key, binding) {
  const derived = purposeKey(key), plaintext = Buffer.from(JSON.stringify(payload(value)));
  try {
    const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", derived, iv); cipher.setAAD(aad(binding));
    return "v1." + Buffer.concat([iv, cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]).toString("base64url");
  } catch { fail(); } finally { derived.fill(0); plaintext.fill(0); }
}
export function openAnnouncement(value, key, binding) {
  const derived = purposeKey(key); let plaintext, tail;
  try {
    if (typeof value !== "string" || value.length > 8192 || !/^v1\.[A-Za-z0-9_-]+$/.test(value)) fail();
    const encoded = value.slice(3), envelope = Buffer.from(encoded, "base64url");
    if (envelope.length < 29 || envelope.toString("base64url") !== encoded) fail();
    const decipher = createDecipheriv("aes-256-gcm", derived, envelope.subarray(0, 12));
    decipher.setAAD(aad(binding)); decipher.setAuthTag(envelope.subarray(-16));
    plaintext = decipher.update(envelope.subarray(12, -16)); tail = decipher.final();
    if (tail.length) fail();
    const text = new TextDecoder("utf-8", { fatal: true }).decode(plaintext), result = payload(JSON.parse(text));
    if (JSON.stringify(result) !== text) fail(); return result;
  } catch { fail(); } finally { derived.fill(0); plaintext?.fill(0); tail?.fill(0); }
}
export function announcementFingerprint(value, key, { adminId }) {
  bytes(adminId); const derived = purposeKey(key);
  try { return createHmac("sha256", derived).update(NAMESPACE + ":request:").update(adminId).update(JSON.stringify(value)).digest(); }
  finally { derived.fill(0); }
}
