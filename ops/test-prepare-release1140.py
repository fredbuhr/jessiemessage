#!/usr/bin/env python3
"""Synthetic staging tests; --native-install runs one disposable real npm ci.

Neither mode calls a production path, CHECK, runtime, database or host service.
The explicit native mode requires network access to the pinned Node archive and
the registry. Its entire installation is removed with its synthetic directory.
"""
import copy
import hashlib
import io
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tarfile
import tempfile
import types
import unittest
from unittest import mock

HERE = Path(__file__).resolve().parent


def helper():
    path = HERE / 'prepare-release1140.py'
    module = types.ModuleType('prepare1140_synthetic')
    module.__file__ = str(path)
    with mock.patch('subprocess.run', side_effect=AssertionError('import must not execute anything')):
        exec(compile(path.read_bytes(), str(path), 'exec'), module.__dict__)
    return module


def sha(data):
    return hashlib.sha256(data).hexdigest()


def archive_bytes(module, additions=(), *, node=None):
    entries = [(module.ARCHIVE_ROOT + '/lib/node_modules/npm/package.json', b'{"name":"npm","version":"11.99.0"}'),
               (module.ARCHIVE_ROOT + '/lib/node_modules/npm/bin/npm-cli.js', b'// synthetic npm never executed\n')]
    if node is not None:
        entries.append((module.ARCHIVE_ROOT + '/bin/node', node))
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode='w:xz') as archive:
        for name, data in [*entries, *additions]:
            info = tarfile.TarInfo(name); info.size = len(data)
            archive.addfile(info, io.BytesIO(data))
    return output.getvalue()


class Fixture:
    def __init__(self):
        self.temp = tempfile.TemporaryDirectory(prefix='prepare1140-synthetic-', dir=HERE.parent)
        try:
            self.initialize()
        except BaseException:
            self.temp.cleanup()
            raise
    def initialize(self):
        self.root = Path(self.temp.name); self.seed = self.root / 'seed'; self.origin = self.root / 'origin.git'
        self.operator, self.private = self.root / 'operator', self.root / 'private'
        for path in (self.seed, self.operator, self.private):
            path.mkdir(mode=0o700)
        self.git(self.root, 'init', '--bare', str(self.origin)); self.git(self.origin, 'symbolic-ref', 'HEAD', 'refs/heads/main')
        self.git(self.seed, 'init', '-b', 'main'); self.git(self.seed, 'remote', 'add', 'origin', str(self.origin))
        (self.seed / '.gitignore').write_text('node_modules\n')
        self.m = helper()
        self.write_version('1.13.0')
        for directory, names in [('db/migrations', [f'{n:04d}_synthetic.sql' for n in range(1, 34)]),
                                  ('server/video/migrations', self.m.VIDEO_DDL),
                                  ('server/experience/migrations', self.m.EXPERIENCE_DDL)]:
            target = self.seed / directory; target.mkdir(parents=True)
            for name in names:
                (target / name).write_text('CREATE TABLE synthetic (id INT);\n')
        self.base_sha, self.base_tree = self.commit()
        self.write_version('1.14.0'); self.target_sha, self.target_tree = self.commit()
        self.git(self.seed, 'tag', 'v1.14.0'); self.git(self.seed, 'push', 'origin', 'main', 'refs/tags/v1.14.0')
        self.base = self.operator / 'production-1130-b9e2ad78'
        self.git(self.root, 'clone', '--no-tags', str(self.origin), str(self.base))
        self.git(self.base, 'checkout', '--detach', self.base_sha)
        self.deps = self.operator / 'production-1101-9eb99f1f/node_modules'
        self.deps.parent.mkdir(mode=0o700); self.deps.mkdir(mode=0o700)
        (self.deps / 'old-sentinel').write_bytes(b'never replace active dependency bytes')
        (self.base / 'node_modules').symlink_to(self.deps, target_is_directory=True)
        self.node = self.private / 'runtime-node-v24.22.1/bin/node'; self.node.parent.mkdir(parents=True, mode=0o700)
        self.node.write_bytes(b'synthetic node never executed'); self.node.chmod(0o700)
        self.checkpoint = self.private / 'jm0702-existing-pc-update.json'
        self.checkpoint.write_text(json.dumps(dict(activeService=dict(release='1.13.0', source=self.base_sha, tree=self.base_tree),
                                                    developmentSimplification={'release1130': {'complete': True}}, other={'preserve': True})))
        self.checkpoint.chmod(0o600)
        self.prior_staging = self.private / 'jm1130-staging.json'; self.prior_staging.write_bytes(b'synthetic1130 staging'); self.prior_staging.chmod(0o600)
        self.launchers = []
        for is_check in (False, True):
            name = ('check' if is_check else 'start') + '-primary-release1130-b9e2ad78.sh'
            path = self.private / name
            log = self.private / ('jm1130-preflight-node24221-b9e2ad78.log' if is_check else 'jm1130-node24221.log')
            command = 'check-local-closures' if is_check else 'start-local-closures'
            path.write_text('#!/bin/bash\nset -euo pipefail\n'
                f'# source {self.base_sha}\n# tree {self.base_tree}\ncd {self.base}\nexec {self.node} '
                f'{self.base}/scripts/recurring-private-checkpoint.mjs {command} --experience 1 '
                f'--profile {self.m.PROFILE} --private-path-mode linux-dirfd '
                f'--configuration-directory {self.private}/runtime-video-180 --directory {self.private}/recurring-backup-052 >> {log} 2>&1\n')
            path.chmod(0o700); log.write_bytes(b'active log untouched'); log.chmod(0o600)
            self.launchers.append(path)
        self.archive = archive_bytes(self.m)
        for key, value in dict(PRIVATE=self.private, BASE_CHECKOUT=self.base, DEPENDENCY_ROOT=self.deps,
                BASE_SOURCE=self.base_sha, BASE_TREE=self.base_tree, RELEASE_SOURCE=self.target_sha, RELEASE_TREE=self.target_tree,
                START_PIN=sha(self.launchers[0].read_bytes()), CHECK_PIN=sha(self.launchers[1].read_bytes()),
                NODE_PIN=sha(self.node.read_bytes()), CHECKPOINT_PIN=sha(self.checkpoint.read_bytes()),
                BASE_STAGING_SHA=sha(self.prior_staging.read_bytes()), ARCHIVE_SHA=sha(self.archive), ARCHIVE_BYTES=len(self.archive)).items():
            setattr(self.m, key, value)
        self.codec = {name: ('synthetic codec ' + name).encode() for name in self.m.CODEC_FILES}
        self.m.CODEC_FILES = {name: sha(data) for name, data in self.codec.items()}
        self.preserved = {path: path.read_bytes() for path in [self.node, self.checkpoint, self.prior_staging,
            *self.launchers, self.private / 'jm1130-node24221.log', self.private / 'jm1130-preflight-node24221-b9e2ad78.log', self.deps / 'old-sentinel']}
        self.calls = []; self.install_exit = 0; self.install_timeout = False; self.installed_mutation = None
    def __enter__(self):
        return self
    def __exit__(self, *_):
        self.temp.cleanup()
    @staticmethod
    def git(root, *args):
        result = subprocess.run(['/usr/bin/git', '-C', str(root), *args], check=True, timeout=10,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            env=dict(os.environ, GIT_CONFIG_NOSYSTEM='1', GIT_CONFIG_GLOBAL='/dev/null', GIT_TERMINAL_PROMPT='0'))
        return result.stdout.decode().strip()
    def write_version(self, version):
        deps = dict(self.m.ROOT_DEPENDENCIES)
        if version == '1.13.0':
            del deps['libheif-js']
        package = dict(name='jessiemessage', private=True, version=version, dependencies=deps)
        records = {'': dict(name='jessiemessage', version=version, dependencies=deps)}
        records.update({'node_modules/' + key: dict(version=value) for key, value in deps.items()})
        if 'libheif-js' in deps:
            records['node_modules/libheif-js'] = copy.deepcopy(self.m.HEIF_RECORD)
        (self.seed / 'package.json').write_text(json.dumps(package))
        (self.seed / 'package-lock.json').write_text(json.dumps(dict(name='jessiemessage', version=version, lockfileVersion=3, packages=records)))
    def commit(self):
        self.git(self.seed, 'add', '-A')
        self.git(self.seed, '-c', 'user.name=Synthetic', '-c', 'user.email=synthetic@example.invalid', 'commit', '-m', 'synthetic')
        return self.git(self.seed, 'rev-parse', 'HEAD'), self.git(self.seed, 'rev-parse', 'HEAD^{tree}')
    def advance(self, change):
        change(self); self.target_sha, self.target_tree = self.commit()
        self.m.RELEASE_SOURCE, self.m.RELEASE_TREE = self.target_sha, self.target_tree
        self.git(self.seed, 'tag', '-f', 'v1.14.0'); self.git(self.seed, 'push', '--force', 'origin', 'main', 'refs/tags/v1.14.0')
    def stage(self):
        actual = subprocess.run
        def run(args, **kwargs):
            self.calls.append((list(args), kwargs))
            if args[0] != str(self.node):
                assert args[0] in ('/usr/bin/git', '/bin/bash'), 'unexpected execution'
                if args[0] == '/bin/bash':
                    assert list(args) == ['/bin/bash', '-n'], 'launcher cannot be executed'
                return actual(args, **kwargs)
            if args[1:] == ['--version']:
                return subprocess.CompletedProcess(args, 0, b'v24.22.1\n', b'')
            if args[1] == '-e':
                return subprocess.CompletedProcess(args, 0, b'', b'')
            assert args[2:6] == ['ci', '--ignore-scripts', '--no-audit', '--no-fund']
            if self.install_timeout:
                raise subprocess.TimeoutExpired(args, 300)
            if self.install_exit:
                return subprocess.CompletedProcess(args, self.install_exit)
            checkout = Path(kwargs['cwd']); modules = checkout / 'node_modules'; modules.mkdir(mode=0o700)
            for name, version in self.m.ROOT_DEPENDENCIES.items():
                directory = modules / name; directory.mkdir(mode=0o700)
                (directory / 'package.json').write_text(json.dumps(dict(name=name, version=version)))
            for name, data in self.codec.items():
                path = modules / 'libheif-js' / name; path.parent.mkdir(parents=True, exist_ok=True, mode=0o700); path.write_bytes(data)
            if self.installed_mutation:
                self.installed_mutation(checkout)
            return subprocess.CompletedProcess(args, 0)
        with mock.patch.object(self.m, 'download_archive', return_value=self.archive), mock.patch.object(self.m.subprocess, 'run', side_effect=run):
            return self.m.stage(self.target_sha, self.target_tree)
    def assert_preserved(self, case):
        for path, data in self.preserved.items():
            case.assertEqual(path.read_bytes(), data, path.name)
        case.assertEqual(self.git(self.base, 'rev-parse', 'HEAD'), self.base_sha)
        case.assertEqual(os.readlink(self.base / 'node_modules'), str(self.deps))


class Pins(unittest.TestCase):
    def test_constructor_error_removes_its_synthetic_directory(self):
        before = set(HERE.parent.glob('prepare1140-synthetic-*'))
        with mock.patch.object(Fixture, 'initialize', side_effect=RuntimeError('synthetic setup failure')):
            with self.assertRaisesRegex(RuntimeError, 'synthetic setup failure'):
                Fixture()
        self.assertEqual(set(HERE.parent.glob('prepare1140-synthetic-*')), before)
    def test_pending_or_finalized_pair_and_exact_baseline_pins(self):
        m = helper()
        self.assertTrue((m.RELEASE_SOURCE, m.RELEASE_TREE) == ('QUALIFICATION_PENDING', 'QUALIFICATION_PENDING')
                        or all(m.SHA.fullmatch(pin) for pin in (m.RELEASE_SOURCE, m.RELEASE_TREE)))
        self.assertEqual(m.CHECKPOINT_PIN, 'cdcb3f8b35208ddfaff19009235f86d4dd23a10ac13b00c9c692daad2bbe496d')
        self.assertEqual(m.BASE_STAGING_SHA, '08eb630927a84cc63c0b552fa9f729ab7ee2433f6c3fc8aca1466c007f021ecd')
        self.assertEqual(m.BASE_SOURCE, 'b9e2ad78b47dccb72b8e793cdc448e6b70424430')
        self.assertEqual(m.ARCHIVE_SHA, '6c172a9ab6718f7b801fb5a7bd486af2ee5e32758086a04b84fcce2aa77095e6')
        self.assertEqual(m.ARCHIVE_BYTES, 32026916)
    def test_pending_and_partial_pins_refuse_before_private_network_or_process_access(self):
        m = helper()
        for pins in [('QUALIFICATION_PENDING', 'QUALIFICATION_PENDING'), ('a' * 40, 'QUALIFICATION_PENDING'), ('QUALIFICATION_PENDING', 'b' * 40)]:
            with self.subTest(pins=pins), mock.patch.multiple(m, RELEASE_SOURCE=pins[0], RELEASE_TREE=pins[1]), \
                 mock.patch.object(m, 'private_directory', side_effect=AssertionError('no private access')), \
                 mock.patch.object(m, 'download_archive', side_effect=AssertionError('no network')), \
                 mock.patch.object(m, 'command', side_effect=AssertionError('no process')):
                with self.assertRaisesRegex(m.StagingRefused, 'release1140_pins_pending'):
                    m.stage('a' * 40, 'b' * 40)
    def test_finalized_pin_mismatch_refuses_before_private_access(self):
        m = helper()
        with mock.patch.multiple(m, RELEASE_SOURCE='a' * 40, RELEASE_TREE='b' * 40), \
             mock.patch.object(m, 'private_directory', side_effect=AssertionError('no access')):
            for args in [('c' * 40, 'b' * 40), (None, 'b' * 40), ('a' * 40, 'bad')]:
                with self.subTest(args=args), self.assertRaises(m.StagingRefused):
                    m.stage(*args)


class Staging(unittest.TestCase):
    def test_fresh_private_install_preserves_active_state_and_only_stages_receipt(self):
        with Fixture() as f:
            result = f.stage(); target = Path(result['checkout'])
            self.assertFalse((target / 'node_modules').is_symlink())
            self.assertNotEqual((target / 'node_modules').resolve(), f.deps)
            self.assertFalse(result['dependenciesReused']); self.assertEqual(result['baselineMetadataRelease'], '1.13.0')
            self.assertEqual(result['dependencies']['directVersions'], f.m.ROOT_DEPENDENCIES)
            self.assertEqual(result['installer']['npmVersion'], '11.99.0')
            self.assertEqual(f.git(target, 'rev-parse', 'HEAD'), f.target_sha)
            for path in [target, target / 'node_modules', Path(result['installer']['npmCli']).parents[2]]:
                self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o700)
            for key in ('hostedQualified', 'precheckPassed', 'started', 'migrated', 'runtimeStarted', 'checkpointChanged', 'managerChanged'):
                self.assertIs(result[key], False)
            self.assertTrue(result['noRestart']); self.assertEqual(result['preservedActiveCheckpointSha256'], sha(f.checkpoint.read_bytes()))
            receipt = Path(result['receipt']); self.assertEqual(sha(receipt.read_bytes()), result['receiptSha256'])
            self.assertEqual(stat.S_IMODE(receipt.stat().st_mode), 0o600)
            install_args, options = next((a, k) for a, k in f.calls if len(a) > 2 and a[2] == 'ci')
            self.assertEqual(options['cwd'], str(target)); self.assertEqual(options['timeout'], 300)
            self.assertIn('--globalconfig=/dev/null', install_args)
            self.assertEqual(set(options['env']), {'PATH', 'LC_ALL', 'TMPDIR', 'NPM_CONFIG_USERCONFIG', 'NPM_CONFIG_GLOBALCONFIG', 'NPM_CONFIG_UPDATE_NOTIFIER'})
            self.assertTrue(all('--omit=optional' not in arg for arg in install_args))
            self.assertEqual(sum(args[0] == '/bin/bash' for args, _ in f.calls), 2)
            f.assert_preserved(self)
    def test_automatic_retry_refuses_existing_outputs(self):
        with Fixture() as f:
            first = f.stage(); before = Path(first['receipt']).read_bytes()
            with self.assertRaisesRegex(f.m.StagingRefused, 'existing_output'):
                f.stage()
            self.assertEqual(Path(first['receipt']).read_bytes(), before); f.assert_preserved(self)
    def test_every_preexisting_output_including_a_dangling_symlink_refuses_before_new_checkout(self):
        for name in ('checkout', 'tools', 'start', 'check', 'log', 'prelog', 'receipt'):
            with self.subTest(name=name), Fixture() as f:
                plan = f.m.release_plan(f.target_sha, f.target_tree)
                path = f.private / 'jm1140-staging.json' if name == 'receipt' else plan[name]
                path.symlink_to(f.root / 'absent-preserved-target')
                with self.assertRaisesRegex(f.m.StagingRefused, 'existing_output'):
                    f.stage()
                self.assertTrue(path.is_symlink()); self.assertEqual(os.readlink(path), str(f.root / 'absent-preserved-target'))
                if name != 'checkout':
                    self.assertFalse(plan['checkout'].exists())
                f.assert_preserved(self)
    def test_nonzero_or_timeout_install_preserves_partial_without_final_receipt_or_launchers(self):
        for failure in ('nonzero', 'timeout'):
            with self.subTest(failure=failure), Fixture() as f:
                f.install_exit = 19 if failure == 'nonzero' else 0; f.install_timeout = failure == 'timeout'
                with self.assertRaisesRegex(f.m.StagingRefused, 'npm_install'):
                    f.stage()
                self.assertFalse((f.private / 'jm1140-staging.json').exists())
                self.assertFalse(f.m.release_plan(f.target_sha, f.target_tree)['start'].exists())
                self.assertTrue(f.m.release_plan(f.target_sha, f.target_tree)['checkout'].exists())
                self.assertTrue(f.m.release_plan(f.target_sha, f.target_tree)['tools'].exists())
                f.assert_preserved(self)
    def test_checkpoint_staging_launcher_node_and_active_dependencies_drift_refuse_before_install(self):
        for kind in ('checkpoint', 'staging', 'launcher', 'node', 'dependencies'):
            with self.subTest(kind=kind), Fixture() as f:
                if kind == 'dependencies':
                    (f.base / 'node_modules').unlink(); (f.base / 'node_modules').symlink_to(f.root)
                else:
                    path = {'checkpoint': f.checkpoint, 'staging': f.prior_staging, 'launcher': f.launchers[0], 'node': f.node}[kind]
                    path.write_bytes(path.read_bytes() + b'drift')
                with self.assertRaises(f.m.StagingRefused):
                    f.stage()
                self.assertFalse(f.m.release_plan(f.target_sha, f.target_tree)['checkout'].exists())
    def test_changed_lock_or_migration_or_tracked_npm_configuration_refuses_before_new_checkout(self):
        for kind in ('other_lock', 'heif', 'migration', 'npmrc', 'tracked_modules'):
            with self.subTest(kind=kind), Fixture() as f:
                def edit(value):
                    if kind in ('other_lock', 'heif'):
                        path = value.seed / 'package-lock.json'; lock = json.loads(path.read_text())
                        lock['packages']['node_modules/' + ('mariadb' if kind == 'other_lock' else 'libheif-js')]['version'] = '99.0.0'; path.write_text(json.dumps(lock))
                    elif kind == 'migration':
                        (value.seed / 'server/experience/migrations/0038_reply_tracking.sql').write_text('changed')
                    elif kind == 'npmrc':
                        (value.seed / '.npmrc').write_text('ignore-scripts=false')
                    else:
                        (value.seed / 'node_modules').mkdir(); (value.seed / 'node_modules/forbidden').write_text('tracked')
                        value.git(value.seed, 'add', '-f', 'node_modules/forbidden')
                f.advance(edit)
                with self.assertRaises(f.m.StagingRefused):
                    f.stage()
                self.assertFalse(f.m.release_plan(f.target_sha, f.target_tree)['checkout'].exists()); f.assert_preserved(self)
    def test_wrong_tag_or_main_without_candidate_refuses_before_checkout(self):
        for kind in ('tag', 'main'):
            with self.subTest(kind=kind), Fixture() as f:
                if kind == 'tag':
                    f.git(f.seed, 'tag', '-f', 'v1.14.0', f.base_sha); f.git(f.seed, 'push', '--force', 'origin', 'refs/tags/v1.14.0')
                else:
                    f.git(f.seed, 'push', '--force', 'origin', f.base_sha + ':refs/heads/main')
                with self.assertRaises(f.m.StagingRefused):
                    f.stage()
                self.assertFalse(f.m.release_plan(f.target_sha, f.target_tree)['checkout'].exists()); f.assert_preserved(self)
    def test_setgid_parent_only_new_roots_normalized(self):
        with Fixture() as f:
            f.operator.chmod(0o2700); f.private.chmod(0o2700)
            # Private authority itself must remain exactly0700; setgid is exercised
            # on the worktree parent, not by relaxing existing private guards.
            f.private.chmod(0o700)
            result = f.stage()
            self.assertEqual(stat.S_IMODE(Path(result['checkout']).stat().st_mode), 0o700)
            self.assertEqual(stat.S_IMODE(f.operator.stat().st_mode), 0o2700); f.assert_preserved(self)
    def test_manifest_codec_and_external_link_in_installed_tree_refuse_receipt(self):
        for kind in ('manifest', 'codec', 'link', 'hardlink'):
            with self.subTest(kind=kind), Fixture() as f:
                def mutate(checkout):
                    root = checkout / 'node_modules'
                    if kind == 'manifest':
                        (root / 'libheif-js/package.json').write_text('{"name":"libheif-js","version":"wrong"}')
                    elif kind == 'codec':
                        (root / 'libheif-js/libheif-wasm/libheif-bundle.mjs').write_bytes(b'wrong')
                    elif kind == 'link':
                        (root / 'escape').symlink_to(f.deps)
                    else:
                        os.link(f.deps / 'old-sentinel', root / 'hardlinked-active')
                f.installed_mutation = mutate
                with self.assertRaises(f.m.StagingRefused):
                    f.stage()
                self.assertFalse((f.private / 'jm1140-staging.json').exists()); f.assert_preserved(self)
    def test_install_cannot_change_manifest_or_lock(self):
        for name in ('package.json', 'package-lock.json'):
            with self.subTest(name=name), Fixture() as f:
                f.installed_mutation = lambda checkout: (checkout / name).write_bytes(b'changed')
                with self.assertRaisesRegex(f.m.StagingRefused, 'install_manifest_changed'):
                    f.stage()
                self.assertFalse((f.private / 'jm1140-staging.json').exists()); f.assert_preserved(self)
    def test_newer_checkpoint_during_install_is_never_overwritten_or_finalized(self):
        with Fixture() as f:
            newer = b'newer concurrent operator state must survive'
            f.installed_mutation = lambda _checkout: f.checkpoint.write_bytes(newer)
            with self.assertRaisesRegex(f.m.StagingRefused, 'checkpoint_changed'):
                f.stage()
            self.assertEqual(f.checkpoint.read_bytes(), newer)
            self.assertFalse((f.private / 'jm1140-staging.json').exists())
            self.assertFalse(f.m.release_plan(f.target_sha, f.target_tree)['start'].exists())
    def test_active_dependency_mutation_during_install_refuses_final_receipt_without_undoing_it(self):
        with Fixture() as f:
            newer = b'concurrent change must survive'
            f.installed_mutation = lambda _checkout: (f.deps / 'old-sentinel').write_bytes(newer)
            with self.assertRaisesRegex(f.m.StagingRefused, 'active_dependencies_changed'):
                f.stage()
            self.assertEqual((f.deps / 'old-sentinel').read_bytes(), newer)
            self.assertFalse((f.private / 'jm1140-staging.json').exists())


class Archive(unittest.TestCase):
    def test_secure_extraction_rejects_identity_mismatch_before_writes(self):
        m = helper()
        with tempfile.TemporaryDirectory(dir=HERE.parent) as temporary:
            root = Path(temporary); root.chmod(0o700)
            with self.assertRaisesRegex(m.StagingRefused, 'archive_identity'):
                m.extract_tools(b'not pinned', root)
            self.assertEqual(list(root.iterdir()), [])
    def test_archive_traversal_duplicate_and_links_refuse_without_extraction(self):
        m = helper()
        for kind in ('traversal', 'duplicate', 'symlink', 'hardlink'):
            with self.subTest(kind=kind), tempfile.TemporaryDirectory(dir=HERE.parent) as temporary:
                root = Path(temporary); root.chmod(0o700)
                prefix = m.ARCHIVE_ROOT + '/lib/node_modules/npm/'
                if kind in ('symlink', 'hardlink'):
                    data = io.BytesIO()
                    with tarfile.open(fileobj=data, mode='w:xz') as archive:
                        info = tarfile.TarInfo(prefix + 'escape'); info.type = tarfile.SYMTYPE if kind == 'symlink' else tarfile.LNKTYPE
                        info.linkname = '../../../../outside'; archive.addfile(info)
                    raw = data.getvalue()
                else:
                    raw = archive_bytes(m, [(prefix + ('../escape' if kind == 'traversal' else 'package.json'), b'bad')])
                with mock.patch.multiple(m, ARCHIVE_SHA=sha(raw), ARCHIVE_BYTES=len(raw)):
                    with self.assertRaises(m.StagingRefused):
                        m.extract_tools(raw, root)
                self.assertEqual(list(root.iterdir()), [])
    def test_native_mode_can_extract_only_exact_node_plus_npm(self):
        m = helper(); node = b'qualified synthetic node'; raw = archive_bytes(m, node=node)
        with tempfile.TemporaryDirectory(dir=HERE.parent) as temporary, \
             mock.patch.multiple(m, ARCHIVE_SHA=sha(raw), ARCHIVE_BYTES=len(raw), NODE_PIN=sha(node)):
            root = Path(temporary); root.chmod(0o700)
            result = m.extract_tools(raw, root, include_node=True)
            self.assertEqual((root / 'node').read_bytes(), node); self.assertEqual(result['npmVersion'], '11.99.0')
            self.assertEqual(stat.S_IMODE((root / 'node').stat().st_mode), 0o700)
    def test_npm_environment_drops_inherited_hooks_credentials_and_proxy(self):
        m = helper()
        with mock.patch.dict(os.environ, {'NODE_OPTIONS': '--require=forbidden', 'NPM_CONFIG_IGNORE_SCRIPTS': 'false',
                                        'HTTPS_PROXY': 'forbidden', 'NPM_TOKEN': 'synthetic-secret'}):
            env = m.npm_environment(Path('/private/node'), Path('/private/cache'), Path('/private/tmp'))
        self.assertNotIn('NODE_OPTIONS', env); self.assertNotIn('NPM_TOKEN', env); self.assertNotIn('HTTPS_PROXY', env)
        self.assertEqual(env['NPM_CONFIG_USERCONFIG'], '/dev/null')
    def test_archive_download_requires_exact_url_length_and_hash(self):
        m = helper()
        for kind in ('status', 'redirect', 'length', 'hash'):
            with self.subTest(kind=kind):
                response = mock.MagicMock()
                response.__enter__.return_value = response
                response.status = 500 if kind == 'status' else 200
                response.url = 'https://unexpected.invalid/' if kind == 'redirect' else m.ARCHIVE_URL
                response.read.return_value = b'ab' if kind == 'length' else b'abc'
                opener = mock.Mock(); opener.open.return_value = response
                with mock.patch.multiple(m, ARCHIVE_BYTES=3, ARCHIVE_SHA=sha(b'xyz') if kind == 'hash' else sha(b'abc')), \
                     mock.patch.object(m.urllib.request, 'build_opener', return_value=opener):
                    with self.assertRaises(m.StagingRefused):
                        m.download_archive()


def native_install():
    """One isolated installation under the exact official Node/npm distribution."""
    m = helper()
    package_bytes = (HERE.parent / 'package.json').read_bytes(); lock_bytes = (HERE.parent / 'package-lock.json').read_bytes()
    package, lock = json.loads(package_bytes), json.loads(lock_bytes)
    m.require(package.get('version') == lock.get('version') == lock['packages']['']['version'] == '1.14.0', 'native_version')
    m.require(package.get('dependencies') == lock['packages']['']['dependencies'] == m.ROOT_DEPENDENCIES, 'native_dependencies')
    m.require(lock['packages'].get('node_modules/libheif-js') == m.HEIF_RECORD, 'native_heif_lock')
    archive = m.download_archive()
    old_umask = os.umask(0o077)
    try:
        with tempfile.TemporaryDirectory(prefix='prepare1140-native-', dir=HERE.parent) as temporary:
            root = Path(temporary); m.normalize_created_directory(root)
            checkout, tools = root / 'candidate', root / 'tools'
            m.make_private(checkout); m.make_private(tools)
            m.write_exclusive(checkout / 'package.json', package_bytes); m.write_exclusive(checkout / 'package-lock.json', lock_bytes)
            installer = m.extract_tools(archive, tools, include_node=True)
            node = tools / 'node'
            m.require(m.command([str(node), '--version']).decode().strip() == m.NODE_VERSION, 'native_node_version')
            installation = m.install_dependencies(checkout, tools, node, package_bytes, lock_bytes)
            print(json.dumps(dict(status='prepare1140_native_install_passed', nodeVersion=m.NODE_VERSION,
                installer=installer, dependencies=installation, productionPathsAccessed=False,
                checkExecuted=False, runtimeStarted=False, syntheticDirectoryRemovedOnExit=True), sort_keys=True))
    finally:
        os.umask(old_umask)


if __name__ == '__main__':
    if sys.argv[1:] == ['--native-install']:
        native_install()
    else:
        unittest.main(verbosity=2)
