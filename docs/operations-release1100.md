# Livraison 1.10.0 — close et alignée

La 1.10.0 est fusionnée, qualifiée PR/main 5/5 puis publiée (source 51b0cf22…, release/latest 422111737). L’[identité active1100](verification-proofs/jm1100-hosted-identity.json) est rapportée : source51b0cf22…, Node24.22.1, texte UI `23/10/2026 19:43:39`. SQL38 conservé ; checkpoint privé aligné1.10.0 selon le [reçu final utilisateur](verification-proofs/jm1100-hosted-metadata.json), SHA256 `3d60ceb7da3dc61c9ca198ba40a898f6f9ab054650030c7a1632f019ecc73e53`, `publicReady:true`, sans redémarrage. **Aucune commande de livraison restante ; ne rejouer aucun bloc ci-dessous.** Préparation et CHECK1100 acquis selon le [reçu utilisateur](verification-proofs/jm1100-hosted-preparation.json), sans démarrage ni modification Manager/checkpoint.

**Préparation close, ne pas rejouer le bloc ci-dessous.** Empreinte du reçu `ce8d04303cbd04047f6ab5f9f4512351bf236d93fe0b360bf775a790a4bef565`, recalculée depuis les champs rapportés. Le marqueur séparé `PREPARATION_1100_CHECK_OK` confirme la réussite du CHECK selon la commande fournie ; les champs faux et empreintes de journaux vides dans le JSON décrivent son état avant CHECK. L’hôte n’a pas été inspecté directement par l’agent.

## Historique de préparation1100 — déjà exécutée

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

## Activation Manager acquise selon identité utilisateur — référence conservée

Dans le [Run/Build Manager](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/h3/118579/nodejs/239143/data/advanced-settings/application), service Node239143 nommé **recette.jessiemessage.com**, servant aussi jessiemessage.com :

| Champ | Valeur à enregistrer |
| --- | --- |
| **Commande d’exécution, en haut** | `bash /srv/customer/jessiemessage-private/start-primary-release1100-51b0cf22.sh` |
| **Commande de build, en bas** | `bash /srv/customer/jessiemessage-private/check-primary-release1100-51b0cf22.sh` |
| Port |3000, inchangé |

Ces réglages sont la référence demandée avant l’identité1100 rapportée. Ne pas les réappliquer ni redémarrer de nouveau. Les champs Manager ne sont pas relus directement par l’agent ; la preuve acquise est l’identité réelle affichée dans État du service. Node privé24.22.1 conservé.

L’identité acquise est version1.10.0, commit51b0cf22e3adbad7ed26653e96706ba707aaf839, Nodev24.22.1. Le writer final est désormais épinglé au vrai reçu `ce8d04303cbd04047f6ab5f9f4512351bf236d93fe0b360bf775a790a4bef565` et à la release422111737, puis qualifié **13/13** sousNode24.22.1 ; [preuve native](verification-proofs/jm1100/writer-final-native.json). Le writer initial non épinglé ne doit pas être lancé. Checkpoint1100, HTTP publics et publication concordante sont désormais acquis selon le reçu final utilisateur ; l’état190, ses historiques, autres blocs et repli185 sont préservés.

Le profil public est masqué par défaut ; après activation, l’admin choisit explicitement sa présentation et les sélections à publier dans Mon profil → Mon profil public. La page partageable est https://jessiemessage.com/jessie. Les essais sur téléphone réel restent distincts des tests synthétiques.


## Historique — enregistrement final acquis, ne pas rejouer

Dans le [terminal SSH](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/ssh-terminal/Node.js/terminal), exécuter ce bloc une fois. Il vérifie la source réellement démarrée, les HTTP publics, les reçus et la publication, puis aligne les métadonnées privées sans redémarrage ni SQL. L’état190 complet, les historiques, autres blocs et repli185 sont préservés.

```bash
env -i PATH=/usr/bin:/bin PYTHONDONTWRITEBYTECODE=1 python3 - <<'PY_RECORD1100'
import hashlib, urllib.request

url = 'https://raw.githubusercontent.com/fredbuhr/jessiemessage/8882bc7da3170f2f079d163af8f3506ff8cfd2ff/ops/record-release1100.py'
code = urllib.request.urlopen(url, timeout=30).read()
expected = '6d6fc8dae9d46b9a5fa0665b620d06ec6208d3a8bacc261df8be434feaf486a8'
if hashlib.sha256(code).hexdigest() != expected:
    raise SystemExit('Empreinte incorrecte : arrêt.')

exec(compile(code, '<enregistrement1100>', 'exec'), {'__name__': '__main__'})
PY_RECORD1100
```

Le JSON `release1100_metadata_recorded` a été reçu et consigné. Checkpoint1100 aligné, `publicReady:true`, historique190 complet et autres blocs préservés. L’opération est close ; aucun nouveau redémarrage, SQL, sauvegarde hébergée ou parcours PC n’est demandé.
