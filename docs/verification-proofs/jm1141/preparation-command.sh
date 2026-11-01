env -i PATH=/usr/bin:/bin PYTHONDONTWRITEBYTECODE=1 python3 - <<'PY_PREPARE1141'
import hashlib, json, subprocess, urllib.request

url = 'https://raw.githubusercontent.com/fredbuhr/jessiemessage/fac6890fa0650c785fcbaa464a9d228ba519a312/ops/prepare-release1141.py'
with urllib.request.urlopen(url, timeout=30) as response:
    if response.status != 200 or response.url != url:
        raise SystemExit('URL_OUTIL_A_VERIFIER : aucun outil execute.')
    code = response.read(65537)
if len(code) > 65536 or hashlib.sha256(code).hexdigest() != 'e1ecb05e40667ad4eadbd029c971d9b44b7f68f7f7bec7c6e7d2f52c79ce0197':
    raise SystemExit('OUTIL1141_A_VERIFIER : aucun outil execute.')
ns = {'__name__': 'jm1141_preparation'}
exec(compile(code, '<preparation1141>', 'exec'), ns)
try:
    result = ns['stage'](ns['RELEASE_SOURCE'], ns['RELEASE_TREE'])
except (Exception, KeyboardInterrupt):
    raise SystemExit('PREPARATION1141_NON_CONFIRMEE : conserver les traces, ne pas relancer.') from None
print(json.dumps(result, separators=(',', ':')), flush=True)
try:
    check = subprocess.run(['/bin/bash', result['checkLauncher']], env=ns['clean_environment'](),
        stdin=subprocess.DEVNULL, capture_output=True, timeout=180, check=False)
except (OSError, subprocess.TimeoutExpired, KeyboardInterrupt):
    raise SystemExit('CHECK1141_NON_CONFIRME : conserver les traces, ne pas relancer.') from None
print('CHECK1141_EXIT=' + str(check.returncode), flush=True)
if check.returncode != 0:
    raise SystemExit('CHECK1141_REFUSE : conserver les traces, ne pas relancer.')
print('PREPARATION_1141_CHECK_OK')
PY_PREPARE1141
