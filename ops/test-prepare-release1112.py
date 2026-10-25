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
HELPER = HERE / 'prepare-release1112.py'
VIDEO_DDL = ('0034_video_storage_state.sql', '0035_video_assets.sql', '0036_message_video.sql')


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_helper():
    name = 'prepare1112_' + uuid.uuid4().hex
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
        self.temporary = tempfile.TemporaryDirectory(prefix='prepare1112-test-', dir=HERE.parent)
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
        self.write_version('1.11.1')
        normal = self.seed / 'db/migrations'; normal.mkdir(parents=True)
        for number in range(1, 34):
            (normal / f'{number:04d}_synthetic.sql').write_text(f'CREATE TABLE synthetic_{number} (id INT);\n')
        video = self.seed / 'server/video/migrations'; video.mkdir(parents=True)
        for number, name in enumerate(VIDEO_DDL, start=34):
            (video / name).write_text(f'CREATE TABLE synthetic_video_{number} (id INT);\n')
        experience = self.seed / 'server/experience/migrations'; experience.mkdir(parents=True)
        for number, name in enumerate(('0037_profile_preferences.sql', '0038_reply_tracking.sql'), start=37):
            (experience / name).write_text(f'CREATE TABLE synthetic_experience_{number} (id INT);\n')
        self.base_sha, self.base_tree = self.commit('baseline1.11.1')
        self.write_version('1.11.2')
        self.sha1112, self.tree1112 = self.commit('candidate1.11.2')
        self.run_git(self.seed, 'tag', 'v1.11.2')
        self.run_git(self.seed, 'push', 'origin', 'main', 'refs/tags/v1.11.2')
        self.base = self.operator / 'production-1111-80b7fbf5'
        self.run_git(self.root, 'clone', '--no-tags', str(self.origin), str(self.base))
        self.run_git(self.base, 'checkout', '--detach', self.base_sha)
        self.deps = self.operator / 'production-1101-9eb99f1f' / 'node_modules'
        self.deps.parent.mkdir(mode=0o700)
        self.deps.mkdir(mode=0o700)
        (self.base / 'node_modules').symlink_to(self.deps, target_is_directory=True)
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
        self.start = self.private / 'start-primary-release1111-80b7fbf5.sh'
        self.check = self.private / 'check-primary-release1111-80b7fbf5.sh'
        for path, check in ((self.start, False), (self.check, True)):
            operation = 'check-local-closures' if check else 'start-local-closures'
            log = self.private / ('jm1111-preflight-node24221-80b7fbf5.log' if check else 'jm1111-node24221.log')
            path.write_text('#!/bin/bash\nset -euo pipefail\n'
                            f'# source {self.base_sha}\n# tree {self.base_tree}\n'
                            f'cd {shlex.quote(str(self.base))}\n'
                            f'exec {shlex.quote(str(self.node))} {shlex.quote(str(self.base / "scripts/recurring-private-checkpoint.mjs"))} '
                            f'{operation} --configuration-directory {shlex.quote(str(self.private / "runtime-video-180"))} '
                            f'--directory {shlex.quote(str(self.private / "recurring-backup-052"))} '
                            f'--private-path-mode linux-dirfd --experience 1 --profile photos-notify-recovery-crm-broadcast-video >> {shlex.quote(str(log))} 2>&1\n')
            path.chmod(0o700)
            log.write_text('preserved pre-existing production log\n')
            log.chmod(0o600)
        self.sentinels = []
        for name in ('runtime-video-180', 'recurring-backup-052'):
            directory = self.private / name; directory.mkdir(mode=0o700)
            path = directory / 'synthetic-private-sentinel'
            path.write_bytes(b'preserve synthetic private bytes\x00\xff\n'); path.chmod(0o600)
            self.sentinels.append(path)
        self.checkpoint = self.private / 'jm0702-existing-pc-update.json'
        self.checkpoint.write_bytes(b'fixture-only active190 checkpoint; no real private data\n')
        self.checkpoint.chmod(0o600)
        self.old_stage = self.private / 'jm1111-staging.json'
        self.old_stage.write_bytes(b'synthetic1110 historical receipt\n'); self.old_stage.chmod(0o600)
        self.module = load_helper()
        for key, value in dict(PRIVATE=self.private, BASE_CHECKOUT=self.base, DEPENDENCY_ROOT=self.deps, BASE_SOURCE=self.base_sha,
                               BASE_TREE=self.base_tree, BASE_STAGING_SHA=digest(self.old_stage), START_PIN=digest(self.start), CHECK_PIN=digest(self.check),
                               NODE_PIN=digest(self.node), CHECKPOINT_PIN=digest(self.checkpoint), RELEASE_SOURCE=self.sha1112, RELEASE_TREE=self.tree1112).items():
            setattr(self.module, key, value)
        self.preserved = {path: path.read_bytes() for path in (self.start, self.check, self.node, self.checkpoint, self.old_stage,
                          self.private / 'jm1111-node24221.log', self.private / 'jm1111-preflight-node24221-80b7fbf5.log', *self.sentinels)}
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
        self.sha1112, self.tree1112 = self.commit('candidate mutation')
        self.module.RELEASE_SOURCE, self.module.RELEASE_TREE = self.sha1112, self.tree1112
        self.run_git(self.seed, 'tag', '-f', 'v1.11.2')
        self.run_git(self.seed, 'push', '--force', 'origin', 'HEAD:refs/heads/main', 'refs/tags/v1.11.2')

    @property
    def arguments(self):
        return self.sha1112, self.tree1112

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
        if self.node_trace.exists():
            test.assertTrue(set(self.node_trace.read_text().splitlines()) <= {'version'})


class ProductionPinsTests(unittest.TestCase):
    def test_reviewed_production_constants(self):
        module = load_helper()
        self.assertEqual(module.BASE_SOURCE, '80b7fbf5f9b5ba32ac1aae817043126e93025946')
        self.assertEqual(module.BASE_TREE, 'ba1289bae9ce095560922a7ed6665f17709d07ed')
        self.assertEqual(str(module.BASE_CHECKOUT), '/srv/customer/jessiemessage-operator/production-1111-80b7fbf5')
        self.assertEqual(str(module.DEPENDENCY_ROOT), '/srv/customer/jessiemessage-operator/production-1101-9eb99f1f/node_modules')
        self.assertEqual(module.START_PIN, '4c6481feb6f318cf8c095bc46dc236919dbd0b18ec8991fb78ef8cee8f34581a')
        self.assertEqual(module.CHECK_PIN, '90d3e2a25d038a15725d2ca063d314712f96b921792712b26a97f584ceab2203')
        self.assertEqual(module.NODE_PIN, 'e32e2d16081cf644f88392934288086e7662529d0d43277c34f7aad2207cfafb')
        self.assertEqual(module.CHECKPOINT_PIN, '41a51d38a50c3ff07b1878a6cfd96de9e383dbafc5ccff9c96a3a97aa272d90a')
        # Accept either unfinalized or fully shaped pins; actual qualification
        # is independent evidence, not something these synthetic tests infer.
        pending = (module.RELEASE_SOURCE, module.RELEASE_TREE) == ('SOURCE_PENDING', 'TREE_PENDING')
        ready = all(isinstance(pin, str) and module.SHA.fullmatch(pin) for pin in (module.RELEASE_SOURCE, module.RELEASE_TREE))
        self.assertTrue(pending or ready, 'both qualification pins must be pending or both be full SHA values')
        if ready:
            self.assertNotEqual(module.RELEASE_SOURCE, module.BASE_SOURCE)

    def test_actual_release_pin_binding_precedes_all_file_and_process_access(self):
        module = load_helper()
        ready = bool(module.SHA.fullmatch(module.RELEASE_SOURCE) and module.SHA.fullmatch(module.RELEASE_TREE))
        error = 'release1112_pinned_identity' if ready else 'release1112_pins_pending'
        with mock.patch.object(module, 'private_directory', side_effect=AssertionError('must not access private paths')), \
                mock.patch.object(module, 'command', side_effect=AssertionError('must not execute commands')):
            for args in (('0' * 40, '1' * 40), ('f' * 40, 'e' * 40)):
                with self.subTest(args=args), self.assertRaisesRegex(module.StagingRefused, '^' + error + '$'):
                    module.stage(*args)

    def test_exact_release_pins_reach_only_first_precondition_before_and_after_finalization(self):
        module = load_helper()
        states = [('shipped', module.RELEASE_SOURCE, module.RELEASE_TREE), ('synthetically_finalized', 'a' * 40, 'b' * 40)]
        for label, source_pin, tree_pin in states:
            with self.subTest(state=label), mock.patch.multiple(module, RELEASE_SOURCE=source_pin, RELEASE_TREE=tree_pin), \
                    mock.patch.object(module, 'private_directory', side_effect=RuntimeError('first_precondition')) as directory, \
                    mock.patch.object(module, 'command', side_effect=AssertionError('must not execute commands')):
                ready = bool(module.SHA.fullmatch(source_pin) and module.SHA.fullmatch(tree_pin))
                if ready:
                    with self.assertRaisesRegex(RuntimeError, '^first_precondition$'):
                        module.stage(source_pin, tree_pin)
                    directory.assert_called_once_with(module.PRIVATE)
                else:
                    with self.assertRaisesRegex(module.StagingRefused, '^release1112_pins_pending$'):
                        module.stage('a' * 40, 'b' * 40)
                    directory.assert_not_called()

    def test_explicit_pending_variant_refuses_before_any_private_or_process_access(self):
        module = load_helper()
        with mock.patch.multiple(module, RELEASE_SOURCE='QUALIFICATION_PENDING', RELEASE_TREE='QUALIFICATION_PENDING'), \
                mock.patch.object(module, 'private_directory', side_effect=AssertionError('private paths forbidden')) as directory, \
                mock.patch.object(module, 'regular', side_effect=AssertionError('private reads forbidden')) as regular, \
                mock.patch.object(module, 'command', side_effect=AssertionError('commands forbidden')) as command:
            with self.assertRaisesRegex(module.StagingRefused, '^release1112_pins_pending$'):
                module.stage('a' * 40, 'b' * 40)
            directory.assert_not_called(); regular.assert_not_called(); command.assert_not_called()

    def test_partial_qualification_refuses_before_any_private_or_process_access(self):
        module = load_helper()
        for pins in [('a' * 40, 'QUALIFICATION_PENDING'), ('QUALIFICATION_PENDING', 'b' * 40)]:
            with self.subTest(pins=pins), mock.patch.multiple(module, RELEASE_SOURCE=pins[0], RELEASE_TREE=pins[1]), \
                    mock.patch.object(module, 'private_directory', side_effect=AssertionError('private paths forbidden')) as directory, \
                    mock.patch.object(module, 'regular', side_effect=AssertionError('private reads forbidden')) as regular, \
                    mock.patch.object(module, 'command', side_effect=AssertionError('commands forbidden')) as command:
                with self.assertRaisesRegex(module.StagingRefused, '^release1112_pins_pending$'):
                    module.stage('a' * 40, 'b' * 40)
                directory.assert_not_called(); regular.assert_not_called(); command.assert_not_called()


class StagingTests(unittest.TestCase):
    def test_active_dependency_symlink_must_match_the_pinned_private_root(self):
        for kind in ('wrong_target', 'relative_target', 'directory', 'insecure_root'):
            with self.subTest(kind=kind), Fixture() as f:
                link = f.base / 'node_modules'
                if kind == 'insecure_root':
                    f.deps.chmod(0o755)
                else:
                    link.unlink()
                    if kind == 'directory':
                        link.mkdir(mode=0o700)
                    elif kind == 'relative_target':
                        link.symlink_to(os.path.relpath(f.deps, f.base), target_is_directory=True)
                    else:
                        other = f.root / 'other-dependencies'; other.mkdir(mode=0o700)
                        link.symlink_to(other, target_is_directory=True)
                self.assert_refused_unchanged(f)

    def assert_refused_unchanged(self, fixture, arguments=None):
        before = fixture.outputs()
        receipt = fixture.private / 'jm1112-staging.json'
        receipt_existed = receipt.exists() or receipt.is_symlink()
        with self.assertRaises(fixture.module.StagingRefused):
            fixture.stage(arguments)
        self.assertEqual(fixture.outputs(), before, 'refusal must precede every new worktree, launcher and log')
        if not receipt_existed:
            self.assertFalse(receipt.exists() or receipt.is_symlink())
        fixture.assert_preserved(self)

    def test_stages_one_exact_release_preserving_all_existing_configuration_without_reading_it(self):
        with Fixture() as f:
            receipt_path = f.private / 'jm1112-staging.json'
            actual_open, actual_fsync = os.open, os.fsync
            created = {}

            def observed_open(path, flags, *args, **kwargs):
                value = Path(path)
                self.assertFalse(any(directory in value.parents for directory in
                                     (f.private / 'runtime-video-180', f.private / 'recurring-backup-052')),
                                 'existing private configuration files must never be read')
                fd = actual_open(path, flags, *args, **kwargs)
                if value == receipt_path and flags & os.O_CREAT:
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
            self.assertTrue(created['synced'])
            self.assertEqual(stat.S_IMODE(receipt_path.lstat().st_mode), 0o600)
            self.assertEqual(receipt_path.lstat().st_nlink, 1)
            stored = json.loads(receipt_path.read_text())
            self.assertEqual(stored, {key: value for key, value in result.items() if key not in ('receipt', 'receiptSha256')})
            self.assertEqual(receipt_path.read_text(), json.dumps(stored, sort_keys=True, separators=(',', ':')) + '\n')
            self.assertEqual(result['format'], 'jessiemessage-release1112-staging')
            self.assertEqual(result['release'], '1.11.2')
            self.assertEqual((result['source'], result['tree']), f.arguments)
            self.assertEqual(result['schemaMigrationsExpected'], 38)
            self.assertEqual(result['expectedActiveServiceVersion'], '1.11.1')
            self.assertTrue(result['priorActivePreserved'])
            self.assertTrue(result['existingConfigurationUntouched'])
            self.assertTrue(result['noRestart'])
            self.assertEqual(result['preservedActiveCheckpointSha256'], digest(f.checkpoint))
            for field in ('sqlStatusChecked', 'configurationPrepared', 'hostedQualified', 'precheckPassed',
                          'started', 'migrated', 'runtimeStarted', 'managerChanged', 'checkpointChanged'):
                self.assertIs(result[field], False, field)
            target = Path(result['checkout'])
            self.assertEqual(f.run_git(target, 'rev-parse', 'HEAD'), f.sha1112)
            self.assertEqual(f.run_git(target, 'rev-parse', 'HEAD^{tree}'), f.tree1112)
            self.assertTrue((target / 'node_modules').is_symlink())
            self.assertEqual((target / 'node_modules').resolve(), f.deps.resolve())
            self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o700)
            self.assertTrue(result['dependenciesReused'])
            self.assertEqual(result['dependencyDirectory'], str(f.deps))
            self.assertEqual(len(list(f.operator.iterdir())), 3, 'one worktree is added beside the active checkout and preserved dependency checkout')
            for field, prior, old_log, new_log in (
                    ('launcher', f.start, 'jm1111-node24221.log', 'log'),
                    ('checkLauncher', f.check, 'jm1111-preflight-node24221-80b7fbf5.log', 'precheckLog')):
                path = Path(result[field])
                self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o700)
                self.assertEqual(path.stat().st_nlink, 1)
                expected = prior.read_text().replace(f.base_sha, f.sha1112).replace(f.base_tree, f.tree1112)
                expected = expected.replace(str(f.base), str(target)).replace(str(f.private / old_log), result[new_log])
                self.assertEqual(path.read_bytes(), expected.encode(), 'only four allowed substitutions')
                self.assertEqual(path.read_text().count('--profile ' + f.module.PROFILE), 1)
                self.assertIn(str(f.private / 'runtime-video-180'), path.read_text())
                self.assertIn(str(f.private / 'recurring-backup-052'), path.read_text())
            for field in ('log', 'precheckLog'):
                path = Path(result[field])
                self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
                self.assertEqual(path.read_bytes(), b'')
            self.assertEqual(result['nextCheckCommand'], 'bash ' + result['checkLauncher'])
            self.assertEqual(sum(command[0] == '/bin/bash' for command in f.commands), 2)
            self.assertEqual(f.node_trace.read_text(), 'version\n')
            f.assert_preserved(self)

    def test_wrong_argument_shapes_and_unpinned_source_tree_refuse_before_access(self):
        with Fixture() as f:
            for args in ((None, f.tree1112), ('bad', f.tree1112), (f.sha1112, '0' * 40), ('0' * 40, f.tree1112)):
                with self.subTest(arguments=args):
                    self.assert_refused_unchanged(f, args)
            self.assertFalse(f.node_trace.exists())
            for args in ([], list(f.arguments) + ['extra']):
                with self.assertRaisesRegex(f.module.StagingRefused, '^usage_two_source_tree_arguments$'):
                    f.module.main(args)

    def test_wrong_release_tag_is_refused(self):
        with Fixture() as f:
            f.run_git(f.seed, 'tag', '-f', 'v1.11.2', f.base_sha)
            f.run_git(f.seed, 'push', '--force', 'origin', 'refs/tags/v1.11.2')
            self.assert_refused_unchanged(f)

    def test_unrelated_candidate_and_main_not_containing_candidate_are_refused(self):
        for kind in ('unrelated', 'not_on_main'):
            with self.subTest(kind=kind), Fixture() as f:
                if kind == 'unrelated':
                    f.run_git(f.seed, 'checkout', '--orphan', 'unrelated')
                    f.sha1112, f.tree1112 = f.commit('unrelated candidate')
                    f.module.RELEASE_SOURCE, f.module.RELEASE_TREE = f.arguments
                    f.run_git(f.seed, 'tag', '-f', 'v1.11.2')
                    f.run_git(f.seed, 'push', '--force', 'origin', 'HEAD:refs/heads/main', 'refs/tags/v1.11.2')
                else:
                    f.run_git(f.seed, 'push', '--force', 'origin', f.base_sha + ':refs/heads/main')
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

    def test_each_package_version_must_be_1112(self):
        for field in ('package', 'lock_root', 'lock_package'):
            with self.subTest(field=field), Fixture() as f:
                def change(value):
                    path = value.seed / ('package.json' if field == 'package' else 'package-lock.json')
                    data = json.loads(path.read_text())
                    (data['packages'][''] if field == 'lock_package' else data)['version'] = '1.11.1'
                    path.write_text(json.dumps(data))
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
                        path.write_bytes(path.read_bytes() + b'\n-- divergent synthetic bytes\n')
                f.advance_candidate(change)
                self.assert_refused_unchanged(f)

    def test_dirty_baseline_is_refused_before_node_invocation(self):
        with Fixture() as f:
            (f.base / 'untracked-draft').write_text('preserve')
            self.assert_refused_unchanged(f)
            self.assertFalse(f.node_trace.exists())

    def test_existing_output_or_dangling_symlink_refuses_all_remaining_outputs(self):
        for field in ('checkout', 'start', 'check', 'log', 'prelog'):
            for kind in ('regular', 'dangling_symlink'):
                with self.subTest(field=field, kind=kind), Fixture() as f:
                    path = f.module.release_plan(*f.arguments)[field]
                    if kind == 'dangling_symlink':
                        path.symlink_to(f.root / 'missing')
                    elif field == 'checkout':
                        path.mkdir()
                    else:
                        path.write_text('preserve partial staging')
                    before = path.lstat()
                    self.assert_refused_unchanged(f)
                    after = path.lstat()
                    self.assertEqual((before.st_dev, before.st_ino, before.st_mode),
                                     (after.st_dev, after.st_ino, after.st_mode))

    def test_launcher_or_node_pin_mismatch_refuses_staging(self):
        for field in ('START_PIN', 'CHECK_PIN', 'NODE_PIN', 'CHECKPOINT_PIN', 'BASE_STAGING_SHA'):
            with self.subTest(field=field), Fixture() as f:
                setattr(f.module, field, '0' * 64)
                self.assert_refused_unchanged(f)

    def test_file_metadata_guards_refuse_insecure_launcher_or_node(self):
        for kind in ('mode', 'symlink', 'hardlink', 'node_mode'):
            with self.subTest(kind=kind), Fixture() as f:
                target = f.node if kind == 'node_mode' else f.start
                if kind in ('mode', 'node_mode'):
                    target.chmod(0o755)
                elif kind == 'hardlink':
                    os.link(target, f.root / 'hardlink')
                else:
                    content = target.read_bytes(); target.unlink()
                    other = f.root / 'launcher-target'; other.write_bytes(content); other.chmod(0o700)
                    target.symlink_to(other)
                self.assert_refused_unchanged(f)

    def test_checkpoint_metadata_refuses_before_node_or_new_outputs(self):
        for kind in ('mode', 'symlink', 'hardlink'):
            with self.subTest(kind=kind), Fixture() as f:
                if kind == 'mode':
                    f.checkpoint.chmod(0o644)
                elif kind == 'hardlink':
                    os.link(f.checkpoint, f.root / 'checkpoint-link')
                else:
                    content = f.checkpoint.read_bytes(); f.checkpoint.unlink()
                    other = f.root / 'checkpoint-target'; other.write_bytes(content); other.chmod(0o600)
                    f.checkpoint.symlink_to(other)
                self.assert_refused_unchanged(f)
                self.assertFalse(f.node_trace.exists())

    def test_wrong_node_version_refuses_staging(self):
        with Fixture() as f:
            f.node.write_text(f.node.read_text().replace('v24.22.1', 'v24.22.0'))
            f.module.NODE_PIN = digest(f.node)
            f.preserved[f.node] = f.node.read_bytes()
            self.assert_refused_unchanged(f)

    def test_both_launcher_plans_are_checked_before_first_worktree(self):
        for kind in ('missing_profile', 'duplicate_profile', 'bad_command', 'syntax', 'missing_binding'):
            with self.subTest(kind=kind), Fixture() as f:
                content = f.check.read_text()
                if kind == 'missing_profile':
                    content = content.replace('--profile ' + f.module.PROFILE, '')
                elif kind == 'duplicate_profile':
                    content += '\n# --profile ' + f.module.PROFILE + '\n'
                elif kind == 'bad_command':
                    content = content.replace('check-local-closures', 'start-local-closures')
                elif kind == 'syntax':
                    content += '\nif\n'
                else:
                    content = content.replace('runtime-video-180', 'wrong-bundle')
                f.check.write_text(content); f.module.CHECK_PIN = digest(f.check)
                f.preserved[f.check] = f.check.read_bytes()
                self.assert_refused_unchanged(f)

    def test_pins_are_rechecked_after_launcher_validation_before_first_worktree(self):
        for target_name in ('launcher', 'node', 'baseline', 'checkpoint', 'old_staging'):
            with self.subTest(target=target_name), Fixture() as f:
                original_launcher = f.module.launcher

                def tampered_launcher(*args, **kwargs):
                    result = original_launcher(*args, **kwargs)
                    if kwargs['check']:
                        if target_name == 'baseline':
                            (f.base / 'late-dirty').write_text('preserve injected mutation')
                        else:
                            path = f.start if target_name == 'launcher' else f.checkpoint if target_name == 'checkpoint' else f.old_stage if target_name == 'old_staging' else f.node
                            path.write_bytes(path.read_bytes() + b'\n# injected mutation\n')
                            f.preserved[path] = path.read_bytes()
                    return result

                with mock.patch.object(f.module, 'launcher', side_effect=tampered_launcher):
                    self.assert_refused_unchanged(f)

    def test_existing_success_receipt_or_symlink_is_never_replaced(self):
        for kind in ('regular', 'symlink', 'dangling_symlink'):
            with self.subTest(kind=kind), Fixture() as f:
                receipt = f.private / 'jm1112-staging.json'
                sentinel = f.root / 'existing-receipt'; sentinel.write_text('preserve receipt\n')
                if kind == 'regular':
                    receipt.write_bytes(sentinel.read_bytes()); receipt.chmod(0o600)
                else:
                    receipt.symlink_to(sentinel if kind == 'symlink' else f.root / 'missing')
                before = receipt.lstat()
                self.assert_refused_unchanged(f)
                after = receipt.lstat()
                self.assertEqual((before.st_dev, before.st_ino, before.st_mode),
                                 (after.st_dev, after.st_ino, after.st_mode))
                self.assertEqual(sentinel.read_text(), 'preserve receipt\n')

    def test_post_gate_write_failure_preserves_partial_output_and_refuses_retry(self):
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
            plan = f.module.release_plan(*f.arguments)
            self.assertTrue(plan['checkout'].exists())
            self.assertTrue(plan['start'].exists())
            self.assertFalse(plan['check'].exists())
            self.assertFalse((f.private / 'jm1112-staging.json').exists())
            self.assert_refused_unchanged(f)
            f.assert_preserved(self)


class CreatedDirectoryTests(unittest.TestCase):
    def test_sgid_created_checkout_is_normalized_before_dependencies_or_launchers(self):
        with Fixture() as f:
            f.operator.chmod(0o2700)
            result = f.stage()
            target = Path(result['checkout'])
            self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o700)
            self.assertEqual(stat.S_IMODE(f.operator.stat().st_mode), 0o2700)
            self.assertEqual(stat.S_IMODE(f.deps.stat().st_mode), 0o700)
            f.assert_preserved(self)

    def test_directory_normalization_rejects_insecure_mode_and_symlink_without_changing_them(self):
        module = load_helper()
        with tempfile.TemporaryDirectory(dir=HERE.parent) as temporary:
            directory = Path(temporary) / 'new'; directory.mkdir(mode=0o755)
            with self.assertRaises(module.StagingRefused): module.normalize_created_directory(directory)
            self.assertEqual(stat.S_IMODE(directory.stat().st_mode), 0o755)
            link = Path(temporary) / 'link'; link.symlink_to(directory, target_is_directory=True)
            with self.assertRaises(module.StagingRefused): module.normalize_created_directory(link)
            self.assertTrue(link.is_symlink())

    def test_descriptor_identity_drift_refuses_without_chmod(self):
        module = load_helper()
        with tempfile.TemporaryDirectory(dir=HERE.parent) as temporary:
            directory = Path(temporary) / 'new'; directory.mkdir(mode=0o700); directory.chmod(0o2700)
            actual = module.os.fstat
            def different(fd):
                values = list(actual(fd)); values[1] += 1
                return os.stat_result(values)
            with mock.patch.object(module.os, 'fstat', side_effect=different), mock.patch.object(module.os, 'fchmod', side_effect=AssertionError('must not mutate')):
                with self.assertRaises(module.StagingRefused): module.normalize_created_directory(directory)
            self.assertEqual(stat.S_IMODE(directory.stat().st_mode), 0o2700)


if __name__ == '__main__':
    unittest.main(verbosity=2)
