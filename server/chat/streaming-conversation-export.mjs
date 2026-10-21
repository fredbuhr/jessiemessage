import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { validateMessageBody } from "./crypto.mjs";
import { ConversationExportError } from "./conversation-export.mjs";
import { createZipStream, MAX_ZIP_STREAM_BYTES } from "./zip-stream.mjs";

export const STREAMING_CONVERSATION_EXPORT_LIMITS = Object.freeze({ messages: 10000, textBytes: 8 * 1024 * 1024,
  photoBytes: 32 * 1024 * 1024, archiveBytes: MAX_ZIP_STREAM_BYTES, milliseconds: 300000, cooldownMs: 30000 });
const fail = (code) => { throw new ConversationExportError(code); };
const id = (value) => typeof value === "string" && /^[a-f0-9]{32}$/.test(value) && value.length === 32;
const sequence = (value) => typeof value === "string" && /^(?:0|[1-9][0-9]{0,19})$/.test(value) && BigInt(value) <= 18446744073709551615n;
const instant = (value) => Number.isSafeInteger(value) && value >= 0 && value <= 253402300799999;
const text = (value, maximum) => typeof value === "string" && value.length <= maximum && value.isWellFormed();
const escape = (value) => value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const readme = "JessieMessage — Conversation\n\nExtraire tout le ZIP puis ouvrir Conversation.html pour lire les messages, photos et vidéos incluses.\nExtract the whole ZIP and open Conversation.html to read messages and included photos and videos.\n\nconversation.json fournit les mêmes échanges dans un format portable, version 2.\nconversation.json contains the same exchanges in portable format, version 2.\n\nUne pièce jointe non incluse reste indiquée dans la conversation. Les vidéos sont les originaux ; leur lecture dépend des codecs de l’appareil.\nOmitted attachments remain indicated in the conversation. Videos are originals; playback depends on the device’s codecs.\n\nCe fichier se lit sans connexion : conserver le dossier dans un endroit privé. Seuls les échanges de cette conversation sont inclus, jamais les bibliothèques non partagées ni les identifiants de connexion.\nKeep this offline archive in a private location. Only this conversation is included, never unshared libraries or sign-in credentials.\n\nIl s’agit d’un export de conversation, pas d’une sauvegarde du site ni d’un dossier complet d’exercice des droits. La conversation peut évoluer pendant la préparation ; une livraison supprimée avant l’ouverture de son original interrompt l’export.\nThis is a conversation export, not a site backup or a complete data-rights export. The conversation may change during preparation; a delivery removed before its original is opened interrupts the export.\n";

function mapped(error, aborted = false) {
  if (aborted) return new ConversationExportError("cancelled");
  if (error instanceof ConversationExportError) return error;
  if (["CHAT_UNAUTHORIZED", "MEDIA_UNAUTHORIZED", "AUTH_INVALID"].includes(error?.code)) return new ConversationExportError("unauthorized");
  if (["CHAT_NOT_FOUND", "MEDIA_NOT_FOUND", "VIDEO_NOT_FOUND", "CHAT_FORBIDDEN", "MEDIA_FORBIDDEN", "ACCESS_FORBIDDEN", "ACCESS_EXPIRED", "ACCESS_PREREQUISITES"].includes(error?.code)) return new ConversationExportError("changed");
  if (["CHAT_RATE_LIMIT", "MEDIA_RATE_LIMIT", "VIDEO_RATE_LIMIT", "VIDEO_BUSY", "AUTH_RATE_LIMIT", "AUTH_BUSY"].includes(error?.code)) return new ConversationExportError("busy");
  return new ConversationExportError();
}
function caption(value) {
  if (!text(value, 1000)) fail();
  if (value !== "") { try { validateMessageBody(value); } catch { fail(); } }
}
function documents(document, maximum, result) {
  let remaining = maximum;
  const spend = (value) => { const bytes = Buffer.byteLength(value); if (bytes > remaining) fail("limit"); remaining -= bytes; return value; };
  const json = [];
  json.push(spend(JSON.stringify({ ...document, messages: undefined }).slice(0, -1) + ',"messages":['));
  for (const [index, message] of document.messages.entries()) json.push(spend((index ? "," : "") + JSON.stringify(message)));
  json.push(spend("]}\n")); result.set("conversation.json", Buffer.from(json.join("")));
  spend(readme); result.set("LIRE-MOI.txt", Buffer.from(readme));
  const html = [], add = (value) => html.push(spend(value));
  add(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' file:; media-src 'self' file:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>JessieMessage — Conversation</title><style>body{font:16px/1.6 system-ui,sans-serif;max-width:780px;padding:24px;margin:auto;color:#242024;background:#faf8fa}article{border-top:1px solid #d8cfd8;padding:16px 0}.heading{color:#625363;font-size:14px}.body{white-space:pre-wrap;overflow-wrap:anywhere}img,video{display:block;max-width:100%;height:auto}small{color:#625363}</style></head><body><h1>JessieMessage — Conversation</h1><p>${escape(document.administrator)} · ${escape(document.client)}</p><p><small>Export : ${document.completedAt}. ${document.messages.length} messages.</small></p>`);
  for (const message of document.messages) {
    add(`<article><p class="heading"><b>${escape(message.sender === "me" ? document.administrator : document.client)}</b> · <time>${new Date(message.createdAt).toISOString()}</time></p><p class="body">${escape(message.deletedAt === null ? message.body : "Message supprimé / Deleted message")}</p>`);
    if (message.photo) add(message.photo.file ? `<img src="${message.photo.file}" width="${message.photo.width}" height="${message.photo.height}" alt="Photo partagée / Shared photo">` : "<p>Photo non incluse / Photo not included</p>");
    if (message.video) add(message.video.file ? `<video controls preload="metadata" src="${message.video.file}">Vidéo partagée / Shared video</video><p><a href="${message.video.file}" download>Original vidéo / Original video</a></p>` : "<p>Vidéo non incluse / Video not included</p>");
    add("</article>\n");
  }
  if (!document.messages.length) add("<p>Aucun message / No messages.</p>");
  add("</body></html>"); result.set("Conversation.html", Buffer.from(html.join("")));
  return result;
}

/** Candidate export composition only. Originals are opened through the live
 * message reader, one at a time, when the prepared ZIP is consumed. */
export function createStreamingConversationExporter({ history, role = "admin", photo = null, video,
  clock = Date.now, elapsed = () => performance.now(), limits: supplied = {} } = {}) {
  if (!["admin", "client"].includes(role) || typeof history !== "function" || photo !== null && typeof photo !== "function"
    || typeof video !== "function" || typeof clock !== "function" || typeof elapsed !== "function" || !supplied || typeof supplied !== "object" || Array.isArray(supplied)
    || Object.keys(supplied).some((key) => !Object.hasOwn(STREAMING_CONVERSATION_EXPORT_LIMITS, key))) throw new TypeError("Bounded conversation readers required.");
  const limits = { ...STREAMING_CONVERSATION_EXPORT_LIMITS, ...supplied };
  if (Object.entries(limits).some(([key, value]) => !Number.isSafeInteger(value) || value < 1 || value > STREAMING_CONVERSATION_EXPORT_LIMITS[key])) throw new TypeError("Bounded conversation readers required.");
  let busy = false, nextAllowedAt = 0;
  return Object.freeze({ streaming: true, photos: photo !== null, videos: true, maxBytes: limits.archiveBytes,
    async create({ token, conversationId, expectedClientId, clientName, includePhotos, includeVideos, signal } = {}) {
      if (!id(conversationId) || !id(expectedClientId) || role === "client" && !text(clientName, 64)
        || typeof includePhotos !== "boolean" || typeof includeVideos !== "boolean" || includePhotos && !photo
        || signal !== undefined && !(signal instanceof AbortSignal)) fail("input");
      const startedAt = clock(), began = elapsed();
      if (!instant(startedAt) || !Number.isFinite(began) || began < 0) fail();
      if (busy || startedAt < nextAllowedAt) fail("busy");
      busy = true; nextAllowedAt = startedAt + limits.cooldownMs;
      const controller = new AbortController(), lifetime = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
      const retained = new Map(), photos = new Map(), videos = new Map(), messages = [], seen = new Set();
      let before = null, upper = null, client = null, bodyBytes = 0, photoBytes = 0, originalBytes = 0, zip, preparedClose, readFailure;
      let finished = false;
      const active = (extraSignal) => { const current = elapsed(); if (lifetime.aborted || extraSignal?.aborted || !Number.isFinite(current) || current < began || current - began > limits.milliseconds) fail("cancelled"); };
      const onAbort = () => { if (preparedClose) void preparedClose().catch(() => {}); };
      lifetime.addEventListener("abort", onAbort, { once: true });
      const deadline = setTimeout(() => controller.abort(), limits.milliseconds); deadline.unref?.();
      const finish = () => { if (finished) return; finished = true; clearTimeout(deadline); lifetime.removeEventListener("abort", onAbort); for (const bytes of retained.values()) bytes.fill(0); retained.clear(); messages.length = 0; photos.clear(); videos.clear(); seen.clear(); busy = false; };
      try {
        while (true) {
          active(); const page = await history(token, conversationId, { before, limit: 100 }); active();
          const conversation = page?.conversation;
          if (!conversation || conversation.id !== conversationId || (role === "admin" ? !id(conversation.client?.id) || !text(conversation.client.pseudonym, 64) : conversation.client !== null)
            || !text(conversation.peerName, 64) || !sequence(conversation.latestSequence) || !Array.isArray(page.messages) || page.messages.length > 100 || typeof page.hasMoreBefore !== "boolean") fail();
          if (upper === null) { upper = conversation.latestSequence; client = role === "admin" ? conversation.client.pseudonym : clientName; }
          if (role === "admin" && conversation.client.id !== expectedClientId) fail("changed");
          let previous = 0n;
          for (const message of page.messages) {
            if (!message || !id(message.id) || seen.has(message.id) || !sequence(message.sequence) || BigInt(message.sequence) <= previous
              || BigInt(message.sequence) > BigInt(upper) || before !== null && BigInt(message.sequence) >= BigInt(before)
              || !["me", "peer"].includes(message.sender) || !instant(message.createdAt)
              || message.deletedAt !== null && (!instant(message.deletedAt) || message.deletedAt < message.createdAt)
              || message.deletedAt === null && !text(message.body, 5000)
              || message.deletedAt !== null && (message.body !== null || message.media !== undefined || message.video !== undefined)
              || message.media !== undefined && message.video !== undefined) fail();
            previous = BigInt(message.sequence); seen.add(message.id); if (seen.size > limits.messages) fail("limit");
            const body = message.body ?? ""; bodyBytes += Buffer.byteLength(body); if (bodyBytes > limits.textBytes) fail("limit");
            const exported = { id: message.id, sequence: message.sequence, sender: role === "client" ? message.sender === "me" ? "peer" : "me" : message.sender,
              body, createdAt: message.createdAt, deletedAt: message.deletedAt };
            if (message.media !== undefined) {
              caption(body); const media = message.media;
              if (!id(media?.id) || media.sharedHere !== true || !Number.isSafeInteger(media.bytes) || media.bytes < 5 || media.bytes > 10485760
                || ![media.width, media.height].every((value) => Number.isSafeInteger(value) && value >= 1 && value <= 2048)) fail();
              const identity = `${message.sender}:${media.bytes}:${media.width}:${media.height}`, prior = photos.get(media.id);
              if (prior && prior.identity !== identity) fail("changed");
              if (!prior) {
                const item = { identity, file: null, width: media.width, height: media.height };
                photos.set(media.id, item);
                if (includePhotos) {
                  if (media.bytes > limits.photoBytes - photoBytes || media.bytes > limits.archiveBytes - originalBytes - photoBytes) fail("limit");
                  let result;
                  try {
                    active(); result = await photo(token, conversationId, message.id); active();
                    const bytes = result?.bytes;
                    if (result?.mime !== "image/jpeg" || !Buffer.isBuffer(bytes) || bytes.length !== media.bytes || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff || bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) fail("changed");
                    item.file = `photos/${media.id}.jpg`; item.sha256 = createHash("sha256").update(bytes).digest("hex");
                    retained.set(item.file, Buffer.from(bytes)); photoBytes += bytes.length;
                  } finally { result?.bytes?.fill?.(0); }
                }
              }
              const selected = photos.get(media.id);
              exported.photo = { file: selected.file, width: selected.width, height: selected.height, ...(selected.sha256 ? { sha256: selected.sha256 } : {}) };
            }
            if (message.video !== undefined) {
              caption(body); const metadata = message.video;
              if (!id(metadata?.id) || !Number.isSafeInteger(metadata.bytes) || metadata.bytes < 1 || metadata.bytes > 104857600 || metadata.mime !== "video/mp4"
                || metadata.contentUrl !== `/api/video/${role}/conversations/${conversationId}/messages/${message.id}/content`) fail();
              const identity = `${message.sender}:${metadata.bytes}:${metadata.mime}`, prior = videos.get(metadata.id);
              if (prior && prior.identity !== identity) fail("changed");
              if (!prior) {
                if (includeVideos && metadata.bytes > limits.archiveBytes - originalBytes - photoBytes) fail("limit");
                videos.set(metadata.id, { identity, bytes: metadata.bytes, messageId: message.id, file: `videos/${metadata.id}.mp4` });
                if (includeVideos) originalBytes += metadata.bytes;
              }
              exported.video = { file: includeVideos ? videos.get(metadata.id).file : null, bytes: metadata.bytes, mime: "video/mp4" };
            }
            messages.push(exported);
          }
          if (!page.hasMoreBefore) break;
          const cursor = page.messages[0]?.sequence;
          if (!sequence(cursor) || cursor === "0" || page.nextBefore !== cursor || before !== null && BigInt(cursor) >= BigInt(before)) fail(); before = cursor;
        }
        active(); messages.sort((a, b) => BigInt(a.sequence) < BigInt(b.sequence) ? -1 : 1);
        const completedAt = clock(); if (!instant(completedAt) || completedAt < startedAt) fail();
        const document = { format: "jessiemessage-conversation", version: 2, startedAt: new Date(startedAt).toISOString(), completedAt: new Date(completedAt).toISOString(),
          throughSequence: upper, administrator: "Jess", client, includePhotos, includeVideos, messages };
        documents(document, limits.textBytes, retained);
        const entries = [...retained].map(([name, bytes]) => ({ name, bytes: bytes.length, async open() {
          active(); return { source: (async function* () { for (let offset = 0; offset < bytes.length; offset += 262144) { active(); yield Buffer.from(bytes.subarray(offset, offset + 262144)); } })(), async close() {} };
        } }));
        if (includeVideos) for (const item of videos.values()) entries.push({ name: item.file, bytes: item.bytes, async open({ signal: readSignal }) {
          let handle;
          try {
            active(readSignal);
            handle = await video(token, conversationId, item.messageId, { signal: readSignal }); active(readSignal);
            if (!handle || handle.bytes !== item.bytes || handle.mime !== "video/mp4" || typeof handle.stream !== "function" || typeof handle.close !== "function") fail("changed");
            const source = handle.stream({ signal: readSignal });
            return { source: (async function* () { try { yield* source; } catch (error) { readFailure = mapped(error, lifetime.aborted || readSignal?.aborted); throw readFailure; } })(), close: () => handle.close() };
          } catch (error) { await handle?.close?.(); readFailure = mapped(error, lifetime.aborted || readSignal?.aborted); throw readFailure; }
        } });
        try { zip = createZipStream(entries, { signal: lifetime, maxBytes: limits.archiveBytes }); }
        catch (error) { if (error?.code === "ZIP_LIMIT") fail("limit"); throw error; }
        let started = false, closing;
        preparedClose = () => {
          closing ??= Promise.resolve().then(async () => { controller.abort(); try { await zip.close(); } finally { finish(); } });
          return closing;
        };
        active();
        return Object.freeze({ bytes: zip.bytes,
          stream({ signal: streamSignal } = {}) {
            if (started || finished || streamSignal !== undefined && !(streamSignal instanceof AbortSignal)) fail("input");
            started = true; const combined = streamSignal ? AbortSignal.any([lifetime, streamSignal]) : lifetime;
            const iterator = (async function* () {
              try {
                active(combined);
                for await (const chunk of zip.stream({ signal: combined })) {
                  let handedOver = false;
                  try { active(combined); handedOver = true; yield chunk; }
                  finally { if (!handedOver) chunk.fill(0); }
                }
                active(combined);
              }
              catch (error) { throw mapped(readFailure ?? error, combined.aborted); }
              finally { await preparedClose(); }
            })();
            return { [Symbol.asyncIterator]() { return this; }, next: (value) => iterator.next(value),
              async return(value) {
                let failure;
                try { await preparedClose(); } catch (error) { failure = error; }
                try { const result = await iterator.return(value); if (failure) throw failure; return result; }
                catch (error) { throw mapped(error); }
              },
              async throw(error) {
                try { await preparedClose(); } catch { /* Still terminate the generator after a failed close. */ }
                try { return await iterator.throw(error); } catch (failure) { throw mapped(failure); }
              } };
          }, close: preparedClose });
      } catch (error) {
        try { await zip?.close(); } finally { finish(); }
        throw mapped(error, lifetime.aborted);
      }
    }
  });
}
