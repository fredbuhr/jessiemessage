# Livraison 1.14.0 — terminée

État du 31 octobre 2026. [REPRISE](REPRISE.md) reste la référence. La 1.14.0 est démarrée et ses métadonnées sont alignées selon le reçu final utilisateur ; aucune étape 1130 à rejouer. `recette.jessiemessage.com` et `jessiemessage.com` partagent le service Node239143 et la même base.

## Résultat qualifié et publié

Source/tag **`4f3ce5de5ba059bc5fb4f3dc20aaf3c6202ea9bd`**, arbre **`e5a239eaf7b8c3395a843c9e0d600efeb7aa569b`**, [v1.14.0](https://github.com/fredbuhr/jessiemessage/releases/tag/v1.14.0), release/latest **430149586**. [PR145](https://github.com/fredbuhr/jessiemessage/pull/145), puis main, **5/5 jobs** chacun : général 4 295 tests / 4 243 réussis / 52 omissions explicites ; Chrome 296/296, HTTPS 14/14, MariaDB 613/613 sur chacune des deux versions. [Bilan et couverture](media-library-1140.md), [preuve main](verification-proofs/jm1140/main-native.json).

Publication [41235813737](verification-proofs/jm1140/publication-native.json) : onze tests natifs exécutés en tentative1 ; seul le job de publication a repris en tentative2 après lecture indépendante du tag correct déjà créé et de la release encore absente. Le tag n’a pas été déplacé. Échec initial et journaux conservés. Opérateur `a051c7ebd821b76e9e8554481a91b89ea875b140`, script relu identique aux octets qualifiés. Aucun déploiement déduit de cette publication.

Node24.22.1 et schéma 38/37tables attendues inchangés. Seule nouvelle dépendance : `libheif-js@1.23.5`. Les dépendances anciennes restent préservées ; le nouveau préparateur installe un `node_modules` séparé avec npm11.19.1 extrait de l’archive officielle Node déjà épinglée. [Qualification opérateur](verification-proofs/jm1140/preparation-native.json), run41235719521, **23/23 tests et une installation réelle isolée**, versions, Sharp et fichiers HEIC vérifiés ; aucune action hébergée. L’échec initial de configuration npm est conservé et corrigé, sans ancien outil rejoué.

## Préparation et CHECK1140 — acquis, ne pas rejouer

Le [reçu utilisateur](verification-proofs/jm1140/hosted-preparation.json) confirme les sources exactes et la préparation séparée des dépendances. Empreinte canonique **`2fe494a43a446c882ce509f4ecf51925bd5789a94bdbdf2ce6923d83e5ff7d72`**, recalculée identique ; `CHECK1140_EXIT=0` puis `PREPARATION_1140_CHECK_OK`.

- Checkout `/srv/customer/jessiemessage-operator/production-1140-4f3ce5de`, mode0700 ; dépendances distinctes, six versions verrouillées et inventaire1082entrées/914fichiers/SHA547c6ec0 identiques à la qualification native. Sharp et les deux fichiers HEIC vérifiés selon le reçu.
- Lanceur SHA256 `12f9b0c634c89912eb15ca02244c76f14694a84a3e8499051e52e4988c316635`, CHECK SHA256 `ae4999d70f15be6cd1491c30ac5ad99494e5f0d35a3fcc1b3e0daf3748424419`, tous deux mode0700.
- Checkpoint13/cdcb3f8b, staging13/08eb6309, lanceurs et anciennes dépendances préservés selon le reçu. Ancien inventaire1109entrées/937fichiers conservé, sans confusion avec le nouveau.
- Les flags faux et journaux vides décrivent l’état avant le CHECK séparé ; ne pas les réécrire pour fabriquer une qualification ni déduire un démarrage14 ou un inventaire SQL physique indépendant.

Préparateur immuable `10083087598a96248698cbe76309e1b3afda163c`, SHA256 `4b6d1b3d8212b107ccdfb7fa3a285e93b6936298f685b360423fa31a8ac18686`, déjà qualifié. Le [bloc utilisé est conservé dans l’historique](https://github.com/fredbuhr/jessiemessage/blob/f8b967f209949ae4d8b8787a61aec36cfeaab01b/docs/verification-proofs/jm1140/preparation-command.sh). **Ne rejouer ni préparation ni CHECK SSH1140.** Aucune action hébergée effectuée directement par l’agent.

## Activation personnelle14 — acquise, ne pas rejouer

Le [relevé utilisateur](verification-proofs/jm1140/hosted-identity.json) confirme version1.14.0/source4f3ce5de/Node24.22.1, **31/10/2026 21:16:02 Europe/Paris (UTC+01)**, secondeUTC1793477762. L’UI ne contenait ni millisecondes ni signal de disponibilité ; le reçu final ci-dessous les complète. Ne rejouer ni préparation, CHECK SSH, paramètres Manager ou redémarrage.

| Champ | Valeur14 correspondant à l’activation rapportée |
| --- | --- |
| Exécution, champ du haut | `bash /srv/customer/jessiemessage-private/start-primary-release1140-4f3ce5de.sh` |
| Build, champ du bas | `bash /srv/customer/jessiemessage-private/check-primary-release1140-4f3ce5de.sh` |
| Port | `3000` |

L’agent n’a ni ouvert le Manager ni inspecté directement les champs ou le processus. Le service Node239143 nommé recette dessert aussi le principal et sa base.

## Enregistrement final14 — acquis, ne pas rejouer

Le nouvel opérateur est [qualifié](verification-proofs/jm1140/writer-final-native.json) : [run41238866092](https://github.com/fredbuhr/jessiemessage/actions/runs/41238866092), tentative1, **1/1 job et29/29 tests natifs sans omission**, Nodev24.22.1. Opérateur **`59e6f8cc7f12d8b36e4c9bdbeec543d02becc9ff`**, arbre `edd28d9811263eae60ecd6408d218e3abdb4828b`, script SHA256 **`942429e1cfa44fd35dea8fd4cdae4319a5e1e7f5edbf0c756202f1dd3fd3faf1`**,34820octets, relu identique aux octets qualifiés ; tests et workflow également relus. Journal intégral synthétique conservé et empreinté. Aucun essai app vert répété.

Il lie le démarrage réel1793477762, le staging2fe494a4 et le checkpoint13/cdcb ; vérifie sources/tags/versions, seul deltaHEIF, fichiers des six dépendances et inventaires distincts, Node/configuration/migrations, repli185 dans sa portéeSQL38 seule, précontrôles et unique démarrage avec millisecondes, puis HTTP publics et publication exacte. Écriture atomique et relecture des seules métadonnées, état actif13 intégral et section1130/historiques/autres blocs conservés. Aucun nouvel envoi, CHECK, migration ou redémarrage.

**Exécution acquise selon le [reçu final utilisateur](verification-proofs/jm1140/hosted-metadata.json)** : `release1140_metadata_recorded`, version1.14.0/source4f3ce5de/arbre e5a239/Node24.22.1, `publicReady:true`, `metadataOnly:true`, `noRestart:true`, SQL38/37tables attendues. Checkpoint14 SHA256 **`19ceaa7e91d32daba7da5b71d7dfe02ad964e8d9d2850ae016cfa732b8a9c6e0`**. La ligne réelle de démarrage donne **1793477762343ms**, soit **31/10/2026 21:16:02.343 Europe/Paris**, conforme au relevé UI à la seconde.

Le writer a vérifié les sources/tags/dépendances/Node/configuration, les reçus et précontrôles, l’unique démarrage et les GET publics avant l’écriture atomique et sa relecture. État actif13 intégral, section1130, historiques1112/1111/1110/1101/1100/190/184 et autres blocs préservés selon le résultat ; aucune section finale1120/1113 absente inventée. Ancien repli185 conservé dans sa portée SQL38 seulement, sans démarrage ;184/172 interdits et publicProfileDowngradeQualified:false conservé.

Le [bloc exécuté reste dans l’historique Git](https://github.com/fredbuhr/jessiemessage/blob/96613e065e4b3b5067b4d79aa9313f485601f8df/docs/verification-proofs/jm1140/record-command.sh). **Ne rejouer aucune commande acquise.**

**Aucune opération de livraison restante.** Les GET publics ne prouvent pas le commit du processus ; PID/socket/binaire exécuté et inventaire SQL physique nouveau non qualifiés indépendamment par l’agent. Téléphones physiques, Safari et photo originale problématique restent non attestés. Aucun nouvel envoi réel, compte/média client, test de sauvegarde reporté, parcours PC ou chantier juridique ouvert automatiquement.
