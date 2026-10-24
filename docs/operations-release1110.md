# Livraison1.11.0 — prochaine action : enregistrement final

L’application1.11.0 est démarrée selon le [relevé utilisateur](verification-proofs/jm1110/hosted-identity.json) du24octobre à16:59:47Paris, bon commit etNode24.22.1. La préparation, le CHECK et l’activation sont acquis : ne pas les rejouer. Le dernier checkpoint confirmé reste1101 jusqu’au reçu final1110.

- Source : `88bbb4edfa15e7502c25c5e9e319c36f5f60276d` ; arbre : `513011bfde600b979bd93687ecf47095262caa6a`.
- Tag/release/latest `v1.11.0`, release422775194 ; CI PR40100795293 et main40101446801 chacune5/5.
- Opérateur `79dd0bde2013e862230188292247b311561e5f7e`, publication40101983330 réussie2/2, opérateurs32/32 sousNode24.22.1.
- Préparateur SHA256 `44f30bdd0fdf94eb63eb081a7309b2fe2d8fb6bd7515a82c4d9c52065c1a0c92`.

## Enregistrement final à exécuter maintenant

Writer immuable `45b795a8f6dcff452ffb57131e79980448f0440e`, SHA256 `4672bea6395df03036ad482ed89df72314ff657f6d081369159f85bb6c789772`, [qualifié15/15 natifs sousNode24.22.1](verification-proofs/jm1110/writer-final-native.json), run40104619873. Il vérifie les vrais fichiers, démarrage, HTTP publics et publication avant d’aligner les seules métadonnées privées, sans SQL ni redémarrage.

Dans le [terminal Infomaniak](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/ssh-terminal/Node.js/terminal), exécuter une fois :

```bash
env -i PATH=/usr/bin:/bin PYTHONDONTWRITEBYTECODE=1 python3 - <<'PY_RECORD1110'
import hashlib, urllib.request
url = 'https://raw.githubusercontent.com/fredbuhr/jessiemessage/45b795a8f6dcff452ffb57131e79980448f0440e/ops/record-release1110.py'
with urllib.request.urlopen(url, timeout=30) as response:
    if response.status != 200 or response.url != url:
        raise SystemExit('URL_OUTIL_A_VERIFIER : arrêt.')
    code = response.read(262145)
if len(code) > 262144 or hashlib.sha256(code).hexdigest() != '4672bea6395df03036ad482ed89df72314ff657f6d081369159f85bb6c789772':
    raise SystemExit('EMPREINTE_OUTIL_INCORRECTE : aucun outil exécuté.')
exec(compile(code, '<enregistrement1110>', 'exec'), {'__name__': '__main__'})
PY_RECORD1110
```

Transmettre le JSON retourné. Un résultat non confirmé ne justifie pas de relance : conserver les traces et lire l’état durable avant toute reprise. Le relevé d’interface ne remplace pas ce reçu final.

## Historique — préparation et CHECK acquis, ne pas rejouer

**Acquis selon le [reçu utilisateur](verification-proofs/jm1110/hosted-preparation.json)** : CHECK0 puis `PREPARATION_1110_CHECK_OK`, reçuSHA256 `6cbbf3bac780f965646ade8293a55aade3a221581a21f6ddcc7ad8e708293dae` reconstitué identique. Ne rejouer ni préparation ni CHECK. La commande ci-dessous est désormais historique.

L’instruction exécutée était : ouvrir le [terminal SSH Infomaniak](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/ssh-terminal/Node.js/terminal), puis coller cette commande. Elle prépare le checkout exact et lance son CHECK, sans démarrer le service ni modifier le Manager, les clés, la configuration ou le checkpoint. Les dépendances1101 sont réutilisées ; aucune migration ni installation.

```bash
env -i PATH=/usr/bin:/bin PYTHONDONTWRITEBYTECODE=1 python3 - <<'PY_PREPARE1110'
import hashlib, json, subprocess, urllib.request
url = 'https://raw.githubusercontent.com/fredbuhr/jessiemessage/79dd0bde2013e862230188292247b311561e5f7e/ops/prepare-release1110.py'
with urllib.request.urlopen(url, timeout=30) as response:
    if response.status != 200 or response.url != url:
        raise SystemExit('URL_OUTIL_A_VERIFIER : arrêt.')
    code = response.read(262145)
if len(code) > 262144 or hashlib.sha256(code).hexdigest() != '44f30bdd0fdf94eb63eb081a7309b2fe2d8fb6bd7515a82c4d9c52065c1a0c92':
    raise SystemExit('OUTIL1110_A_VERIFIER : aucun outil exécuté.')
ns = {'__name__': 'jm1110_preparation'}
exec(compile(code, '<preparation1110>', 'exec'), ns)
try:
    result = ns['stage']('88bbb4edfa15e7502c25c5e9e319c36f5f60276d', '513011bfde600b979bd93687ecf47095262caa6a')
except Exception:
    raise SystemExit('PREPARATION1110_NON_CONFIRMEE : conserver les traces, ne pas relancer.') from None
print(json.dumps(result, separators=(',', ':')), flush=True)
try:
    check = subprocess.run(['/bin/bash', result['checkLauncher']], env=ns['clean_environment'](),
        stdin=subprocess.DEVNULL, capture_output=True, timeout=180, check=False)
except (OSError, subprocess.TimeoutExpired):
    raise SystemExit('CHECK1110_NON_CONFIRME : conserver les traces, ne pas relancer.') from None
print('CHECK1110_EXIT=' + str(check.returncode), flush=True)
if check.returncode != 0:
    raise SystemExit('CHECK1110_REFUSE : conserver les traces, ne pas relancer.')
print('PREPARATION_1110_CHECK_OK')
PY_PREPARE1110
```

Relever le JSON puis `CHECK1110_EXIT=0` et `PREPARATION_1110_CHECK_OK`. Toute sortie non confirmée conserve son état : lire les traces et le résultat durable avant d’envisager une reprise. Aucun essai de démarrage ne doit être déduit de la préparation.

## Historique — activation Manager rapportée, ne pas rejouer

L’instruction appliquée avant le relevé d’identité était : activer dans le [Manager, réglages du service Node](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/h3/118579/nodejs/239143/data/advanced-settings/application), service encore nommé `recette.jessiemessage.com` qui dessert aussi le principal. Les champs sont exécution `bash /srv/customer/jessiemessage-private/start-primary-release1110-88bbb4ed.sh`, build `bash /srv/customer/jessiemessage-private/check-primary-release1110-88bbb4ed.sh`, port3000. Le démarrage1110 est désormais rapporté ; ne pas redémarrer à nouveau. Les champs Manager n’ont pas été inspectés directement par l’agent.

Le [relevé reçu](verification-proofs/jm1110/hosted-identity.json) indique1.11.0/source88bbb4edfa15e7502c25c5e9e319c36f5f60276d/Nodev24.22.1/démarrage24octobre16:59:47Paris. La précision milliseconde reste à lire dans le vrai journal par le writer. Repli185/SQL38 conservé, jamais démarré ;184/172 interdits. Aucun test de sauvegarde reporté ni nouvel envoi réel.
