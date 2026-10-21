# Plan de travail de JessieMessage

La V1 initiale est terminée dans le périmètre convenu. L’état réellement déployé, ses preuves et les commandes opérateur sont exclusivement dans **[REPRISE](REPRISE.md)**. Ce plan décrit le travail restant ; les anciens lots correctifs restent historiques.

Les livraisons 1.0.0, 1.1.0, 1.2.0, 1.3.0, 1.3.1, 1.3.3, 1.4.0, 1.5.0 et 1.6.0 sont closes ; leurs bilans et preuves sont conservés ci-dessous. La numérotation suit le [README](../README.md#versions-et-livraisons). Une publication ne prouve pas un déploiement.

La livraison **1.5.0 — Annonces** est close : code et CI qualifiés, versions publiées, migration et précontrôles hébergés, identité active et alignement privé confirmés. Le reçu `release150_metadata_recorded` confirme le schéma **32**, le repli compatible **1.4.1** précontrôlé et enregistré sans démarrage, l’ancien état 1.4.0 intégral et les autres blocs préservés. [Clôture et preuves](REPRISE.md#alignement-final-acquis--livraison-150-close). L’évolution 5 est désormais close par le reçu `release160_metadata_recorded`, avec le checkpoint 1.6.0/schéma 33 aligné et le repli 1.5.1 précontrôlé et enregistré sans démarrage. Le [socle du lot 6, version 1.7.0](video-transport-170.md), est fusionné, qualifié et publié, dormant dans le runtime normal. Le lot 7 est en développement, le lot 8 reste planifié ; aucune activation automatique.

## Évolutions de messagerie demandées le 20 octobre

| Évolution | Résultat attendu et critère de fin | État |
| --- | --- | --- |
| **7 — Vidéos dans la messagerie** | Catalogue et capacité SQL durables, aperçu, lecteur, légende, galerie et diffusion ; export, suppression, fermeture, inventaire et restauration vidéo cohérents avant activation. | 7.1 et 7.2 qualifiés sur `feat/video-messaging` ; aucune activation. |
| **8 — Validation et portabilité** | Parcours combinés, capacité du mutualisé mesurée et migration répétée sur données synthétiques. | Planifiée. |

Un résultat borné et documenté à la fois. Les autres évolutions ne sont pas ouvertes automatiquement ; la qualification d’appareils réels et des notifications conserve ses limites. Sauvegardes/PC et archivage différés restent hors de ce parcours. Les essais de masse ou de restauration exigent une cible synthétique isolée ; l’alias recette partage la production.

## Jalons de développement et livraison

**Le lot 7 est ouvert : 7.1 et 7.2 sont qualifiés sur sa branche, sans fusion ou activation.** Le [catalogue candidat](video-catalogue-180.md) et le [message vidéo privé candidat](video-messages-180.md) restent dormants. La prochaine action est **7.3 — cycle de vie complet**. Les sources exactes et les cinq jobs propres de 7.2 sont dans sa [preuve](verification-proofs/jm180-video-messages-verification.json). Le lot 8 n’est pas commencé. Ce découpage ne modifie pas la production **1.6.0 / schéma 33**, son checkpoint ou son repli **1.5.1**.

Les étapes ci-dessous sont des jalons reprenables du même résultat, pas des livraisons produit distinctes. Le lot 7 garde une branche et une PR de travail ; **une seule livraison produit est prévue à son terme, sans nouvelle version, tag, release, migration hébergée ou déploiement à chaque jalon**. Les évolutions fonctionnelles restent sur cette branche jusqu’à la qualification du résultat complet. La version compatible est décidée à l’ouverture effective du lot selon [AGENTS](../AGENTS.md), sans modifier les références déjà publiées.

Chaque jalon se termine par un commit poussé sur la branche, les vérifications adaptées au changement et un relevé court : branche, commit/arbre, PR, liens et état réels des CI, résultat obtenu, limites et prochaine action unique. Une CI en cours reste en cours ; une omission n’est pas une réussite. Après une interruption ou une réponse perdue, lire ce résultat durable avant de retenter une opération. Les suites déjà vertes sur un même code ne sont pas rejouées sans changement, échec ou préoccupation nouvelle. [REPRISE](REPRISE.md) conserve séparément l’état de production et le point de développement atteint.

## Lot 7 — Une messagerie vidéo complète

Le [transport 1.7.0](video-transport-170.md) reste dormant pendant ces étapes. Les catalogues et médias d’essai sont synthétiques et isolés. **Aucune route ni donnée vidéo de production n’est activée avant le cycle de vie complet et la qualification finale.** Aucun nouveau service, transcodage ou infrastructure n’est ajouté par défaut.

| Étape | Résultat borné | Critère de fin du jalon |
| --- | --- | --- |
| **7.1 — Catalogue et capacité** | Définir le contrat vidéo et de miniature, les migrations et l’adapter SQL `reserve/commit/getOwned/release` ; prévoir la compatibilité du repli. | Sur MariaDB isolée : réservation persistante des octets chiffrés, ACL propriétaire, refus après révocation, limites de capacité et états incertains conservés après perte d’accusé. Formats acceptés et limites de validation sont explicites ; aucun branchement de production. |
| **7.2 — Message vidéo privé — qualifié sur branche** | [Vidéo et légende, accès destinataire et galerie côté serveur](video-messages-180.md), sans interface ni activation. | CI 5/5 sur les sources exactes, MariaDB 10.11/11.4 chacune 527/527 sans omission : envoi synthétique atomique et idempotent, réessai sans doublon et tombstones ; lecture réservée au propriétaire ou au participant du message vivant, refus intercompte et après suppression ou révocation ; galerie avec curseurs BIGINT exacts. Plan normal 33, candidat 36. |
| **7.3 — Cycle de vie complet** | Étendre export, suppression, fermeture, inventaire, capture et restauration au format vidéo. | Une fixture non vide est exportée sans charger la vidéo entière en mémoire, restaurée et comparée ; une fermeture interrompue reprend en préservant le client témoin. Capacité libérée après suppression durable ; anciennes sauvegardes interprétées selon leur propre format. |
| **7.4 — Interface de conversation** | Sélection, aperçu, progression, annulation, lecteur, légende et galerie. | Parcours navigateur avec une fixture MP4 réellement décodable : envoyer, lire, chercher dans la vidéo, annuler et réessayer ; ressources locales libérées et erreur lisible pour un format incompatible. Aucun succès navigateur n’est déduit de la seule inspection `ftyp`. |
| **7.5 — Diffusion vidéo** | Réutiliser les campagnes de messages individuels et leur suivi. | Petite campagne synthétique avec succès, destinataire révoqué et confirmation perdue : absence de doublon, isolation des destinataires, exports et suppressions cohérents avec les références partagées. La capacité à grande échelle reste au lot 8. |
| **7.6 — Qualification et livraison unique** | Qualifier le résultat complet et son repli, puis réaliser la livraison hébergée bornée. | CI requises vertes sur les sources exactes, cycle complet et repli compatibles qualifiés, helpers opérateur testés et épinglés. Préparation, migration et activation consignées séparément ; identité active vérifiée avant d’annoncer la production. |

Le repli doit comprendre le futur schéma et préserver les données vidéo ; la production 1.6.0 actuelle n’est pas déclarée compatible par anticipation. Les contraintes existantes à traiter sont identifiées : contrats photo à deux JPEG et surcharge de 80 octets, exports JPEG assemblés en mémoire, inventaires et fermeture liés au schéma 33. Leur évolution appartient au lot 7, avec le délai global HTTP actuellement limité à 35 secondes. L’inspection MP4 du socle ne garantit ni codecs, ni piste vidéo, ni durée, ni compatibilité d’un téléphone.

## Lot 8 — Validation et portabilité

Ces jalons s’ouvrent après la clôture du lot 7. Ils produisent des mesures et des preuves sur les cibles réellement testées ; ils ne déclenchent pas de changement de version ou de déploiement par simple progression du plan.

| Étape | Résultat borné | Critère de fin du jalon |
| --- | --- | --- |
| **8.1 — Parcours combinés** | Vérifier texte, photo, vidéo, lecture privée, tâches, galerie, diffusion et notifications ensemble. | Scénarios synthétiques reproductibles avec coupure réseau et reprise ; vérifications sur les appareils effectivement disponibles. Toute absence de téléphone ou de navigateur reste explicitement non vérifiée. |
| **8.2 — Capacité mesurée** | Mesurer progressivement téléversements, lectures, mémoire, délais et contre-pression sur le mutualisé. | Relevé des tailles, concurrences et ressources observées sur une cible synthétique effectivement isolée, distincte du runtime et de la base de production. Aucun nombre d’utilisateurs ni débit n’est extrapolé d’une simple CI ; `recette` n’est pas une cible isolée. |
| **8.3 — Portabilité répétée** | Répéter le transfert de données synthétiques vers une autre racine/base isolée. | Deux passages reproductibles avec comparaison des messages, empreintes médias, ACL, tâches et charges de capacité. Les environnements et commandes réellement éprouvés sont consignés ; aucune migration de production ou récupération autonome de tout l’hôte n’est déduite. |

Les états PC/Avast, autorités, témoins et garanties différées restent préservés selon [REPRISE](REPRISE.md). Ce parcours ne rouvre ni réappariement du PC, ni régénération de clé, ni chantier de récupération autonome.

## Livraisons closes

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
