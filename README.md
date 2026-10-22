# JessieMessage

Messagerie privée sur invitation entre Jessie et chaque personne invitée : texte, photos, vidéos, notifications, sessions indépendantes et outils d’administration. Elle utilise l’unique service Node sur l’hébergement mutualisé existant.

**[REPRISE — état réellement déployé, sources, preuves, accès et repli](docs/REPRISE.md)** est l’unique référence de production. Au 22 octobre 2026, l’utilisateur rapporte **1.8.1 / Node v24.22.1**, commit `1ae4c75152795ea6f31c2ff364e337a1d5a04e31`, démarrage affiché `22/10/2026 15:30:16`. Les [preuves d’identité](docs/verification-proofs/jm181-hosted-identity.json), [SQL36](docs/verification-proofs/jm180-hosted-schema36.json) et [métadonnées finales](docs/verification-proofs/jm181-hosted-metadata.json) sont séparées. Le repli **1.7.2** compatible SQL36 est précontrôlé et jamais démarré. **Ne démarrer ni 1.7.1 ni 1.6.0 sur SQL36.**

L’[audit final](docs/AUDIT-FINAL-20261022.md) a conduit au [plan de correction en quatre lots](docs/PLAN-IMPLEMENTATION.md). Les lots1 à3 sont qualifiés ; la [PR129](https://github.com/fredbuhr/jessiemessage/pull/129) est fusionnée en **1.8.2**, [qualifiée sur main](docs/verification-proofs/jm182-main-ci.json) puis [publiée](docs/verification-proofs/jm182-publication.json) sur sa source exacte. **Latest GitHub = v1.8.2 ; production connue =1.8.1.** Le lot4 attend la préparation sur l’hôte et ses précontrôles avant activation ; [état détaillé](docs/verification-proofs/jm182-verification.json). Les faits juridiques A10 encore non établis et l’observation hébergée A11 restent ouverts.

L’utilisateur confirme la liste commune des réponses rapides et le parcours vidéo. **La création, la fin et le téléchargement d’une sauvegarde manuelle restent non vérifiés ; le test est reporté à un autre jour à sa demande.** Aucun diagnostic fournisseur, nouvel essai ou rappel n’est lancé. La redirection accueil/www est [achevée](docs/public-domains-20261022.md), chemins et paramètres conservés. `recette.jessiemessage.com` reste une origine de compatibilité : même runtime et même base que le principal, sans environnement de test isolé.

## Documentation courante

| Document | Usage |
| --- | --- |
| [REPRISE](docs/REPRISE.md) | Production, checkpoint, source exacte, accès Manager et prochaine action. |
| [Produit](docs/PRODUCT.md) et [guide quotidien](docs/guide-jessie.md) | Fonctions disponibles, utilisation et limites. |
| [Plan d’implémentation](docs/PLAN-IMPLEMENTATION.md) | Travail restant et critères de fin. |
| [Architecture](docs/ARCHITECTURE.md), [base de données](docs/DATABASE.md) et [capacité](docs/capacity-182.md) | Composition du runtime, ressources à préserver, profils SQL, droits et limites mesurables. |
| [Surveillance](MONITORING.md) | Sonde externe existante, portée et limites. |
| [Audit global](docs/AUDIT-FINAL-20261022.md) | Constats datés avant correction et preuves de reproduction. |
| [AGENTS](AGENTS.md) | Règles stables de travail et de livraison. |
| [Restauration opérateur](docs/manual-restore-operator-078.md) | Contrat de restauration sur cible réellement isolée, avec ses gardes. |
| [Principes KISS et aperçu](docs/DESIGN-KISS.md) | Simplicité de l’interface et du développement. |

## Périmètre et exploitation

Les sauvegardes et l’archivage automatiques sont abandonnés depuis la décision du 22 octobre ; le parcours livré depuis 1.8.0 est une sauvegarde simple à la demande dans l’administration, sans dépendance au PC. Les fermetures définitives restent traitées localement avec leurs contrôles. Archives, clés, autorités, reçus, quarantaines et états historiques sont préservés. La récupération autonome après perte complète de l’hôte, le témoin frais par phase, la succession et l’inventaire SQL exhaustif restent hors prérequis V1.

IA, paiements carte/crypto, stickers/GIF, messages vocaux, réponse citée, édition, transfert de messages et épingles sont abandonnés. Lovense, rendez-vous partagés, recherche de messages, réactions et rappels privés par push restent à préciser, sans chantier ouvert. Une date de tâche privée n’est pas un rendez-vous partagé. Le PHP du site secondaire relève d’Infomaniak.

## Versions et livraisons

[package.json](package.json) est la source de version, identique aux deux valeurs racine du lock. Depuis la référence `1.0.0`, une correction compatible incrémente le correctif, une fonction compatible le mineur et une rupture le majeur. Node, schéma SQL et formats de données ont leurs versions distinctes ; les numéros ne suivent pas le nombre de discussions ou de commits.

Chaque livraison possède un commit qualifié, un tag immuable `vX.Y.Z` et une release sur ce même commit, puis un déploiement et une identité réellement vérifiée. Une release n’est pas une preuve de déploiement. `main` peut avancer pour les preuves ; REPRISE conserve le commit effectivement exécuté. Aucun tag publié n’est déplacé.

## Développement et vérification

Utiliser le Node 24 épinglé par la CI et REPRISE. Après installation des dépendances verrouillées :

```sh
npm ci --ignore-scripts
npm test
npm run build
```

Le build inclut le contrôle syntaxique et produit l’atelier autonome ; il ne déploie pas l’application. `npm run check` permet le contrôle syntaxique seul. `npm run test:browser` exige Chrome ; `npm run test:db` et `npm run test:auth-browser` exigent leurs bases jetables, clients natifs et navigateurs configurés. La [CI](.github/workflows/ci.yml) décrit ces environnements synthétiques. Une omission locale reste distincte d’une qualification native. Ne pas réexécuter les mêmes suites vertes sans changement ou question nouvelle.

Le chargeur SQL normal conserve ses **33 migrations** ; le profil vidéo actif compose les **3 migrations supplémentaires**, soit **SQL36**. Identités SQL d’exécution et de migration sont séparées ; aucune migration au démarrage. Les contraintes d’exploitation et pins de REPRISE remplacent tout démarrage de développement du service existant.

## Aperçu sans terminal

Dans un run CI réussi du code choisi, télécharger l’artefact **JessieMessage-apercu-…**, l’extraire et ouvrir **JessieMessage.html**. Les comptes et interactions sont fictifs et disparaissent au rechargement. La bascule client/admin sert à examiner l’interface et ne fournit aucune authentification. Ne pas déployer cet atelier comme application.

L’[identité approuvée](docs/IDENTITE-VALIDEE.md) et [Nuit V2](docs/NUIT-V2.md) décrivent les choix visuels. Les portraits personnels ne font pas partie du dépôt ou des artefacts publics. Les versions de maquette **0.3.1** (notice) et **0.3.0** (`JessieNight.version`) restent historiques ; elles ne décrivent pas toutes les fonctions livrées ni la version applicative.

## Données et historique

Ne jamais committer messages réels, données client, médias privés, secrets, journaux de production ou dumps SQL. Les qualifications utilisent des données synthétiques. Invitation et admission manuelle ne constituent pas une preuve indépendante de majorité. L’aide publique harmonisée n’est pas une certification juridique ; les faits non établis restent ouverts dans le plan.

Les [relevés historiques de reprise du 22 octobre](docs/REPRISE-HISTORIQUE-20261022.md), l’[historique du 19 octobre](docs/REPRISE-HISTORIQUE-20261019.md), la [passation du 21 octobre](docs/PASSATION-20261021-160.md) et l’[ancien journal](docs/NEXT-STEPS.md) conservent leurs versions, preuves et réserves. Leurs anciennes prochaines étapes ne sont pas des commandes courantes. Les [anciens bilans du README](https://github.com/fredbuhr/jessiemessage/blob/bbd733d85b49b892d78c7cd90509ced04a990939/README.md) restent dans Git.

| Contrat ou jalon historique | État à lire dans son contexte |
| --- | --- |
| [Profils 1.2.0](docs/profile-expressions-120.md), [emojis 1.3.0](docs/emoji-inclusifs-130.md), [mobile 1.3.1](docs/chat-mobile-131.md), [photos 1.3.3](docs/photo-message-details-133.md) | Livraisons closes, preuves datées et anciens replis. Le socle [1.3.2](docs/client-voice-message-details-132.md) n’a pas été activé séparément. |
| [Diffusions 1.4.0](docs/broadcast-scale-140.md), [annonces 1.5.0](docs/announcements-150.md), [tâches 1.6.0](docs/tasks-reminders-160.md) | Fonctions intégrées ; les références [1.3.4](docs/broadcast-compat-134.md), [1.4.1](docs/announcements-compat-141.md), [1.5.1](docs/tasks-compat-151.md) sont des replis historiques, pas le repli SQL36 courant. |
| [Transport 1.7.0](docs/video-transport-170.md), [catalogue vidéo](docs/video-catalogue-180.md), [messages vidéo](docs/video-messages-180.md), [cycle de vie](docs/video-lifecycle-180.md), [intégration G2](docs/video-integration-180.md) | Jalons intégrés à la livraison 1.8.0 ; SQL36 et parcours vidéo acquis séparément. Le test de sauvegarde hébergée reste reporté. |
| [Repli 1.7.2](docs/video-compat-172.md) et [correctif 1.8.1](docs/quick-replies-login-181.md) | Repli compatible précontrôlé jamais démarré et version active ; références exactes exclusivement dans REPRISE. |
| [Bilan global](docs/BILAN-GLOBAL-20261022.md), [ancien bilan de production](docs/PLAN-PRODUCTION-20261022.md), [clôture V1](docs/production-086.md), [ancien Node](docs/node-runtime-086.md) | Constats de leur étape, distincts de la source actuelle et des corrections en branche. |

Le générateur [d’accueil Apache neutre](docs/neutral-public-host.md) et la [transition d’entrée 0.32](docs/public-entry-transition.md) sont historiques. Ils ne régénèrent pas le routage courant et ne font pas partie du build ou du démarrage.

## Licence

Aucune licence open source n’a été accordée. La visibilité publique du dépôt n’accorde pas à elle seule un droit de réutilisation du code.
