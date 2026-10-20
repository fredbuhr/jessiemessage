export const MAX_PROFILE_VERSION = 4294967295n;
export const MAX_AVATAR_FULL_BYTES = 262144;
export const MAX_AVATAR_THUMBNAIL_BYTES = 131072;
export const MAX_AVATAR_SIDE = 512;

export const isProfileId = value => typeof value === "string" && /^[a-f0-9]{32}$/.test(value);
export const isProfileVersion = (value, zero = true) => typeof value === "string"
  && /^(?:0|[1-9][0-9]{0,9})$/.test(value) && BigInt(value) <= MAX_PROFILE_VERSION && (zero || value !== "0");

export function canonicalProfileName(value) {
  if (typeof value !== "string" || !value.isWellFormed() || value !== value.trim() || /[\p{Cc}\p{Cf}]/u.test(value)) throw new TypeError("Invalid display name");
  const normalized = value.normalize("NFC");
  if (normalized.length < 1 || normalized.length > 64) throw new TypeError("Invalid display name");
  return normalized;
}

export const ownAvatarUrl = (role, version) => `/api/profile/${role}/avatar?v=${version}`;
export const peerAvatarUrl = (role, conversationId, version) => `/api/profile/${role}/conversations/${conversationId}/avatar?v=${version}`;
