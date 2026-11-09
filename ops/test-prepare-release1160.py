#!/usr/bin/env python3
"""Disposable local-Git tests; never call staging with production constants."""
import hashlib
import json
import os
from pathlib import Path
import shlex
import stat
import subprocess
import sys
import tempfile
import types
import unittest
from unittest import mock
import uuid

HERE = Path(__file__).resolve().parent
HELPER = HERE / 'prepare-release1160.py'
VIDEO_DDL = ('0034_video_storage_state.sql', '0035_video_assets.sql', '0036_message_video.sql')


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_helper():
    name = 'prepare1160_' + uuid.uuid4().hex
    module = types.ModuleType(name)
    module.__file__ = str(HELPER)
    sys.modules[name] = module
    try:
        with mock.patch('subprocess.run', side_effect=AssertionError('import must have no process side effects')):
            exec(compile(HELPER.read_bytes(), str(HELPER), 'exec'), module.__dict__)
    finally:
        sys.modules.pop(name, None)
    return module


class Fixture:
    def __init__(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='prepare1160-test-', dir=HERE)
        try:
            self._initialize()
        except BaseException:
            self.temporary.cleanup()
            raise

    def _initialize(self):
        self.root = Path(self.temporary.name)
        self.seed = self.root / 'seed'
        self.origin = self.root / 'origin.git'
        self.operator = self.root / 'operator'
        self.private = self.root / 'private'
        for directory in (self.seed, self.operator, self.private):
            directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.run_git(self.root, 'init', '--bare', str(self.origin))
        self.run_git(self.origin, 'symbolic-ref', 'HEAD', 'refs/heads/main')
        self.run_git(self.seed, 'init', '-b', 'main')
        self.run_git(self.seed, 'remote', 'add', 'origin', str(self.origin))
        (self.seed / '.gitignore').write_text('node_modules\n')
        self.dependencies = dict(load_helper().ROOT_DEPENDENCIES)
        self.write_version('1.15.1')
        normal = self.seed / 'db/migrations'; normal.mkdir(parents=True)
        for number in range(1, 34):
            (normal / f'{number:04d}_synthetic.sql').write_text(f'CREATE TABLE synthetic_{number} (id INT);\n')
        video = self.seed / 'server/video/migrations'; video.mkdir(parents=True)
        for number, name in enumerate(VIDEO_DDL, start=34):
            (video / name).write_text(f'CREATE TABLE synthetic_video_{number} (id INT);\n')
        experience = self.seed / 'server/experience/migrations'; experience.mkdir(parents=True)
        for number, name in enumerate(('0037_profile_preferences.sql', '0038_reply_tracking.sql'), start=37):
            (experience / name).write_text(f'CREATE TABLE synthetic_experience_{number} (id INT);\n')
        self.base_sha, self.base_tree = self.commit('baseline1.15.1')
        self.write_version('1.16.0')
        self.sha1160, self.tree1160 = self.commit('candidate1.16.0')
        self.run_git(self.seed, 'tag', 'v1.16.0')
        self.run_git(self.seed, 'push', 'origin', 'main', 'refs/tags/v1.16.0')
        self.base = self.operator / f'production-1151-{self.base_sha[:8]}'
        self.run_git(self.root, 'clone', '--no-tags', str(self.origin), str(self.base))
        self.run_git(self.base, 'checkout', '--detach', self.base_sha)
        self.base.chmod(0o700)
        install = self.operator / 'production-1150-6712028e'
        install.mkdir(mode=0o700)
        self.deps = install / 'node_modules'
        self.deps.mkdir(mode=0o700)
        (self.base / 'node_modules').symlink_to(self.deps, target_is_directory=True)
        for name, version in self.dependencies.items():
            directory = self.deps / name; directory.mkdir(parents=True, exist_ok=True, mode=0o700)
            (directory / 'package.json').write_text(json.dumps(dict(name=name, version=version)) + '\n')
        self.codec_files = {}
        for name in load_helper().CODEC_FILES:
            path = self.deps / name; path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            path.write_text('synthetic pinned codec ' + name + '\n')
            self.codec_files[name] = digest(path)
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
        self.start = self.private / f'start-primary-release1151-{self.base_sha[:8]}.sh'
        self.check = self.private / f'check-primary-release1151-{self.base_sha[:8]}.sh'
        for path, check in ((self.start, False), (self.check, True)):
            operation = 'check-local-closures' if check else 'start-local-closures'
            log = self.private / (f'jm1151-preflight-node24221-{self.base_sha[:8]}.log' if check else 'jm1151-node24221.log')
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
            directory = self.private / name; directory.mkdir(parents=True, exist_ok=True, mode=0o700)
            path = directory / 'synthetic-private-sentinel'
            path.write_bytes(b'preserve synthetic private bytes\x00\xff\n'); path.chmod(0o600)
            self.sentinels.append(path)
        self.checkpoint = self.private / 'jm0702-existing-pc-update.json'
        self.checkpoint.write_text(json.dumps(dict(activeService=dict(release='1.15.1', source=self.base_sha, tree=self.base_tree),
            priorHistory=dict(preserved='synthetic history only'), otherBlock=dict(preserve='synthetic private bytes'))) + '\n')
        self.checkpoint.chmod(0o600)
        self.old_stage = self.private / 'jm1151-staging.json'
        self.old_stage.write_bytes(b'synthetic1151 historical staging receipt\n'); self.old_stage.chmod(0o600)
        self.module = load_helper()
        for key, value in dict(PRIVATE=self.private, BASE_CHECKOUT=self.base, DEPENDENCY_ROOT=self.deps, BASE_SOURCE=self.base_sha,
                               BASE_TREE=self.base_tree, BASE_STAGING_SHA=digest(self.old_stage), START_PIN=digest(self.start), CHECK_PIN=digest(self.check),
                               NODE_PIN=digest(self.node), CHECKPOINT_PIN=digest(self.checkpoint), RELEASE_SOURCE=self.sha1160, RELEASE_TREE=self.tree1160).items():
            setattr(self.module, key, value)
        self.module.BASE_LOCK_SHA = digest(self.base / 'package-lock.json')
        self.module.INSTALL_LOCK_SHA = '1' * 64
        self.module.CODEC_FILES = dict(self.codec_files)
        self.module.DEPENDENCY_INVENTORY = self.module.dependency_inventory(self.deps)
        self.preserved = {path: path.read_bytes() for path in (self.start, self.check, self.node, self.checkpoint, self.old_stage,
                          self.private / 'jm1151-node24221.log', self.private / f'jm1151-preflight-node24221-{self.base_sha[:8]}.log', *self.sentinels)}
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
                             **{'node_modules/' + name: {'version': version} for name, version in self.dependencies.items()}}}
        (self.seed / 'package.json').write_text(json.dumps(package) + '\n')
        (self.seed / 'package-lock.json').write_text(json.dumps(lock) + '\n')

    def commit(self, message):
        self.run_git(self.seed, 'add', '-A')
        self.run_git(self.seed, '-c', 'user.name=Synthetic staging test', '-c', 'user.email=synthetic@example.invalid',
                     'commit', '-m', message)
        return self.run_git(self.seed, 'rev-parse', 'HEAD'), self.run_git(self.seed, 'rev-parse', 'HEAD^{tree}')

    def advance_candidate(self, edit):
        edit(self)
        self.sha1160, self.tree1160 = self.commit('candidate mutation')
        self.module.RELEASE_SOURCE, self.module.RELEASE_TREE = self.sha1160, self.tree1160
        self.run_git(self.seed, 'tag', '-f', 'v1.16.0')
        self.run_git(self.seed, 'push', '--force', 'origin', 'HEAD:refs/heads/main', 'refs/tags/v1.16.0')

    @property
    def arguments(self):
        return self.sha1160, self.tree1160

    def outputs(self):
        return (sorted(path.name for path in self.private.iterdir()),
                sorted(path.name for path in self.operator.iterdir()),
                self.run_git(self.base, 'worktree', 'list', '--porcelain'))

    def dependency_snapshot(self):
        def walk(path):
            info = path.lstat()
            metadata = tuple(getattr(info, key) for key in ('st_dev', 'st_ino', 'st_mode', 'st_uid', 'st_nlink', 'st_size', 'st_mtime_ns', 'st_ctime_ns'))
            if stat.S_ISDIR(info.st_mode): value = [(child.name, walk(child)) for child in sorted(path.iterdir())]
            elif stat.S_ISLNK(info.st_mode): value = os.readlink(path)
            elif stat.S_ISREG(info.st_mode): value = path.read_bytes()
            else: value = None
            return metadata, value
        return walk(self.deps)

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


class Stage1160Tests(unittest.TestCase):
    def test_exact_production_pins(self):
        module = load_helper()
        self.assertEqual((module.RELEASE_SOURCE, module.RELEASE_TREE), ('d2b57fb88d58aacf64dd51c5d1952c65f5c327ae', '632ec530d812fa75cf2aa4b603c91c81dcaf7e8e'))
        self.assertEqual((module.BASE_SOURCE, module.BASE_TREE), ('a4a07f9f31c47a7185b57d11b8277be1d87fd2c1', '568530e702fa4d0a8a6b1743988c5e20b8656c40'))
        self.assertEqual(module.BASE_LOCK_SHA, 'eb6203bd91ad9a740766e55a517f29bc7c2acd6a48ddc725dfb0f4ee092ff7ca')
        self.assertEqual(module.INSTALL_LOCK_SHA, '1c0f01051219030260877c438566a5be69bedf28b433907ebe0f9a26cd36fdd1')

    def test_unfinalized_draft_refuses_before_host_reads(self):
        module = load_helper()
        module.RELEASE_SOURCE = module.RELEASE_TREE = ''
        with mock.patch.object(module, 'private_directory', side_effect=AssertionError('host read')), \
             mock.patch.object(module, 'command', side_effect=AssertionError('process invocation')):
            with self.assertRaisesRegex(module.StagingRefused, 'release1160_pins_pending'):
                module.stage('a' * 40, 'b' * 40)

    def test_exact_source_and_dependency_link_are_staged_without_check(self):
        with Fixture() as f:
            baseline_deps = f.dependency_snapshot()
            result = f.stage()
            self.assertEqual(result['status'], 'release1160_sources_staged_not_qualified')
            self.assertEqual((result['source'], result['tree']), f.arguments)
            self.assertEqual(result['baselineMetadataRelease'], '1.15.1')
            self.assertEqual(result['preservedActiveCheckpointSha256'], digest(f.checkpoint))
            self.assertEqual(result['priorActiveStagingSha256'], digest(f.old_stage))
            self.assertEqual(result['checkPrerequisite'], 'verified_storage_root_bindings')
            for field in ('storageBindingsChecked', 'storageBindingsWritten', 'sqlStatusChecked',
                          'precheckPassed', 'started', 'migrated', 'runtimeStarted', 'checkpointChanged'):
                self.assertIs(result[field], False)
            checkout = Path(result['checkout'])
            self.assertEqual(f.run_git(checkout, 'rev-parse', 'HEAD'), f.sha1160)
            self.assertEqual(os.readlink(checkout / 'node_modules'), str(f.deps))
            self.assertEqual(os.readlink(f.base / 'node_modules'), str(f.deps))
            self.assertEqual(result['dependencies']['lockSha256'], '1' * 64)
            self.assertEqual(result['dependencies']['activeApplicationLockSha256'], f.module.BASE_LOCK_SHA)
            self.assertEqual(f.dependency_snapshot(), baseline_deps)
            for field in ('launcher','checkLauncher','log','precheckLog','receipt'):
                file = Path(result[field])
                self.assertEqual(stat.S_IMODE(file.stat().st_mode), 0o700 if 'auncher' in field else 0o600)
            self.assertEqual(Path(result['log']).read_bytes(), b'')
            self.assertEqual(Path(result['precheckLog']).read_bytes(), b'')
            self.assertEqual(digest(Path(result['receipt'])), result['receiptSha256'])
            self.assertIn('start-local-closures', Path(result['launcher']).read_text())
            self.assertIn('check-local-closures', Path(result['checkLauncher']).read_text())
            self.assertEqual([args[1:] for args in f.commands if args[0] == '/bin/bash'], [('-n',), ('-n',)])
            self.assertEqual(f.node_trace.read_text(), 'version\n')
            f.assert_preserved(self)

    def test_wrong_pins_and_wrong_tag_are_refused(self):
        with Fixture() as f:
            outputs = f.outputs()
            with self.assertRaisesRegex(f.module.StagingRefused, 'release1160_pinned_identity'):
                f.stage(('a' * 40, f.tree1160))
            self.assertFalse(f.commands)
            f.run_git(f.seed, 'tag', '-f', 'v1.16.0', f.base_sha)
            f.run_git(f.seed, 'push', '--force', 'origin', 'refs/tags/v1.16.0')
            with self.assertRaisesRegex(f.module.StagingRefused, 'tag_identity'):
                f.stage()
            self.assertEqual(f.outputs(), outputs)
            f.assert_preserved(self)

    def test_dependency_link_is_required_to_name_real_installation(self):
        with Fixture() as f:
            link = f.base / 'node_modules'
            alias = f.operator / 'alias'
            alias.symlink_to(f.deps, target_is_directory=True)
            link.unlink()
            link.symlink_to(alias, target_is_directory=True)
            outputs = f.outputs()
            with self.assertRaisesRegex(f.module.StagingRefused, 'active_dependencies_link'):
                f.stage()
            self.assertEqual(f.outputs(), outputs)
            f.assert_preserved(self)

    def test_missing_or_changed_dependency_bytes_are_refused(self):
        with Fixture() as f:
            outputs = f.outputs()
            (f.deps / 'synthetic-dependencies').write_text('unexpected bytes\n')
            with self.assertRaisesRegex(f.module.StagingRefused, 'active_dependency_inventory'):
                f.stage()
            self.assertEqual(f.outputs(), outputs)

    def test_migration_drift_is_refused(self):
        with Fixture() as f:
            outputs = f.outputs()
            f.advance_candidate(lambda x: (x.seed / 'server/experience/migrations/0038_reply_tracking.sql').write_text('unexpected SQL\n'))
            with self.assertRaisesRegex(f.module.StagingRefused, 'experience_migrations_identical'):
                f.stage()
            self.assertEqual(f.outputs(), outputs)

    def test_existing_receipt_refuses_before_command_or_overwrite(self):
        with Fixture() as f:
            receipt = f.private / 'jm1160-staging.json'
            receipt.write_text('do not overwrite\n')
            outputs = f.outputs()
            with self.assertRaisesRegex(f.module.StagingRefused, 'existing_output:jm1160-staging.json'):
                f.stage()
            self.assertFalse(f.commands)
            self.assertEqual(f.outputs(), outputs)
            self.assertEqual(receipt.read_text(), 'do not overwrite\n')

    def test_interrupted_write_is_left_visible_and_refuses_replay(self):
        with Fixture() as f:
            write = f.module.write_exclusive
            def interrupted(path, content, mode):
                if path.name.startswith('check-primary-release1160-'):
                    raise OSError('synthetic interruption')
                return write(path, content, mode)
            with mock.patch.object(f.module, 'write_exclusive', side_effect=interrupted):
                with self.assertRaises(OSError):
                    f.stage()
            partial = f.outputs()
            plan = f.module.release_plan(*f.arguments)
            self.assertTrue(plan['checkout'].exists())
            self.assertTrue(plan['start'].exists())
            self.assertFalse((f.private / 'jm1160-staging.json').exists())
            with self.assertRaisesRegex(f.module.StagingRefused, 'existing_output:production-1160-'):
                f.stage()
            self.assertEqual(f.outputs(), partial)
            f.assert_preserved(self)


if __name__ == '__main__':
    unittest.main()
