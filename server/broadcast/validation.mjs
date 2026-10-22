import { validateMessageBody } from "../chat/crypto.mjs";
import { validateSearch } from "../crm/validation.mjs";

const MAX_VERSION = 18446744073709551615n;
const TITLE_CONTROLS = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;
const ONLY_INVISIBLE = /^[\p{C}\p{Z}]*$/u;
const PAYLOAD_FIELDS = ["title", "body", "mediaId", "allowRepeatMedia", "conversationIds"];

export class BroadcastInputError extends Error {
  constructor() {
    super("Invalid broadcast data.");
    this.name = "BroadcastInputError";
    this.code = "BROADCAST_INPUT";
  }
}

function invalid() { throw new BroadcastInputError(); }

function exactObject(input, fields) {
  if (input === null || typeof input !== "object" || Array.isArray(input)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) invalid();
  const keys = Reflect.ownKeys(input);
  if (keys.length !== fields.length || keys.some((name) => !fields.includes(name))) invalid();
  for (const name of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(input, name);
    if (!descriptor || !Object.hasOwn(descriptor, "value") || descriptor.enumerable !== true) invalid();
  }
}

export function validateId(value) {
  if (typeof value !== "string" || value.length !== 32 || !/^[0-9a-f]{32}$/u.test(value)) invalid();
  return Buffer.from(value, "hex");
}

export function validateVersion(value) {
  if (typeof value !== "string" || value.length < 1 || value.length > 20
    || !/^(?:0|[1-9][0-9]*)$/u.test(value) || BigInt(value) > MAX_VERSION || BigInt(value).toString() !== value) invalid();
  return value;
}

function conversationIds(input, maximum = 100) {
  if (!Array.isArray(input) || input.length < 1 || input.length > maximum) invalid();
  // Array.from visits sparse slots rather than silently omitting them.
  const values = Array.from(input, (hex) => ({ hex, id: validateId(hex) }));
  if (new Set(values.map(({ hex }) => hex)).size !== values.length) invalid();
  return values.sort((left, right) => left.hex < right.hex ? -1 : left.hex > right.hex ? 1 : 0)
    .map(({ id }) => id);
}

/** The manual selector is transport-bounded, rather than a campaign ceiling.
 * All/filtered selectors remain compact regardless of audience cardinality. */
export function validateAudience(input) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) invalid();
  const mode = Object.getOwnPropertyDescriptor(input, "mode");
  if (!mode || !Object.hasOwn(mode, "value")) invalid();
  if (mode.value === "all") { exactObject(input, ["mode"]); return { mode: "all" }; }
  if (mode.value === "selected") {
    exactObject(input, ["mode", "conversationIds"]);
    // An ID needs at least 35 JSON bytes. Reject impossible 1 MiB requests
    // before allocating the canonical copy, including direct service callers.
    return { mode: "selected", conversationIds: conversationIds(input.conversationIds,
      Math.floor((1048576 - 1) / 35)).map(value => value.toString("hex")) };
  }
  if (mode.value !== "filtered") invalid();
  exactObject(input, ["mode", "filters"]);
  const filters = input.filters;
  exactObject(filters, ["q", "tagId", "groupId", "access", "unread", "reminder"]);
  let q;
  try { q = validateSearch(filters.q); } catch { invalid(); }
  if (!["all", "active", "pending", "expired", "revoked", "suspended", "deleted"].includes(filters.access)
    || typeof filters.unread !== "boolean" || !["all", "due", "upcoming", "none"].includes(filters.reminder)) invalid();
  const tagId = filters.tagId === null ? null : validateId(filters.tagId).toString("hex");
  const groupId = filters.groupId === null ? null : validateId(filters.groupId).toString("hex");
  return { mode: "filtered", filters: { q, tagId, groupId, access: filters.access, unread: filters.unread, reminder: filters.reminder } };
}

export function validatePreview(input, { video = false } = {}) {
  if (typeof video !== "boolean") invalid();
  if (Object.hasOwn(input ?? {}, "videoId")) {
    if (!video) invalid();
    exactObject(input, ["audience", "mediaId", "videoId"]);
    if (input.mediaId !== null) invalid();
    return { audience: validateAudience(input.audience), mediaId: null, videoId: validateId(input.videoId) };
  }
  if (input && typeof input === "object" && Object.hasOwn(input, "audience")) {
    exactObject(input, ["audience", "mediaId"]);
    return { audience: validateAudience(input.audience), mediaId: input.mediaId === null ? null : validateId(input.mediaId) };
  }
  exactObject(input, ["conversationIds", "mediaId"]);
  return {
    conversationIds: conversationIds(input.conversationIds),
    mediaId: input.mediaId === null ? null : validateId(input.mediaId),
  };
}

function contentValues(input, video = false) {
  const { title, body, mediaId, allowRepeatMedia } = input;
  const videoId = video ? validateId(input.videoId) : null;
  if (video && mediaId !== null) invalid();
  if (typeof title !== "string" || title.length < 1 || title.length > 80 || !title.isWellFormed()
    || Buffer.byteLength(title, "utf8") > 320 || title.trim().length === 0
    || ONLY_INVISIBLE.test(title) || TITLE_CONTROLS.test(title)
    || typeof allowRepeatMedia !== "boolean") invalid();
  const media = mediaId === null ? null : validateId(mediaId);
  if ((media !== null || video) && (typeof body !== "string" || body.length > 1000)) invalid();
  if (media === null && !video || body !== "") {
    try { validateMessageBody(body); } catch { invalid(); }
  }
  return { title, body, mediaId: media, allowRepeatMedia, ...(video ? { videoId } : {}) };
}

function payloadValues(input) {
  return { ...contentValues(input), conversationIds: conversationIds(input.conversationIds) };
}

export function validateCampaign(input, { video = false } = {}) {
  if (typeof video !== "boolean") invalid();
  if (Object.hasOwn(input ?? {}, "videoId")) {
    if (!video) invalid();
    exactObject(input, ["clientCampaignId", "title", "body", "mediaId", "videoId", "allowRepeatMedia", "audience", "previewToken"]);
    if (typeof input.previewToken !== "string" || input.previewToken.length < 1 || input.previewToken.length > 4096 || /[^\x21-\x7e]/u.test(input.previewToken)) invalid();
    return { clientCampaignId: validateId(input.clientCampaignId), ...contentValues(input, true), audience: validateAudience(input.audience), previewToken: input.previewToken };
  }
  if (input && typeof input === "object" && Object.hasOwn(input, "audience")) {
    exactObject(input, ["clientCampaignId", "title", "body", "mediaId", "allowRepeatMedia", "audience", "previewToken"]);
    if (typeof input.previewToken !== "string" || input.previewToken.length < 1 || input.previewToken.length > 4096
      || /[^\x21-\x7e]/u.test(input.previewToken)) invalid();
    return { clientCampaignId: validateId(input.clientCampaignId), ...contentValues(input),
      audience: validateAudience(input.audience), previewToken: input.previewToken };
  }
  exactObject(input, ["clientCampaignId", ...PAYLOAD_FIELDS]);
  return { clientCampaignId: validateId(input.clientCampaignId), ...payloadValues(input) };
}

// The encrypted payload has no caller retry ID. Keep one validation path for
// API input and authenticated database plaintext, returning a canonical DTO.
export function validatePayload(input, { video = false } = {}) {
  if (typeof video !== "boolean") invalid();
  if (input && typeof input === "object" && Object.hasOwn(input, "version")) {
    const typedVideo = Object.getOwnPropertyDescriptor(input, "version")?.value === 3;
    if (typedVideo && !video) invalid();
    exactObject(input, ["version", "title", "body", "mediaId", ...(typedVideo ? ["videoId"] : []), "allowRepeatMedia", "audience"]);
    if (![2, 3].includes(input.version)) invalid();
    const value = contentValues(input, typedVideo), audience = input.audience;
    exactObject(audience, ["mode", "count", "digest", "selectorHash"]);
    if (!["all", "filtered", "selected"].includes(audience.mode) || !Number.isSafeInteger(audience.count) || audience.count < 1
      || typeof audience.digest !== "string" || !/^[a-f0-9]{64}$/u.test(audience.digest)
      || typeof audience.selectorHash !== "string" || !/^[a-f0-9]{64}$/u.test(audience.selectorHash)) invalid();
    return { version: typedVideo ? 3 : 2, title: value.title, body: value.body, mediaId: value.mediaId?.toString("hex") ?? null, ...(typedVideo ? { videoId: value.videoId.toString("hex") } : {}),
      allowRepeatMedia: value.allowRepeatMedia,
      audience: { mode: audience.mode, count: audience.count, digest: audience.digest, selectorHash: audience.selectorHash } };
  }
  exactObject(input, PAYLOAD_FIELDS);
  const value = payloadValues(input);
  return { title: value.title, body: value.body, mediaId: value.mediaId?.toString("hex") ?? null,
    allowRepeatMedia: value.allowRepeatMedia,
    conversationIds: value.conversationIds.map((id) => id.toString("hex")) };
}
