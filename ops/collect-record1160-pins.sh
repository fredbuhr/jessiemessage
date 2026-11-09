env -i PATH=/usr/bin:/bin PYTHONDONTWRITEBYTECODE=1 python3 - <<'PY_RECORD1160_PINS'
import base64, datetime, hashlib, hmac, json, os, re, stat, subprocess
from pathlib import Path
P = Path('/srv/customer/jessiemessage-private')
SOURCE = 'd2b57fb88d58aacf64dd51c5d1952c65f5c327ae'
TREE = '632ec530d812fa75cf2aa4b603c91c81dcaf7e8e'
CHECKOUT = Path('/srv/customer/jessiemessage-operator/production-1160-d2b57fb8')
STAGE = '3f0839dc9153fc4b38dbcad7b8084690e6953c72e48127facab6eb47bb831827'
START = 'dd495e038de3b7afe3ca4bd60653a00243b55038ab68bd2440a8c566921f4386'
CHECK = '703beb28850f15095cecf89cd453118c20f9b776444336b223158e9bfccd0feb'
sha = lambda data: hashlib.sha256(data).hexdigest()
js = lambda value: json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode()
def check(ok):
    if not ok: raise ValueError()
def private_dir(path):
    info = path.lstat()
    check(path.is_absolute() and path.resolve(strict=True) == path and stat.S_ISDIR(info.st_mode)
          and info.st_uid == os.getuid() and stat.S_IMODE(info.st_mode) == 0o700)
    return info
def read(path, limit, mode=0o600):
    check(path.resolve(strict=True) == path)
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK), 'rb') as stream:
        def identity(info):
            return (info.st_dev, info.st_ino, info.st_mode, info.st_uid, info.st_nlink,
                    info.st_size, info.st_mtime_ns, info.st_ctime_ns)
        before = os.fstat(stream.fileno())
        check(stat.S_ISREG(before.st_mode) and before.st_uid == os.getuid() and before.st_nlink == 1
              and stat.S_IMODE(before.st_mode) == mode and before.st_size <= limit)
        data = stream.read(limit+1)
        check(len(data) == before.st_size and identity(before) == identity(os.fstat(stream.fileno()))
              == identity(path.lstat()))
        return data
def git(*args):
    return subprocess.run(['/usr/bin/git', '--no-optional-locks', '-c', 'core.fsmonitor=false',
        '-c', 'core.hooksPath=/dev/null', '-C', str(CHECKOUT), *args],
        env=dict(PATH='/usr/bin:/bin', GIT_CONFIG_NOSYSTEM='1', GIT_CONFIG_GLOBAL='/dev/null',
                 GIT_NO_REPLACE_OBJECTS='1', GIT_OPTIONAL_LOCKS='0'),
        stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
        timeout=15, check=True).stdout.decode().strip()
def marker(kind):
    config = json.loads(read(P / 'runtime-video-180' / ('runtime-' + kind + '.json'), 16384))
    value = config[kind + 'Root']; root = Path(value)
    check(isinstance(value, str) and str(root) == value and root != root.parent
          and '\\' not in value and not re.search(r'[\x00-\x1f\x7f]', value))
    live = private_dir(root); private_dir(root.parent)
    marker_path = root.parent / ('binding-' + sha(js([kind, value])) + '.json')
    raw = read(marker_path, 512); record = json.loads(raw)
    fields = ('revision', 'inode', 'previousDevice', 'currentDevice', 'signature')
    check(type(record) is dict and set(record) == set(fields)
          and type(record['revision']) is int and record['revision'] == 1
          and raw == js({field:record[field] for field in fields}) + b'\n')
    inode, old, current, signature = (record[field] for field in fields[1:])
    check(inode == str(live.st_ino) and current == str(live.st_dev) and old != current
          and isinstance(old, str) and re.fullmatch(r'0|[1-9][0-9]{0,19}', old)
          and isinstance(signature, str) and re.fullmatch(r'[a-f0-9]{64}', signature))
    encoded = config[kind + 'Key']
    check(isinstance(encoded, str) and re.fullmatch(r'[A-Za-z0-9_-]{43}', encoded))
    key = base64.urlsafe_b64decode(encoded + '=')
    check(base64.urlsafe_b64encode(key).decode().rstrip('=') == encoded and len(key) == 32)
    signed = b'jessiemessage:storage-root-binding:v1:\0' + js([kind, value, inode, old, current])
    check(hmac.compare_digest(hmac.new(key, signed, hashlib.sha256).hexdigest(), signature))
    after = private_dir(root)
    check((after.st_dev, after.st_ino) == (live.st_dev, live.st_ino))
    return sha(raw), (live.st_dev, live.st_ino)
phase = 'source'
try:
    private_dir(P); private_dir(CHECKOUT)
    check(git('rev-parse', 'HEAD') == SOURCE and git('rev-parse', 'HEAD^{tree}') == TREE
          and git('rev-parse', 'refs/tags/v1.16.0^{commit}') == SOURCE
          and not git('status', '--porcelain', '--untracked-files=normal'))
    phase = 'staging'
    check(sha(read(P / 'jm1160-staging.json', 2097152)) == STAGE
          and sha(read(P / 'start-primary-release1160-d2b57fb8.sh', 65536, 0o700)) == START
          and sha(read(P / 'check-primary-release1160-d2b57fb8.sh', 65536, 0o700)) == CHECK)
    phase = 'check'
    precheck = read(P / 'jm1160-preflight-node24221-d2b57fb8.log', 65536)
    expected = dict(version=2, type='local_closure_precheck', status='passed', scope='local_application',
                    pendingClosures=False, started=False, erased=False, externalContinuityVerified=False)
    lines = precheck.splitlines()
    check(lines and all(json.loads(line) == expected for line in lines))
    phase = 'storage'
    private_dir(P / 'runtime-video-180')
    media, media_root = marker('media')
    video, video_root = marker('video')
    check(media_root != video_root)
    phase = 'startup'
    raw = read(P / 'jm1160-node24221.log', 8 * 1024 * 1024)
    records = [json.loads(line) for line in raw.splitlines() if b'application_started' in line]
    check(len(records) == 1)
    record = records[0]; release = record['release']; ms = release['startedAt']
    check(type(record['version']) is int and record['version'] == 1 and record['type'] == 'application_started'
          and set(record) == {'version','type','release'} and set(release) == {'version','commit','nodeVersion','startedAt'}
          and release['version'] == '1.16.0' and release['commit'] == SOURCE and release['nodeVersion'] == 'v24.22.1'
          and type(ms) is int and 0 < ms <= datetime.datetime.now(datetime.timezone.utc).timestamp() * 1000)
    started = datetime.datetime.fromtimestamp(ms // 1000, datetime.timezone.utc).replace(microsecond=(ms % 1000)*1000)
    canonical = json.dumps(record, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()
    print(json.dumps(dict(status='release1160_record_pins_read_only', readOnly=True, source=SOURCE, tree=TREE,
        nodeVersion=release['nodeVersion'], precheckSha256=sha(precheck), precheckReceipts=len(lines),
        storageMarkerSha256={'media':media,'video':video}, markerCurrentMountAndSignatureVerified=True,
        startedAtMs=ms, startedAtSecond=ms // 1000, startedAtUtc=started.isoformat(timespec='milliseconds'),
        startupRecordSha256=sha(canonical)), separators=(',', ':')))
except Exception:
    print(json.dumps(dict(status='release1160_record_pins_unconfirmed', readOnly=True, phase=phase), separators=(',', ':')))
    raise SystemExit(1)
PY_RECORD1160_PINS
