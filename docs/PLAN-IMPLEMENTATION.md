# Plan de travail de JessieMessage

La V1 initiale est terminée dans le périmètre convenu. L’état réellement déployé, ses preuves et les commandes opérateur sont exclusivement dans **[REPRISE](REPRISE.md)**. Ce plan décrit le travail restant ; les anciens lots correctifs restent historiques.

Les livraisons 1.0.0, 1.1.0, 1.2.0 et 1.3.0 sont closes ; leurs bilans et preuves sont conservés ci-dessous. La numérotation suit le [README](../README.md#versions-et-livraisons). Une publication ne prouve pas un déploiement.

## Correctif en cours — 1.3.2

[Voix de Jessie côté client et détails des messages](client-voice-message-details-132.md) : la nouvelle demande autorise la reformulation FR/EN à la première personne, l’allègement du passage sur la personne responsable dans l’aide et des messages compacts dont les dates, métadonnées et actions apparaissent à la sélection. Développement en cours, sans SQL, API serveur ni nouvelle dépendance. Le code, les vérifications, la CI, la fusion et la livraison restent à établir dans les [preuves 1.3.2](verification-proofs/jm132-verification.json) ; aucune étape future n’est déclarée acquise.

Ce correctif ne demande aucune nouvelle opération utilisateur sur 1.3.1 pour commencer. Son critère de fin est une présentation FR/EN cohérente, des détails accessibles au toucher et au clavier sans déclencher d’action, les protections de message conservées et la livraison du commit exact vérifiée. La production reste 1.3.1 pendant ce travail.

## Livraison active 1.3.1 — suivi final en attente

[Messagerie mobile centrée sur la conversation](chat-mobile-131.md) : code fusionné, qualifié, publié, précontrôlé et actif en 1.3.1 selon le relevé admin utilisateur. Schéma 31 inchangé, sans migration ni nouvelle dépendance ; repli 1.3.0 préservé. **Seul l’alignement final des métadonnées opérateur attend son reçu ; le lot n’est pas déclaré clos.** Ne rejouer ni préparation, ni Build/Run, ni activation. La trace de cet alignement est conservée dans [REPRISE](REPRISE.md) et ne bloque pas le correctif 1.3.2 demandé depuis. L’utilisateur valide visuellement la présentation mobile 1.3.1 ; cela ne vaut pas attestation explicite du clavier logiciel sur un téléphone physique.

## Évolutions de messagerie demandées le 20 octobre

| Évolution | Résultat attendu et critère de fin | État |
| --- | --- | --- |
| **3 — Diffusions à grande échelle** | Audience globale et paginée sans plafond métier de cent ; débit adapté, reprise après interruption et absence de doublons de message sur plusieurs milliers de destinataires synthétiques. | Planifiée après le correctif 1.3.2. |
| **4 — Annonces** | Bandeau, programmation, expiration et notification facultative ; publication unique et absence d’annonce devenue inutile après une coupure. | Planifiée. |
| **5 — Tâches et rappels** | Plusieurs tâches privées par client, échéances, report, alertes et vue commune ; persistance et modifications simultanées maîtrisées. | Planifiée. |
| **6 — Transport vidéo** | Téléversement et lecture partielle privés avec mémoire bornée et chiffrement approprié ; refus intercompte et interruptions traitées. | Planifiée. |
| **7 — Vidéos dans la messagerie** | Aperçu, lecteur, légende, galerie et diffusion ; export, suppression et fermeture de compte cohérents. | Planifiée. |
| **8 — Validation et portabilité** | Parcours combinés, capacité du mutualisé mesurée et migration répétée sur données synthétiques. | Planifiée. |

Un résultat borné et documenté à la fois. Les autres évolutions ne sont pas ouvertes automatiquement ; la qualification d’appareils réels et des notifications conserve ses limites. Sauvegardes/PC et archivage différés restent hors de ce parcours. Les essais de masse ou de restauration exigent une cible synthétique isolée ; l’alias recette partage la production.

## Livraisons antérieures closes

- [Emojis enrichis et inclusifs 1.3.0](emoji-inclusifs-130.md) : clôture confirmée par `release130_metadata_recorded`, preuves historiques préservées ; référence conservée comme repli de 1.3.1.
- [Profil et expressions 1.2.0](profile-expressions-120.md) : production identifiée, schéma 31, disponibilité et checkpoint alignés ; repli 1.1.1 compatible précontrôlé.
- [Lecture privée 1.1.0](private-read-receipts-110.md) et [preuves d’harmonisation 1.0.0](REPRISE.md#validation-locale-de-100).
- [Clôture V1 0.86](production-086.md) et [qualification Node associée](node-runtime-086.md).
- [Envoi confirmé après perte de réponse HTTP, 0.85](chat-send-ack-085.md).
- [Clôture des corrections de l’audit, 0.83](audit-closure-083.md), [audit daté](AUDIT-CODE-2026-10-20.md) et [corrections d’interface](audit-corrections-083.md).
- [Recette V1 initiale, S3/0.79](messaging-acceptance-079.md), [preuves S1](verification-proofs/jm076-verification.json), [restauration manuelle S2](manual-restore-operator-078.md).
- [Historique du 19 octobre](REPRISE-HISTORIQUE-20261019.md) et [ancien journal](NEXT-STEPS.md).

Ces bilans conservent leurs versions, heures, réserves et limites ; ils ne constituent pas une seconde liste d’actions courantes. Le compteur historique « 4/6 » ne désigne aucun travail V1 oublié. Les garanties de récupération autonome, de témoin frais par phase, de succession et d’inventaire SQL exhaustif restent hors des prérequis V1.
