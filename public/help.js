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
    "Des réponses simples pour profiter de notre espace privé.": "Simple answers to help you enjoy our private space.",
    "AIDE ET CONFIDENTIALITÉ": "HELP AND PRIVACY",
    "Un coup de main ?": "Need a hand?",
    "Retrouve les réponses utiles pour te sentir bien dans notre espace privé.": "Find helpful answers to feel at home in our private space.",
    "Retrouver mon espace": "Back to my space",
    "Les rubriques d’aide": "Help topics",
    "Mon accès": "My access",
    "Notifications": "Notifications",
    "Mes données": "My data",
    "M’écrire": "Write to me",
    "Retrouver ton espace": "Finding your space",
    "Comment rejoindre mon espace ?": "How can you join my space?",
    "Mon espace privé est accessible sur invitation et réservé aux adultes. Ouvre le lien que je t’ai envoyé, crée ton compte et confirme ton e-mail. Ton accès attendra ensuite ma validation.": "My private space is invitation-only and for adults. Open the link I sent you, create your account and confirm your email. Your access will then await my approval.",
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
    "Dans notre conversation, ouvre « Options », puis « Notifications ». Choisis « Activer sur cet appareil » et accepte la demande du navigateur. Fais-le sur chaque appareil où tu souhaites recevoir les alertes.": "In our conversation, open “Options”, then “Notifications”. Choose “Turn on on this device” and accept your browser’s request. Do this on each device where you want alerts.",
    "Sur iPhone ou iPad, ouvre le menu Partager de Safari, choisis « Sur l’écran d’accueil », puis ouvre Jessie depuis son icône pour activer les notifications.": "On iPhone or iPad, open Safari’s Share menu, choose “Add to Home Screen”, then open Jessie from its icon to turn on notifications.",
    "Les alertes restent discrètes : elles n’affichent ni nom, ni texte, ni photo du message. Le service de notifications de ton navigateur transmet l’alerte à ton appareil.": "Alerts stay discreet: they do not show names, message text or photos. Your browser’s notification service delivers the alert to your device.",
    "Une alerte ou un message n’arrive pas ?": "An alert or message is missing?",
    "Vérifie ta connexion internet, les autorisations de notification du navigateur et le mode silencieux de ton appareil. Reviens ensuite dans « Notifications » pour vérifier tes réglages.": "Check your internet connection, your browser’s notification permissions and your device’s silent mode. Then return to “Notifications” to check your settings.",
    "Une alerte peut être retardée par le navigateur ou l’appareil. Tu peux toujours ouvrir notre conversation pour retrouver les messages. Une connexion internet reste nécessaire.": "Your browser or device may delay an alert. You can always open our conversation to find your messages. An internet connection is still required.",
    "Ton espace, tes données": "Your space, your data",
    "Jessie est responsable de cet espace privé sur invitation. Pour toute question sur tes données : contact@jessiemessage.com.": "Jessie is responsible for this private invitation-only space. For any question about your data: contact@jessiemessage.com.",
    "Quelles informations sont conservées ?": "What information is stored?",
    "Je conserve ton pseudonyme, ton e-mail, les informations de profil que tu renseignes, les informations nécessaires à ton accès et à tes connexions, ta déclaration d’âge, tes messages, tes photos, tes vidéos et les repères de lecture. Le mot de passe est enregistré sous une forme qui permet de le vérifier sans le conserver en clair.": "I store your display name, email, the profile information you provide, information needed for your access and sign-ins, your age declaration, your messages, photos, videos and read positions. Your password is stored in a form that allows it to be checked without keeping it as readable text.",
    "Un cookie de connexion sert à te reconnaître sur cet appareil. Le choix français ou anglais est gardé dans l’onglet. Si tu actives les notifications, un abonnement est associé à cet appareil et à ton compte.": "A sign-in cookie recognises you on this device. Your French or English choice is kept in this tab. If you turn on notifications, a subscription is linked to this device and your account.",
    "Dans la conversation, quand ton navigateur le permet, les brouillons texte restent temporairement dans cet onglet pour retrouver une saisie après rechargement. Ils ne sont pas envoyés automatiquement. Ce brouillon n’inclut pas les fichiers photo ou vidéo.": "In the conversation, when your browser allows it, text drafts are kept temporarily in this tab so you can recover what you typed after reloading. They are not sent automatically. This draft does not include photo or video files.",
    "À quoi servent ces informations et qui peut y accéder ?": "What is this information used for and who can access it?",
    "Ces informations servent à gérer ton accès, échanger avec toi, sécuriser le service, envoyer les notifications choisies et traiter tes demandes. Des notes, classements et rappels privés servent au suivi de nos échanges.": "This information is used to manage your access, talk with you, protect the service, send the notifications you choose and handle your requests. Private notes, labels and reminders help manage our exchanges.",
    "L’e-mail, le pseudonyme, le mot de passe et la déclaration de majorité sont nécessaires pour créer ton accès. Les informations de profil supplémentaires, l’envoi de messages ou de médias et les notifications restent facultatifs.": "Your email, display name, password and age declaration are needed to create your access. Additional profile information, sending messages or media and notifications remain optional.",
    "Tes échanges sont accessibles à toi et aux personnes autorisées à gérer cet espace. L’hébergement est assuré chez Infomaniak. Les e-mails d’accès passent par le prestataire de messagerie ; les notifications choisies passent par le service Push de ton navigateur.": "Your exchanges are accessible to you and to the people authorised to manage this space. Hosting is provided by Infomaniak. Access emails pass through the mail provider; optional notifications pass through your browser’s Push service.",
    "Dans « Mes vidéos », tu peux aussi supprimer un original inutilisé. Une vidéo encore utilisée dans un message ne peut pas être retirée ; pour l’administration, il faut aussi attendre la fin des diffusions en cours. Après confirmation de la suppression, le fichier est retiré du stockage actif, mais des informations techniques et une trace de suppression restent conservées.": "In “My videos”, you can also delete an unused original. A video still used in a message cannot be removed; administrators must also wait until current broadcasts have finished. After deletion is confirmed, the file is removed from active storage, but technical information and a deletion record are retained.",
    "Quels sont mes droits ?": "What are my rights?",
    "Tu peux demander l’accès à tes données, leur rectification, leur effacement ou la limitation de leur utilisation. Selon le traitement concerné, tu peux aussi demander à t’y opposer ou à recevoir tes données dans un format réutilisable. Écris à contact@jessiemessage.com. Ne joins pas spontanément de pièce d’identité et ne communique jamais ton mot de passe ni tes codes de connexion.": "You can request access to your data, correction, erasure or restriction of its use. Depending on the processing involved, you can also object to it or request your data in a reusable format. Write to contact@jessiemessage.com. Do not send an identity document without being asked, and never send your password or sign-in codes.",
    "Tu peux aussi adresser une réclamation à la CNIL, l’autorité française de protection des données.": "You can also lodge a complaint with the CNIL, the French data protection authority.",
    "Adresser une réclamation à la CNIL": "Lodge a complaint with the CNIL",
    "Comment les échanges sont-ils protégés ?": "How are conversations protected?",
    "Tu retrouves la conversation dans ton compte. Le service chiffre les messages, les photos et les vidéos sur le serveur et les déchiffre pour les afficher aux personnes autorisées. Il ne s’agit pas d’un chiffrement de bout en bout.": "You can read the conversation from your account. The service encrypts messages, photos and videos on the server and decrypts them to show them to authorised people. This is not end-to-end encryption.",
    "Les métadonnées d’origine des photos sont retirées. Les vidéos peuvent garder celles de leur fichier d’origine. L’application n’ajoute pas d’outil publicitaire ou de mesure d’audience.": "Original metadata is removed from photos. Videos may retain metadata from their original file. The application does not add advertising or audience-measurement tools.",
    "Une personne qui reçoit un message, une photo ou une vidéo peut en garder une copie. Partage seulement ce que tu souhaites me confier.": "Someone who receives a message, photo or video can keep a copy. Only share what you are comfortable entrusting to me.",
    "Puis-je retirer un message, une photo ou une vidéo ?": "Can I remove a message, photo or video?",
    "Pour toute question sur un message déjà envoyé, écris-moi. Une photo encore présente dans « Mes photos » doit être retirée de cette bibliothèque si tu ne souhaites plus la conserver.": "Write to me about any message you have already sent. If a photo is still in “My photos”, remove it from that library if you no longer want to keep it.",
    "Supprimer un échange ne retire pas les copies déjà gardées par son destinataire ni les sauvegardes du service. Ces copies sont traitées séparément.": "Deleting a conversation item does not remove copies its recipient has already kept or the service’s backups. These copies are handled separately.",
    "Et pour une copie de mes données ou mon compte ?": "What about a copy of my data or my account?",
    "Je conserve notre conversation jusqu’à la fermeture définitive de ton compte, sauf les messages et médias supprimés volontairement. Une déconnexion, une expiration ou une suspension de l’accès ne ferme pas définitivement le compte.": "I keep our conversation until your account is permanently closed, except for messages and media voluntarily deleted. Signing out, access expiry or suspension does not permanently close the account.",
    "Dans notre conversation, ouvre « Options », puis « Autres options » et « Télécharger ma conversation ». Tu peux y inclure les photos et vidéos partagées. Ce téléchargement ne contient pas toutes les données du compte. Pour une autre demande de copie, connaître les données conservées ou demander la suppression de ton compte, écris-moi. La suppression du compte n’est pas disponible directement dans l’application.": "In our conversation, open “Options”, then “More options” and “Download my conversation”. You can include shared photos and videos. This download does not contain all account data. Write to me for another copy request, to ask what data is stored or to request account deletion. Account deletion is not available directly in the application.",
    "Écrire au sujet de mes données": "Ask about my data",
    "Une question ? Écris-moi.": "A question? Write to me.",
    "Pour un souci d’accès, une question sur tes données ou un problème dans cet espace, écris-moi ici :": "For access help, questions about your data or a problem in this space, write to me here:",
    "Ne communique jamais ton mot de passe ni tes codes de connexion.": "Never share your password or sign-in codes.",
    "Quelque chose te met mal à l’aise ?": "Something making you uncomfortable?",
    "Un message, une photo, une vidéo ou un comportement te pose problème ? Explique-moi simplement ce qui s’est passé pour que je puisse examiner ton signalement.": "Is a message, photo, video or someone’s behaviour a problem? Simply explain to me what happened so I can review your report.",
    "Signaler un problème": "Report a problem",
    "JessieMessage · Accès privé sur invitation": "JessieMessage · Private access by invitation",
  });
  if (language !== null) ui.setLanguage(language);
  function renderMetadata() {
    document.title = ui.t("Jessie — Aide et confidentialité");
    document.getElementById("help-description")?.setAttribute("content", ui.t("Des réponses simples pour profiter de notre espace privé."));
  }
  ui.onChange(renderMetadata);
  renderMetadata();
  if (section !== null) document.getElementById(section)?.scrollIntoView();
})();
