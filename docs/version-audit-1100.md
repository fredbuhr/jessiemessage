# Audit du versionnage et de la conservation métier — 23 octobre 2026

**1.10.0 suit bien 1.9.0. Aucune perte de fonction métier détectée dans les sources comparées et les qualifications disponibles.** La préparation et l’activation sur l’hébergement restent suspendues à la demande de l’utilisateur. Cet audit n’a ni redémarré l’application, ni modifié la base, ni changé une release ou un tag.

## Pourquoi 1.10.0 ?

Les versions sont composées de trois entiers : majeur, mineur, correctif. Le mineur passe de9 à10 : `1.9.0 → 1.10.0 → 1.11.0`. Il ne s’agit pas de décimaux ; `1.10.0` est distincte de `1.1.0`. Selon [les règles du dépôt](../AGENTS.md) et [SemVer](https://semver.org/lang/fr/), l’ajout compatible du profil public justifie une version mineure ; une correction seule aurait donné1.9.1. Aucune rupture justifiant2.0.0 n’a été identifiée.

Le runtime lit la version réelle de `package.json`. Les parseurs serveur et navigateur acceptent1.10.0 sans la convertir en1.1 ; un contrôle d’import pur l’a vérifié. Aucun ordre lexical ou `parseFloat` de version applicative n’a été trouvé dans les chemins inspectés. Node, schéma SQL, formats de données et ancienne maquette autonome ont leurs compteurs distincts.

## État réellement acquis

| Élément | Version et statut | Source exacte |
| --- | --- | --- |
| Application et checkpoint privés | **1.9.0**, dernier état confirmé par le reçu utilisateur | `5dda0dd4453d34a0be839d2a1402301dea835381` |
| Dernière publication GitHub | **1.10.0**, qualifiée, publiée, non déployée ; release422111737 | `51b0cf22e3adbad7ed26653e96706ba707aaf839` |
| Repli compatible SQL38 | **1.8.5**, précontrôlé, jamais démarré ; release421892280 | `7a40de9742bdbedc5c0829d820882ca08bf23a91` |
| Node | **24.22.1**, inchangé pour ces références | CI et reçu190 distincts |
| Schéma SQL | **38**, identique entre1.9.0 et1.10.0 | 33 migrations de base +3 vidéo +2 expérience |

L’arbre publié1100 est `190024a2f30258554e4a18ff6ae18e2be08c8d7b`. Le checkpoint190 confirmé est `01692bfda8ef4a0cab2d102a183c0ab88fe9e8d99858d6e9b583f8b85ffde674`. [Reçu190](verification-proofs/jm190-hosted-metadata.json), [publication1100](verification-proofs/jm1100/publication-native.json), [état de référence](REPRISE.md).

Le plan SQL immuable définit36 tables applicatives et le registre des migrations, soit37 tables physiques. Le champ historique reçu `applicationTables:37` est conservé tel quel ; cet audit ne constitue pas un nouvel inventaire physique de l’hôte. Aucune migration n’est ajoutée ou réécrite. Les anciens exécutables SQL36, dont1.8.4/1.7.2, restent incompatibles avec la base SQL38 courante.

## Vérification du versionnage publié

**25 releases et25 tags distants contrôlés**, de1.0.0 à1.10.0. Pour chaque référence, le tag pointe vers la source de sa release, et `package.json.version`, `package-lock.json.version`, `package-lock.json.packages[""].version` concordent avec le tag. Aucun draft ou prerelease parmi ces25 références. Toutes déclarent Node `>=24 <25`. [Relevé détaillé des25 versions](verification-proofs/jm1100/version-audit.json).

Les tags locaux s’arrêtaient à1.8.1 : ce cache était ancien, alors que les six tags suivants existent bien à distance. Le contrôle des références actuelles ne prouve pas à lui seul qu’aucun tag n’a jamais été déplacé dans le passé ; aucun tag n’a été déplacé pendant cet audit. Les publications et reçus historiques sont conservés. Un commit documentaire sur `main` après une publication ne change pas la source immuable de l’application publiée.

## Conservation des fonctions

Comparaison de la source190 exacte avec l’arbre publié1100 : **348 fichiers hérités sous `public/` et `server/`, dont339 identiques octet pour octet,9 modifiés et aucun supprimé ;10 fichiers nouveaux**. Les modifications concernent la publication du profil, la suspension/reprise du brouillon et les libellés traduits qui conservent leurs champs. Les routes et capacités héritées sont conservées. [Matrice détaillée des24 métiers](verification-proofs/jm1100/function-preservation-matrix.md), [inventaire et preuves](verification-proofs/jm1100/function-preservation.json).

| Fonction métier | Résultat de la comparaison |
| --- | --- |
| Invitations, admission, MFA, sessions et récupération | Services et gardes conservés ; aucun droit public ajouté aux routes privées |
| Messagerie, historique, brouillons et lecture privée | Routes et données conservées ; aucun envoi automatique ajouté |
| Photos, vidéos et galeries | Stockages, droits vidéo admin et parcours hérités conservés |
| Fiches clients, notes, tags, groupes et recherche clients | Services et stockages conservés |
| Diffusions individuelles et annonces | Contrats et handlers hérités conservés |
| Tâches, rappels privés et suivi « À répondre » | Services, schéma et suivi1.9.0 conservés |
| Réponses rapides et catalogue personnel partagé | Code et drapeaux d’écriture conservés |
| Profil privé, mot de passe et préférences | Accès privés conservés ; ajout de la reprise en mémoire après absence temporaire |
| Catalogue des préférences |691 préférences,25 catégories,934 alias ; même empreinte SHA256 |
| Notifications, PWA et worker de service | Code et restrictions de cache hérités conservés |
| Sauvegardes, restauration et archives |62 fichiers de `server/backup` identiques ; aucun ancien élément retiré du manifeste |
| Fermeture définitive et protections des données |15 fichiers de `server/data` identiques ; gardes et états conservés |

Les dépendances et leur verrouillage sont identiques après exclusion des seuls champs de version racine. Toutes les migrations et le catalogue restent identiques. Empreinte du catalogue : `5ce26f14f15fb9c3447b07777aa5c8d17a6e823e8099dbb37959fc48f00f93cb`.

Le nouveau profil public reste masqué par défaut, limité à une copie explicitement publiée par l’administratrice et séparé des préférences privées. **Cette nouvelle copie publique reste hors du manifeste de sauvegarde historique et peut être republiée** ; aucune ancienne donnée sauvegardée n’est retirée. Le brouillon de profil reste en mémoire pendant un changement temporaire de fenêtre et revient après validation du même propriétaire ; fermeture explicite, rechargement et changement de session l’effacent. [Périmètre et limites1100](public-profile-1100.md).

## Qualifications disponibles et portée

Les CI PR39990302080 et main39991790308 ont chacune réussi5/5 sous Node24.22.1. Les cinq journaux main complets, leurs empreintes et totaux ont été revérifiés pour cet audit ; aucune suite identique déjà verte n’a été relancée.

| Suite main1100 | Résultat |
| --- | --- |
| Tests généraux |4026 réussis,52 omissions explicites,4078 au total |
| Chrome |256/256 |
| HTTPS avec base native |12/12 |
| MariaDB10.11 |598/598 |
| MariaDB11.4 |598/598 |

Les52 omissions générales ne sont pas comptées comme des succès. [Preuve main](verification-proofs/jm1100/main-native.json), [revue visuelle des12 rendus synthétiques](verification-proofs/jm1100/main-visual.json). Les premiers défauts de fixtures, corrigés avant cette qualification, restent [consignés](verification-proofs/jm1100/initial-failures.json).

La comparaison source et ces tests ne garantissent pas l’absence absolue de régression, ni tous les cas sur téléphone physique ou tous les parcours de production. Aucun nouveau test sur compte réel, sauvegarde hébergée ou PC n’a été ouvert. L’état installé repose sur le reçu utilisateur190 ; l’hôte n’a pas été inspecté directement pendant cet audit.

## Corrections documentaires et reprise

Des mentions anciennes présentaient encore1.8.1,1.8.2,1.8.3 ou1.8.4/SQL36 comme actives ; le tableau de REPRISE indiquait encore un checkpoint184 et un writer190 en attente, alors que le reçu final190 était acquis. Ces présents périmés ont été corrigés dans README, REPRISE, PRODUCT, PLAN, ARCHITECTURE, DATABASE, MONITORING et le guide quotidien. Les affirmations de latest190 sont maintenant situées lors de leur livraison. Les reçus et résultats historiques restent intacts. La procédure1100 et son état structuré indiquent désormais la pause.

**Audit terminé ; aucune perte métier détectée dans le périmètre vérifié.** Présenter ces résultats à l’utilisateur et attendre sa décision avant toute préparation ou activation1100. Aucun nouveau numéro, déplacement de tag, redémarrage ou changement de base n’est nécessaire pour corriger ces documents.
