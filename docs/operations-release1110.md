# Livraison1.11.0 — prochaine action : activation Manager

L’application hébergée reste1.10.1. La1.11.0 est publiée et qualifiée, sans activation attestée. Ce document donne uniquement la prochaine action ; ne rejouer aucune préparation1101, récupération, migration ou ancien writer.

- Source : `88bbb4edfa15e7502c25c5e9e319c36f5f60276d` ; arbre : `513011bfde600b979bd93687ecf47095262caa6a`.
- Tag/release/latest `v1.11.0`, release422775194 ; CI PR40100795293 et main40101446801 chacune5/5.
- Opérateur `79dd0bde2013e862230188292247b311561e5f7e`, publication40101983330 réussie2/2, opérateurs32/32 sousNode24.22.1.
- Préparateur SHA256 `44f30bdd0fdf94eb63eb081a7309b2fe2d8fb6bd7515a82c4d9c52065c1a0c92`.

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

## Activation Manager — à effectuer maintenant

La préparation et le CHECK sont confirmés. Activer dans le [Manager, réglages du service Node](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/h3/118579/nodejs/239143/data/advanced-settings/application), service encore nommé `recette.jessiemessage.com` qui dessert aussi le principal. Les champs sont exécution `bash /srv/customer/jessiemessage-private/start-primary-release1110-88bbb4ed.sh`, build `bash /srv/customer/jessiemessage-private/check-primary-release1110-88bbb4ed.sh`, port3000. Enregistrer ces champs puis redémarrer le service une fois ; ne pas utiliser le site PHP accueil.

Relever ensuite la version1.11.0, le commit88bbb4edfa15e7502c25c5e9e319c36f5f60276d, Nodev24.22.1 et le démarrage dans [l’identité du service](https://jessiemessage.com/admin/readiness). Le writer final sera épinglé et qualifié avec le SHA256 du véritable reçu ; aucun writer provisoire n’est à exécuter. Repli185/SQL38 conservé, jamais démarré ;184/172 interdits. Pas de test de sauvegarde reporté ni de nouvel envoi réel.
