const translations = {
  fr: {
    badge: "ESPACE PRIVÉ",
    title: "Un espace simple pour garder le contact.",
    subtitle: "JessieMessage est une messagerie personnelle accessible uniquement sur invitation.",
    notice: "L’accès est réservé aux personnes invitées par Jessie.",
    conversation: "Conversation privée",
    bubble1: "Bienvenue sur JessieMessage !",
    bubble2: "À bientôt 👋",
    composer: "Conversation sur invitation",
    preview: "Aperçu illustratif — aucun message personnel affiché.",
    footer: "JessieMessage · Accès privé sur invitation · Aucun paiement sur ce site",
    open: "Ouvrir mon espace",
    contact: "Contact"
  },
  en: {
    badge: "PRIVATE SPACE",
    title: "A simple place to stay connected.",
    subtitle: "JessieMessage is a personal messaging space, available by invitation only.",
    notice: "Access is reserved for people invited by Jessie.",
    conversation: "Private conversation",
    bubble1: "Welcome to JessieMessage!",
    bubble2: "See you soon 👋",
    composer: "Conversation by invitation",
    preview: "Illustrative preview — no personal messages displayed.",
    footer: "JessieMessage · Invitation-only access · No payments on this site",
    open: "Open my space",
    contact: "Contact"
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
