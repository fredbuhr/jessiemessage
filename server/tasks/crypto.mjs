import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from "node:crypto";
import { fail, instant, titleText, validateSave, version } from "./validation.mjs";

const NAMESPACE = "jessiemessage:crm-tasks:v1";
function purposeKey(key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) fail();
  return Buffer.from(hkdfSync("sha256", key, Buffer.alloc(0), Buffer.from(NAMESPACE), 32));
}
function bytes(value) { if (!Buffer.isBuffer(value) || value.length !== 16) fail(); return value; }
function aad(binding) {
  bytes(binding?.adminId); bytes(binding?.conversationId); bytes(binding?.taskId); version(binding?.version, false);
  if (binding.dueAt !== null) instant(binding.dueAt); if (typeof binding.done !== "boolean") fail();
  return Buffer.from(JSON.stringify([NAMESPACE, binding.adminId.toString("hex"), binding.conversationId.toString("hex"),
    binding.taskId.toString("hex"), binding.version, binding.dueAt, binding.done]));
}
export function sealTask(title, key, binding) {
  const derived = purposeKey(key); let plaintext;
  try {
    plaintext = Buffer.from(titleText(title), "utf8");
    const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", derived, iv); cipher.setAAD(aad(binding));
    return "v1." + Buffer.concat([iv, cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]).toString("base64url");
  } catch { fail(); } finally { derived.fill(0); plaintext?.fill(0); }
}
export function openTask(value, key, binding) {
  const derived = purposeKey(key); let plaintext, tail;
  try {
    if (typeof value !== "string" || value.length > 4096 || !/^v1\.[A-Za-z0-9_-]+$/.test(value)) fail();
    const encoded = value.slice(3), envelope = Buffer.from(encoded, "base64url");
    if (envelope.length < 29 || envelope.toString("base64url") !== encoded) fail();
    const decipher = createDecipheriv("aes-256-gcm", derived, envelope.subarray(0, 12)); decipher.setAAD(aad(binding));
    decipher.setAuthTag(envelope.subarray(-16)); plaintext = decipher.update(envelope.subarray(12, -16)); tail = decipher.final();
    if (tail.length) fail(); return titleText(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(plaintext));
  } catch { fail(); } finally { derived.fill(0); plaintext?.fill(0); tail?.fill(0); }
}
export function taskFingerprint(input, key, { adminId, taskId }) {
  bytes(adminId); bytes(taskId); input = validateSave(input); const derived = purposeKey(key);
  try { return createHmac("sha256", derived).update(NAMESPACE + ":request:").update(adminId).update(taskId).update(JSON.stringify(input)).digest(); }
  finally { derived.fill(0); }
}
