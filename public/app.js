const translations = {
  fr: {
    badge: "Le coin de Jessie",
    title: "On garde le contact ?",
    subtitle: "Un petit mot, une photo, le plaisir de se retrouver.",
    intro: "Mon espace privé pour retrouver nos échanges, tout simplement.",
    access: "Accès sur invitation, réservé aux adultes.",
    invitation: "Une nouvelle invitation ? Ouvre directement le lien que je t’ai envoyé.",
    signoff: "À bientôt, Jessie",
    footer: "JessieMessage · Espace privé sur invitation",
    open: "Ouvrir ma conversation",
    contact: "Contact",
    skip: "Aller au contenu",
    information: "Informations",
    description: "Retrouve nos messages et nos photos dans mon espace privé, accessible sur invitation."
  },
  en: {
    badge: "Jessie’s corner",
    title: "Shall we stay in touch?",
    subtitle: "A little note, a photo, a lovely reason to catch up.",
    intro: "My private space to pick up our conversation, nice and simple.",
    access: "For invited adults only.",
    invitation: "A new invitation? Open the link I sent you directly.",
    signoff: "See you soon, Jessie",
    footer: "JessieMessage · Private space by invitation",
    open: "Open my conversation",
    contact: "Contact",
    skip: "Skip to content",
    information: "Information",
    description: "Find our messages and photos in my private space, available by invitation."
  }
};

const sharedLanguage = globalThis.JessieI18n;
let language = sharedLanguage?.getLanguage() ?? (navigator.language.toLowerCase().startsWith("fr") ? "fr" : "en");
const switcher = document.querySelector("#language-switch");

function renderLanguage() {
  document.documentElement.lang = language;
  for (const element of document.querySelectorAll("[data-i18n]")) {
    const translation = translations[language][element.dataset.i18n];
    if (translation) element.textContent = translation;
  }
  for (const element of document.querySelectorAll("[data-i18n-aria]")) {
    const translation = translations[language][element.dataset.i18nAria];
    if (translation) element.setAttribute("aria-label", translation);
  }
  document.querySelector('meta[name="description"]')?.setAttribute("content", translations[language].description);
  switcher.textContent = language === "fr" ? "EN" : "FR";
  switcher.setAttribute("aria-label", language === "fr" ? "Switch to English" : "Passer en français");
  document.title = language === "fr" ? "Jessie — Mon espace privé" : "Jessie — My private space";
}

if (sharedLanguage) sharedLanguage.onChange((next) => { language = next; renderLanguage(); });
else switcher.addEventListener("click", () => { language = language === "fr" ? "en" : "fr"; renderLanguage(); });
renderLanguage();
