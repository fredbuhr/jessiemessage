# Historique 1.12.0 — démarrage acquis, enregistrement final absent du checkpoint

La [release v1.12.0](https://github.com/fredbuhr/jessiemessage/releases/tag/v1.12.0), ID429632868, a été publiée, latest à cette livraison, sur la source **`9bfdae07797f4e848964422471da67560c7d94eb`**, arbre **`4aef91b8aea6e811af74b28a52e69f9481f62592`**. [PR143](verification-proofs/jm1120/one-click-pr-native.json) puis [main41153045628](verification-proofs/jm1120/one-click-main-native.json)5/5, tentative1. La publication ne constitue pas un déploiement.

Opérateur **`d7896b6c5fa67dc8e0002f7d7ef86d96e5b506af`**, arbre `644c887f9614d84edbd9f0d0f3f09cca8628a78a`, préparateur SHA256 **`fae7a8bb007edf368df29e135faa7d2582ef65645fcef68a70565e3a272a013c`**. Source relue identique aux octets qualifiés. [Workflow41153760698](https://github.com/fredbuhr/jessiemessage/actions/runs/41153760698)2/2 :32tests de préparation/préservation,7de publication, sans omission. [Preuve](verification-proofs/jm1120/publication-native.json).

## Activation personnelle — acquise, ne pas rejouer

La [préparation/CHECK hébergés](verification-proofs/jm1120/hosted-preparation.json) sont acquis selon le reçu utilisateur : SHA canonique`692d55985dbdb4c76d066fe90d434f35d17266c6b59ea25124725cc024751578` vérifié, `CHECK1120_EXIT=0` et marqueur final. Les flags faux du staging restent le snapshot précédant le CHECK. Ce staging précède le CHECK ; le [relevé suivant](verification-proofs/jm1120/hosted-identity.json) confirme séparément1.12.0/source9bfdae07/Node24.22.1,31octobre02:29:16Paris. Préparation, CHECK et activation acquis ; ne pas les rejouer. Les réglages ci-dessous documentent l’activation effectuée.

1. Ouvrir [Run/Build du service Node239143](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/h3/118579/nodejs/239143/data/advanced-settings/application), nommé **recette.jessiemessage.com**, qui dessert aussi **jessiemessage.com**.
2. Renseigner :

| Champ | Valeur1120 |
| --- | --- |
| Commande d’exécution — champ du haut | `bash /srv/customer/jessiemessage-private/start-primary-release1120-9bfdae07.sh` |
| Commande de build — champ du bas | `bash /srv/customer/jessiemessage-private/check-primary-release1120-9bfdae07.sh` |
| Port | `3000` |

3. Enregistrer. Si cela relance déjà l’application, attendre ; sinon cliquer **Redémarrer** dans le [tableau de bord Node.js](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/h3/118579/nodejs/239143/data/dashboard). Une seule activation.
4. Ouvrir [État du service](https://jessiemessage.com/admin/readiness) et transmettre Version de l’application, Commit au démarrage, Version Node.js et Relevé au démarrage. Attendus :1.12.0, `9bfdae07797f4e848964422471da67560c7d94eb`, `v24.22.1`, nouvelle date.

## Historique — préparation/CHECK acquis, ne pas rejouer

Le bloc exécuté dans le [terminal Infomaniak](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/ssh-terminal/Node.js/terminal) était le suivant. Son résultat est acquis ; aucune relance SSH requise. Après résultat incomplet/refusé, conserver les traces sans transmettre de journal privé.

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

## Enregistrement final — historique, ne pas rejouer

La [lecture seule acquise pour1130](verification-proofs/jm1130/hosted-checkpoint-inspection.json) retrouve exactement le checkpoint1112, sans section1120. La commande ci-dessous avait été fournie mais son résultat n’avait pas été communiqué ; elle est conservée comme historique et ne doit pas être rejouée. La suite actuelle est uniquement décrite dans [REPRISE](REPRISE.md) et le [guide1130](operations-release1130.md). Le démarrage1120 reste acquis.

L’activation est rapportée :1.12.0, source9bfdae07, Node24.22.1,31octobre2026 **02:29:16 Europe/Paris**, secondeUTC1793410156. Ne pas redémarrer.

Le [writer1120](https://github.com/fredbuhr/jessiemessage/blob/e2828cb96e8831ce5b01900380705f0666137d17/ops/record-release1120.py) est [qualifié24/24 natifs](verification-proofs/jm1120/writer-final-native.json), run41155948468,1/1, tentative1, sans omission. Source relue identique aux octets qualifiés, SHA256 `b0e7b06b18f4215412e06a0f2551fd02d5c31fc7a643ca58dc6ee0ce745408b7`. Qualification sur fichiers synthétiques : elle n’est pas son exécution sur l’hôte.

Le bloc ancien fourni était le suivant ; **ne pas l’exécuter** pour découvrir ou corriger le résultat absent :

```bash
env -i PATH=/usr/bin:/bin PYTHONDONTWRITEBYTECODE=1 python3 - <<'PY_RECORD1120'
import hashlib, urllib.request

url = 'https://raw.githubusercontent.com/fredbuhr/jessiemessage/e2828cb96e8831ce5b01900380705f0666137d17/ops/record-release1120.py'
with urllib.request.urlopen(url, timeout=30) as response:
    if response.status != 200 or response.url != url:
        raise SystemExit('URL_OUTIL_A_VERIFIER : arrêt.')
    code = response.read(65537)
if len(code) > 65536 or hashlib.sha256(code).hexdigest() != 'b0e7b06b18f4215412e06a0f2551fd02d5c31fc7a643ca58dc6ee0ce745408b7':
    raise SystemExit('EMPREINTE_OUTIL_INCORRECTE : aucun outil exécuté.')
exec(compile(code, '<enregistrement1120>', 'exec'), {'__name__': '__main__'})
PY_RECORD1120
```

Le script vérifie les sources/tags/versions, dépendances et migrations inchangées, reçus/lanceurs/Node/configuration épinglés, précontrôles acquis, unique démarrage1120 à la seconde rapportée, GET publics health/ready/home/entry et release/latest. Il enregistre ensuite atomiquement les seules métadonnées1120 dans le checkpoint privé ; aucun accès SQL, démarrage, Manager, mail ou compte réel modifié. Le baseline1112 exact et tous ses anciens blocs sont préservés, ainsi que les reçus1113 ; aucune finalisation1113 absente n’est inventée. Le repli185 reste qualifiéSQL seulement, snapshot publicformat2 non qualifié.

La lecture durable ne contient pas d’enregistrement1120. Conserver cet état et les traces historiques ; aucun ancien writer à rejouer. Les GET publics ne prouvent pas le commit du processus ; PID/socket/binaire exécuté et appareils physiques restent non qualifiés.
