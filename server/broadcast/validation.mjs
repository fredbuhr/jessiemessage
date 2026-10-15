import { validateMessageBody } from "../chat/crypto.mjs";

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
    || !/^(?:0|[1-9][0-9]*)$/u.test(value) || BigInt(value) > MAX_VERSION) invalid();
  return value;
}

function conversationIds(input) {
  if (!Array.isArray(input) || input.length < 1 || input.length > 100) invalid();
  // Array.from visits sparse slots rather than silently omitting them.
  const values = Array.from(input, (hex) => ({ hex, id: validateId(hex) }));
  if (new Set(values.map(({ hex }) => hex)).size !== values.length) invalid();
  return values.sort((left, right) => left.hex < right.hex ? -1 : left.hex > right.hex ? 1 : 0)
    .map(({ id }) => id);
}

export function validatePreview(input) {
  exactObject(input, ["conversationIds", "mediaId"]);
  return {
    conversationIds: conversationIds(input.conversationIds),
    mediaId: input.mediaId === null ? null : validateId(input.mediaId),
  };
}

function payloadValues(input) {
  const { title, body, mediaId, allowRepeatMedia } = input;
  if (typeof title !== "string" || title.length < 1 || title.length > 80 || !title.isWellFormed()
    || Buffer.byteLength(title, "utf8") > 320 || title.trim().length === 0
    || ONLY_INVISIBLE.test(title) || TITLE_CONTROLS.test(title)
    || typeof allowRepeatMedia !== "boolean") invalid();
  const media = mediaId === null ? null : validateId(mediaId);
  if (media !== null && (typeof body !== "string" || body.length > 1000)) invalid();
  if (media === null || body !== "") {
    try { validateMessageBody(body); } catch { invalid(); }
  }
  return { title, body, mediaId: media, allowRepeatMedia, conversationIds: conversationIds(input.conversationIds) };
}

export function validateCampaign(input) {
  exactObject(input, ["clientCampaignId", ...PAYLOAD_FIELDS]);
  return { clientCampaignId: validateId(input.clientCampaignId), ...payloadValues(input) };
}

// The encrypted payload has no caller retry ID. Keep one validation path for
// API input and authenticated database plaintext, returning a canonical DTO.
export function validatePayload(input) {
  exactObject(input, PAYLOAD_FIELDS);
  const value = payloadValues(input);
  return { title: value.title, body: value.body, mediaId: value.mediaId?.toString("hex") ?? null,
    allowRepeatMedia: value.allowRepeatMedia,
    conversationIds: value.conversationIds.map((id) => id.toString("hex")) };
}
