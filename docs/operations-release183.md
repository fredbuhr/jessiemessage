# Activer JessieMessage1.8.3

La [préparation et le CHECK183](verification-proofs/jm183-hosted-preparation.json) sont acquis par retour utilisateur le23octobre2026. `PREPARATION_183_CHECK_OK`, source publiée `48fd42b808b2bc4d95d3f3ba21244c032d0a938f`, arbre `1070a2d4db52e92aa020e4cb8c6d4bacaaf06a58`, Nodev24.22.1 ; reçu `4a30e3c82d3cb8bc54b13e24aa8dcf9a9ca5800843f8dac39f96c41eaf0f0a09` recalculé. **Ne pas répéter la préparation ou le CHECK déjà réussis.** Production et checkpoint privé restent1.8.2 jusqu’au relevé de la nouvelle identité. [État de référence](REPRISE.md).

## Action actuelle : configuration et démarrage

Ouvrir [Run et Build Infomaniak](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/h3/118579/nodejs/239143/data/advanced-settings/application), application Node.js nommée `recette.jessiemessage.com`, qui dessert aussi `jessiemessage.com`. Renseigner :

| Champ | Valeur exacte préparée |
| --- | --- |
| Run | `bash /srv/customer/jessiemessage-private/start-primary-release183-48fd42b8.sh` |
| Build | `bash /srv/customer/jessiemessage-private/check-primary-release183-48fd42b8.sh` |
| Port | `3000` |

Enregistrer les commandes. Si l’enregistrement a déjà redémarré le service, passer directement au relevé d’identité. Sinon, ouvrir le [tableau de bord Node](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/h3/118579/nodejs/239143/data/dashboard) et cliquer **Redémarrer** une fois. Aucune migration ni nouvelle configuration privée n’est à lancer.

Après démarrage, ouvrir [la connexion admin](https://jessiemessage.com/admin/login), puis relever dans [État du service](https://jessiemessage.com/admin/readiness) les quatre champs : version1.8.3, commit entier `48fd42b808b2bc4d95d3f3ba21244c032d0a938f`, Nodev24.22.1 et date réelle du démarrage. Recopier cette identité dans la discussion avant l’enregistrement des métadonnées. Le [nouvel accueil admin](https://jessiemessage.com/admin) rassemble les outils ; les clients connectés accèdent à leurs messages par l’adresse principale.

Le writer final épinglé sur le vrai reçu est qualifié26/26 par le [run39867149619](https://github.com/fredbuhr/jessiemessage/actions/runs/39867149619), commit `b672859af00ffab9a59504a7c82406ac1e6db3fa`, SHA256 `1302195773a6568742db82aa0588a3741af299bea706f283a2a0a551f512fa3c`. Son exécution attend cette identité réelle. Ne pas exécuter le writer provisoire de la branche publication ou celui182. Le test de sauvegarde hébergée reste reporté ; aucun message ni notification réel de test n’est envoyé automatiquement.

## Archive de la préparation acquise — ne pas rejouer

Le bloc ci-dessous conserve la commande effectivement exécutée, depuis le commit opérateur `234042bd59d1eb7c4f4ab7d73b665e5f0e2c12a5`, qualifié par le [run39865609026](https://github.com/fredbuhr/jessiemessage/actions/runs/39865609026). Les sorties existantes refusent une répétition automatique ; conserver les fichiers et le reçu.

```bash
env -i PATH=/usr/bin:/bin PYTHONDONTWRITEBYTECODE=1 python3 - <<'PY_JM183'
import hashlib, json, subprocess, sys, urllib.request

url = "https://raw.githubusercontent.com/fredbuhr/jessiemessage/234042bd59d1eb7c4f4ab7d73b665e5f0e2c12a5/ops/prepare-release183.py"
code = urllib.request.urlopen(url, timeout=30).read()
expected_hash = "0b2c280f238b80eb80944623576a5932a9abf41778cb9f215a7036a529b85101"
if hashlib.sha256(code).hexdigest() != expected_hash:
    raise SystemExit("Empreinte incorrecte : arrêt.")

sys.argv = [
    "prepare-release183.py",
    "48fd42b808b2bc4d95d3f3ba21244c032d0a938f",
    "1070a2d4db52e92aa020e4cb8c6d4bacaaf06a58",
]
namespace = {"__name__": "__main__"}
exec(compile(code, "<preparation183>", "exec"), namespace)

plan = namespace["release_plan"](*sys.argv[1:])
subprocess.run(["bash", str(plan["check"])], check=True, timeout=180)
records = [
    json.loads(line)
    for line in namespace["regular"](plan["prelog"], 0o600).splitlines()
]
expected = dict(
    version=2, type="local_closure_precheck", status="passed",
    scope="local_application", pendingClosures=False, started=False,
    erased=False, externalContinuityVerified=False,
)
if not records or any(record != expected for record in records):
    raise SystemExit("CHECK183_A_VERIFIER : ne pas relancer.")

print(json.dumps({key: records[-1][key] for key in (
    "version", "type", "status", "pendingClosures", "started"
)}))
print("PREPARATION_183_CHECK_OK")
PY_JM183
```
