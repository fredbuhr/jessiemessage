// One visibility control for existing and dynamically mounted password forms.
// It never copies a password, intercepts paste, or changes autocomplete.
(() => {
  if (globalThis.JessiePasswordFields) return;
  const controls = new Map(); let serial = 0;
  const translations = { "Afficher le mot de passe": "Show password", "Masquer le mot de passe": "Hide password" };
  globalThis.JessieI18n?.register(translations);
  const label = (node, source) => {
    const ui = globalThis.JessieI18n;
    if (ui) { ui.attr(node, "aria-label", source); ui.attr(node, "title", source); }
    else { node.setAttribute("aria-label", source); node.setAttribute("title", source); }
  };
  function enhance(input, { button = null } = {}) {
    if (controls.has(input)) return controls.get(input);
    if (!input || input.type !== "password" || !input.parentElement) throw new TypeError("Password input required");
    if (!input.id) input.id = `jessie-password-${++serial}`;
    input.setAttribute("data-jm-password", "");
    const wrapper = document.createElement("span"); wrapper.className = "password-field";
    input.parentElement.insertBefore(wrapper, input); wrapper.append(input);
    const toggle = button ?? document.createElement("button");
    toggle.type = "button"; toggle.className = "password-eye";
    toggle.removeAttribute("data-jm-i18n"); globalThis.JessieI18n?.forget(toggle);
    toggle.textContent = ""; toggle.setAttribute("aria-controls", input.id);
    if (document.createElementNS) {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("aria-hidden", "true"); svg.setAttribute("focusable", "false");
      const outline = document.createElementNS("http://www.w3.org/2000/svg", "path");
      outline.setAttribute("d", "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z");
      const pupil = document.createElementNS("http://www.w3.org/2000/svg", "circle"); pupil.setAttribute("cx", "12"); pupil.setAttribute("cy", "12"); pupil.setAttribute("r", "3");
      const slash = document.createElementNS("http://www.w3.org/2000/svg", "path"); slash.classList.add("password-eye-slash"); slash.setAttribute("d", "M3 3 21 21");
      svg.append(outline, pupil, slash); toggle.append(svg);
    } else { const icon = document.createElement("span"); icon.textContent = "◉"; icon.setAttribute("aria-hidden", "true"); toggle.append(icon); }
    wrapper.append(toggle);
    function display(show) {
      const start = input.selectionStart, end = input.selectionEnd, direction = input.selectionDirection;
      input.type = show ? "text" : "password";
      if (Number.isInteger(start) && Number.isInteger(end)) {
        try { input.setSelectionRange(start, end, direction ?? "none"); } catch {}
      }
      toggle.setAttribute("aria-pressed", String(show)); label(toggle, show ? "Masquer le mot de passe" : "Afficher le mot de passe");
    }
    const click = () => { if (!input.disabled) display(input.type === "password"); };
    toggle.addEventListener("click", click);
    const reset = () => display(false), form = input.form;
    form?.addEventListener("reset", reset);
    const api = Object.freeze({ input, button: toggle, reset, destroy() {
      reset(); toggle.removeEventListener("click", click); form?.removeEventListener("reset", reset);
      globalThis.JessieI18n?.forget(toggle); controls.delete(input);
    } });
    controls.set(input, api); reset(); return api;
  }
  function enhanceAll(root = document) {
    for (const input of root.querySelectorAll('input[type="password"]')) {
      const button = input.id === "password" ? root.querySelector?.("#toggle-password") : null;
      enhance(input, { button });
    }
  }
  function resetAll(root = null) {
    const descendants = root?.querySelectorAll ? new Set(root.querySelectorAll("[data-jm-password]")) : null;
    for (const [input, control] of controls) if (!descendants || descendants.has(input) || input === root) control.reset();
  }
  globalThis.JessiePasswordFields = Object.freeze({ enhance, enhanceAll, resetAll });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => enhanceAll(), { once: true });
  else enhanceAll();
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") resetAll(); });
  globalThis.window?.addEventListener("pagehide", () => resetAll());
})();
