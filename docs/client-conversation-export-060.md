# Télécharger sa conversation — 0.60

**Activée le 18 octobre 2026 à 22:00 Europe/Paris**, source `dd50d098`, arbre `714aa825`, [PR #76 fusionnée](https://github.com/fredbuhr/jessiemessage/pull/76). Inclut les réponses rapides 0.59 `6fab86ff`. Le [dossier de reprise](REPRISE.md) et les [preuves structurées](activation-proofs/jm060-activation.json) conservent les commandes et le repli exacts.

## Usage

Dans la messagerie du client, **Télécharger ma conversation → Télécharger le ZIP**. Les photos partagées sont facultatives. Extraire le ZIP et ouvrir `Conversation.html` pour lire les échanges hors ligne. `conversation.json` conserve le même contenu dans un format portable. Le brouillon du message reste dans la zone de rédaction et aucun message n’est envoyé par le téléchargement.

Seule la conversation du compte invité actif est accessible. Les notes et noms internes, tags, groupes, e-mails du compte, clés, données de diffusion et photos non envoyées sont exclus. L’écran client et le fichier ne dévoilent ni le classement interne ni une audience d’envoi. L’aide publique indique désormais le bouton de téléchargement ; les demandes plus larges et l’effacement du compte passent encore par le contact existant.

## Autorisations et ressources

`POST /api/chat/client/conversations/:id/export`, corps fermé `{ includePhotos: boolean }`. Origine exacte, cookie client et CSRF exigés. Le rôle est fixé côté serveur ; ni l’URL, ni le corps, ni les paramètres de recherche ne peuvent choisir un autre compte. Le service prouve l’invitation consommée, l’e-mail vérifié, l’approbation et l’accès actuel. La conversation est comparée à celle du compte avant préparation, puis relue après ; compte et CSRF sont aussi revérifiés avant les en-têtes. Un 401 tardif n’efface pas un nouveau cookie.

Les lecteurs ordinaires de messages et de photos attachées conservent leur contrôle SQL actuel. La lecture agrégée d’une photo garde un rôle client fixé et le message exact, sans épuiser le quota d’affichage des images. Aucun reçu de lecture n’est modifié par l’export. La factory d’archive accepte une perspective serveur fixée ; les auteurs du format v1 restent normalisés comme en 0.58 (`me` = Jess, `peer` = client), sans inversion des messages quand le client télécharge.

Les limites 0.58 restent 10 000 messages, huit mébioctets de texte, 32 mébioctets d’archive, soixante secondes de préparation et trente secondes entre préparations. Un export et son transfert par rôle à la fois ; les deux origines partagent le même créneau. Un transfert lent garde ce créneau jusqu’à sa fin ou son annulation, avec un délai de 65 s. Les créneaux client et administrateur sont distincts. Les buffers sont effacés après fin, fermeture ou échec ; aucun fichier clair temporaire sur le serveur.

Transport commun avec l’export administrateur 0.58, y compris arrêt gracieux et annulation. Les ressources `/client-archive.js` et `/conversation-download.js` exigent elles aussi un client actuellement admis ; elles sont indisponibles lorsque la fonction est absente. Le navigateur réutilise la preuve de compte avant/après réponse et le lecteur ZIP borné. Fermeture, masquage, changement de conversation ou de connexion annulent sans répétition automatique et révoquent les URL temporaires.

## Vérification et suite

Tests HTTP de rôle, admission, origine, CSRF, périmètre, formes fermées, erreurs, révocation et arrêt ; ZIP lu indépendamment par Python, auteurs normalisés et contenu privé exclu. Tests des transferts lents partagés entre origines et des photos avec rôle client fixé. Intégrations SQL sur vrais messages/photos chiffrés et reçus de lecture inchangés. Chrome utilise les modules réels, au clavier en FR/EN, mobile/bureau, et couvre brouillon conservé, limite avec reprise explicite sans photos, nouvelle connexion, fermeture et masquage.

L’archive est lisible en clair hors du service. Elle ne constitue ni la sauvegarde technique ni un dossier complet d’exercice des droits. La conversation peut évoluer pendant sa préparation ; pas de snapshot SQL global. Déchiffrement personnel de la sauvegarde courante, conservation, confidentialité, responsable du traitement et effacement complet restent ouverts. Aucun schéma, clé, compte, politique de purge ou outil Windows n’est modifié.

CI [source](https://github.com/fredbuhr/jessiemessage/actions/runs/39160023380), [PR](https://github.com/fredbuhr/jessiemessage/actions/runs/39160027765) et [main](https://github.com/fredbuhr/jessiemessage/actions/runs/39160962667) : cinq jobs réussis chacune. Source exacte : 2 545 réussites et 27 wrappers SQL ignorés sur 2 572 cas ; 387/387 sur chaque MariaDB ; 133/133 Chrome sans saut ; authentification HTTPS/MFA, syntaxe de 460 fichiers et build conformes. 220 tests ciblés locaux passent après réunion des deux lots. Une assertion SQL initiale cherchait le texte brut dans les octets échappés du ZIP ; le test décode maintenant réellement le fichier par Python et compare textes et auteurs.

Sur l’hébergement, 250/250 contrôles natifs sans saut, préflight à 19:52:21.297144 UTC, sans démarrage ni capture. Cycle Manager lancé à 20:00:27.168 UTC, sans réinstallation ; Run/Build relus après enregistrement. Actif et modification 22:00 Europe/Paris. Mesures après le dernier démarrage à 20:00:50.200 et 20:01:50.233 UTC : current / OK, intervalle 60 033 ms, aucun incident ni alerte en attente. [Preuve visuelle](activation-proofs/jm060-activation-20261018.jpg).

À 20:07:11.906506 UTC, 114/114 contrôles HTTPS, 32 empreintes exactes, TLS vérifié et redirections non suivies. Une erreur de syntaxe du script de relevé est corrigée avant exécution ; les 114 sondes passent ensuite toutes. À 20:08:42.834 UTC, source propre/version 0.60.0, quatre enregistrements et même dernier succès de capture ; aucun incident ni alerte en attente. Copie PC courante confirmée par un reçu à 20:05:52.663 UTC, après activation. Déchiffrement personnel toujours distinct et non constaté ; aucun téléchargement personnel réel revendiqué.

Les modifications simultanées ont été préservées, puis 0.59 réunie à 0.60 avant les tests définitifs et la publication. Main conserve le [relevé historique 0.59](quick-replies-059.md) et ses preuves. Le repli immédiat est 0.59 `6fab86ff`, arbre `29ee7d3b884e41c778308b1f07e47f90201426d9`. Anciens Run/Build en 0600 : `/srv/customer/jessiemessage-private/manager-before-client-conversation-export-060.json`. Aucun repli, restauration SQL, capture hors ligne, rotation de clé ou mail de test provoqué.
