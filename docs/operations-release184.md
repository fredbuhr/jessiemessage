# Préparer JessieMessage 1.8.4

Source qualifiée et publiée : `1a41e08abc87c3a29d9163fbf8cd2342eb04693c`, arbre `e0964b50c03d3881d851f01f86f58777d22b2c10`, release421341347. Application active et checkpoint restent1.8.3 / Nodev24.22.1 / SQL36. [État de référence](REPRISE.md).

Ouvrir le [terminal SSH de l’application Node](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/ssh-terminal/Node.js/terminal), puis exécuter une seule fois la commande ci-dessous. Elle prépare le checkout et les lanceurs, puis lance le CHECK séparé. Recueillir le JSON complet et `PREPARATION_184_CHECK_OK` avant l’étape Manager ; en cas de résultat incomplet, inspecter le reçu et les journaux avant toute relance.

```bash
env -i PATH=/usr/bin:/bin PYTHONDONTWRITEBYTECODE=1 python3 - <<'PY_JM184'
import hashlib
import json
import subprocess
import sys
import urllib.request

url = 'https://raw.githubusercontent.com/fredbuhr/jessiemessage/e7e6f11815007a53a9502672500476f6f87e9f25/ops/prepare-release184.py'
expected_sha256 = '3fa75e684177e68cd68d8182f7dca3c10a466c153801a7314c1bf0c779df7b1c'
with urllib.request.urlopen(url, timeout=30) as response:
    code = response.read()
if hashlib.sha256(code).hexdigest() != expected_sha256:
    raise SystemExit('OUTIL184_A_VERIFIER : ne pas relancer.')

sys.argv = ['prepare-release184.py', '1a41e08abc87c3a29d9163fbf8cd2342eb04693c', 'e0964b50c03d3881d851f01f86f58777d22b2c10']
namespace = {'__name__': '__main__'}
exec(compile(code, '<preparation184>', 'exec'), namespace)
plan = namespace['release_plan'](*sys.argv[1:])
subprocess.run(['bash', str(plan['check'])], check=True, timeout=180)
records = [json.loads(line) for line in namespace['regular'](plan['prelog'], 0o600).splitlines()]
expected = dict(version=2, type='local_closure_precheck', status='passed',
    scope='local_application', pendingClosures=False, started=False, erased=False,
    externalContinuityVerified=False)
if not records or any(record != expected for record in records):
    raise SystemExit('CHECK184_A_VERIFIER : ne pas relancer.')
print(json.dumps({key: records[-1][key] for key in ('version', 'type', 'status', 'pendingClosures', 'started')}))
print('PREPARATION_184_CHECK_OK')
PY_JM184
```

Préparateur immuable : `e7e6f11815007a53a9502672500476f6f87e9f25`, SHA-256 `3fa75e684177e68cd68d8182f7dca3c10a466c153801a7314c1bf0c779df7b1c`, qualifié nativement22/22 dans le run39880194316. Configurations `runtime-video-180` et `recurring-backup-052`, Node privé et36migrations conservés ; checkpoint183 protégé par SHA-256 `17f575ebe83d0a9d9acf74e9436bff59eabcf8b5ed1bb8f0f99897c867c78a22`.

L’activation est une étape suivante, à donner seulement après ce retour : checkout prévu `/srv/customer/jessiemessage-operator/production-184-1a41e08a`, lanceur prévu `/srv/customer/jessiemessage-private/start-primary-release184-1a41e08a.sh`. Leurs empreintes finales proviennent du vrai reçu et ne sont pas inventées ici. Aucune activation ni identité184 n’est encore acquise.

Le writer184 publié avec cet opérateur reste inutilisable avant les vrais pins de staging/release : `STAGING_PENDING` et `RELEASE_ID=None`. Ses26tests synthétiques ne remplacent pas la future qualification native avec le vrai reçu. Préserver les historiques183/182/181/180/171/160 et le repli1.7.2 précontrôlé, jamais démarré. Aucune reprise de backup, PC ou action de compte réel.
