#!/usr/bin/env python3
"""Two-file synthetic qualification. Never runs the full staging helper."""
import ast
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent
SCRIPT = ROOT / 'prepare-release140.sh'
OLD_START_PIN = '88aad7a731cc58a4367e808c9f4156b47c6f647f71b10f4b2e0fb65d093cea89'
OLD_CHECK_PIN = '80bfd6dbeebacc4f550baf95d76921e85b3e196814b12554333c80561d155623'
text = SCRIPT.read_text()
snapshot = hashlib.sha256(SCRIPT.read_bytes()).hexdigest()
blocks = [rest.split('\nPY\n', 1)[0] for rest in text.split("<<'PY'\n")[1:]]
assert len(blocks) == 2
for block in blocks: compile(block, 'exact embedded release140 block', 'exec')
subprocess.run(['/bin/bash', '-n', str(SCRIPT)], check=True)
assert len(re.findall(r'timeout .*?bash "\$jm_check(?:134|140)"', text)) == 2
assert not re.search(r'bash "\$jm_launcher(?:134|140)"', text)
assert 'rm ' not in text and 'db:migrate' not in text and 'record-release' not in text
assert 'jm_oldsha=ca0d40648036d57fdee55b91d47d5d5a874a626e' in text
assert 'jm_oldtree=b1fe882ede0450cbf135d2ff8cb19e780d18a0e5' in text
assert 'jm_node_sha=67ca5783febb8bf85736c79fcdd92c8d6d465a0eb2a082672bcdfa76a506751c' in text
pin_patterns = {
    'sha134': r'^\[\[ "\$jm_sha134" == ([a-f0-9]{40}|SHA_RELEASE134_PLACEHOLDER) \]\]$',
    'sha140': r'^\[\[ "\$jm_sha140" == ([a-f0-9]{40}|SHA_RELEASE140_PLACEHOLDER) \]\]$',
    'tree134': r'^jm_tree134=([a-f0-9]{40}|TREE_RELEASE134_PLACEHOLDER)$',
    'tree140': r'^jm_tree140=([a-f0-9]{40}|TREE_RELEASE140_PLACEHOLDER)$',
}
pins = {name: re.search(pattern, text, re.M) for name, pattern in pin_patterns.items()}
assert all(pins.values())
for name, match in pins.items():
    if 'PLACEHOLDER' in match[1]: assert text.count(match[1]) == 1, name
source_fn = re.search(r'^jm_source\(\) \{\n.*?^\}', text, re.M | re.S)[0]
git_fn = re.search(r'^jm_git\(\).*?$', text, re.M)[0]
absence_gate = re.search(r'^for jm_path in .*?^done', text, re.M | re.S)[0]
results = []

def passed(label):
    results.append(label); print('PASS ' + label)

with tempfile.TemporaryDirectory(dir=ROOT, prefix='release140-staging-fixture-') as temporary:
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
    for index in range(1, 32):
        (migration_directory / f'{index:04d}_fixture.sql').write_text(f'-- synthetic migration {index}\n')
    package = {'name': 'release140-synthetic-fixture', 'version': '1.3.3', 'private': True}
    lock = {'name': package['name'], 'version': '1.3.3', 'lockfileVersion': 3,
        'packages': {'': {'name': package['name'], 'version': '1.3.3', 'dependencies': {'fixture': '1.2.3'}},
                     'node_modules/fixture': {'version': '1.2.3', 'integrity': 'unchanged-fixture'}}}
    def commit_version(version):
        package['version'] = lock['version'] = lock['packages']['']['version'] = version
        (old / 'package.json').write_text(json.dumps(package) + '\n')
        (old / 'package-lock.json').write_text(json.dumps(lock) + '\n')
        git_at(old, 'add', '.gitignore', 'package.json', 'package-lock.json', 'db/migrations')
        git_at(old, '-c', 'user.name=Synthetic Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', version)
        return git_at(old, 'rev-parse', 'HEAD'), git_at(old, 'rev-parse', 'HEAD^{tree}')
    old_sha, old_tree = commit_version('1.3.3')
    sha134, tree134 = commit_version('1.3.4')
    sha140, tree140 = commit_version('1.4.0')
    replacement = dict(sha134=sha134, tree134=tree134, sha140=sha140, tree140=tree140)
    pinned_fixture = text
    for name, match in sorted(pins.items(), key=lambda item: item[1].start(1), reverse=True):
        pinned_fixture = pinned_fixture[:match.start(1)] + replacement[name] + pinned_fixture[match.end(1):]
    prefix = pinned_fixture.split('jm_private=', 1)[0]
    assert 'fetch' not in prefix and 'python3' not in prefix and 'jm_source' not in prefix
    for label, args, valid in (
        ('both_exact_fixture_pins_pass', [sha134, sha140], True),
        ('wrong_rollback134_pin_refused', ['0' * 40, sha140], False),
        ('wrong_target140_pin_refused', [sha134, '0' * 40], False),
        ('extra_argument_refused', [sha134, sha140, 'extra'], False),
        ('missing_target140_argument_refused', [sha134], False),
    ):
        result = subprocess.run(['/bin/bash', '-c', prefix, 'synthetic pins', *args], env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        assert (result.returncode == 0) is valid, (label, result.stderr.decode())
        passed(label)
    if any('PLACEHOLDER' in match[1] for match in pins.values()):
        unqualified_prefix = text.split('jm_private=', 1)[0]
        result = subprocess.run(['/bin/bash', '-c', unqualified_prefix, 'unqualified pins', sha134, sha140], env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        assert result.returncode != 0
        passed('unqualified_placeholders_block_all_execution')
    else:
        assert all(re.fullmatch(r'[a-f0-9]{40}', match[1]) for match in pins.values())
        passed('published_target_pins_are_explicit')
    git_at(old, 'checkout', '--detach', old_sha)
    target134, target140 = root / 'target134', root / 'target140'
    git_at(old, 'worktree', 'add', '--detach', str(target134), sha134)
    git_at(old, 'worktree', 'add', '--detach', str(target140), sha140)
    deps = old / 'node_modules'; deps.mkdir()
    for target in (target134, target140): (target / 'node_modules').symlink_to(deps, target_is_directory=True)
    original = root / 'original-start.sh'; original_check = root / 'original-check.sh'
    template = (f'#!/bin/bash\n# source {old_sha}\n# tree {old_tree}\ncd "{old}"\n'
        f'exec /bin/echo start-local-closures --runtime-directory "{old}" --runtime-head {old_sha} --runtime-tree {old_tree} '
        f'>> "{root}/two_targets_created_with_check_only/jm133-node2422.log" 2>&1\n')
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
    def run_case(label, *, valid=True, old_identity=None, identity134=None, identity140=None, preexisting=None):
        out = root / label; out.mkdir()
        paths134, paths140 = case_paths(out, '134'), case_paths(out, '140')
        all_paths = paths134 + paths140
        if preexisting is not None: all_paths[preexisting].write_bytes(b'existing artifact must survive\n')
        a, b = identity134 or source(target134), identity140 or source(target140)
        previous = old_identity or (old_sha, old_tree)
        args = [str(old), str(original), str(original_check), *previous,
                *a, str(target134), *map(str, paths134), *b, str(target140), *map(str, paths140)]
        variables = {'jm_target134': str(out / 'uncreated-worktree134'), 'jm_target140': str(out / 'uncreated-worktree140')}
        for release, paths in [('134', paths134), ('140', paths140)]:
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
            for version, target, identity, paths in [('1.3.4',target134,a,paths134),('1.4.0',target140,b,paths140)]:
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
                command(['/bin/bash',str(check)])
                assert 'check-local-closures' in prelog.read_text() and log.read_bytes() == b''
        else:
            assert result.returncode != 0, label
            for index, path in enumerate(all_paths):
                if index == preexisting: assert path.read_bytes() == b'existing artifact must survive\n'
                else: assert not path.exists() and not path.is_symlink(), (label, path)
        passed(label)
    run_case('two_targets_created_with_check_only')
    run_case('wrong_old133_source_refused',valid=False,old_identity=('a'*40,old_tree))
    run_case('wrong_target140_tree_refused_before_outputs',valid=False,identity140=(sha140,'b'*40))
    run_case('partial_rollback134_artifact_preserved',valid=False,preexisting=0)
    run_case('partial_target140_artifact_preserved_without_134_outputs',valid=False,preexisting=5)
    original_check.write_text(original_check.read_text()+'# drift\n')
    run_case('changed_old133_check_hash_refused_before_outputs',valid=False)
    original_check.write_text(template.replace('start-local-closures','check-local-closures'))
    original.chmod(0o755)
    run_case('unsafe_old133_launcher_mode_refused',valid=False)
    original.chmod(0o700)
    wrong_deps = root/'wrong-deps';wrong_deps.mkdir()
    link=target140/'node_modules';link.unlink();link.symlink_to(wrong_deps,target_is_directory=True)
    run_case('wrong_second_target_dependency_link_refused_without_134_outputs',valid=False)
    assert link.resolve()==wrong_deps
    link.unlink();link.symlink_to(deps,target_is_directory=True)
    def change_commit(target,path,content):
        path.write_text(content);git_at(target,'add',str(path));git_at(target,'-c','user.name=Synthetic Fixture','-c','user.email=fixture@example.invalid','commit','-qm','synthetic incompatible target')
    change_commit(target140,target140/'db/migrations/0031_fixture.sql','-- changed\n')
    run_case('changed_target140_migration_refused_without_134_outputs',valid=False)
    git_at(target140,'reset','--hard',sha140)
    changed=json.loads((target134/'package-lock.json').read_text());changed['packages']['node_modules/fixture']['integrity']='changed'
    change_commit(target134,target134/'package-lock.json',json.dumps(changed))
    run_case('changed_rollback134_dependencies_refused',valid=False)
    git_at(target134,'reset','--hard',sha134)
    changed=json.loads((target140/'package.json').read_text());changed['version']='1.3.4'
    change_commit(target140,target140/'package.json',json.dumps(changed))
    run_case('wrong_target140_version_refused',valid=False)
    git_at(target140,'reset','--hard',sha140)
    (old/'package.json').write_text((old/'package.json').read_text()+' ')
    run_case('dirty_old133_source_refused',valid=False)
    git_at(old,'checkout','--','package.json')

    # Exact final report code, isolated from all staging/network/runtime actions.
    node=root/'node-fixture';node.write_bytes(b'synthetic node bytes');node.chmod(0o700)
    node_sha=hashlib.sha256(node.read_bytes()).hexdigest()
    report_root=root/'report';report_root.mkdir()
    report134,report140=case_paths(report_root,'134'),case_paths(report_root,'140')
    for paths in [report134,report140]:
        for path in paths[:2]:path.write_bytes(b'#!/bin/bash\n');path.chmod(0o700)
        paths[2].write_bytes(b'');paths[2].chmod(0o600)
    receipt={'type':'local_closure_precheck','status':'passed','started':False,'erased':False,'pendingClosures':False}
    def report_case(label,*,valid=True,receipts134=None,receipts140=None,runtime134=b'',runtime140=b'',expected_node=None):
        for paths,receipts,normal in [(report134,receipts134,runtime134),(report140,receipts140,runtime140)]:
            paths[2].write_bytes(normal)
            paths[3].write_text('\n'.join(json.dumps(value) for value in ([receipt] if receipts is None else receipts))+'\n');paths[3].chmod(0o600)
        args=[str(node),expected_node or node_sha,str(original),str(original_check),sha134,tree134,str(target134),*map(str,report134),sha140,tree140,str(target140),*map(str,report140)]
        result=subprocess.run(['python3','-c',fixture_block(1),*args],env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        if valid:
            assert result.returncode==0,(label,result.stderr.decode())
            value=json.loads(result.stdout)
            assert value['status']=='staged_precheck_passed' and value['version']=='1.4.0' and value['source']==sha140
            assert [entry['version'] for entry in value['releases']]==['1.3.4','1.4.0']
            assert value['bothPrechecksPassed'] is True and value['rollback134HostedQualified'] is True
            assert value['rollbackRelease']=='1.3.4' and value['rollbackLauncher']==str(report134[0])
            assert value['priorActiveVersion']=='1.3.3' and value['priorActivePreserved'] is True and value['priorActiveImmediateRollbackForV2'] is False
            assert value['schemaMigrations']==31 and value['migrationsUnchanged'] is True
            for entry in [value,*value['releases']]:
                assert entry['noRestart'] is True
                assert all(entry[key] is False for key in ['started','erased','migrated','managerChanged','runtimeStarted','checkpointChanged'])
        else:assert result.returncode!=0 and b'rollback134HostedQualified' not in result.stdout,(label,result.stdout)
        passed(label)
    report_case('both_passed_prechecks_qualify_rollback134_and_target140')
    report_case('missing_rollback134_receipt_refused',valid=False,receipts134=[])
    report_case('missing_target140_receipt_refused',valid=False,receipts140=[])
    report_case('duplicate_rollback134_receipt_refused',valid=False,receipts134=[receipt,receipt])
    report_case('runtime_started_target140_receipt_refused',valid=False,receipts140=[dict(receipt,started=True)])
    report_case('erased_rollback134_receipt_refused',valid=False,receipts134=[dict(receipt,erased=True)])
    report_case('non_boolean_pending_closures_refused',valid=False,receipts140=[dict(receipt,pendingClosures='false')])
    report_case('rollback134_runtime_log_not_empty_refused',valid=False,runtime134=b'unexpected start')
    report_case('target140_runtime_log_not_empty_refused',valid=False,runtime140=b'unexpected start')
    report_case('changed_node_before_receipt_refused',valid=False,expected_node='0'*64)

assert hashlib.sha256(SCRIPT.read_bytes()).hexdigest()==snapshot,'production helper changed during fixture checks'
print(f'RESULT {len(results)}/{len(results)} passed; script_sha256={snapshot}; no remote or full staging execution')
