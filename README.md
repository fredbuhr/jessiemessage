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
| [Diffusions à grande échelle, 1.4.0 active](docs/broadcast-scale-140.md) | Audiences globales ou filtrées, aperçu confirmé et suivi paginé ; livraison close, avec repli compatible 1.3.4 enregistré. |
| [Compatibilité du schéma des annonces, 1.4.1](docs/announcements-compat-141.md) | Référence publiée et préparée sur l’hébergement ; futur repli compatible schéma 32, précontrôle encore à réaliser. |
| [Annonces, 1.5.0](docs/announcements-150.md) | Bandeau programmé et messages privés facultatifs ; référence publiée et préparée, migration et activation non attestées. |
| [REPRISE](docs/REPRISE.md) | État de production unique et références opérateur. |
| [AGENTS](AGENTS.md) | Règles stables pour travailler et livrer. |
| [Principes KISS et aperçu](docs/DESIGN-KISS.md) | Simplicité de l’interface et du développement. |

**Version active : 1.4.0**, source `56d45950…`, Node 24.22.0, identifiée par le relevé admin utilisateur au démarrage affiché `21/10/2026 15:31:41`. Les diffusions peuvent cibler tous les clients, les résultats d’un filtre ou une sélection manuelle dépassant cent personnes, avec aperçu confirmé, traitement progressif et suivi paginé. Le schéma 31 et les dépendances sont inchangés. **Livraison 1.4.0 close : `release140_metadata_recorded` confirme l’alignement privé**, sans redémarrage, avec la 1.3.4 préparée comme repli compatible. L’ancien état 1.3.3 intégral, son empreinte et les autres blocs sont préservés. Les preuves et les références courantes sont dans [REPRISE](docs/REPRISE.md).

La [PR 116](https://github.com/fredbuhr/jessiemessage/pull/116) est revue, fusionnée et qualifiée par les CI PR et main **5/5**, puis [publiée en v1.3.3](https://github.com/fredbuhr/jessiemessage/releases/tag/v1.3.3). Le reçu utilisateur `staged_precheck_passed` puis le relevé d’identité confirment sa préparation et son activation. Le reçu final confirme l’enregistrement des métadonnées, sans redémarrage et avec l’état précédent intégral préservé. Aucune nouvelle manipulation n’est requise pour cette livraison close. Le retour visuel antérieur valide la présentation mobile 1.3.1 ; il ne vaut pas essai physique de tous les parcours 1.3.3.

Le [correctif mobile 1.3.1](docs/chat-mobile-131.md) est désormais clos : le reçu `release131_metadata_already_recorded` confirme son alignement privé sans réécriture ni redémarrage. Cette référence était le repli immédiat de 1.3.3 ; les replis antérieurs 1.3.0/1.2.0/1.1.1 restent préservés. Le socle [1.3.2](docs/client-voice-message-details-132.md), fusionné, qualifié et publié sur `19455771…`, n’a pas été activé séparément ; sa publication immuable et ses preuves historiques restent conservées.

**Évolution 3 — Diffusions à grande échelle : livraison 1.4.0 close.** Les versions [1.3.4 de compatibilité](docs/broadcast-compat-134.md) et [1.4.0](docs/broadcast-scale-140.md) sont fusionnées, qualifiées par leurs propres CI PR/main **5/5** et publiées sur leurs commits exacts. Les précontrôles hébergés et l’identité active de la **1.4.0** sont confirmés ; le reçu final confirme le checkpoint aligné et le repli **1.3.4** compatible enregistré, sans démarrage de cette dernière. La création élargie reste désactivée dans le runtime normal de 1.3.4. L’ancienne 1.3.3 reste préservée avec son empreinte, marquée non utilisable en repli immédiat pour les campagnes compactes. **Aucune nouvelle opération n’est requise pour ce lot.** Les [évolutions suivantes](docs/PLAN-IMPLEMENTATION.md) restent planifiées.

**Travail courant : Évolution 4 — [Annonces 1.5.0](docs/announcements-150.md), préparation et statut SQL préalable confirmés.** Les deux références [1.4.1](docs/announcements-compat-141.md) et [1.5.0](docs/announcements-150.md) sont préparées ; le diagnostic SQL confirme 32 migrations connues, 31 appliquées et une en attente, sans interruption. La prochaine étape est l’arrêt effectif du service, puis la migration 0032 et les précontrôles compatibles. Le dernier service/checkpoint confirmé reste la 1.4.0, schéma 31 et repli 1.3.4 ; aucune migration ou activation nouvelle n’est encore attestée. [Consignes actuelles](docs/REPRISE.md#arrêt-puis-migration-0032--seule-étape-actuelle).

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

La migration `0031` des profils est appliquée : le service utilise le schéma 31. Son repli est la **1.1.1 préqualifiée sur ce schéma**, conservée sans démarrage rapporté. Ne reprendre ni la 1.1.0 ni la 1.0.0 après cette migration. Le [bilan du lot](docs/profile-expressions-120.md#migration-et-repli) conserve les références et preuves.

## Aperçu sans terminal

Dans un run CI réussi du code choisi, télécharger l’artefact **JessieMessage-apercu-…**, l’extraire et ouvrir **JessieMessage.html**. Les comptes et interactions sont fictifs et disparaissent au rechargement. La bascule client/admin sert à examiner l’interface ; elle ne fournit aucune authentification. Ne pas déployer cet atelier comme application.

L’[identité approuvée](docs/IDENTITE-VALIDEE.md) et [Nuit V2](docs/NUIT-V2.md) décrivent les choix visuels. Les portraits personnels ne font pas partie du dépôt ou des artefacts publics.

## Données et historique

Ne jamais committer messages réels, données client, médias privés, secrets, journaux de production ou dumps SQL. Les tests utilisent des données synthétiques. L’invitation et l’admission manuelle ne constituent pas une preuve indépendante de majorité.

La [clôture V1 0.86](docs/production-086.md), la [qualification Node associée](docs/node-runtime-086.md), l’[historique du 19 octobre](docs/REPRISE-HISTORIQUE-20261019.md), l’[ancien journal d’implémentation](docs/NEXT-STEPS.md) et leurs preuves restent datés. Leurs anciennes prochaines étapes ne remplacent pas REPRISE. Les [anciens bilans du README](https://github.com/fredbuhr/jessiemessage/blob/bbd733d85b49b892d78c7cd90509ced04a990939/README.md) restent dans Git.

## Licence

Aucune licence open source n’a été accordée. La visibilité publique du dépôt n’accorde pas à elle seule un droit de réutilisation du code.
