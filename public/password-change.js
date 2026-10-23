import { passwordProblem } from "./recover-model.js";
import "./password-fields.js";

const ui = globalThis.JessieI18n ?? { text(node, value) { node.textContent = value; }, attr(node, key, value) { node.setAttribute(key, value); }, forget() {} };
let serial = 0;
export function createPasswordChangeUI({ role, request, isCurrent, onSessionChanged, onError, host }) {
  if (!["admin", "client"].includes(role) || typeof request !== "function" || typeof isCurrent !== "function"
    || typeof onSessionChanged !== "function" || !host) throw new TypeError("invalid_password_change_adapter");
  const node = (tag, text = null, className = "") => { const value = document.createElement(tag); value.className = className; if (text !== null) ui.text(value, text); return value; };
  const section = node("details", null, "profile-password"), summary = node("summary", "Modifier mon mot de passe");
  const form = node("form", null, "profile-password-form");
  const fields = [["current", "Mot de passe actuel", "current-password"], ["new", "Nouveau mot de passe", "new-password"], ["confirmation", "Confirmer le nouveau mot de passe", "new-password"]];
  const inputs = {}, eyes = [], identity = ++serial;
  for (const [key, title, autocomplete] of fields) {
    const label = node("label", null, "profile-field"), input = node("input", null, `profile-password-${key}`);
    input.type = "password"; input.id = `profile-password-${key}-${identity}`; input.name = key === "confirmation" ? "password-confirmation" : `${key}-password`;
    input.autocomplete = autocomplete; input.required = true; input.maxLength = 128; if (key !== "current") input.minLength = 8;
    label.append(node("span", title), input); form.append(label); inputs[key] = input;
    eyes.push(globalThis.JessiePasswordFields.enhance(input));
  }
  const help = node("p", "Entre 8 et 128 caractères. Les espaces et les accents sont conservés.", "profile-help");
  const consequence = node("p", "Cet appareil restera connecté. Les autres appareils devront se reconnecter avec le nouveau mot de passe.", "profile-help");
  const status = node("p", null, "profile-password-status"); status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
  const submit = node("button", "Enregistrer le nouveau mot de passe", "button secondary profile-password-save"); submit.type = "submit";
  form.append(help, consequence, submit, status); section.append(summary, form); host.append(section);
  let destroyed = false, busy = false, epoch = 0, controller = null;
  const current = ticket => !destroyed && ticket === epoch && isCurrent() && document.visibilityState !== "hidden";
  const message = (source, error = false) => { ui.text(status, source); status.classList.toggle("is-error", error); };
  const controls = () => { for (const input of Object.values(inputs)) input.disabled = busy; submit.disabled = busy; section.setAttribute("aria-busy", String(busy)); };
  function clear() { for (const input of Object.values(inputs)) input.value = ""; for (const eye of eyes) eye.reset(); }
  function close() { epoch += 1; controller?.abort(); controller = null; busy = false; clear(); section.open = false; message(""); controls(); }
  async function save(event) {
    event.preventDefault(); const ticket = epoch;
    if (!current(ticket) || busy) return;
    const problem = passwordProblem(inputs.new.value, inputs.confirmation.value);
    if (!inputs.current.value) { message("Saisis ton mot de passe actuel.", true); inputs.current.focus(); return; }
    if (problem) { message(problem === "mismatch" ? "Les deux nouveaux mots de passe doivent être identiques." : "Choisis un mot de passe de 8 à 128 caractères.", true); return; }
    busy = true; controls(); message("Modification du mot de passe…"); controller = new AbortController();
    try {
      const result = await request(`/api/account/${role}/password`, { account: true, mutation: true, signal: controller.signal,
        body: { currentPassword: inputs.current.value, newPassword: inputs.new.value, confirmation: inputs.confirmation.value } });
      if (!current(ticket)) return;
      if (result?.status !== "password_changed" || result.user?.role !== role || !/^[a-f0-9]{32}$/.test(result.user?.id ?? "")
        || typeof result.csrf !== "string" || !Number.isSafeInteger(result.expiresAt)) throw new Error("invalid_password_response");
      // Adopt the rotated session before allowing any subsequent mutation.
      await onSessionChanged(result);
      if (!current(ticket)) return;
      clear(); message("Mot de passe modifié. Cet appareil reste connecté.");
    } catch (error) {
      if (!current(ticket) || error?.stale || error?.name === "AbortError") return;
      if (error.status === 401 || error.status === 403 && error.code !== "current_password_invalid") {
        close(); try { await onError?.(error); } catch {} return;
      }
      message(error.code === "current_password_invalid" ? "Le mot de passe actuel est incorrect."
        : error.status === 429 ? "Patiente un moment avant de réessayer."
          : error.code === "password_mismatch" ? "Les deux nouveaux mots de passe doivent être identiques."
            : error.code === "invalid_password" ? "Choisis un mot de passe de 8 à 128 caractères."
              : "La modification n’a pas pu être confirmée. Actualise pour vérifier ta session avant de réessayer.", true);
    } finally { if (current(ticket)) { busy = false; controller = null; for (const eye of eyes) eye.reset(); controls(); } }
  }
  const toggle = () => { if (!section.open) { epoch += 1; controller?.abort(); controller = null; busy = false; clear(); message(""); controls(); } };
  section.addEventListener("toggle", toggle); form.addEventListener("submit", save);
  return Object.freeze({ close, get section() { return section; }, destroy() {
    if (destroyed) return; close(); destroyed = true;
    section.removeEventListener("toggle", toggle); form.removeEventListener("submit", save);
    for (const eye of eyes) eye.destroy(); ui.forget(section); section.remove();
  } });
}
