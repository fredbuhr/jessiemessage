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
| [Messagerie mobile, 1.3.1 publiée](docs/chat-mobile-131.md) | Barre de conversation unique, menus discrets et espace rendu aux messages ; activation en attente. |
| [REPRISE](docs/REPRISE.md) | État de production unique et références opérateur. |
| [AGENTS](AGENTS.md) | Règles stables pour travailler et livrer. |
| [Principes KISS et aperçu](docs/DESIGN-KISS.md) | Simplicité de l’interface et du développement. |

**Version active : 1.3.0**, profil, avatar, 268 choix Unicode et cinq carnations. Le relevé admin utilisateur identifie le commit livré et Node 24.22.0 ; quatre contrôles publics de disponibilité sont conformes. Le reçu SSH `release130_metadata_recorded` confirme l’alignement du checkpoint, sans redémarrage, avec repli 1.2.0 et autres blocs préservés : **lot 1.3.0 clos**. Les preuves et le repli sont consignés dans REPRISE.

La [PR 113](https://github.com/fredbuhr/jessiemessage/pull/113) est fusionnée, la [CI du commit livré](https://github.com/fredbuhr/jessiemessage/actions/runs/39515366616) réussie 5/5 et le [tag/release v1.3.0](https://github.com/fredbuhr/jessiemessage/releases/tag/v1.3.0) immuable. Préparation, précontrôle et activation sont acquis : ne pas les rejouer. Le [correctif mobile 1.3.1](docs/chat-mobile-131.md) est fusionné par la [PR 114](https://github.com/fredbuhr/jessiemessage/pull/114), qualifié par les CI de PR et du commit de fusion 5/5, puis [publié sur le commit exact](https://github.com/fredbuhr/jessiemessage/releases/tag/v1.3.1). Sa préparation et son activation hébergées restent en attente ; la production demeure en 1.3.0. Aucune nouvelle action opérateur n’est attendue pour la 1.3.0.

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
