# JessieMessage

Messagerie privée sur invitation entre Jessie et chaque personne invitée : texte, photos, notifications, sessions indépendantes et outils d’administration. L’application utilise l’hébergement mutualisé existant, sans infrastructure ni budget ajoutés.

**[REPRISE — version réellement déployée, commit, preuves, prochaine action et repli](docs/REPRISE.md)** est l’unique référence de l’état courant. La V1 désigne le périmètre produit déjà livré ; la livraison `1.0.0` en harmonise la numérotation. Un travail préparé dans une branche ne devient disponible qu’après son déploiement vérifié.

| Document | Rôle |
| --- | --- |
| [Périmètre produit](docs/PRODUCT.md) | Fonctions disponibles, conservation et limites. |
| [Guide quotidien](docs/guide-jessie.md) | Utilisation des messages, photos, fiches, notifications et exports. |
| [Plan de travail](docs/PLAN-IMPLEMENTATION.md) | Harmonisation et évolutions restantes. |
| [Profil et expressions, 1.2.0](docs/profile-expressions-120.md) | Périmètre du lot et préconditions de migration/repli. |
| [Emojis enrichis et inclusifs, 1.3.0](docs/emoji-inclusifs-130.md) | Catalogue Unicode, carnations et critères de livraison. |
| [Messagerie mobile, 1.3.1 close et conservée en repli](docs/chat-mobile-131.md) | Barre de conversation unique, menus discrets et espace rendu aux messages ; lot clos et référence conservée. |
| [Voix client et détails des messages, 1.3.2 publiée](docs/client-voice-message-details-132.md) | Socle qualifié et publié, jamais activé ; remplacé comme candidate par 1.3.3. |
| [Détails des photos, correctif 1.3.3 clos](docs/photo-message-details-133.md) | Bouton de détails visible au toucher pour les photos, avec les métadonnées masquées au repos. |
| [Compatibilité des diffusions, 1.3.4 publiée](docs/broadcast-compat-134.md) | Code compatible qualifié et publié ; repli précontrôlé sur l’hébergement, sans démarrage. |
| [Diffusions à grande échelle, 1.4.0 close](docs/broadcast-scale-140.md) | Audiences globales ou filtrées, aperçu confirmé et suivi paginé ; livraison close, avec repli compatible 1.3.4 enregistré. |
| [Compatibilité du schéma des annonces, 1.4.1](docs/announcements-compat-141.md) | Référence publiée et préparée sur l’hébergement ; repli compatible schéma 32, précontrôle hébergé confirmé sans démarrage. |
| [Annonces, 1.5.0 active et close](docs/announcements-150.md) | Bandeau programmé et messages privés facultatifs ; migration, précontrôles, identité HTTP et alignement final des métadonnées confirmés. |
| [Compatibilité des tâches, 1.5.1 publiée](docs/tasks-compat-151.md) | Référence compatible avec le schéma 33, qualifiée, publiée et préparée ; précontrôle hébergé et démarrage non réalisés. |
| [Tâches et rappels, 1.6.0 publiée](docs/tasks-reminders-160.md) | Plusieurs tâches privées par client et vue commune ; code qualifié, publié et préparé, statut SQL à vérifier en lecture seule. |
| [REPRISE](docs/REPRISE.md) | État de production unique et références opérateur. |
| [AGENTS](AGENTS.md) | Règles stables pour travailler et livrer. |
| [Principes KISS et aperçu](docs/DESIGN-KISS.md) | Simplicité de l’interface et du développement. |

**Référence historique 1.4.0 close**, source `56d45950…`, Node 24.22.0, identifiée à sa livraison par le relevé admin utilisateur au démarrage affiché `21/10/2026 15:31:41`. Elle a livré les diffusions vers tous les clients, les résultats d’un filtre ou une sélection manuelle dépassant cent personnes, avec aperçu confirmé, traitement progressif et suivi paginé. Le schéma était alors 31, sans nouvelle dépendance. Le reçu historique `release140_metadata_recorded` confirme son alignement privé, sans redémarrage, avec la 1.3.4 préparée comme repli compatible à cette étape. L’ancien état 1.3.3 intégral, son empreinte et les autres blocs sont préservés. Les références courantes sont dans [REPRISE](docs/REPRISE.md).

La [PR 116](https://github.com/fredbuhr/jessiemessage/pull/116) est revue, fusionnée et qualifiée par les CI PR et main **5/5**, puis [publiée en v1.3.3](https://github.com/fredbuhr/jessiemessage/releases/tag/v1.3.3). Le reçu utilisateur `staged_precheck_passed` puis le relevé d’identité confirment sa préparation et son activation. Le reçu final confirme l’enregistrement des métadonnées, sans redémarrage et avec l’état précédent intégral préservé. Aucune nouvelle manipulation n’est requise pour cette livraison close. Le retour visuel antérieur valide la présentation mobile 1.3.1 ; il ne vaut pas essai physique de tous les parcours 1.3.3.

Le [correctif mobile 1.3.1](docs/chat-mobile-131.md) est désormais clos : le reçu `release131_metadata_already_recorded` confirme son alignement privé sans réécriture ni redémarrage. Cette référence était le repli immédiat de 1.3.3 ; les replis antérieurs 1.3.0/1.2.0/1.1.1 restent préservés. Le socle [1.3.2](docs/client-voice-message-details-132.md), fusionné, qualifié et publié sur `19455771…`, n’a pas été activé séparément ; sa publication immuable et ses preuves historiques restent conservées.

**Évolution 3 — Diffusions à grande échelle : livraison 1.4.0 close.** Les versions [1.3.4 de compatibilité](docs/broadcast-compat-134.md) et [1.4.0](docs/broadcast-scale-140.md) sont fusionnées, qualifiées par leurs propres CI PR/main **5/5** et publiées sur leurs commits exacts. Les précontrôles hébergés et l’identité active de la **1.4.0** sont confirmés ; le reçu final confirme le checkpoint aligné et le repli **1.3.4** compatible enregistré, sans démarrage de cette dernière. La création élargie reste désactivée dans le runtime normal de 1.3.4. L’ancienne 1.3.3 reste préservée avec son empreinte, marquée non utilisable en repli immédiat pour les campagnes compactes. **Aucune nouvelle opération n’est requise pour ce lot.** Les [évolutions suivantes](docs/PLAN-IMPLEMENTATION.md) restent planifiées.

**Version active : [1.5.0 — Annonces, livraison close](docs/announcements-150.md).** Le relevé utilisateur confirme 1.5.0 / `abca467c…` / Node 24.22.0 / `21/10/2026 17:58:07`, après migration au schéma 32 et précontrôles hébergés. Le [reçu final](docs/verification-proofs/jm150-hosted-metadata.json) confirme le checkpoint aligné sur 1.5.0/schéma 32, sans redémarrage, avec la [1.4.1 compatible](docs/announcements-compat-141.md) précontrôlée et enregistrée comme repli, jamais démarrée. L’ancien état 1.4.0 intégral et les autres blocs restent préservés. [Clôture et preuves](docs/REPRISE.md#alignement-final-acquis--livraison-150-close).

**Travail courant : Évolution 5 — [Tâches et rappels 1.6.0](docs/tasks-reminders-160.md), code qualifié et publié.** Les références 1.5.1 de compatibilité et 1.6.0 sont fusionnées, qualifiées par leurs propres CI PR/main et publiées sur leurs commits exacts. Le [reçu de préparation hébergée](docs/verification-proofs/jm160-hosted-staging.json) confirme les deux références préparées ; aucune migration 0033, qualification hébergée du repli, activation ou métadonnée 1.6.0 n’est attestée. **La production reste la 1.5.0, schéma 32, avec son repli 1.4.1.** [Seule prochaine action : lire le statut SQL](docs/REPRISE.md#prochaine-action--statut-sql-en-lecture-seule).

## Versions et livraisons

La version applicative provient de [package.json](package.json), avec la même valeur dans les métadonnées racine de `package-lock.json`. `1.0.0` établit la référence de la V1 existante ; `1.0.1` désigne une correction compatible, `1.1.0` une évolution compatible et `2.0.0` une rupture de compatibilité. Les numéros ne suivent pas le nombre de discussions ou de commits. Node, le schéma SQL et les formats de données ont leurs propres versions.

Chaque livraison suit le même parcours : commit validé → tag immuable `vX.Y.Z` et release GitHub → déploiement de ce commit → contrôles → mise à jour de REPRISE. Une release publiée n’est pas une preuve de déploiement. `main` peut ensuite avancer pour la documentation ou une évolution ; le tag et le commit vérifié identifient toujours la version en production. Ne pas déplacer un tag publié ni renommer rétroactivement une ancienne livraison.

## Exploitation et récupération

Les fermetures définitives sont traitées localement. Une restauration applicative se prépare sur une cible isolée, en maintenance, avec contrôle des fermetures connues et réouverture explicite. Voir le [parcours opérateur](docs/manual-restore-operator-078.md).

Le mécanisme de copies chiffrées vers le PC déjà raccordé est conservé ; son état réel, notamment après le signalement antivirus, est suivi dans REPRISE. Un reçu historique ne prouve pas son fonctionnement actuel, son déchiffrement ou une restauration. Le traitement PC/Avast et l’exécuteur d’archivage restent différés sans conditionner les évolutions de messagerie. La récupération autonome après perte complète de l’hôte, le témoin frais par phase, la succession et l’inventaire SQL exhaustif restent hors du périmètre V1.

## Développement et vérification

Les versions requises et commandes sont définies dans [package.json](package.json). Pour installer les dépendances verrouillées et lancer les contrôles locaux :

```sh
npm ci --ignore-scripts
npm run check
npm test
npm run build
```

Le build produit l’aperçu autonome, pas un déploiement. `npm run test:browser` exerce l’interface ; `npm run test:db` et `npm run test:auth-browser` nécessitent leurs bases jetables, clients natifs et navigateurs configurés. La [CI](.github/workflows/ci.yml) décrit ces environnements synthétiques. Une omission locale reste distincte d’une validation native réussie.

Les identités SQL d’exécution et de migration sont séparées ; aucune migration ne s’exécute au démarrage du serveur. Voir la [configuration de la base](docs/DATABASE.md). Pour le service existant, utiliser la composition et les pins de REPRISE plutôt qu’un démarrage de développement.

Les migrations `0031` des profils et `0032` des annonces sont appliquées : le service utilise le **schéma 32**, avec la **1.4.1 compatible précontrôlée** comme repli courant. Le [bilan des profils](docs/profile-expressions-120.md#migration-et-repli) conserve ses références historiques au schéma 31 ; [REPRISE](docs/REPRISE.md) fournit les références actuelles.

## Aperçu sans terminal

Dans un run CI réussi du code choisi, télécharger l’artefact **JessieMessage-apercu-…**, l’extraire et ouvrir **JessieMessage.html**. Les comptes et interactions sont fictifs et disparaissent au rechargement. La bascule client/admin sert à examiner l’interface ; elle ne fournit aucune authentification. Ne pas déployer cet atelier comme application.

L’[identité approuvée](docs/IDENTITE-VALIDEE.md) et [Nuit V2](docs/NUIT-V2.md) décrivent les choix visuels. Les portraits personnels ne font pas partie du dépôt ou des artefacts publics.

## Données et historique

Ne jamais committer messages réels, données client, médias privés, secrets, journaux de production ou dumps SQL. Les tests utilisent des données synthétiques. L’invitation et l’admission manuelle ne constituent pas une preuve indépendante de majorité.

La [clôture V1 0.86](docs/production-086.md), la [qualification Node associée](docs/node-runtime-086.md), l’[historique du 19 octobre](docs/REPRISE-HISTORIQUE-20261019.md), l’[ancien journal d’implémentation](docs/NEXT-STEPS.md) et leurs preuves restent datés. Leurs anciennes prochaines étapes ne remplacent pas REPRISE. Les [anciens bilans du README](https://github.com/fredbuhr/jessiemessage/blob/bbd733d85b49b892d78c7cd90509ced04a990939/README.md) restent dans Git.

## Licence

Aucune licence open source n’a été accordée. La visibilité publique du dépôt n’accorde pas à elle seule un droit de réutilisation du code.
