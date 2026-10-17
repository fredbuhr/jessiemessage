(() => {
  "use strict";
  const i18n = globalThis.JessieI18n;
  if (!i18n) return;
  i18n.register({
    "Aide et confidentialité": "Help and privacy",
    "Aide et confidentialité (nouvel onglet)": "Help and privacy (new tab)",
  });
  const updateLinks = () => {
    const language = i18n.getLanguage() === "en" ? "en" : "fr";
    for (const link of document.querySelectorAll("a[data-help-link]")) {
      link.setAttribute("href", `/help#lang=${language}`);
    }
  };
  updateLinks();
  i18n.onChange(updateLinks);
})();
