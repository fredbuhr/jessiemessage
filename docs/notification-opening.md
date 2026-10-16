# Ouvrir le message depuis une notification — étape 0.33

## État

Correction préparée après le retour du propriétaire le 17 octobre 2026 : réception Push acceptée, mais clic sans arrivée directe au message. Le runtime hébergé reste `017cafaf` tant que la nouvelle révision n’a pas passé Chrome et MariaDB puis été déployée. L’entrée publique corrigée en 0.32 reste indépendante.

Deux causes sont confirmées dans la source : les clients ont encore une session de huit heures avec coupure après trente minutes d’inactivité ; le service worker ouvre seulement `/app`, qui conserve volontairement le choix si les deux rôles sont connectés. Aucune référence ne désigne le message à ouvrir.

## Comportement préparé

- Les connexions clients durent **180 jours glissants**, avec renouvellement du cookie protégé lors de la reprise et sans coupure pour simple inactivité. Une session encore valable peut être prolongée ; une session réellement expirée, révoquée ou invalidée par un changement de mot de passe ne peut pas être ressuscitée. Les appareils restent indépendants. Les vérifications d’invitation, e-mail, approbation et accès restent appliquées.
- Une nouvelle alerte porte uniquement le rôle et la référence opaque de son job, dans le payload Web Push chiffré. Elle ne contient toujours aucun texte personnel, nom, photo ou identifiant de conversation/message. La notification affichée reste générique.
- Le clic ouvre `/messages` ou `/admin/messages` avec cette référence dans le fragment. Le serveur vérifie session actuelle, rôle, destinataire, appartenance et droits avant la lecture du message. Le POST de résolution exige aussi le CSRF courant et partage le budget de lecture borné.
- Si la connexion est valable, le message est chargé, centré et mis en évidence. La bonne conversation administrateur peut être atteinte au-delà de la première page de la boîte. Les séquences utilisent des entiers décimaux exacts ; les anciens messages s’ouvrent par une lecture paginée ciblée, sans parcourir tout l’historique. Les commandes **Messages suivants** et **Messages récents** permettent de poursuivre.
- Si une authentification est réellement requise, la référence survit au renvoi HTTP et à l’écran de connexion ; la réussite mène automatiquement au message. Une référence ne donne jamais un accès sans session autorisée. Une notification supprimée par la rétention mène à une explication dans l’espace connecté.
- Un chat déjà ouvert peut accepter la destination par un échange avec son propre service worker, sans rechargement ni perte de son brouillon. Une ancienne page qui ne sait pas l’accepter reste intacte et une nouvelle fenêtre est ouverte. Les événements récents ne créent pas de trou dans l’historique d’un ancien message affiché.

La référence est retirée de l’URL après ouverture. Aucun cache de messages, stockage local de credentials ou route vers une origine externe n’est ajouté.

## Vérifications

Les tests locaux généraux passent : 1 889 cas, 1 759 réussis et 130 intégrations ignorées sans leurs moteurs. La syntaxe passe. Les régressions ciblées vérifient notamment : session client après inactivité et refus d’une session expirée/révoquée ; CSRF et corps fermé ; référence de notification limitée à son destinataire ; message ciblé, séquence supérieure à la précision Number, conversation hors première page, brouillon conservé, reprise après masquage et notification indisponible.

Les scénarios Chrome ajoutés utilisent les vrais contrôleurs et HTML avec des API synthétiques : deux rôles, chacun avec connexion existante puis reconnexion requise, conservation du fragment lors du 303 et focus du message. Les intégrations MariaDB ajoutées contrôlent l’isolation du destinataire, la reprise après une nouvelle session et le message supprimé. Leur résultat CI doit être consigné sur la révision exacte avant activation.

## Déploiement et acceptation

Le schéma reste à trente migrations. Aucun nouveau secret, abonnement ou changement d’origine n’est nécessaire. Préparer un checkout exact séparé, conserver les six fichiers privés et les mêmes clés, effectuer le précontrôle `photos-notify`, puis changer le lanceur Node vers la révision validée. L’ancien runtime 0.31 reste un repli compatible avec ce schéma. L’export Apache 0.32 est conservé.

Après redémarrage : comparer les fichiers servis, vérifier santé/disponibilité, les méthodes de l’ouverture et le refus des requêtes anonymes ; contrôler l’entrée depuis le domaine principal. Le propriétaire pourra ensuite recharger l’application sur les appareils, se connecter une seule fois si l’ancienne session est déjà perdue, puis tester une **nouvelle** alerte reçue après cette mise à jour. Les anciennes alertes affichées sans référence gardent leur ancien parcours. Les essais synthétiques ne sont pas présentés comme une validation de clic réel sur iPhone/Android.

Références consultées : [comportements de notification, web.dev](https://web.dev/articles/push-notifications-common-notification-patterns), [ouverture d’une fenêtre, MDN](https://developer.mozilla.org/en-US/docs/Web/API/Clients/openWindow), [gestion des sessions, OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html). La durée longue répond au besoin de messagerie ; les expirations serveur, révocations, cookies sécurisés et contrôles d’autorisation restent effectifs.
