import { crc32 } from "node:zlib";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";

export const CONVERSATION_EXPORT_LIMITS = Object.freeze({ messages: 10000, textBytes: 8 * 1024 * 1024, archiveBytes: 32 * 1024 * 1024, milliseconds: 60000, cooldownMs: 30000 });
export class ConversationExportError extends Error {
  constructor(code = "unavailable") { super("Conversation export unavailable."); this.name = "ConversationExportError"; this.code = code; }
}
const fail = code => { throw new ConversationExportError(code); };
const id = value => typeof value === "string" && /^[a-f0-9]{32}$/.test(value);
const seq = value => typeof value === "string" && /^(?:0|[1-9][0-9]{0,19})$/.test(value) && BigInt(value) <= 18446744073709551615n;
const instant = value => Number.isSafeInteger(value) && value >= 0 && value <= 253402300799999;
const text = (value, max) => typeof value === "string" && value.length <= max && value.isWellFormed();
const escape = value => value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// Fixed ASCII names, UTF-8 text, stored JPEGs and a bounded ZIP32 directory.
// No filename, link or HTML markup supplied by a participant is executable.
function zip(files, maximum) {
  let offset = 0, directoryBytes = 0;
  const local = [], central = [];
  for (const [name, bytes] of files) {
    const filename = Buffer.from(name), header = Buffer.alloc(30), entry = Buffer.alloc(46);
    const checksum = crc32(bytes);
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6); header.writeUInt16LE(0x21, 12);
    header.writeUInt32LE(checksum, 14); header.writeUInt32LE(bytes.length, 18); header.writeUInt32LE(bytes.length, 22); header.writeUInt16LE(filename.length, 26);
    entry.writeUInt32LE(0x02014b50); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6); entry.writeUInt16LE(0x800, 8); entry.writeUInt16LE(0x21, 14);
    entry.writeUInt32LE(checksum, 16); entry.writeUInt32LE(bytes.length, 20); entry.writeUInt32LE(bytes.length, 24); entry.writeUInt16LE(filename.length, 28); entry.writeUInt32LE(offset, 42);
    local.push(header, filename, bytes); central.push(entry, filename); offset += header.length + filename.length + bytes.length; directoryBytes += entry.length + filename.length;
  }
  if (offset + directoryBytes + 22 > maximum || files.size > 65535) fail("limit");
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.size, 8); end.writeUInt16LE(files.size, 10); end.writeUInt32LE(directoryBytes, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, ...central, end], offset + directoryBytes + end.length);
}
function html(document) {
  const messages = document.messages.map(message => {
    const sender = message.sender === "me" ? document.administrator : document.client;
    const picture = message.photo?.file ? `<img src="${message.photo.file}" width="${message.photo.width}" height="${message.photo.height}" alt="Photo partagée / Shared photo">` : message.photo ? "<p>Photo non incluse / Photo not included</p>" : "";
    return `<article><p class="heading"><b>${escape(sender)}</b> · <time>${new Date(message.createdAt).toISOString()}</time></p><p class="body">${escape(message.deletedAt === null ? message.body : "Message supprimé / Deleted message")}</p>${picture}</article>`;
  }).join("\n");
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' file:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>JessieMessage — Conversation</title><style>body{font:16px/1.6 system-ui,sans-serif;max-width:780px;padding:24px;margin:auto;color:#242024;background:#faf8fa}article{border-top:1px solid #d8cfd8;padding:16px 0}.heading{color:#625363;font-size:14px}.body{white-space:pre-wrap;overflow-wrap:anywhere}img{display:block;max-width:100%;height:auto}small{color:#625363}</style></head><body><h1>JessieMessage — Conversation</h1><p>${escape(document.administrator)} · ${escape(document.client)}</p><p><small>Export : ${document.completedAt}. ${document.messages.length} messages. Photos : ${document.includePhotos ? "incluses / included" : "non incluses / not included"}.</small></p>${messages || "<p>Aucun message / No messages.</p>"}</body></html>`;
}

/** Reuse the ordinary authorized conversation and message-photo readers only.
 * Never enumerate a participant's private library, CRM notes or campaigns. */
export function createConversationExporter({ history, photo = null, clock = Date.now, elapsed = () => performance.now(), limits = CONVERSATION_EXPORT_LIMITS }) {
  if (typeof history !== "function" || photo !== null && typeof photo !== "function" || typeof clock !== "function" || typeof elapsed !== "function"
    || Object.keys(CONVERSATION_EXPORT_LIMITS).some(key => !Number.isSafeInteger(limits[key]) || limits[key] < 1 || limits[key] > CONVERSATION_EXPORT_LIMITS[key])) throw new TypeError("Bounded conversation readers required.");
  let busy = false, nextAllowedAt = 0;
  return Object.freeze({ photos: photo !== null, maxBytes: limits.archiveBytes,
    async create({ token, conversationId, expectedClientId, includePhotos, signal }) {
      if (!id(conversationId) || !id(expectedClientId) || typeof includePhotos !== "boolean" || includePhotos && !photo) fail("input");
      const startedAt = clock(); if (!instant(startedAt)) fail();
      if (busy || startedAt < nextAllowedAt) fail("busy");
      const began = elapsed(); if (!Number.isFinite(began) || began < 0) fail();
      busy = true; nextAllowedAt = startedAt + limits.cooldownMs;
      const files = new Map(), messages = [], seen = new Set(), photos = new Map();
      let textBytes = 0, fileBytes = 0, before = null, upper = null, clientId = null, client = null, archive = null;
      const active = () => { const current = elapsed(); if (!Number.isFinite(current) || current < began || signal?.aborted || current - began > limits.milliseconds) fail("cancelled"); };
      const add = (name, bytes) => {
        if (files.has(name) || !/^(?:Conversation\.html|conversation\.json|LIRE-MOI\.txt|photos\/[a-f0-9]{32}\.jpg)$/.test(name)) fail();
        if (bytes.length > limits.archiveBytes - fileBytes - 22 - 128 * (files.size + 1)) fail("limit");
        fileBytes += bytes.length; files.set(name, bytes);
      };
      try {
        while (true) {
          active(); const page = await history(token, conversationId, { before, limit: 100 }); active();
          const conversation = page?.conversation;
          if (!conversation || conversation.id !== conversationId || !id(conversation.client?.id) || !text(conversation.client.pseudonym, 64)
            || !text(conversation.peerName, 64) || !seq(conversation.latestSequence) || !Array.isArray(page.messages) || page.messages.length > 100
            || typeof page.hasMoreBefore !== "boolean") fail();
          if (upper === null) { upper = conversation.latestSequence; clientId = conversation.client.id; client = conversation.client.pseudonym; }
          if (conversation.client.id !== clientId || clientId !== expectedClientId) fail("changed");
          let previous = 0n;
          for (const message of page.messages) {
            if (!message || !id(message.id) || seen.has(message.id) || !seq(message.sequence) || BigInt(message.sequence) <= previous
              || BigInt(message.sequence) > BigInt(upper) || before !== null && BigInt(message.sequence) >= BigInt(before)
              || !["me", "peer"].includes(message.sender) || !instant(message.createdAt)
              || message.deletedAt !== null && (!instant(message.deletedAt) || message.deletedAt < message.createdAt)
              || message.deletedAt === null && !text(message.body, 5000) || message.deletedAt !== null && (message.body !== null || message.media !== undefined)) fail();
            previous = BigInt(message.sequence); seen.add(message.id);
            if (seen.size > limits.messages) fail("limit");
            const body = message.body ?? ""; textBytes += Buffer.byteLength(body, "utf8"); if (textBytes > limits.textBytes) fail("limit");
            const exported = { id: message.id, sequence: message.sequence, sender: message.sender, body, createdAt: message.createdAt, deletedAt: message.deletedAt };
            if (message.deletedAt === null && message.media !== undefined) {
              const media = message.media;
              if (!id(media?.id) || media.sharedHere !== true || !Number.isSafeInteger(media.bytes) || media.bytes < 5 || media.bytes > 10485760
                || ![media.width, media.height].every(n => Number.isSafeInteger(n) && n >= 1 && n <= 2048)) fail();
              exported.photo = { file: null, width: media.width, height: media.height };
              if (includePhotos) {
                const identity = `${media.bytes}:${media.width}:${media.height}`, prior = photos.get(media.id);
                if (prior && prior.identity !== identity) fail("changed");
                if (!prior) {
                  if (media.bytes > limits.archiveBytes - fileBytes - 4096) fail("limit");
                  let result;
                  try {
                    active(); result = await photo(token, conversationId, message.id); active();
                    const bytes = result?.bytes;
                    if (result?.mime !== "image/jpeg" || !Buffer.isBuffer(bytes) || bytes.length !== media.bytes || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff || bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) fail("changed");
                    const filename = `photos/${media.id}.jpg`; const copy = Buffer.from(bytes);
                    try { add(filename, copy); } catch (error) { copy.fill(0); throw error; }
                    photos.set(media.id, { identity, file: filename, sha256: createHash("sha256").update(bytes).digest("hex") });
                  } finally { result?.bytes?.fill?.(0); }
                }
                exported.photo = { ...exported.photo, file: photos.get(media.id).file, sha256: photos.get(media.id).sha256 };
              }
            }
            messages.push(exported);
          }
          if (!page.hasMoreBefore) break;
          const cursor = page.messages[0]?.sequence;
          if (!seq(cursor) || cursor === "0" || page.nextBefore !== cursor || before !== null && BigInt(cursor) >= BigInt(before)) fail();
          before = cursor;
        }
        active(); messages.sort((a, b) => BigInt(a.sequence) < BigInt(b.sequence) ? -1 : 1);
        // Use the service name for outgoing messages, without exporting the
        // identity of the shared administrator login or its private CRM alias.
        const completedAt = clock(); if (!instant(completedAt) || completedAt < startedAt) fail();
        const document = { format: "jessiemessage-conversation", version: 1, startedAt: new Date(startedAt).toISOString(), completedAt: new Date(completedAt).toISOString(),
          throughSequence: upper, administrator: "Jess", client, includePhotos, messages };
        add("conversation.json", Buffer.from(JSON.stringify(document, null, 2) + "\n"));
        add("Conversation.html", Buffer.from(html(document)));
        add("LIRE-MOI.txt", Buffer.from("JessieMessage — Conversation\n\nExtraire tout le ZIP puis ouvrir Conversation.html pour lire les messages et les photos incluses.\nExtract the whole ZIP and open Conversation.html to read messages and included photos.\n\nconversation.json fournit les mêmes échanges dans un format portable.\nconversation.json contains the same exchanges in a portable format.\n\nCe fichier se lit sans connexion : conserver le dossier dans un endroit privé.\nThis file can be read offline: keep the folder in a private location.\n\nLes notes, tags, groupes, la bibliothèque non partagée, et les identifiants de connexion ne sont pas inclus.\nPrivate notes, labels, groups, unshared library files, and credentials are not included.\n\nIl s'agit d'un export de conversation, pas d'une sauvegarde du site ni d'un dossier complet d'exercice des droits. Les échanges supprimés avant leur lecture restent supprimés ; la conversation peut évoluer pendant la préparation.\nThis is a conversation export, not a site backup or a complete data-rights export. Messages deleted before they are read remain deleted; the conversation may change during preparation.\n"));
        active(); archive = zip(files, limits.archiveBytes); active();
        return archive;
      } catch (error) {
        archive?.fill(0);
        if (error instanceof ConversationExportError) throw error;
        if (["CHAT_UNAUTHORIZED", "MEDIA_UNAUTHORIZED"].includes(error?.code)) fail("unauthorized");
        if (["CHAT_NOT_FOUND", "MEDIA_NOT_FOUND", "CHAT_FORBIDDEN", "MEDIA_FORBIDDEN"].includes(error?.code)) fail("changed");
        if (["CHAT_RATE_LIMIT", "MEDIA_RATE_LIMIT"].includes(error?.code)) fail("busy");
        fail();
      } finally { for (const bytes of files.values()) bytes.fill(0); files.clear(); busy = false; }
    }
  });
}
