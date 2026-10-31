# Livraison 1.14.0 — publiée, hébergement en attente

État du 31 octobre 2026. [REPRISE](REPRISE.md) reste la référence. La 1.13.0 est toujours active et finalisée selon ses reçus ; aucune étape 1130 à rejouer. `recette.jessiemessage.com` et `jessiemessage.com` partagent le service Node239143 et la même base.

## Résultat qualifié et publié

Source/tag **`4f3ce5de5ba059bc5fb4f3dc20aaf3c6202ea9bd`**, arbre **`e5a239eaf7b8c3395a843c9e0d600efeb7aa569b`**, [v1.14.0](https://github.com/fredbuhr/jessiemessage/releases/tag/v1.14.0), release/latest **430149586**. [PR145](https://github.com/fredbuhr/jessiemessage/pull/145), puis main, **5/5 jobs** chacun : général 4 295 tests / 4 243 réussis / 52 omissions explicites ; Chrome 296/296, HTTPS 14/14, MariaDB 613/613 sur chacune des deux versions. [Bilan et couverture](media-library-1140.md), [preuve main](verification-proofs/jm1140/main-native.json).

Publication [41235813737](verification-proofs/jm1140/publication-native.json) : onze tests natifs exécutés en tentative1 ; seul le job de publication a repris en tentative2 après lecture indépendante du tag correct déjà créé et de la release encore absente. Le tag n’a pas été déplacé. Échec initial et journaux conservés. Opérateur `a051c7ebd821b76e9e8554481a91b89ea875b140`, script relu identique aux octets qualifiés. Aucun déploiement déduit de cette publication.

Node24.22.1 et schéma 38/37tables attendues inchangés. Seule nouvelle dépendance : `libheif-js@1.23.5`. Les dépendances anciennes restent préservées ; le nouveau préparateur installe un `node_modules` séparé avec npm11.19.1 extrait de l’archive officielle Node déjà épinglée. [Qualification opérateur](verification-proofs/jm1140/preparation-native.json), run41235719521, **23/23 tests et une installation réelle isolée**, versions, Sharp et fichiers HEIC vérifiés ; aucune action hébergée. L’échec initial de configuration npm est conservé et corrigé, sans ancien outil rejoué.

## Prochaine action unique : préparation puis CHECK depuis le terminal personnel

[Terminal SSH Infomaniak](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/ssh-terminal/Node.js/terminal). Le bloc suivant vise uniquement cette nouvelle livraison, sans redémarrage, migration ni modification du checkpoint actif13. Il vérifie d’abord les préconditions durables : checkpoint13 `cdcb3f8b35208ddfaff19009235f86d4dd23a10ac13b00c9c692daad2bbe496d`, staging13 `08eb630927a84cc63c0b552fa9f729ab7ee2433f6c3fc8aca1466c007f021ecd`, sources/lanceurs et dépendances actives.

Préparateur immuable **`10083087598a96248698cbe76309e1b3afda163c`**, arbre `220cb24da7a78a14b627032d668f6fd08a1cbe28`, SHA256 **`4b6d1b3d8212b107ccdfb7fa3a285e93b6936298f685b360423fa31a8ac18686`**, 30 093 octets, relu identique. Le bloc exact est aussi conservé en [fichier](verification-proofs/jm1140/preparation-command.sh).

```sh
env -i PATH=/usr/bin:/bin PYTHONDONTWRITEBYTECODE=1 python3 - <<'PY_PREPARE1140'
import hashlib, json, subprocess, urllib.request

url = 'https://raw.githubusercontent.com/fredbuhr/jessiemessage/10083087598a96248698cbe76309e1b3afda163c/ops/prepare-release1140.py'
with urllib.request.urlopen(url, timeout=30) as response:
    if response.status != 200 or response.url != url:
        raise SystemExit('URL_OUTIL_A_VERIFIER : aucun outil execute.')
    code = response.read(65537)
if len(code) > 65536 or hashlib.sha256(code).hexdigest() != '4b6d1b3d8212b107ccdfb7fa3a285e93b6936298f685b360423fa31a8ac18686':
    raise SystemExit('OUTIL1140_A_VERIFIER : aucun outil execute.')
ns = {'__name__': 'jm1140_preparation'}
exec(compile(code, '<preparation1140>', 'exec'), ns)
try:
    result = ns['stage'](ns['RELEASE_SOURCE'], ns['RELEASE_TREE'])
except (Exception, KeyboardInterrupt):
    raise SystemExit('PREPARATION1140_NON_CONFIRMEE : conserver les traces, ne pas relancer.') from None
print(json.dumps(result, separators=(',', ':')), flush=True)
try:
    check = subprocess.run(['/bin/bash', result['checkLauncher']], env=ns['clean_environment'](),
        stdin=subprocess.DEVNULL, capture_output=True, timeout=180, check=False)
except (OSError, subprocess.TimeoutExpired, KeyboardInterrupt):
    raise SystemExit('CHECK1140_NON_CONFIRME : conserver les traces, ne pas relancer.') from None
print('CHECK1140_EXIT=' + str(check.returncode), flush=True)
if check.returncode != 0:
    raise SystemExit('CHECK1140_REFUSE : conserver les traces, ne pas relancer.')
print('PREPARATION_1140_CHECK_OK')
PY_PREPARE1140
```

Attendre le JSON de staging, `CHECK1140_EXIT=0` puis `PREPARATION_1140_CHECK_OK`. Les flags du staging décrivent l’état avant le CHECK séparé ; ne pas les réécrire comme preuve de réussite. En cas d’absence de résultat, interruption ou refus, conserver le candidat, ses journaux et reçus ; inspecter en lecture seule avant toute suite, sans rejouer le bloc pour découvrir son résultat.

## Étapes suivantes — non effectuées, dépendantes du reçu précédent

Après réception du CHECK, l’activation personnelle se fera dans le [Manager Run/Build](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/h3/118579/nodejs/239143/data/advanced-settings/application), application Node nommée `recette.jessiemessage.com`, qui dessert aussi le principal. Les valeurs prévues sont :

| Champ | Valeur1140 à utiliser seulement après CHECK confirmé |
| --- | --- |
| Commande d’exécution, champ du haut | `bash /srv/customer/jessiemessage-private/start-primary-release1140-4f3ce5de.sh` |
| Commande de build, champ du bas | `bash /srv/customer/jessiemessage-private/check-primary-release1140-4f3ce5de.sh` |
| Port | `3000` |

Ne déduire aucun démarrage14 de ces valeurs. Après activation, relever l’identité affichée dans [l’état du service](https://jessiemessage.com/admin/readiness), puis préparer et qualifier l’enregistrement final lié au véritable démarrage et aux reçus. Aucun writer14 n’est fourni à ce stade. Le checkpoint13, ses historiques et les anciens replis doivent rester préservés ; aucune nouvelle qualification de downgrade n’est inventée.

Téléphone physique, Safari et photo originale problématique restent non attestés. Les preuves Chrome et SQL utilisent exclusivement des fixtures synthétiques isolées. Aucun envoi réel, compte ou média client modifié, test de sauvegarde reporté, nouvelle opération PC ou chantier juridique.
