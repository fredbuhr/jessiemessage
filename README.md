# JessieMessage

Messagerie privée sur invitation entre Jessie et chaque personne invitée : texte, photos, notifications, sessions indépendantes et outils d’administration. L’application utilise l’hébergement mutualisé existant, sans infrastructure ni budget ajoutés.

**[REPRISE — état courant, version déployée, preuves, prochaine action et repli](docs/REPRISE.md)** est le point d’entrée unique pour poursuivre le projet. Les documents datés décrivent leur propre étape ; ils ne remplacent pas cet état.

- [Périmètre produit](docs/PRODUCT.md) : fonctions livrées, conservation et limites de récupération.
- [Guide quotidien](docs/guide-jessie.md) : messages, photos, fiches, notifications, exports et copies PC.
- [Plan de travail](docs/PLAN-IMPLEMENTATION.md) : lots et critères de fin.
- [Principes KISS et aperçu](docs/DESIGN-KISS.md) : simplicité de l’interface et du développement.

## Exploitation et récupération

Les copies chiffrées continuent vers le PC déjà raccordé lorsqu’il est disponible. Le reçu d’une copie ne certifie ni son déchiffrement ni une restauration. Les fermetures définitives sont traitées localement ; une restauration applicative se prépare sur une cible isolée, en maintenance, avec contrôle des fermetures connues et réouverture explicite. Voir le [parcours opérateur](docs/manual-restore-operator-078.md).

La récupération autonome après perte complète de l’hôte, le témoin frais par phase, la succession et l’inventaire SQL exhaustif restent hors du périmètre V1. Les points ouverts A01 (Node fourni par l’hébergeur), A07 (installation personnelle du kit PC) et A08 (exécuteur d’archivage) restent distincts et sont suivis dans [REPRISE](docs/REPRISE.md).

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

## Aperçu sans terminal

Dans un run CI réussi du code choisi, télécharger l’artefact **JessieMessage-apercu-…**, l’extraire et ouvrir **JessieMessage.html**. Les comptes et interactions sont fictifs et disparaissent au rechargement. La bascule client/admin sert à examiner l’interface ; elle ne fournit aucune authentification. Ne pas déployer cet atelier comme application.

L’[identité approuvée](docs/IDENTITE-VALIDEE.md) et [Nuit V2](docs/NUIT-V2.md) décrivent les choix visuels. Les portraits personnels ne font pas partie du dépôt ou des artefacts publics.

## Données et historique

Ne jamais committer messages réels, données client, médias privés, secrets, journaux de production ou dumps SQL. Les tests utilisent des données synthétiques. L’invitation et l’admission manuelle ne constituent pas une preuve indépendante de majorité.

Les anciens bilans du README restent dans [Git, état du 20 octobre 2026 avant cet entretien](https://github.com/fredbuhr/jessiemessage/blob/bbd733d85b49b892d78c7cd90509ced04a990939/README.md). L’[historique du 19 octobre](docs/REPRISE-HISTORIQUE-20261019.md), l’[ancien journal d’implémentation](docs/NEXT-STEPS.md) et les preuves datées sont conservés.

## Licence

Aucune licence open source n’a été accordée. La visibilité publique du dépôt n’accorde pas à elle seule un droit de réutilisation du code.
