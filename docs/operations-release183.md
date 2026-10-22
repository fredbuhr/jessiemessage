# Préparer puis activer JessieMessage1.8.3

La source publiée et qualifiée est `48fd42b808b2bc4d95d3f3ba21244c032d0a938f`, arbre `1070a2d4db52e92aa020e4cb8c6d4bacaaf06a58`. Tag/release/latestv1.8.3 acquis, release421266798 ; production et checkpoint privé encore1.8.2/SQL36. [État de référence](REPRISE.md). Les opérations182 sont closes et ne sont pas à répéter.

## Action actuelle : préparation et CHECK

Ouvre le [terminal SSH Infomaniak](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/ssh-terminal/Node.js/terminal), puis colle ce bloc entier une seule fois. Le helper provient du commit opérateur immuable `234042bd59d1eb7c4f4ab7d73b665e5f0e2c12a5`, qualifié par le [run39865609026](https://github.com/fredbuhr/jessiemessage/actions/runs/39865609026). Son empreinte est vérifiée avant exécution.

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

Cette étape prépare les sources et lance le précontrôle ; elle ne démarre pas l’application. Elle conserve l’actif182, SQL36, Node24.22.1, la configuration et le checkpoint. Le reçu JSON indique notamment `receiptSha256`, les lanceurs et leurs empreintes. **Recopier la sortie complète dans la discussion et attendre sa vérification avant de modifier Manager.** En cas de refus ou d’interruption, conserver les fichiers et la sortie : examiner cet état avant de décider d’une reprise, car une sortie déjà créée interdit une répétition automatique.

## Suite après validation du vrai reçu

Cette suite n’est pas encore exécutée. Une fois le reçu vérifié et `PREPARATION_183_CHECK_OK` acquis, ouvrir [Run et Build Infomaniak](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/h3/118579/nodejs/239143/data/advanced-settings/application), application Node.js nommée `recette.jessiemessage.com`, qui dessert aussi `jessiemessage.com`. Renseigner :

| Champ | Valeur préparée attendue |
| --- | --- |
| Run | `bash /srv/customer/jessiemessage-private/start-primary-release183-48fd42b8.sh` |
| Build | `bash /srv/customer/jessiemessage-private/check-primary-release183-48fd42b8.sh` |
| Port | `3000` |

Enregistrer les commandes, puis effectuer le redémarrage depuis le [tableau de bord Node](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/h3/118579/nodejs/239143/data/dashboard). Si Manager a déjà redémarré le service, relever d’abord son identité et son journal avant toute répétition. Aucune migration ni nouvelle configuration n’est à lancer.

Après démarrage, ouvrir [la connexion admin](https://jessiemessage.com/admin/login), puis relever dans [État du service](https://jessiemessage.com/admin/readiness) les quatre champs : version1.8.3, commit entier48fd42b8…, Nodev24.22.1 et date réelle du démarrage. Le [nouvel accueil admin](https://jessiemessage.com/admin) rassemble les outils ; les clients connectés accèdent à leurs messages par l’adresse principale.

L’enregistrement final des métadonnées attend ce reçu et cette identité. Le writer conservé sur la branche opérateur reste volontairement bloqué tant que son empreinte de staging et la release réelle ne sont pas fixées et qualifiées ensemble par sa CI native. Ne pas exécuter ce writer provisoire ni celui182. Le test de sauvegarde hébergée reste reporté ; aucun message ni notification de test réel n’est envoyé automatiquement.
