const ui = globalThis.JessieI18n ?? { text(node, text, params = {}) { node.textContent = text.replace(/\{(\w+)\}/g, (_, key) => String(params[key] ?? "")); }, dateParam: value => new Date(value).toLocaleString(), forget() {} };
export function createFollowupUI({ host, getConversation, getReplyThrough = () => "0", request, onChanged, onError = () => {} }) {
  const section = document.createElement("section"); section.className = "reply-followup"; section.hidden = true;
  const status = document.createElement("p"); status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
  const feedback = document.createElement("p"); feedback.setAttribute("role", "status"); feedback.setAttribute("aria-live", "polite");
  const needed = document.createElement("button"), handled = document.createElement("button");
  needed.type = handled.type = "button"; needed.className = handled.className = "text-button";
  ui.text(needed, "À répondre"); ui.text(handled, "Marquer comme traité"); section.append(status, needed, handled, feedback); host.append(section);
  let current = null, busy = false, epoch = 0, destroyed = false;
  function render(conversation = getConversation()) {
    current = conversation;
    const reply = current?.reply;
    section.hidden = !reply;
    needed.disabled = handled.disabled = busy || !reply;
    if (reply) ui.text(status, reply.needed ? reply.oldestAt === null ? "À répondre" : "Attente depuis le {date}" : "Traité", { date: reply.oldestAt === null ? "" : ui.dateParam(reply.oldestAt, { dateStyle: "medium", timeStyle: "short" }) });
  }
  async function mark(action) {
    if (destroyed || busy || !current?.reply) return;
    const snapshot = current, reply = { ...snapshot.reply }, through = getReplyThrough(snapshot);
    if (typeof through !== "string" || !/^(?:0|[1-9][0-9]{0,19})$/.test(through) || BigInt(through) > BigInt(reply.through)) return;
    const ticket = ++epoch; busy = true; ui.text(feedback, ""); render();
    try {
      const result = await request(`/api/chat/admin/conversations/${snapshot.id}/reply`, { mutation: true, account: true, body: { action, through, expectedVersion: reply.version } });
      if (destroyed || ticket !== epoch || getConversation()?.id !== snapshot.id) return;
      if (!result?.reply || typeof result.reply.needed !== "boolean") throw new Error("invalid_followup");
      onChanged(snapshot.id, result.reply); ui.text(feedback, "Suivi enregistré.");
    } catch (error) {
      if (destroyed || ticket !== epoch) return;
      if (error.status === 409) ui.text(feedback, "Le suivi a changé. Actualise avant de réessayer.");
      else await onError(error);
    } finally { if (!destroyed && ticket === epoch) { busy = false; render(); } }
  }
  const need = () => { void mark("needed"); }, done = () => { void mark("handled"); };
  needed.addEventListener("click", need); handled.addEventListener("click", done);
  return { update: render, clear() { epoch++; busy = false; current = null; ui.text(status, ""); ui.text(feedback, ""); section.hidden = true; }, destroy() { destroyed = true; epoch++; needed.removeEventListener("click", need); handled.removeEventListener("click", done); ui.forget(section); section.remove(); } };
}
