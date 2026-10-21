# Plan de travail de JessieMessage

La V1 initiale est terminée dans le périmètre convenu. L’état réellement déployé, ses preuves et les commandes opérateur sont exclusivement dans **[REPRISE](REPRISE.md)**. Ce plan décrit le travail restant ; les anciens lots correctifs restent historiques.

Les livraisons 1.0.0, 1.1.0, 1.2.0, 1.3.0, 1.3.1 et 1.3.3 sont closes ; leurs bilans et preuves sont conservés ci-dessous. La numérotation suit le [README](../README.md#versions-et-livraisons). Une publication ne prouve pas un déploiement.

## Évolution 3 — Diffusions à grande échelle, en cours

Le lot [1.4.0](broadcast-scale-140.md) est ouvert après la clôture 1.3.3. Il doit permettre de choisir tous les clients, tous les résultats des filtres ou une sélection manuelle dépassant cent, avec un nombre réel prévisualisé puis confirmé. La file existante conserve la reprise après interruption et les identifiants stables ; le suivi et les destinataires sont paginés. Les envois restent des messages privés individuels.

La livraison comporte deux snapshots successifs : [1.3.4, compatibilité et futur repli](broadcast-compat-134.md), puis 1.4.0 avec la création élargie activée. Le premier doit pouvoir lire et traiter les nouveaux formats sans activer leur création dans son runtime normal. Aucun changement SQL ou de dépendance n’est prévu. Le code de compatibilité 1.3.4, ses groupes locaux ciblés, ses deux revues statiques et son build sont rapportés, avec les deux tentatives globales locales échouées et incomplètes conservées dans le bilan. Restent les qualifications natives et les CI des commits exacts, la fusion et la publication des deux livraisons, puis leur préparation hébergée et l’activation vérifiée de 1.4.0. Aucun résultat manquant n’est déduit du socle 1.3.3.

Le critère de fin est une campagne de plusieurs milliers de destinataires synthétiques, un aperçu confirmé qui ne s’élargit pas silencieusement, une création atomique, une reprise sans doublon et un affichage borné. Le repli doit être compatible avec les nouvelles campagnes. Les essais de téléphone physique et la capacité réelle du mutualisé gardent leurs limites ; la production reste 1.3.3 tant qu’un relevé d’activation ne prouve pas la suite. Les seules actions opérateur courantes sont dans [REPRISE](REPRISE.md) ; aucune commande n’est demandée maintenant.

## Évolutions de messagerie demandées le 20 octobre

| Évolution | Résultat attendu et critère de fin | État |
| --- | --- | --- |
| **3 — Diffusions à grande échelle** | Audience globale et paginée sans plafond métier de cent ; débit adapté, reprise après interruption et absence de doublons de message sur plusieurs milliers de destinataires synthétiques. | En cours ; compatibilité 1.3.4 puis cible 1.4.0, qualifications et livraison à établir. |
| **4 — Annonces** | Bandeau, programmation, expiration et notification facultative ; publication unique et absence d’annonce devenue inutile après une coupure. | Planifiée. |
| **5 — Tâches et rappels** | Plusieurs tâches privées par client, échéances, report, alertes et vue commune ; persistance et modifications simultanées maîtrisées. | Planifiée. |
| **6 — Transport vidéo** | Téléversement et lecture partielle privés avec mémoire bornée et chiffrement approprié ; refus intercompte et interruptions traitées. | Planifiée. |
| **7 — Vidéos dans la messagerie** | Aperçu, lecteur, légende, galerie et diffusion ; export, suppression et fermeture de compte cohérents. | Planifiée. |
| **8 — Validation et portabilité** | Parcours combinés, capacité du mutualisé mesurée et migration répétée sur données synthétiques. | Planifiée. |

Un résultat borné et documenté à la fois. Les autres évolutions ne sont pas ouvertes automatiquement ; la qualification d’appareils réels et des notifications conserve ses limites. Sauvegardes/PC et archivage différés restent hors de ce parcours. Les essais de masse ou de restauration exigent une cible synthétique isolée ; l’alias recette partage la production.

## Livraisons antérieures closes

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
