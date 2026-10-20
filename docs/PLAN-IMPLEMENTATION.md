# Plan de travail de JessieMessage

La V1 initiale est terminée dans le périmètre convenu. L’état réellement déployé, ses preuves et les commandes opérateur sont exclusivement dans **[REPRISE](REPRISE.md)**. Ce plan décrit le travail restant ; les anciens lots correctifs restent historiques.

## Référence 1.0.0 harmonisée

| Étape | Résultat et critère de fin | État |
| --- | --- | --- |
| Référence | Version applicative cohérente dans les métadonnées, documents avec rôles distincts, affichage admin de l’identité chargée par le processus. Aucun changement métier de messagerie ni migration SQL. | Code publié et fusionné par la PR 109 ; [résultats et limites des contrôles](REPRISE.md#validation-locale-de-100). |
| Publication | Commit validé par la CI habituelle, tag immuable `v1.0.0` et release GitHub correspondant à ce commit. | Réalisée : CI du commit de fusion 5/5 verte, tag/release publiés et vérifiés sur `70b48aa`. |
| Déploiement | Même commit lancé sur l’unique service Infomaniak, précontrôle et contrôles adaptés réussis, repli conservé, REPRISE actualisé après observation. | Réalisé : identité 1.0.0/70b48aa/Node 24.22 confirmée par relevé admin utilisateur après actualisation ; quatre GET publics conformes. R1/R2 SSH restent non concluants, sans attestation PID/socket. |
| Alignement opérateur | Checkpoint privé décrit la même identité et conserve intégralement l’ancien service comme repli, sans redémarrage ni autre modification serveur. | Réalisé : reçu `release100_metadata_recorded` sur `70b48aa`, version 1.0.0, sans redémarrage ; repli et autres blocs préservés. |

L’harmonisation est terminée. La numérotation est décrite dans le [README](../README.md#versions-et-livraisons). Une release ou un tag ne prouve pas un déploiement ; les versions préparées et actives restent distinctes. La reprise de l’évolution 1.1.0 est le prochain travail fonctionnel, distinct de cette clôture.

## Évolutions de messagerie demandées le 20 octobre

| Évolution | Résultat attendu et critère de fin | État |
| --- | --- | --- |
| **1 — Lecture privée**, cible `1.1.0` | Jessie voit les lectures clients ; le client ne reçoit pas la lecture de Jessie, y compris par API/export. Badges propres et appareils conservés ; régressions serveur, SQL et interface validées. | Préparée localement sur la V1 précédente ; non publiée/non déployée. Prochaine étape : reporter ce travail conservé sur la référence 1.0.0 désormais harmonisée. |
| **2 — Profil et expressions** | Profil, avatar et sélecteur emojis/stickers ; données persistantes, images légères et parcours mobile confortable. | Planifiée. |
| **3 — Diffusions à grande échelle** | Audience globale et paginée sans plafond métier de cent ; débit adapté, reprise après interruption et absence de doublons de message sur plusieurs milliers de destinataires synthétiques. | Planifiée. |
| **4 — Annonces** | Bandeau, programmation, expiration et notification facultative ; publication unique et absence d’annonce devenue inutile après une coupure. | Planifiée. |
| **5 — Tâches et rappels** | Plusieurs tâches privées par client, échéances, report, alertes et vue commune ; persistance et modifications simultanées maîtrisées. | Planifiée. |
| **6 — Transport vidéo** | Téléversement et lecture partielle privés avec mémoire bornée et chiffrement approprié ; refus intercompte et interruptions traitées. | Planifiée. |
| **7 — Vidéos dans la messagerie** | Aperçu, lecteur, légende, galerie et diffusion ; export, suppression et fermeture de compte cohérents. | Planifiée. |
| **8 — Validation et portabilité** | Parcours combinés, capacité du mutualisé mesurée et migration répétée sur données synthétiques. | Planifiée. |

Un résultat borné et documenté à la fois. Les autres évolutions ne sont pas ouvertes automatiquement ; la qualification d’appareils réels et des notifications conserve ses limites. Sauvegardes/PC et archivage différés restent hors de ce parcours. Les essais de masse ou de restauration exigent une cible synthétique isolée ; l’alias recette partage la production.

## Livraisons antérieures closes

- [Clôture V1 0.86](production-086.md) et [qualification Node associée](node-runtime-086.md).
- [Envoi confirmé après perte de réponse HTTP, 0.85](chat-send-ack-085.md).
- [Clôture des corrections de l’audit, 0.83](audit-closure-083.md), [audit daté](AUDIT-CODE-2026-10-20.md) et [corrections d’interface](audit-corrections-083.md).
- [Recette V1 initiale, S3/0.79](messaging-acceptance-079.md), [preuves S1](verification-proofs/jm076-verification.json), [restauration manuelle S2](manual-restore-operator-078.md).
- [Historique du 19 octobre](REPRISE-HISTORIQUE-20261019.md) et [ancien journal](NEXT-STEPS.md).

Ces bilans conservent leurs versions, heures, réserves et limites ; ils ne constituent pas une seconde liste d’actions courantes. Le compteur historique « 4/6 » ne désigne aucun travail V1 oublié. Les garanties de récupération autonome, de témoin frais par phase, de succession et d’inventaire SQL exhaustif restent hors des prérequis V1.
