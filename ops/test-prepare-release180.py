#!/usr/bin/env python3
"""Disposable local-Git tests; never call staging with production constants."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shlex
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest import mock
import uuid

HERE = Path(__file__).resolve().parent
HELPER = HERE / 'prepare-release180.py'
VIDEO_DDL = ('0034_video_storage_state.sql', '0035_video_assets.sql', '0036_message_video.sql')


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_helper():
    name = 'prepare180_' + uuid.uuid4().hex
    spec = importlib.util.spec_from_file_location(name, HELPER)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    try:
        with mock.patch('subprocess.run', side_effect=AssertionError('import must have no process side effects')):
            spec.loader.exec_module(module)
    finally:
        sys.modules.pop(name, None)
    return module


class Fixture:
    def __init__(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='prepare180-test-', dir=HERE.parent)
        self.root = Path(self.temporary.name)
        self.seed = self.root / 'seed'
        self.origin = self.root / 'origin.git'
        self.operator = self.root / 'operator'
        self.private = self.root / 'private'
        for directory in (self.seed, self.operator, self.private):
            directory.mkdir(mode=0o700)
        self.run_git(self.root, 'init', '--bare', str(self.origin))
        self.run_git(self.origin, 'symbolic-ref', 'HEAD', 'refs/heads/main')
        self.run_git(self.seed, 'init', '-b', 'main')
        self.run_git(self.seed, 'remote', 'add', 'origin', str(self.origin))
        (self.seed / '.gitignore').write_text('node_modules\n')
        self.dependencies = {'mariadb': '3.5.4'}
        self.write_version('1.7.1')
        normal = self.seed / 'db/migrations'; normal.mkdir(parents=True)
        for number in range(1, 34):
            (normal / f'{number:04d}_synthetic.sql').write_text(f'CREATE TABLE synthetic_{number} (id INT);\n')
        self.base_sha, self.base_tree = self.commit('baseline1.7.1')
        self.write_version('1.7.2')
        video = self.seed / 'server/video/migrations'; video.mkdir(parents=True)
        for number, name in enumerate(VIDEO_DDL, start=34):
            (video / name).write_text(f'CREATE TABLE synthetic_video_{number} (id INT);\n')
        self.sha172, self.tree172 = self.commit('compatible1.7.2')
        self.run_git(self.seed, 'tag', 'v1.7.2')
        self.write_version('1.8.0')
        self.sha180, self.tree180 = self.commit('candidate1.8.0')
        self.run_git(self.seed, 'tag', 'v1.8.0')
        self.run_git(self.seed, 'push', 'origin', 'main', 'refs/tags/v1.7.2', 'refs/tags/v1.8.0')
        self.base = self.operator / 'production-171-c2d7b3b3'
        self.run_git(self.root, 'clone', '--no-tags', str(self.origin), str(self.base))
        self.run_git(self.base, 'checkout', '--detach', self.base_sha)
        self.deps = self.base / 'node_modules'
        self.deps.mkdir(mode=0o700)
        (self.deps / 'synthetic-dependencies').write_text('never installed or executed\n')
        self.node_trace = self.root / 'node-invocations'
        self.node = self.private / 'runtime-node-v24.22.1/bin/node'
        self.node.parent.mkdir(parents=True, mode=0o700)
        self.node.write_text('#!/bin/sh\n'
                             'if [ "$#" -ne 1 ] || [ "$1" != --version ]; then\n'
                             f'  printf "FORBIDDEN\\n" >> {shlex.quote(str(self.node_trace))}\n'
                             '  exit 97\nfi\n'
                             f'printf "version\\n" >> {shlex.quote(str(self.node_trace))}\n'
                             'printf "v24.22.1\\n"\n')
        self.node.chmod(0o700)
        self.start = self.private / 'start-primary-release171-c2d7b3b3.sh'
        self.check = self.private / 'check-primary-release171-c2d7b3b3.sh'
        for path, check in ((self.start, False), (self.check, True)):
            operation = 'check-local-closures' if check else 'start-local-closures'
            log = self.private / ('jm171-preflight-node24221-c2d7b3b3.log' if check else 'jm171-node24221.log')
            path.write_text('#!/bin/bash\nset -euo pipefail\n'
                            f'# source {self.base_sha}\n# tree {self.base_tree}\n'
                            f'cd {shlex.quote(str(self.base))}\n'
                            f'exec {shlex.quote(str(self.node))} {shlex.quote(str(self.base / "scripts/recurring-private-checkpoint.mjs"))} '
                            f'{operation} --configuration-directory {shlex.quote(str(self.private / "primary-origin-candidate-4a355851"))} '
                            f'--directory {shlex.quote(str(self.private / "recurring-backup-052"))} '
                            f'--private-path-mode linux-dirfd >> {shlex.quote(str(log))} 2>&1\n')
            path.chmod(0o700)
            log.write_text('preserved pre-existing production log\n')
            log.chmod(0o600)
        self.module = load_helper()
        for key, value in dict(PRIVATE=self.private, BASE_CHECKOUT=self.base, BASE_SOURCE=self.base_sha,
                               BASE_TREE=self.base_tree, START_PIN=digest(self.start), CHECK_PIN=digest(self.check),
                               NODE_PIN=digest(self.node)).items():
            setattr(self.module, key, value)
        self.preserved = {path: path.read_bytes() for path in (self.start, self.check, self.node,
                          self.private / 'jm171-node24221.log', self.private / 'jm171-preflight-node24221-c2d7b3b3.log')}
        self.commands = []

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.temporary.cleanup()

    @staticmethod
    def run_git(directory, *args):
        env = dict(os.environ, GIT_CONFIG_NOSYSTEM='1', GIT_CONFIG_GLOBAL='/dev/null', GIT_TERMINAL_PROMPT='0')
        result = subprocess.run(['/usr/bin/git', '-C', str(directory), *args], env=env,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=True, timeout=10)
        return result.stdout.strip()

    def write_version(self, version):
        package = {'name': 'synthetic-jessiemessage', 'version': version, 'private': True,
                   'dependencies': dict(self.dependencies)}
        lock = {'name': package['name'], 'version': version, 'lockfileVersion': 3,
                'packages': {'': {'name': package['name'], 'version': version,
                                 'dependencies': dict(self.dependencies)},
                             'node_modules/mariadb': {'version': '3.5.4'}}}
        (self.seed / 'package.json').write_text(json.dumps(package) + '\n')
        (self.seed / 'package-lock.json').write_text(json.dumps(lock) + '\n')

    def commit(self, message):
        self.run_git(self.seed, 'add', '-A')
        self.run_git(self.seed, '-c', 'user.name=Synthetic staging test', '-c', 'user.email=synthetic@example.invalid',
                     'commit', '-m', message)
        return self.run_git(self.seed, 'rev-parse', 'HEAD'), self.run_git(self.seed, 'rev-parse', 'HEAD^{tree}')

    def advance_candidate(self, edit):
        edit(self)
        self.sha180, self.tree180 = self.commit('candidate mutation')
        self.run_git(self.seed, 'tag', '-f', 'v1.8.0')
        self.run_git(self.seed, 'push', '--force', 'origin', 'HEAD:refs/heads/main', 'refs/tags/v1.8.0')

    @property
    def arguments(self):
        return self.sha172, self.tree172, self.sha180, self.tree180

    def outputs(self):
        return (sorted(path.name for path in self.private.iterdir()),
                sorted(path.name for path in self.operator.iterdir()),
                self.run_git(self.base, 'worktree', 'list', '--porcelain'))

    def stage(self, arguments=None):
        actual_run = subprocess.run

        def limited_run(args, **kwargs):
            self.commands.append(tuple(str(value) for value in args))
            if str(args[0]) == str(self.node):
                assert list(args) == [str(self.node), '--version'], 'only node --version is permitted'
            elif args[0] == '/bin/bash':
                assert list(args) == ['/bin/bash', '-n'], 'launchers may only be syntax-checked through stdin'
                assert kwargs.get('input'), 'bash receives the unexecuted launcher text'
            else:
                assert args[0] == '/usr/bin/git', 'unexpected execution capability: ' + str(args[0])
            return actual_run(args, **kwargs)

        with mock.patch.object(self.module.subprocess, 'run', side_effect=limited_run):
            return self.module.stage(*(arguments or self.arguments))

    def assert_preserved(self, test):
        for path, content in self.preserved.items():
            test.assertEqual(path.read_bytes(), content, path.name)
        test.assertEqual(self.run_git(self.base, 'rev-parse', 'HEAD'), self.base_sha)
        test.assertFalse((self.private / 'runtime-video-180').exists())
        if self.node_trace.exists():
            test.assertTrue(set(self.node_trace.read_text().splitlines()) <= {'version'})


class StagingTests(unittest.TestCase):
    def assert_refused_unchanged(self, fixture, arguments=None):
        before = fixture.outputs()
        receipt = fixture.private / 'jm180-staging.json'
        receipt_existed = receipt.exists() or receipt.is_symlink()
        with self.assertRaises(fixture.module.StagingRefused):
            fixture.stage(arguments)
        self.assertEqual(fixture.outputs(), before, 'refusal must precede every new worktree, launcher and log')
        if not receipt_existed:
            self.assertFalse(receipt.exists() or receipt.is_symlink(), 'a refusal must not invent a successful receipt')
        fixture.assert_preserved(self)

    def test_stages_two_exact_releases_without_running_or_preparing_configuration(self):
        with Fixture() as f:
            receipt_path = f.private / 'jm180-staging.json'
            actual_open, actual_fsync = os.open, os.fsync
            created = {}

            def observed_open(path, flags, *args, **kwargs):
                fd = actual_open(path, flags, *args, **kwargs)
                if Path(path) == receipt_path and flags & os.O_CREAT:
                    info = os.fstat(fd)
                    created.update(flags=flags, identity=(info.st_dev, info.st_ino), synced=False)
                return fd

            def observed_fsync(fd):
                info = os.fstat(fd)
                if created.get('identity') == (info.st_dev, info.st_ino):
                    created['synced'] = True
                return actual_fsync(fd)

            with mock.patch.object(f.module.os, 'open', side_effect=observed_open), \
                    mock.patch.object(f.module.os, 'fsync', side_effect=observed_fsync):
                result = f.stage()
            self.assertEqual(result['receipt'], str(receipt_path))
            self.assertEqual(result['receiptSha256'], digest(receipt_path))
            self.assertTrue(created['flags'] & os.O_EXCL)
            self.assertTrue(created['flags'] & os.O_NOFOLLOW)
            self.assertTrue(created['synced'], 'the successful receipt must be synced before it is reported')
            self.assertEqual(stat.S_IMODE(receipt_path.lstat().st_mode), 0o600)
            self.assertTrue(stat.S_ISREG(receipt_path.lstat().st_mode))
            self.assertEqual(receipt_path.lstat().st_nlink, 1)
            content = receipt_path.read_text()
            stored = json.loads(content)
            self.assertEqual(stored['format'], 'jessiemessage-release180-staging')
            self.assertEqual(stored['version'], 1)
            self.assertNotIn('receipt', stored)
            self.assertNotIn('receiptSha256', stored)
            self.assertEqual(stored, {key: value for key, value in result.items() if key not in ('receipt', 'receiptSha256')})
            self.assertEqual(content, json.dumps(stored, separators=(',', ':')) + '\n')
            self.assertEqual([release['version'] for release in result['releases']], ['1.7.2', '1.8.0'])
            self.assertEqual(result['schemaMigrationsExpected'], 36)
            self.assertTrue(result['priorActivePreserved'])
            for field in ('sqlStatusChecked', 'videoConfigurationPrepared', 'hostedQualified', 'started',
                          'migrated', 'runtimeStarted', 'managerChanged', 'checkpointChanged'):
                self.assertIs(result[field], False, field)
            self.assertIs(result['noRestart'], True)
            for release, expected_sha, expected_tree in zip(result['releases'], (f.sha172, f.sha180), (f.tree172, f.tree180)):
                target = Path(release['checkout'])
                self.assertEqual(f.run_git(target, 'rev-parse', 'HEAD'), expected_sha)
                self.assertEqual(f.run_git(target, 'rev-parse', 'HEAD^{tree}'), expected_tree)
                self.assertTrue((target / 'node_modules').is_symlink())
                self.assertEqual((target / 'node_modules').resolve(), f.deps.resolve())
                for field in ('launcher', 'checkLauncher'):
                    path = Path(release[field]); self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o700)
                    self.assertEqual(path.stat().st_nlink, 1)
                    text = path.read_text(); self.assertIn(expected_sha, text); self.assertIn(expected_tree, text)
                    self.assertIn('--profile ' + f.module.PROFILE, text)
                    self.assertIn(str(f.private / 'runtime-video-180'), text)
                    self.assertNotIn('primary-origin-candidate-4a355851', text)
                for field in ('log', 'precheckLog'):
                    path = Path(release[field]); self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
                    self.assertEqual(path.read_bytes(), b'')
                self.assertFalse(release['videoConfigurationPrepared'])
                self.assertFalse(release['hostedQualified'])
                self.assertFalse(release['started'])
            self.assertEqual(sum(command[0] == '/bin/bash' for command in f.commands), 4)
            f.assert_preserved(self)

    def test_wrong_argument_shapes_and_source_trees_are_refused_before_outputs(self):
        with Fixture() as f:
            for args in [(None, *f.arguments[1:]), ('bad', *f.arguments[1:]),
                         (f.sha172, '0' * 40, f.sha180, f.tree180),
                         (f.sha172, f.tree172, f.sha180, '0' * 40),
                         (f.sha172, f.tree172, f.sha172, f.tree172)]:
                with self.subTest(arguments=args):
                    self.assert_refused_unchanged(f, args)
            with self.assertRaises(f.module.StagingRefused):
                f.module.main([])

    def test_wrong_release_tag_is_refused(self):
        with Fixture() as f:
            f.run_git(f.seed, 'tag', '-f', 'v1.7.2', f.base_sha)
            f.run_git(f.seed, 'push', '--force', 'origin', 'refs/tags/v1.7.2')
            self.assert_refused_unchanged(f)

    def test_unrelated_candidate_and_main_not_containing_candidate_are_refused(self):
        for kind in ('unrelated', 'not_on_main'):
            with self.subTest(kind=kind), Fixture() as f:
                if kind == 'unrelated':
                    f.run_git(f.seed, 'checkout', '--orphan', 'unrelated')
                    f.sha180, f.tree180 = f.commit('unrelated candidate')
                    f.run_git(f.seed, 'tag', '-f', 'v1.8.0')
                    f.run_git(f.seed, 'push', '--force', 'origin', 'HEAD:refs/heads/main', 'refs/tags/v1.8.0')
                else:
                    f.run_git(f.seed, 'push', '--force', 'origin', f.sha172 + ':refs/heads/main')
                self.assert_refused_unchanged(f)

    def test_dependency_changes_and_tracked_node_modules_are_refused(self):
        for kind in ('package_only', 'locked_graph', 'tracked_modules'):
            with self.subTest(kind=kind), Fixture() as f:
                def change(value):
                    if kind == 'tracked_modules':
                        directory = value.seed / 'node_modules'; directory.mkdir()
                        (directory / 'forbidden').write_text('tracked dependencies')
                        value.run_git(value.seed, 'add', '-f', 'node_modules/forbidden')
                        return
                    package = json.loads((value.seed / 'package.json').read_text())
                    package['dependencies']['mariadb'] = '99.0.0'
                    (value.seed / 'package.json').write_text(json.dumps(package))
                    if kind == 'locked_graph':
                        lock = json.loads((value.seed / 'package-lock.json').read_text())
                        lock['packages']['']['dependencies']['mariadb'] = '99.0.0'
                        lock['packages']['node_modules/mariadb']['version'] = '99.0.0'
                        (value.seed / 'package-lock.json').write_text(json.dumps(lock))
                f.advance_candidate(change)
                self.assert_refused_unchanged(f)

    def test_changed_normal_or_video_migrations_and_missing_video_migration_are_refused(self):
        for kind in ('normal', 'video', 'missing_video'):
            with self.subTest(kind=kind), Fixture() as f:
                def change(value):
                    directory = value.seed / ('db/migrations' if kind == 'normal' else 'server/video/migrations')
                    path = sorted(directory.iterdir())[0]
                    if kind == 'missing_video':
                        path.unlink()
                    else:
                        path.write_bytes(path.read_bytes() + b'\n-- synthetic divergent bytes\n')
                f.advance_candidate(change)
                self.assert_refused_unchanged(f)

    def test_dirty_baseline_is_refused_without_reading_or_changing_its_service(self):
        with Fixture() as f:
            (f.base / 'untracked-private-draft').write_text('do not stage from a dirty baseline')
            self.assert_refused_unchanged(f)
            self.assertFalse(f.node_trace.exists())

    def test_existing_partial_output_refuses_all_remaining_outputs(self):
        for field in ('checkout', 'start', 'check', 'log', 'prelog'):
            with self.subTest(field=field), Fixture() as f:
                plan = f.module.release_plan('1.8.0', f.sha180, f.tree180)
                path = plan[field]
                if field == 'checkout':
                    path.mkdir()
                else:
                    path.write_text('preserve partial staging')
                self.assert_refused_unchanged(f)
                if path.is_file():
                    self.assertEqual(path.read_text(), 'preserve partial staging')

    def test_launcher_or_node_pin_mismatch_refuses_staging(self):
        for field in ('START_PIN', 'CHECK_PIN', 'NODE_PIN'):
            with self.subTest(field=field), Fixture() as f:
                setattr(f.module, field, '0' * 64)
                self.assert_refused_unchanged(f)

    def test_existing_success_receipt_or_symlink_is_never_replaced(self):
        for kind in ('regular', 'symlink', 'dangling_symlink'):
            with self.subTest(kind=kind), Fixture() as f:
                receipt = f.private / 'jm180-staging.json'
                sentinel = f.root / 'existing-receipt-source'
                sentinel.write_text('preserve the pre-existing receipt\n')
                if kind == 'regular':
                    receipt.write_bytes(sentinel.read_bytes())
                    receipt.chmod(0o600)
                else:
                    receipt.symlink_to(sentinel if kind == 'symlink' else f.root / 'missing-receipt-source')
                before = receipt.lstat()
                self.assert_refused_unchanged(f)
                after = receipt.lstat()
                self.assertEqual((before.st_dev, before.st_ino, before.st_mode), (after.st_dev, after.st_ino, after.st_mode))
                self.assertEqual(sentinel.read_text(), 'preserve the pre-existing receipt\n')
                if kind == 'regular':
                    self.assertEqual(receipt.read_bytes(), sentinel.read_bytes())
                else:
                    self.assertEqual(receipt.readlink(), sentinel if kind == 'symlink' else f.root / 'missing-receipt-source')

    def test_post_gate_write_failure_never_creates_a_success_receipt(self):
        with Fixture() as f:
            original_write = f.module.write_exclusive
            writes = 0

            def interrupted_write(*args, **kwargs):
                nonlocal writes
                writes += 1
                if writes == 2:
                    raise OSError('synthetic output interruption')
                return original_write(*args, **kwargs)

            with mock.patch.object(f.module, 'write_exclusive', side_effect=interrupted_write), self.assertRaises(OSError):
                f.stage()
            self.assertEqual(writes, 2)
            receipt = f.private / 'jm180-staging.json'
            self.assertFalse(receipt.exists() or receipt.is_symlink())
            self.assertTrue((f.operator / ('production-172-' + f.sha172[:8])).exists())
            self.assertTrue((f.operator / ('production-180-' + f.sha180[:8])).exists())
            f.assert_preserved(self)


if __name__ == '__main__':
    unittest.main(verbosity=2)
