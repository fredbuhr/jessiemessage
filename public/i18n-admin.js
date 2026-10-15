"use strict";
(() => {
  const dictionary = {
    "JessieMessage — Accès administrateur": "JessieMessage — Administrator access",
    "ESPACE PRIVÉ": "PRIVATE SPACE",
    "ADMINISTRATION": "ADMINISTRATION",
    "Bienvenue, Jessie.": "Welcome, Jessie.",
    "Connecte-toi avec ton mot de passe et ton code de sécurité.": "Sign in with your password and security code.",
    "Vérification de la connexion…": "Checking your connection…",
    "Adresse e-mail": "Email address",
    "Mot de passe": "Password",
    "Code de sécurité": "Security code",
    "Les 6 chiffres de ton application d’authentification, ou un code de récupération.": "The 6 digits from your authenticator app, or a recovery code.",
    "Saisis l’adresse e-mail de ton compte administrateur.": "Enter your administrator account email address.",
    "Saisis ton mot de passe administrateur.": "Enter your administrator password.",
    "Saisis ton code d’authentification ou un code de récupération.": "Enter your authenticator code or a recovery code.",
    "Se connecter": "Sign in",
    "Session administrateur": "Administrator session",
    "Connexion sécurisée": "Secure connection",
    "Tu es connectée en tant que": "You are signed in as",
    "L’accès administrateur est prêt. La messagerie sera disponible lors d’une prochaine étape.": "Administrator access is ready. Messaging will be available in a later stage.",
    "L’accès administrateur est prêt. La messagerie sera disponible dès son activation.": "Administrator access is ready. Messaging will be available once enabled.",
    "Tes conversations privées sont accessibles.": "Your private conversations are available.",
    "Ton accès est prêt.": "Your access is ready.",
    "Ouvrir les conversations": "Open conversations",
    "Préparer le site": "Prepare the site",
    "Inviter un client": "Invite a client",
    "Validité du lien (heures)": "Link validity (hours)",
    "Durée d’accès (jours)": "Access duration (days)",
    "Entre une durée de 1 à 720 heures.": "Enter a duration from 1 to 720 hours.",
    "Entre une durée de 1 à 3 650 jours.": "Enter a duration from 1 to 3,650 days.",
    "Accès sans limite de durée": "Access without an end date",
    "Créer une invitation": "Create an invitation",
    "Lien à transmettre au client": "Link to share with the client",
    "Ce lien n’est affiché qu’à sa création.": "This link is shown only when it is created.",
    "Copier le lien": "Copy link",
    "Invitations": "Invitations",
    "Comptes clients": "Client accounts",
    "Revenir au début": "Back to the beginning",
    "Plus anciens": "Older entries",
    "L’approbation nécessite un e-mail et une majorité vérifiés. La procédure de vérification de majorité reste à activer.": "Approval requires verified email and age assurance. The age-assurance process still needs to be enabled.",
    "Actualiser les accès": "Refresh access",
    "Se déconnecter": "Sign out",
    "Déconnecter toutes mes sessions": "Sign out all my sessions",
    "Active JavaScript pour utiliser la connexion sécurisée.": "Enable JavaScript to use secure sign-in.",
    "JessieMessage · Accès privé sur invitation ·": "JessieMessage · Private access by invitation ·",
    "Contact": "Contact",
    "Ta session a expiré. Reconnecte-toi pour continuer.": "Your session has expired. Sign in again to continue.",
    "Le résultat de l’opération n’a pas pu être confirmé. Vérifie les accès actualisés avant de réessayer.": "The operation could not be confirmed. Check the refreshed access details before trying again.",
    "Ta session a changé. Les accès sont vérifiés à nouveau.": "Your session has changed. Access is being checked again.",
    "Les identifiants ou le code de sécurité sont incorrects.": "The credentials or security code are incorrect.",
    "Trop de tentatives. Patiente un moment avant de réessayer.": "Too many attempts. Wait a little before trying again.",
    "La demande a été refusée. Recharge la page puis réessaie.": "The request was refused. Reload the page and try again.",
    "Vérifie l’adresse e-mail, le mot de passe et le code de sécurité.": "Check the email address, password and security code.",
    "La vérification de l’e-mail et de la majorité est nécessaire avant l’approbation.": "Verified email and age assurance are required before approval.",
    "La connexion est indisponible pour le moment. Réessaie dans quelques instants.": "The connection is currently unavailable. Try again shortly.",
    "Connexion en cours…": "Signing in…",
    "Toutes tes sessions sont déconnectées.": "All your sessions have been signed out.",
    "Tu es déconnectée.": "You are signed out.",
    "Aucune invitation sur cette page.": "No invitations on this page.",
    "Créée le {created} · valable jusqu’au {expires}": "Created {created} · valid until {expires}",
    "Accès sans limite de durée après validation.": "Access without an end date after approval.",
    "Accès de {days} jours après validation.": "Access for {days} days after approval.",
    "Révoquer le lien": "Revoke link",
    "L’invitation est révoquée.": "The invitation has been revoked.",
    "Aucun compte client sur cette page.": "No client accounts on this page.",
    "Aucune date de fin d’accès.": "No access end date.",
    "Fin d’accès : {date}": "Access ends: {date}",
    "Approuver l’accès": "Approve access",
    "L’accès client est approuvé.": "Client access has been approved.",
    "Durée à ajouter (jours)": "Duration to add (days)",
    "Durée à ajouter pour {name}, en jours": "Duration to add for {name}, in days",
    "Renouveler l’accès expiré": "Renew expired access",
    "Prolonger l’accès": "Extend access",
    "Choisis une durée de 1 à 3 650 jours.": "Choose a duration from 1 to 3,650 days.",
    "Révoquer l’accès": "Revoke access",
    "L’accès client est révoqué.": "Client access has been revoked.",
    "L’accès a été modifié entre-temps. Vérifie sa nouvelle date de fin avant de réessayer.": "Access changed in the meantime. Check its new end date before trying again.",
    "Cette durée ne peut pas être appliquée. Choisis une durée plus courte et vérifie la date de fin d’accès.": "This duration cannot be applied. Choose a shorter duration and check the access end date.",
    "La durée d’accès du client est prolongée. Vérifie la nouvelle date affichée.": "Client access has been extended. Check the new date shown.",
    "L’invitation est créée. Tu peux transmettre le lien au client.": "The invitation has been created. You can share the link with the client.",
    "Le lien est copié.": "The link has been copied.",
    "Sélectionne puis copie le lien affiché.": "Select and copy the displayed link.",
    "Les accès sont actualisés.": "Access details have been refreshed.",
  };
  for (const source of [
    "Le résultat de l’opération n’a pas pu être confirmé. Vérifie les accès actualisés avant de réessayer.",
    "Ta session a changé. Les accès sont vérifiés à nouveau.",
  ]) dictionary[`${source} Recharge la page pour vérifier les accès.`] = `${dictionary[source]} Reload the page to check access.`;
  for (const [source, translated] of [["Disponible", "Available"], ["Utilisée", "Used"], ["Expirée", "Expired"], ["Révoquée", "Revoked"]]) {
    dictionary[`Invitation · ${source}`] = `Invitation · ${translated}`;
  }
  for (const [state, translated] of [["En attente", "Pending"], ["Actif", "Active"], ["Suspendu", "Suspended"], ["Révoqué", "Revoked"], ["Supprimé", "Deleted"], ["Accès expiré", "Access expired"]]) {
    for (const verifiedEmail of [false, true]) for (const assuredAge of [false, true]) {
      dictionary[`État : ${state} · E-mail : ${verifiedEmail ? "vérifié" : "en attente"} · Majorité : ${assuredAge ? "vérifiée" : "en attente"}`]
        = `Status: ${translated} · Email: ${verifiedEmail ? "verified" : "pending"} · Age assurance: ${assuredAge ? "verified" : "pending"}`;
    }
  }
  for (const [source, translated] of [["Comptes clients les plus récents", "Most recent client accounts"], ["Comptes clients plus anciens", "Older client accounts"],
    ["Invitations les plus récentes", "Most recent invitations"], ["Invitations plus anciennes", "Older invitations"]]) {
    dictionary[`${source} · {count} sur cette page.`] = `${translated} · {count} on this page.`;
    dictionary[`${source} · {count} sur cette page · fin de la liste.`] = `${translated} · {count} on this page · end of the list.`;
  }
  globalThis.JessieI18n?.register(dictionary);
})();
