# Reprendre JessieMessage

**20 octobre 2026 Europe/Paris — étape 4/6. V1 technique déployée/vérifiée en 0.79.0 sur le mutualisé existant, fermetures locales activées.** S1, S2a/S2b et S3 sont clos. Lire le [plan](PLAN-IMPLEMENTATION.md) et [AGENTS](../AGENTS.md). KISS permanent ; aucun nouveau serveur ni budget.

## Service courant et preuves

Messagerie privée sur invitation, texte/photos, sessions indépendantes, CRM, export, notifications, copies chiffrées PC existantes et récupération applicative manuelle en maintenance. Les conversations restent conservées jusqu'à fermeture définitive, hors suppressions volontaires. [Guide quotidien](guide-jessie.md), [recette et limites](messaging-acceptance-079.md), [preuves 0.79](verification-proofs/jm079-verification.json).

[PR #101](https://github.com/fredbuhr/jessiemessage/pull/101) fusionnée : candidat `2342f749d59222104a3d6458c2617aa9f63ba69c`, arbre `39ac4fdabc55b7661742fbd6acc5763d65a42dab`, merge `bc6103a73ce63752eda27a0bce83a7e53e409d09`, arbre identique. Cinq jobs [candidat](https://github.com/fredbuhr/jessiemessage/actions/runs/39341320771) et cinq [main](https://github.com/fredbuhr/jessiemessage/actions/runs/39342025957) réussis : **2 996 tests généraux réussis / 35 wrappers SQL ignorés / zéro échec ; 436/436 sur chaque MariaDB sans omission ; Chrome 160 ; recettes HTTPS 2 ; syntaxe 558 ; aperçu construit**.

Déploiement par le cycle normal Build du Manager, minute affichée **20 octobre 01:41 Europe/Paris**, sans réinstallation de dépendances ni migration. Le **19 octobre à 23:45:34.085672 UTC** (**20 octobre 01:45:34 Europe/Paris**) : source/arbre/propreté et lanceur vérifiés ; dix fichiers sensibles en 0600 préservés ; vrai enfant et superviseur démarrés ; moniteur **OK**. Santé/disponibilité HTTPS **200**, JSON attendu, `no-store` et absence de cookie sur les deux origines. API Sauvegardes, Confidentialité et Fermetures **401 anonymes**. Entrée publique de l'application ouverte dans Chrome.

Les fermetures locales sont activées par la composition épinglée `start-local-closures`, qui transmet `accountClosures:true` jusqu'au serveur ; le superviseur n'annonce son démarrage qu'après IPC et disponibilité HTTP de l'enfant. Un GET administrateur authentifié n'a pas été observé dans ce navigateur. Aucun compte réel n'a été effacé pour valider, et aucune restauration de production n'est revendiquée. L'activation n'exige pas un nouveau test personnel.

## Pins à utiliser

| Élément | Valeur courante |
| --- | --- |
| Code exécuté | `bc6103a73ce63752eda27a0bce83a7e53e409d09` |
| Arbre | `39ac4fdabc55b7661742fbd6acc5763d65a42dab` |
| Checkout | `/srv/customer/jessiemessage-operator/messaging-final-079-bc6103a7` |
| Run Manager | `bash /srv/customer/jessiemessage-private/start-primary-messaging-079-bc6103a7.sh` |
| Lanceur | 0700 ; SHA-256 `4611fa20c46a5a56147a4d54ff319b5e93dd23396fd8fbc5e1bfcab5ebe68328` |
| Journal | `/srv/customer/jessiemessage-private/jm079-local-closures.log`, 0600 |
| Configuration | `/srv/customer/jessiemessage-private/primary-origin-candidate-4a355851` |
| Opérations | `/srv/customer/jessiemessage-private/recurring-backup-052` |

Port **3000 direct**, sans passerelle 3001 ni observateur C2. Garder `JESSIEMESSAGE_PRIVATE_PATH_MODE=linux-dirfd`. Les six configurations, clés, base, médias, sessions, destinataire GPG et cadence **05:15 UTC** sont réutilisés. Ne pas lancer un second parent depuis SSH, ni `capture --offline` pendant le service.

Préflight exact acquis le **19 octobre à 23:37:00.425105 UTC**, sans arrêt, capture ni effacement : `local_closure_precheck / passed`, `pendingClosures:false`, `started:false`, `erased:false`, `externalContinuityVerified:false`. Le lockfile ne diffère de 0.76 que par les deux versions racine ; dépendances existantes réutilisées et syntaxe 558 vérifiée sur l'hôte.

Checkpoint unique **0600** : `/srv/customer/jessiemessage-private/jm0702-existing-pc-update.json`. `activeService.release=0.79.0`, mode `start-local-closures`, `closuresEnabled:true` ; `developmentSimplification.s3.status=deployed_verified`. Les états S1 et les preuves datées S2 sont conservés ; aucun journal parallèle de reprise.

## Lots clos et limites V1

- **S1, 0.76 :** administration simplifiée, démarrage quotidien sans observateur, copies/moniteur/alertes conservés. [Preuves](verification-proofs/jm076-verification.json).
- **S2a/S2b, inclus dans 0.79 :** fermeture locale reprenable et outil manuel `check | restore | open`, cible isolée, réconciliation des comptes fermés, révocation des sessions et publication explicite sous maintenance. Qualifiés en CI native, sans restauration de production. [Composition](local-closures-manual-077.md), [guide opérateur](manual-restore-operator-078.md), [preuves S2a](verification-proofs/jm077-verification.json), [preuves S2b](verification-proofs/jm078-verification.json).
- **S3, 0.79 :** trois contextes Chrome indépendants sur vrai HTTPS/SQL/médias, statut réel de fermeture, guide/conservation/surveillance. Trois navigateurs ne prouvent pas toutes les plateformes physiques ni l'arrière-plan système/PWA ; aucune nouvelle recette générale n'est imposée.

Récupération autonome après perte complète de l'hôte, témoin frais par phase, succession de propriétaire et inventaire SQL exhaustif restent hors prérequis V1, sans garantie équivalente. Le profil de restauration reste `completeDatabase:false`, objets exécutables exclus. L'opérateur choisit un registre récent complet ; pas de garantie autonome après perte simultanée de l'hôte et de fermetures non copiées. Secours Infomaniak sur sept jours, fichiers/base non simultanés. Aucune rotation automatique des archives ajoutée.

La [surveillance](../MONITORING.md) conserve ses limites : moniteur local et mails de sauvegarde acceptés ; douze passages externes réussis observés, mais intervalles de plusieurs heures. Aucun délai maximal de détection ni réception d'une alerte externe attestée.

## Préserver PC, autorité et D1

- **PC, 19 octobre :** copie et déchiffrement acceptés, `DECHIFFREMENT_VERIFIE` à **16:34:19 UTC**, capture `1792386945745-204e0e8e073b6131`, GPG 402 552 octets, SHA-256 `c809dbfed6eabd2e8bde1a1d30a6cb11cbc99df720c0140935b3f2ae413690e5`. Mails de sauvegarde acceptés le 18 octobre. Aucun nouveau test personnel à refaire.
- Ne pas réapparier le PC, exporter/régénérer sa clé privée, supprimer sa configuration DPAPI, ses marqueurs ou son dossier `temoin`. Ne rejouer ni `plan-witness`, ni `prepare-witness`, ni `prepare-witness-enrollment`. La messagerie quotidienne ne dépend pas de la présence continue du PC.
- Autorité conservée sous `/srv/customer/jessiemessage-private/witness-origin-069-6b84f6e1`, fichiers 0600 : `contract/witness-genesis.json` original, SHA-256 `4fbdce199d70c1fd4b80f8ff249dae2666812b8ffc1c6912e8c50d1a042aaf10` ; `enrollment/witness-enrollment-origin.json` original, `817c6dca7735bb844d73066ebd3a711c46eb52cf5d5aabb5f4772171efc4b0c1` ; `enrollment/witness-enrollment.json` **spent, révision 2**, `445bc6c49bc0259284f2636f678e9073a833a2a4f60a992a6f87e5a3d1d7d35a`. Aucun retour à `ready`.
- **D1, 19 octobre :** base `fb4hmr_jm_restore_20261019`, opérateur `fb4hmr_jm_d19`, trente tables/migrations, six clés et quatre fichiers photo vérifiés ; `completeDatabase:false`. Conserver `restore-d19-checkpoint`, `restore-d19-quarantine`, reçus de `restore-d19-operator` et son marqueur bloquant `operational-restore.json`. Aucun réimport, rebind ou retrait de quarantaine. [Preuves](verification-proofs/jm-d19-isolated-restore.json).
- `recette.jessiemessage.com` partage runtime/base du principal : ce n'est pas une cible isolée de restauration ou d'effacement. D2 reste historiquement non qualifié (`shared_admin / raw_underscore_pattern`, métadonnées refusées, scheduler OFF distinct de DISABLED) ; ne pas le rouvrir comme préalable V1.

## Repli et prochaine action

Repli immédiat conservé : **0.76.0**, source `8abd205cc686f9a669511fd9d28b203ee4d4632a`, arbre `400e798cc51434d548690d4821cae665f5d14716`, checkout `/srv/customer/jessiemessage-operator/simple-backups-076-8abd205c`. Run `bash /srv/customer/jessiemessage-private/start-primary-simple-backups-076-8abd205c.sh`, 0700, SHA-256 `81302008fd2ace8a1a4450084ea8478aaf567684d225607b994401240f390482`. Commandes Manager exactes conservées dans `s3.deploymentProgress.rollback` du checkpoint. Aucun retour SQL ni suppression de journal ; la barrière refusera une intention inachevée. L'ancien repli 0.72 reste historique et conservé.

**Prochaine action : usage normal de la V1 privée et traitement des seuls incidents concrets.** Aucun nouveau lot technique, VPS, budget, questionnaire, mail de test ou appariement requis. Ne pas rouvrir les sauvegardes ou refaire D1/D2. Historique détaillé avant ce déploiement : [REPRISE feb0a6d](https://github.com/fredbuhr/jessiemessage/blob/feb0a6dafcd68662f908b129bfb952434308ebf1/docs/REPRISE.md), [historique du 19 octobre](REPRISE-HISTORIQUE-20261019.md).
