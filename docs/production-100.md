# Livraison de référence — JessieMessage 1.0.0

**Harmonisation terminée le 20 octobre 2026.** L’identité déployée est confirmée par le relevé administrateur utilisateur et le checkpoint privé est aligné, avec repli conservé et sans redémarrage supplémentaire. L’état courant et la prochaine action restent dans [REPRISE](REPRISE.md).

## Identité active constatée

Après connexion, l’utilisateur a ouvert **État du service → Actualiser la page → Détails techniques** et transmis ces quatre valeurs :

| Champ affiché | Valeur transmise |
| --- | --- |
| Version de l’application | `1.0.0` |
| Commit au démarrage | `70b48aa845b70ca960724c8d37a6e94b3d5f47a8` |
| Version Node.js | `v24.22.0` |
| Relevé au démarrage | `20/10/2026 21:16:28` |

La date ci-dessus conserve l’affichage transmis ; le fuseau du navigateur n’a pas été fourni et aucune conversion UTC n’est déduite. Cette lecture fraîche du `GET /api/admin/readiness` authentifié, en `no-store`, expose le snapshot d’identité capturé par le processus HTTP répondant à son démarrage. Elle confirme la version applicative active. L’agent n’a pas observé directement cette réponse privée.

## Source et qualification

| Élément | Preuve et portée |
| --- | --- |
| Source de livraison | Commit `70b48aa845b70ca960724c8d37a6e94b3d5f47a8`, arbre du commit `485cade0aeeee41cb4c34f913cd98f6078c4636b`. |
| Publication | [Tag et release v1.0.0](https://github.com/fredbuhr/jessiemessage/releases/tag/v1.0.0) sur ce commit exact ; [PR 109](https://github.com/fredbuhr/jessiemessage/pull/109). |
| CI du commit livré | [Run 39471679954](https://github.com/fredbuhr/jessiemessage/actions/runs/39471679954), **5/5 jobs réussis** : général 3 110 réussites/zéro échec/35 ignorés ; MariaDB 10.11 et 11.4, 466/466 chacune sans omission ; Chrome 164/164 ; HTTPS/MariaDB 2/2 ; syntaxe et build, 570 fichiers. |
| Staging serveur | Reçu utilisateur `staged_precheck_passed` : commit/arbre exacts, Node 24.22.0 et dépendances verrouillées concordants ; `pendingClosures:false`, `started:false`, `erased:false`, `managerChanged:false`, `runtimeStarted:false` lors de cette préparation. Ce reçu ne constituait pas encore une preuve d’activation. |
| Pins vérifiés au staging | Node SHA-256 `67ca5783febb8bf85736c79fcdd92c8d6d465a0eb2a082672bcdfa76a506751c` ; lanceur 1.0.0 SHA-256 `aa400abaa54033308acce7f4b28649b33d4ecc5f7098eec7b020c05631123248`. |
| Disponibilité publique | Quatre GET santé/disponibilité sur les deux origines recontrôlés après le relevé utilisateur : HTTP 200 et JSON exact `ok`/`ready`. [Relevé structuré](verification-proofs/jm100-verification.json). Ces réponses n’identifient pas le code actif. |

Cette livraison harmonise métadonnées, documentation et identité affichée dans l’administration. Elle conserve le même service, les configurations, la base, les médias et les dépendances. Aucun changement métier de messagerie ni migration SQL ; l’évolution « Lecture privée » reste séparée, à reporter pour préparer 1.1.0.

## Limites des preuves et état opérateur

Les contrôles SSH R1/R2 n’ont pas identifié de candidat applicatif : R2 a rapporté zéro candidat parmi douze processus propres lus, aucun illisible. Ils restent **non concluants**, sans attestation du PID, du socket ou de l’empreinte du binaire effectivement exécuté. La lecture admin ci-dessus est une preuve d’identité applicative distincte ; elle ne transforme pas ces contrôles en réussites. Les empreintes de staging ne valent pas une mesure du binaire du processus actif.

Le checkpoint `/srv/customer/jessiemessage-private/jm0702-existing-pc-update.json` est aligné sur 1.0.0 par le script épinglé dans REPRISE, testé **4/4** avant son exécution serveur. Le reçu transmis par l’utilisateur confirme `release100_metadata_recorded`, source `70b48aa845b70ca960724c8d37a6e94b3d5f47a8`, version `1.0.0`, `metadataOnly:true`, `noRestart:true`, `rollbackPreserved:true`, `otherBlocksPreserved:true`. L’ancien `activeService` complet reste dans `.developmentSimplification.release100.rollback` ; les autres blocs sont conservés. L’alignement et l’harmonisation sont clos. Aucun nouvel audit général, test PC, campagne réelle, effacement ou restauration n’est ajouté par ce bilan ; les réserves déjà documentées restent conservées.

## Repli immédiat conservé

| Élément | Référence de repli |
| --- | --- |
| Version / Node | **0.86.0 / Node privé 24.22.0**. |
| Source / arbre | `c61d1eecfefe786254416652877ba82d30cf4c90` / `78c8e46224503b0691b381bf07c5aefd51ca5c7f`. |
| Checkout | `/srv/customer/jessiemessage-operator/production-086-c61d1eec`. |
| Run | `bash /srv/customer/jessiemessage-private/start-primary-node2422-c61d1eec.sh` ; SHA-256 du lanceur `e54392621a7f63f7665f44c191783d467ccb214630e65449fb4ae57138cc9881`. |

Le Build associé à 0.86/Node 24.22 reste à conserver avec ce Run. Le lanceur historique utilisant Node système 24.15 n’est pas le repli immédiat de cette livraison.
