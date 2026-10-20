#!/usr/bin/env python3
"""Read-only local proof after the normal Manager Build/restart. No secrets output."""
import hashlib
import json
import os
from pathlib import Path
import signal
import stat
import subprocess
import sys
import time
import urllib.error
import urllib.request

SHA = '70b48aa845b70ca960724c8d37a6e94b3d5f47a8'
TREE = '485cade0aeeee41cb4c34f913cd98f6078c4636b'
VERSION = '1.0.0'
NODE_VERSION = 'v24.22.0'
CHECKOUT = Path('/srv/customer/jessiemessage-operator/production-100-70b48aa8')
CHILD = CHECKOUT / 'scripts/private-messaging-child.mjs'
PRIVATE = Path('/srv/customer/jessiemessage-private')
LAUNCHER = PRIVATE / 'start-primary-release100-70b48aa8.sh'
LAUNCHER_SHA = 'aa400abaa54033308acce7f4b28649b33d4ecc5f7098eec7b020c05631123248'
LOG = PRIVATE / 'jm100-node2422.log'
NODE = PRIVATE / 'runtime-node-v24.22.0/bin/node'
NODE_SHA = '67ca5783febb8bf85736c79fcdd92c8d6d465a0eb2a082672bcdfa76a506751c'
ORIGINS = ('https://jessiemessage.com', 'https://recette.jessiemessage.com')


class VerifyError(Exception):
    pass


def require(ok, code):
    if not ok:
        raise VerifyError(code)


def bounded(path, limit):
    with Path(path).open('rb') as source:
        value = source.read(limit + 1)
    require(len(value) <= limit, 'READ_LIMIT')
    return value


def digest(path):
    value = hashlib.sha256()
    count = 0
    with Path(path).open('rb') as source:
        while chunk := source.read(1024 * 1024):
            count += len(chunk)
            require(count <= 256 * 1024 * 1024, 'BINARY_LIMIT')
            value.update(chunk)
    return value.hexdigest()


def private_file(path, mode):
    value = Path(path).lstat()
    require(stat.S_ISREG(value.st_mode) and value.st_uid == os.getuid()
            and value.st_nlink == 1 and stat.S_IMODE(value.st_mode) == mode, 'FILE_METADATA')


def git_source():
    require(CHECKOUT.is_dir() and not CHECKOUT.is_symlink(), 'SOURCE_DIRECTORY')
    # Do not inherit Git indirections or external command configuration.
    env = {'PATH': '/usr/bin:/bin', 'LANG': 'C', 'LC_ALL': 'C',
           'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': '/dev/null', 'GIT_TERMINAL_PROMPT': '0'}
    def git(*args):
        try:
            result = subprocess.run(['/usr/bin/git', '--no-optional-locks', '-c', 'core.fsmonitor=false',
                '-c', 'core.hooksPath=/dev/null', '-C', str(CHECKOUT), *args], env=env,
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=5)
        except (OSError, subprocess.TimeoutExpired):
            raise VerifyError('SOURCE_UNAVAILABLE') from None
        require(result.returncode == 0 and len(result.stdout) <= 8192, 'SOURCE_UNAVAILABLE')
        return result.stdout.decode('utf-8').strip()
    require(git('rev-parse', '--show-toplevel') == str(CHECKOUT.resolve()), 'SOURCE_ROOT')
    require(git('rev-parse', 'HEAD') == SHA and git('rev-parse', 'HEAD^{tree}') == TREE, 'SOURCE_IDENTITY')
    require(git('status', '--porcelain', '--untracked-files=normal') == '', 'SOURCE_DIRTY')
    require(git('rev-parse', 'HEAD') == SHA, 'SOURCE_CHANGED')
    require(json.loads(bounded(CHECKOUT / 'package.json', 65536))['version'] == VERSION, 'SOURCE_VERSION')


def latest_release(path):
    private_file(path, 0o600)
    latest = None
    # Enough for immediate post-Build verification, without dumping the journal.
    with Path(path).open('rb') as source:
        size = os.fstat(source.fileno()).st_size
        offset = max(0, size - 1024 * 1024)
        source.seek(offset)
        if offset:
            source.readline(16385)
        data = source.read(1024 * 1024 + 1)
    require(len(data) <= 1024 * 1024, 'LOG_LIMIT')
    for line in data.splitlines():
        if b'application_started' not in line:
            continue
        require(len(line) <= 16384, 'RECEIPT_LIMIT')
        try:
            value = json.loads(line)
        except (ValueError, UnicodeError):
            raise VerifyError('RECEIPT_INVALID') from None
        if isinstance(value, dict) and value.get('type') == 'application_started':
            latest = value
    require(latest is not None, 'RECEIPT_MISSING')
    require(type(latest.get('version')) is int and latest['version'] == 1
            and isinstance(latest.get('release'), dict), 'RECEIPT_INVALID')
    release = latest['release']
    require(all(name in release for name in ('version', 'commit', 'nodeVersion', 'startedAt')), 'RECEIPT_INVALID')
    return {name: release[name] for name in ('version', 'commit', 'nodeVersion', 'startedAt')}


def validate_receipt(release, process_started_ms, now_ms):
    require(release.get('version') == VERSION and release.get('commit') == SHA
            and release.get('nodeVersion') == NODE_VERSION, 'RECEIPT_IDENTITY')
    started = release.get('startedAt')
    require(type(started) is int and 0 <= started <= 253402300799999, 'RECEIPT_DATE')
    require(process_started_ms - 2000 <= started <= now_ms + 2000, 'RECEIPT_STALE')
    return dict(release)


def process_ticks(pid, proc_root=Path('/proc')):
    raw = bounded(proc_root / str(pid) / 'stat', 8192).decode('ascii')
    head, separator, tail = raw.rpartition(') ')
    require(separator and head.split(' ', 1)[0] == str(pid), 'PROCESS_STAT')
    fields = tail.split()
    require(len(fields) >= 20 and fields[0] not in ('Z', 'X'), 'PROCESS_EXITED')
    ticks = int(fields[19])  # field 22, following pid and parenthesized comm.
    require(ticks > 0, 'PROCESS_STAT')
    return ticks


def process_arguments(pid, proc_root):
    raw = bounded(proc_root / str(pid) / 'cmdline', 16384)
    return [item.decode('utf-8') for item in raw.rstrip(b'\0').split(b'\0')]


def expected_arguments(args, port):
    return (len(args) >= 8 and args[1] == str(CHILD)
            and args.count('--runtime-directory') == 1 and args.count('--port') == 1
            and args[2:4] == ['--runtime-directory', str(CHECKOUT)]
            and args.index('--port') + 1 < len(args)
            and args[args.index('--port') + 1] == str(port))


def inspect_process(pid, proc_root=Path('/proc'), uid=None, port=3000):
    uid = os.getuid() if uid is None else uid
    directory = proc_root / str(pid)
    ticks = process_ticks(pid, proc_root)
    require(directory.stat().st_uid == uid, 'PROCESS_UID')
    require(expected_arguments(process_arguments(pid, proc_root), port), 'PROCESS_ARGUMENTS')
    require(os.readlink(directory / 'exe') == str(NODE.resolve()), 'PROCESS_EXECUTABLE')
    require(digest(directory / 'exe') == NODE_SHA, 'PROCESS_BINARY')
    try:
        cwd_matches = Path(os.readlink(directory / 'cwd')).resolve() == CHECKOUT.resolve()
    except OSError:
        cwd_matches = None  # Optional corroboration; no cwd was supplied to fork.
    uptime = float(bounded(proc_root / 'uptime', 128).split()[0])
    now_ms = time.time() * 1000
    started = now_ms - uptime * 1000 + ticks * 1000 / os.sysconf('SC_CLK_TCK')
    require(0 < started <= now_ms + 2000, 'PROCESS_DATE')
    require(process_ticks(pid, proc_root) == ticks, 'PROCESS_CHANGED')
    return {'pid': pid, 'startTicks': ticks, 'startedAt': started, 'cwdMatchesCheckout': cwd_matches}


def find_process(proc_root=Path('/proc'), port=3000):
    found = []
    for directory in proc_root.iterdir():
        if not directory.name.isdigit():
            continue
        try:
            if directory.stat().st_uid != os.getuid():
                continue
            if expected_arguments(process_arguments(int(directory.name), proc_root), port):
                found.append(int(directory.name))
        except (OSError, ValueError, UnicodeError):
            continue  # Unrelated or concurrently exited processes, never printed.
    require(len(found) == 1, 'PROCESS_NOT_UNIQUE')
    return inspect_process(found[0], proc_root, port=port)


def socket_snapshot(pid, proc_root=Path('/proc'), port=3000):
    listeners = set()
    for family in ('tcp', 'tcp6'):
        try:
            rows = bounded(proc_root / 'net' / family, 4 * 1024 * 1024).decode('ascii').splitlines()[1:]
        except FileNotFoundError:
            if family == 'tcp6':
                continue  # IPv6 may be disabled; permission failures stay uncertain.
            raise
        for row in rows:
            fields = row.split()
            require(len(fields) >= 10, 'SOCKET_TABLE')
            address, number = fields[1].split(':')
            if fields[3] != '0A' or int(number, 16) != port:
                continue
            if family == 'tcp' and address in ('00000000', '0100007F'):
                listeners.add(fields[9])
            if family == 'tcp6' and address in ('0' * 32, '0000000000000000FFFF00000100007F'):
                raise VerifyError('SOCKET_AMBIGUOUS')
    require(len(listeners) == 1, 'SOCKET_NOT_UNIQUE')
    owned = set()
    for fd in (proc_root / str(pid) / 'fd').iterdir():
        try:
            target = os.readlink(fd)
        except FileNotFoundError:
            continue
        if target.startswith('socket:[') and target.endswith(']'):
            owned.add(target[8:-1])
    inode = next(iter(listeners))
    require(inode in owned, 'SOCKET_OWNER')
    return inode


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        return None


def http_status(url, expected_status, local=False):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    headers = {'Accept': 'application/json', 'User-Agent': 'JessieMessage-release-check/1.0'}
    if local:
        headers.update(Host='jessiemessage.com', **{'X-Forwarded-Proto': 'https'})
    request = urllib.request.Request(url, headers=headers, method='GET')
    def expired(_signal, _frame):
        raise VerifyError('HTTP_TIMEOUT')
    previous = signal.signal(signal.SIGALRM, expired)
    signal.setitimer(signal.ITIMER_REAL, 5)
    try:
        with opener.open(request, timeout=5) as response:
            require(response.status == 200 and response.geturl() == url, 'HTTP_STATUS')
            require(not response.headers.get_all('Set-Cookie'), 'HTTP_COOKIE')
            require('no-store' in [v.strip().lower() for v in response.headers.get('Cache-Control', '').split(',')], 'HTTP_CACHE')
            require(response.headers.get_content_type() == 'application/json', 'HTTP_TYPE')
            length = response.headers.get('Content-Length')
            require(length is None or length.isdecimal() and int(length) <= 1024, 'HTTP_SIZE')
            body = response.read(1025)
            require(len(body) <= 1024, 'HTTP_SIZE')
            require(json.loads(body) == {'status': expected_status}, 'HTTP_BODY')
            return True
    except VerifyError:
        raise
    except (OSError, ValueError, urllib.error.URLError):
        raise VerifyError('HTTP_UNAVAILABLE') from None
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous)


def verify():
    git_source()
    private_file(LAUNCHER, 0o700)
    require(digest(LAUNCHER) == LAUNCHER_SHA, 'LAUNCHER_IDENTITY')
    release = latest_release(LOG)
    process = find_process()
    pid = process['pid']
    validate_receipt(release, process['startedAt'], time.time() * 1000)
    inode = socket_snapshot(pid)
    http_status('http://127.0.0.1:3000/api/ready', 'ready', local=True)
    public = []
    for origin in ORIGINS:
        result = {'origin': origin}
        for endpoint, expected in (('health', 'ok'), ('ready', 'ready')):
            try:
                result[endpoint] = http_status(origin + '/api/' + endpoint, expected)
            except (VerifyError, OSError, ValueError):
                result[endpoint] = False  # Independent availability evidence, no version identity.
        public.append(result)
    git_source()
    require(latest_release(LOG) == release, 'RECEIPT_CHANGED')
    final_process = find_process()
    require(final_process['pid'] == pid and final_process['startTicks'] == process['startTicks'], 'PROCESS_CHANGED')
    require(socket_snapshot(pid) == inode, 'SOCKET_CHANGED')
    require(process_ticks(pid) == process['startTicks'], 'PROCESS_CHANGED')
    return {'status': 'active_release_verified', 'readOnly': True,
        'identity': {**release, 'tree': TREE, 'nodeBinarySha256': NODE_SHA},
        'pid': pid, 'processStartTicks': process['startTicks'], 'processSocketStable': True,
        'cwdMatchesCheckout': process['cwdMatchesCheckout'], 'localReady': True,
        'publicEndpoints': public, 'provenance': {'identity': 'local_process_socket_startup_receipt',
            'public': 'unauthenticated_availability_only', 'receiptPidBound': False},
        'backupQualified': False, 'pcQualified': False, 'checkpointWritten': False}


if __name__ == '__main__':
    try:
        require(len(sys.argv) == 1, 'USAGE')
        result = verify()
        exit_code = 0
    except VerifyError as error:
        result = {'status': 'active_release_unverified', 'code': str(error), 'readOnly': True}
        exit_code = 1
    except Exception:
        result = {'status': 'active_release_unverified', 'code': 'VERIFY_UNAVAILABLE', 'readOnly': True}
        exit_code = 1
    print(json.dumps(result, separators=(',', ':')))
    sys.exit(exit_code)
