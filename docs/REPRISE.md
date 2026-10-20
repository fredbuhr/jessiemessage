# Reprendre JessieMessage

**20 octobre 2026 Europe/Paris — production `1.1.0` inchangée, identité et checkpoint alignés ; profil et expressions `1.2.0` publiés, préparation Infomaniak confirmée, contrôle SQL initial en échec, diagnostic en lecture seule avant migration.** Les releases 1.1.1 et 1.2.0 sont vérifiées ; le reçu utilisateur confirme le staging des deux versions, sans migration 0031 ni activation 1.2.0. Ce fichier est l’unique état courant ; les [règles de travail](../AGENTS.md), le [périmètre produit](PRODUCT.md) et le [plan restant](PLAN-IMPLEMENTATION.md) y renvoient.

## État de livraison

| Élément | État constaté |
| --- | --- |
| Version active | **1.1.0**, confirmée par les quatre champs de l’administration transmis par l’utilisateur après le cycle Manager guidé et l’actualisation demandée. |
| Commit actif et arbre du commit | `84669ed570b59b10a1a94a164f24f0e60e6cb5a7` / `0201cdbd1932fd9104c04a91d63561010e8ae0c2`. Le commit affiché correspond exactement au tag livré. |
| Tag/release | [v1.1.0](https://github.com/fredbuhr/jessiemessage/releases/tag/v1.1.0), publiée le 20 octobre à 20:21:26 UTC ; cible relue identique. `main` peut avancer pour documenter les preuves. |
| Node actif | `v24.22.0`, valeur du processus dans le relevé admin. Node privé conservé ; binaire système fournisseur intact. |
| Capture au démarrage affichée | `20/10/2026 22:30:49`, texte utilisateur conservé. Fuseau du navigateur non transmis ; aucune conversion UTC ou naissance OS déduite. |
| Préparation et CI | Reçu utilisateur `staged_precheck_passed`, sans fermeture en attente, avant activation ; [CI du commit exact](https://github.com/fredbuhr/jessiemessage/actions/runs/39490336793) 5/5 réussie. |
| Disponibilité | Quatre GET publics santé/disponibilité conformes sur les deux origines à `2026-10-20T20:33:21.102792+00:00` : HTTP 200, JSON attendu, `no-store`, aucun cookie. Ils ne prouvent pas la version. |
| Portée | Jessie voit les reçus clients ; le client ne reçoit plus le curseur de lecture admin, API/export compris. Lectures propres et badges conservés. Aucune migration SQL ni dépendance nouvelle. |
| Preuves | [Bilan 1.1.0](private-read-receipts-110.md) et [relevé structuré](verification-proofs/jm110-verification.json). Lecture admin rapportée par l’utilisateur, pas de GET privé direct de l’agent ; aucun test sur des contenus clients réels. |
| Checkpoint privé | Aligné sur **1.1.0** / `84669ed5` : reçu utilisateur `release110_metadata_recorded`, `metadataOnly:true`, `noRestart:true`, `rollbackPreserved:true`, `otherBlocksPreserved:true`. |
| Repli immédiat | **1.0.0 / Node 24.22**, source `70b48aa845b70ca960724c8d37a6e94b3d5f47a8`, checkout et lanceur conservés ; détails ci-dessous et dans le bilan 1.1.0. |
| Nouvelle livraison | **[1.2.0 publiée](https://github.com/fredbuhr/jessiemessage/releases/tag/v1.2.0)** sur `763b632185ce13eb875110c9107687b2d278ff67`, arbre `c7dce7bcdb99b298ffc43c9e31dd22ee87453926` ; [PR 112](https://github.com/fredbuhr/jessiemessage/pull/112), [CI main exacte](https://github.com/fredbuhr/jessiemessage/actions/runs/39500108614) 5/5 et [publication vérifiée](https://github.com/fredbuhr/jessiemessage/actions/runs/39500847054). Profil, avatar et 180 emojis ; [bilan](profile-expressions-120.md). **Non déployée.** |
| Précondition de migration | [v1.1.1](https://github.com/fredbuhr/jessiemessage/releases/tag/v1.1.1) publiée sur `cfa7dd3559e51c0fdc63ccc6fbc78d98609b947a`, arbre `94b2fec5383fd948df7605b63f65a4e23078c2a1` ; [CI main exacte](https://github.com/fredbuhr/jessiemessage/actions/runs/39499262875) 5/5 et [publication vérifiée](https://github.com/fredbuhr/jessiemessage/actions/runs/39500076798). Repli compatible avec le schéma 31, **préparé** sur l’hébergement selon le reçu `staged_awaiting_schema31`, mais pas encore précontrôlé ni exécuté. Aucun changement de runtime ou de base ; `0031` non appliquée. |

**Étape en cours :** reprendre le contrôle SQL avec le diagnostic r2 pendant que le service reste ouvert. Le premier helper a échoué après la saisie avec `MIGRATION_STATUS_NOT_CONFIRMED` et `shell_check_line_63` : la cause reste inconnue ; ce résultat ne prouve pas un mot de passe erroné. Aucune migration ni activation n’a été exécutée par ce contrôle. La commande de préparation est déjà exécutée : ne pas la rejouer. Attendu : 31 migrations prévues, 30 appliquées, une en attente et aucun état interrompu. Après ce contrôle, guider l’arrêt Manager avant la DDL, la migration et les précontrôles. **Dès que 0031 est marquée en cours, ne pas redémarrer 1.1.0/1.0.0 ; le repli 1.1.1 exige un schéma 31 entièrement conforme.**

Le lot 1.1.0 reste clos : reçu SSH utilisateur `release110_metadata_recorded` sur le commit actif, `metadataOnly:true`, `noRestart:true`, `rollbackPreserved:true`, `otherBlocksPreserved:true`. Le [script exécuté](https://github.com/fredbuhr/jessiemessage/blob/fbe6b05f037326700228223ff0d25453af49659d/ops/record-release110.py), SHA-256 `eb10150761a513d3e08b6e9dcc22e8a2946cf5145c7cf02a3bc0197eb8b99591`, conserve l’ancien `activeService` 1.0.0 intégral sous `.developmentSimplification.release110.rollback`, avec son empreinte, et préserve notamment `release100`. [Reçu et portée](private-read-receipts-110.md#alignement-du-checkpoint--réalisé). Ne rejouer ni enregistrement, ni staging, ni Build, ni preuve admin déjà transmise. Les chantiers PC/sauvegardes restent différés.

La [publication GitHub](https://github.com/fredbuhr/jessiemessage/actions/runs/39491254060) a été réalisée avec le jeton temporaire GitHub Actions. Le navigateur cloud est indisponible (`native credential state cannot be safely resumed`) et aucun connecteur Infomaniak/SSH/SFTP utilisable n’a été trouvé. L’utilisateur exécute les commandes épinglées dans sa console SSH et utilise son navigateur habituel pour l’admin ; ne pas lui reproposer le navigateur cloud.

## Préparation de 1.2.0 — réalisée

Reçu SSH transmis par l’utilisateur : `staged_awaiting_schema31`, deux sources/arbres exacts, Node 24.22.0 et empreinte attendue, `started:false`, `migrated:false`, `precheckPassed:false`, `noRestart:true`, `managerChanged:false`, `checkpointChanged:false`. Le [script exécuté](https://github.com/fredbuhr/jessiemessage/blob/eaf702f69b56ba42a9c2c4fd144a33a18c3783d7/ops/prepare-release120.sh), SHA-256 `62aa7235bf8eb13b03af636770167fc8348b90c71ce9fb4a7691ac349e85fc29`, ne doit pas être rejoué. Le [relevé structuré](verification-proofs/jm120-verification.json) conserve les chemins, empreintes et limites du reçu.

| Version préparée | Checkout | Lanceur et empreinte SHA-256 |
| --- | --- | --- |
| Repli 1.1.1 | `/srv/customer/jessiemessage-operator/production-111-cfa7dd35` | `/srv/customer/jessiemessage-private/start-primary-release111-cfa7dd35.sh` — `8b73e7aeb2aae4da7d3e6d0a4f1257664b594fb9f914c34835cad9387842723c` |
| Cible 1.2.0 | `/srv/customer/jessiemessage-operator/production-120-763b6321` | `/srv/customer/jessiemessage-private/start-primary-release120-763b6321.sh` — `f846b72a252b69d881264da76b60025325b4e2262ef3a850f1f58ec61f5da84f` |

Lanceurs 0700, journaux 0600 vides. Les deux scripts `check-primary-release…` sont présents mais n’ont pas été exécutés. `rollback111Prepared:true` et `rollback111HostedQualified:false` : la préparation ne vaut pas qualification du runtime ou du schéma hébergé.

## Contrôle SQL avant migration — diagnostic r2 à exécuter

Le premier [helper](https://github.com/fredbuhr/jessiemessage/blob/9ba7a9a38a22812d4739892ea4b58d4a9258bd08/ops/status-release120-migration.sh) a été exécuté : contrôle non confirmé, sans DDL ni redémarrage. Son message global ne distinguait pas lecture privée, connexion et historique ; ne pas le relancer pour découvrir la cause.

Le [diagnostic r2 épinglé](https://github.com/fredbuhr/jessiemessage/blob/670b9efcd90cd97aaa8d21621e38bf770fb3d835/ops/status-release120-migration-r2.sh), SHA-256 `d89e16a9340a9f1ab41ae4838c74f0d1891b9218c2969fc2b91204c8a19df542`, conserve le lecteur privé, le plan et `run(status)` de 1.1.1. Son connecteur reprend `databaseOptions` et TLS vérifié ; seuls des codes d’erreur autorisés et une phase fixe sont renvoyés, jamais le message natif, SQL, mot de passe ou cible. L’écho du terminal est coupé avant le prompt secret, puis restauré. Syntaxe Bash/JS et **13 tests synthétiques** de diagnostic/TTY/confidentialité réussis ; le vrai validateur, lecteur de saisie, plan de 31 fichiers et migrateur passent aussi avec connexion/statut simulés et application DDL interdite. Le lecteur de fichier privé reste explicitement non vérifié dans ce sandbox dépourvu de `/proc/self/fd` ; ce manque local ne décrit pas l’hébergement.

```sh
python3 - <<'PY_STATUS'
import hashlib, subprocess, urllib.request
url = "https://raw.githubusercontent.com/fredbuhr/jessiemessage/670b9efcd90cd97aaa8d21621e38bf770fb3d835/ops/status-release120-migration-r2.sh"
code = urllib.request.urlopen(url, timeout=30).read()
if hashlib.sha256(code).hexdigest() != "d89e16a9340a9f1ab41ae4838c74f0d1891b9218c2969fc2b91204c8a19df542":
    raise SystemExit("Empreinte incorrecte : arrêt.")
raise SystemExit(subprocess.run(["bash", "-s"], input=code).returncode)
PY_STATUS
```

Le contrôle reprend host/port/base dans la configuration privée et demande seulement le nom puis le mot de passe du compte SQL de migration. Il ne crée ni table ni compte et ne redémarre rien. Ne transmettre au chat que le reçu neutre ; les identifiants restent dans la console personnelle. Ce contrôle confirme le moteur, TLS et l’historique, pas les droits DDL. Attendre `status:"checked"`, `migrations:31`, `applied:30`, `pending:1`, `interrupted:false`, `readOnly:true`, `migrated:false` et `noRestart:true`. Les champs source/version désignent l’outil 1.1.1, pas la version active du serveur. Si le statut est `migration_status_not_confirmed`, examiner les champs `phase` et `code` avant toute autre opération ; ne pas arrêter le service ni réinitialiser un mot de passe sur cette seule sortie.

Après le résultat attendu seulement : guider l’arrêt du service dans le Manager, puis `upgrade` avec le migrateur existant. La migration 0031 crée une table vide mais prend des verrous SQL ; le verrou migrateur seul n’exclut pas les écritures de l’application. Prévoir une coupure maîtrisée entre l’arrêt et l’activation. Après DDL, vérifier 31 migrations conformes puis les précontrôles 1.1.1/1.2.0 avant le Run 1.2.0. Toute migration interrompue ou erreur DDL exige une inspection, sans retour SQL automatique ni reprise de 1.1.0/1.0.0. Identité admin fraîche et alignement du checkpoint restent distincts. Aucun nouvel essai PC/Avast ni sauvegarde/restauration de production n’est ajouté.

## Validation de 1.2.0

[CI de PR](https://github.com/fredbuhr/jessiemessage/actions/runs/39498749684) et [CI du commit livré](https://github.com/fredbuhr/jessiemessage/actions/runs/39500108614) réussies 5/5 : général **3 177 réussis, zéro échec, 36 ignorés** ; MariaDB **10.11 et 11.4 : 479/479 chacune sans omission** ; Chrome **168/168**, HTTPS/MariaDB **3/3**, syntaxe et build **583 sources**. Le nouveau parcours réel confirme les deux profils, avatars propres/peers, refus intercompte, retrait et anciens liens invalidés, absence d’envoi automatique et lectures admin toujours privées. Les omissions générales ne valent pas qualification native. [Relevé structuré](verification-proofs/jm120-verification.json).

## Preuve d’identité et limites

La lecture admin fraîche, après **Actualiser la page**, renvoie le snapshot capturé par le processus HTTP répondant : version lue dans son package, Git HEAD/propreté/racine vérifiés au démarrage, `process.version` et instant de capture. API et fetch utilisent `no-store` ; le service worker n’intercepte aucun fetch. Les quatre valeurs reçues sont celles du tableau ci-dessus.

Les essais SSH historiques R1/R2 de la 1.0.0 ont renvoyé respectivement `PROCESS_NOT_UNIQUE` et `PROCESS_NOT_FOUND`, zéro correspondance stricte/canonique, douze processus propres lisibles, aucun illisible, aucun candidat. Ces vérifications restent non concluantes et ne sont pas transformées en succès. Le relevé admin est une preuve distincte de l’identité applicative, sans attestation de PID/socket, d’empreinte du binaire effectivement exécuté ou de fonctionnement PC/sauvegardes. La cause de l’absence de candidat SSH n’est pas établie et ne conditionne plus une identité déjà confirmée par HTTP admin.

## Build de la référence active

Commande de la référence 1.1.0 active ; aucun Build à relancer après l’identité déjà confirmée.

```sh
cd /srv/customer/jessiemessage-operator/production-110-84669ed5 &&
test "$(git rev-parse HEAD)" = 84669ed570b59b10a1a94a164f24f0e60e6cb5a7 &&
test "$(git rev-parse 'HEAD^{tree}')" = 0201cdbd1932fd9104c04a91d63561010e8ae0c2 &&
jm_build_status=$(git status --porcelain --untracked-files=normal) && test -z "$jm_build_status" &&
test "$(sha256sum /srv/customer/jessiemessage-private/runtime-node-v24.22.0/bin/node | cut -d ' ' -f 1)" = 67ca5783febb8bf85736c79fcdd92c8d6d465a0eb2a082672bcdfa76a506751c &&
env -u NODE_OPTIONS -u NODE_PATH /srv/customer/jessiemessage-private/runtime-node-v24.22.0/bin/node scripts/check-syntax.mjs
```

## Validation de 1.1.0

La [CI de la PR 110](https://github.com/fredbuhr/jessiemessage/actions/runs/39489455741) et celle du [commit exact livré](https://github.com/fredbuhr/jessiemessage/actions/runs/39490336793) ont réussi 5/5 jobs : général **3 116 réussis, zéro échec, 35 ignorés** ; MariaDB **10.11 et 11.4 : 468/468 chacune sans omission** ; Chrome **165/165**, HTTPS/MariaDB **2/2**, syntaxe et build **570 sources**. Les omissions générales ne constituent pas une qualification native ; SQL et Chrome ont leurs jobs distincts. Ces suites ne sont pas relancées pour un simple enregistrement de preuves. Le [bilan](private-read-receipts-110.md) conserve les tests locaux et leurs limites ; l’identité déployée est la preuve admin utilisateur ci-dessus, distincte de la CI.

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
| Code exécuté | `84669ed570b59b10a1a94a164f24f0e60e6cb5a7` |
| Arbre du commit | `0201cdbd1932fd9104c04a91d63561010e8ae0c2` |
| Checkout | `/srv/customer/jessiemessage-operator/production-110-84669ed5` |
| Run Manager | `bash /srv/customer/jessiemessage-private/start-primary-release110-84669ed5.sh` |
| Lanceur | 0700 ; SHA-256 au staging `4d28485da98fb33acdf0f50e2f420a43893f4c0c5495c068b6a6854de9e1cc8b` |
| Node applicatif | `/srv/customer/jessiemessage-private/runtime-node-v24.22.0/bin/node`, 0700 ; version 24.22.0 |
| Binaire Node SHA-256 au staging | `67ca5783febb8bf85736c79fcdd92c8d6d465a0eb2a082672bcdfa76a506751c`. Ce hash n’a pas été mesuré via le PID actif. |
| Journal | `/srv/customer/jessiemessage-private/jm110-node2422.log`, 0600 |
| Configuration | `/srv/customer/jessiemessage-private/primary-origin-candidate-4a355851` |
| Opérations | `/srv/customer/jessiemessage-private/recurring-backup-052` |
| Repli immédiat 1.0.0 | Source `70b48aa845b70ca960724c8d37a6e94b3d5f47a8`, arbre `485cade0aeeee41cb4c34f913cd98f6078c4636b`, checkout `/srv/customer/jessiemessage-operator/production-100-70b48aa8` ; Run `bash /srv/customer/jessiemessage-private/start-primary-release100-70b48aa8.sh`, lanceur SHA-256 `aa400abaa54033308acce7f4b28649b33d4ecc5f7098eec7b020c05631123248`. Même Node privé 24.22.0. [Build de repli](private-read-receipts-110.md#repli-immédiat--100). |

Mode **`start-local-closures`**, `closuresEnabled:true`, port **3000 direct**, sans observateur/passerelle. Garder `JESSIEMESSAGE_PRIVATE_PATH_MODE=linux-dirfd`. Six configurations, clés, base, médias, sessions, destinataire GPG et cadence réutilisés. Ne pas lancer un second parent SSH ni `capture --offline` pendant le service.

Précontrôles du nouveau Node à **14:32:58.849424 UTC** : plateforme/JPEG/fichiers privés `checks_passed`, vrai décodeur photo fork normalisant PNG vers JPEG/vignette avec le binaire exact ; `local_closure_precheck/passed`, `pendingClosures:false`, `started:false`, `erased:false`, `externalContinuityVerified:false`. Dépendances verrouillées existantes réutilisées. Le lanceur vérifie SHA-256 et version Node avant `exec` ; le Build utilise également son chemin absolu. Utiliser ce Node pour toute commande opérateur JavaScript ; ne pas remplacer le binaire système.

Checkpoint unique **0600** : `/srv/customer/jessiemessage-private/jm0702-existing-pc-update.json`. État enregistré **1.1.0** / `84669ed570b59b10a1a94a164f24f0e60e6cb5a7`, Node `v24.22.0`, statut `identity_verified_via_admin_report`. Reçu utilisateur `release110_metadata_recorded`, `metadataOnly:true`, `noRestart:true`, `rollbackPreserved:true`, `otherBlocksPreserved:true`. L’ancien `activeService` 1.0.0 complet est conservé sous `.developmentSimplification.release110.rollback`, avec son empreinte. `.developmentSimplification.release100` reste intact et conserve le repli historique 0.86/Node 24.22. `.nodeRuntimeUpdate.rollback` reste le repli historique Node 24.15 ; anciens `.productionClosure`/`.chatSendAck`, S1/S2/S3, PC, autorité et D1 sont préservés dans les autres blocs. Les anciennes preuves ne deviennent pas des observations fraîches de 1.1.0.

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
