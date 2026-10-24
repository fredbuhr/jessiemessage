# Livraison 1.11.1 — prochaine action : activation

Le correctif remplace les lignes répétées par **le dernier message reçu de chaque client**, une seule ligne par client, avec les conversations non lues d’abord. Production confirmée :1.11.0 ; aucune activation1111 n’est déduite de la publication.

- Source : `80b7fbf5f9b5ba32ac1aae817043126e93025946` ; arbre : `ba1289bae9ce095560922a7ed6665f17709d07ed`.
- [PR138](https://github.com/fredbuhr/jessiemessage/pull/138), CI PR40109325838 acquise5/5 après reprise du seul job HTTPS initialement en échec. [Preuve](verification-proofs/jm1111/pr-native.json), [échec conservé](verification-proofs/jm1111/pr-initial-failure.json).
- [CI main40110183520](https://github.com/fredbuhr/jessiemessage/actions/runs/40110183520)5/5 dès la tentative1, Node24.22.1 : général4058 réussis/52 omissions, Chrome272/272, HTTPS12/12, MariaDB605/605 chacune. [Preuve](verification-proofs/jm1111/main-native.json).
- Tag/release/latest `v1.11.1`, release422839761 ; [publication40110800429](https://github.com/fredbuhr/jessiemessage/actions/runs/40110800429)2/2, préparateur26/26 et publisher7/7 natifs. [Preuve](verification-proofs/jm1111/publication-native.json).
- Opérateur immuable : `9f4ff39e2de9198e29256587d5fa0075977788b1`, préparateur SHA256 `ce06046ac5c76f8d2a940cb9dc4525e28d3bc06f5b3c708c87606bbc74b5e9b0`.

## Prochaine action — activation unique dans le Manager

La [préparation et le CHECK sont acquis selon le reçu utilisateur](verification-proofs/jm1111/hosted-preparation.json) : reçuSHA256 `6b3d46c260be82a3474c71e303726e8532d1e6a5156c01f9ed464ba8f0aa688f`, reconstitution canonique identique, `CHECK1111_EXIT=0`, `PREPARATION_1111_CHECK_OK`. Ne pas les rejouer. Le reçu conserve ses indicateurs d’avant CHECK, sans démarrage déduit.

Ouvrir le [Manager, réglages de l’application Node239143](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/h3/118579/nodejs/239143/data/advanced-settings/application). Le service est encore nommé `recette.jessiemessage.com` et dessert aussi `jessiemessage.com`.

| Champ | Valeur1111 |
| --- | --- |
| Commande d’exécution — champ du haut | `bash /srv/customer/jessiemessage-private/start-primary-release1111-80b7fbf5.sh` |
| Commande de build — champ du bas | `bash /srv/customer/jessiemessage-private/check-primary-release1111-80b7fbf5.sh` |
| Port | `3000` |

Enregistrer les réglages et redémarrer le service **une seule fois**. Ouvrir ensuite la [page de vérification de l’application](https://jessiemessage.com/admin/readiness) : attendre version1.11.1, commit `80b7fbf5f9b5ba32ac1aae817043126e93025946`, Nodev24.22.1, puis relever l’heure de démarrage. Aucun de ces champs Manager ou démarrage n’est encore observé directement par l’agent.

## Historique — préparation et CHECK acquis, ne pas rejouer

Le préparateur épinglé ci-dessous est qualifié nativement26/26. Il exige le checkpoint1110 confirmé, les lanceurs et la source active1110 exacts, ainsi que le lien de dépendances1110 vers la racine privée1101 attendue. Les33 fichiers SQL normaux,3vidéo et2expérience doivent rester identiques ; toute sortie existante est préservée et refuse une répétition automatique.

L’instruction exécutée était : dans le [terminal SSH Infomaniak](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/ssh-terminal/Node.js/terminal), la commande ci-dessous préparait un nouveau checkout exact, réutilise les dépendances1101 déjà liées à1110, puis lance son CHECK. Elle ne démarre pas le service et ne modifie ni Manager, configuration, clés ou checkpoint.

```bash
env -i PATH=/usr/bin:/bin PYTHONDONTWRITEBYTECODE=1 python3 - <<'PY_PREPARE1111'
import hashlib, json, subprocess, urllib.request
url = 'https://raw.githubusercontent.com/fredbuhr/jessiemessage/9f4ff39e2de9198e29256587d5fa0075977788b1/ops/prepare-release1111.py'
with urllib.request.urlopen(url, timeout=30) as response:
    if response.status != 200 or response.url != url:
        raise SystemExit('URL_OUTIL_A_VERIFIER : arrêt.')
    code = response.read(262145)
if len(code) > 262144 or hashlib.sha256(code).hexdigest() != 'ce06046ac5c76f8d2a940cb9dc4525e28d3bc06f5b3c708c87606bbc74b5e9b0':
    raise SystemExit('OUTIL1111_A_VERIFIER : aucun outil exécuté.')
ns = {'__name__': 'jm1111_preparation'}
exec(compile(code, '<preparation1111>', 'exec'), ns)
try:
    result = ns['stage']('80b7fbf5f9b5ba32ac1aae817043126e93025946', 'ba1289bae9ce095560922a7ed6665f17709d07ed')
except Exception:
    raise SystemExit('PREPARATION1111_NON_CONFIRMEE : conserver les traces, ne pas relancer.') from None
print(json.dumps(result, separators=(',', ':')), flush=True)
try:
    check = subprocess.run(['/bin/bash', result['checkLauncher']], env=ns['clean_environment'](),
        stdin=subprocess.DEVNULL, capture_output=True, timeout=180, check=False)
except (OSError, subprocess.TimeoutExpired):
    raise SystemExit('CHECK1111_NON_CONFIRME : conserver les traces, ne pas relancer.') from None
print('CHECK1111_EXIT=' + str(check.returncode), flush=True)
if check.returncode != 0:
    raise SystemExit('CHECK1111_REFUSE : conserver les traces, ne pas relancer.')
print('PREPARATION_1111_CHECK_OK')
PY_PREPARE1111
```

Le JSON, `CHECK1111_EXIT=0` et `PREPARATION_1111_CHECK_OK` sont désormais conservés dans la preuve utilisateur. Aucune relance de cette commande n’est nécessaire.

## Enregistrement final après le relevé d’identité

Après activation et lecture de l’identité, l’enregistrement final sera épinglé au vrai reçu de préparation avant toute écriture. Ces étapes ne sont pas encore réalisées. SQL38, les37 tables qualifiées, le catalogue et les dépendances sont inchangés. Repli185 conservé compatibleSQL38, jamais démarré ;184/172 interdits. Aucun nouveau test de sauvegarde, PC, envoi réel ou publication du profil public.
