#!/usr/bin/env python3
"""Draft tests: disposable files, simulated Git/npm/Node and no network.

These tests verify orchestration and refusal behavior, never native codecs.
Final codec/source pins and separate native qualification remain mandatory.
The explicit --native-install mode is CI-only and remains blocked by pending
pins. It installs only in a fresh runner temporary directory, never /srv.
"""
import copy
from contextlib import redirect_stderr
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
HELPER = HERE / 'prepare-release1150.py'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def load_helper():
    module = types.ModuleType('synthetic_prepare1150')
    module.__file__ = str(HELPER)
    with mock.patch('subprocess.run', side_effect=AssertionError('no import process')):
        exec(compile(HELPER.read_bytes(), str(HELPER), 'exec'), module.__dict__)
    return module


def write(path, data, mode=0o600):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    path.write_bytes(data)
    path.chmod(mode)


def snapshot(path):
    info = path.lstat()
    metadata = tuple(getattr(info, key) for key in ('st_dev', 'st_ino', 'st_mode', 'st_uid',
        'st_nlink', 'st_size', 'st_mtime_ns', 'st_ctime_ns'))
    if stat.S_ISLNK(info.st_mode):
        value = os.readlink(path)
    elif stat.S_ISDIR(info.st_mode):
        value = [(child.name, snapshot(child)) for child in sorted(path.iterdir())]
    else:
        value = path.read_bytes()
    return metadata, value


def archive_bytes(module, *, version='11.19.1', extra=None):
    files = [(module.ARCHIVE_ROOT + '/lib/node_modules/npm/package.json',
              json.dumps(dict(name='npm', version=version)).encode(), tarfile.REGTYPE),
             (module.ARCHIVE_ROOT + '/lib/node_modules/npm/bin/npm-cli.js',
              b'// synthetic npm, never executed\n', tarfile.REGTYPE)]
    if extra:
        files.append(extra)
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode='w:xz') as archive:
        for name, data, kind in files:
            member = tarfile.TarInfo(name); member.type = kind
            if kind == tarfile.SYMTYPE:
                member.linkname = '/outside-synthetic-target'; member.size = 0
            else:
                member.size = len(data)
            archive.addfile(member, io.BytesIO(data) if member.isfile() else None)
    return output.getvalue()


class Fixture:
    """Exercise real file guards and installation orchestration without a process."""
    def __init__(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='prepare1150-', dir=HERE.parent)
        self.root = Path(self.temporary.name)
        self.module = load_helper(); m = self.module
        self.private = self.root / 'private'; self.private.mkdir(mode=0o700)
        self.operator = self.root / 'operator'; self.operator.mkdir(mode=0o700)
        self.base = self.operator / 'production-1141-c803c2c9'; self.base.mkdir(mode=0o700)
        self.old_base = self.operator / 'production-1140-4f3ce5de'; self.old_base.mkdir(mode=0o700)
        self.deps = self.old_base / 'node_modules'; self.deps.mkdir(mode=0o700)
        (self.base / 'node_modules').symlink_to(self.deps, target_is_directory=True)
        self.base_sha, self.base_tree, self.sha, self.tree = '1' * 40, '2' * 40, '3' * 40, '4' * 40
        self.old_sha, self.old_tree = '5' * 40, '6' * 40
        self.old_package = dict(name='synthetic', version='1.14.1', private=True,
            scripts={'start': 'DO_NOT_EXECUTE'}, dependencies=dict(m.OLD_ROOT_DEPENDENCIES))
        self.old_lock = dict(name='synthetic', version='1.14.1', lockfileVersion=3, packages={
            '': dict(name='synthetic', version='1.14.1', dependencies=dict(m.OLD_ROOT_DEPENDENCIES)),
            **{'node_modules/' + name: dict(version=version, integrity='synthetic-' + name)
               for name, version in m.OLD_ROOT_DEPENDENCIES.items()}})
        self.package = copy.deepcopy(self.old_package); self.package['version'] = '1.15.0'
        self.package['dependencies']['synthetic-codec'] = '1.2.3'
        self.lock = copy.deepcopy(self.old_lock); self.lock['version'] = '1.15.0'
        self.lock['packages']['']['version'] = '1.15.0'
        self.lock['packages']['']['dependencies'] = dict(self.package['dependencies'])
        self.record = dict(version='1.2.3', integrity='synthetic-pinned-codec')
        self.lock['packages']['node_modules/synthetic-codec'] = self.record
        self.old_install_lock = copy.deepcopy(self.old_lock)
        self.old_install_lock['version'] = self.old_install_lock['packages']['']['version'] = '1.14.0'
        self.smoke = b'// synthetic pinned smoke placeholder, never native qualification\n'
        self.blobs = {(self.base_sha, 'package.json'): m.canonical(self.old_package),
            (self.base_sha, 'package-lock.json'): m.canonical(self.old_lock),
            (self.old_sha, 'package-lock.json'): m.canonical(self.old_install_lock),
            (self.sha, 'package.json'): m.canonical(self.package),
            (self.sha, 'package-lock.json'): m.canonical(self.lock),
            (self.sha, 'scripts/synthetic-codec-smoke.mjs'): self.smoke}
        for name in ('package.json', 'package-lock.json'):
            write(self.base / name, self.blobs[self.base_sha, name])
        write(self.old_base / 'package-lock.json', self.blobs[self.old_sha, 'package-lock.json'])
        for name, version in m.OLD_ROOT_DEPENDENCIES.items():
            write(self.deps / name / 'package.json', m.canonical(dict(name=name, version=version)))
        old_codecs = {}
        for name in m.OLD_CODEC_FILES:
            data = ('synthetic historical codec ' + name).encode()
            write(self.deps / 'libheif-js' / name, data); old_codecs[name] = digest(data)
        self.node = self.private / 'runtime-node-v24.22.1/bin/node'
        write(self.node, b'NOT AN EXECUTABLE NODE: simulated only\n', 0o700)
        self.start = self.private / 'start-primary-release1141-c803c2c9.sh'
        self.check = self.private / 'check-primary-release1141-c803c2c9.sh'
        for path, check in ((self.start, False), (self.check, True)):
            operation = 'check-local-closures' if check else 'start-local-closures'
            log = self.private / ('jm1141-preflight-node24221-c803c2c9.log' if check else 'jm1141-node24221.log')
            text = (f'#!/bin/bash\n# source {self.base_sha}\n# tree {self.base_tree}\n'
                f'cd {self.base}\nexec {self.node} {self.base}/scripts/recurring-private-checkpoint.mjs '
                f'{operation} --profile {m.PROFILE} --experience 1 --private-path-mode linux-dirfd '
                f'--configuration-directory {self.private}/runtime-video-180 '
                f'--directory {self.private}/recurring-backup-052 >> {log} 2>&1\n')
            write(path, text.encode(), 0o700); write(log, b'preserve historical log\n')
        self.checkpoint = self.private / 'jm0702-existing-pc-update.json'
        write(self.checkpoint, m.canonical(dict(activeService=dict(release='1.14.1', source=self.base_sha, tree=self.base_tree),
            priorHistory=dict(preserve='synthetic history'), other=dict(preserve=True))))
        self.staging = self.private / 'jm1141-staging.json'; write(self.staging, b'old1141 receipt\n')
        write(self.private / 'jm1140-staging.json', b'old1140 receipt\n')
        write(self.private / 'start-primary-release1140-4f3ce5de.sh', b'old1140 launcher\n', 0o700)
        write(self.private / 'jm1140-node24221.log', b'old1140 log\n')
        aggregate = hashlib.sha256()
        for name in m.CONFIGURATION_NAMES:
            data = m.canonical(dict(synthetic=name))
            write(self.private / 'runtime-video-180' / name, data)
            aggregate.update(name.encode()); aggregate.update(b'\0'); aggregate.update(str(len(data)).encode()); aggregate.update(b'\0'); aggregate.update(data)
        write(self.private / 'recurring-backup-052/sentinel', b'preserve authority and private data\x00\xff\n')
        self.codec = b'synthetic new codec bytes\n'
        values = dict(PRIVATE=self.private, BASE_CHECKOUT=self.base, DEPENDENCY_ROOT=self.deps,
            BASE_SOURCE=self.base_sha, BASE_TREE=self.base_tree, RELEASE_SOURCE=self.sha, RELEASE_TREE=self.tree,
            DEPENDENCY_SOURCE=self.old_sha, DEPENDENCY_TREE=self.old_tree, START_PIN=digest(self.start.read_bytes()),
            CHECK_PIN=digest(self.check.read_bytes()), CHECKPOINT_PIN=digest(self.checkpoint.read_bytes()),
            NODE_PIN=digest(self.node.read_bytes()), BASE_STAGING_SHA=digest(self.staging.read_bytes()),
            BASE_LOCK_SHA=digest(self.blobs[self.base_sha, 'package-lock.json']),
            BASE_INSTALL_LOCK_SHA=digest(self.blobs[self.old_sha, 'package-lock.json']),
            OLD_CODEC_FILES=old_codecs, CONFIGURATION_SHA=aggregate.hexdigest(),
            ALLOWED_NEW_DEPENDENCIES={'synthetic-codec': '1.2.3'},
            ADDITIONAL_LOCK_RECORDS={'node_modules/synthetic-codec': copy.deepcopy(self.record)},
            CODEC_FILES={'synthetic-codec/codec.bin': digest(self.codec)},
            CODEC_SMOKE_PATH='scripts/synthetic-codec-smoke.mjs', CODEC_SMOKE_SHA=digest(self.smoke))
        for key, value in values.items(): setattr(m, key, value)
        m.DEPENDENCY_INVENTORY = m.dependency_inventory(self.deps)
        self.archive = archive_bytes(m); m.ARCHIVE_BYTES = len(self.archive); m.ARCHIVE_SHA = digest(self.archive)
        self.identities = {self.base: (self.base_sha, self.base_tree), self.old_base: (self.old_sha, self.old_tree)}
        self.git_calls = []; self.processes = []; self.downloads = 0
        self.install_error = False; self.smoke_error = False; self.after_install = None
        self.migrations = {'db/migrations': [(f'{i:04d}_synthetic.sql', str(i)) for i in range(1, 34)],
            'server/video/migrations': [(name, name) for name in m.VIDEO_DDL],
            'server/experience/migrations': [(name, name) for name in m.EXPERIENCE_DDL]}
        self.preserved = {path: snapshot(path) for path in (*self.private.iterdir(), self.base, self.old_base)}

    def __enter__(self): return self
    def __exit__(self, *_): self.temporary.cleanup()

    def fake_git(self, checkout, *args):
        self.git_calls.append((checkout, args))
        if args[:2] == ('rev-parse', 'HEAD'):
            return self.identities[checkout][0]
        if args[:2] == ('rev-parse', 'HEAD^{tree}'):
            return self.identities[checkout][1]
        if args[0] == 'rev-parse':
            return self.sha if args[1].startswith('refs/tags/') else self.tree
        if args[0] in ('status', 'ls-tree', 'fetch', 'merge-base'):
            return ''
        if args[:3] == ('worktree', 'add', '--detach'):
            target = Path(args[3]); target.mkdir(mode=0o700); target.chmod(0o2700)
            for (sha, name), data in self.blobs.items():
                if sha == self.sha: write(target / name, data)
            self.identities[target] = (self.sha, self.tree)
            return ''
        raise AssertionError(('unexpected simulated Git', args))

    def fake_run(self, args, **kwargs):
        self.processes.append((list(args), kwargs))
        if args == [str(self.node), '--version']:
            return types.SimpleNamespace(returncode=0, stdout=b'v24.22.1\n', stderr=b'')
        if args == ['/bin/bash', '-n']:
            assert kwargs.get('input')
            return types.SimpleNamespace(returncode=0, stdout=b'', stderr=b'')
        if args[:2] == [str(self.node), str(self.module.release_plan(self.sha, self.tree)['tools'] / 'npm/bin/npm-cli.js')]:
            assert args[2:6] == ['ci', '--ignore-scripts', '--no-audit', '--no-fund']
            assert kwargs['env'] == self.module.npm_environment(self.node,
                self.module.release_plan(self.sha, self.tree)['tools'] / 'cache', self.module.release_plan(self.sha, self.tree)['tools'] / 'tmp')
            if self.install_error: return types.SimpleNamespace(returncode=1)
            root = Path(kwargs['cwd']) / 'node_modules'; root.mkdir(mode=0o700)
            for name, version in self.module.release_dependencies().items():
                write(root / name / 'package.json', self.module.canonical(dict(name=name, version=version)))
            for name in self.module.OLD_CODEC_FILES:
                write(root / 'libheif-js' / name, (self.deps / 'libheif-js' / name).read_bytes())
            write(root / 'synthetic-codec/codec.bin', self.codec)
            kwargs['stdout'].write(b'synthetic npm stdout\n'); kwargs['stderr'].write(b'synthetic npm stderr\n')
            if self.after_install: self.after_install(self)
            return types.SimpleNamespace(returncode=0)
        if args == [str(self.node), str(self.module.release_plan(self.sha, self.tree)['checkout'] / self.module.CODEC_SMOKE_PATH)]:
            return types.SimpleNamespace(returncode=1 if self.smoke_error else 0, stdout=b'', stderr=b'')
        raise AssertionError(('no real process allowed', args))

    def download(self):
        self.downloads += 1; return self.archive

    def stage(self):
        m = self.module
        with mock.patch.object(m, 'git', side_effect=self.fake_git), \
             mock.patch.object(m, 'source_blob', side_effect=lambda sha, name: self.blobs[sha, name]), \
             mock.patch.object(m, 'migration_inventory', side_effect=lambda sha, name: self.migrations[name]), \
             mock.patch.object(m, 'download_archive', side_effect=self.download), \
             mock.patch.object(m.subprocess, 'run', side_effect=self.fake_run):
            return m.stage(self.sha, self.tree)

    def assert_preserved(self, test):
        for path, value in self.preserved.items(): test.assertEqual(snapshot(path), value, str(path))


class DraftPinsTests(unittest.TestCase):
    def test_reviewed_active_and_installer_pins(self):
        m = load_helper()
        expected = dict(BASE_SOURCE='c803c2c9be16c0c4ee218d8cac4a1272620d2772', BASE_TREE='f391b5cebe0a8a8ffd63c818cd481b50970336f1',
            CHECKPOINT_PIN='93d6ddf70db3b1b30d006bf2fb30ab7594ebc2d2b8f88cc59a230f247cbaca82',
            BASE_STAGING_SHA='df4b58f79ed08af15365557fd88670cd887c4cce9382200fadbd03a9c9593d72',
            START_PIN='e53198d1ddf099eaf3ecbd60b6916a94921430a555eaed2a4a4c41ce64ff27a9',
            CHECK_PIN='6f4aa454a5d1163b9450dba8644ed50dcf034f1a916cad1891c0fa1fc2b05919',
            NODE_PIN='e32e2d16081cf644f88392934288086e7662529d0d43277c34f7aad2207cfafb',
            ARCHIVE_SHA='6c172a9ab6718f7b801fb5a7bd486af2ee5e32758086a04b84fcce2aa77095e6',
            BASE_LOCK_SHA='d4b723dc88b8e0e7b0d85755d6751b31399248a1444c55e47c61c56809e76f7c',
            BASE_INSTALL_LOCK_SHA='623e3be5057fd8d348d9363d30afef93c6e26dc8cd6df3b8150116c5f17c8e5b',
            CONFIGURATION_SHA='bcca2f3fd91ffc0dec51a7077eb9e192a53b6e653b60c7db7159e473b83aac85')
        for name, value in expected.items(): self.assertEqual(getattr(m, name), value, name)
        self.assertEqual(m.NPM_VERSION, '11.19.1'); self.assertEqual(m.NODE_VERSION, 'v24.22.1')
        self.assertEqual(m.DEPENDENCY_INVENTORY, dict(sha256='547c6ec03aa29027264dbb848e7830df0cb615a1eb92710498bc94d988897c37', entries=1082, files=914))
        self.assertEqual(str(m.DEPENDENCY_ROOT), '/srv/customer/jessiemessage-operator/production-1140-4f3ce5de/node_modules')

    def test_pending_pins_stop_before_private_reads_processes_network_or_writes(self):
        m = load_helper()
        for name in ('RELEASE_SOURCE', 'RELEASE_TREE', 'ALLOWED_NEW_DEPENDENCIES', 'ADDITIONAL_LOCK_RECORDS', 'CODEC_FILES', 'CODEC_SMOKE_PATH', 'CODEC_SMOKE_SHA'):
            self.assertEqual(getattr(m, name), m.QUALIFICATION_PENDING)
        with mock.patch.object(m, 'private_directory', side_effect=AssertionError('no private read')), \
             mock.patch.object(m.subprocess, 'run', side_effect=AssertionError('no process')), \
             mock.patch.object(m, 'download_archive', side_effect=AssertionError('no network')):
            with self.assertRaisesRegex(m.StagingRefused, 'release1150_pins_pending'): m.stage('a' * 40, 'b' * 40)

    def test_every_future_pin_is_required_even_with_synthetic_source_pins(self):
        for name in ('ALLOWED_NEW_DEPENDENCIES', 'ADDITIONAL_LOCK_RECORDS', 'CODEC_FILES', 'CODEC_SMOKE_PATH', 'CODEC_SMOKE_SHA'):
            with self.subTest(name=name), Fixture() as f:
                setattr(f.module, name, f.module.QUALIFICATION_PENDING)
                with self.assertRaises(f.module.StagingRefused): f.stage()
                self.assertEqual(f.processes, []); self.assertEqual(f.git_calls, []); self.assertEqual(f.downloads, 0)
                f.assert_preserved(self)


class TransitionTests(unittest.TestCase):
    def test_exact_old_six_and_only_pinned_added_records(self):
        with Fixture() as f:
            f.module.validate_lock_transition(f.old_package, f.old_lock, f.package, f.lock)

    def test_changes_to_any_existing_lock_record_are_refused(self):
        for name in load_helper().OLD_ROOT_DEPENDENCIES:
            with self.subTest(name=name), Fixture() as f:
                changed = copy.deepcopy(f.lock); changed['packages']['node_modules/' + name]['integrity'] = 'changed'
                with self.assertRaisesRegex(f.module.StagingRefused, 'locked_dependencies'):
                    f.module.validate_lock_transition(f.old_package, f.old_lock, f.package, changed)

    def test_unapproved_root_record_or_package_script_change_is_refused(self):
        for change in ('root', 'record', 'script', 'added-integrity', 'old-version'):
            with self.subTest(change=change), Fixture() as f:
                package, lock = copy.deepcopy(f.package), copy.deepcopy(f.lock)
                if change == 'root': package['dependencies']['extra'] = lock['packages']['']['dependencies']['extra'] = '1.0.0'
                if change == 'record': lock['packages']['node_modules/extra'] = {'version': '1.0.0'}
                if change == 'script': package['scripts']['preinstall'] = 'DO_NOT_EXECUTE'
                if change == 'added-integrity': lock['packages']['node_modules/synthetic-codec']['integrity'] = 'changed'
                if change == 'old-version': package['dependencies']['libheif-js'] = lock['packages']['']['dependencies']['libheif-js'] = '9.9.9'
                with self.assertRaises(f.module.StagingRefused): f.module.validate_lock_transition(f.old_package, f.old_lock, package, lock)

    def test_addition_cannot_claim_an_existing_lock_record(self):
        with Fixture() as f:
            f.module.ADDITIONAL_LOCK_RECORDS['node_modules/sharp'] = f.old_lock['packages']['node_modules/sharp']
            with self.assertRaisesRegex(f.module.StagingRefused, 'existing_lock_record_replaced'):
                f.module.validate_lock_transition(f.old_package, f.old_lock, f.package, f.lock)


class ArchiveAndEnvironmentTests(unittest.TestCase):
    def test_npm_environment_discards_ambient_credentials_configuration_and_node_hooks(self):
        m = load_helper()
        with mock.patch.dict(os.environ, {'NODE_OPTIONS': '--require=bad', 'NPM_CONFIG_PREFIX': '/bad',
                'NPM_CONFIG_USERCONFIG': '/bad', 'HTTPS_PROXY': 'http://bad', 'HOME': '/ambient', 'TOKEN': 'synthetic'}):
            value = m.npm_environment(Path('/private/node/bin/node'), Path('/private/tools/cache'), Path('/private/tools/tmp'))
        self.assertEqual(set(value), {'PATH', 'LC_ALL', 'TMPDIR', 'NPM_CONFIG_USERCONFIG', 'NPM_CONFIG_GLOBALCONFIG', 'NPM_CONFIG_UPDATE_NOTIFIER'})
        self.assertEqual(value['NPM_CONFIG_USERCONFIG'], '/private/tools/user.npmrc')
        self.assertEqual(value['NPM_CONFIG_GLOBALCONFIG'], '/private/tools/global.npmrc')

    def test_exact_archive_extracts_only_regular_npm_files_not_node(self):
        with Fixture() as f:
            tools = f.root / 'extract'; tools.mkdir(mode=0o700)
            value = f.module.extract_tools(f.archive, tools)
            self.assertEqual(value['npmVersion'], '11.19.1'); self.assertFalse((tools / 'node').exists())
            self.assertEqual(stat.S_IMODE((tools / 'npm/bin/npm-cli.js').stat().st_mode), 0o600)

    def test_wrong_archive_hash_version_path_or_symlink_is_refused(self):
        for change in ('hash', 'version', 'traversal', 'symlink'):
            with self.subTest(change=change), Fixture() as f:
                tools = f.root / 'extract'; tools.mkdir(mode=0o700)
                extra = None
                if change == 'traversal': extra = (f.module.ARCHIVE_ROOT + '/lib/node_modules/npm/../escape', b'bad', tarfile.REGTYPE)
                if change == 'symlink': extra = (f.module.ARCHIVE_ROOT + '/lib/node_modules/npm/link', b'', tarfile.SYMTYPE)
                data = archive_bytes(f.module, version='0.0.0' if change == 'version' else '11.19.1', extra=extra)
                f.module.ARCHIVE_BYTES = len(data); f.module.ARCHIVE_SHA = '0' * 64 if change == 'hash' else digest(data)
                with self.assertRaises(f.module.StagingRefused): f.module.extract_tools(data, tools)
                self.assertEqual(list(tools.iterdir()), [])


class StagingTests(unittest.TestCase):
    def test_fresh_private_install_and_exclusive_outputs_preserve_active_link_target_and_history(self):
        with Fixture() as f:
            receipt = f.stage(); f.assert_preserved(self)
            checkout = Path(receipt['checkout']); modules = checkout / 'node_modules'
            self.assertFalse(modules.is_symlink()); self.assertNotEqual(modules, f.deps)
            self.assertEqual(stat.S_IMODE(checkout.stat().st_mode), 0o700)
            self.assertEqual(stat.S_IMODE(modules.stat().st_mode), 0o700)
            self.assertEqual(os.readlink(f.base / 'node_modules'), str(f.deps))
            self.assertEqual(receipt['status'], 'release1150_sources_staged_not_qualified')
            self.assertFalse(receipt['dependenciesReused']); self.assertEqual(receipt['expectedActiveServiceVersion'], '1.14.1')
            self.assertEqual(receipt['schemaMigrationsExpected'], 38); self.assertEqual(receipt['applicationTablesExpected'], 37)
            for key in ('hostedQualified', 'precheckPassed', 'started', 'migrated', 'runtimeStarted', 'managerChanged', 'checkpointChanged', 'sqlStatusChecked'):
                self.assertIs(receipt[key], False)
            self.assertIs(receipt['dependencies']['scriptsExecuted'], False)
            self.assertEqual(Path(receipt['log']).read_bytes(), b''); self.assertEqual(Path(receipt['precheckLog']).read_bytes(), b'')
            self.assertEqual(digest(Path(receipt['receipt']).read_bytes()), receipt['receiptSha256'])
            self.assertTrue(all(args[0] in (str(f.node), '/bin/bash') for args, _ in f.processes))
            self.assertEqual(len([args for args, _ in f.processes if 'ci' in args]), 1)

    def test_each_existing_output_refuses_before_worktree_download_or_install(self):
        for key in ('checkout', 'tools', 'start', 'check', 'log', 'prelog', 'receipt'):
            with self.subTest(key=key), Fixture() as f:
                path = f.private / 'jm1150-staging.json' if key == 'receipt' else f.module.release_plan(f.sha, f.tree)[key]
                write(path, b'preserve partial output\n')
                with self.assertRaisesRegex(f.module.StagingRefused, 'existing_output'): f.stage()
                self.assertEqual(path.read_bytes(), b'preserve partial output\n'); self.assertEqual(f.downloads, 0)
                self.assertFalse(any(args[0] == 'worktree' for _, args in f.git_calls)); f.assert_preserved(self)

    def test_real_directory_or_wrong_link_in_active1141_is_not_normalized(self):
        for change in ('directory', 'wrong link'):
            with self.subTest(change=change), Fixture() as f:
                link = f.base / 'node_modules'; link.unlink()
                if change == 'directory': link.mkdir(mode=0o700)
                else: link.symlink_to(f.root / 'wrong-target')
                before = snapshot(link)
                with self.assertRaisesRegex(f.module.StagingRefused, 'active_dependencies_link'): f.stage()
                self.assertEqual(snapshot(link), before); self.assertEqual(f.downloads, 0)

    def test_changed_old_dependency_or_configuration_refuses_before_new_checkout(self):
        for change in ('dependency', 'configuration', 'checkpoint', 'launcher', 'lock'):
            with self.subTest(change=change), Fixture() as f:
                if change == 'dependency': write(f.deps / 'sharp/package.json', b'{"name":"sharp","version":"9.9.9"}\n')
                if change == 'configuration': write(f.private / 'runtime-video-180/runtime-media.json', b'{"synthetic":"changed"}\n')
                if change == 'checkpoint': write(f.checkpoint, b'{}\n')
                if change == 'launcher': write(f.start, b'changed\n', 0o700)
                if change == 'lock': f.blobs[f.base_sha, 'package-lock.json'] += b' '
                with self.assertRaises(f.module.StagingRefused): f.stage()
                self.assertFalse(any(args[0] == 'worktree' for _, args in f.git_calls)); self.assertEqual(f.downloads, 0)

    def test_failed_npm_or_real_smoke_preserves_partial_checkout_and_never_writes_receipt_or_launchers(self):
        for failure in ('npm', 'smoke'):
            with self.subTest(failure=failure), Fixture() as f:
                f.install_error = failure == 'npm'; f.smoke_error = failure == 'smoke'
                with self.assertRaisesRegex(f.module.StagingRefused, 'npm_install_refused|native_dependency_refused'): f.stage()
                plan = f.module.release_plan(f.sha, f.tree)
                self.assertTrue(plan['checkout'].is_dir()); self.assertTrue(plan['tools'].is_dir())
                self.assertFalse(plan['start'].exists()); self.assertFalse((f.private / 'jm1150-staging.json').exists())
                self.assertTrue((plan['tools'] / 'npm-stdout.log').exists()); f.assert_preserved(self)
                count = len(f.processes)
                with self.assertRaisesRegex(f.module.StagingRefused, 'existing_output'): f.stage()
                self.assertFalse(any('ci' in args for args, _ in f.processes[count:]))

    def test_mutating_manifest_codec_or_prior_dependency_during_install_prevents_receipt(self):
        for change in ('manifest', 'codec', 'prior-dependency'):
            with self.subTest(change=change), Fixture() as f:
                def mutate(value):
                    checkout = value.module.release_plan(value.sha, value.tree)['checkout']
                    if change == 'manifest': write(checkout / 'package-lock.json', b'{}\n')
                    if change == 'codec': write(checkout / 'node_modules/synthetic-codec/codec.bin', b'changed\n')
                    if change == 'prior-dependency': write(value.deps / 'sharp/package.json', b'changed\n')
                f.after_install = mutate
                with self.assertRaises(f.module.StagingRefused): f.stage()
                self.assertFalse((f.private / 'jm1150-staging.json').exists())

    def test_exclusive_write_preserves_preexisting_symlink_and_target(self):
        with Fixture() as f:
            target = f.root / 'target'; write(target, b'preserve target\n')
            link = f.private / 'new-output'; link.symlink_to(target)
            with self.assertRaises(FileExistsError): f.module.write_exclusive(link, b'bad')
            self.assertEqual(target.read_bytes(), b'preserve target\n'); self.assertTrue(link.is_symlink())

    def test_setgid_normalization_rejects_symlink_and_keeps_its_target(self):
        with Fixture() as f:
            target = f.root / 'target'; target.mkdir(mode=0o700); target.chmod(0o2700)
            link = f.root / 'link'; link.symlink_to(target, target_is_directory=True)
            with self.assertRaises(f.module.StagingRefused): f.module.normalize_created_directory(link)
            self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o2700)


def native_failure_logs(module, root, tools):
    """Expose only bounded install logs from this disposable native directory."""
    module.require(root.is_absolute() and root.name.startswith('prepare1150-native-')
        and not root.is_relative_to(Path('/srv')) and tools == root / 'tools', 'native_diagnostic_scope')
    module.private_directory(root); module.private_directory(tools)
    for name in ('stdout', 'stderr'):
        path = tools / ('npm-' + name + '.log')
        try:
            info = path.lstat()
            module.require(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid()
                and info.st_nlink == 1 and stat.S_IMODE(info.st_mode) == 0o600, 'native_log_metadata')
            fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
            with os.fdopen(fd, 'rb') as source:
                opened = os.fstat(source.fileno())
                module.require((info.st_dev, info.st_ino) == (opened.st_dev, opened.st_ino), 'native_log_changed')
                data = source.read(8193)
            print(json.dumps(dict(scope='isolated_native_npm_install_only', stream=name,
                truncated=len(data) > 8192, text=data[:8192].decode('utf-8', errors='replace'))), file=sys.stderr)
        except (OSError, module.StagingRefused):
            print(json.dumps(dict(scope='isolated_native_npm_install_only', stream=name, available=False)), file=sys.stderr)


def native_install(*, module=None, environment=None):
    """Qualify the exact future commit under the pinned Node/npm, in CI only.

    This intentionally does not call stage(), source_blob() or any other helper
    tied to /srv. Clone contents, npm tools and dependencies all live below one
    new private RUNNER_TEMP directory and are removed before returning.
    """
    m = load_helper() if module is None else module
    m.qualification_pins()
    env = os.environ if environment is None else environment
    m.require(env.get('CI') == env.get('GITHUB_ACTIONS') == 'true'
        and env.get('GITHUB_REPOSITORY') == 'fredbuhr/jessiemessage'
        and env.get('RUNNER_OS') == 'Linux' and env.get('RUNNER_ARCH') == 'X64', 'native_ci_context')
    temporary = Path(env.get('RUNNER_TEMP', ''))
    m.require(temporary.is_absolute() and not temporary.is_relative_to(Path('/srv'))
        and temporary.resolve(strict=True) == temporary and temporary.is_dir(), 'native_temporary_scope')
    previous_umask = os.umask(0o077)
    try:
        with tempfile.TemporaryDirectory(prefix='prepare1150-native-', dir=temporary) as directory:
            root = Path(directory); m.normalize_created_directory(root)
            checkout, tools = root / 'candidate', root / 'tools'
            m.absent(checkout)
            m.command(['/usr/bin/git', '--no-optional-locks', '-c', 'core.fsmonitor=false',
                '-c', 'core.hooksPath=/dev/null', 'clone', '--no-tags', '--no-checkout',
                '--no-recurse-submodules', 'https://github.com/fredbuhr/jessiemessage.git', str(checkout)], timeout=90)
            m.normalize_created_directory(checkout)
            m.git(checkout, 'checkout', '--detach', m.RELEASE_SOURCE)
            m.source(checkout, m.RELEASE_SOURCE, m.RELEASE_TREE)
            def blob(revision, name):
                entry = m.git(checkout, 'ls-tree', revision, '--', name)
                m.require(entry.startswith('100644 blob ') and entry.endswith('\t' + name), 'native_source_file')
                return m.command(['/usr/bin/git', '--no-optional-locks', '-c', 'core.fsmonitor=false',
                    '-c', 'core.hooksPath=/dev/null', '-C', str(checkout), 'show', revision + ':' + name])
            old_package, old_lock = blob(m.BASE_SOURCE, 'package.json'), blob(m.BASE_SOURCE, 'package-lock.json')
            m.require(m.fingerprint(old_lock) == m.BASE_LOCK_SHA, 'native_baseline_lock')
            package_bytes, lock_bytes = m.regular(checkout / 'package.json'), m.regular(checkout / 'package-lock.json')
            m.validate_lock_transition(json.loads(old_package), json.loads(old_lock), json.loads(package_bytes), json.loads(lock_bytes))
            m.require(not m.git(checkout, 'ls-tree', m.RELEASE_SOURCE, '--', 'node_modules', '.npmrc'), 'native_tracked_dependency_configuration')
            m.require(m.regular(checkout / m.CODEC_SMOKE_PATH, digest_only=True) == m.CODEC_SMOKE_SHA, 'native_smoke_source')
            archive = m.download_archive()
            m.make_private(tools)
            installer = m.extract_tools(archive, tools, include_node=True)
            node = tools / 'node'
            m.require(m.command([str(node), '--version'], timeout=10).decode().strip() == m.NODE_VERSION, 'native_node_version')
            try:
                installation = m.install_dependencies(checkout, tools, node, package_bytes, lock_bytes, node_pin=m.NODE_PIN)
            except Exception:
                native_failure_logs(m, root, tools)
                raise
            m.source(checkout, m.RELEASE_SOURCE, m.RELEASE_TREE)
            report = dict(status='prepare1150_native_install_passed', source=m.RELEASE_SOURCE, tree=m.RELEASE_TREE,
                nodeVersion=m.NODE_VERSION, nodeBinarySha256=m.NODE_PIN, npmVersion=installer['npmVersion'],
                installer=installer, dependencies=installation, codecSmokePassed=True, codecSmokeSha256=m.CODEC_SMOKE_SHA,
                productionPathsAccessed=False, checkExecuted=False, sqlExecuted=False, runtimeStarted=False,
                launchersWritten=False, checkpointChanged=False, syntheticDirectoryRemovedOnExit=True)
    finally:
        os.umask(previous_umask)
    return report


class NativeModeTests(unittest.TestCase):
    def test_pending_native_pins_stop_before_context_directory_process_or_network(self):
        m = load_helper()
        with mock.patch.object(m, 'private_directory', side_effect=AssertionError('no private path')), \
             mock.patch.object(m, 'command', side_effect=AssertionError('no process')), \
             mock.patch.object(m, 'download_archive', side_effect=AssertionError('no network')), \
             mock.patch.object(tempfile, 'TemporaryDirectory', side_effect=AssertionError('no output')):
            with self.assertRaisesRegex(m.StagingRefused, 'release1150_pins_pending'):
                native_install(module=m, environment={})

    def test_native_mode_requires_ci_and_refuses_production_temporary_scope(self):
        with Fixture() as f:
            good = dict(CI='true', GITHUB_ACTIONS='true', GITHUB_REPOSITORY='fredbuhr/jessiemessage',
                RUNNER_OS='Linux', RUNNER_ARCH='X64', RUNNER_TEMP=str(f.root))
            for change in ({'CI': 'false'}, {'GITHUB_ACTIONS': 'false'}, {'GITHUB_REPOSITORY': 'other/repository'},
                    {'RUNNER_OS': 'Windows'}, {'RUNNER_ARCH': 'ARM64'}, {'RUNNER_TEMP': '/srv'}):
                with self.subTest(change=change), mock.patch.object(f.module, 'command', side_effect=AssertionError('no process')):
                    with self.assertRaises(f.module.StagingRefused): native_install(module=f.module, environment=dict(good, **change))

    def test_native_orchestration_uses_exact_clone_and_private_tools_with_no_production_access(self):
        with Fixture() as f:
            m = f.module; calls = []; paths = {}
            archive = archive_bytes(m, extra=(m.ARCHIVE_ROOT + '/bin/node', f.node.read_bytes(), tarfile.REGTYPE))
            m.ARCHIVE_BYTES, m.ARCHIVE_SHA = len(archive), digest(archive)
            def command(args, **kwargs):
                calls.append(list(args))
                self.assertFalse(any('/srv/' in str(value) for value in args))
                if 'clone' in args:
                    self.assertIn('https://github.com/fredbuhr/jessiemessage.git', args)
                    checkout = Path(args[-1]); checkout.mkdir(mode=0o700); checkout.chmod(0o2700)
                    for (sha, name), data in f.blobs.items():
                        if sha == f.sha: write(checkout / name, data)
                    f.identities[checkout] = (f.sha, f.tree); paths['checkout'] = checkout
                    return b''
                if 'show' in args:
                    sha, name = args[-1].split(':', 1); return f.blobs[sha, name]
                if args[-1] == '--version': return b'v24.22.1\n'
                raise AssertionError(('unexpected native command', args))
            def git(checkout, *args):
                calls.append([str(checkout), *args])
                if args[:2] == ('checkout', '--detach'):
                    self.assertEqual(args[-1], f.sha); return ''
                if args[0] == 'ls-tree' and args[-1] in ('package.json', 'package-lock.json'):
                    return '100644 blob ' + '0' * 40 + '\t' + args[-1]
                return f.fake_git(checkout, *args)
            def run(args, **kwargs):
                calls.append(list(args)); checkout = paths['checkout']; tools = checkout.parent / 'tools'
                self.assertEqual(args[0], str(tools / 'node'))
                if args[1] == str(tools / 'npm/bin/npm-cli.js'):
                    self.assertEqual(args[2:6], ['ci', '--ignore-scripts', '--no-audit', '--no-fund'])
                    modules = checkout / 'node_modules'; modules.mkdir(mode=0o700)
                    for name, version in m.release_dependencies().items(): write(modules / name / 'package.json', m.canonical(dict(name=name, version=version)))
                    for name in m.OLD_CODEC_FILES: write(modules / 'libheif-js' / name, (f.deps / 'libheif-js' / name).read_bytes())
                    write(modules / 'synthetic-codec/codec.bin', f.codec)
                else:
                    self.assertEqual(args[1], str(checkout / m.CODEC_SMOKE_PATH))
                return types.SimpleNamespace(returncode=0, stdout=b'', stderr=b'')
            environment = dict(CI='true', GITHUB_ACTIONS='true', GITHUB_REPOSITORY='fredbuhr/jessiemessage',
                RUNNER_OS='Linux', RUNNER_ARCH='X64', RUNNER_TEMP=str(f.root))
            with mock.patch.object(m, 'command', side_effect=command), mock.patch.object(m, 'git', side_effect=git), \
                 mock.patch.object(m, 'download_archive', return_value=archive), mock.patch.object(m.subprocess, 'run', side_effect=run), \
                 mock.patch.object(m, 'stage', side_effect=AssertionError('no host stage')), \
                 mock.patch.object(m, 'source_blob', side_effect=AssertionError('no /srv source read')):
                report = native_install(module=m, environment=environment)
            self.assertEqual(report['source'], f.sha); self.assertEqual(report['tree'], f.tree)
            self.assertEqual(report['npmVersion'], '11.19.1'); self.assertTrue(report['codecSmokePassed'])
            self.assertFalse(report['productionPathsAccessed']); self.assertFalse(report['sqlExecuted'])
            self.assertFalse(paths['checkout'].parent.exists()); f.assert_preserved(self)
            self.assertTrue(any('ci' in call for call in calls))

    def test_native_diagnostics_are_bounded_and_reject_other_paths(self):
        m = load_helper()
        with tempfile.TemporaryDirectory(prefix='prepare1150-native-', dir=HERE.parent) as temporary:
            root = Path(temporary); root.chmod(0o700); tools = root / 'tools'; tools.mkdir(mode=0o700)
            write(tools / 'npm-stdout.log', b'x' * 9000); write(tools / 'npm-stderr.log', b'synthetic diagnostic')
            output = io.StringIO()
            with redirect_stderr(output): native_failure_logs(m, root, tools)
            records = [json.loads(line) for line in output.getvalue().splitlines()]
            self.assertEqual(len(records), 2); self.assertEqual(len(records[0]['text']), 8192)
            self.assertTrue(records[0]['truncated']); self.assertFalse(records[1]['truncated'])
            with self.assertRaisesRegex(m.StagingRefused, 'native_diagnostic_scope'): native_failure_logs(m, HERE.parent, tools)


if __name__ == '__main__':
    if sys.argv[1:] == ['--native-install']:
        try:
            print(json.dumps(native_install(), sort_keys=True))
        except Exception as error:
            print(json.dumps(dict(status='prepare1150_native_install_not_confirmed',
                code=str(error) if type(error).__name__ == 'StagingRefused' else 'native_install_not_confirmed',
                productionPathsAccessed=False, runtimeStarted=False)), file=sys.stderr)
            raise SystemExit(1)
    else:
        unittest.main(verbosity=2)
