import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { failPreferences, ownerId, preferenceVersion, selectedIds, MAX_PREFERENCES_BODY_BYTES, MAX_PREFERENCES_ENVELOPE_BYTES } from "./validation.mjs";
const namespace = "jessiemessage:profile-preferences:v1";
function context(key, owner, version) {
  if (!Buffer.isBuffer(key) || key.length !== 32 || !preferenceVersion(version) || version === "0") failPreferences();
  ownerId(owner);
  return { key: Buffer.from(hkdfSync("sha256", key, Buffer.from(owner, "hex"), Buffer.from(namespace), 32)), aad: Buffer.from(`${namespace}:${owner}:${version}`) };
}
function decode(value, length) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) failPreferences();
  const bytes = Buffer.from(value, "base64url");
  if (bytes.toString("base64url") !== value || length !== undefined && bytes.length !== length) failPreferences();
  return bytes;
}
export function sealPreferences(value, key, owner, version) {
  const selected = selectedIds(value.selectedIds), catalogueVersion = value.catalogueVersion;
  if (typeof catalogueVersion !== "string" || catalogueVersion.length < 1 || catalogueVersion.length > 64) failPreferences();
  const plaintext = Buffer.from(JSON.stringify({ catalogueVersion, selectedIds: selected }));
  if (plaintext.length > MAX_PREFERENCES_BODY_BYTES) failPreferences();
  const binding = context(key, owner, version);
  try {
    const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", binding.key, iv); cipher.setAAD(binding.aad);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return `v1.${iv.toString("base64url")}.${ciphertext.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}`;
  } finally { plaintext.fill(0); binding.key.fill(0); }
}
export function openPreferences(envelope, key, owner, version) {
  const binding = context(key, owner, version); let plaintext, tail;
  try {
    if (typeof envelope !== "string" || Buffer.byteLength(envelope) > MAX_PREFERENCES_ENVELOPE_BYTES) failPreferences();
    const parts = envelope.split("."); if (parts.length !== 4 || parts[0] !== "v1") failPreferences();
    const decipher = createDecipheriv("aes-256-gcm", binding.key, decode(parts[1], 12));
    decipher.setAAD(binding.aad); decipher.setAuthTag(decode(parts[3], 16));
    const ciphertext = decode(parts[2]); if (ciphertext.length < 1 || ciphertext.length > MAX_PREFERENCES_BODY_BYTES) failPreferences();
    plaintext = decipher.update(ciphertext); tail = decipher.final(); if (tail.length) failPreferences();
    const text = new TextDecoder("utf-8", { fatal: true }).decode(plaintext), value = JSON.parse(text);
    if (!value || Object.keys(value).length !== 2 || typeof value.catalogueVersion !== "string" || value.catalogueVersion.length < 1 || value.catalogueVersion.length > 64) failPreferences();
    const validated = selectedIds(value.selectedIds);
    if (validated.length !== value.selectedIds.length) failPreferences();
    // Stored IDs retain their order even when a later catalogue reorders or
    // retires an entry. Only a new explicit save uses the current order.
    const result = { catalogueVersion: value.catalogueVersion, selectedIds: [...value.selectedIds] };
    if (JSON.stringify(result) !== text) failPreferences();
    return result;
  } catch { failPreferences(); }
  finally { plaintext?.fill(0); tail?.fill(0); binding.key.fill(0); }
}
