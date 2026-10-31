env -i PATH=/usr/bin:/bin PYTHONDONTWRITEBYTECODE=1 python3 - <<'PY_PREPARE1140'
import hashlib, json, subprocess, urllib.request

url = 'https://raw.githubusercontent.com/fredbuhr/jessiemessage/10083087598a96248698cbe76309e1b3afda163c/ops/prepare-release1140.py'
with urllib.request.urlopen(url, timeout=30) as response:
    if response.status != 200 or response.url != url:
        raise SystemExit('URL_OUTIL_A_VERIFIER : aucun outil execute.')
    code = response.read(65537)
if len(code) > 65536 or hashlib.sha256(code).hexdigest() != '4b6d1b3d8212b107ccdfb7fa3a285e93b6936298f685b360423fa31a8ac18686':
    raise SystemExit('OUTIL1140_A_VERIFIER : aucun outil execute.')
ns = {'__name__': 'jm1140_preparation'}
exec(compile(code, '<preparation1140>', 'exec'), ns)
try:
    result = ns['stage'](ns['RELEASE_SOURCE'], ns['RELEASE_TREE'])
except (Exception, KeyboardInterrupt):
    raise SystemExit('PREPARATION1140_NON_CONFIRMEE : conserver les traces, ne pas relancer.') from None
print(json.dumps(result, separators=(',', ':')), flush=True)
try:
    check = subprocess.run(['/bin/bash', result['checkLauncher']], env=ns['clean_environment'](),
        stdin=subprocess.DEVNULL, capture_output=True, timeout=180, check=False)
except (OSError, subprocess.TimeoutExpired, KeyboardInterrupt):
    raise SystemExit('CHECK1140_NON_CONFIRME : conserver les traces, ne pas relancer.') from None
print('CHECK1140_EXIT=' + str(check.returncode), flush=True)
if check.returncode != 0:
    raise SystemExit('CHECK1140_REFUSE : conserver les traces, ne pas relancer.')
print('PREPARATION_1140_CHECK_OK')
PY_PREPARE1140
