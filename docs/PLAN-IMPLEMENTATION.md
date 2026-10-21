# Plan de travail de JessieMessage

La V1 initiale est terminée dans le périmètre convenu. L’état réellement déployé, ses preuves et les commandes opérateur sont exclusivement dans **[REPRISE](REPRISE.md)**. Ce plan décrit le travail restant ; les anciens lots correctifs restent historiques.

Les livraisons 1.0.0, 1.1.0 et 1.2.0 sont closes ; leurs bilans et preuves sont conservés ci-dessous. La numérotation suit le [README](../README.md#versions-et-livraisons). Une publication ne prouve pas un déploiement.

## Livraison active 1.3.0 — close

[Emojis enrichis et inclusifs](emoji-inclusifs-130.md) : code qualifié, fusionné, publié et actif en 1.3.0, identité admin rapportée par l’utilisateur et disponibilité publique 4/4 conforme. **Le reçu utilisateur `release130_metadata_recorded` confirme l’alignement final du checkpoint : lot clos**, sans redémarrage, avec état antérieur/repli 1.2.0 et autres blocs préservés. Les neuf tests synthétiques du helper restent distincts de cette exécution. Ne rejouer ni writer, ni préparation, ni activation, ni Build/Run, ni relevé admin pour cette clôture. [REPRISE](REPRISE.md) conserve les preuves. La redistribution d’une bibliothèque Flirtmoji reste distincte de ce catalogue Unicode.

## Travail en cours — correctif prioritaire 1.3.1

[Messagerie mobile centrée sur la conversation](chat-mobile-131.md) : une seule barre active avec avatar, nom, **Options** et retour administrateur si nécessaire ; Contact, Aide et export dans le menu discret ; composeur `+` / `☺` / saisie / envoi. Correctif de présentation sans changement de transport, droits, API, dépendances ou SQL. **PR 114 fusionnée, CI finale de PR et CI main exacte 5/5 réussies, tag/release v1.3.1 publié et relu.** Préparation, précontrôle hébergé et activation distincte restent en attente ; la production reste en 1.3.0 close. Suivre uniquement la prochaine action opérateur de [REPRISE](REPRISE.md).

## Évolutions de messagerie demandées le 20 octobre

| Évolution | Résultat attendu et critère de fin | État |
| --- | --- | --- |
| **3 — Diffusions à grande échelle** | Audience globale et paginée sans plafond métier de cent ; débit adapté, reprise après interruption et absence de doublons de message sur plusieurs milliers de destinataires synthétiques. | Planifiée après le correctif mobile 1.3.1 ; la 1.3.0 est close. |
| **4 — Annonces** | Bandeau, programmation, expiration et notification facultative ; publication unique et absence d’annonce devenue inutile après une coupure. | Planifiée. |
| **5 — Tâches et rappels** | Plusieurs tâches privées par client, échéances, report, alertes et vue commune ; persistance et modifications simultanées maîtrisées. | Planifiée. |
| **6 — Transport vidéo** | Téléversement et lecture partielle privés avec mémoire bornée et chiffrement approprié ; refus intercompte et interruptions traitées. | Planifiée. |
| **7 — Vidéos dans la messagerie** | Aperçu, lecteur, légende, galerie et diffusion ; export, suppression et fermeture de compte cohérents. | Planifiée. |
| **8 — Validation et portabilité** | Parcours combinés, capacité du mutualisé mesurée et migration répétée sur données synthétiques. | Planifiée. |

Un résultat borné et documenté à la fois. Les autres évolutions ne sont pas ouvertes automatiquement ; la qualification d’appareils réels et des notifications conserve ses limites. Sauvegardes/PC et archivage différés restent hors de ce parcours. Les essais de masse ou de restauration exigent une cible synthétique isolée ; l’alias recette partage la production.

## Livraisons antérieures closes

- [Profil et expressions 1.2.0](profile-expressions-120.md) : production identifiée, schéma 31, disponibilité et checkpoint alignés ; repli 1.1.1 compatible précontrôlé.
- [Lecture privée 1.1.0](private-read-receipts-110.md) et [preuves d’harmonisation 1.0.0](REPRISE.md#validation-locale-de-100).
- [Clôture V1 0.86](production-086.md) et [qualification Node associée](node-runtime-086.md).
- [Envoi confirmé après perte de réponse HTTP, 0.85](chat-send-ack-085.md).
- [Clôture des corrections de l’audit, 0.83](audit-closure-083.md), [audit daté](AUDIT-CODE-2026-10-20.md) et [corrections d’interface](audit-corrections-083.md).
- [Recette V1 initiale, S3/0.79](messaging-acceptance-079.md), [preuves S1](verification-proofs/jm076-verification.json), [restauration manuelle S2](manual-restore-operator-078.md).
- [Historique du 19 octobre](REPRISE-HISTORIQUE-20261019.md) et [ancien journal](NEXT-STEPS.md).

Ces bilans conservent leurs versions, heures, réserves et limites ; ils ne constituent pas une seconde liste d’actions courantes. Le compteur historique « 4/6 » ne désigne aucun travail V1 oublié. Les garanties de récupération autonome, de témoin frais par phase, de succession et d’inventaire SQL exhaustif restent hors des prérequis V1.
