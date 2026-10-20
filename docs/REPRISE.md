# Reprendre JessieMessage

**20 octobre 2026 Europe/Paris — `1.0.0` déployée, identité confirmée par le relevé administrateur utilisateur ; alignement du checkpoint privé encore à exécuter.** La V1 initiale est terminée. Cette livraison en établit la référence explicite, sans intégrer l’évolution de lecture privée. Ce fichier est l’unique état courant ; les [règles de travail](../AGENTS.md), le [périmètre produit](PRODUCT.md) et le [plan restant](PLAN-IMPLEMENTATION.md) y renvoient.

## État de livraison

| Élément | État constaté |
| --- | --- |
| Version active | **1.0.0**, confirmée par les quatre champs de l’administration transmis par l’utilisateur après actualisation. |
| Commit actif et arbre du commit | `70b48aa845b70ca960724c8d37a6e94b3d5f47a8` / `485cade0aeeee41cb4c34f913cd98f6078c4636b`. Le commit affiché par le processus correspond exactement au tag livré. |
| Tag/release | [v1.0.0](https://github.com/fredbuhr/jessiemessage/releases/tag/v1.0.0), publiée le 20 octobre à 20:22:02 Paris sur ce commit exact ; cible revérifiée. `main` peut avancer pour documenter les preuves. |
| Node actif | `v24.22.0`, valeur du processus dans le relevé admin. Node privé conservé ; binaire système fournisseur intact. |
| Capture au démarrage affichée | `20/10/2026 21:16:28`, texte utilisateur conservé. Fuseau du navigateur non transmis ; aucune conversion UTC ou naissance OS déduite. |
| Préparation et CI | `staged_precheck_passed`, sans fermeture en attente, avant activation ; [CI du commit exact](https://github.com/fredbuhr/jessiemessage/actions/runs/39471679954) 5/5 réussie. |
| Disponibilité | Quatre GET publics santé/disponibilité conformes sur les deux origines, recontrôlés après le relevé utilisateur. Ils ne prouvent pas la version. |
| Portée | Métadonnées, documentation et identité de démarrage ; aucun changement métier de messagerie, de dépendances ou de schéma SQL. |
| Preuves | [Bilan 1.0.0](production-100.md) et [relevé structuré](verification-proofs/jm100-verification.json). Lecture admin rapportée par l’utilisateur, pas de GET privé direct de l’agent. R1/R2 SSH restent non concluants. |
| Checkpoint privé | Décrit encore 0.86.0 ; script d’alignement des métadonnées publié et testé, reçu d’exécution attendu. Sa mise à jour n’est pas un redéploiement. |
| Évolution « Lecture privée » | Branche locale `feat/private-admin-read-receipts`, commit `84860a332cc3e9444f968851df808e804b9be962`, initialement 0.87.0 ; non publié/non déployé. À reporter sur la référence propre pour préparer 1.1.0 après cet alignement. |

**Prochaine action :** aligner le checkpoint privé existant avec le script opérateur épinglé, puis enregistrer son reçu. Le relevé admin attendu a été reçu : ne pas redemander les quatre champs ni répéter staging, Build ou scripts PID. Le script ne doit modifier que le checkpoint, en conservant tout l’historique et le repli 0.86/Node 24.22. L’harmonisation opérateur sera close après cette écriture constatée.

[Script de métadonnées épinglé](https://github.com/fredbuhr/jessiemessage/blob/002f26450a39b0fc937745f008e563efdb21ba66/ops/record-release100.py), SHA-256 `167ec69db5f6b86e85a4b437fbb6073aa21b523ab34f102993c4f4ace4fe13dd` : vérifie source/arbre propres et pins du lanceur/Node sur disque, puis conserve l’ancien `activeService` intégral sous `.developmentSimplification.release100.rollback`. La nouvelle identité explicite la provenance admin utilisateur et ses limites ; les autres blocs restent égaux. Écriture temporaire 0600, synchronisation, remplacement atomique et relecture ; répétition valide sans écriture. Verrou coopératif et contrôle des octets/métadonnées avant remplacement, sans garantie CAS universelle. **4/4 tests ciblés** réussis sur fichiers synthétiques ; aucun accès au vrai checkpoint pendant ces tests. Attendre `release100_metadata_recorded` ou `release100_metadata_already_recorded`, `rollbackPreserved:true` et `otherBlocksPreserved:true` avant clôture.

La [publication GitHub](https://github.com/fredbuhr/jessiemessage/actions/runs/39474081890) a été réalisée sans connexion web avec le jeton temporaire GitHub Actions. Le navigateur cloud est indisponible (`native credential state cannot be safely resumed`, y compris après réinitialisation) et aucun connecteur Infomaniak/SSH/SFTP utilisable n’a été trouvé. L’utilisateur exécute les commandes épinglées dans sa console SSH et utilise son navigateur habituel pour l’admin ; ne pas lui reproposer le navigateur cloud.

## Preuve d’identité et limites

La lecture admin fraîche, après **Actualiser la page**, renvoie le snapshot capturé par le processus HTTP répondant : version lue dans son package, Git HEAD/propreté/racine vérifiés au démarrage, `process.version` et instant de capture. API et fetch utilisent `no-store` ; le service worker n’intercepte aucun fetch. Les quatre valeurs reçues sont celles du tableau ci-dessus.

R1 a renvoyé `PROCESS_NOT_UNIQUE` ; R2 `PROCESS_NOT_FOUND`, zéro correspondance stricte/canonique, douze processus propres lisibles, aucun illisible, aucun candidat. Ces vérifications restent non concluantes et ne sont pas transformées en succès. Le relevé admin est une preuve distincte de l’identité applicative, sans attestation de PID/socket, d’empreinte du binaire effectivement exécuté ou de fonctionnement PC/sauvegardes. La cause de l’absence de candidat SSH n’est pas établie et ne conditionne plus une identité déjà confirmée par HTTP admin.

## Build de la référence active

Commande documentée pour le service existant ; aucun Build à relancer pour enregistrer les métadonnées du checkpoint.

```sh
cd /srv/customer/jessiemessage-operator/production-100-70b48aa8 &&
test "$(git rev-parse HEAD)" = 70b48aa845b70ca960724c8d37a6e94b3d5f47a8 &&
test "$(git rev-parse 'HEAD^{tree}')" = 485cade0aeeee41cb4c34f913cd98f6078c4636b &&
jm_build_status=$(git status --porcelain --untracked-files=normal) && test -z "$jm_build_status" &&
test "$(sha256sum /srv/customer/jessiemessage-private/runtime-node-v24.22.0/bin/node | cut -d ' ' -f 1)" = 67ca5783febb8bf85736c79fcdd92c8d6d465a0eb2a082672bcdfa76a506751c &&
env -u NODE_OPTIONS -u NODE_PATH /srv/customer/jessiemessage-private/runtime-node-v24.22.0/bin/node scripts/check-syntax.mjs
```

## Validation locale de 1.0.0

Le build et le contrôle de syntaxe des **570 fichiers** réussissent. **135 tests ciblés** réussissent. La suite générale locale compte **3 141 tests : 2 924 réussis, trois échecs et 214 ignorés** ; les trois échecs sont des délais de `managed-runtime` observés sous concurrence dans cet environnement local. La relance isolée de `managed-runtime` et de l’identité de livraison réussit ensuite : **33/33, aucune omission**, sans modifier les délais ni les garde-fous. Cette relance ne transforme pas l’exécution générale en suite verte. Les prérequis natifs/SQL absents expliquent les omissions ; celles-ci ne valent pas validation. Ces résultats ne remplacent pas les preuves de la version en production.

La [CI de la PR 109](https://github.com/fredbuhr/jessiemessage/actions/runs/39470754751), sur `4c1b5a382811796af44e637c203d721465918fe0`, a réussi **5/5 jobs** : général **3 110 réussites, zéro échec, 35 ignorés**, MariaDB **10.11 et 11.4 : 466/466 chacune sans omission**, Chrome **164/164**, HTTPS/MariaDB **2/2**, syntaxe et build **570 fichiers**. La [CI main du commit de fusion](https://github.com/fredbuhr/jessiemessage/actions/runs/39471679954) a également réussi **5/5 jobs** sur `70b48aa845b70ca960724c8d37a6e94b3d5f47a8`, d’arbre identique. La CI qualifie ce code ; la preuve distincte de l’identité déployée est le relevé admin utilisateur consigné dans le bilan 1.0.0.

## Preuves et réserves à conserver

La référence 0.86 a été qualifiée en CI : général 3 101 réussites/35 wrappers SQL ignorés, 466/466 sur chaque MariaDB 10.11 et 11.4 sans omission, Chrome 164/164, HTTPS/SQL 2/2, syntaxe 568/build. Le relevé du 20 octobre à 16:41:34 Paris confirme Node 24.22, moniteur OK et 26 HTTPS conformes sur les deux origines, dix empreintes sensibles et l’identité PC préservées. Ce sont les preuves historiques de 0.86, distinctes du relevé d’identité 1.0.0 ci-dessus. Aucun GET privé authentifié de production, appareil physique ou état PC n’a été qualifié par ces contrôles.

A01, dette du Node applicatif 24.15, a été corrigée par le Node privé 24.22. La maintenance de sécurité annoncée pour le 21 octobre ou après reste une publication future au relevé du 20 octobre ; aucune correction anticipée n’est revendiquée. Le [bilan Node daté](node-runtime-086.md) conserve sa portée.

A07 est **`blocked_by_avast_user_reported`**. Les captures utilisateur signalent deux exemplaires du script055 en quarantaine le 20 octobre à 12:03:44.019 UTC puis 12:12:52.625 UTC. Empreintes des fichiers inconnues ; fausse alerte seulement soupçonnée. Les copies PC peuvent être interrompues ; le reçu antérieur ne décrit pas leur état actuel. L’utilisateur a demandé de différer le traitement antivirus et de poursuivre la messagerie. Aucun nouvel appariement, test mail/PC, exclusion antivirus, manipulation de clé ou changement de l’artefact PC dans ce lot. [Incident et preuves](pc-antivirus-20261020.md).

A08 conserve avertissement et dry-run, sans exécuteur actif ni purge. Surveiller les seuils de **1 500 reçus ou 3 072 entrées** ; le diagnostic est dans les [preuves 0.81](verification-proofs/jm081-verification.json). Le budget média conserve ses limites : 1 Gio chiffré/50 000 objets non libérés, snapshot SQL de 100 000 lignes cumulées et dump brut de 64 Mio. L’harmonisation ne relève aucun de ces plafonds.

Les conversations sont conservées jusqu’à fermeture définitive, hors suppressions volontaires. Fermeture locale journalisée et restauration opérateur en maintenance restent le périmètre convenu. Récupération autonome après perte complète de l’hôte, témoin frais à chaque phase, succession et inventaire SQL exhaustif restent hors prérequis V1 ; `completeDatabase:false`, objets exécutables exclus. Pas de garantie de capture simultanée fichiers/base ni de perte maximale de vingt-quatre heures. La [surveillance](../MONITORING.md) conserve ses limites : pas de délai maximal de détection ni de réception externe attesté.

## Pins à utiliser

| Élément | Valeur courante |
| --- | --- |
| Code exécuté | `70b48aa845b70ca960724c8d37a6e94b3d5f47a8` |
| Arbre du commit | `485cade0aeeee41cb4c34f913cd98f6078c4636b` |
| Checkout | `/srv/customer/jessiemessage-operator/production-100-70b48aa8` |
| Run Manager | `bash /srv/customer/jessiemessage-private/start-primary-release100-70b48aa8.sh` |
| Lanceur | 0700 ; SHA-256 au staging `aa400abaa54033308acce7f4b28649b33d4ecc5f7098eec7b020c05631123248` |
| Node applicatif | `/srv/customer/jessiemessage-private/runtime-node-v24.22.0/bin/node`, 0700 ; version 24.22.0 |
| Binaire Node SHA-256 au staging | `67ca5783febb8bf85736c79fcdd92c8d6d465a0eb2a082672bcdfa76a506751c`. Remplace l’ancienne transcription invalide ; ce hash n’a pas été mesuré via le PID actif. |
| Journal | `/srv/customer/jessiemessage-private/jm100-node2422.log`, 0600 |
| Configuration | `/srv/customer/jessiemessage-private/primary-origin-candidate-4a355851` |
| Opérations | `/srv/customer/jessiemessage-private/recurring-backup-052` |
| Repli immédiat | 0.86/Node 24.22 : checkout `/srv/customer/jessiemessage-operator/production-086-c61d1eec`, source `c61d1eecfefe786254416652877ba82d30cf4c90`, arbre `78c8e46224503b0691b381bf07c5aefd51ca5c7f` ; Run `bash /srv/customer/jessiemessage-private/start-primary-node2422-c61d1eec.sh`, SHA-256 `e54392621a7f63f7665f44c191783d467ccb214630e65449fb4ae57138cc9881`. Build associé et détails dans le [bilan](production-100.md#repli-immédiat-conservé). |

Mode **`start-local-closures`**, `closuresEnabled:true`, port **3000 direct**, sans observateur/passerelle. Garder `JESSIEMESSAGE_PRIVATE_PATH_MODE=linux-dirfd`. Six configurations, clés, base, médias, sessions, destinataire GPG et cadence réutilisés. Ne pas lancer un second parent SSH ni `capture --offline` pendant le service.

Précontrôles du nouveau Node à **14:32:58.849424 UTC** : plateforme/JPEG/fichiers privés `checks_passed`, vrai décodeur photo fork normalisant PNG vers JPEG/vignette avec le binaire exact ; `local_closure_precheck/passed`, `pendingClosures:false`, `started:false`, `erased:false`, `externalContinuityVerified:false`. Dépendances verrouillées existantes réutilisées. Le lanceur vérifie SHA-256 et version Node avant `exec` ; le Build utilise également son chemin absolu. Utiliser ce Node pour toute commande opérateur JavaScript ; ne pas remplacer le binaire système.

Checkpoint unique **0600** : `/srv/customer/jessiemessage-private/jm0702-existing-pc-update.json`. Dernier état enregistré `activeService.release=0.86.0`, `activeService.nodeAfterDeployment=v24.22.0` ; alignement 1.0.0 encore à exécuter. L’écriture doit conserver l’ancien `activeService` complet comme repli immédiat 0.86/Node 24.22 dans `.developmentSimplification.release100.rollback`. `.nodeRuntimeUpdate.rollback` reste le repli historique Node 24.15 et ne doit pas être réécrit ; anciens `.productionClosure`/`.chatSendAck`, S1/S2/S3, PC, autorité et D1 préservés. Les anciennes preuves ne deviennent pas des observations fraîches de 1.0.0.

## Préserver PC, autorité et D1

- **PC, 19 octobre :** copie et déchiffrement acceptés, `DECHIFFREMENT_VERIFIE` à **16:34:19 UTC**, capture `1792386945745-204e0e8e073b6131`, GPG 402 552 octets, SHA-256 `c809dbfed6eabd2e8bde1a1d30a6cb11cbc99df720c0140935b3f2ae413690e5`. Mails acceptés le 18 octobre. Aucun nouveau test personnel à refaire.
- Ne pas réapparier le PC, exporter/régénérer sa clé privée, supprimer DPAPI, marqueurs ou dossier `temoin`. Ne rejouer ni `plan-witness`, ni `prepare-witness`, ni `prepare-witness-enrollment`. La messagerie quotidienne ne dépend pas du PC allumé.
- Autorité conservée sous `/srv/customer/jessiemessage-private/witness-origin-069-6b84f6e1`, fichiers 0600 : `contract/witness-genesis.json` original, SHA-256 `4fbdce199d70c1fd4b80f8ff249dae2666812b8ffc1c6912e8c50d1a042aaf10` ; `enrollment/witness-enrollment-origin.json` original, `817c6dca7735bb844d73066ebd3a711c46eb52cf5d5aabb5f4772171efc4b0c1` ; `enrollment/witness-enrollment.json` **spent, révision 2**, `445bc6c49bc0259284f2636f678e9073a833a2a4f60a992a6f87e5a3d1d7d35a`. Aucun retour à `ready`.
- **D1, 19 octobre :** base `fb4hmr_jm_restore_20261019`, opérateur `fb4hmr_jm_d19`, trente tables/migrations, six clés et quatre photos vérifiées ; `completeDatabase:false`. Conserver `restore-d19-checkpoint`, `restore-d19-quarantine`, reçus `restore-d19-operator` et marqueur bloquant `operational-restore.json`. Aucun réimport, rebind ni retrait de quarantaine. [Preuves](verification-proofs/jm-d19-isolated-restore.json).
- `recette.jessiemessage.com` partage runtime/base du principal : ce n’est pas une cible isolée. D2 reste historiquement non qualifié (`shared_admin / raw_underscore_pattern`, métadonnées refusées, scheduler OFF distinct de DISABLED) ; ne pas le rouvrir comme préalable V1.

## Repli historique Node 24.15

**Repli opérationnel Node :** ancien service 0.86, même source/arbre/checkout, Run `bash /srv/customer/jessiemessage-private/start-primary-production-086-c61d1eec.sh`, lanceur 0700 SHA-256 `3b5ac6ba42d802cabb9e7117d6d4c90408709d6b64b21a69ae0ff68ebb3c19cc`, journal `/srv/customer/jessiemessage-private/jm086-production.log` 0600. Son Node système **24.15.0 rouvrirait A01** ; ne pas le présenter comme un repli maintenant corrigé. Run/Build et ancien `activeService` complets dans `.nodeRuntimeUpdate.rollback`. Le repli applicatif 0.85 et tous ses pins restent dans `.productionClosure.rollback` et le [bilan antérieur](production-086.md). Aucun retour SQL ni suppression de journal.

## Historique et clôtures conservés

Les anciens lots restent clos dans leur portée : [S1](verification-proofs/jm076-verification.json), [S2a](verification-proofs/jm077-verification.json), [S2b](verification-proofs/jm078-verification.json), [S3/0.79](messaging-acceptance-079.md), [audit du 20 octobre](AUDIT-CODE-2026-10-20.md), [corrections 0.80](audit-corrections-080.md), [0.81](audit-corrections-081.md), [0.82](audit-corrections-082.md), [0.83](audit-corrections-083.md), [clôture des corrections](audit-closure-083.md), [0.84](service-status-084.md), [0.85](chat-send-ack-085.md), [clôture V1 0.86](production-086.md) et [mise à niveau Node](node-runtime-086.md). Leurs versions et heures ne sont pas réécrites. Les limites, dont la race C02 non reproduite, restent attachées à leurs preuves.

Le [relevé historique 0.83](verification-proofs/jm083-closure.json) est antérieur aux alertes Avast ; ses cinq archives, dix reçus et dernière copie concordante du 20 octobre 05:15 UTC ne prouvent pas le fonctionnement PC actuel. L’[historique du 19 octobre](REPRISE-HISTORIQUE-20261019.md) et l’[ancien journal](NEXT-STEPS.md) restent disponibles, sans prochaine action courante concurrente.
