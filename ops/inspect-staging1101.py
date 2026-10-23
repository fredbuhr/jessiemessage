#!/usr/bin/env python3
"""Read-only diagnosis of the refused1101 preparation; never resume it."""
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import types
import urllib.request

OPERATOR = 'e5dbfc124a8169a551285d4feb15b827edf07e58'
SOURCE = '9eb99f1f68ab4beb5484894249afa8f413cc5dd6'
BASE = '51b0cf22e3adbad7ed26653e96706ba707aaf839'
PINS = {'prepare-release1101.py': '6682282bb938aa91578410d4dd317c631172b6ee71c6cadf31063995e1169608',
        'release1101-dependencies.py': '293f06004d79d9b32a891473c7514b74eda58e5798f083561540a0108c58806b'}
PRIVATE = Path('/srv/customer/jessiemessage-private')
CHECKOUT = Path('/srv/customer/jessiemessage-operator/production-1100-51b0cf22')
READS = {('rev-parse', 'HEAD'), ('rev-parse', 'HEAD^{tree}'), ('status', '--porcelain', '--untracked-files=normal'),
         ('rev-parse', 'refs/tags/v1.10.1^{commit}'), ('rev-parse', SOURCE + '^{tree}')}
READS |= {('show', sha + ':' + name) for sha in (BASE, SOURCE) for name in ('package.json', 'package-lock.json')}


class InspectionRefused(Exception):
    pass


def code(error):
    value = str(error)
    if re.fullmatch(r'dependency_[a-z_]{1,80}|git_read_(failed|forbidden)|pinned_tool_(hash|download)|file_(metadata|changed|identity):[a-zA-Z0-9_.-]{1,80}', value):
        return value
    return {'FileNotFoundError': 'missing', 'PermissionError': 'permission', 'JSONDecodeError': 'json_invalid',
            'UnicodeDecodeError': 'encoding_invalid', 'OSError': 'os_error'}.get(type(error).__name__, 'not_confirmed')


def probe(operation):
    try:
        return dict(ok=operation() is not False)
    except Exception as error:
        return dict(ok=False, code=code(error))


def metadata(path):
    try:
        value = path.lstat()
        kind = 'file' if stat.S_ISREG(value.st_mode) else 'directory' if stat.S_ISDIR(value.st_mode) else 'symlink' if stat.S_ISLNK(value.st_mode) else 'other'
        return dict(present=True, kind=kind, owned=value.st_uid == os.getuid(), mode=format(stat.S_IMODE(value.st_mode), '04o'),
                    empty=value.st_size == 0 if kind == 'file' else None)
    except FileNotFoundError:
        return dict(present=False)
    except Exception as error:
        return dict(present=None, code=code(error))


def read_git(*arguments):
    if tuple(arguments) not in READS:
        raise InspectionRefused('git_read_forbidden')
    result = subprocess.run(['/usr/bin/git', '--no-optional-locks', '-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null',
        '-C', str(CHECKOUT), *arguments], stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        env=dict(PATH='/usr/bin:/bin', LANG='C', LC_ALL='C', GIT_CONFIG_NOSYSTEM='1', GIT_CONFIG_GLOBAL='/dev/null', GIT_TERMINAL_PROMPT='0'), timeout=15)
    if result.returncode != 0 or len(result.stdout) > 1048576:
        raise InspectionRefused('git_read_failed')
    return result.stdout


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        raise InspectionRefused('pinned_tool_download')


def load_tools():
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    contents = {}
    for filename, pin in PINS.items():
        url = 'https://raw.githubusercontent.com/fredbuhr/jessiemessage/' + OPERATOR + '/ops/' + filename
        with opener.open(url, timeout=20) as response:
            content = response.read(262145)
            if response.status != 200 or response.url != url or len(content) > 262144:
                raise InspectionRefused('pinned_tool_download')
        if hashlib.sha256(content).hexdigest() != pin:
            raise InspectionRefused('pinned_tool_hash')
        contents[filename] = content
    modules = []
    for filename, content in contents.items():
        module = types.ModuleType('readonly_' + filename)
        exec(compile(content, '<pinned-readonly-functions>', 'exec'), module.__dict__)
        modules.append(module)
    return modules


def inspect(tools=None):
    prepare, dependencies = load_tools() if tools is None else tools
    result = dict(status='release1101_read_only_diagnostic', noResume=True, noCheck=True, noRuntimeAction=True)
    plan = prepare.release_plan(SOURCE, prepare.RELEASE_TREE)
    result['outputs'] = {name: metadata(path) for name, path in {**{name: plan[name] for name in ('checkout', 'start', 'check', 'log', 'prelog')},
        'receipt': PRIVATE / 'jm1101-staging.json'}.items()}
    result['pins'] = {}
    for name, path, mode, pin in [('stage1100', PRIVATE / 'jm1100-staging.json', 0o600, prepare.BASE_STAGING_SHA),
        ('checkpoint', PRIVATE / 'jm0702-existing-pc-update.json', 0o600, prepare.CHECKPOINT_PIN),
        ('start1100', PRIVATE / 'start-primary-release1100-51b0cf22.sh', 0o700, prepare.START_PIN),
        ('check1100', PRIVATE / 'check-primary-release1100-51b0cf22.sh', 0o700, prepare.CHECK_PIN),
        ('nodeFile', PRIVATE / 'runtime-node-v24.22.1/bin/node', 0o700, prepare.NODE_PIN)]:
        result['pins'][name] = probe(lambda path=path, mode=mode, pin=pin: prepare.regular(path, mode, digest_only=True) == pin)
    result['privateDirectory'] = probe(lambda: prepare.private_directory(PRIVATE))
    result['git'] = {name: probe(lambda args=args, expected=expected: read_git(*args).decode().strip() == expected)
        for name, args, expected in [('baseSource', ('rev-parse', 'HEAD'), BASE), ('baseTree', ('rev-parse', 'HEAD^{tree}'), prepare.BASE_TREE),
        ('baseClean', ('status', '--porcelain', '--untracked-files=normal'), ''),
        ('tag1101', ('rev-parse', 'refs/tags/v1.10.1^{commit}'), SOURCE), ('tree1101', ('rev-parse', SOURCE + '^{tree}'), prepare.RELEASE_TREE)]}
    try:
        old_package, old_lock, new_package, new_lock = [json.loads(read_git('show', sha + ':' + name)) for sha in (BASE, SOURCE) for name in ('package.json', 'package-lock.json')]
        result['lockTransition'] = probe(lambda: dependencies.validate_lock_transition(old_package, old_lock, new_package, new_lock))
        link = CHECKOUT / 'node_modules'; result['dependencyLink'] = metadata(link)
        directory = link.resolve(strict=True); result['dependencyRoot'] = metadata(directory)
        result['inventory'] = probe(lambda: dependencies.dependency_inventory(directory))
        result['installed'] = probe(lambda: dependencies.verify_installed(directory, old_lock))
        result['installedPackages'] = {}
        for name, expected in old_package['dependencies'].items():
            result['installedPackages'][name] = probe(lambda name=name, expected=expected:
                json.loads(dependencies.read_stable(directory / name / 'package.json')).get('version') == expected)
        hidden = directory / '.package-lock.json'; result['hiddenLockMetadata'] = metadata(hidden)
        result['hiddenLock'] = probe(lambda: dependencies.normalized_hidden_lock(dependencies.read_stable(hidden), old_lock, new_lock)) if hidden.exists() else dict(present=False)
    except Exception as error:
        result['dependenciesUnavailable'] = code(error)
    return result


if __name__ == '__main__':
    try:
        if len(sys.argv) != 1:
            raise InspectionRefused('usage')
        print(json.dumps(inspect(), separators=(',', ':')))
    except Exception as error:
        print(json.dumps(dict(status='release1101_diagnostic_not_confirmed', code=code(error), noResume=True, noRuntimeAction=True), separators=(',', ':')))
        raise SystemExit(1)
