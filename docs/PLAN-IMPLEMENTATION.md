# Plan de travail de JessieMessage

La V1 initiale est terminée dans le périmètre convenu. L’état réellement déployé, ses preuves et les commandes opérateur sont exclusivement dans **[REPRISE](REPRISE.md)**. Ce plan décrit le travail restant ; les anciens lots correctifs restent historiques.

Les livraisons 1.0.0, 1.1.0, 1.2.0, 1.3.0, 1.3.1, 1.3.3, 1.4.0 et 1.5.0 sont closes ; leurs bilans et preuves sont conservés ci-dessous. La numérotation suit le [README](../README.md#versions-et-livraisons). Une publication ne prouve pas un déploiement.

La livraison **1.5.0 — Annonces** est close : code et CI qualifiés, versions publiées, migration et précontrôles hébergés, identité active et alignement privé confirmés. Le reçu `release150_metadata_recorded` confirme le schéma **32**, le repli compatible **1.4.1** précontrôlé et enregistré sans démarrage, l’ancien état 1.4.0 intégral et les autres blocs préservés. [Clôture et preuves](REPRISE.md#alignement-final-acquis--livraison-150-close). L’évolution 5 est qualifiée, publiée et préparée sur l’hébergement ; sa migration et ses précontrôles au schéma 33 sont confirmés ; l’identité HTTP active 1.6.0 est confirmée, avec le seul alignement final des métadonnées en attente. Les évolutions 6 à 8 restent planifiées.

## Évolutions de messagerie demandées le 20 octobre

| Évolution | Résultat attendu et critère de fin | État |
| --- | --- | --- |
| **5 — Tâches et rappels** | Plusieurs tâches privées par client, échéances, report, alertes dans l’application et vue commune ; persistance et modifications simultanées maîtrisées. | [Code qualifié, fusionné et publié en 1.6.0](tasks-reminders-160.md), avec [référence compatible 1.5.1 publiée](tasks-compat-151.md). [Préparation hébergée acquise](verification-proofs/jm160-hosted-staging.json), sans SQL, précontrôle ou démarrage. [Migration et précontrôles hébergés acquis](verification-proofs/jm160-hosted-schema33.json) sur le schéma 33, avec arrêt du service attesté et repli 1.5.1 précontrôlé sans démarrage. [Activation et identité HTTP 1.6.0 acquises](verification-proofs/jm160-hosted-identity.json) ; seul le reçu d’alignement final des métadonnées reste attendu. Le writer est qualifié et publié sur le relevé réel ; le lot reste ouvert jusqu’à ce reçu final. |
| **6 — Transport vidéo** | Téléversement et lecture partielle privés avec mémoire bornée et chiffrement approprié ; refus intercompte et interruptions traitées. | Planifiée. |
| **7 — Vidéos dans la messagerie** | Aperçu, lecteur, légende, galerie et diffusion ; export, suppression et fermeture de compte cohérents. | Planifiée. |
| **8 — Validation et portabilité** | Parcours combinés, capacité du mutualisé mesurée et migration répétée sur données synthétiques. | Planifiée. |

Un résultat borné et documenté à la fois. Les autres évolutions ne sont pas ouvertes automatiquement ; la qualification d’appareils réels et des notifications conserve ses limites. Sauvegardes/PC et archivage différés restent hors de ce parcours. Les essais de masse ou de restauration exigent une cible synthétique isolée ; l’alias recette partage la production.

## Livraisons closes

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
