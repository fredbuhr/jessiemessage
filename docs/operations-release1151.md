# Livraison1.15.1 — parcours d’accès

Source applicative `a4a07f9f31c47a7185b57d11b8277be1d87fd2c1`, arbre `568530e702fa4d0a8a6b1743988c5e20b8656c40`. Node24.22.1, neuf dépendances et schéma attendu38/37tables inchangés. [Diagnostic et couverture](access-reliability-1151.md). La production confirmée reste1.15.0 jusqu’au relevé réel de démarrage1151.

Préparateur `1c37c5b8055a205df71c8fa86555ae34426f2d61`, arbre `8656cddb0886545a50de3785d32a4072bf75315e`, [qualification41612307744](verification-proofs/jm1151/preparation-native.json) :40/40tests natifs sans omission,1/1job, tentative1. Helper24855octets/SHA256 `481ae7f8ad6c9293316993431fe582a4a743554d6645c7f6e0546548c6d1b102`. Les trois fichiers du helper/test/workflow ont été relus identiques au commit qualifié. Les40locaux/40natifs sont le même lot ; cinq tests de liaison ont ensuite contrôlé les pins finaux sans répéter tout le lot local.

La préparation réemploie exactement le vrai `node_modules`1150, via un nouveau lien1151. Neuf versions, onze ressources, graphe complet, lock1150 `1c0f0105…` et inventaire `4df6d0b9…`/1180entrées/988fichiers sont contrôlés avant et après. Aucun npm, nouvelle installation ou smoke de codecs inchangés rejoué. Checkpoint1150 `989de548…`, staging1150 `6384c78b…`, anciens lanceurs, dépendances et configuration préservés. Sorties exclusives, aucun effacement de sortie partielle ni reprise automatique. La préparation ne lance ni CHECK, migration, runtime, changement Manager ou écriture des métadonnées ; le bloc ci-dessous lance séparément le CHECK en lecture seule après le reçu de préparation.

Publication acquise : tag/release/latestv1.15.1/432505702, sourcea4a07f9f, [41613109924](verification-proofs/jm1151/publication-native.json)2/2jobs et24/24tests natifs. Qualification [PR41610784906](verification-proofs/jm1151/pr-native.json) puis [main41612033199](verification-proofs/jm1151/main-native.json)5/5 chacune, même arbre exact ;52omissions générales conservées. Aucune opération hébergée1151 n’est déjà effectuée.

## Étape opérateur suivante

Exécuter le bloc seulement après publicationv1.15.1 et qualification main5/5 enregistrées dans REPRISE. Il est fourni pour une première exécution, jamais pour découvrir le résultat d’une tentative antérieure. À réception d’un résultat partiel/incertain, préserver les traces et examiner l’état durable en lecture seule avant toute suite.

[Terminal SSH Infomaniak](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/ssh-terminal/Node.js/terminal) :

```bash
env -i PATH=/usr/bin:/bin PYTHONDONTWRITEBYTECODE=1 python3 - <<'PY_PREPARE1151'
import hashlib, json, subprocess, urllib.request

url = 'https://raw.githubusercontent.com/fredbuhr/jessiemessage/1c37c5b8055a205df71c8fa86555ae34426f2d61/ops/prepare-release1151.py'
with urllib.request.urlopen(url, timeout=30) as response:
    if response.status != 200 or response.url != url:
        raise SystemExit('URL_OUTIL_A_VERIFIER : aucun outil execute.')
    code = response.read(65537)
if len(code) > 65536 or hashlib.sha256(code).hexdigest() != '481ae7f8ad6c9293316993431fe582a4a743554d6645c7f6e0546548c6d1b102':
    raise SystemExit('OUTIL1151_A_VERIFIER : aucun outil execute.')
ns = {'__name__': 'jm1151_preparation'}
exec(compile(code, '<preparation1151>', 'exec'), ns)
try:
    result = ns['stage'](ns['RELEASE_SOURCE'], ns['RELEASE_TREE'])
except (Exception, KeyboardInterrupt):
    raise SystemExit('PREPARATION1151_NON_CONFIRMEE : conserver les traces, ne pas relancer.') from None
print(json.dumps(result, separators=(',', ':')), flush=True)
try:
    check = subprocess.run(['/bin/bash', result['checkLauncher']], env=ns['clean_environment'](),
        stdin=subprocess.DEVNULL, capture_output=True, timeout=180, check=False)
except (OSError, subprocess.TimeoutExpired, KeyboardInterrupt):
    raise SystemExit('CHECK1151_NON_CONFIRME : conserver les traces, ne pas relancer.') from None
print('CHECK1151_EXIT=' + str(check.returncode), flush=True)
if check.returncode != 0:
    raise SystemExit('CHECK1151_REFUSE : conserver les traces, ne pas relancer.')
print('PREPARATION_1151_CHECK_OK')
PY_PREPARE1151
```

Le JSON de préparation précède le CHECK : ses flags `precheckPassed:false`, `started:false` et ses journaux vides décrivent cet instant, sans invalider un `CHECK1151_EXIT=0` ultérieur. Résultat attendu : reçu source/arbre exacts, `dependenciesReused:true`, `checkpointChanged:false`, puis `CHECK1151_EXIT=0` et `PREPARATION_1151_CHECK_OK`. Aucun démarrage n’est déduit du CHECK.

## Activation et métadonnées

Étapes encore non exécutées. Examiner d’abord le reçu de préparation/CHECK avant toute instruction d’activation. Nouveau checkout prévu `/srv/customer/jessiemessage-operator/production-1151-a4a07f9f` ; lanceurs `start-primary-release1151-a4a07f9f.sh` et `check-primary-release1151-a4a07f9f.sh` dans le dossier privé. Leurs empreintes réelles viendront du reçu ; aucune n’est inventée ici. Les réglages sont à effectuer dans le navigateur ou terminal de l’utilisateur, jamais dans le navigateur cloud.

Après démarrage, vérifier l’identité1.15.1/sourcea4a07f9f/Node24.22.1 et la date réelle avant de préparer un writer1151 qualifié. Ne pas réutiliser le writer1150 ou inventer un démarrage1151. Le repli185 reste qualifié au seul précontrôleSQL38, jamais démarré ; le downgrade du snapshot public n’est pas qualifié,184/172 restent interdits. Sauvegarde manuelle reportée, PC et juridique ne sont pas rouverts.
