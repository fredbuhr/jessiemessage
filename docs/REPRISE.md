# Reprendre JessieMessage

**21 octobre 2026 Europe/Paris — production `1.3.0`, identité confirmée par relevé admin utilisateur et disponibilité publique conforme ; checkpoint privé aligné sur 1.3.0 sans redémarrage ; lot clos.** Le schéma 31 est inchangé ; la 1.2.0 est conservée comme repli immédiat et la 1.1.1 compatible comme secours. Ce fichier est l’unique état courant ; les [règles de travail](../AGENTS.md), le [périmètre produit](PRODUCT.md) et le [plan restant](PLAN-IMPLEMENTATION.md) y renvoient.

## Travail en cours — correctif mobile 1.3.1

Implémentation sur la branche `fix/chat-mobile-131` : barre de conversation compacte, actions secondaires dans les options, composeur sur une rangée et hauteur du fil adaptée au viewport visible. Les contrôles de contexte, les dialogues, les erreurs et les brouillons existants sont conservés. [Périmètre et critères](chat-mobile-131.md). 147 tests ciblés réussis sans omission, build local 583 sources et syntaxe finale ciblée réussis. La revue du diff a fait corriger le rognage du panneau « + ». Chrome reste à qualifier en CI ; fusion et publication restent à accomplir. [Preuves 1.3.1](verification-proofs/jm131-verification.json). Aucune activation 1.3.1 n’est revendiquée. La production reste la 1.3.0 close ci-dessous. Aucune nouvelle manipulation opérateur n’est attendue pendant ce développement.

## Livraison active 1.3.0 — close

**Codée, fusionnée, publiée, précontrôlée, active et enregistrée dans le checkpoint privé ; lot clos.** La [PR 113](https://github.com/fredbuhr/jessiemessage/pull/113) livre 268 choix Unicode et cinq carnations sur 61 choix compatibles. Source `afd0e98cdb4027ac4cb444ddb05afeda0a84fb6b`, arbre `37b3b2e9358972c95581fc0bcf16896e4074d5f9`, [tag/release v1.3.0](https://github.com/fredbuhr/jessiemessage/releases/tag/v1.3.0) publiés le `2026-10-20T23:36:15Z`. [CI PR](https://github.com/fredbuhr/jessiemessage/actions/runs/39514681589) et [CI main exacte](https://github.com/fredbuhr/jessiemessage/actions/runs/39515366616) réussies 5/5 : général 3 181 réussis, zéro échec, 36 ignorés ; MariaDB 10.11/11.4 479/479 chacune sans omission ; Chrome 169/169 et HTTPS/MariaDB 3/3 sans omission ; syntaxe/build 583 sources. [Publication contrôlée](https://github.com/fredbuhr/jessiemessage/actions/runs/39516082828). [Bilan](emoji-inclusifs-130.md) et [preuves](verification-proofs/jm130-verification.json).

**Activation acquise :** l’utilisateur a transmis `1.3.0` / `afd0e98cdb4027ac4cb444ddb05afeda0a84fb6b` / `v24.22.0` et le relevé au démarrage `21/10/2026 01:50:02`. Cet affichage est conservé exactement ; le fuseau du navigateur n’a pas été fourni, aucune conversion UTC ou epoch n’est déduite. La lecture admin rapportée confirme l’identité du processus HTTP répondant ; ce n’est pas une observation privée directe de l’agent ni une attestation PID/socket/empreinte du binaire actif. **Ne plus demander Build, Run, redémarrage ou relevé admin pour cette activation.** Aucun changement SQL ou de dépendances. Aucune illustration Flirtmoji récupérée : les droits de réhéberger leur catalogue ne sont pas établis par les conditions publiques.

**Préparation hébergée historique :** le reçu SSH utilisateur `staged_precheck_passed` confirme source/arbre exacts, Node 24.22.0 et empreinte attendue, schéma 31 identique, `pendingClosures:false`, `started:false`, `migrated:false`, `managerChanged:false`, `runtimeStarted:false`, `checkpointChanged:false` lors de la préparation. Le [helper exécuté](https://github.com/fredbuhr/jessiemessage/blob/3e327d29c653b8e82eeb393046ba6271790f0c35/ops/prepare-release130.sh), SHA-256 `b38ad31c4838415632774877d9cd0529522cb5b617c70a970375379bc781af3b`, a conservé le repli 1.2.0 ; ses 15 tests synthétiques précèdent l’exécution hébergée. Les chemins, empreintes, modes et journaux restent dans les [preuves](verification-proofs/jm130-verification.json). Les valeurs `false` de ce reçu décrivent la préparation, pas l’état après activation. Ne pas le rejouer.

**Alignement final acquis :** le reçu SSH transmis par l’utilisateur confirme l’exécution du [writer 1.3.0 épinglé](https://github.com/fredbuhr/jessiemessage/blob/5d251756a3249dc08127a161942963999e9a5bf5/ops/record-release130.py), SHA-256 `26dada8bec1dfbf1ec852cdd118e202fd4fd2c56c98c9c0b02c45095fff5a61e` :

```json
{"status":"release130_metadata_recorded","source":"afd0e98cdb4027ac4cb444ddb05afeda0a84fb6b","version":"1.3.0","metadataOnly":true,"noRestart":true,"rollbackPreserved":true,"rollbackRelease":"1.2.0","schemaMigrations":31,"priorActivePreserved":true,"otherBlocksPreserved":true}
```

Ses **9 tests synthétiques** précèdent cette exécution et restent distincts du reçu serveur. L’ancien `activeService` 1.2.0 intégral et ses empreintes sont conservés comme état antérieur et repli utilisable sous `.developmentSimplification.release130` ; les autres blocs, dont le secours 1.1.1 et les historiques, sont préservés. L’alignement n’a exécuté ni migration, ni Build, ni redémarrage. L’agent n’a pas d’accès SSH utilisable et n’a pas observé directement le checkpoint privé. **Ne rejouer ni writer, ni staging, ni Build/Run, ni redémarrage, ni relevé admin pour clore la 1.3.0 : cette clôture est acquise.**

**Prochaine étape autorisée, non implémentée :** le [correctif messagerie mobile 1.3.1](chat-mobile-131.md), distinct de cette livraison et prioritaire avant les diffusions à grande échelle. Aucune nouvelle opération utilisateur n’est attendue pour la 1.3.0.

## État de livraison courant

Accès opérateur conservés : [réglages Run/Build](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/h3/118579/nodejs/239143/data/advanced-settings/application), [tableau de bord Node.js](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/h3/118579/nodejs/239143/data/dashboard) et [État du service Jessie](https://jessiemessage.com/admin/readiness). Le Manager nomme l’application Node.js **recette.jessiemessage.com** ; **jessiemessage.com** est un alias du même runtime. Le site PHP **accueil.jessiemessage.com**, site 1532641, est distinct : les réglages Node.js concernent l’application **239143** liée ici. Aucun de ces réglages n’est à modifier pour enregistrer les métadonnées.

| Élément | État constaté |
| --- | --- |
| Version active | **1.3.0**, confirmée par les quatre champs admin transmis par l’utilisateur. |
| Commit actif et arbre du commit | `afd0e98cdb4027ac4cb444ddb05afeda0a84fb6b` / `37b3b2e9358972c95581fc0bcf16896e4074d5f9`. Le commit affiché correspond au tag livré. |
| Tag/release | [v1.3.0](https://github.com/fredbuhr/jessiemessage/releases/tag/v1.3.0), publiée le `2026-10-20T23:36:15Z`, cible vérifiée. |
| Node HTTP identifié | `v24.22.0`, valeur du processus dans le relevé admin utilisateur. |
| Capture au démarrage affichée | `21/10/2026 01:50:02`, texte exact sans fuseau transmis ; aucune conversion UTC, epoch ou naissance OS déduite. |
| Schéma et précontrôle | Schéma 31 inchangé ; `staged_precheck_passed` hébergé, sans migration. |
| CI et publication | CI PR/main 5/5, source exacte `afd0e98c` ; liens et compteurs ci-dessus. |
| Disponibilité | **4/4** GET publics conformes sur les deux origines à `2026-10-21T00:05:53.651600+00:00` : TLS vérifié, HTTP 200, JSON exact `ok`/`ready`, `no-store`, aucun cookie, aucune redirection. Ces GET attestent la disponibilité, pas la version. |
| Portée et preuves | Emojis enrichis/inclusifs ; profils, avatars et lectures privées conservés. [Bilan 1.3.0](emoji-inclusifs-130.md), [preuves structurées](verification-proofs/jm130-verification.json). |
| Checkpoint privé | **1.3.0** / `afd0e98c`, schéma 31 ; reçu utilisateur `release130_metadata_recorded`, `metadataOnly:true`, `noRestart:true`, ancien état 1.2.0, repli 1.2.0 et autres blocs préservés. |
| Replis conservés | **1.2.0 / Node 24.22** immédiat ; **1.1.1 / Node 24.22** compatible schéma 31 comme secours précontrôlé. **1.1.0 et 1.0.0 ne doivent plus être redémarrées sur le schéma 31.** |

## État historique de la livraison 1.2.0 — clos

| Élément | État constaté à la clôture 1.2.0 |
| --- | --- |
| Version active à cette clôture | **1.2.0**, confirmée par les quatre champs admin transmis par l’utilisateur après démarrage Manager. |
| Commit actif à cette clôture et arbre du commit | `763b632185ce13eb875110c9107687b2d278ff67` / `c7dce7bcdb99b298ffc43c9e31dd22ee87453926`. Le commit affiché correspond au tag livré. |
| Tag/release | [v1.2.0](https://github.com/fredbuhr/jessiemessage/releases/tag/v1.2.0), publiée le 20 octobre à 21:30:07 UTC ; cible relue identique. |
| Node HTTP identifié | `v24.22.0`, valeur du processus dans le relevé admin utilisateur. |
| Capture au démarrage historique | `21/10/2026 00:21:24`, texte utilisateur conservé. Fuseau du navigateur non transmis ; aucune conversion UTC, epoch ou naissance OS déduite. |
| Schéma et précontrôles | Migration 0031 appliquée ; reçus `schema31_confirmed_before_prechecks` et `schema31_prechecks_passed`. Précontrôles 1.1.1/1.2.0 réussis. |
| CI et publication | [CI main exacte](https://github.com/fredbuhr/jessiemessage/actions/runs/39500108614) 5/5, [publication vérifiée](https://github.com/fredbuhr/jessiemessage/actions/runs/39500847054), [PR 112](https://github.com/fredbuhr/jessiemessage/pull/112). |
| Disponibilité | Quatre GET publics conformes sur les deux origines à `2026-10-20T22:24:58.673794+00:00` : HTTP 200, JSON exact `ok`/`ready`, `no-store`, aucun cookie, TLS vérifié et redirections refusées. Le premier essai réseau partiel est conservé ; ces GET ne prouvent pas la version. |
| Portée et preuves | Profil, avatar et 180 emojis ; lecture privée conservée. [Bilan 1.2.0](profile-expressions-120.md), [preuves structurées](verification-proofs/jm120-verification.json). Identité admin rapportée par l’utilisateur, sans GET privé direct de l’agent ni attestation PID/socket/binaire. |
| Checkpoint privé | **1.2.0** / `763b6321`, reçu utilisateur `release120_metadata_recorded`, `metadataOnly:true`, `noRestart:true` ; repli 1.1.1, ancien état intégral et autres blocs préservés. |
| Repli compatible | **1.1.1 / Node 24.22**, source `cfa7dd3559e51c0fdc63ccc6fbc78d98609b947a`, arbre `94b2fec5383fd948df7605b63f65a4e23078c2a1`, précontrôlé sur l’hébergement et non démarré. **1.1.0 et 1.0.0 ne doivent plus être redémarrées sur le schéma 31.** |

**Lot 1.2.0 clos :** le reçu utilisateur `release120_metadata_recorded` confirme l’alignement sur le commit actif, schéma 31, `metadataOnly:true`, `noRestart:true`, `rollbackRelease:1.1.1`, `rollbackPreserved:true`, `priorActivePreserved:true`, `otherBlocksPreserved:true`. L’ancien `activeService` 1.1.0 est archivé intégralement avec empreinte sous `.developmentSimplification.release120.priorActiveService`, `priorActiveServiceUsableRollback:false` ; le repli utilisable reste la 1.1.1 compatible précontrôlée, sans démarrage HTTP rapporté. [Reçu et portée](profile-expressions-120.md#alignement-du-checkpoint--réalisé). **Ne rejouer ni enregistrement, ni staging, ni migration, ni Build, ni Run, ni preuve admin.** L’évolution **3 — Diffusions à grande échelle** reste planifiée après la clôture 1.3.0 puis le correctif mobile 1.3.1 ; elle n’est pas encore ouverte.

Le lot 1.1.0 reste clos : reçu SSH utilisateur `release110_metadata_recorded` sur le commit 1.1.0 historique, `metadataOnly:true`, `noRestart:true`, `rollbackPreserved:true`, `otherBlocksPreserved:true`. Le [script exécuté](https://github.com/fredbuhr/jessiemessage/blob/fbe6b05f037326700228223ff0d25453af49659d/ops/record-release110.py), SHA-256 `eb10150761a513d3e08b6e9dcc22e8a2946cf5145c7cf02a3bc0197eb8b99591`, conserve l’ancien `activeService` 1.0.0 intégral sous `.developmentSimplification.release110.rollback`, avec son empreinte, et préserve notamment `release100`. [Reçu et portée](private-read-receipts-110.md#alignement-du-checkpoint--réalisé). Ne rejouer ni enregistrement, ni staging, ni Build, ni preuve admin déjà transmise. Les chantiers PC/sauvegardes restent différés.

La [publication GitHub historique de 1.1.0](https://github.com/fredbuhr/jessiemessage/actions/runs/39491254060) a été réalisée avec le jeton temporaire GitHub Actions. Le navigateur cloud est indisponible (`native credential state cannot be safely resumed`) et aucun connecteur Infomaniak/SSH/SFTP utilisable n’a été trouvé. L’utilisateur exécute les commandes épinglées dans sa console SSH et utilise son navigateur habituel pour l’admin ; ne pas lui reproposer le navigateur cloud.

## Historique — préparation de 1.2.0 réalisée

Reçu SSH transmis par l’utilisateur : `staged_awaiting_schema31`, deux sources/arbres exacts, Node 24.22.0 et empreinte attendue, `started:false`, `migrated:false`, `precheckPassed:false`, `noRestart:true`, `managerChanged:false`, `checkpointChanged:false`. Le [script exécuté](https://github.com/fredbuhr/jessiemessage/blob/eaf702f69b56ba42a9c2c4fd144a33a18c3783d7/ops/prepare-release120.sh), SHA-256 `62aa7235bf8eb13b03af636770167fc8348b90c71ce9fb4a7691ac349e85fc29`, ne doit pas être rejoué. Le [relevé structuré](verification-proofs/jm120-verification.json) conserve les chemins, empreintes et limites du reçu.

| Version préparée | Checkout | Lanceur et empreinte SHA-256 |
| --- | --- | --- |
| Repli 1.1.1 | `/srv/customer/jessiemessage-operator/production-111-cfa7dd35` | `/srv/customer/jessiemessage-private/start-primary-release111-cfa7dd35.sh` — `8b73e7aeb2aae4da7d3e6d0a4f1257664b594fb9f914c34835cad9387842723c` |
| Cible 1.2.0 | `/srv/customer/jessiemessage-operator/production-120-763b6321` | `/srv/customer/jessiemessage-private/start-primary-release120-763b6321.sh` — `f846b72a252b69d881264da76b60025325b4e2262ef3a850f1f58ec61f5da84f` |

Au staging : lanceurs 0700 et journaux 0600 vides ; ce reçu historique est conservé. Les deux scripts `check-primary-release…` ont depuis été exécutés avec succès après la migration 0031 : `rollback111HostedQualified:true` et `release120PrecheckPassed:true`. Les journaux privés de précontrôle ont pu recevoir leurs résultats ; ne pas les tronquer.

## Historique 1.2.0 — contrôle SQL avant migration validé

Le [diagnostic r2 épinglé](https://github.com/fredbuhr/jessiemessage/blob/670b9efcd90cd97aaa8d21621e38bf770fb3d835/ops/status-release120-migration-r2.sh), SHA-256 `d89e16a9340a9f1ab41ae4838c74f0d1891b9218c2969fc2b91204c8a19df542`, a finalement renvoyé le reçu utilisateur attendu :

```json
{"status":"checked","engineVerified":true,"transportVerified":true,"migrations":31,"applied":30,"pending":1,"interrupted":false,"readOnly":true,"migrated":false,"noRestart":true,"diagnosticRevision":2,"source":"cfa7dd3559e51c0fdc63ccc6fbc78d98609b947a","version":"1.1.1"}
```

Ce reçu confirme la lecture privée hébergée, le moteur, TLS et l’historique, pas les droits DDL. Les champs source/version désignent l’outil 1.1.1, pas la version active du serveur. Les tentatives antérieures restent conservées dans les [preuves structurées](verification-proofs/jm120-verification.json) : premier helper non confirmé, puis refus d’authentification SQL du diagnostic r2. Elles ne sont pas réécrites en succès et n’ont exécuté aucune migration. Aucun identifiant ni mot de passe n’est consigné ici.

Le diagnostic r2 conserve le lecteur privé, le plan et `run(status)` de 1.1.1 ; son connecteur reprend `databaseOptions` et TLS vérifié. Syntaxe Bash/JS et 13 tests synthétiques de diagnostic/TTY/confidentialité réussis. Le vrai validateur, lecteur de saisie, plan de 31 fichiers et migrateur passent avec connexion/statut simulés. Le lecteur de fichier privé n’était pas vérifiable localement faute de `/proc/self/fd` dans ce sandbox ; le reçu hébergé réussi fournit désormais la preuve distincte de ce parcours sur l’hébergement.

## Historique 1.2.0 — migration 0031 et précontrôles réalisés

Le [helper exécuté](https://github.com/fredbuhr/jessiemessage/blob/292e05fbeae29dfbe706c345434244696e0976f0/ops/upgrade-release120.sh), SHA-256 `f72170b16b0d095434a2d739b5fdb5b7724493fedf4f63d6c7dfd56f2aaa79f3`, a renvoyé deux reçus utilisateur cohérents :

- `schema31_confirmed_before_prechecks` : migrateur `upgraded`, moteur et transport vérifiés, **31 migrations, une appliquée et 30 inchangées**, `upgradeAttempted:true`, `schema31Confirmed:true`, `runtimeStarted:false`, `serviceStopOperatorAttested:true` ; source opérateur 1.1.1 `cfa7dd3559e51c0fdc63ccc6fbc78d98609b947a`.
- `schema31_prechecks_passed` : `schema31Confirmed:true`, `rollback111HostedQualified:true`, `release120PrecheckPassed:true`, `runtimeStarted:false`, `managerChanged:false`, `checkpointChanged:false`, `restart110Allowed:false` ; cible **1.2.0** / `763b632185ce13eb875110c9107687b2d278ff67`.

Le registre confirme désormais les 31 migrations appliquées et les deux précontrôles hébergés sont réussis. L’option `--service-stopped` et le reçu attestent l’arrêt déclaré par l’opérateur ; le helper ne contrôlait pas le Manager. Aucun démarrage de runtime, changement Manager ou alignement du checkpoint n’est effectué par ce script. Ses 14 tests synthétiques TTY et les CI DDL des releases restent des preuves de qualification distinctes. Les journaux privés et les précédents reçus sont préservés dans les [preuves](verification-proofs/jm120-verification.json). **Ne pas rejouer la commande de migration pour obtenir un autre résultat.**

## Historique — activation 1.2.0 confirmée

Le Run `bash /srv/customer/jessiemessage-private/start-primary-release120-763b6321.sh` et le Build `bash /srv/customer/jessiemessage-private/check-primary-release120-763b6321.sh` ont été enregistrés ; le service a été démarré. Le relevé admin utilisateur confirme les quatre valeurs du tableau. **Ne répéter ni le Build, ni le Run, ni cette preuve admin.** Le texte de démarrage est conservé tel qu’affiché, sans fuseau supposé. L’agent n’a pas observé directement le GET privé ; aucune attestation PID/socket ou empreinte du binaire actif n’est ajoutée.

La seconde observation HTTPS directe donne 4/4 contrôles publics conformes à `2026-10-20T22:24:58.673794+00:00`. Le premier essai comportait des erreurs réseau partielles ; il est conservé distinctement dans les preuves, sans les qualifier de panne applicative. Les contrôles publics attestent la disponibilité, pas l’identité. Le checkpoint est désormais aligné selon le reçu utilisateur final, sans nouveau redémarrage.

## Historique — validation de 1.2.0

[CI de PR](https://github.com/fredbuhr/jessiemessage/actions/runs/39498749684) et [CI du commit livré](https://github.com/fredbuhr/jessiemessage/actions/runs/39500108614) réussies 5/5 : général **3 177 réussis, zéro échec, 36 ignorés** ; MariaDB **10.11 et 11.4 : 479/479 chacune sans omission** ; Chrome **168/168**, HTTPS/MariaDB **3/3**, syntaxe et build **583 sources**. Le nouveau parcours réel confirme les deux profils, avatars propres/peers, refus intercompte, retrait et anciens liens invalidés, absence d’envoi automatique et lectures admin toujours privées. Les omissions générales ne valent pas qualification native. [Relevé structuré](verification-proofs/jm120-verification.json).

## Preuve d’identité et limites

La lecture admin fraîche, après **Actualiser la page**, renvoie le snapshot capturé par le processus HTTP répondant : version lue dans son package, Git HEAD/propreté/racine vérifiés au démarrage, `process.version` et instant de capture. API et fetch utilisent `no-store` ; le service worker n’intercepte aucun fetch. Les quatre valeurs reçues sont celles du tableau ci-dessus.

Les essais SSH historiques R1/R2 de la 1.0.0 ont renvoyé respectivement `PROCESS_NOT_UNIQUE` et `PROCESS_NOT_FOUND`, zéro correspondance stricte/canonique, douze processus propres lisibles, aucun illisible, aucun candidat. Ces vérifications restent non concluantes et ne sont pas transformées en succès. Le relevé admin est une preuve distincte de l’identité applicative, sans attestation de PID/socket, d’empreinte du binaire effectivement exécuté ou de fonctionnement PC/sauvegardes. La cause de l’absence de candidat SSH n’est pas établie et ne conditionne plus une identité déjà confirmée par HTTP admin.

## Build historique de 1.2.0 — repli

Le Run/Build 1.2.0 reste conservé pour le repli immédiat ; il ne désigne plus la production active. Le Build de la référence active 1.3.0 est dans les pins ci-dessous. Le checkpoint 1.3.0 est déjà enregistré ; aucun précontrôle supplémentaire n’est demandé pour cette clôture.

## Historique — validation de 1.1.0

La [CI de la PR 110](https://github.com/fredbuhr/jessiemessage/actions/runs/39489455741) et celle du [commit exact livré](https://github.com/fredbuhr/jessiemessage/actions/runs/39490336793) ont réussi 5/5 jobs : général **3 116 réussis, zéro échec, 35 ignorés** ; MariaDB **10.11 et 11.4 : 468/468 chacune sans omission** ; Chrome **165/165**, HTTPS/MariaDB **2/2**, syntaxe et build **570 sources**. Les omissions générales ne constituent pas une qualification native ; SQL et Chrome ont leurs jobs distincts. Ces suites ne sont pas relancées pour un simple enregistrement de preuves. Le [bilan](private-read-receipts-110.md) conserve les tests locaux, leurs limites et la preuve admin utilisateur historique de 1.1.0, distincte de la CI.

## Historique — validation locale de 1.0.0

Le build et le contrôle de syntaxe des **570 fichiers** réussissent. **135 tests ciblés** réussissent. La suite générale locale compte **3 141 tests : 2 924 réussis, trois échecs et 214 ignorés** ; les trois échecs sont des délais de `managed-runtime` observés sous concurrence dans cet environnement local. La relance isolée de `managed-runtime` et de l’identité de livraison réussit ensuite : **33/33, aucune omission**, sans modifier les délais ni les garde-fous. Cette relance ne transforme pas l’exécution générale en suite verte. Les prérequis natifs/SQL absents expliquent les omissions ; celles-ci ne valent pas validation. Ces résultats ne remplacent pas les preuves de la version en production.

La [CI de la PR 109](https://github.com/fredbuhr/jessiemessage/actions/runs/39470754751), sur `4c1b5a382811796af44e637c203d721465918fe0`, a réussi **5/5 jobs** : général **3 110 réussites, zéro échec, 35 ignorés**, MariaDB **10.11 et 11.4 : 466/466 chacune sans omission**, Chrome **164/164**, HTTPS/MariaDB **2/2**, syntaxe et build **570 fichiers**. La [CI main du commit de fusion](https://github.com/fredbuhr/jessiemessage/actions/runs/39471679954) a également réussi **5/5 jobs** sur `70b48aa845b70ca960724c8d37a6e94b3d5f47a8`, d’arbre identique. La CI qualifie ce code ; la preuve distincte de l’identité déployée est le relevé admin utilisateur consigné dans le bilan 1.0.0.

## Preuves et réserves à conserver

La référence 0.86 a été qualifiée en CI : général 3 101 réussites/35 wrappers SQL ignorés, 466/466 sur chaque MariaDB 10.11 et 11.4 sans omission, Chrome 164/164, HTTPS/SQL 2/2, syntaxe 568/build. Le relevé du 20 octobre à 16:41:34 Paris confirme Node 24.22, moniteur OK et 26 HTTPS conformes sur les deux origines, dix empreintes sensibles et l’identité PC préservées. Ce sont les preuves historiques de 0.86, distinctes du relevé d’identité 1.0.0 ci-dessus. Aucun GET privé authentifié de production, appareil physique ou état PC n’a été qualifié par ces contrôles.

A01, dette du Node applicatif 24.15, a été corrigée par le Node privé 24.22. La maintenance de sécurité annoncée pour le 21 octobre ou après reste une publication future au relevé du 20 octobre ; aucune correction anticipée n’est revendiquée. Le [bilan Node daté](node-runtime-086.md) conserve sa portée.

A07 est **`blocked_by_avast_user_reported`**. Les captures utilisateur signalent deux exemplaires du script055 en quarantaine le 20 octobre à 12:03:44.019 UTC puis 12:12:52.625 UTC. Empreintes des fichiers inconnues ; fausse alerte seulement soupçonnée. Les copies PC peuvent être interrompues ; le reçu antérieur ne décrit pas leur état actuel. L’utilisateur a demandé de différer le traitement antivirus et de poursuivre la messagerie. Aucun nouvel appariement, test mail/PC, exclusion antivirus, manipulation de clé ou changement de l’artefact PC dans ce lot. [Incident et preuves](pc-antivirus-20261020.md).

A08 conserve avertissement et dry-run, sans exécuteur actif ni purge. Surveiller les seuils de **1 500 reçus ou 3 072 entrées** ; le diagnostic est dans les [preuves 0.81](verification-proofs/jm081-verification.json). Le budget média conserve ses limites : 1 Gio chiffré/50 000 objets non libérés, snapshot SQL de 100 000 lignes cumulées et dump brut de 64 Mio. L’harmonisation ne relève aucun de ces plafonds.

Les conversations sont conservées jusqu’à fermeture définitive, hors suppressions volontaires. Fermeture locale journalisée et restauration opérateur en maintenance restent le périmètre convenu. Récupération autonome après perte complète de l’hôte, témoin frais à chaque phase, succession et inventaire SQL exhaustif restent hors prérequis V1 ; `completeDatabase:false`, objets exécutables exclus. Pas de garantie de capture simultanée fichiers/base ni de perte maximale de vingt-quatre heures. La [surveillance](../MONITORING.md) conserve ses limites : pas de délai maximal de détection ni de réception externe attesté.

## Pins de la référence active 1.3.0

L’identité active est confirmée par relevé admin utilisateur. Les modes et empreintes sur disque proviennent du reçu de préparation hébergée ; aucune empreinte mesurée via le PID actif n’est revendiquée.

| Élément | Référence active 1.3.0 |
| --- | --- |
| Code identifié actif | `afd0e98cdb4027ac4cb444ddb05afeda0a84fb6b` |
| Arbre du commit | `37b3b2e9358972c95581fc0bcf16896e4074d5f9` |
| Checkout | `/srv/customer/jessiemessage-operator/production-130-afd0e98c` |
| Run Manager | `bash /srv/customer/jessiemessage-private/start-primary-release130-afd0e98c.sh` ; déjà activé, ne pas relancer pour les métadonnées. |
| Build Manager | `bash /srv/customer/jessiemessage-private/check-primary-release130-afd0e98c.sh` ; précontrôlé, ne pas relancer pour les métadonnées. |
| Lanceur | 0700 au staging ; SHA-256 `7bc16887caa01e0644ef200f9ab099049963af9fa1f6db0ad7a1c37bec7232d5` |
| Précontrôle | SHA-256 du lanceur `af327346122802092763969269e17e3f48b73b2bf704bb04d06d78c1dfdd3815` |
| Node applicatif | `/srv/customer/jessiemessage-private/runtime-node-v24.22.0/bin/node`, 0700 au staging ; version active `v24.22.0`. |
| Binaire Node SHA-256 au staging | `67ca5783febb8bf85736c79fcdd92c8d6d465a0eb2a082672bcdfa76a506751c` ; aucune empreinte via PID actif. |
| Journal | `/srv/customer/jessiemessage-private/jm130-node2422.log`, 0600 au staging ; son empreinte vide était antérieure à l’activation. Ne pas le tronquer. |
| Configuration | `/srv/customer/jessiemessage-private/primary-origin-candidate-4a355851` |
| Opérations | `/srv/customer/jessiemessage-private/recurring-backup-052` |
| Repli immédiat 1.2.0 | Source `763b632185ce13eb875110c9107687b2d278ff67`, arbre `c7dce7bcdb99b298ffc43c9e31dd22ee87453926`, checkout `/srv/customer/jessiemessage-operator/production-120-763b6321` ; Run `bash /srv/customer/jessiemessage-private/start-primary-release120-763b6321.sh`, SHA-256 `f846b72a252b69d881264da76b60025325b4e2262ef3a850f1f58ec61f5da84f` ; Build `bash /srv/customer/jessiemessage-private/check-primary-release120-763b6321.sh`. |
| Secours compatible 1.1.1 | Source `cfa7dd3559e51c0fdc63ccc6fbc78d98609b947a`, arbre `94b2fec5383fd948df7605b63f65a4e23078c2a1`, checkout `/srv/customer/jessiemessage-operator/production-111-cfa7dd35` ; lanceur `/srv/customer/jessiemessage-private/start-primary-release111-cfa7dd35.sh`, SHA-256 `8b73e7aeb2aae4da7d3e6d0a4f1257664b594fb9f914c34835cad9387842723c`. Précontrôle hébergé réussi, non démarré. |

Les sources/lanceurs 1.1.0 et 1.0.0 restent conservés pour l’historique, **sans autorisation technique de les redémarrer sur le schéma 31**.
Mode **`start-local-closures`**, `closuresEnabled:true`, port **3000 direct**, sans observateur/passerelle. Garder `JESSIEMESSAGE_PRIVATE_PATH_MODE=linux-dirfd`. Six configurations, clés, base, médias, sessions, destinataire GPG et cadence réutilisés. Ne pas lancer un second parent SSH ni `capture --offline` pendant le service.

Précontrôles du nouveau Node à **14:32:58.849424 UTC** : plateforme/JPEG/fichiers privés `checks_passed`, vrai décodeur photo fork normalisant PNG vers JPEG/vignette avec le binaire exact ; `local_closure_precheck/passed`, `pendingClosures:false`, `started:false`, `erased:false`, `externalContinuityVerified:false`. Dépendances verrouillées existantes réutilisées. Le lanceur vérifie SHA-256 et version Node avant `exec` ; le Build utilise également son chemin absolu. Utiliser ce Node pour toute commande opérateur JavaScript ; ne pas remplacer le binaire système.

Checkpoint unique **0600** : `/srv/customer/jessiemessage-private/jm0702-existing-pc-update.json`. **État enregistré : 1.3.0** / `afd0e98cdb4027ac4cb444ddb05afeda0a84fb6b`, schéma 31, Node `v24.22.0`, reçu utilisateur `release130_metadata_recorded`, `metadataOnly:true`, `noRestart:true`, `rollbackRelease:1.2.0`, `priorActivePreserved:true`, `rollbackPreserved:true`, `otherBlocksPreserved:true`. L’ancien `activeService` 1.2.0 intégral et son empreinte sont conservés comme état antérieur et repli sous `.developmentSimplification.release130`. `.developmentSimplification.release120` et son secours compatible 1.1.1, les blocs `release110`/`release100`, `.nodeRuntimeUpdate.rollback`, `.productionClosure`/`.chatSendAck`, S1/S2/S3, PC, autorité et D1 restent préservés. L’alignement est clos, sans nouveau fonctionnement PC ou sauvegarde attesté ; ne pas rejouer le writer.

## Préserver PC, autorité et D1

- **PC, 19 octobre :** copie et déchiffrement acceptés, `DECHIFFREMENT_VERIFIE` à **16:34:19 UTC**, capture `1792386945745-204e0e8e073b6131`, GPG 402 552 octets, SHA-256 `c809dbfed6eabd2e8bde1a1d30a6cb11cbc99df720c0140935b3f2ae413690e5`. Mails acceptés le 18 octobre. Aucun nouveau test personnel à refaire.
- Ne pas réapparier le PC, exporter/régénérer sa clé privée, supprimer DPAPI, marqueurs ou dossier `temoin`. Ne rejouer ni `plan-witness`, ni `prepare-witness`, ni `prepare-witness-enrollment`. La messagerie quotidienne ne dépend pas du PC allumé.
- Autorité conservée sous `/srv/customer/jessiemessage-private/witness-origin-069-6b84f6e1`, fichiers 0600 : `contract/witness-genesis.json` original, SHA-256 `4fbdce199d70c1fd4b80f8ff249dae2666812b8ffc1c6912e8c50d1a042aaf10` ; `enrollment/witness-enrollment-origin.json` original, `817c6dca7735bb844d73066ebd3a711c46eb52cf5d5aabb5f4772171efc4b0c1` ; `enrollment/witness-enrollment.json` **spent, révision 2**, `445bc6c49bc0259284f2636f678e9073a833a2a4f60a992a6f87e5a3d1d7d35a`. Aucun retour à `ready`.
- **D1, 19 octobre :** base `fb4hmr_jm_restore_20261019`, opérateur `fb4hmr_jm_d19`, trente tables/migrations, six clés et quatre photos vérifiées ; `completeDatabase:false`. Conserver `restore-d19-checkpoint`, `restore-d19-quarantine`, reçus `restore-d19-operator` et marqueur bloquant `operational-restore.json`. Aucun réimport, rebind ni retrait de quarantaine. [Preuves](verification-proofs/jm-d19-isolated-restore.json).
- `recette.jessiemessage.com` partage runtime/base du principal : ce n’est pas une cible isolée. D2 reste historiquement non qualifié (`shared_admin / raw_underscore_pattern`, métadonnées refusées, scheduler OFF distinct de DISABLED) ; ne pas le rouvrir comme préalable V1.

## Repli historique Node 24.15

**Référence historique uniquement, non utilisable sur le schéma 31 :** ancien service 0.86, même source/arbre/checkout, Run `bash /srv/customer/jessiemessage-private/start-primary-production-086-c61d1eec.sh`, lanceur 0700 SHA-256 `3b5ac6ba42d802cabb9e7117d6d4c90408709d6b64b21a69ae0ff68ebb3c19cc`, journal `/srv/customer/jessiemessage-private/jm086-production.log` 0600. Son Node système **24.15.0 rouvrirait A01** ; ne pas le présenter comme un repli maintenant corrigé. Run/Build et ancien `activeService` complets dans `.nodeRuntimeUpdate.rollback`. Le repli applicatif 0.85 et tous ses pins restent dans `.productionClosure.rollback` et le [bilan antérieur](production-086.md). Aucun retour SQL ni suppression de journal.

## Historique et clôtures conservés

Les anciens lots restent clos dans leur portée : [S1](verification-proofs/jm076-verification.json), [S2a](verification-proofs/jm077-verification.json), [S2b](verification-proofs/jm078-verification.json), [S3/0.79](messaging-acceptance-079.md), [audit du 20 octobre](AUDIT-CODE-2026-10-20.md), [corrections 0.80](audit-corrections-080.md), [0.81](audit-corrections-081.md), [0.82](audit-corrections-082.md), [0.83](audit-corrections-083.md), [clôture des corrections](audit-closure-083.md), [0.84](service-status-084.md), [0.85](chat-send-ack-085.md), [clôture V1 0.86](production-086.md) et [mise à niveau Node](node-runtime-086.md). Leurs versions et heures ne sont pas réécrites. Les limites, dont la race C02 non reproduite, restent attachées à leurs preuves.

Le [relevé historique 0.83](verification-proofs/jm083-closure.json) est antérieur aux alertes Avast ; ses cinq archives, dix reçus et dernière copie concordante du 20 octobre 05:15 UTC ne prouvent pas le fonctionnement PC actuel. L’[historique du 19 octobre](REPRISE-HISTORIQUE-20261019.md) et l’[ancien journal](NEXT-STEPS.md) restent disponibles, sans prochaine action courante concurrente.
