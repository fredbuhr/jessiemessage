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
HELPER = HERE / 'prepare-release1151.py'
VIDEO_DDL = ('0034_video_storage_state.sql', '0035_video_assets.sql', '0036_message_video.sql')


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_helper():
    name = 'prepare1151_' + uuid.uuid4().hex
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
        self.temporary = tempfile.TemporaryDirectory(prefix='prepare1151-test-', dir=HERE.parent)
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
        self.write_version('1.15.0')
        normal = self.seed / 'db/migrations'; normal.mkdir(parents=True)
        for number in range(1, 34):
            (normal / f'{number:04d}_synthetic.sql').write_text(f'CREATE TABLE synthetic_{number} (id INT);\n')
        video = self.seed / 'server/video/migrations'; video.mkdir(parents=True)
        for number, name in enumerate(VIDEO_DDL, start=34):
            (video / name).write_text(f'CREATE TABLE synthetic_video_{number} (id INT);\n')
        experience = self.seed / 'server/experience/migrations'; experience.mkdir(parents=True)
        for number, name in enumerate(('0037_profile_preferences.sql', '0038_reply_tracking.sql'), start=37):
            (experience / name).write_text(f'CREATE TABLE synthetic_experience_{number} (id INT);\n')
        self.base_sha, self.base_tree = self.commit('baseline1.15.0')
        self.write_version('1.15.1')
        self.sha1151, self.tree1151 = self.commit('candidate1.15.1')
        self.run_git(self.seed, 'tag', 'v1.15.1')
        self.run_git(self.seed, 'push', 'origin', 'main', 'refs/tags/v1.15.1')
        self.base = self.operator / 'production-1150-6712028e'
        self.run_git(self.root, 'clone', '--no-tags', str(self.origin), str(self.base))
        self.run_git(self.base, 'checkout', '--detach', self.base_sha)
        self.base.chmod(0o700)
        self.deps = self.base / 'node_modules'
        self.deps.mkdir(mode=0o700)
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
        self.start = self.private / 'start-primary-release1150-6712028e.sh'
        self.check = self.private / 'check-primary-release1150-6712028e.sh'
        for path, check in ((self.start, False), (self.check, True)):
            operation = 'check-local-closures' if check else 'start-local-closures'
            log = self.private / ('jm1150-preflight-node24221-6712028e.log' if check else 'jm1150-node24221.log')
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
        self.checkpoint.write_text(json.dumps(dict(activeService=dict(release='1.15.0', source=self.base_sha, tree=self.base_tree),
            priorHistory=dict(preserved='synthetic history only'), otherBlock=dict(preserve='synthetic private bytes'))) + '\n')
        self.checkpoint.chmod(0o600)
        self.old_stage = self.private / 'jm1150-staging.json'
        self.old_stage.write_bytes(b'synthetic1150 historical staging receipt\n'); self.old_stage.chmod(0o600)
        self.module = load_helper()
        for key, value in dict(PRIVATE=self.private, BASE_CHECKOUT=self.base, DEPENDENCY_ROOT=self.deps, BASE_SOURCE=self.base_sha,
                               BASE_TREE=self.base_tree, BASE_STAGING_SHA=digest(self.old_stage), START_PIN=digest(self.start), CHECK_PIN=digest(self.check),
                               NODE_PIN=digest(self.node), CHECKPOINT_PIN=digest(self.checkpoint), RELEASE_SOURCE=self.sha1151, RELEASE_TREE=self.tree1151).items():
            setattr(self.module, key, value)
        self.module.BASE_LOCK_SHA = digest(self.base / 'package-lock.json')
        self.module.CODEC_FILES = dict(self.codec_files)
        self.module.DEPENDENCY_INVENTORY = self.module.dependency_inventory(self.deps)
        self.preserved = {path: path.read_bytes() for path in (self.start, self.check, self.node, self.checkpoint, self.old_stage,
                          self.private / 'jm1150-node24221.log', self.private / 'jm1150-preflight-node24221-6712028e.log', *self.sentinels)}
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
        self.sha1151, self.tree1151 = self.commit('candidate mutation')
        self.module.RELEASE_SOURCE, self.module.RELEASE_TREE = self.sha1151, self.tree1151
        self.run_git(self.seed, 'tag', '-f', 'v1.15.1')
        self.run_git(self.seed, 'push', '--force', 'origin', 'HEAD:refs/heads/main', 'refs/tags/v1.15.1')

    @property
    def arguments(self):
        return self.sha1151, self.tree1151

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


class ProductionPinsTests(unittest.TestCase):
    def test_reviewed_production_constants(self):
        module = load_helper()
        expected = dict(RELEASE_SOURCE='a4a07f9f31c47a7185b57d11b8277be1d87fd2c1', RELEASE_TREE='568530e702fa4d0a8a6b1743988c5e20b8656c40',
            BASE_SOURCE='6712028e08b1e04ac7628bdbb9c39fd9f90d9909', BASE_TREE='c80ee33ebfe01838c86cc2b4166b344acf5ea745',
            START_PIN='da4c86b73649a0939d8ff37f1bd35175b5d2d2b31aa0f15bcd8e1f9fcb191b56',
            CHECK_PIN='c165522014d83d09d5fcb0032b41d91fa13e2f5e146f5aaffde61062620459ba',
            NODE_PIN='e32e2d16081cf644f88392934288086e7662529d0d43277c34f7aad2207cfafb',
            CHECKPOINT_PIN='989de548cb42ac6784cbc4c341e43b240b63386a089fb2d107d4f6a067798814',
            BASE_STAGING_SHA='6384c78bf94ce688ec33060d672019d8ae534466d7de57c701046e75c6c46a4b',
            BASE_LOCK_SHA='1c0f01051219030260877c438566a5be69bedf28b433907ebe0f9a26cd36fdd1')
        for name, value in expected.items(): self.assertEqual(getattr(module, name), value, name)
        self.assertEqual(str(module.BASE_CHECKOUT), '/srv/customer/jessiemessage-operator/production-1150-6712028e')
        self.assertEqual(module.DEPENDENCY_ROOT, module.BASE_CHECKOUT / 'node_modules')
        self.assertEqual(module.DEPENDENCY_INVENTORY, dict(sha256='4df6d0b94070f09f2180c9478446b38e07ba58f3bb3e25de083ae79cf14a6152', entries=1180, files=988))
        self.assertEqual(module.ROOT_DEPENDENCIES, {'@imagemagick/magick-wasm': '0.0.45',
 '@phenomen/libavif-wasm': '1.4.203',
 'heic-to': '1.6.7',
 'libheif-js': '1.23.5',
 'mariadb': '3.5.4',
 'nodemailer': '10.1.4',
 'otpauth': '9.5.2',
 'sharp': '0.35.5',
 'web-push': '3.6.7'})
        self.assertEqual(module.CODEC_FILES, {'@imagemagick/magick-wasm/LICENSE': 'cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30',
 '@imagemagick/magick-wasm/NOTICE': '7cb6cf162ba965ed068dbc9e638c9b792b8a1a9f4dae51031e7a21ff1ebefc8d',
 '@imagemagick/magick-wasm/dist/index.js': '696370daea26ec9ccb1d53316e49eca464cd841678be0fdd550652cbcc73208e',
 '@imagemagick/magick-wasm/dist/x86/magick.wasm': '54629cbcf06dd10db38b4d87fa6ab241b248c09c94f2d9689506e5f994ac5f0c',
 '@phenomen/libavif-wasm/LICENSE': '9c49270079649e9ca5017850706c7c7b6d3e55c87351f50db343c9cf8a3947ac',
 '@phenomen/libavif-wasm/THIRD_PARTY_NOTICES.md': '6f002f45208da417ea75f12759a151419e6472dc3c5a7718b422c652f65209f6',
 '@phenomen/libavif-wasm/dist/codec/decode.mjs': '9a005bb8209388479101680344c7ef2123625d08af699ff32bbcd85c198f0d07',
 '@phenomen/libavif-wasm/dist/decode.wasm': '10cd87f2c5cd865a3c4fcfde30cc9611387bebe91e4eae7d62b62ef17c27279e',
 '@phenomen/libavif-wasm/dist/versions.json': '48e014a6fe8aa1f6638c3a146f106b78a7c6c7bc98ec7df47af5b7bcdbbac477',
 'heic-to/LICENSE': 'dbd7222d8026e5d6ca6991d1e6a205de927f300840433c2e90a60644a9980c75',
 'heic-to/src/lib/libheif-without-unsafe-eval.js': '75aaf03816c22f8cf40dbcaeb22bee83f2e1c5da4b7417577a7883b296348734'})
        pending = (module.RELEASE_SOURCE, module.RELEASE_TREE) == ('QUALIFICATION_PENDING', 'QUALIFICATION_PENDING')
        ready = all(isinstance(pin, str) and module.SHA.fullmatch(pin) for pin in (module.RELEASE_SOURCE, module.RELEASE_TREE))
        self.assertTrue(pending or ready, 'both release pins must be pending or both must be complete')
        if ready: self.assertNotEqual(module.RELEASE_SOURCE, module.BASE_SOURCE)

    def test_actual_release_pin_binding_precedes_all_file_and_process_access(self):
        module = load_helper()
        ready = bool(module.SHA.fullmatch(module.RELEASE_SOURCE) and module.SHA.fullmatch(module.RELEASE_TREE))
        error = 'release1151_pinned_identity' if ready else 'release1151_pins_pending'
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
                    with self.assertRaisesRegex(module.StagingRefused, '^release1151_pins_pending$'):
                        module.stage('a' * 40, 'b' * 40)
                    directory.assert_not_called()

    def test_explicit_pending_variant_refuses_before_any_private_or_process_access(self):
        module = load_helper()
        with mock.patch.multiple(module, RELEASE_SOURCE='QUALIFICATION_PENDING', RELEASE_TREE='QUALIFICATION_PENDING'), \
                mock.patch.object(module, 'private_directory', side_effect=AssertionError('private paths forbidden')) as directory, \
                mock.patch.object(module, 'regular', side_effect=AssertionError('private reads forbidden')) as regular, \
                mock.patch.object(module, 'command', side_effect=AssertionError('commands forbidden')) as command:
            with self.assertRaisesRegex(module.StagingRefused, '^release1151_pins_pending$'):
                module.stage('a' * 40, 'b' * 40)
            directory.assert_not_called(); regular.assert_not_called(); command.assert_not_called()

    def test_partial_qualification_refuses_before_any_private_or_process_access(self):
        module = load_helper()
        for pins in [('a' * 40, 'QUALIFICATION_PENDING'), ('QUALIFICATION_PENDING', 'b' * 40)]:
            with self.subTest(pins=pins), mock.patch.multiple(module, RELEASE_SOURCE=pins[0], RELEASE_TREE=pins[1]), \
                    mock.patch.object(module, 'private_directory', side_effect=AssertionError('private paths forbidden')) as directory, \
                    mock.patch.object(module, 'regular', side_effect=AssertionError('private reads forbidden')) as regular, \
                    mock.patch.object(module, 'command', side_effect=AssertionError('commands forbidden')) as command:
                with self.assertRaisesRegex(module.StagingRefused, '^release1151_pins_pending$'):
                    module.stage('a' * 40, 'b' * 40)
                directory.assert_not_called(); regular.assert_not_called(); command.assert_not_called()


class StagingTests(unittest.TestCase):
    def test_active_dependencies_must_be_the_real_private_directory_owned_by_1150(self):
        for kind in ('absolute_symlink', 'relative_symlink', 'insecure_root', 'wrong_root', 'non_directory'):
            with self.subTest(kind=kind), Fixture() as f:
                if kind == 'insecure_root': f.deps.chmod(0o755)
                elif kind == 'wrong_root': f.module.DEPENDENCY_ROOT = f.private
                else:
                    saved = f.root / 'saved-dependencies'; f.deps.rename(saved)
                    if kind == 'non_directory': f.deps.write_text('preserve unexpected file')
                    else: f.deps.symlink_to(saved if kind == 'absolute_symlink' else Path('../../saved-dependencies'), target_is_directory=True)
                self.assert_refused_unchanged(f)

    def assert_refused_unchanged(self, fixture, arguments=None):
        before = fixture.outputs()
        dependency_before = fixture.dependency_snapshot()
        receipt = fixture.private / 'jm1151-staging.json'
        receipt_existed = receipt.exists() or receipt.is_symlink()
        with self.assertRaises(fixture.module.StagingRefused):
            fixture.stage(arguments)
        self.assertEqual(fixture.outputs(), before, 'refusal must precede every new worktree, launcher and log')
        self.assertEqual(fixture.dependency_snapshot(), dependency_before, 'existing dependencies must not be normalized, installed or cleaned')
        if not receipt_existed:
            self.assertFalse(receipt.exists() or receipt.is_symlink())
        fixture.assert_preserved(self)

    def test_stages_one_exact_release_preserving_all_existing_configuration_without_reading_it(self):
        with Fixture() as f:
            receipt_path = f.private / 'jm1151-staging.json'
            actual_open, actual_fsync = os.open, os.fsync
            created = {}

            def observed_open(path, flags, *args, **kwargs):
                value = Path(path)
                self.assertFalse(any(directory in value.parents for directory in
                                     (f.private / 'runtime-video-180', f.private / 'recurring-backup-052')),
                                 'existing private configuration files must never be read')
                self.assertNotIn(value, {f.private / 'jm1150-node24221.log', f.private / 'jm1150-preflight-node24221-6712028e.log'}, 'active1150 logs are never read, written or truncated')
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
            self.assertEqual(result['format'], 'jessiemessage-release1151-staging')
            self.assertEqual(result['release'], '1.15.1')
            self.assertEqual((result['source'], result['tree']), f.arguments)
            self.assertEqual(result['schemaMigrationsExpected'], 38)
            self.assertEqual(result['expectedActiveServiceVersion'], '1.15.0')
            self.assertEqual(result['baselineMetadataRelease'], '1.15.0')
            self.assertTrue(result['priorActivePreserved'])
            self.assertTrue(result['existingConfigurationUntouched'])
            self.assertTrue(result['noRestart'])
            self.assertEqual(result['preservedActiveCheckpointSha256'], digest(f.checkpoint))
            for field in ('sqlStatusChecked', 'configurationPrepared', 'hostedQualified', 'precheckPassed',
                          'started', 'migrated', 'runtimeStarted', 'managerChanged', 'checkpointChanged'):
                self.assertIs(result[field], False, field)
            target = Path(result['checkout'])
            self.assertEqual(f.run_git(target, 'rev-parse', 'HEAD'), f.sha1151)
            self.assertEqual(f.run_git(target, 'rev-parse', 'HEAD^{tree}'), f.tree1151)
            self.assertTrue((target / 'node_modules').is_symlink())
            self.assertEqual((target / 'node_modules').resolve(), f.deps.resolve())
            self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o700)
            self.assertTrue(result['dependenciesReused'])
            self.assertEqual(result['dependencyDirectory'], str(f.deps))
            self.assertEqual(result['dependencies'], f.module.verified_dependencies())
            self.assertFalse(result['dependencies']['installed'])
            self.assertFalse(result['dependencies']['scriptsExecuted'])
            self.assertFalse(f.deps.is_symlink())
            self.assertEqual(len(list(f.operator.iterdir())), 2, 'one worktree is added beside the active checkout which owns dependencies')
            for field, prior, old_log, new_log in (
                    ('launcher', f.start, 'jm1150-node24221.log', 'log'),
                    ('checkLauncher', f.check, 'jm1150-preflight-node24221-6712028e.log', 'precheckLog')):
                path = Path(result[field])
                self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o700)
                self.assertEqual(path.stat().st_nlink, 1)
                expected = prior.read_text().replace(f.base_sha, f.sha1151).replace(f.base_tree, f.tree1151)
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
            for args in ((None, f.tree1151), ('bad', f.tree1151), (f.sha1151, '0' * 40), ('0' * 40, f.tree1151)):
                with self.subTest(arguments=args):
                    self.assert_refused_unchanged(f, args)
            self.assertFalse(f.node_trace.exists())
            for args in ([], list(f.arguments) + ['extra']):
                with self.assertRaisesRegex(f.module.StagingRefused, '^usage_two_source_tree_arguments$'):
                    f.module.main(args)

    def test_wrong_release_tag_is_refused(self):
        with Fixture() as f:
            f.run_git(f.seed, 'tag', '-f', 'v1.15.1', f.base_sha)
            f.run_git(f.seed, 'push', '--force', 'origin', 'refs/tags/v1.15.1')
            self.assert_refused_unchanged(f)

    def test_unrelated_candidate_and_main_not_containing_candidate_are_refused(self):
        for kind in ('unrelated', 'not_on_main'):
            with self.subTest(kind=kind), Fixture() as f:
                if kind == 'unrelated':
                    f.run_git(f.seed, 'checkout', '--orphan', 'unrelated')
                    f.sha1151, f.tree1151 = f.commit('unrelated candidate')
                    f.module.RELEASE_SOURCE, f.module.RELEASE_TREE = f.arguments
                    f.run_git(f.seed, 'tag', '-f', 'v1.15.1')
                    f.run_git(f.seed, 'push', '--force', 'origin', 'HEAD:refs/heads/main', 'refs/tags/v1.15.1')
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

    def test_each_package_version_must_be_1151(self):
        for field in ('package', 'lock_root', 'lock_package'):
            with self.subTest(field=field), Fixture() as f:
                def change(value):
                    path = value.seed / ('package.json' if field == 'package' else 'package-lock.json')
                    data = json.loads(path.read_text())
                    (data['packages'][''] if field == 'lock_package' else data)['version'] = '1.15.0'
                    path.write_text(json.dumps(data))
                f.advance_candidate(change)
                self.assert_refused_unchanged(f)

    def test_changed_normal_video_or_experience_migrations_and_missing_extensions_are_refused(self):
        for kind in ('normal', 'video', 'missing_video', 'experience', 'missing_experience'):
            with self.subTest(kind=kind), Fixture() as f:
                def change(value):
                    directory = value.seed / ('db/migrations' if kind == 'normal' else 'server/experience/migrations' if kind in ('experience', 'missing_experience') else 'server/video/migrations')
                    path = sorted(directory.iterdir())[0]
                    if kind in ('missing_video', 'missing_experience'):
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
                receipt = f.private / 'jm1151-staging.json'
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
            self.assertFalse((f.private / 'jm1151-staging.json').exists())
            self.assert_refused_unchanged(f)
            f.assert_preserved(self)


class DependencyPreservationTests(unittest.TestCase):
    assert_refused_unchanged = StagingTests.assert_refused_unchanged

    def test_inventory_drift_unsafe_links_and_special_files_are_refused_without_install_or_cleanup(self):
        for kind in ('content', 'file_mode', 'extra_file', 'external_link', 'fifo'):
            with self.subTest(kind=kind), Fixture() as f:
                if kind == 'content': (f.deps / 'synthetic-dependencies').write_text('unexpected dependency bytes')
                elif kind == 'file_mode': (f.deps / 'synthetic-dependencies').chmod(0o666)
                elif kind == 'extra_file': (f.deps / 'unexpected').write_text('preserve this file')
                elif kind == 'external_link': (f.deps / 'external').symlink_to(f.node)
                else: os.mkfifo(f.deps / 'unexpected-fifo', 0o600)
                self.assert_refused_unchanged(f)

    def test_each_direct_version_is_verified_independently_of_the_inventory(self):
        for name in load_helper().ROOT_DEPENDENCIES:
            with self.subTest(dependency=name), Fixture() as f:
                path = f.deps / name / 'package.json'
                content = json.loads(path.read_text()); content['version'] = '99.0.0'; path.write_text(json.dumps(content))
                f.module.DEPENDENCY_INVENTORY = f.module.dependency_inventory(f.deps)
                with self.assertRaisesRegex(f.module.StagingRefused, '^active_dependency_version:' + name + '$'):
                    f.stage()
                self.assertEqual(len(list(f.operator.iterdir())), 1); f.assert_preserved(self)

    def test_each_codec_hash_is_verified_independently_of_the_inventory(self):
        for name in load_helper().CODEC_FILES:
            with self.subTest(codec=name), Fixture() as f:
                path = f.deps / name; path.write_bytes(path.read_bytes() + b'changed')
                f.module.DEPENDENCY_INVENTORY = f.module.dependency_inventory(f.deps)
                with self.assertRaisesRegex(f.module.StagingRefused, '^active_dependency_codec:' + name + '$'):
                    f.stage()
                self.assertEqual(len(list(f.operator.iterdir())), 1); f.assert_preserved(self)

    def test_safe_internal_dependency_links_are_preserved_when_the_exact_inventory_is_pinned(self):
        with Fixture() as f:
            (f.deps / '.bin').mkdir(mode=0o700)
            (f.deps / '.bin/synthetic-tool').symlink_to('../mariadb/package.json')
            f.module.DEPENDENCY_INVENTORY = f.module.dependency_inventory(f.deps)
            before = f.dependency_snapshot(); result = f.stage()
            self.assertEqual(f.dependency_snapshot(), before)
            self.assertEqual(result['dependencies']['inventory'], f.module.DEPENDENCY_INVENTORY)
            self.assertEqual(os.readlink(Path(result['checkout']) / 'node_modules'), str(f.deps))

    def test_dependency_drift_during_launcher_planning_refuses_before_new_outputs(self):
        with Fixture() as f:
            before = f.outputs(); actual = f.module.launcher
            def altered(*args, **kwargs):
                result = actual(*args, **kwargs)
                if kwargs['check']: (f.deps / 'synthetic-dependencies').write_text('late preserved external drift')
                return result
            with mock.patch.object(f.module, 'launcher', side_effect=altered), self.assertRaisesRegex(f.module.StagingRefused, '^active_dependency_inventory$'):
                f.stage()
            self.assertEqual(f.outputs(), before); f.assert_preserved(self)

    def test_dependency_drift_after_worktree_creation_keeps_partial_outputs_and_refuses_replay(self):
        with Fixture() as f:
            actual = f.module.write_exclusive; count = 0
            def altered(*args, **kwargs):
                nonlocal count
                count += 1; result = actual(*args, **kwargs)
                if count == 2: (f.deps / 'synthetic-dependencies').write_text('late preserved external drift')
                return result
            with mock.patch.object(f.module, 'write_exclusive', side_effect=altered), self.assertRaisesRegex(f.module.StagingRefused, '^active_dependency_inventory$'):
                f.stage()
            self.assertTrue(f.module.release_plan(*f.arguments)['checkout'].exists())
            self.assertFalse((f.private / 'jm1151-staging.json').exists())
            self.assert_refused_unchanged(f)

    def test_only_version_fields_may_change_in_package_and_lock(self):
        for field in ('package_script', 'package_engine', 'lock_name', 'lock_metadata'):
            with self.subTest(field=field), Fixture() as f:
                def alter(value):
                    path = value.seed / ('package.json' if field.startswith('package') else 'package-lock.json')
                    content = json.loads(path.read_text())
                    if field == 'package_script': content['scripts'] = {'start': 'forbidden alternate command'}
                    elif field == 'package_engine': content['engines'] = {'node': '>=99'}
                    elif field == 'lock_name': content['name'] = 'changed-lock-name'
                    else: content['packages']['node_modules/mariadb']['integrity'] = 'changed-integrity'
                    path.write_text(json.dumps(content))
                f.advance_candidate(alter); self.assert_refused_unchanged(f)


class CreatedDirectoryTests(unittest.TestCase):
    def test_constructor_failure_removes_only_its_disposable_fixture(self):
        before = set(HERE.parent.glob('prepare1151-test-*'))
        with mock.patch.object(Fixture, 'run_git', side_effect=RuntimeError('synthetic initialization failure')):
            with self.assertRaisesRegex(RuntimeError, '^synthetic initialization failure$'): Fixture()
        self.assertEqual(set(HERE.parent.glob('prepare1151-test-*')), before)

    def test_existing_checkout_or_dependencies_never_drop_inherited_setgid(self):
        for field in ('base', 'deps'):
            with self.subTest(field=field), Fixture() as f:
                path = getattr(f, field); path.chmod(0o2700)
                with self.assertRaises(f.module.StagingRefused): f.stage()
                self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o2700)
                self.assertEqual(len(list(f.operator.iterdir())), 1)

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
            directory = Path(temporary) / 'new'; directory.mkdir(parents=True, exist_ok=True, mode=0o700); directory.chmod(0o2700)
            actual = module.os.fstat
            def different(fd):
                values = list(actual(fd)); values[1] += 1
                return os.stat_result(values)
            with mock.patch.object(module.os, 'fstat', side_effect=different), mock.patch.object(module.os, 'fchmod', side_effect=AssertionError('must not mutate')):
                with self.assertRaises(module.StagingRefused): module.normalize_created_directory(directory)
            self.assertEqual(stat.S_IMODE(directory.stat().st_mode), 0o2700)


class CheckpointPreservationTests(unittest.TestCase):
    def test_exact_1150_bytes_are_observed_without_rewriting_or_running_anything(self):
        with Fixture() as f:
            before = f.checkpoint.read_bytes()
            self.assertEqual(f.module.checkpoint_baseline(before), dict(sha256=digest(f.checkpoint), metadataRelease='1.15.0'))
            self.assertEqual(f.checkpoint.read_bytes(), before); self.assertFalse(f.node_trace.exists())

    def test_any_checkpoint_drift_refuses_before_node_or_new_outputs(self):
        with Fixture() as f:
            for raw in (b'changed prior history', b'{"activeService":{}}', b'not json'):
                f.checkpoint.write_bytes(raw); f.preserved[f.checkpoint] = raw
                before = f.outputs()
                with self.assertRaisesRegex(f.module.StagingRefused, '^active_checkpoint_hash$'): f.stage()
                self.assertEqual(f.outputs(), before); self.assertFalse(f.node_trace.exists()); f.assert_preserved(self)

    def test_active_identity_is_checked_even_when_test_fixture_hash_is_rebound(self):
        for field in ('release', 'source', 'tree'):
            with self.subTest(field=field), Fixture() as f:
                content = json.loads(f.checkpoint.read_text()); content['activeService'][field] = 'unexpected'
                f.checkpoint.write_text(json.dumps(content) + '\n'); f.module.CHECKPOINT_PIN = digest(f.checkpoint)
                f.preserved[f.checkpoint] = f.checkpoint.read_bytes(); before = f.outputs()
                with self.assertRaisesRegex(f.module.StagingRefused, '^active_checkpoint_identity$'): f.stage()
                self.assertEqual(f.outputs(), before); self.assertFalse(f.node_trace.exists()); f.assert_preserved(self)


class BoundedReaderTests(unittest.TestCase):
    def test_text_reads_are_bounded_while_large_known_resources_use_streaming_digests(self):
        module = load_helper()
        with tempfile.TemporaryDirectory(prefix='prepare1151-reader-', dir=HERE.parent) as directory:
            path = Path(directory) / 'synthetic-resource'; path.write_bytes(b'a' * 3145729); path.chmod(0o600)
            with self.assertRaisesRegex(module.StagingRefused, '^file_size:synthetic-resource$'):
                module.regular(path)
            self.assertEqual(module.regular(path, digest_only=True), digest(path))
            path.write_bytes(b'b' * 2097152)
            self.assertEqual(len(module.regular(path)), 2097152)
            with path.open('ab') as handle: handle.write(b'x')
            with self.assertRaisesRegex(module.StagingRefused, '^file_size:synthetic-resource$'):
                module.regular(path)


class PublishedBaseInventoryTests(unittest.TestCase):
    def test_actual_1150_source_has_exact_lock_map_and_38_migration_files(self):
        module = load_helper(); repository = Path(os.environ.get('JESSIEMESSAGE_QUALIFICATION_REPOSITORY', HERE.parent)).resolve()
        with mock.patch.object(module, 'BASE_CHECKOUT', repository):
            self.assertEqual(module.git(repository, 'rev-parse', module.BASE_SOURCE + '^{tree}'), module.BASE_TREE)
            package = json.loads(module.source_blob(module.BASE_SOURCE, 'package.json'))
            lock_bytes = module.source_blob(module.BASE_SOURCE, 'package-lock.json'); lock = json.loads(lock_bytes)
            self.assertEqual(hashlib.sha256(lock_bytes).hexdigest(), module.BASE_LOCK_SHA)
            self.assertEqual(package['version'], '1.15.0'); self.assertEqual(lock['version'], '1.15.0')
            self.assertEqual(lock['packages']['']['version'], '1.15.0')
            self.assertEqual(package['dependencies'], module.ROOT_DEPENDENCIES)
            self.assertEqual(lock['packages']['']['dependencies'], module.ROOT_DEPENDENCIES)
            for directory, count in [('db/migrations',33),('server/video/migrations',3),('server/experience/migrations',2)]:
                self.assertEqual(len(module.migration_inventory(module.BASE_SOURCE, directory)), count)
            candidate = json.loads(json.dumps(package)); graph = json.loads(json.dumps(lock))
            candidate['version'] = graph['version'] = graph['packages']['']['version'] = '1.15.1'
            module.validate_lock_transition(package, lock, candidate, graph)
            # Final source validation is a separate main-SHA qualification.
            self.assertNotEqual(module.RELEASE_SOURCE, module.BASE_SOURCE)


if __name__ == '__main__':
    unittest.main(verbosity=2)
