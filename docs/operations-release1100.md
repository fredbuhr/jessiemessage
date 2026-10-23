# Livraison 1.10.0 — procédure conservée, préparation suspendue

La 1.10.0 est fusionnée, qualifiée PR/main 5/5 puis publiée (source 51b0cf22…, release/latest 422111737). La production active et son checkpoint restent1.9.0, Node 24.22.1, SQL 38. Aucune opération hébergée 1100 acquise.

**Pause demandée par l’utilisateur avant toute poursuite :** le [contrôle du versionnage et de la conservation métier](version-audit-1100.md) précède une éventuelle reprise. Ne pas exécuter les commandes ci-dessous pendant cette pause ; aucun reçu de préparation1100 n’est acquis.

## Préparer sans arrêter 190 — après décision de reprise

Dans le [terminal SSH Infomaniak](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/ssh-terminal/Node.js/terminal), exécuter ce bloc une fois. Il crée un nouveau checkout et ses lanceurs, puis lance seulement le CHECK. Aucune migration SQL, aucun démarrage ou changement de Manager/checkpoint.

```bash
env -i PATH=/usr/bin:/bin PYTHONDONTWRITEBYTECODE=1 python3 - <<'PY_PREPARE1100'
import hashlib, json, subprocess, urllib.request

url = 'https://raw.githubusercontent.com/fredbuhr/jessiemessage/6836e25df78e6b7c7f2f0b53650ca16efd4dc3ea/ops/prepare-release1100.py'
code = urllib.request.urlopen(url, timeout=30).read()
if hashlib.sha256(code).hexdigest() != '927ab81fd80c79d03badd2f83ecfa7125f572301833768e9088adefc39939a28':
    raise SystemExit('OUTIL1100_A_VERIFIER : arrêt.')
ns = {'__name__': 'jm1100_preparation'}
exec(compile(code, '<preparation1100>', 'exec'), ns)
try:
    result = ns['stage']('51b0cf22e3adbad7ed26653e96706ba707aaf839', '190024a2f30258554e4a18ff6ae18e2be08c8d7b')
except Exception:
    raise SystemExit('PREPARATION1100_NON_CONFIRMEE : ne pas relancer.')
print(json.dumps(result, separators=(',', ':')), flush=True)
try:
    check = subprocess.run(['/bin/bash', result['checkLauncher']], env=ns['clean_environment'](),
        stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=180)
except (OSError, subprocess.TimeoutExpired):
    raise SystemExit('CHECK1100_NON_CONFIRME : ne pas relancer.')
if check.returncode != 0:
    raise SystemExit('CHECK1100_REFUSE : ne pas relancer.')
print('PREPARATION_1100_CHECK_OK')
PY_PREPARE1100
```

Recueillir le JSON de préparation et `PREPARATION_1100_CHECK_OK`. La présence d’un reçu n’atteste pas à elle seule le CHECK : le marqueur suivant est séparé. Si la commande échoue ou est interrompue, conserver les sorties et inspecter les fichiers/reçus avant de reprendre ; ne pas la rejouer pour découvrir son résultat.

## Étapes suivantes, non encore demandées

Après validation du reçu, les champs Manager du service Node 239143, nommé recette et servant aussi jessiemessage.com, devront pointer vers les nouveaux lanceurs : **Commande d’exécution en haut → start1100**, **Commande de build en bas → check1100**. Ne pas les modifier avant le reçu. Port 3000 et Node privé24.22.1 conservés.

L’identité attendue sera version 1.10.0, commit 51b0cf22e3adbad7ed26653e96706ba707aaf839, Node v24.22.1. Après le démarrage, qualifier le writer final sur le vrai reçu et release 422111737 avant de l’exécuter. Le writer actuellement publié est volontairement en attente et ne doit pas être lancé.

Le profil public est masqué par défaut ; après activation, l’admin choisit explicitement sa présentation et les sélections à publier dans Mon profil → Mon profil public. La page partageable est https://jessiemessage.com/jessie. Les essais sur téléphone réel restent distincts des tests synthétiques.
