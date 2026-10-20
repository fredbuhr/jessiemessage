// Only a profile revision and a conversation-scoped URL cross the API boundary.
// Storage keys and the avatar's original image never belong to this DTO.
export function peerAvatarDTO(version, role, conversationId) {
  if (version === null || version === undefined) return undefined;
  if (!["admin", "client"].includes(role) || typeof conversationId !== "string" || !/^[a-f0-9]{32}$/.test(conversationId)
    || typeof version !== "string" || !/^[1-9][0-9]{0,9}$/.test(version) || BigInt(version) > 4294967295n) {
    throw new TypeError("invalid_peer_avatar");
  }
  return { version, url: `/api/profile/${role}/conversations/${conversationId}/avatar?v=${version}` };
}

export function safePeerAvatar(value, role, conversationId) {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("invalid_peer_avatar");
  const avatar = peerAvatarDTO(value.version, role, conversationId);
  if (!avatar || value.url !== avatar.url) throw new TypeError("invalid_peer_avatar");
  return avatar;
}
