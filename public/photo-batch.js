// Private photo drafts live only in this page. Successful items keep their
// original request identity until the whole selection is dismissed.
export const MAX_PHOTO_BATCH = 10;
const id = value => typeof value === "string" && /^[a-f0-9]{32}$/.test(value);
export function createPhotoBatch(files, makeId, existing = null) {
  if (!Array.isArray(files) || !files.length || typeof makeId !== "function" || existing?.started || existing?.busy) throw new TypeError("invalid_photo_selection");
  const items = existing?.items ?? [];
  if (items.length + files.length > MAX_PHOTO_BATCH) throw new TypeError("photo_selection_limit");
  const added = files.map(file => {
    const clientMessageId = makeId(); if (!id(clientMessageId)) throw new TypeError("invalid_photo_identity");
    return { clientMessageId, file, prepared: null, mediaId: null, status: "ready", error: null, previewUrl: null };
  });
  if (new Set([...items, ...added].map(item => item.clientMessageId)).size !== items.length + added.length) throw new TypeError("duplicate_photo_identity");
  return { items: [...items, ...added], started: false, busy: false, caption: null, replyThrough: null };
}
export function removePhoto(batch, clientMessageId) {
  if (!batch || batch.busy) return null;
  const item = batch.items.find(value => value.clientMessageId === clientMessageId);
  if (!item || batch.started && !(item.status === "failed" && (!item.mediaId || [400,404,413,415,422].includes(item.error?.status)))) return null;
  batch.items = batch.items.filter(value => value !== item); return item;
}
function failure(item, error, uncertain = false) {
  item.status = uncertain ? "uncertain" : "failed";
  item.error = { status: Number.isInteger(error?.status) ? error.status : 0, code: typeof error?.code === "string" ? error.code : "media_unavailable" };
}
export async function runPhotoBatch(batch, { prepare, upload, send, current = () => true, changed = () => {} }) {
  if (!batch || batch.busy || !batch.items.length || batch.items.length > MAX_PHOTO_BATCH) return false;
  const check = () => { if (!current()) throw Object.assign(new Error("stale_photo_selection"), { stale: true }); };
  batch.busy = true; batch.started = true; changed();
  try {
    for (const item of batch.items) {
      check(); if (item.status === "sent" || item.mediaId) continue;
      try {
        item.error = null; item.status = "preparing"; changed();
        if (!item.prepared) item.prepared = await prepare(item.file);
        check(); item.status = "uploading"; changed();
        const asset = await upload(item.prepared);
        check(); if (!id(asset?.id)) throw new Error("invalid_photo_asset");
        item.mediaId = asset.id; item.status = "ready"; changed();
      } catch (error) {
        if (error?.stale) throw error;
        failure(item, error); changed();
        if ([401, 403].includes(error?.status)) throw error;
        break; // Later photos keep their preview order until this one succeeds.
      }
    }
    check(); const pending = [];
    for (const item of batch.items) {
      if (item.status === "sent") continue;
      if (!item.mediaId) break;
      pending.push(item);
    }
    if (pending.length) {
      for (const item of pending) { item.status = "sending"; item.error = null; } changed();
      try {
        const result = await send(pending.map(item => ({ clientMessageId: item.clientMessageId, mediaId: item.mediaId,
          caption: item === batch.items[0] ? batch.caption ?? "" : "", ...(batch.replyThrough === null ? {} : { replyThrough: batch.replyThrough, ...(batch.replyVersion === undefined ? {} : { replyVersion: batch.replyVersion }) }) })));
        check();
        if (!Array.isArray(result?.results) || result.results.length !== pending.length || new Set(result.results.map(item => item.clientMessageId)).size !== pending.length
          || result.results.some(row => !pending.some(item => item.clientMessageId === row.clientMessageId))) throw new Error("invalid_photo_result");
        for (const item of pending) {
          const row = result.results.find(value => value.clientMessageId === item.clientMessageId);
          if (row.message && id(row.message.id) && row.message.clientMessageId === item.clientMessageId && typeof row.duplicate === "boolean") {
            item.status = "sent"; item.message = row.message; if (item === batch.items[0]) batch.captionDelivered = true; item.file = null; item.prepared = null;
          } else if (row.status === 424 && row.error === "photo_batch_waiting") { item.status = "waiting"; item.error = null; }
          else failure(item, row, !Number.isInteger(row.status) || row.status >= 500);
        }
      } catch (error) {
        for (const item of pending) if (item.status !== "sent") failure(item, error, true);
        if (error?.stale || [401, 403].includes(error?.status)) throw error;
      }
      changed();
    }
    return batch.items.every(item => item.status === "sent");
  } finally { batch.busy = false; changed(); }
}
