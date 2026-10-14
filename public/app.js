const translations = {
  fr: {
    badge: "ESPACE PRIVÉ",
    title: "Un espace simple pour garder le contact.",
    subtitle: "JessieMessage est une messagerie personnelle accessible uniquement sur invitation.",
    notice: "Ouverture prochaine — les inscriptions sont désactivées pour le moment.",
    conversation: "Conversation privée",
    bubble1: "Bienvenue sur JessieMessage !",
    bubble2: "À bientôt 👋",
    composer: "Messagerie bientôt disponible",
    preview: "Aperçu illustratif — aucun compte n'est encore actif.",
    footer: "JessieMessage · Accès privé sur invitation · Aucun paiement sur ce site"
  },
  en: {
    badge: "PRIVATE SPACE",
    title: "A simple place to stay connected.",
    subtitle: "JessieMessage is a personal messaging space, available by invitation only.",
    notice: "Coming soon — registration is currently disabled.",
    conversation: "Private conversation",
    bubble1: "Welcome to JessieMessage!",
    bubble2: "See you soon 👋",
    composer: "Messaging coming soon",
    preview: "Illustrative preview — no accounts are active yet.",
    footer: "JessieMessage · Invitation-only access · No payments on this site"
  }
};

let language = navigator.language.toLowerCase().startsWith("fr") ? "fr" : "en";
const switcher = document.querySelector("#language-switch");

function renderLanguage() {
  document.documentElement.lang = language;
  for (const element of document.querySelectorAll("[data-i18n]")) {
    const translation = translations[language][element.dataset.i18n];
    if (translation) element.textContent = translation;
  }
  switcher.textContent = language === "fr" ? "EN" : "FR";
  switcher.setAttribute("aria-label", language === "fr" ? "Switch to English" : "Passer en français");
  document.title = language === "fr" ? "JessieMessage — Espace privé" : "JessieMessage — Private space";
}

switcher.addEventListener("click", () => {
  language = language === "fr" ? "en" : "fr";
  renderLanguage();
});
renderLanguage();
