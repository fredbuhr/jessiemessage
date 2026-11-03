import { createHash, randomBytes } from "node:crypto";
import { tokenDigest } from "../auth/crypto.mjs";
import { normalizeInvitationCode } from "../../public/invitation-code.js";

export { normalizeInvitationCode };

const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const codeDomain = "jessiemessage:invitation-code:v1\0";

export function formatInvitationCode(value) {
  const normalized = normalizeInvitationCode(value);
  return normalized === null ? null : normalized.match(/.{4}/g).join("-");
}

export function newInvitationCode() {
  // Every character retains five independent CSPRNG bits: 20 × 5 = 100 bits.
  const bytes = randomBytes(20);
  try { return formatInvitationCode(Array.from(bytes, (value) => alphabet[value & 31]).join("")); }
  finally { bytes.fill(0); }
}

export function invitationDigest(value) {
  // A canonical legacy token always wins, even if removing its hyphens could
  // also resemble a code. Existing invitation links must keep their digest.
  try { return tokenDigest(value); } catch { /* Only invitation codes may follow. */ }
  const code = normalizeInvitationCode(value);
  if (code === null) throw new TypeError("Invalid invitation secret");
  // The old link digest hashes exactly 32 decoded bytes. This namespaced input
  // has a different length, keeping code and link secrets in separate domains.
  return createHash("sha256").update(codeDomain).update(code, "ascii").digest();
}

export function isInvitationSecret(value) {
  try { invitationDigest(value); return true; }
  catch { return false; }
}
