# Plan global de JessieMessage

Révisé le 22 octobre 2026 après le bilan de **l’ensemble de l’application** et la décision de simplifier son périmètre. Le précédent décompte de huit résultats concernait seulement la vidéo et sa qualification ; il ne mesurait pas toutes les fonctions encore absentes. Il est remplacé par le présent plan. Le [bilan global](BILAN-GLOBAL-20261022.md) distingue livré, développé sur branche, absent, défectueux et non vérifié. [REPRISE](REPRISE.md) reste l’unique référence de production et des commandes opérateur.

## Point de départ acquis

La dernière identité active **1.7.1 / Node 24.22.1 / SQL33** est historique. Selon les résultats utilisateur, le service était arrêté pendant la migration : **SQL36, initialisation vidéo et précontrôles 1.7.2/1.8.0 sont acquis**, sans démarrage ultérieur attesté. Invitations, authentification et sessions multiples, texte/photos, profils et avatars, 268 emojis Unicode, lecture privée, CRM, diffusions élargies, annonces, tâches privées et exports photo sont livrés. Les réponses rapides se limitent à six phrases fixes FR/EN. La fermeture locale des comptes est disponible sous ses gardes, sans nouveau raccordement PC.

**G1–G3 sont fusionnés dans la 1.8.0, et G4 a qualifié le repli technique 1.7.2.** Sources : produit `fd6e53b14b520231b0b307a2761331dd8c740a5b`, arbre `324c3563fc6b1cfce669bcf58d90962c23c966b8` ; repli `6b3319a77c307ed7d6b003fe33de36807c70c266`, arbre `924d500375a69ae50bc63414b15df71271e2bf8a`. Les PR 125 et 127 sont fusionnées ; leurs CI PR et main sont toutes **5/5, tentative 1**. [Preuve finale 1.8.0](verification-proofs/jm180-final-delivery-verification.json), [preuve 1.7.2](verification-proofs/jm172-verification.json). Les preuves G1–G3 restent historiques. La [1.8.0](https://github.com/fredbuhr/jessiemessage/releases/tag/v1.8.0) et le [repli v1.7.2](https://github.com/fredbuhr/jessiemessage/releases/tag/v1.7.2) sont publiés, sans déplacer latest 1.7.1 ; les [sources/lanceurs et le bundle vidéo sont préparés](verification-proofs/jm180-hosted-preparation.json), puis [SQL36 et les deux précontrôles ont réussi](verification-proofs/jm180-hosted-schema36.json), sans activation. Le plan normal SQL33 reste distinct ; il ne doit pas être démarré sur la base migrée.

## Périmètre décidé le 22 octobre

**Sont abandonnés : IA, paiements carte et crypto, stickers et GIF, messages vocaux, réponse citée, édition, transfert de messages et épingles.** Ces fonctions sortent du backlog ; elles ne sont plus des lots différés à estimer. Les emojis Unicode, la suppression de messages, les diffusions et les exports déjà livrés sont conservés.

**Les sauvegardes et l’archivage automatiques sont remplacés dans le périmètre cible par une sauvegarde simple, déclenchée à la demande depuis l’administration.** Aucun exécuteur d’archivage automatique n’est à développer. Les copies, clés, autorités et historiques existants sont préservés ; les fermetures locales et leurs contrôles restent opérationnels. Cette décision ne décrit pas encore la production : **le remplacement effectif des automatismes reste à vérifier après activation 1.8.0** ; le service 1.7.1 a été arrêté lors de la migration rapportée.

## Un seul lot restant : G4

G1, G2 et G3 sont fusionnés et qualifiés dans la référence produit 1.8.0. Le repli 1.7.2 est lui aussi qualifié et désormais publié ; ses fichiers et le bundle vidéo sont préparés sur l’hôte ; SQL36, initialisation vidéo et les deux précontrôles sont acquis, selon les résultats utilisateur ; activation, identité/HTTP et métadonnées restent à effectuer. Les subdivisions techniques ne deviennent pas de nouveaux lots ou arrêts à faire valider par l’utilisateur.

| Lot | Travail regroupé | Critère de fin concret |
| --- | --- | --- |
| **G4 — Livraison unique et contrôle en service** | Configurer Run/Build 1.8.0 et port 3000 dans le Manager, enregistrer et démarrer, puis contrôler HTTP, identité du processus actif, métadonnées et guide quotidien. | Le repli est qualifié et préparé avant migration. La version exacte est réellement active ; sauvegarde manuelle, vidéo et réponses personnelles sont accessibles, remplacement des automatismes vérifié et contrôles hébergés consignés. Publication et déploiement restent distingués. |

**Prochaine action : G4 — activation Manager 1.8.0, identité/HTTP, puis métadonnées.** [SQL36 et précontrôles](verification-proofs/jm180-hosted-schema36.json) sont acquis par résultats utilisateur, sans démarrage. Le repli **1.7.2 / SQL36** est précontrôlé et jamais démarré ; **1.7.1 et 1.6.0 ne doivent plus démarrer sur SQL36**. Les commandes Manager et le checkpoint 1.7.1/SQL33 restent obsolètes jusqu’à leur remplacement/alignement. Le lecteur historique G2 seul refuse les capsules avec réponses personnelles ; la 1.7.2 qualifiée conserve ces lecteurs à jour.

G3 a qualifié sur sa source unique les réponses personnelles, les suites globales et les wrappers d’import/reprise natifs, avec métriques CI. Il ne revendique ni une exécution intégrale du CLI de restauration manuelle de plus haut niveau, ni un téléphone physique, une notification système hors application ou une mesure du mutualisé. Ces limites restent explicites ; elles ne deviennent pas des micro-lots supplémentaires. La dernière identité active 1.7.1 est historique ; son runtime ne doit plus être démarré sur SQL36.

## Fonctions non abandonnées, à préciser et non ouvertes

La décision cite les fonctions abandonnées ci-dessus. Elle ne suffit pas à supprimer les autres sujets évoqués. Ils gardent le statut **à préciser, non ouvert**, sans prestataire, service, budget ou engagement de réalisation ajouté.

| Sujet | État réel | Limite de portée |
| --- | --- | --- |
| **Lovense** | Aucune intégration. | Action attendue et appareils à préciser avant tout chantier. |
| **Rappels privés push des tâches** | Compteur et rappels dans l’application ouverte ; aucun push de tâche lorsque l’application est fermée. | Éventuel rappel admin hors application à préciser ; aucune alerte au client à ajouter implicitement. |
| **Rendez-vous partagés** | Aucun module ; les tâches et leurs dates restent privées et n’avertissent pas le client. | Distinguer un partage explicite d’une tâche privée avant développement. |
| **Recherche de messages/notes** | Recherche de clients livrée ; recherche dans les contenus absente. | Périmètre à préciser, sans ajout au lot en cours. |
| **Réactions** | Absentes. | Usage à préciser, sans engagement de développement automatique. |

La **personnalisation des réponses** est fusionnée et qualifiée dans la 1.8.0, non livrée. La production conserve ses six phrases fixes jusqu’à G4. Les sujets de cette table restent à préciser et non ouverts ; ils ne bloquent pas le dernier lot et n’autorisent pas l’ouverture simultanée d’autres évolutions.

## Exploitation et limites conservées

- **Authenticator et notifications sur appareils réels :** les correctifs/parcours navigateur existent, mais l’aller-retour téléphone, le clavier mobile et les notifications système avec application fermée ne sont pas entièrement attestés. Les essais synthétiques G3 ne remplacent pas un appareil absent ; les plateformes non essayées restent non vérifiées.
- **PHP du site secondaire :** relève d’Infomaniak ; aucune vérification ni intervention PHP n’est une action de ce plan. L’application Node utilise 24.22.1.
- **Accueil secondaire :** ancien aperçu au dernier contrôle ; principal et www ont le nouvel accueil. La redirection a été refusée automatiquement et n’a pas été appliquée. Ne pas la retenter dans ce chantier ; [preuve et motif historiques](verification-proofs/jm171-secondary-entry.json).
- **PC/Avast :** le blocage signalé et le défaut de confirmation du kit restent non résolus, sans recette PC à reprendre pour G1. Le raccordement et ses clés restent préservés. Le parcours manuel qualifié sur branche ne dépend pas du PC ; aucune API cloud ou nouvelle infrastructure n’est ajoutée.
- **Archivage :** avertissement/simulation livrés, exécuteur absent. L’automatisation est abandonnée ; préserver copies et états existants, sans purge ni prétendue désactivation déjà réalisée.

La récupération autonome après perte totale de l’hôte, le témoin frais à chaque phase, la succession et l’inventaire SQL exhaustif ne deviennent pas des prérequis. Le service `recette` partage la production : restauration, charge et suppressions de qualification restent synthétiques sur des cibles réellement isolées.

## Organisation du travail

Conserver des checkpoints Git reprenables et la preuve de chaque opération distante, tout en poursuivant plusieurs sous-tâches cohérentes d’un même livrable sans demander une nouvelle permission générale. Ne pas relancer les mêmes audits et suites vertes sans changement, échec ou préoccupation nouvelle. Regrouper les contrôles quand leurs dépendances le permettent ; ne jamais promouvoir une omission ou un test unitaire en essai réel sur téléphone, hébergement ou compte client.

**À chaque étape, annoncer ce qui est fait et ce qui reste pour le résultat en cours.** Un export interne, compteur SQL ou document ne constitue pas à lui seul une nouvelle fonction utilisable. G1, G2 et G3 sont fusionnés et qualifiés ; les nouveautés 1.8.0 ne sont pas encore activées en production et les automatismes existants n’y sont pas encore remplacés. Les contrats techniques et preuves historiques du [cycle de vie vidéo](video-lifecycle-180.md) restent conservés sans réétiquetage.

## Livraisons closes

- **Sécurité Node et entrée privée 1.7.1** : correctif fusionné, CI PR/main 5/5, tag/release, préparation et précontrôles, identité active et HTTP confirmés. Le [reçu final](verification-proofs/jm171-hosted-metadata.json), `release171_metadata_recorded`, confirme le schéma 33 inchangé, le repli 1.6.0 sur Node 24.22.1 précontrôlé et enregistré sans démarrage, les états historiques et les autres blocs préservés. [Preuves CI](verification-proofs/jm171-verification.json), [publication](verification-proofs/jm171-publication.json), [préparation Node et repli](verification-proofs/jm171-hosted-node-preparation.json), [identité hébergée](verification-proofs/jm171-hosted-identity.json). L’essai Authenticator physique reste non vérifié ; PHP relève du fournisseur. Le principal et www affichent le nouvel accueil, tandis que le sous-domaine accueil conserve l’ancienne illustration ; la redirection refusée n’est pas reprise dans ce chantier, selon la [preuve secondaire](verification-proofs/jm171-secondary-entry.json). La vidéo reste dormante.

- [Transport vidéo privé 1.7.0 — socle du lot 6](video-transport-170.md) : code fusionné, CI PR/main 5/5 et tag/release publiés ; transport dormant, aucune nouvelle route ni donnée vidéo de production, schéma 33 inchangé. [Preuves](verification-proofs/jm170-verification.json). Intégration produit et cycle de vie au lot 7.
- [Tâches et rappels privés 1.6.0 — Évolution 5](tasks-reminders-160.md) : plusieurs tâches par client, échéances, report, terminer et réouvrir, vue commune et alertes dans l’application. Qualification, publication, migration et précontrôles sur le schéma 33, identité active et alignement privé confirmés. Le [reçu final](verification-proofs/jm160-hosted-metadata.json) conserve le [repli compatible 1.5.1](tasks-compat-151.md) précontrôlé et enregistré sans démarrage, l’ancien état 1.5.0 intégral avec son empreinte et les autres blocs. Aucun push de tâche lorsque l’application est fermée. [Preuves](verification-proofs/jm160-verification.json).
- [Annonces 1.5.0 — Évolution 4](announcements-150.md) : bandeau compact, programmation, expiration et messages privés facultatifs ; qualification, publication, migration et précontrôles sur le schéma 32, identité active et alignement privé confirmés. Le [reçu final](verification-proofs/jm150-hosted-metadata.json) confirme le [repli compatible 1.4.1](announcements-compat-141.md) précontrôlé et enregistré, jamais démarré, l’ancien état 1.4.0 intégral et les autres blocs préservés. [Preuves](verification-proofs/jm150-verification.json).
- [Diffusions à grande échelle 1.4.0](broadcast-scale-140.md) : audiences globales, filtrées ou manuelles sans plafond métier de cent, aperçu confirmé et suivi paginé ; qualification sur 2 500 destinataires synthétiques, précontrôles et identité active confirmés. Clôture acquise par `release140_metadata_recorded`, schéma 31 inchangé ; [repli compatible 1.3.4](broadcast-compat-134.md) précontrôlé et enregistré sans démarrage. L’ancien état 1.3.3 et tous les autres blocs sont préservés. [Preuves](verification-proofs/jm140-verification.json).
- [Voix de Jessie, messages compacts et détails des photos 1.3.3](photo-message-details-133.md) : code qualifié et publié, préparation et activation confirmées ; clôture acquise par `release133_metadata_recorded`, schéma 31 inchangé et repli immédiat 1.3.1 préservé. [Preuves](verification-proofs/jm133-verification.json). Aucune manipulation supplémentaire n’est requise pour cette livraison.
- [Messagerie mobile 1.3.1](chat-mobile-131.md) : préparation et activation acquises ; alignement privé confirmé par `release131_metadata_already_recorded`, repli immédiat de 1.3.3.
- [Emojis enrichis et inclusifs 1.3.0](emoji-inclusifs-130.md) : clôture confirmée par `release130_metadata_recorded`, preuves historiques préservées ; référence conservée comme repli de 1.3.1.
- [Profil et expressions 1.2.0](profile-expressions-120.md) : production identifiée, schéma 31, disponibilité et checkpoint alignés ; repli 1.1.1 compatible précontrôlé.
- [Lecture privée 1.1.0](private-read-receipts-110.md) et [preuves d’harmonisation 1.0.0](REPRISE.md#historique--validation-locale-de-100).
- [Clôture V1 0.86](production-086.md) et [qualification Node associée](node-runtime-086.md).
- [Envoi confirmé après perte de réponse HTTP, 0.85](chat-send-ack-085.md).
- [Clôture des corrections de l’audit, 0.83](audit-closure-083.md), [audit daté](AUDIT-CODE-2026-10-20.md) et [corrections d’interface](audit-corrections-083.md).
- [Recette V1 initiale, S3/0.79](messaging-acceptance-079.md), [preuves S1](verification-proofs/jm076-verification.json), [restauration manuelle S2](manual-restore-operator-078.md).
- [Historique du 19 octobre](REPRISE-HISTORIQUE-20261019.md) et [ancien journal](NEXT-STEPS.md).

Ces bilans conservent leurs versions, heures, réserves et limites ; ils ne constituent pas une seconde liste d’actions courantes. Le compteur historique « 4/6 » ne désigne aucun travail V1 oublié. Les garanties de récupération autonome, de témoin frais par phase, de succession et d’inventaire SQL exhaustif restent hors des prérequis V1.
