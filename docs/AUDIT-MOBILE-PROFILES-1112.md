# Revue globale complémentaire — JessieMessage, 25 octobre 2026

Référence de départ : production 1.11.1, source `80b7fbf5f9b5ba32ac1aae817043126e93025946`, arbre `ba1289bae9ce095560922a7ed6665f17709d07ed`, Node 24.22.1 et checkpoint privé `41a51d38a50c3ff07b1878a6cfd96de9e383dbafc5ccff9c96a3a97aa272d90a`, acquis selon le reçu utilisateur. La branche de travail peut ensuite évoluer : ces observations ne qualifient pas automatiquement le futur lot intégré.

## Méthode et portée

La checklist historique de 134 points de l’audit prépublic 1.10.1 et ses six correctifs ont été consultés comme base, sans rejouer des contrôles verts ni effacer leurs limites. Cette passe combine une vérification structurelle des 17 pages HTML, la relecture de parcours transversaux et une contre-revue backend récente. L’inventaire comporte 416 chemins dans `public`, `server` et `scripts` ; **416 ne désigne pas un nombre de fichiers relus intégralement**. Les autres agents traitent les trois demandes UX, puis leurs patches devront être revus et qualifiés sur le SHA final.

Aucun compte réel, message, contenu privé, média client, base hébergée, Manager, PID/socket, navigateur cloud, sauvegarde ou PC n’a été utilisé ou modifié par cette revue. Pas de nouvelle CI ou suite déjà verte rejouée. Les sauvegardes reportées et A10/A11/A12 ne sont pas réouvertes.

## Résultats transversaux acquis

- 17 fichiers HTML analysés ; 262 références internes `a/link/script` correspondent à un chemin littéral des sources serveur. Aucun chemin non résolu dans cette correspondance statique. Il ne s’agit pas de 262 GET réussis et les routes dépendant d’une session/fonction ne sont pas déclarées disponibles pour tous.
- Aucun doublon d’ID, label`for` sans cible, bouton sans type ou lien`target=_blank` dépourvu de `noopener noreferrer` dans ces 17 pages. Les cinq cases initialement signalées par une lecture naïve sont bien enveloppées dans un label : faux positifs écartés. Cela n’établit pas une conformité globale d’accessibilité ni le résultat visuel sur téléphone.
- Les trois versions package/lock concordent à 1.11.1 au début de la passe. Les cinq dépendances directes sont verrouillées et concordantes. Inventaire statique SQL :33 normaux + 3 vidéo + 2 expérience ; pas d’inventaire SQL réel déduit.
- Le catalogue public garde son empreinte exacte qualifiée `5ce26f14f15fb9c3447b07777aa5c8d17a6e823e8099dbb37959fc48f00f93cb` et ses 25 catégories. Les 691 préférences / 934 alias de cette version ne sont donc pas modifiés.
- Le service worker est réservé aux notifications : aucun `fetch` intercepté ou cache de messages/identités/médias. Ne pas ajouter un cache privé pour dissimuler des écrans vides. Les notifications restent génériques et ciblent un identifiant borné ; l’intention est envoyée à une fenêtre déjà ouverte, avec repli sans recharger son brouillon si elle ne répond pas.

Preuve machine : `global-static-structure.json`. Inventaire de chemins : `global-file-inventory.txt`.

## Défauts / points complémentaires

Les trois problèmes rapportés par l’utilisateur sont traités par les propriétaires navigation, profils et avatar. Cette revue indépendante n’a pas établi un autre défaut de confidentialité ou de perte métier à corriger immédiatement dans les surfaces relues.

**P-01, coût de lecture répété de l’inbox :** `server/chat/store.mjs` répète `authorize` par client bien que l’acteur admin, sa session et sa MFA soient déjà verrouillés dans la transaction. La contre-revue relève au moins 8 lectures d’autorisation par client, soit ≥400 pour 50 lignes, avant résumés/décorations. Ce coût existe dans le code ; sa latence réelle sur le mutualisé n’est pas mesurée et il n’est pas établi comme cause des écrans vides. Root a retenu une correction bornée reprenant la preuve admin verrouillée comme `listConversations`, en conservant verrou/preuve client, liaison de conversation et échéance de session fraîche. Fichiers attribués au backend reviewer : `server/chat/store.mjs` et `tests/chat-store.integration.test.mjs`. Correction et résultats à compléter après intégration ; aucune nouvelle promesse de capacité A12.

**Point de contrôle métier :** un bouton Profil ajouté à une ligne de la vue reçue ne doit pas appeler `selectConversation` uniquement pour consulter une fiche, car cela pourrait marquer la conversation lue. Le backend CRM/préférences ne produit pas ce reçu. Le propriétaire des profils et root en ont été avertis ; ce point doit rester couvert dans le parcours corrigé.

**Point de contrôle format public :** le nouveau snapshot public avec photo doit rester une copie explicitement publiée par admin, sans GET vers un avatar privé, et lire les anciens fichiers sans photo. Le format 2 n’autorise pas à promettre un retour complet de toutes les fonctions publiques vers un lecteur 1.11.1. Contre-revue du patch en attente.

## Couverture fraîche par domaine

| Domaine | Ce qui a été revu maintenant | Résultat / limite |
| --- | --- | --- |
| Versions et livraison | Package/lock, Node engine, inventaire migrations, reçu et consignes 1111, hiérarchie REPRISE/plan | Concordants à la référence de départ. Déploiement du nouveau lot non déduit. |
| Accès et invitations | Génération/normalisation du code, inspect/create/register/list/revoke et gardes HTTP sélectionnées | Aucune nouvelle anomalie établie ; détail et portions exactes dans `backend-review.md`. |
| Sécurité/confidentialité | Autorisation chat, chiffrement/DTO préférences, rebinding avatar, gardes de routage et erreurs serveur | Aucune fuite ou élargissement prouvé dans ces surfaces ; pas audit intégral de tous les stores. |
| Messagerie | Inbox SQL/service/curseur et invariants de contexte, séparation lecture/aperçu | P-01 borné retenu ; pas de nouveau défaut fonctionnel établi dans le dernier aperçu par client. |
| Médias | Routes privées/profil-avatar et worker notifications, protections existantes de versions | Pas de nouveau test de codecs, caméra ou lecture physique ; historique natif conservé. |
| Outils de travail | Fonctions request/session/bootstrap/mutation des tâches et annonces, gestion conflit/incertitude et liens utiles | Gardes présentes, état d’erreur et reprise explicite préservés ; pas de nouvelle panne reproduite. Parcours CRM relu par agent spécialisé. |
| Interface/accessibilité | 17 HTML, IDs, labels explicites ou enveloppants, types de boutons, liens externes et références serveur | Pas d’anomalie dans ces contrôles statiques précis ; tests visuels/Chrome du futur lot nécessaires. |
| Installation/notifications | `public/sw.js` intégral, `session-clock.js` intégral, `entry-model.js` intégral | Intentions bornées, cache privé absent, retour même origine, timers bornés ; téléphone/Push fermé non retestés. |
| Exploitation/données | Routes `server/index.mjs` 18-64 et 173-247 ; limites du dernier reçu et repli 185 | Pas de routage arbitraire observé ; prêt public lit son cache sans SQL ; aucune opération de sauvegarde/restauration réelle. |
| Dépendances | Recherche bornée d’avis mainteneurs/GHSA pour les cinq versions directes | Aucun nouvel avis applicable établi ; pas audit exhaustif transitif/native-system. Sources dans `dependency-advisories.json`. |
| Documentation et abandons | REPRISE/plan, audit 134, contraintes AGENTS, rapports récents et fonctions abandonnées | Aucun abandon transformé en manque à réimplémenter. Limites anciennes restent distinctes des résultats acquis. |

## Contrôles restants pour clôturer ce lot

1. Contre-revoir les patches réels navigation/profils/avatar et la réduction de coût SQL, puis adapter la couverture à ce qui a réellement changé.
2. Qualifier le SHA final sur les parcours natifs utiles, sans compter les omissions comme des succès ; vérifier notamment retours/erreurs mobiles, consultation sans marquage lu et mise à jour/retrait du snapshot de photo.
3. Conserver des captures synthétiques mobile/desktop, preuves de source et limites physiques. Une absence de nouveau défaut prouvé n’est pas une garantie absolue d’absence de défaut.
