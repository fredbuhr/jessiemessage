const ui = globalThis.JessieI18n;

/** Mounted only for an active client, with the chat's existing identity proof. */
export function createConversationDownload({ parent, capability, getContext, request, onError, getReturnFocus }) {
  const node = (tag, text, className) => { const value = document.createElement(tag); if (text) ui.text(value, text); if (className) value.className = className; return value; };
  const entry = node("button", "Télécharger ma conversation", "text-button conversation-download-entry"); entry.type = "button"; entry.hidden = true;
  const dialog = node("dialog", null, "media-dialog conversation-download"); dialog.setAttribute("aria-labelledby", "conversation-download-title");
  const head = node("div", null, "dialog-head"), title = node("h2", "Télécharger ma conversation"), close = node("button", "Fermer", "text-button");
  title.id = "conversation-download-title"; close.type = "button"; head.append(title, close);
  const photos = document.createElement("input"); photos.type = "checkbox"; photos.checked = capability.photos === true;
  const label = node("label", null, "conversation-download-photos"); label.hidden = capability.photos !== true;
  label.append(photos, node("span", "Inclure les photos partagées"));
  const download = node("button", "Télécharger le ZIP", "button primary"); download.type = "button";
  const status = node("p", null, "media-help"); status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
  dialog.append(head, node("p", "Les messages et les photos que nous avons partagés.", "media-help"), label, download, status,
    node("p", "Le fichier se lit sans connexion. Conserve-le dans un endroit privé.", "media-help"));
  parent.append(entry); document.body.append(dialog);
  let cleared = false, epoch = 0, busy = false, controller = null, opened = null;
  const urls = new Map();
  const revoke = url => { if (!urls.has(url)) return; clearTimeout(urls.get(url)); urls.delete(url); URL.revokeObjectURL(url); };
  const current = context => { const value = getContext(); return !cleared && value && value.id === context?.id && value.key === context.key; };
  function stop(restore = false) {
    const focus = restore && dialog.open; epoch += 1; controller?.abort(); controller = null; busy = false; opened = null;
    download.disabled = false; photos.disabled = false; ui.rawText(status, "");
    for (const url of urls.keys()) revoke(url);
    if (dialog.open) dialog.close();
    if (focus) {
      const target = typeof getReturnFocus === "function" ? getReturnFocus() : entry;
      if (target?.isConnected && !target.hidden) target.focus();
    }
  }
  entry.addEventListener("click", () => {
    const context = getContext(); if (!context || cleared) return;
    stop(); opened = context; dialog.showModal(); close.focus();
  });
  close.addEventListener("click", () => stop(true));
  dialog.addEventListener("cancel", event => { event.preventDefault(); stop(true); });
  dialog.addEventListener("close", () => { if (!dialog.open && (opened || busy || urls.size)) stop(); });
  download.addEventListener("click", () => { void save(); });
  async function save() {
    if (busy || !dialog.open || !current(opened)) return;
    const context = opened, ticket = ++epoch, cancellation = new AbortController(); controller = cancellation; busy = true;
    download.disabled = true; photos.disabled = true; ui.text(status, "Préparation de la conversation…");
    const fresh = () => ticket === epoch && dialog.open && current(context) && !cancellation.signal.aborted;
    try {
      const blob = await request(`/api/chat/client/conversations/${context.id}/export`, { body: { includePhotos: capability.photos === true && photos.checked },
        mutation: true, archive: true, state: context.state, signal: cancellation.signal });
      if (!fresh()) return;
      if (!(blob instanceof Blob) || blob.size < 22 || blob.size > capability.maxBytes) throw new Error("invalid_archive");
      const url = URL.createObjectURL(blob); urls.set(url, setTimeout(() => revoke(url), 5000));
      const link = document.createElement("a"); link.href = url; link.download = `JessieMessage-conversation-${context.id}.zip`; link.hidden = true;
      document.body.append(link); try { link.click(); } finally { link.remove(); }
      ui.text(status, "Conversation téléchargée. Extrais le ZIP puis ouvre Conversation.html.");
    } catch (error) {
      if (!fresh() || error.stale) return;
      if ([401, 403].includes(error.status)) { stop(); onError(error); return; }
      ui.text(status, error.code === "conversation_export_limit" ? "La conversation dépasse la limite de téléchargement. Essaie sans les photos si elles sont incluses." :
        error.code === "conversation_export_busy" ? "Une préparation est déjà en cours ou vient de se terminer. Patiente trente secondes puis réessaie." :
          "Le téléchargement n’est pas disponible. Réessaie ; aucun fichier incomplet n’est proposé.");
    } finally { if (ticket === epoch) { controller = null; busy = false; download.disabled = false; photos.disabled = false; } }
  }
  return {
    update() { entry.hidden = cleared || !getContext(); },
    suspend() { stop(); entry.hidden = true; },
    clear() { cleared = true; stop(); ui.forget(entry); ui.forget(dialog); entry.remove(); dialog.remove(); }
  };
}
