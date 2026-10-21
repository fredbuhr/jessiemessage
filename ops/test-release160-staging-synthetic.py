#!/usr/bin/env python3
"""Standalone synthetic staging qualification; never executes the full staging helper."""
import ast
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent
SCRIPT = ROOT / 'prepare-release160.sh'
OLD_START_PIN = '3620b656f528f3ad031bb4ad5f709df5ced0a21ff4326b4e5a5c4cdc6994105b'
OLD_CHECK_PIN = 'e06b8356074a0980975f71d2d9cf88bf463a4f6fb583bb0b40346c005dc29770'
text = SCRIPT.read_text()
snapshot = hashlib.sha256(SCRIPT.read_bytes()).hexdigest()
blocks = [rest.split('\nPY\n', 1)[0] for rest in text.split("<<'PY'\n")[1:]]
assert len(blocks) == 2
for block in blocks: compile(block, 'exact embedded release160 block', 'exec')
subprocess.run(['/bin/bash', '-n', str(SCRIPT)], check=True)
assert not re.search(r'timeout .*?bash "\$jm_check(?:151|160)"', text)
assert not re.search(r'bash "\$jm_launcher(?:151|160)"', text)
assert 'rm ' not in text and 'db:migrate' not in text and 'record-release' not in text
assert 'jm_oldsha=abca467c45c9385371a9095ab359e78c99140370' in text
assert 'jm_oldtree=3238dd2224ea768e3ab2f8bcb7594cc3890dd5e4' in text
assert 'jm_node_sha=67ca5783febb8bf85736c79fcdd92c8d6d465a0eb2a082672bcdfa76a506751c' in text
pin_patterns = {
    'sha151': r'^jm_expected151=([a-f0-9]{40}|QUALIFICATION_REQUIRED_SHA151)$',
    'sha160': r'^jm_expected160=([a-f0-9]{40}|QUALIFICATION_REQUIRED_SHA160)$',
    'tree151': r'^jm_tree151=([a-f0-9]{40}|QUALIFICATION_REQUIRED_TREE151)$',
    'tree160': r'^jm_tree160=([a-f0-9]{40}|QUALIFICATION_REQUIRED_TREE160)$',
}
pins = {name: re.search(pattern, text, re.M) for name, pattern in pin_patterns.items()}
assert all(pins.values())
for name, match in pins.items():
    if 'QUALIFICATION_REQUIRED' in match[1]: assert text.count(match[1]) == 1, name
source_fn = re.search(r'^jm_source\(\) \{\n.*?^\}', text, re.M | re.S)[0]
git_fn = re.search(r'^jm_git\(\).*?$', text, re.M)[0]
absence_gate = re.search(r'^for jm_path in .*?^done', text, re.M | re.S)[0]
results = []

def passed(label):
    results.append(label); print('PASS ' + label)

with tempfile.TemporaryDirectory(dir=ROOT.parent.parent, prefix='release160-staging-fixture-') as temporary:
    root = Path(temporary); old = root / 'old'; old.mkdir()
    env = dict(os.environ, GIT_CONFIG_NOSYSTEM='1', GIT_CONFIG_GLOBAL='/dev/null')
    for name in ('GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES'):
        env.pop(name, None)
    def command(args, **kwargs):
        return subprocess.run(args, env=env, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, **kwargs)
    def git_at(path, *args):
        return command(['/usr/bin/git', '-c', 'core.hooksPath=/dev/null', '-C', str(path), *args]).stdout.decode().strip()
    git_at(old, 'init', '-q')
    (old / '.gitignore').write_text('node_modules\n')
    migration_directory = old / 'db' / 'migrations'; migration_directory.mkdir(parents=True)
    for index in range(1, 33):
        (migration_directory / f'{index:04d}_fixture.sql').write_text(f'-- synthetic migration {index}\n')
    package = {'name': 'release160-synthetic-fixture', 'version': '1.5.0', 'private': True}
    lock = {'name': package['name'], 'version': '1.5.0', 'lockfileVersion': 3,
        'packages': {'': {'name': package['name'], 'version': '1.5.0', 'dependencies': {'fixture': '1.2.3'}},
                     'node_modules/fixture': {'version': '1.2.3', 'integrity': 'unchanged-fixture'}}}
    def commit_version(version):
        package['version'] = lock['version'] = lock['packages']['']['version'] = version
        (old / 'package.json').write_text(json.dumps(package) + '\n')
        (old / 'package-lock.json').write_text(json.dumps(lock) + '\n')
        git_at(old, 'add', '.gitignore', 'package.json', 'package-lock.json', 'db/migrations')
        git_at(old, '-c', 'user.name=Synthetic Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', version)
        return git_at(old, 'rev-parse', 'HEAD'), git_at(old, 'rev-parse', 'HEAD^{tree}')
    old_sha, old_tree = commit_version('1.5.0')
    (migration_directory / '0033_crm_tasks.sql').write_text('-- synthetic task DDL33\n')
    sha151, tree151 = commit_version('1.5.1')
    sha160, tree160 = commit_version('1.6.0')
    replacement = dict(sha151=sha151, tree151=tree151, sha160=sha160, tree160=tree160)
    pinned_fixture = text
    for name, match in sorted(pins.items(), key=lambda item: item[1].start(1), reverse=True):
        pinned_fixture = pinned_fixture[:match.start(1)] + replacement[name] + pinned_fixture[match.end(1):]
    prefix = pinned_fixture.split('jm_old=', 1)[0]
    assert 'fetch' not in prefix and 'python3' not in prefix and 'jm_source' not in prefix
    for label, args, valid in (
        ('both_exact_fixture_pins_pass', [sha151, sha160], True),
        ('wrong_rollback151_pin_refused', ['0' * 40, sha160], False),
        ('wrong_target160_pin_refused', [sha151, '0' * 40], False),
        ('extra_argument_refused', [sha151, sha160, 'extra'], False),
        ('missing_target160_argument_refused', [sha151], False),
    ):
        result = subprocess.run(['/bin/bash', '-c', prefix, 'synthetic pins', *args], env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        assert (result.returncode == 0) is valid, (label, result.stderr.decode())
        passed(label)
    if any('QUALIFICATION_REQUIRED' in match[1] for match in pins.values()):
        unqualified_prefix = text.split('jm_old=', 1)[0]
        result = subprocess.run(['/bin/bash', '-c', unqualified_prefix, 'unqualified pins', sha151, sha160], env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        assert result.returncode != 0
        passed('unqualified_placeholders_block_all_execution')
    else:
        assert all(re.fullmatch(r'[a-f0-9]{40}', match[1]) for match in pins.values())
        passed('target_source_pins_are_explicit')
    git_at(old, 'checkout', '--detach', old_sha)
    target151, target160 = root / 'target151', root / 'target160'
    git_at(old, 'worktree', 'add', '--detach', str(target151), sha151)
    git_at(old, 'worktree', 'add', '--detach', str(target160), sha160)
    deps = old / 'node_modules'; deps.mkdir()
    for target in (target151, target160): (target / 'node_modules').symlink_to(deps, target_is_directory=True)
    original = root / 'original-start.sh'; original_check = root / 'original-check.sh'
    template = (f'#!/bin/bash\n# source {old_sha}\n# tree {old_tree}\ncd "{old}"\n'
        f'exec /bin/echo start-local-closures --runtime-directory "{old}" --runtime-head {old_sha} --runtime-tree {old_tree} '
        f'>> "{root}/two_targets_staged_without_prechecks/jm150-node2422.log" 2>&1\n')
    original.write_text(template); original.chmod(0o700)
    original_check.write_text(template.replace('start-local-closures', 'check-local-closures')); original_check.chmod(0o700)
    original_start_sha = hashlib.sha256(original.read_bytes()).hexdigest()
    original_check_sha = hashlib.sha256(original_check.read_bytes()).hexdigest()
    def fixture_block(index):
        module = ast.parse(blocks[index]); substitutions = {OLD_START_PIN: 0, OLD_CHECK_PIN: 0}
        for node in ast.walk(module):
            if isinstance(node, ast.Constant) and node.value in substitutions:
                pin = node.value; substitutions[pin] += 1
                node.value = original_start_sha if pin == OLD_START_PIN else original_check_sha
        assert substitutions == {OLD_START_PIN: 1, OLD_CHECK_PIN: 1}
        return ast.unparse(module)
    def source(path): return git_at(path, 'rev-parse', 'HEAD'), git_at(path, 'rev-parse', 'HEAD^{tree}')
    def case_paths(out, release):
        return [out / ('start' + release + '.sh'), out / ('check' + release + '.sh'),
                out / ('jm' + release + '-node2422.log'), out / ('jm' + release + '-preflight.log')]
    def run_case(label, *, valid=True, old_identity=None, identity151=None, identity160=None, preexisting=None):
        out = root / label; out.mkdir()
        paths151, paths160 = case_paths(out, '151'), case_paths(out, '160')
        all_paths = paths151 + paths160
        if preexisting is not None: all_paths[preexisting].write_bytes(b'existing artifact must survive\n')
        a, b = identity151 or source(target151), identity160 or source(target160)
        previous = old_identity or (old_sha, old_tree)
        args = [str(old), str(original), str(original_check), *previous,
                *a, str(target151), *map(str, paths151), *b, str(target160), *map(str, paths160)]
        variables = {'jm_target151': str(out / 'uncreated-worktree151'), 'jm_target160': str(out / 'uncreated-worktree160')}
        for release, paths in [('151', paths151), ('160', paths160)]:
            for name, path in zip(('jm_launcher', 'jm_check', 'jm_log', 'jm_prelog'), paths): variables[name+release] = str(path)
        # Paths contain only tempfile-owned ASCII data; pass them as positional values.
        names = list(variables)
        definitions = '\n'.join(f'{name}="${{{20+i}}}"' for i,name in enumerate(names))
        shell = ('set -euo pipefail\numask 077\n'+git_fn+'\n'+source_fn+'\n'+definitions+'\n'+absence_gate+'\n'
            +'jm_source "$1" "$4" "$5"\njm_source "$8" "$6" "$7"\njm_source "${15}" "${13}" "${14}"\n'
            +'python3 - "${@:1:19}" <<\'CORE\'\n'+fixture_block(0)+'\nCORE\n')
        result = subprocess.run(['/bin/bash', '-c', shell, 'synthetic core', *args, *[variables[name] for name in names]], env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        if valid:
            assert result.returncode == 0, (label, result.stderr.decode())
            for version, target, identity, paths in [('1.5.1',target151,a,paths151),('1.6.0',target160,b,paths160)]:
                normal, check, log, prelog = paths
                assert (target / 'node_modules').is_symlink() and (target / 'node_modules').resolve() == deps
                start_text, check_text = normal.read_text(), check.read_text()
                assert start_text.count(identity[0]) == 2 and start_text.count(identity[1]) == 2 and start_text.count(str(target)) == 2
                assert start_text.count('start-local-closures') == 1 and 'check-local-closures' not in start_text
                assert 'start-local-closures' not in check_text and check_text.count('check-local-closures') == 1
                assert log.name not in check_text and check_text.count(prelog.name) == 1
                for path in (normal,check):
                    assert path.stat().st_mode & 0o777 == 0o700;command(['/bin/bash','-n',str(path)])
                for path in (log,prelog): assert path.stat().st_mode & 0o777 == 0o600 and path.read_bytes() == b''
                assert prelog.read_bytes() == log.read_bytes() == b''
        else:
            assert result.returncode != 0, label
            for index, path in enumerate(all_paths):
                if index == preexisting: assert path.read_bytes() == b'existing artifact must survive\n'
                else: assert not path.exists() and not path.is_symlink(), (label, path)
        passed(label)
    run_case('two_targets_staged_without_prechecks')
    run_case('wrong_old150_source_refused',valid=False,old_identity=('a'*40,old_tree))
    run_case('wrong_target160_tree_refused_before_outputs',valid=False,identity160=(sha160,'b'*40))
    run_case('partial_rollback151_artifact_preserved',valid=False,preexisting=0)
    run_case('partial_target160_artifact_preserved_without_151_outputs',valid=False,preexisting=5)
    original_check.write_text(original_check.read_text()+'# drift\n')
    run_case('changed_old150_check_hash_refused_before_outputs',valid=False)
    original_check.write_text(template.replace('start-local-closures','check-local-closures'))
    original.chmod(0o755)
    run_case('unsafe_old150_launcher_mode_refused',valid=False)
    original.chmod(0o700)
    wrong_deps = root/'wrong-deps';wrong_deps.mkdir()
    link=target160/'node_modules';link.unlink();link.symlink_to(wrong_deps,target_is_directory=True)
    run_case('wrong_second_target_dependency_link_refused_without_151_outputs',valid=False)
    assert link.resolve()==wrong_deps
    link.unlink();link.symlink_to(deps,target_is_directory=True)
    def change_commit(target,path,content):
        path.write_text(content);git_at(target,'add',str(path));git_at(target,'-c','user.name=Synthetic Fixture','-c','user.email=fixture@example.invalid','commit','-qm','synthetic incompatible target')
    change_commit(target160,target160/'db/migrations/0032_fixture.sql','-- changed\n')
    run_case('changed_target160_migration_refused_without_151_outputs',valid=False)
    git_at(target160,'reset','--hard',sha160)
    change_commit(target160,target160/'db/migrations/0033_crm_tasks.sql','-- divergent new migration33\n')
    run_case('different33_between_151_and160_refused_before_outputs',valid=False)
    git_at(target160,'reset','--hard',sha160)
    for target in (target151,target160):
        git_at(target,'mv','db/migrations/0033_crm_tasks.sql','db/migrations/0033_wrong.sql')
        git_at(target,'-c','user.name=Synthetic Fixture','-c','user.email=fixture@example.invalid','commit','-qm','wrong new migration name')
    run_case('wrong_append33_name_on_both_releases_refused',valid=False)
    git_at(target151,'reset','--hard',sha151);git_at(target160,'reset','--hard',sha160)
    change_commit(target151,target151/'db/migrations/0034_extra.sql','-- unexpected future migration\n')
    run_case('extra_future_migration_in_151_refused',valid=False)
    git_at(target151,'reset','--hard',sha151)
    changed=json.loads((target151/'package-lock.json').read_text());changed['packages']['node_modules/fixture']['integrity']='changed'
    change_commit(target151,target151/'package-lock.json',json.dumps(changed))
    run_case('changed_rollback151_dependencies_refused',valid=False)
    git_at(target151,'reset','--hard',sha151)
    changed=json.loads((target160/'package.json').read_text());changed['version']='1.5.1'
    change_commit(target160,target160/'package.json',json.dumps(changed))
    run_case('wrong_target160_version_refused',valid=False)
    git_at(target160,'reset','--hard',sha160)
    (old/'package.json').write_text((old/'package.json').read_text()+' ')
    run_case('dirty_old150_source_refused',valid=False)
    git_at(old,'checkout','--','package.json')

    # Exact final report code, isolated from all staging/network/runtime actions.
    node=root/'node-fixture';node.write_bytes(b'synthetic node bytes');node.chmod(0o700)
    node_sha=hashlib.sha256(node.read_bytes()).hexdigest()
    report_root=root/'report';report_root.mkdir()
    report151,report160=case_paths(report_root,'151'),case_paths(report_root,'160')
    for paths in [report151,report160]:
        for path in paths[:2]:path.write_bytes(b'#!/bin/bash\n');path.chmod(0o700)
        paths[2].write_bytes(b'');paths[2].chmod(0o600)
    def report_case(label, *, valid=True, runtime151=b'', runtime160=b'', precheck151=b'', precheck160=b'', expected_node=None):
        for paths,normal,precheck in [(report151,runtime151,precheck151),(report160,runtime160,precheck160)]:
            paths[2].write_bytes(normal)
            paths[3].write_bytes(precheck);paths[3].chmod(0o600)
        args=[str(node),expected_node or node_sha,str(original),str(original_check),sha151,tree151,str(target151),*map(str,report151),sha160,tree160,str(target160),*map(str,report160)]
        result=subprocess.run(['python3','-c',fixture_block(1),*args],env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        if valid:
            assert result.returncode==0,(label,result.stderr.decode())
            value=json.loads(result.stdout)
            assert value['status']=='staged_awaiting_schema33' and value['version']=='1.6.0' and value['source']==sha160
            assert [entry['version'] for entry in value['releases']]==['1.5.1','1.6.0']
            assert value['rollback151Prepared'] is True and value['rollback151HostedQualified'] is False
            assert value['rollbackRelease']=='1.5.1' and value['rollbackLauncher']==str(report151[0])
            assert value['expectedActiveServiceVersion']=='1.5.0' and value['priorActivePreserved'] is True
            assert value['baselineMigrationFiles']==32 and value['schemaMigrationsExpected']==33
            assert value['migrationsAppendOnly'] is True and value['sqlStatusChecked'] is False
            assert value['noRestart'] is True and value['managerChanged'] is False and value['checkpointChanged'] is False
            for entry in [value,*value['releases']]:
                assert all(entry[key] is False for key in ['started','migrated','precheckPassed'])
        else:assert result.returncode!=0 and b'rollback151HostedQualified' not in result.stdout,(label,result.stdout)
        passed(label)
    report_case('empty_logs_report_staged_only_not_hosted_qualified')
    report_case('rollback151_runtime_log_not_empty_refused',valid=False,runtime151=b'unexpected start')
    report_case('target160_runtime_log_not_empty_refused',valid=False,runtime160=b'unexpected start')
    report_case('rollback151_precheck_log_not_empty_refused',valid=False,precheck151=b'unexpected check')
    report_case('target160_precheck_log_not_empty_refused',valid=False,precheck160=b'unexpected check')
    report_case('changed_node_before_report_refused',valid=False,expected_node='0'*64)

assert hashlib.sha256(SCRIPT.read_bytes()).hexdigest()==snapshot,'production helper changed during fixture checks'
print(f'RESULT {len(results)}/{len(results)} passed; script_sha256={snapshot}; no remote or full staging execution')
