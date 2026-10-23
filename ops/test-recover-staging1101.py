#!/usr/bin/env python3
"""Targeted recovery tests on disposable local files and Git; no hosted access."""
import hashlib
from contextlib import nullcontext
import importlib.util
import json
import os
from pathlib import Path
import stat
import tempfile
import unittest
from unittest import mock
import uuid

HERE = Path(__file__).resolve().parent
TARGET = HERE / 'recover-staging1101.py'


def module_at(path):
    spec = importlib.util.spec_from_file_location('recovery1101_' + uuid.uuid4().hex, path)
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module


def support(name):
    path = HERE / name
    if not path.is_file(): path = HERE.parents[1] / 'ops' / name
    return module_at(path)


def load():
    with mock.patch('subprocess.run', side_effect=AssertionError('no process on import')), \
            mock.patch('urllib.request.build_opener', side_effect=AssertionError('no network on import')):
        return module_at(TARGET)


def snapshot(directory):
    result = {}
    for path in [directory, *sorted(directory.rglob('*'))]:
        info = path.lstat(); relative = '.' if path == directory else path.relative_to(directory).as_posix()
        base = (stat.S_IMODE(info.st_mode), info.st_nlink)
        if path.is_symlink(): result[relative] = ('link', *base, os.readlink(path))
        elif path.is_file(): result[relative] = ('file', *base, hashlib.sha256(path.read_bytes()).hexdigest())
        else: result[relative] = ('directory', *base)
    return result


def dependency_arguments(fixture):
    return (fixture.source, fixture.target, fixture.old_lock, fixture.new_lock,
        json.dumps(fixture.old_lock).encode(), json.dumps(fixture.new_lock).encode(), fixture.archive, fixture.module)


def inherited_copy(fixture):
    fixture.root.chmod(0o2700)
    previous = os.umask(0o077)
    try: return fixture.copy()
    finally: os.umask(previous)


class Recovery(unittest.TestCase):
    def test_real_sgid_parent_inheritance_is_normalized_only_through_descriptor(self):
        module = load()
        with tempfile.TemporaryDirectory(prefix='recovery1101-sgid-') as directory:
            parent = Path(directory); parent.chmod(0o2700)
            target = parent/'new'; target.mkdir(mode=0o700)
            self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o2700)
            sentinel = target/'unchanged'; sentinel.write_bytes(b'synthetic unchanged bytes'); sentinel.chmod(0o600)
            before = snapshot(target); expected = target.lstat()
            actual = os.fchmod
            with mock.patch.object(module.os, 'fchmod', wraps=actual) as chmod:
                module.normalize_root(target, expected)
            self.assertEqual(chmod.call_count, 1); self.assertEqual(chmod.call_args.args[1], 0o700)
            after = snapshot(target); expected_snapshot = dict(before); expected_snapshot['.'] = ('directory', 0o700, before['.'][2])
            self.assertEqual(after, expected_snapshot)

    def test_complete_dependency_validation_preserves_both_trees(self):
        module = load(); fixtures = support('test-release1101-dependencies.py')
        with fixtures.Fixture() as fixture:
            trace = inherited_copy(fixture)
            self.assertEqual(stat.S_IMODE(fixture.target.stat().st_mode), 0o2700)
            before_old, before_new = snapshot(fixture.source), snapshot(fixture.target)
            receipt = module.validate_dependencies(*dependency_arguments(fixture))
            self.assertEqual(receipt, trace)
            self.assertEqual(snapshot(fixture.source), before_old); self.assertEqual(snapshot(fixture.target), before_new)

    def test_leaf_outside_hidden_hardlink_and_bad_archive_refuse_without_mutation(self):
        module = load(); fixtures = support('test-release1101-dependencies.py')
        for fault in ('leaf', 'outside', 'hidden', 'hardlink', 'archive'):
            with self.subTest(fault=fault), fixtures.Fixture() as fixture:
                inherited_copy(fixture)
                if fault == 'leaf': (fixture.target/'nodemailer/dist/cjs/nodemailer.js').write_bytes(b'changed leaf bytes')
                elif fault == 'outside': (fixture.target/'mariadb/unchanged.js').write_bytes(b'changed outside leaf')
                elif fault == 'hidden':
                    path=fixture.target/'.package-lock.json'; value=json.loads(path.read_text()); value['version']='999.0.0'; path.write_text(json.dumps(value))
                elif fault == 'hardlink':
                    path=fixture.target/'mariadb/unchanged.js'; path.unlink(); os.link(fixture.source/'mariadb/unchanged.js',path)
                else: fixture.archive = bytes([fixture.archive[0] ^ 1]) + fixture.archive[1:]
                before_old, before_new = snapshot(fixture.source), snapshot(fixture.target)
                with mock.patch.object(module.os,'fchmod',side_effect=AssertionError('validation never changes modes')):
                    with self.assertRaises((module.RecoveryRefused, fixture.module.DependencyRefused)):
                        module.validate_dependencies(*dependency_arguments(fixture))
                self.assertEqual(snapshot(fixture.source), before_old); self.assertEqual(snapshot(fixture.target), before_new)

    def test_wrong_or_changed_root_refuses_without_chmod(self):
        module = load()
        for fault in ('already700', 'replaced'):
            with self.subTest(fault=fault), tempfile.TemporaryDirectory(prefix='recovery1101-root-') as directory:
                parent=Path(directory); parent.chmod(0o2700); target=parent/'new'; target.mkdir(mode=0o700)
                expected=target.lstat()
                if fault=='already700': target.chmod(0o700); expected=target.lstat()
                else: target.rename(parent/'preserved'); target.mkdir(mode=0o700)
                before=snapshot(parent)
                with mock.patch.object(module.os,'fchmod',side_effect=AssertionError('invalid root must precede chmod')):
                    with self.assertRaises(module.RecoveryRefused): module.normalize_root(target,expected)
                self.assertEqual(snapshot(parent),before)

    def partial_fixture(self):
        fixture = support('test-prepare-release1101.py').Fixture()
        self.addCleanup(fixture.temporary.cleanup)
        fixture.operator.chmod(0o2700)
        with self.assertRaisesRegex(fixture.module.StagingRefused, '^private_directory$'): fixture.stage()
        plan=fixture.module.release_plan(*fixture.arguments)
        self.assertEqual(stat.S_IMODE((plan['checkout']/'node_modules').stat().st_mode),0o2700)
        self.assertFalse((fixture.private/'jm1101-staging.json').exists())
        return fixture,plan

    def patch_scope(self,module,fixture):
        values={}
        for name,value in {'SOURCE':fixture.sha1101,'TREE':fixture.tree1101,'BASE':fixture.base_sha,'PRIVATE':fixture.private,
            'CHECKOUT':fixture.base}.items():
            if hasattr(module,name): values[name]=value
        return mock.patch.multiple(module,**values) if values else nullcontext()

    def test_valid_recovery_changes_only_new_root_mode_and_writes_receipt(self):
        module=load(); fixture,plan=self.partial_fixture(); target=plan['checkout']/'node_modules'
        before_old=snapshot(fixture.deps); before_new=snapshot(target)
        before_private={path.name:path.read_bytes() for path in fixture.private.iterdir() if path.is_file()}
        with self.patch_scope(module,fixture):
            result=module.recover(tools=(fixture.module,fixture.dependency_helper),archive=fixture.archive)
        self.assertEqual(stat.S_IMODE(target.stat().st_mode),0o700)
        after=snapshot(target); expected=dict(before_new); expected['.']=('directory',0o700,before_new['.'][2]); self.assertEqual(after,expected)
        self.assertEqual(snapshot(fixture.deps),before_old)
        receipt=fixture.private/'jm1101-staging.json'; self.assertTrue(receipt.is_file())
        self.assertEqual(stat.S_IMODE(receipt.stat().st_mode),0o600); self.assertEqual(receipt.stat().st_nlink,1)
        stored=json.loads(receipt.read_text()); self.assertEqual(stored['source'],fixture.sha1101); self.assertEqual(stored['tree'],fixture.tree1101)
        self.assertFalse(stored['runtimeStarted']); self.assertFalse(stored['migrated']); self.assertTrue(stored['noRestart'])
        for name,content in before_private.items(): self.assertEqual((fixture.private/name).read_bytes(),content)
        self.assertEqual({p.name for p in fixture.private.iterdir() if p.is_file()},set(before_private)|{'jm1101-staging.json'})
        fixture.assert_preserved(self)

    def test_changed_active_pin_refuses_before_root_or_receipt_mutation(self):
        module=load(); fixture,plan=self.partial_fixture(); target=plan['checkout']/'node_modules'
        fixture.module.START_PIN='0'*64
        before_old,before_new=snapshot(fixture.deps),snapshot(target)
        with self.patch_scope(module,fixture),mock.patch.object(module.os,'fchmod',side_effect=AssertionError('bad pins precede chmod')):
            with self.assertRaises((module.RecoveryRefused,fixture.module.StagingRefused,fixture.dependency_helper.DependencyRefused)):
                module.recover(tools=(fixture.module,fixture.dependency_helper),archive=fixture.archive)
        self.assertEqual(snapshot(fixture.deps),before_old); self.assertEqual(snapshot(target),before_new)
        self.assertFalse((fixture.private/'jm1101-staging.json').exists()); fixture.assert_preserved(self)


if __name__=='__main__': unittest.main(verbosity=2)
