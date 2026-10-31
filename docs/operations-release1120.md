# Préparer la1.12.0 sur l’hébergement

La [release v1.12.0](https://github.com/fredbuhr/jessiemessage/releases/tag/v1.12.0), ID429632868, est publiée/latest sur la source **`9bfdae07797f4e848964422471da67560c7d94eb`**, arbre **`4aef91b8aea6e811af74b28a52e69f9481f62592`**. [PR143](verification-proofs/jm1120/one-click-pr-native.json) puis [main41153045628](verification-proofs/jm1120/one-click-main-native.json)5/5, tentative1. La publication ne constitue pas un déploiement.

Opérateur **`d7896b6c5fa67dc8e0002f7d7ef86d96e5b506af`**, arbre `644c887f9614d84edbd9f0d0f3f09cca8628a78a`, préparateur SHA256 **`fae7a8bb007edf368df29e135faa7d2582ef65645fcef68a70565e3a272a013c`**. Source relue identique aux octets qualifiés. [Workflow41153760698](https://github.com/fredbuhr/jessiemessage/actions/runs/41153760698)2/2 :32tests de préparation/préservation,7de publication, sans omission. [Preuve](verification-proofs/jm1120/publication-native.json).

## Prochaine action personnelle

Dans le [terminal Infomaniak](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/ssh-terminal/Node.js/terminal), exécuter le bloc et transmettre le JSON suivi du code CHECK et marqueur final. Ne pas relancer après résultat incomplet/refusé ; ne pas transmettre les journaux privés.

```bash
env -i PATH=/usr/bin:/bin PYTHONDONTWRITEBYTECODE=1 python3 - <<'PY_PREPARE1120'
import hashlib, json, subprocess, urllib.request

url = 'https://raw.githubusercontent.com/fredbuhr/jessiemessage/d7896b6c5fa67dc8e0002f7d7ef86d96e5b506af/ops/prepare-release1120.py'
with urllib.request.urlopen(url, timeout=30) as response:
    if response.status != 200 or response.url != url:
        raise SystemExit('URL_OUTIL_A_VERIFIER')
    code = response.read(65537)
if len(code) > 65536 or hashlib.sha256(code).hexdigest() != 'fae7a8bb007edf368df29e135faa7d2582ef65645fcef68a70565e3a272a013c':
    raise SystemExit('OUTIL1120_A_VERIFIER : aucun outil exécuté.')
ns = {'__name__': 'jm1120_preparation'}
exec(compile(code, '<preparation1120>', 'exec'), ns)
try:
    result = ns['stage'](ns['RELEASE_SOURCE'], ns['RELEASE_TREE'])
except (Exception, KeyboardInterrupt):
    raise SystemExit('PREPARATION1120_NON_CONFIRMEE : conserver les traces, ne pas relancer.') from None
print(json.dumps(result, separators=(',', ':')), flush=True)
try:
    check = subprocess.run(['/bin/bash', result['checkLauncher']], env=ns['clean_environment'](),
        stdin=subprocess.DEVNULL, capture_output=True, timeout=180, check=False)
except (OSError, subprocess.TimeoutExpired, KeyboardInterrupt):
    raise SystemExit('CHECK1120_NON_CONFIRME : conserver les traces, ne pas relancer.') from None
print('CHECK1120_EXIT=' + str(check.returncode), flush=True)
if check.returncode != 0:
    raise SystemExit('CHECK1120_REFUSE : conserver les traces, ne pas relancer.')
print('PREPARATION_1120_CHECK_OK')
PY_PREPARE1120
```

Le préparateur n’installe aucune dépendance et ne démarre pas l’application : il crée le checkout privé, reprend les dépendances1101 strictement identiques, épingle le Node privé24.22.1 et produit les deux lanceurs. La commande appelle ensuite une fois le lanceur CHECK, avec sorties conservées privées. Aucun compte réel n’est examiné ni approuvé par cette préparation ; aucun test client individuel demandé.

## Checkpoint et préservation

Le reçu final1113 n’a pas été rapporté. Le préparateur accepte uniquement les octets connus1112SHA256`3f1ae16dbadcee48643cbd2c0435b3eb5d36870cf72aa26cd080b5a0ac2f400f`, ou la transition1113 dont l’identité source/arbre/lanceurs/Node/profile/SQL est exacte et dont l’inversion en mémoire restitue ce SHA connu. Clés ambiguës, identité inattendue ou dérive d’un autre bloc refusent avant création. Les octets observés sont revérifiés avant/après préparation et leur véritable SHA est enregistré dans le reçu. Le checkpoint, les anciens lanceurs, journaux et configurations restent inchangés. Aucun ancien writer à rejouer.

## Étapes suivantes

Attendre le reçu et CHECK0 avant de modifier le Manager. Le service Node239143, nommé `recette.jessiemessage.com`, dessert aussi le principal ; le site PHP `accueil` n’est pas la cible. [Run/Build](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/h3/118579/nodejs/239143/data/advanced-settings/application), [tableau de bord](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/h3/118579/nodejs/239143/data/dashboard). Le lanceur attendu est `/srv/customer/jessiemessage-private/start-primary-release1120-9bfdae07.sh`, mais l’activation attend la confirmation du reçu. Après démarrage, recueillir l’identité UI1.12.0/source9bfdae07/Nodev24.22.1 et son heure, puis qualifier le writer final lié à cette preuve. Aucun writer1120 fourni à cette étape.
