# Reprendre JessieMessage

**20 octobre 2026 Europe/Paris — lot 1 applicatif de l’audit livré : 0.80.0 déployé et vérifié sur le mutualisé.** A02, A03, A04 et A11 corrigés ; A01 (correctifs Node fournis par l’hébergeur) reste ouvert indépendamment. S1, S2a/S2b et S3 restent clos. Lire le [plan](PLAN-IMPLEMENTATION.md), le [lot 1](audit-corrections-080.md) et [AGENTS](../AGENTS.md). KISS permanent ; aucun nouveau serveur ni budget.

L’ancien compteur « étape 4/6 » appartenait au plan du 18 octobre, remplacé par S1/S2/S3 le 19. Il n’est pas l’avancement actuel. Le plan explicite des corrections de l’audit comporte quatre lots puis une clôture ; le lot 1 applicatif est livré, les suivants restent à faire. La livraison V1 n’atteste pas les garanties abandonnées de l’ancien périmètre.

## Audit et correctifs courants

L’[audit transversal](AUDIT-CODE-2026-10-20.md) porte sur `f629137`, code applicatif identique au runtime 0.79 de l’époque. [Preuves datées](verification-proofs/jm079-audit-20261020.json). Aucun P0/P1 ni accès intercompte démontré dans les surfaces examinées ; cela ne certifie pas leur absence. Deux candidats navigateur C01/C02 restent à confirmer au lot 4.

**0.80 livre le lot 1 applicatif :** débits global/réseau atomiques en cas de refus réseau ; échéances des diffusions et liens revérifiées après attentes SQL ; rollback d’une diffusion expirant pendant ses écritures ; politique HSTS hôte seul à la frontière HTTP. Aucun schéma ni dépendance changé. [Compte rendu et limites](audit-corrections-080.md), [preuves 0.80](verification-proofs/jm080-verification.json).

A01 reste ouvert : le Manager propose les branches majeures, sans choix de correctif précis ; la branche 24 est déjà sélectionnée et le binaire après déploiement reste **24.15.0**. Aucun runtime parallèle ni changement de version majeure/offre installé. `npm audit` ne couvre pas les correctifs intégrés à Node. La correction applicative ne masque pas cette dépendance hébergeur.

## Service courant et preuves

Messagerie privée sur invitation, texte/photos, sessions indépendantes, CRM, export, notifications, copies chiffrées PC existantes, fermetures locales et récupération manuelle en maintenance. Conversations jusqu’à fermeture définitive, hors suppressions volontaires. [Guide quotidien](guide-jessie.md), [recette V1](messaging-acceptance-079.md).

[PR #102](https://github.com/fredbuhr/jessiemessage/pull/102) fusionnée : candidat `5edff7ca5899e564e6b96555528ec1887d08fbfe`, merge **`eb3e93c534bdfe5d426b1be42d6bebb093b548ce`**, arbre commun **`60eeeb39bf22f0ac894e46b8d444b18a795a2167`**. Cinq jobs [candidat](https://github.com/fredbuhr/jessiemessage/actions/runs/39348463757) et cinq [main](https://github.com/fredbuhr/jessiemessage/actions/runs/39349061528) réussis : **3 051 tests généraux réussis / 35 wrappers SQL ignorés / zéro échec ; 458/458 sur chaque MariaDB 10.11 et 11.4 sans omission ; Chrome 160 ; recettes HTTPS/SQL 2 ; syntaxe 563 ; aperçu construit**. Le run source push est également vert. Local : 2 868 réussis, 214 ignorés, zéro échec ; omissions locales distinctes des preuves natives CI.

Déploiement normal du Manager, build réussi affiché **20 octobre 02:50 Europe/Paris**, sans réinstallation ni migration. À **00:54:16.691594 UTC / 02:54:16 Europe/Paris** : checkout/source/arbre/propreté, version et lanceur vérifiés ; dix empreintes sensibles préservées ; reçu de démarrage du superviseur et moniteur **OK**. Santé/disponibilité HTTPS **200**, JSON attendu, `no-store`, sans cookie et HSTS unique `max-age=31536000` sur les deux origines. API Sauvegardes, Confidentialité et Fermetures **401 anonymes**, avec HSTS. Entrée `/app` rendue dans Chrome après vérification d’accès. [Preuve Manager](verification-proofs/jm080-manager.jpg).

Les PID parent/enfant n’ont pas été observés depuis la console SSH. Le démarrage est attesté par le reçu du superviseur, émis après IPC et disponibilité HTTP de l’enfant, et par les contrôles HTTPS frais avec le nouvel en-tête. Aucun GET administrateur authentifié, envoi réel de test, effacement de compte ou restauration de production effectué pour valider ce lot.

## Pins à utiliser

| Élément | Valeur courante |
| --- | --- |
| Code exécuté | `eb3e93c534bdfe5d426b1be42d6bebb093b548ce` |
| Arbre | `60eeeb39bf22f0ac894e46b8d444b18a795a2167` |
| Checkout | `/srv/customer/jessiemessage-operator/audit-lot1-080-eb3e93c5` |
| Run Manager | `bash /srv/customer/jessiemessage-private/start-primary-audit-lot1-080-eb3e93c5.sh` |
| Lanceur | 0700 ; SHA-256 `a8a73bfd7d4dc8dc0d901ae4c47ddc4fef94cb2ecfbecf80a759ffcb006f7e40` |
| Journal | `/srv/customer/jessiemessage-private/jm080-audit-lot1.log`, 0600 |
| Configuration | `/srv/customer/jessiemessage-private/primary-origin-candidate-4a355851` |
| Opérations | `/srv/customer/jessiemessage-private/recurring-backup-052` |

Mode **`start-local-closures`**, `closuresEnabled:true`, port **3000 direct**, sans observateur/passerelle. Garder `JESSIEMESSAGE_PRIVATE_PATH_MODE=linux-dirfd`. Six configurations, clés, base, médias, sessions, destinataire GPG et cadence **05:15 UTC** réutilisés. Ne pas lancer un second parent depuis SSH ni `capture --offline` pendant le service.

Précontrôle 0.80 acquis le **20 octobre à 00:42:08.258463 UTC**, sans arrêt, capture ni effacement : `local_closure_precheck / passed`, `pendingClosures:false`, `started:false`, `erased:false`, `externalContinuityVerified:false`. Le lockfile ne diffère de 0.79 que par les deux versions racine ; dépendances existantes réutilisées après comparaison.

Checkpoint unique **0600** : `/srv/customer/jessiemessage-private/jm0702-existing-pc-update.json`. `activeService.release=0.80.0` ; `developmentSimplification.auditCorrections.status=application_deployed_verified`, constats corrigés A02/A03/A04/A11, `nodeStatus=provider_patch_pending`. Les pins/reçus S1/S2/S3 restent conservés comme faits historiques ; aucun journal parallèle de reprise.

## Lots V1 clos et limites conservées

- **S1, 0.76 :** administration simplifiée et démarrage sans observateur, copies/moniteur/alertes conservés. [Preuves](verification-proofs/jm076-verification.json).
- **S2a/S2b, inclus dès 0.79 :** fermeture locale reprenable, drainage des producteurs, registre de fermeture, outil manuel `check | restore | open`, cible isolée, réconciliation, révocation des sessions et publication explicite sous maintenance. Qualifiés sur données synthétiques en CI, sans restauration de production. [Guide opérateur](manual-restore-operator-078.md), [preuves S2a](verification-proofs/jm077-verification.json), [preuves S2b](verification-proofs/jm078-verification.json).
- **S3, livraison initiale 0.79 :** trois sessions Chrome sur vrai HTTPS/SQL/médias, texte/photo, brouillon, notification vers le message exact, déconnexion d’un seul appareil, guide et conservation. [Preuves 0.79](verification-proofs/jm079-verification.json). Les plateformes physiques et l’arrière-plan système/PWA ne sont pas tous qualifiés ; aucune nouvelle recette personnelle générale imposée.

Récupération autonome après perte complète de l’hôte, témoin frais par phase, succession et inventaire SQL exhaustif restent hors prérequis V1, sans garantie équivalente. `completeDatabase:false`, objets exécutables exclus. L’opérateur choisit un registre récent complet ; pas de garantie après perte simultanée de l’hôte et de fermetures non copiées. Secours Infomaniak sept jours, fichiers/base non simultanés. Pas de perte maximale garantie de vingt-quatre heures. Les défauts de volume, progression PC et historique restent au lot 2 de l’audit.

La [surveillance](../MONITORING.md) garde ses limites : moniteur local/mails acceptés, douze passages externes réussis observés avec intervalles de plusieurs heures ; aucun délai maximal de détection ni réception d’alerte externe attestés.

## Préserver PC, autorité et D1

- **PC, 19 octobre :** copie et déchiffrement acceptés, `DECHIFFREMENT_VERIFIE` à **16:34:19 UTC**, capture `1792386945745-204e0e8e073b6131`, GPG 402 552 octets, SHA-256 `c809dbfed6eabd2e8bde1a1d30a6cb11cbc99df720c0140935b3f2ae413690e5`. Mails acceptés le 18 octobre. Aucun nouveau test personnel à refaire.
- Ne pas réapparier le PC, exporter/régénérer sa clé privée, supprimer DPAPI, marqueurs ou dossier `temoin`. Ne rejouer ni `plan-witness`, ni `prepare-witness`, ni `prepare-witness-enrollment`. La messagerie quotidienne ne dépend pas du PC allumé.
- Autorité conservée sous `/srv/customer/jessiemessage-private/witness-origin-069-6b84f6e1`, fichiers 0600 : `contract/witness-genesis.json` original, SHA-256 `4fbdce199d70c1fd4b80f8ff249dae2666812b8ffc1c6912e8c50d1a042aaf10` ; `enrollment/witness-enrollment-origin.json` original, `817c6dca7735bb844d73066ebd3a711c46eb52cf5d5aabb5f4772171efc4b0c1` ; `enrollment/witness-enrollment.json` **spent, révision 2**, `445bc6c49bc0259284f2636f678e9073a833a2a4f60a992a6f87e5a3d1d7d35a`. Aucun retour à `ready`.
- **D1, 19 octobre :** base `fb4hmr_jm_restore_20261019`, opérateur `fb4hmr_jm_d19`, trente tables/migrations, six clés et quatre photos vérifiées ; `completeDatabase:false`. Conserver `restore-d19-checkpoint`, `restore-d19-quarantine`, reçus `restore-d19-operator` et marqueur bloquant `operational-restore.json`. Aucun réimport, rebind ni retrait de quarantaine. [Preuves](verification-proofs/jm-d19-isolated-restore.json).
- `recette.jessiemessage.com` partage runtime/base du principal : ce n’est pas une cible isolée. D2 reste historiquement non qualifié (`shared_admin / raw_underscore_pattern`, métadonnées refusées, scheduler OFF distinct de DISABLED) ; ne pas le rouvrir comme préalable V1.

## Repli et prochaine action

**Repli immédiat : 0.79.0**, source `bc6103a73ce63752eda27a0bce83a7e53e409d09`, arbre `39ac4fdabc55b7661742fbd6acc5763d65a42dab`, checkout `/srv/customer/jessiemessage-operator/messaging-final-079-bc6103a7`. Run `bash /srv/customer/jessiemessage-private/start-primary-messaging-079-bc6103a7.sh`, lanceur 0700, SHA-256 `4611fa20c46a5a56147a4d54ff319b5e93dd23396fd8fbc5e1bfcab5ebe68328`. Commandes Manager exactes dans `developmentSimplification.auditCorrections.rollback` du checkpoint. Aucun retour SQL ni suppression de journal ; une intention inachevée garde sa barrière. L’ancien repli 0.76 et ses fichiers restent conservés dans les preuves S3, avec 0.72 historique.

**Prochaine action : lot 2, cohérence des volumes et progression des copies existantes**, après ce bilan de lot 1. A01 reste ouvert indépendamment. Aucun VPS, budget, questionnaire, mail de test ou appariement requis. Préserver PC, clés, autorité et D1. [Historique du 19 octobre](REPRISE-HISTORIQUE-20261019.md) et [état avant livraison 0.80](https://github.com/fredbuhr/jessiemessage/blob/eb3e93c534bdfe5d426b1be42d6bebb093b548ce/docs/REPRISE.md).
