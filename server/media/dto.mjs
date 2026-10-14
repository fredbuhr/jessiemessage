export function mediaDTO(row, role, { conversationId = null, messageId = null } = {}) {
  const id = row.id.toString("hex");
  const base = conversationId === null ? `/api/media/${role}/assets/${id}`
    : `/api/media/${role}/conversations/${conversationId}/messages/${messageId}`;
  return { id, width: row.width, height: row.height, thumbnailWidth: row.thumbnailWidth, thumbnailHeight: row.thumbnailHeight,
    bytes: row.fullBytes, thumbnailBytes: row.thumbnailBytes, createdAt: row.createdAt, sharedHere: Boolean(row.sharedHere),
    fullUrl: `${base}/full`, thumbnailUrl: `${base}/thumb` };
}
