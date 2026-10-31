env -i PATH=/usr/bin:/bin PYTHONDONTWRITEBYTECODE=1 python3 - <<'PY_RECORD1140'
import hashlib, urllib.request

url = 'https://raw.githubusercontent.com/fredbuhr/jessiemessage/59e6f8cc7f12d8b36e4c9bdbeec543d02becc9ff/ops/record-release1140.py'
with urllib.request.urlopen(url, timeout=30) as response:
    if response.status != 200 or response.url != url:
        raise SystemExit('URL_OUTIL_A_VERIFIER : arret.')
    code = response.read(65537)
if len(code) > 65536 or hashlib.sha256(code).hexdigest() != '942429e1cfa44fd35dea8fd4cdae4319a5e1e7f5edbf0c756202f1dd3fd3faf1':
    raise SystemExit('EMPREINTE_OUTIL_INCORRECTE : aucun outil execute.')
exec(compile(code, '<enregistrement1140>', 'exec'), {'__name__': '__main__'})
PY_RECORD1140
