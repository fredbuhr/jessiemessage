env -i PATH=/usr/bin:/bin PYTHONDONTWRITEBYTECODE=1 python3 - <<'PY_RECORD1141'
import hashlib, urllib.request

url = 'https://raw.githubusercontent.com/fredbuhr/jessiemessage/e6bfd8aa4e50c04f5b51cafe1abb309dd9c2fc57/ops/record-release1141.py'
with urllib.request.urlopen(url, timeout=30) as response:
    if response.status != 200 or response.url != url:
        raise SystemExit('URL_OUTIL_A_VERIFIER : arret.')
    code = response.read(65537)
if len(code) > 65536 or hashlib.sha256(code).hexdigest() != '83b0c3da69dc50e4263632138ba163dc40efc249b5aacffef6a19af653c83ef0':
    raise SystemExit('EMPREINTE_OUTIL_INCORRECTE : aucun outil execute.')
exec(compile(code, '<enregistrement1141>', 'exec'), {'__name__': '__main__'})
PY_RECORD1141
