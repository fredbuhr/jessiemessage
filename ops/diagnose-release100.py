"""Read-only staging diagnostics: no application, database or file mutation."""
import hashlib
import json
import os
import pathlib
import stat

operator = pathlib.Path('/srv/customer/jessiemessage-operator')
private = pathlib.Path('/srv/customer/jessiemessage-private')
old = operator / 'production-086-c61d1eec'
new = operator / 'production-100-70b48aa8'
launcher = private / 'start-primary-node2422-c61d1eec.sh'
text = launcher.read_text()
s = launcher.lstat()
report = {'launcher': {'regular': stat.S_ISREG(s.st_mode), 'owner_matches': s.st_uid == os.getuid(),
                       'links': s.st_nlink, 'mode': oct(stat.S_IMODE(s.st_mode)),
                       'hash_matches': hashlib.sha256(launcher.read_bytes()).hexdigest() == 'e54392621a7f63f7665f44c191783d467ccb214630e65449fb4ae57138cc9881'}}
locks = []
for label, root in [('old', old), ('new', new)]:
    package = json.loads((root / 'package.json').read_text())
    lock = json.loads((root / 'package-lock.json').read_text())
    report[label + '_versions'] = [package.get('version'), lock.get('version'), lock.get('packages', {}).get('', {}).get('version')]
    lock.pop('version', None)
    lock.get('packages', {}).get('', {}).pop('version', None)
    locks.append(lock)
report['dependencies_equal'] = locks[0] == locks[1]
report['dependencies_directory'] = (old / 'node_modules').resolve().is_dir()
report['counts'] = {name: text.count(value) for name, value in {
    'start': 'start-local-closures', 'check': 'check-local-closures',
    'old_commit': 'c61d1eecfefe786254416652877ba82d30cf4c90',
    'old_tree': '78c8e46224503b0691b381bf07c5aefd51ca5c7f',
    'old_directory': str(old), 'old_log': 'jm086-node2422.log'}.items()}
report['created'] = {p.name: p.exists() or p.is_symlink() for p in [
    new / 'node_modules', private / 'start-primary-release100-70b48aa8.sh',
    private / 'check-primary-release100-70b48aa8.sh', private / 'jm100-node2422.log',
    private / 'jm100-preflight-70b48aa8.log']}
report['node_sha256'] = hashlib.sha256((private / 'runtime-node-v24.22.0/bin/node').read_bytes()).hexdigest()
print(json.dumps(report, indent=2))
