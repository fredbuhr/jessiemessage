# Reprendre JessieMessage

**20 octobre 2026 Europe/Paris — code `1.0.0` publié et fusionné ; tag/release et déploiement non réalisés ; production toujours `0.86.0`.** La V1 initiale a été clôturée et déployée. `1.0.0` en établit une référence de livraison explicite, sans intégrer l’évolution de lecture privée. La CI de la PR a réussi ses cinq jobs ; celle du commit de fusion est en cours. Ce fichier est l’unique état courant ; les [règles de travail](../AGENTS.md), le [périmètre produit](PRODUCT.md) et le [plan restant](PLAN-IMPLEMENTATION.md) y renvoient.

## État de livraison

| Élément | État constaté |
| --- | --- |
| Version applicative en production | `0.86.0` ; V1 clôturée le 20 octobre à 16:18:38 Paris. |
| Commit et arbre exécutés | `c61d1eecfefe786254416652877ba82d30cf4c90` / `78c8e46224503b0691b381bf07c5aefd51ca5c7f`. |
| Référence GitHub de départ | `main` `054291a6f346758fd0810241f2447be41a4c4933` avant harmonisation ; seuls CI, documentation et preuves différaient du runtime, pas le code applicatif. |
| Candidat de livraison `1.0.0` | Fusion `70b48aa845b70ca960724c8d37a6e94b3d5f47a8`, arbre `485cade0aeeee41cb4c34f913cd98f6078c4636b`, après la [PR 109](https://github.com/fredbuhr/jessiemessage/pull/109). L’arbre publié correspond exactement à la préparation locale. |
| Tag/release de production | Pas de livraison GitHub publiée matérialisant la clôture initiale ; tag immuable `v1.0.0` et release à créer sur le commit de fusion ci-dessus après sa CI verte. Un futur commit de documentation ne change pas cette cible. |
| Node applicatif | Officiel privé `24.22.0`, vérifié sur le service le 20 octobre à 16:41:34 Paris. Node système fournisseur intact. |
| Schéma applicatif | Trente tables/migrations ; aucune migration prévue par l’harmonisation. |
| Preuves de la référence existante | [Clôture 0.86](production-086.md), [qualification Node](node-runtime-086.md), CI Node [39439751937](https://github.com/fredbuhr/jessiemessage/actions/runs/39439751937) : 5/5 jobs réussis. |
| État de `1.0.0` | Métadonnées, documentation et identité de démarrage publiées et fusionnées ; CI PR 5/5 réussie, [CI du commit de fusion](https://github.com/fredbuhr/jessiemessage/actions/runs/39471679954) en cours. Tag/release, déploiement et vérification du processus restent à réaliser. |
| Évolution « Lecture privée » | Branche locale `feat/private-admin-read-receipts`, commit préparé `84860a332cc3e9444f968851df808e804b9be962`, initialement numéroté `0.87.0`, non publié/non déployé. À reporter après l’harmonisation pour préparer `1.1.0`. |

**Prochaine action :** terminer la connexion GitHub web nécessaire à la création du tag/release, constater la CI verte du commit de fusion, puis créer `v1.0.0` et sa release sur ce commit. Ensuite seulement, déployer le même commit sur le service existant avec repli, vérifier le processus et remplacer le présent état. La connexion web n’est pas établie au dernier relevé ; aucune livraison ni modification du service n’a été effectuée. Ne pas intégrer l’évolution de lecture privée à `1.0.0`.

## Validation locale de 1.0.0

Le build et le contrôle de syntaxe des **570 fichiers** réussissent. **135 tests ciblés** réussissent. La suite générale locale compte **3 141 tests : 2 924 réussis, trois échecs et 214 ignorés** ; les trois échecs sont des délais de `managed-runtime` observés sous concurrence dans cet environnement local. La relance isolée de `managed-runtime` et de l’identité de livraison réussit ensuite : **33/33, aucune omission**, sans modifier les délais ni les garde-fous. Cette relance ne transforme pas l’exécution générale en suite verte. Les prérequis natifs/SQL absents expliquent les omissions ; celles-ci ne valent pas validation. Ces résultats ne remplacent pas les preuves de la version en production.

La [CI de la PR 109](https://github.com/fredbuhr/jessiemessage/actions/runs/39470754751), sur `4c1b5a382811796af44e637c203d721465918fe0`, a réussi **5/5 jobs** : général **3 110 réussites, zéro échec, 35 ignorés**, MariaDB **10.11 et 11.4 : 466/466 chacune sans omission**, Chrome **164/164**, HTTPS/MariaDB **2/2**, syntaxe et build **570 fichiers**. La [CI main du commit de fusion](https://github.com/fredbuhr/jessiemessage/actions/runs/39471679954) contrôle ensuite `70b48aa845b70ca960724c8d37a6e94b3d5f47a8`, d’arbre identique ; son résultat final reste à constater. Aucun de ces contrôles ne prouve le déploiement de `1.0.0`.

## Preuves et réserves à conserver

La référence 0.86 a été qualifiée en CI : général 3 101 réussites/35 wrappers SQL ignorés, 466/466 sur chaque MariaDB 10.11 et 11.4 sans omission, Chrome 164/164, HTTPS/SQL 2/2, syntaxe 568/build. Le relevé du 20 octobre à 16:41:34 Paris confirme Node 24.22, moniteur OK et 26 HTTPS conformes sur les deux origines, dix empreintes sensibles et l’identité PC préservées. Ce sont les preuves de 0.86, pas celles de la future livraison 1.0.0. Aucun GET privé authentifié de production, appareil physique ou état PC n’a été qualifié par ces contrôles.

A01, dette du Node applicatif 24.15, a été corrigée par le Node privé 24.22. La maintenance de sécurité annoncée pour le 21 octobre ou après reste une publication future au relevé du 20 octobre ; aucune correction anticipée n’est revendiquée. Le [bilan Node daté](node-runtime-086.md) conserve sa portée.

A07 est **`blocked_by_avast_user_reported`**. Les captures utilisateur signalent deux exemplaires du script055 en quarantaine le 20 octobre à 12:03:44.019 UTC puis 12:12:52.625 UTC. Empreintes des fichiers inconnues ; fausse alerte seulement soupçonnée. Les copies PC peuvent être interrompues ; le reçu antérieur ne décrit pas leur état actuel. L’utilisateur a demandé de différer le traitement antivirus et de poursuivre la messagerie. Aucun nouvel appariement, test mail/PC, exclusion antivirus, manipulation de clé ou changement de l’artefact PC dans ce lot. [Incident et preuves](pc-antivirus-20261020.md).

A08 conserve avertissement et dry-run, sans exécuteur actif ni purge. Surveiller les seuils de **1 500 reçus ou 3 072 entrées** ; le diagnostic est dans les [preuves 0.81](verification-proofs/jm081-verification.json). Le budget média conserve ses limites : 1 Gio chiffré/50 000 objets non libérés, snapshot SQL de 100 000 lignes cumulées et dump brut de 64 Mio. L’harmonisation ne relève aucun de ces plafonds.

Les conversations sont conservées jusqu’à fermeture définitive, hors suppressions volontaires. Fermeture locale journalisée et restauration opérateur en maintenance restent le périmètre convenu. Récupération autonome après perte complète de l’hôte, témoin frais à chaque phase, succession et inventaire SQL exhaustif restent hors prérequis V1 ; `completeDatabase:false`, objets exécutables exclus. Pas de garantie de capture simultanée fichiers/base ni de perte maximale de vingt-quatre heures. La [surveillance](../MONITORING.md) conserve ses limites : pas de délai maximal de détection ni de réception externe attesté.

## Pins à utiliser

| Élément | Valeur courante |
| --- | --- |
| Code exécuté | `c61d1eecfefe786254416652877ba82d30cf4c90` |
| Arbre | `78c8e46224503b0691b381bf07c5aefd51ca5c7f` |
| Checkout | `/srv/customer/jessiemessage-operator/production-086-c61d1eec` |
| Run Manager | `bash /srv/customer/jessiemessage-private/start-primary-node2422-c61d1eec.sh` |
| Lanceur | 0700 ; SHA-256 `e54392621a7f63f7665f44c191783d467ccb214630e65449fb4ae57138cc9881` |
| Node applicatif | `/srv/customer/jessiemessage-private/runtime-node-v24.22.0/bin/node`, 0700 ; version 24.22.0 |
| Binaire Node SHA-256 | `67ca5783f8bb8bf85736c79fcdd92c8d6d465a0eb2a082672bcdfa76a6506751c` |
| Journal | `/srv/customer/jessiemessage-private/jm086-node2422.log`, 0600 |
| Configuration | `/srv/customer/jessiemessage-private/primary-origin-candidate-4a355851` |
| Opérations | `/srv/customer/jessiemessage-private/recurring-backup-052` |

Mode **`start-local-closures`**, `closuresEnabled:true`, port **3000 direct**, sans observateur/passerelle. Garder `JESSIEMESSAGE_PRIVATE_PATH_MODE=linux-dirfd`. Six configurations, clés, base, médias, sessions, destinataire GPG et cadence réutilisés. Ne pas lancer un second parent SSH ni `capture --offline` pendant le service.

Précontrôles du nouveau Node à **14:32:58.849424 UTC** : plateforme/JPEG/fichiers privés `checks_passed`, vrai décodeur photo fork normalisant PNG vers JPEG/vignette avec le binaire exact ; `local_closure_precheck/passed`, `pendingClosures:false`, `started:false`, `erased:false`, `externalContinuityVerified:false`. Dépendances verrouillées existantes réutilisées. Le lanceur vérifie SHA-256 et version Node avant `exec` ; le Build utilise également son chemin absolu. Utiliser ce Node pour toute commande opérateur JavaScript ; ne pas remplacer le binaire système.

Checkpoint unique **0600** : `/srv/customer/jessiemessage-private/jm0702-existing-pc-update.json`. `activeService.release=0.86.0`, `activeService.nodeAfterDeployment=v24.22.0` ; `developmentSimplification.nodeRuntimeUpdate.status=server_deployed_verified`. Repli opérationnel complet dans `.nodeRuntimeUpdate.rollback`, anciens `.productionClosure`/`.chatSendAck` historiques ; aucun journal parallèle ajouté. S1/S2/S3, PC, autorité et D1 préservés.

## Préserver PC, autorité et D1

- **PC, 19 octobre :** copie et déchiffrement acceptés, `DECHIFFREMENT_VERIFIE` à **16:34:19 UTC**, capture `1792386945745-204e0e8e073b6131`, GPG 402 552 octets, SHA-256 `c809dbfed6eabd2e8bde1a1d30a6cb11cbc99df720c0140935b3f2ae413690e5`. Mails acceptés le 18 octobre. Aucun nouveau test personnel à refaire.
- Ne pas réapparier le PC, exporter/régénérer sa clé privée, supprimer DPAPI, marqueurs ou dossier `temoin`. Ne rejouer ni `plan-witness`, ni `prepare-witness`, ni `prepare-witness-enrollment`. La messagerie quotidienne ne dépend pas du PC allumé.
- Autorité conservée sous `/srv/customer/jessiemessage-private/witness-origin-069-6b84f6e1`, fichiers 0600 : `contract/witness-genesis.json` original, SHA-256 `4fbdce199d70c1fd4b80f8ff249dae2666812b8ffc1c6912e8c50d1a042aaf10` ; `enrollment/witness-enrollment-origin.json` original, `817c6dca7735bb844d73066ebd3a711c46eb52cf5d5aabb5f4772171efc4b0c1` ; `enrollment/witness-enrollment.json` **spent, révision 2**, `445bc6c49bc0259284f2636f678e9073a833a2a4f60a992a6f87e5a3d1d7d35a`. Aucun retour à `ready`.
- **D1, 19 octobre :** base `fb4hmr_jm_restore_20261019`, opérateur `fb4hmr_jm_d19`, trente tables/migrations, six clés et quatre photos vérifiées ; `completeDatabase:false`. Conserver `restore-d19-checkpoint`, `restore-d19-quarantine`, reçus `restore-d19-operator` et marqueur bloquant `operational-restore.json`. Aucun réimport, rebind ni retrait de quarantaine. [Preuves](verification-proofs/jm-d19-isolated-restore.json).
- `recette.jessiemessage.com` partage runtime/base du principal : ce n’est pas une cible isolée. D2 reste historiquement non qualifié (`shared_admin / raw_underscore_pattern`, métadonnées refusées, scheduler OFF distinct de DISABLED) ; ne pas le rouvrir comme préalable V1.

## Repli de la référence existante

**Repli opérationnel Node :** ancien service 0.86, même source/arbre/checkout, Run `bash /srv/customer/jessiemessage-private/start-primary-production-086-c61d1eec.sh`, lanceur 0700 SHA-256 `3b5ac6ba42d802cabb9e7117d6d4c90408709d6b64b21a69ae0ff68ebb3c19cc`, journal `/srv/customer/jessiemessage-private/jm086-production.log` 0600. Son Node système **24.15.0 rouvrirait A01** ; ne pas le présenter comme un repli maintenant corrigé. Run/Build et ancien `activeService` complets dans `.nodeRuntimeUpdate.rollback`. Le repli applicatif 0.85 et tous ses pins restent dans `.productionClosure.rollback` et le [bilan antérieur](production-086.md). Aucun retour SQL ni suppression de journal.

## Historique et clôtures conservés

Les anciens lots restent clos dans leur portée : [S1](verification-proofs/jm076-verification.json), [S2a](verification-proofs/jm077-verification.json), [S2b](verification-proofs/jm078-verification.json), [S3/0.79](messaging-acceptance-079.md), [audit du 20 octobre](AUDIT-CODE-2026-10-20.md), [corrections 0.80](audit-corrections-080.md), [0.81](audit-corrections-081.md), [0.82](audit-corrections-082.md), [0.83](audit-corrections-083.md), [clôture des corrections](audit-closure-083.md), [0.84](service-status-084.md), [0.85](chat-send-ack-085.md), [clôture V1 0.86](production-086.md) et [mise à niveau Node](node-runtime-086.md). Leurs versions et heures ne sont pas réécrites. Les limites, dont la race C02 non reproduite, restent attachées à leurs preuves.

Le [relevé historique 0.83](verification-proofs/jm083-closure.json) est antérieur aux alertes Avast ; ses cinq archives, dix reçus et dernière copie concordante du 20 octobre 05:15 UTC ne prouvent pas le fonctionnement PC actuel. L’[historique du 19 octobre](REPRISE-HISTORIQUE-20261019.md) et l’[ancien journal](NEXT-STEPS.md) restent disponibles, sans prochaine action courante concurrente.
