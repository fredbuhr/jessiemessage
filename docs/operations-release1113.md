# Livraison1.11.3 — publiée, préparation suspendue

Le correctif rend la connexion accessible après un lien de confirmation déjà utilisé, expiré ou mal formé. Il propose aussi une sortie explicite et garde le choix du compte jusqu’aux identifiants et à la preuve fraîche du propriétaire. Le backend, les conditions de vérification/approbation, les quotas et les comptes sont inchangés. [Périmètre et limites](invitation-access-1113.md).

**Production confirmée :1.11.2. Préparation, CHECK, activation et enregistrement final1113 non effectués.** [REPRISE](REPRISE.md) reste la référence courante. La connexion directe du compte réel signalé n’a pas été observée par l’agent ; aucune réussite manuelle n’est déduite des essais synthétiques.

## Source et qualifications acquises

- Source : `89571636d6fde97b28b5e8aec9257801c1b71f8b` ; arbre : `e16a22043ea00908afa37cad64e5f9b421f4e5ae`.
- [PR140](https://github.com/fredbuhr/jessiemessage/pull/140) fusionnée ; [CI PR40231447183](verification-proofs/jm1113/pr-native.json) puis [main40232421442](verification-proofs/jm1113/main-native.json) chacune5/5, tentative1, même arbre complet.
- Général4081réussis/0échec/52omissions explicites ; Chrome280/280 ; HTTPS14/14 ; MariaDB10.11 et11.4 chacune608/608 sans omission. Les omissions générales ne sont pas des succès.102tests ciblés, syntaxe778sources, quatre [captures FR/EN320/1280 inspectées](verification-proofs/jm1113/visual-review.json).
- [Tag/release/latest v1.11.3](https://github.com/fredbuhr/jessiemessage/releases/tag/v1.11.3), release423658747 ; [publication40233214193](https://github.com/fredbuhr/jessiemessage/actions/runs/40233214193)2/2 et33tests opérateur natifs. [Preuve](verification-proofs/jm1113/publication-native.json). Aucun déploiement par ce workflow.
- Opérateur immuable : `fead96f4c8bde918dde5c72a1860fe298f47abe3` ; arbre `9d1fe014682919280837df2ec806941212afd7ed`.
- Préparateur SHA256 : `8267f0b8169cc3857503afe16506b471b879a732d458e799b7b17a12363b1916`, relu à cette source et identique aux octets qualifiés.

## Commande conservée — ne pas exécuter pendant le diagnostic

**Suspendu sur instruction utilisateur :** connexion directe toujours refusée, renvoi sans e-mail reçu et page de maintenance signalés après publication. Aucune préparation1113 exécutée. Attendre le diagnostic ciblé indiqué dans REPRISE ; le bloc ci-dessous reste historique, sans autorisation courante de lancement.

Après résolution de cette attente seulement, ouvrir le [terminal Infomaniak](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/ssh-terminal/Node.js/terminal), puis coller le bloc complet une seule fois. Il prépare le nouveau checkout et les lanceurs privés, puis exécute le précontrôle. Il conserve les comptes, la configuration et le checkpoint1112 ; il n’active pas le runtime et n’exécute aucune migration.

```bash
env -i PATH=/usr/bin:/bin PYTHONDONTWRITEBYTECODE=1 python3 - <<'PY_PREPARE1113'
import hashlib, json, subprocess, urllib.request

url = 'https://raw.githubusercontent.com/fredbuhr/jessiemessage/fead96f4c8bde918dde5c72a1860fe298f47abe3/ops/prepare-release1113.py'
with urllib.request.urlopen(url, timeout=30) as response:
    if response.status != 200 or response.url != url:
        raise SystemExit('URL_OUTIL_A_VERIFIER : arrêt.')
    code = response.read(262145)
if len(code) > 262144 or hashlib.sha256(code).hexdigest() != '8267f0b8169cc3857503afe16506b471b879a732d458e799b7b17a12363b1916':
    raise SystemExit('OUTIL1113_A_VERIFIER : aucun outil exécuté.')
ns = {'__name__': 'jm1113_preparation'}
exec(compile(code, '<preparation1113>', 'exec'), ns)
try:
    result = ns['stage']('89571636d6fde97b28b5e8aec9257801c1b71f8b', 'e16a22043ea00908afa37cad64e5f9b421f4e5ae')
except Exception:
    raise SystemExit('PREPARATION1113_NON_CONFIRMEE : conserver les traces, ne pas relancer.') from None
print(json.dumps(result, separators=(',', ':')), flush=True)
try:
    check = subprocess.run(['/bin/bash', result['checkLauncher']], env=ns['clean_environment'](),
        stdin=subprocess.DEVNULL, capture_output=True, timeout=180, check=False)
except (OSError, subprocess.TimeoutExpired):
    raise SystemExit('CHECK1113_NON_CONFIRME : conserver les traces, ne pas relancer.') from None
print('CHECK1113_EXIT=' + str(check.returncode), flush=True)
if check.returncode != 0:
    raise SystemExit('CHECK1113_REFUSE : conserver les traces, ne pas relancer.')
print('PREPARATION_1113_CHECK_OK')
PY_PREPARE1113
```

Recueillir le JSON, `CHECK1113_EXIT=0` et `PREPARATION_1113_CHECK_OK` avant de modifier le Manager. Une sortie interrompue/refusée doit être diagnostiquée à partir des traces ; ne pas relancer la préparation pour découvrir son état.

| Élément attendu après succès | Chemin |
| --- | --- |
| Checkout | `/srv/customer/jessiemessage-operator/production-1113-89571636` |
| Exécution | `/srv/customer/jessiemessage-private/start-primary-release1113-89571636.sh` |
| Précontrôle | `/srv/customer/jessiemessage-private/check-primary-release1113-89571636.sh` |
| Reçu | `/srv/customer/jessiemessage-private/jm1113-staging.json` |

Le helper est lié au checkpoint1112 `3f1ae16dbadcee48643cbd2c0435b3eb5d36870cf72aa26cd080b5a0ac2f400f`, au staging1112 `eef0d3f64599ee5ccfdd1e0a5bd996daf035fa3e79cab957ef7e97a3afaea628`, aux lanceurs1112, à Node24.22.1 privé et au tag/source/arbre exacts. Il réutilise les dépendances1101 après vérification. Aucune sortie1113 existante n’est remplacée.

## Étapes dépendantes encore attendues

Après le reçu de préparation/CHECK, activer ce seul commit depuis le service Node existant, puis recueillir l’identité réellement démarrée. Ensuite qualifier et exécuter le writer1113 : HTTP/publication, métadonnées seules et relecture, sans nouveau redémarrage. Aucun nouveau compte ni code d’invitation à créer pour ce correctif.

La version1112 reste conservée. Repli185 qualifié pourSQL38 seulement, jamais démarré ;184/172 interdits. La limite de lecture du snapshot publicformat2 par les anciens backends1111 et antérieurs reste distincte. Appareils physiques/Safari/Firefox/Push fermé non fraîchement qualifiés, sauvegarde reportée et réservesA10/A11/A12 inchangées.
