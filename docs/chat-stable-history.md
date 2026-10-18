# Historique du chat stable — correctif 0.16.1

Le polling appelait le rendu complet de l’historique toutes les trois secondes, même lorsque l’API ne renvoyait aucun événement. Tous les messages, contrôles et miniatures étaient remplacés. L’audit de reprise l’a reproduit dans le contrôleur réel avec un DOM synthétique (constat A15).

## Comportement corrigé

- Les messages dont le contenu affiché est inchangé gardent leurs nœuds DOM et leurs boutons. Une vérification vide, un reçu de lecture ou l’ajout d’un autre message ne remplace plus le contrôle utilisé au clavier.
- « Envoyé » / « Lu » est mis à jour sur place, sans recharger la photo. Un bouton de suppression déjà occupé garde son état pendant la requête.
- Les nouveaux messages sont insérés dans l’ordre ; les messages plus anciens sont ajoutés au début sans déplacer les messages existants. Un contenu modifié ou supprimé remplace uniquement sa ligne.
- Les miniatures déjà présentes ne sont pas rechargées à chaque polling. Un échec réseau ou de décodage reste réessayé lors du prochain cycle réussi, au rythme du polling existant.

Les reçus, la pagination, le défilement, les requêtes de preuve de session et les contrôles métier existants restent actifs. Le correctif ne réduit pas la fréquence du polling et ne change aucun endpoint.

## Vie privée et cycle des images

La table de rendu reste en mémoire et est vidée par `clearChat()`, notamment lors d’un changement de conversation, d’identité ou de session. Aucun contenu n’est ajouté au stockage persistant du navigateur.

Le masquage continue de révoquer les URL privées et d’annuler les requêtes. Au retour dans la même session, l’interface reste masquée jusqu’à la preuve courante ; les photos sont rechargées avec une nouvelle version de médias. Le marqueur « photo chargée » est effacé avant cette recharge : une photo sans légende ne devient lisible pour le reçu de lecture qu’après son nouvel événement de chargement.

Les callbacks d’une miniature vérifient la ligne courante, la tentative courante et la version des médias, en plus du message et de la conversation. Une ancienne réponse ou un ancien événement d’image ne peut pas rétablir une photo supprimée, marquer une nouvelle tentative comme chargée ou invalider son URL autorisée.

## Vérification

Les régressions du vrai contrôleur se trouvent dans `tests/chat-lifecycle.test.mjs`. Le DOM synthétique représente le déplacement/détachement des nœuds, la connexion de leurs descendants et le focus courant. Les scénarios couvrent :

1. Polling vide avec conservation du message et du bouton de suppression focalisé.
2. Reçu de lecture modifié avec conservation de la photo, de son image et du focus.
3. Nouveau message puis suppression d’une photo, sans remplacement d’une autre ligne et avec révocation de l’URL.
4. Chargement d’anciens messages avec ordre et focus conservés.
5. Masquage/retour dans la même session, URL révoquée, nouvelle photo et lecture différée ; ancien événement de chargement ignoré.
6. Nouvelle tentative après panne réseau ou échec de décodage.
7. Réponse photo tardive après suppression du message.

Les régressions déjà présentes continuent de vérifier les changements de compte/session, réponses tardives, envois incertains, révocation des photos et périodes masquées. Les preuves automatisées utilisent uniquement des données synthétiques. Les contrôles du projet sont `npm test`, `npm run build` et `git diff --check` ; la CI exécute aussi les suites SQL sur MariaDB 10.11 et 11.4. Consulter la CI du SHA exact de la branche avant intégration.

Validation locale sous Node.js 24.19.0 : **998 tests généraux réussis, 0 échec, 19 groupes SQL ignorés faute de base locale** ; build, syntaxe et contrôle du diff réussis. Le fichier de cycle de vie compte 22 tests, dont 7 nouveaux. Exécuté avec l’ancien contrôleur du commit parent, il donne 16 réussites et 6 échecs : les nouvelles régressions détectent bien le défaut. Le scénario de réponse après suppression était déjà protégé et reste vert.

Cette validation de contrôleur ne remplace pas la recette clavier, lecteur d’écran, navigateur ou appareils réels. L’annonce accessible des nouveaux messages (A16), les interfaces privées FR/EN et l’entrée PWA restent des travaux distincts.

## Suite

Le correctif traite A15 ; les autres constats de l’[audit de reprise](AUDIT-REPRISE-2026-10-15.md) restent ouverts selon leurs critères. La prochaine étape est **0.17a — supervision et préparation au service** : erreurs des workers visibles sans données privées, retard des files et signal d’aptitude au service distinct de la santé HTTP.

Aucune migration ni dépendance n’est ajoutée. Les clés, icônes et visuels approuvés ne changent pas. Adresse conservée : **contact@jessiemessage.com**. Ce lot ne constitue ni une fusion de la pile ni une publication chez Infomaniak.
