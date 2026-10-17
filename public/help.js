(() => {
  "use strict";
  // Consume only a fixed language or local section hint. Clear the entire URL
  // suffix before reading a preference, translating, or following any hint.
  const fragment = globalThis.location?.hash ?? "";
  try { globalThis.history?.replaceState(null, "", "/help"); } catch { /* The page remains usable if history is unavailable. */ }
  const language = fragment === "#lang=fr" ? "fr" : fragment === "#lang=en" ? "en" : null;
  const section = ["#access", "#notifications", "#privacy", "#contact", "#report"].includes(fragment) ? fragment.slice(1) : null;
  const ui = globalThis.JessieI18n;
  if (!ui) return;
  ui.register({
    "Jessie — Aide et confidentialité": "Jessie — Help and privacy",
    "Des réponses simples pour profiter de ton espace privé JessieMessage.": "Simple answers to help you enjoy your private JessieMessage space.",
    "AIDE ET CONFIDENTIALITÉ": "HELP AND PRIVACY",
    "Un coup de main ?": "Need a hand?",
    "Retrouve les réponses utiles pour te sentir bien dans ton espace avec Jessie.": "Find helpful answers to feel at home in your space with Jessie.",
    "Retrouver mon espace": "Back to my space",
    "Les rubriques d’aide": "Help topics",
    "Mon accès": "My access",
    "Notifications": "Notifications",
    "Mes données": "My data",
    "Contacter Jessie": "Contact Jessie",
    "Retrouver ton espace": "Finding your space",
    "Comment rejoindre Jessie ?": "How do I join Jessie?",
    "JessieMessage est un espace privé sur invitation, réservé aux adultes. Ouvre le lien envoyé par Jessie, crée ton compte et confirme ton e-mail. Jessie validera ensuite ton accès.": "JessieMessage is a private, invitation-only space for adults. Open the link Jessie sent you, create your account and confirm your email. Jessie will then approve your access.",
    "Déclarer avoir 18 ans ne constitue pas une vérification de majorité.": "Declaring that you are 18 does not verify your age.",
    "Faut-il se reconnecter à chaque visite ?": "Do I need to sign in every time?",
    "Ta connexion peut rester ouverte sur plusieurs appareils. Une utilisation régulière la prolonge. Après environ six mois sans utilisation, il faut te reconnecter.": "You can stay signed in on several devices. Regular use keeps your sign-in active. After about six months without use, you need to sign in again.",
    "Une déconnexion, un changement de mot de passe ou l’effacement des données du navigateur peut aussi fermer ta connexion. Tu peux gérer tes connexions dans « Mon accès ».": "Signing out, changing your password or clearing your browser data can also end your sign-in. You can manage your sign-ins in “My access”.",
    "J’ai oublié mon mot de passe.": "I forgot my password.",
    "Demande un lien avec l’adresse e-mail de ton compte. Vérifie aussi tes courriers indésirables. Le lien reçu est valable 30 minutes et ne sert qu’une fois. Utilise le dernier lien reçu.": "Request a link using your account’s email address. Check your spam folder too. The link you receive is valid for 30 minutes and can only be used once. Use the most recent link you received.",
    "Choisir un nouveau mot de passe": "Choose a new password",
    "Une fois le mot de passe changé, reconnecte ce compte sur tes appareils, puis réactive ses notifications. La récupération ne prolonge pas la durée de ton accès.": "After changing the password, sign this account in on your devices again, then turn its notifications back on. Password recovery does not extend your access period.",
    "Garder le contact": "Staying in touch",
    "Comment recevoir les notifications ?": "How do I get notifications?",
    "Dans ton espace, ouvre « Notifications », choisis « Activer sur cet appareil » et accepte la demande du navigateur. Fais-le sur chaque appareil où tu souhaites recevoir les alertes.": "In your space, open “Notifications”, choose “Turn on on this device” and accept your browser’s request. Do this on each device where you want alerts.",
    "Sur iPhone ou iPad, ouvre le menu Partager de Safari, choisis « Sur l’écran d’accueil », puis ouvre Jessie depuis son icône pour activer les notifications.": "On iPhone or iPad, open Safari’s Share menu, choose “Add to Home Screen”, then open Jessie from its icon to turn on notifications.",
    "Les alertes restent discrètes : elles n’affichent ni le nom du client, ni le texte, ni la photo du message. Le service de notifications de ton navigateur transmet l’alerte à ton appareil.": "Alerts stay discreet: they do not show the client’s name, message text or photo. Your browser’s notification service delivers the alert to your device.",
    "Une alerte ou un message n’arrive pas ?": "An alert or message is missing?",
    "Vérifie ta connexion internet, les autorisations de notification du navigateur et le mode silencieux de ton appareil. Reviens ensuite dans « Notifications » pour vérifier tes réglages.": "Check your internet connection, your browser’s notification permissions and your device’s silent mode. Then return to “Notifications” to check your settings.",
    "Une alerte peut être retardée par le navigateur ou l’appareil. Tu peux toujours ouvrir ta conversation pour retrouver les messages. JessieMessage a besoin d’une connexion internet.": "Your browser or device may delay an alert. You can always open your conversation to find your messages. JessieMessage needs an internet connection.",
    "Ton espace, tes données": "Your space, your data",
    "Voici comment fonctionne l’espace aujourd’hui.": "Here is how the space works today.",
    "Quelles informations sont conservées ?": "What information is stored?",
    "Le service conserve ton pseudonyme, ton e-mail, les informations nécessaires à ton accès et à tes connexions, ta déclaration d’âge, tes messages, tes photos et l’état de lecture de la conversation. Le mot de passe est enregistré sous une forme qui permet de le vérifier sans le conserver en clair.": "The service stores your display name, email, information needed for your access and sign-ins, your age declaration, your messages, your photos and the conversation’s read status. Your password is stored in a form that allows it to be checked without keeping it as readable text.",
    "Un cookie de connexion sert à te reconnaître sur cet appareil. Le choix français ou anglais est gardé dans l’onglet. Si tu actives les notifications, un abonnement est associé à cet appareil et à ton compte.": "A sign-in cookie recognises you on this device. Your French or English choice is kept in this tab. If you turn on notifications, a subscription is linked to this device and your account.",
    "Comment les échanges sont-ils protégés ?": "How are conversations protected?",
    "La conversation est accessible depuis ton compte et celui de Jessie. Le service chiffre les messages et les photos sur le serveur et les déchiffre pour les afficher aux personnes autorisées. Il ne s’agit pas d’un chiffrement de bout en bout.": "The conversation is accessible from your account and Jessie’s account. The service encrypts messages and photos on the server and decrypts them to show them to authorised people. This is not end-to-end encryption.",
    "Les photos envoyées sont préparées sans leurs métadonnées d’origine. L’application n’ajoute pas d’outil publicitaire ou de mesure d’audience.": "Photos are prepared without their original metadata. The application does not add advertising or audience-measurement tools.",
    "Une personne qui reçoit un message ou une photo peut en garder une copie. Partage seulement ce que tu souhaites lui confier.": "Someone who receives a message or photo can keep a copy. Only share what you are comfortable entrusting to them.",
    "Puis-je retirer un message ou une photo ?": "Can I remove a message or photo?",
    "Tu peux supprimer tes propres messages pour les retirer de la conversation pour vous deux. Une mention indique alors qu’un message a été supprimé. Une photo encore présente dans « Mes photos » doit aussi être retirée de cette bibliothèque si tu ne souhaites plus la conserver.": "You can delete your own messages to remove them from the conversation for both of you. A note then shows that a message was deleted. If a photo is still in “My photos”, remove it from that library too if you no longer want to keep it.",
    "Supprimer un échange ne retire pas les copies déjà gardées par son destinataire ni les sauvegardes du service.": "Deleting a conversation item does not remove copies its recipient has already kept or the service’s backups.",
    "Et pour une copie de mes données ou mon compte ?": "What about a copy of my data or my account?",
    "Les durées de conservation du compte, des échanges et des sauvegardes ne sont pas encore fixées. L’expiration de ton accès ne supprime pas automatiquement ta conversation.": "Retention periods for accounts, conversations and backups have not been set yet. Your conversation is not automatically deleted when your access expires.",
    "Pour connaître les données conservées, demander une copie ou la suppression de ton compte, contacte Jessie. La suppression du compte n’est pas disponible directement dans l’application.": "Contact Jessie to ask what data is stored, request a copy or request account deletion. Account deletion is not available directly in the application.",
    "Écrire au sujet de mes données": "Ask about my data",
    "Une question ? Écris à Jessie.": "A question? Write to Jessie.",
    "Pour un souci d’accès, une question sur tes données ou un problème dans l’application, tu peux écrire ici :": "For access help, questions about your data or a problem in the application, write here:",
    "Ne communique jamais ton mot de passe ni tes codes de connexion.": "Never share your password or sign-in codes.",
    "Quelque chose te met mal à l’aise ?": "Something making you uncomfortable?",
    "Un message, une photo ou un comportement te pose problème ? Explique simplement ce qui s’est passé pour que Jessie puisse examiner ton signalement.": "Is a message, photo or someone’s behaviour a problem? Simply explain what happened so Jessie can review your report.",
    "Signaler un problème": "Report a problem",
    "JessieMessage · Accès privé sur invitation": "JessieMessage · Private access by invitation",
  });
  if (language !== null) ui.setLanguage(language);
  function renderMetadata() {
    document.title = ui.t("Jessie — Aide et confidentialité");
    document.getElementById("help-description")?.setAttribute("content", ui.t("Des réponses simples pour profiter de ton espace privé JessieMessage."));
  }
  ui.onChange(renderMetadata);
  renderMetadata();
  if (section !== null) document.getElementById(section)?.scrollIntoView();
})();
