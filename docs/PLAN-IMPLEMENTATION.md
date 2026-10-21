# Plan de travail de JessieMessage

La V1 initiale est terminée dans le périmètre convenu. L’état réellement déployé, ses preuves et les commandes opérateur sont exclusivement dans **[REPRISE](REPRISE.md)**. Ce plan décrit le travail restant ; les anciens lots correctifs restent historiques.

Les livraisons 1.0.0, 1.1.0, 1.2.0, 1.3.0 et 1.3.1 sont closes ; leurs bilans et preuves sont conservés ci-dessous. La numérotation suit le [README](../README.md#versions-et-livraisons). Une publication ne prouve pas un déploiement.

## Correctif 1.3.3 — actif, enregistrement final en attente

[Détails des photos au toucher](photo-message-details-133.md) : la [PR 116](https://github.com/fredbuhr/jessiemessage/pull/116) conserve les textes client de Jessie et les détails des messages à la sélection de 1.3.2 ; le bouton natif `⋯` est visible à côté des seules photos, même sans légende, sans hauteur ajoutée. Les CI PR/main **5/5** et le [tag/release v1.3.3](https://github.com/fredbuhr/jessiemessage/releases/tag/v1.3.3) qualifient le commit `ca0d4064…`. Le reçu de préparation hébergée et le relevé admin utilisateur confirment désormais **1.3.3 active**, Node 24.22.0, schéma 31 inchangé et repli immédiat 1.3.1 préservé. [Preuves 1.3.3](verification-proofs/jm133-verification.json).

**Reste uniquement l’enregistrement des métadonnées 1.3.3**, sans migration, Build/Run ni redémarrage. Sa prochaine action est exclusivement dans [REPRISE](REPRISE.md). La clôture de cette livraison attend le reçu final ; aucune préparation ou preuve d’activation supplémentaire n’est demandée. Les essais Chrome sont automatisés ; tous les parcours physiques sur téléphone ne sont pas attestés.

La 1.3.1 est close selon le reçu `release131_metadata_already_recorded` : son alignement existait déjà et le writer idempotent l’a constaté sans réécriture. La date de l’enregistrement initial n’est pas déduite. Le socle [1.3.2](client-voice-message-details-132.md) est historique, qualifié et publié mais jamais activé séparément ; ses résultats et son tag restent conservés. Aucun nouveau lot n’est ouvert par cet alignement.

## Évolutions de messagerie demandées le 20 octobre

| Évolution | Résultat attendu et critère de fin | État |
| --- | --- | --- |
| **3 — Diffusions à grande échelle** | Audience globale et paginée sans plafond métier de cent ; débit adapté, reprise après interruption et absence de doublons de message sur plusieurs milliers de destinataires synthétiques. | Planifiée après le correctif 1.3.3. |
| **4 — Annonces** | Bandeau, programmation, expiration et notification facultative ; publication unique et absence d’annonce devenue inutile après une coupure. | Planifiée. |
| **5 — Tâches et rappels** | Plusieurs tâches privées par client, échéances, report, alertes et vue commune ; persistance et modifications simultanées maîtrisées. | Planifiée. |
| **6 — Transport vidéo** | Téléversement et lecture partielle privés avec mémoire bornée et chiffrement approprié ; refus intercompte et interruptions traitées. | Planifiée. |
| **7 — Vidéos dans la messagerie** | Aperçu, lecteur, légende, galerie et diffusion ; export, suppression et fermeture de compte cohérents. | Planifiée. |
| **8 — Validation et portabilité** | Parcours combinés, capacité du mutualisé mesurée et migration répétée sur données synthétiques. | Planifiée. |

Un résultat borné et documenté à la fois. Les autres évolutions ne sont pas ouvertes automatiquement ; la qualification d’appareils réels et des notifications conserve ses limites. Sauvegardes/PC et archivage différés restent hors de ce parcours. Les essais de masse ou de restauration exigent une cible synthétique isolée ; l’alias recette partage la production.

## Livraisons antérieures closes

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
