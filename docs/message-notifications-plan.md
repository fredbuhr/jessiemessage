# Étape 0.31 — notifications privées : plan d’implémentation

**Suite 0.33 livrée en recette :** voir [l’ouverture du message et les sessions clients durables](notification-opening.md). Runtime actuel `f2677249`, profil `messaging-photos-notify`, schéma 30. Les contrôles CI et HTTPS passent ; le clic réel sur appareil reste à accepter après rechargement et réception d’une nouvelle alerte. Le périmètre initial et ses observations ci-dessous sont historiques ; une référence opaque et le rôle complètent maintenant le payload générique, sans identifiant de conversation/message.

## État et périmètre

- Le code du lot est implémenté sur `feat/message-notifications` ; les cinq jobs de la CI #237 sont réussis. Voir le [bilan de validation](message-notifications-release.md).
- La recette est active en 0.31 sur `017cafaf`, profil `messaging-photos-notify`, après coffre v4 copié/déchiffré personnellement, checkpoint SQL/photos hors ligne, deux migrations et précontrôle réussi. Le build/redémarrage Manager à 00:44 puis treize fichiers et vingt réponses HTTPS à 00:46:49 Europe/Paris le 17 octobre sont conformes. Le propriétaire accepte le bon fonctionnement réel des notifications le 17 octobre ; le [relevé par plateforme](notifications-device-acceptance.md) et l’acceptation simultanée du foyer restent à préciser.
- Le lot vise les messages privés texte et photo, y compris lorsque la page est fermée.
- Il réutilise Node, MariaDB et un service worker ; aucune autre infrastructure de file n’est prévue.
- Les envois groupés restent désactivés ; leur activation ne fait pas partie de ce lot.
- L’affichage dépend des permissions, du navigateur, du système et de la disponibilité de l’appareil.

## Schéma et insertion atomique

- `0029_push_subscriptions.sql` crée les abonnements, leur propriétaire et leur préférence par appareil.
- `0030_push_outbox.sql` crée les livraisons durables par couple message/abonnement.
- Le validateur existant exige un seul `CREATE TABLE` par fichier de migration.
- La cible comporte trente migrations et trente tables physiques, registre compris.
- Un abonnement contient notamment son identifiant, compte, rôle, session liée et dates.
- Son endpoint et ses clés navigateur sont chiffrés ; une empreinte permet l’unicité globale de l’endpoint.
- L’outbox conserve état, tentatives, disponibilité, expiration, génération et bail de traitement.
- Les contraintes SQL empêchent deux jobs pour le même couple message/abonnement.
- Dans `server/chat/store.mjs`, insérer les jobs dans `appendMessage()`, après le nouvel événement `message`.
- Cette insertion utilise la transaction du message et ne vise que les appareils du destinataire opposé.
- Un échec d’outbox annule la transaction ; aucun appel réseau n’a lieu pendant cette transaction.
- Le retour idempotent `duplicate: true` précède le hook et ne produit aucun nouveau job.
- Ce point couvre texte, photo et légende ; il évite un second déclenchement dans le service média.
- Le chemin existant des futurs envois groupés passe aussi par ce point, sans activer cette fonction.

## Deux générations et règles de connexion

- La génération des identifiants est la version actuelle des credentials client ou du MFA administrateur.
- La génération d’abonnement change lors d’un rattachement à une nouvelle session ou d’un changement de clés.
- Chaque job garde la génération d’abonnement qu’il visait ; il ne suit jamais une nouvelle association.
- Une reconnexion du même compte peut rattacher son endpoint à sa nouvelle session sans créer un doublon.
- Un autre compte ne peut pas réaffecter cet endpoint par un simple POST.
- L’expiration normale de la session ne coupe pas les notifications : un client inactif doit rester joignable.
- Le worker ne renouvelle aucune session et ne contourne jamais la connexion pour lire un message.
- Les clients gardent leur limite de huit heures et leur délai d’inactivité de trente minutes.
- Les administrateurs gardent leur durée de cent quatre-vingts jours renouvelée à l’usage.
- Une révocation explicite de session, d’appareil ou de compte rend l’abonnement inéligible.
- Le worker contrôle aussi la version actuelle des identifiants, le statut du compte et l’accès à la conversation.
- Un message déjà lu ou supprimé ne doit plus produire un nouvel envoi lors de son traitement.
- Une notification déjà acceptée par un fournisseur avant une révocation ne peut pas être rappelée.

## Expérience et confidentialité

- L’activation résulte d’un choix explicite sur chaque appareil ; aucun prompt au premier affichage public.
- Désactiver les notifications ici ne désactive pas les autres ordinateurs ou téléphones du compte.
- Le plafond est de seize abonnements actifs par compte, avec une marge pour les six à huit appareils attendus.
- Les routes distinguent les rôles, réutilisent leur cookie et contrôlent origine et CSRF sur les mutations.
- Les listes de réglages n’exposent ni endpoint, ni clés navigateur, ni ciphertext.
- Texte proposé : « Jessie — Un nouveau message t’attend. » ; prévoir son équivalent anglais.
- La notification ne contient aucun nom, extrait, photo, identifiant de conversation ou lien média privé.
- Le clic ouvre `/app`, qui applique les règles normales d’accès et choisit le bon espace.
- Le service worker ne met aucun contenu privé en cache et ne récupère pas l’historique en arrière-plan.
- Chaque push reçu affiche une notification visible ; aucun push silencieux ne maintient une session.
- Sur iPhone/iPad, expliquer l’ajout à l’écran d’accueil et préparer le service worker avant le clic.
- Appeler directement `PushManager.subscribe()` dans ce clic ; cet appel demande la permission du navigateur.
- Une réinitialisation d’abonnement appartenant à un autre compte exige une action distincte sur cet appareil.
- Un tag/topic stable et `renotify: false` limitent les alertes répétées après un résultat réseau incertain.
- Un refus de permission reste respecté, avec une explication courte et une action de réglage adaptée.
- Inclure le défaut mineur constaté du CTA administrateur : après un échec temporaire de capabilities,
  l’action doit proposer un nouvel essai et recontrôler les capacités, sans rester bloquée jusqu’au rechargement.

## Worker et transport

- Ajouter des modules notifications dédiés pour configuration, validation, crypto, store, service, HTTP et worker.
- Démarrer le worker après l’écoute HTTP ; arrêter les claims puis drainer avant de fermer le pool.
- Les claims non envoyés sont libérés sans consommer d’essai ; un envoi interrompu garde un délai de reprise.
- Utiliser de petits lots de cinq, un polling borné et un bail récupérable de quatre-vingt-dix secondes.
- Relire l’éligibilité avant transport, puis libérer les verrous SQL avant toute requête externe.
- Borner durée totale, délai DNS, taille de réponse et temps d’arrêt ; prévoir une annulation du transport.
- La bibliothèque Web Push peut générer la requête chiffrée ; le transport HTTPS garde ces bornes explicites.
- Autoriser les fournisseurs pris en charge et refuser identifiants d’URL, IP littérales et ports inattendus.
- Contrôler la résolution DNS et exclure les destinations privées ; ne suivre aucun redirect automatique.
- Ne pas utiliser de proxy implicite ni journaliser endpoint, clés, payload ou réponse brute du fournisseur.
- Reprendre réseau, 429 et 5xx avec attente croissante, Retry-After borné, nombre maximal d’essais et expiration.
- Une réponse 404 ou 410 invalide l’abonnement ; les autres 4xx demandent une qualification de l’échec.
- Un 2xx signifie « accepté par le service push », sans prouver réception, affichage ou lecture.
- Conserver les jobs terminés trente jours ; nettoyage par lots de cent toutes les cinq minutes.
- L’envoi externe ne permet pas l’exactement-une-fois : une réponse perdue peut conduire à un nouvel essai.

## Secrets, sauvegarde et repli

- Avant activation, créer un sixième fichier privé, `runtime-notifications.json`, validé et protégé comme les autres.
- Il contiendra une paire VAPID P-256 et une clé AES indépendante des autres domaines de chiffrement.
- Utiliser `mailto:contact@jessiemessage.com` comme sujet VAPID ; conserver la paire entre redémarrages.
- L’AAD du chiffrement lie identifiant d’abonnement, propriétaire et génération.
- Le nouveau profil `messaging-photos-notify` impose un coffre v4 contenant les six fichiers privés.
- Valider dans ce coffre la correspondance entre clés VAPID publique et privée, sans exposer les secrets.
- Le manifest v3 inclut le profil et cinq domaines AES : MFA, mail, messages, média et notifications.
- Un profil complet avec CRM comporterait six domaines AES ; ne pas confondre fichiers et domaines.
- Étendre les lectures d’environnement et préflights stricts : un simple flag ajouté ne suffit pas.
- Le snapshot découvre les nouvelles tables, mais les PURPOSES crypto fixes doivent inclure les abonnements.
- Vérifier tous leurs ciphertexts et références ; ajouter ces tables aux inventaires de données et suppression.
- Refuser un ancien coffre si le fichier notifications existe : il omettrait un secret nécessaire.
- Refuser un ancien profil SQL si les nouvelles tables contiennent des données : aucune omission silencieuse.
- La restauration de contrôle reste hors ligne, sans worker, afin de ne pas notifier de vrais appareils depuis un clone.
- Préserver le checkpoint cohérent SQL/photos/secrets antérieur aux migrations avant de modifier la recette.
- Le runtime 0.30 épinglé sur `8f38f66f` ne doit pas être annoncé compatible avec le registre à trente migrations.
- Le repli normal conserve un runtime compatible avec ce schéma et désactive les notifications.
- Revenir au vieux code demanderait une restauration cohérente ; ne pas supprimer les tables pour forcer le démarrage.

## Ordre d’implémentation et preuves attendues

1. Créer schéma, crypto et stores : tester contraintes, deux générations, isolation et atomicité/idempotence texte/photo.
2. Ajouter API et cycle d’abonnement : tester CSRF, propriété, plafonds, expiration simple et toutes les révocations.
3. Ajouter transport et worker : tester DNS/SSRF, délais, 404/410, retries, lecture/suppression, concurrence, crash et shutdown.
4. Ajouter service worker et réglages sobres : tester permission refusée, plusieurs appareils, clic et reprise du CTA capabilities.
5. Compléter coffre/backup/préflight, faire la restauration isolée, puis vérifier Chrome/Firefox/Safari et téléphones réels en recette.

## Sources primaires

- [Apple WWDC22 — abonnement directement depuis le clic](https://developer.apple.com/videos/play/wwdc2022/10098/)
- [Bibliothèque Web Push pour Node](https://github.com/web-push-libs/web-push)
- [RFC 8030 — protocole Web Push, durée de vie et expiration](https://www.rfc-editor.org/rfc/rfc8030.html)
- [RFC 8292 — identification VAPID](https://www.rfc-editor.org/rfc/rfc8292.html)
- [W3C — Push API](https://www.w3.org/TR/push-api/)
- [WebKit — Web Push sur iPhone et iPad](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)
- [WebKit — notification visible à chaque push](https://webkit.org/blog/12945/meet-web-push/)
- [Apple — notifications Web Push](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers)
- [Mozilla — comportement de Web Push dans Firefox](https://support.mozilla.org/en-US/kb/push-notifications-firefox)
