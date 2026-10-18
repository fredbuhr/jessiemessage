# Télécharger sa conversation — 0.60

Préparation du 18 octobre 2026. Le lot est isolé de la livraison simultanée des réponses prêtes à l’emploi 0.59. Aucune activation 0.60 n’est revendiquée avant son relevé final.

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

Les références de source, CI, activation et repli seront consignées après validation. Les changements parallèles sont conservés ; 0.60 devra inclure la version 0.59 réellement publiée avant toute activation.
