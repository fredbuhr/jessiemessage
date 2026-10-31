# Livraison 1.14.0 — démarrage rapporté, enregistrement final qualifié en attente du reçu

État du 31 octobre 2026. [REPRISE](REPRISE.md) reste la référence. La 1.14.0 est démarrée selon le relevé utilisateur ; le checkpoint13 reste la dernière métadonnée privée acquise ; aucune étape 1130 à rejouer. `recette.jessiemessage.com` et `jessiemessage.com` partagent le service Node239143 et la même base.

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

Le [relevé utilisateur](verification-proofs/jm1140/hosted-identity.json) confirme version1.14.0/source4f3ce5de/Node24.22.1, **31/10/2026 21:16:02 Europe/Paris (UTC+01)**, secondeUTC1793477762. Il ne contient ni millisecondes ni signal de disponibilité. Ne rejouer ni préparation, CHECK SSH, paramètres Manager ou redémarrage.

| Champ | Valeur14 correspondant à l’activation rapportée |
| --- | --- |
| Exécution, champ du haut | `bash /srv/customer/jessiemessage-private/start-primary-release1140-4f3ce5de.sh` |
| Build, champ du bas | `bash /srv/customer/jessiemessage-private/check-primary-release1140-4f3ce5de.sh` |
| Port | `3000` |

L’agent n’a ni ouvert le Manager ni inspecté directement les champs ou le processus. Le service Node239143 nommé recette dessert aussi le principal et sa base.

## Enregistrement final14 — qualifié, en attente du reçu

Le nouvel opérateur est [qualifié](verification-proofs/jm1140/writer-final-native.json) : [run41238866092](https://github.com/fredbuhr/jessiemessage/actions/runs/41238866092), tentative1, **1/1 job et29/29 tests natifs sans omission**, Nodev24.22.1. Opérateur **`59e6f8cc7f12d8b36e4c9bdbeec543d02becc9ff`**, arbre `edd28d9811263eae60ecd6408d218e3abdb4828b`, script SHA256 **`942429e1cfa44fd35dea8fd4cdae4319a5e1e7f5edbf0c756202f1dd3fd3faf1`**,34820octets, relu identique aux octets qualifiés ; tests et workflow également relus. Journal intégral synthétique conservé et empreinté. Aucun essai app vert répété.

Il lie le démarrage réel1793477762, le staging2fe494a4 et le checkpoint13/cdcb ; vérifie sources/tags/versions, seul deltaHEIF, fichiers des six dépendances et inventaires distincts, Node/configuration/migrations, repli185 dans sa portéeSQL38 seule, précontrôles et unique démarrage avec millisecondes, puis HTTP publics et publication exacte. Écriture atomique et relecture des seules métadonnées, état actif13 intégral et section1130/historiques/autres blocs conservés. Aucun nouvel envoi, CHECK, migration ou redémarrage.

Exécuter ce nouveau bloc dans le [terminal SSH personnel](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/ssh-terminal/Node.js/terminal), puis transmettre le JSON. Le [fichier exact](verification-proofs/jm1140/record-command.sh) est conservé avec les preuves.

```sh
env -i PATH=/usr/bin:/bin PYTHONDONTWRITEBYTECODE=1 python3 - <<'PY_RECORD1140'
import hashlib, urllib.request

url = 'https://raw.githubusercontent.com/fredbuhr/jessiemessage/59e6f8cc7f12d8b36e4c9bdbeec543d02becc9ff/ops/record-release1140.py'
with urllib.request.urlopen(url, timeout=30) as response:
    if response.status != 200 or response.url != url:
        raise SystemExit('URL_OUTIL_A_VERIFIER : arret.')
    code = response.read(65537)
if len(code) > 65536 or hashlib.sha256(code).hexdigest() != '942429e1cfa44fd35dea8fd4cdae4319a5e1e7f5edbf0c756202f1dd3fd3faf1':
    raise SystemExit('EMPREINTE_OUTIL_INCORRECTE : aucun outil execute.')
exec(compile(code, '<enregistrement1140>', 'exec'), {'__name__': '__main__'})
PY_RECORD1140
```

Résultat attendu : `release1140_metadata_recorded`, identité14 exacte, `metadataOnly:true`, `noRestart:true`, `publicReady:true` et nouvelle empreinte du checkpoint. Aucun succès privé14 déduit avant réception. Si résultat absent ou refus, conserver les traces et inspecter l’état durable en lecture seule avant toute reprise ; ne jamais rejouer un outil pour découvrir son résultat.

Téléphones physiques, Safari et photo originale problématique restent non attestés. Aucun compte ou média client modifié, test de sauvegarde reporté, nouveau parcours PC ou chantier juridique.
