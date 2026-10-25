# Livraison1.11.3 — préparation et CHECK acquis, activation attendue

Le correctif rend la connexion accessible après un lien de confirmation déjà utilisé, expiré ou mal formé. Il propose aussi une sortie explicite et garde le choix du compte jusqu’aux identifiants et à la preuve fraîche du propriétaire. Le backend, les conditions de vérification/approbation, les quotas et les comptes sont inchangés. [Périmètre et limites](invitation-access-1113.md).

**Production confirmée :1.11.2. Préparation et CHECK1113 rapportés réussis ; activation et enregistrement final1113 encore attendus.** [REPRISE](REPRISE.md) reste la référence courante. La connexion du compte signalé est désormais [rapportée réussie par l’utilisateur](verification-proofs/jm1113/hosted-login-confirmation.json), sans inspection de sa session par l’agent. Le diagnostic d’accès est clos ; aucune cause certaine de l’ancien refus n’est déduite.

## Source et qualifications acquises

- Source : `89571636d6fde97b28b5e8aec9257801c1b71f8b` ; arbre : `e16a22043ea00908afa37cad64e5f9b421f4e5ae`.
- [PR140](https://github.com/fredbuhr/jessiemessage/pull/140) fusionnée ; [CI PR40231447183](verification-proofs/jm1113/pr-native.json) puis [main40232421442](verification-proofs/jm1113/main-native.json) chacune5/5, tentative1, même arbre complet.
- Général4081réussis/0échec/52omissions explicites ; Chrome280/280 ; HTTPS14/14 ; MariaDB10.11 et11.4 chacune608/608 sans omission. Les omissions générales ne sont pas des succès.102tests ciblés, syntaxe778sources, quatre [captures FR/EN320/1280 inspectées](verification-proofs/jm1113/visual-review.json).
- [Tag/release/latest v1.11.3](https://github.com/fredbuhr/jessiemessage/releases/tag/v1.11.3), release423658747 ; [publication40233214193](https://github.com/fredbuhr/jessiemessage/actions/runs/40233214193)2/2 et33tests opérateur natifs. [Preuve](verification-proofs/jm1113/publication-native.json). Aucun déploiement par ce workflow.
- Opérateur immuable : `fead96f4c8bde918dde5c72a1860fe298f47abe3` ; arbre `9d1fe014682919280837df2ec806941212afd7ed`.
- Préparateur SHA256 : `8267f0b8169cc3857503afe16506b471b879a732d458e799b7b17a12363b1916`, relu à cette source et identique aux octets qualifiés.

## Prochaine action unique — activation dans le Manager

La [préparation et son CHECK sont acquis selon le reçu utilisateur](verification-proofs/jm1113/hosted-preparation.json) : empreinte canonique identique `7c1a51e0033e329b3daaf3ee8895a989f67e13c42199f7c4e6ac2907afbd8282`, `CHECK1113_EXIT=0` et `PREPARATION_1113_CHECK_OK`. Les flags faux et empreintes de logs vides du staging décrivent l’état avant ce CHECK séparé. Ne pas rejouer la commande SSH. Aucune inspection directe des fichiers privés, champs Manager ou processus n’est déduite du reçu.

1. Ouvrir les [réglages de l’application Node239143](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/h3/118579/nodejs/239143/data/advanced-settings/application). Le service reste nommé **recette.jessiemessage.com** et dessert aussi **jessiemessage.com**.
2. Renseigner les champs suivants :

| Champ | Valeur1113 préparée |
| --- | --- |
| Commande d’exécution — champ du haut | `bash /srv/customer/jessiemessage-private/start-primary-release1113-89571636.sh` |
| Commande de build — champ du bas | `bash /srv/customer/jessiemessage-private/check-primary-release1113-89571636.sh` |
| Port | `3000` |

3. Enregistrer les valeurs. Si cela déclenche déjà le redémarrage, attendre sa fin ; sinon, cliquer **Redémarrer** depuis le [tableau de bord Node.js](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/h3/118579/nodejs/239143/data/dashboard). Une seule activation est nécessaire.
4. Ouvrir [État du service](https://jessiemessage.com/admin/readiness) et recueillir **Version de l’application**, **Commit au démarrage**, **Version Node.js** et **Relevé au démarrage**. Valeurs attendues :1.11.3, `89571636d6fde97b28b5e8aec9257801c1b71f8b`, `v24.22.1`, nouvelle date de démarrage. Recueillir l’identité avant de qualifier le writer final ; la configuration attendue ne prouve pas le code réellement exécuté.

## Historique — préparation et CHECK acquis, ne pas rejouer

La suspension liée au diagnostic est levée après la connexion réussie rapportée. La PR fusionnée, la qualification main, le tag et le préparateur ont été relus inchangés. Aucun nouveau contrôle des identifiants n’est requis pour cette étape.

La commande déjà exécutée une fois dans le [terminal Infomaniak](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/ssh-terminal/Node.js/terminal) était le bloc ci-dessous. Elle préparait le nouveau checkout et les lanceurs privés, puis exécutait le précontrôle. Il conserve les comptes, la configuration et le checkpoint1112 ; il n’active pas le runtime et n’exécute aucune migration.

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

Le JSON, `CHECK1113_EXIT=0` et `PREPARATION_1113_CHECK_OK` sont désormais reçus et conservés. Aucune relance de cette commande n’est requise.

| Élément préparé selon le reçu | Chemin |
| --- | --- |
| Checkout | `/srv/customer/jessiemessage-operator/production-1113-89571636` |
| Exécution | `/srv/customer/jessiemessage-private/start-primary-release1113-89571636.sh` |
| Précontrôle | `/srv/customer/jessiemessage-private/check-primary-release1113-89571636.sh` |
| Reçu | `/srv/customer/jessiemessage-private/jm1113-staging.json` |

Le helper est lié au checkpoint1112 `3f1ae16dbadcee48643cbd2c0435b3eb5d36870cf72aa26cd080b5a0ac2f400f`, au staging1112 `eef0d3f64599ee5ccfdd1e0a5bd996daf035fa3e79cab957ef7e97a3afaea628`, aux lanceurs1112, à Node24.22.1 privé et au tag/source/arbre exacts. Il réutilise les dépendances1101 après vérification. Aucune sortie1113 existante n’est remplacée.

## Étapes dépendantes encore attendues

Après l’activation Manager décrite plus haut, recueillir l’identité réellement démarrée. Qualifier ensuite le writer1113 lié à ce relevé, puis l’exécuter : HTTP/publication, métadonnées seules et relecture, sans nouveau redémarrage. Aucun nouveau compte ni code d’invitation à créer pour ce correctif.

La version1112 reste conservée. Repli185 qualifié pourSQL38 seulement, jamais démarré ;184/172 interdits. La limite de lecture du snapshot publicformat2 par les anciens backends1111 et antérieurs reste distincte. Appareils physiques/Safari/Firefox/Push fermé non fraîchement qualifiés, sauvegarde reportée et réservesA10/A11/A12 inchangées.
