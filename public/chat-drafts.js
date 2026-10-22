// Tab-scoped text recovery only. Session credentials, media and message history
// never enter this record. Its session fingerprint grants no server authority.
const MAX_ENTRIES = 20, MAX_BYTES = 65536, MAX_AGE = 86400000;
const keyFor = role => `jessiemessage.chat-drafts.v1.${role}`;
const id = value => typeof value === "string" && /^[a-f0-9]{32}$/.test(value);
const keys = (value, names) => value && typeof value === "object" && !Array.isArray(value)
  && Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));
const text = value => typeof value === "string" && value.length <= 4096 && value.isWellFormed()
  && new TextEncoder().encode(value).length <= 16384
  && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(value);
const pendingText = (value, body) => keys(value, ["clientMessageId"]) && id(value.clientMessageId)
  && text(body) && body.trim().length > 0 && !/^[\p{C}\p{Z}]+$/u.test(body);
const sameOwner = (left, right) => left?.role === right?.role && left?.id === right?.id && left?.csrf === right?.csrf;

export function createChatDrafts({ storage = () => globalThis.sessionStorage, clock = () => Date.now(),
  digest = bytes => globalThis.crypto.subtle.digest("SHA-256", bytes) } = {}) {
  let active = null, generation = 0;
  const currentTime = () => { const now = clock(); return Number.isSafeInteger(now) && now >= 0 ? now : null; };
  const remove = (store, key) => { try { store?.removeItem(key); } catch {} };
  function validEntry(entry, now) {
    return keys(entry, ["id", "text", "pending", "hadAttachment", "updatedAt"]) && id(entry.id) && text(entry.text)
      && typeof entry.hadAttachment === "boolean" && Number.isSafeInteger(entry.updatedAt)
      && entry.updatedAt >= 0 && (entry.pending !== null || entry.updatedAt <= now && entry.updatedAt >= now - MAX_AGE)
      && (entry.pending === null || pendingText(entry.pending, entry.text) && !entry.hadAttachment);
  }
  function persist(record, entries, selected) {
    const value = { version: 1, role: record.owner.role, id: record.owner.id, sessionTag: record.sessionTag, selected, entries };
    let encoded = JSON.stringify(value);
    while (entries.length > MAX_ENTRIES || new TextEncoder().encode(encoded).length > MAX_BYTES) {
      // Losing an immutable POST identity could turn an uncertain send into a
      // duplicate. Only ordinary older drafts may make room for a new entry.
      const discard = entries.findIndex(entry => entry.id !== selected && entry.pending === null);
      if (discard < 0) return false;
      entries.splice(discard, 1); encoded = JSON.stringify(value);
    }
    try {
      record.store.setItem(record.key, encoded);
      if (record.store.getItem(record.key) !== encoded) return false;
      record.entries = entries; record.selected = selected; return true;
    } catch { return false; }
  }
  function write(state, { selected = true } = {}) {
    const record = active, now = currentTime();
    if (!record?.store || now === null || !id(state?.id) || !text(state.draft)) return false;
    const pending = state.pending && !state.pending.kind ? { clientMessageId: state.pending.clientMessageId } : null;
    if (pending && (!pendingText(pending, state.draft) || state.pending.body !== state.draft)) return false;
    const previous = record.entries.find(entry => entry.id === state.id);
    if (previous?.pending && pending && (previous.pending.clientMessageId !== pending.clientMessageId || previous.text !== state.draft)) return false;
    // A media POST may already have committed. Never turn its uncertain
    // caption into a new text-only send after reloading without the file.
    const exclude = Boolean(state.pending?.kind);
    const hadAttachment = !pending && Boolean(state.imageDraft || state.videoDraft);
    const entries = record.entries.filter(entry => entry.id !== state.id && (entry.pending !== null || validEntry(entry, now)));
    if (!exclude && (state.draft.length || pending)) {
      const unchanged = previous?.text === state.draft && previous.hadAttachment === hadAttachment && JSON.stringify(previous.pending) === JSON.stringify(pending);
      entries.push({ id: state.id, text: state.draft, pending, hadAttachment, updatedAt: unchanged ? previous.updatedAt : now });
    }
    entries.sort((left, right) => left.updatedAt - right.updatedAt);
    const selectedId = selected ? entries.some(entry => entry.id === state.id) ? state.id : null : record.selected;
    if (JSON.stringify(entries) === JSON.stringify(record.entries) && selectedId === record.selected) return true;
    return persist(record, entries, selectedId);
  }
  return Object.freeze({
    async bind(owner) {
      if (!["admin", "client"].includes(owner?.role) || !id(owner.id) || typeof owner.csrf !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(owner.csrf)) return false;
      if (sameOwner(active?.owner, owner)) return active.binding;
      const ticket = ++generation, record = { owner: { ...owner }, store: null, entries: [], selected: null };
      active = record;
      record.binding = (async () => {
      let store;
      try { store = storage(); } catch { return false; }
      if (!["getItem", "setItem", "removeItem"].every(method => typeof store?.[method] === "function")) return false;
      try {
        const hash = await digest(new TextEncoder().encode(`jessiemessage:chat-drafts:v1:${owner.role}:${owner.id}:${owner.csrf}`));
        if (generation !== ticket || active !== record) return false;
        if (Object.prototype.toString.call(hash) !== "[object ArrayBuffer]" || hash.byteLength !== 32) return false;
        record.sessionTag = [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, "0")).join("");
        record.key = keyFor(owner.role); record.store = store;
        const raw = store.getItem(record.key), now = currentTime();
        if (raw === null) return true;
        if (typeof raw !== "string" || raw.length > MAX_BYTES || new TextEncoder().encode(raw).length > MAX_BYTES || now === null) throw new Error("invalid_drafts");
        const saved = JSON.parse(raw);
        if (!keys(saved, ["version", "role", "id", "sessionTag", "selected", "entries"]) || saved.version !== 1
          || saved.role !== owner.role || saved.id !== owner.id || saved.sessionTag !== record.sessionTag
          || saved.selected !== null && !id(saved.selected) || !Array.isArray(saved.entries) || saved.entries.length > MAX_ENTRIES
          || new Set(saved.entries.map(entry => entry?.id)).size !== saved.entries.length) throw new Error("invalid_drafts");
        record.entries = saved.entries.filter(entry => validEntry(entry, now));
        record.selected = record.entries.some(entry => entry.id === saved.selected) ? saved.selected : null;
        if (record.entries.length !== saved.entries.length) persist(record, record.entries, record.selected);
        return true;
      } catch {
        if (generation !== ticket || active !== record) return false;
        remove(store, keyFor(owner.role)); record.entries = []; record.selected = null;
        return Boolean(record.store);
      }
      })();
      return record.binding;
    },
    read(conversationId) {
      const now = currentTime(), entry = active?.entries.find(value => value.id === conversationId);
      return now !== null && entry && validEntry(entry, now) ? JSON.parse(JSON.stringify(entry)) : null;
    },
    selected() { return active?.selected ?? null; },
    write,
    beforeSend(state) {
      if (write(state)) return { persisted: true, safeToSend: true };
      const previous = active?.entries.find(entry => entry.id === state.id);
      if (!previous) return { persisted: false, safeToSend: true };
      if (previous.pending) return { persisted: false, safeToSend: previous.pending.clientMessageId === state.pending?.clientMessageId && previous.text === state.pending?.body };
      const entries = active.entries.filter(entry => entry.id !== state.id), selected = active.selected === state.id ? null : active.selected;
      // An old ordinary draft must not survive an ambiguous new POST. First
      // shrink this record without dropping any other immutable request key.
      if (persist(active, entries, selected)) return { persisted: false, safeToSend: true };
      if (!entries.some(entry => entry.pending)) {
        try {
          active.store.removeItem(active.key);
          if (active.store.getItem(active.key) === null) { active.entries = []; active.selected = null; return { persisted: false, safeToSend: true }; }
        } catch {}
      }
      return { persisted: false, safeToSend: false };
    },
    forget(conversationId) {
      if (!active?.store) return;
      persist(active, active.entries.filter(entry => entry.id !== conversationId), active.selected === conversationId ? null : active.selected);
    },
    clear(role = active?.owner.role) {
      if (["admin", "client"].includes(role)) { try { remove(active?.store ?? storage(), keyFor(role)); } catch {} }
      active = null; generation += 1;
    },
    detach() { active = null; generation += 1; },
  });
}
