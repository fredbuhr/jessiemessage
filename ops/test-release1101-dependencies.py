#!/usr/bin/env python3
"""Isolated dependency-copy and hostile-archive cases; no real network."""
import base64
import copy
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tarfile
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock

HERE = Path(__file__).resolve().parent


def load_dependencies():
    spec = importlib.util.spec_from_file_location('dependencies1101_test', HERE / 'release1101-dependencies.py')
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module


def package_pair(module):
    packages = []
    locks = []
    for version, leaf_version in (('1.10.0', '10.1.1'), ('1.10.1', '10.1.4')):
        dependencies = {'mariadb': '3.5.4', 'nodemailer': leaf_version}
        package = dict(name='jessiemessage', version=version, dependencies=dependencies)
        leaf = dict(version=leaf_version, resolved=module.URL if leaf_version == module.VERSION else 'https://registry.npmjs.org/nodemailer/-/nodemailer-10.1.1.tgz',
                    integrity=module.INTEGRITY if leaf_version == module.VERSION else 'synthetic-old-integrity', license='MIT-0', engines={'node': '>=20.0.0'})
        lock = dict(name='jessiemessage', version=version, lockfileVersion=3,
                    packages={'': dict(name='jessiemessage', version=version, dependencies=dependencies),
                              'node_modules/mariadb': dict(version='3.5.4'), 'node_modules/nodemailer': leaf})
        packages.append(package); locks.append(lock)
    return packages[0], locks[0], packages[1], locks[1]


def archive_content(*, entries=None, manifest=None):
    manifest = manifest or dict(name='nodemailer', version='10.1.4', engines={'node': '>=20.0.0'}, scripts={'prepare': 'npm run build'})
    if entries is None:
        entries = [('package/package.json', json.dumps(manifest).encode(), 'file'),
                   ('package/dist/cjs/nodemailer.js', b'module.exports = {synthetic:true};\n', 'file')]
    value = io.BytesIO()
    with tarfile.open(fileobj=value, mode='w:gz') as archive:
        for path, content, kind in entries:
            member = tarfile.TarInfo(path)
            if kind == 'file':
                member.size = len(content); archive.addfile(member, io.BytesIO(content))
            else:
                member.type = {'symlink': tarfile.SYMTYPE, 'hardlink': tarfile.LNKTYPE, 'fifo': tarfile.FIFOTYPE, 'directory': tarfile.DIRTYPE}[kind]
                if kind in ('symlink', 'hardlink'): member.linkname = str(content)
                archive.addfile(member)
    return value.getvalue()


def set_integrity(module, content):
    module.INTEGRITY = 'sha512-' + base64.b64encode(hashlib.sha512(content).digest()).decode()


class Fixture:
    def __init__(self):
        self.module = load_dependencies(); self.archive = archive_content(); set_integrity(self.module, self.archive)
        self.old_package, self.old_lock, self.new_package, self.new_lock = package_pair(self.module)
        self.temporary = tempfile.TemporaryDirectory(prefix='dependencies1101-', dir=HERE.parent)
        self.root = Path(self.temporary.name); self.source = self.root / 'old'; self.target = self.root / 'new'
        self.source.mkdir(mode=0o700)
        for name, version in self.old_package['dependencies'].items():
            directory = self.source / name; directory.mkdir(mode=0o755)
            (directory / 'package.json').write_text(json.dumps(dict(name=name, version=version)))
            (directory / 'unchanged.js').write_bytes(('private-copy synthetic ' + name).encode())
        (self.source / '.bin').mkdir(mode=0o755)
        (self.source / '.bin/synthetic').symlink_to('../mariadb/unchanged.js')
        hidden = copy.deepcopy(self.old_lock); hidden['version'] = '1.8.0'; hidden['packages'].pop('')
        (self.source / '.package-lock.json').write_text(json.dumps(hidden))
        self.before = self.module.dependency_inventory(self.source)

    def __enter__(self): return self
    def __exit__(self, *_): self.temporary.cleanup()
    def copy(self, **kwargs):
        return self.module.copy_dependencies(self.source, self.target, self.old_lock, self.new_lock, self.archive,
                 old_lock_bytes=json.dumps(self.old_lock).encode(), new_lock_bytes=json.dumps(self.new_lock).encode(), **kwargs)


class LockTests(unittest.TestCase):
    def test_exact_leaf_transition_accepts_and_does_not_mutate_lock_arguments(self):
        module = load_dependencies(); arguments = package_pair(module); before = copy.deepcopy(arguments)
        module.validate_lock_transition(*arguments)
        self.assertEqual(arguments, before)

    def test_extra_dependency_graph_change_is_refused(self):
        module = load_dependencies(); arguments = list(package_pair(module)); arguments[3]['packages']['node_modules/mariadb']['version'] = '999.0.0'
        with self.assertRaisesRegex(module.DependencyRefused, 'other_lock_changed'): module.validate_lock_transition(*arguments)

    def test_wrong_tarball_url_integrity_or_leaf_metadata_is_refused(self):
        for field, value in [('resolved', 'https://example.invalid/a.tgz'), ('integrity', 'sha512-bad'), ('version', '10.1.5'), ('dependencies', {'new-child': '1.0.0'})]:
            with self.subTest(field=field):
                module = load_dependencies(); arguments = list(package_pair(module)); arguments[3]['packages'][module.LEAF][field] = value
                with self.assertRaisesRegex(module.DependencyRefused, 'new_leaf'): module.validate_lock_transition(*arguments)

    def test_package_map_or_root_version_disagreement_is_refused(self):
        for kind in ('map', 'version'):
            with self.subTest(kind=kind):
                module = load_dependencies(); arguments = list(package_pair(module)); arguments[2] = copy.deepcopy(arguments[2])
                if kind == 'map': arguments[2]['dependencies']['mariadb'] = '999'
                else: arguments[2]['version'] = '1.10.0'
                with self.assertRaises(module.DependencyRefused): module.validate_lock_transition(*arguments)


class ArchiveTests(unittest.TestCase):
    def test_integrity_is_required_before_parsing_any_tar_member(self):
        module = load_dependencies(); content = archive_content()
        with mock.patch.object(module.tarfile, 'open', side_effect=AssertionError('must refuse before tar parsing')):
            with self.assertRaisesRegex(module.DependencyRefused, 'integrity'): module.archive_files(content)

    def test_bounded_archive_size_and_members(self):
        module = load_dependencies(); content = archive_content(); set_integrity(module, content)
        module.MAX_ARCHIVE = len(content) - 1
        with self.assertRaisesRegex(module.DependencyRefused, 'size'): module.archive_files(content)
        module.MAX_ARCHIVE = len(content); module.MAX_MEMBERS = 1
        with self.assertRaisesRegex(module.DependencyRefused, 'members'): module.archive_files(content)

    def test_paths_and_links_cannot_escape_extraction_root(self):
        for path, kind in [('../escaped', 'file'), ('/absolute', 'file'), ('package/../escaped', 'file'), ('package//same', 'file'), ('package/link', 'symlink'), ('package/link', 'hardlink'), ('package/pipe', 'fifo')]:
            with self.subTest(path=path, kind=kind):
                module = load_dependencies(); content = archive_content(entries=[(path, b'target' if kind == 'file' else '../elsewhere', kind)])
                set_integrity(module, content)
                with self.assertRaises(module.DependencyRefused): module.archive_files(content)

    def test_duplicate_paths_and_expansion_budget_are_refused(self):
        module = load_dependencies(); content = archive_content(entries=[('package/a', b'one', 'file'), ('package/a', b'two', 'file')]); set_integrity(module, content)
        with self.assertRaisesRegex(module.DependencyRefused, 'duplicate'): module.archive_files(content)
        content = archive_content(); set_integrity(module, content); module.MAX_EXPANDED = 4
        with self.assertRaisesRegex(module.DependencyRefused, 'expanded'): module.archive_files(content)

    def test_manifest_must_be_exact_leaf_without_install_scripts(self):
        for mutation in ({'name':'other'}, {'version':'10.1.5'}, {'dependencies':{'child':'1.0.0'}}, {'bin':'run.js'}, {'scripts':{'postinstall':'touch outside'}}):
            with self.subTest(mutation=mutation):
                manifest = dict(name='nodemailer', version='10.1.4', engines={'node':'>=20.0.0'}); manifest.update(mutation)
                module = load_dependencies(); content = archive_content(manifest=manifest); set_integrity(module, content)
                with self.assertRaises(module.DependencyRefused): module.archive_files(content)

    def test_development_prepare_script_is_never_executed(self):
        module = load_dependencies(); content = archive_content(); set_integrity(module, content)
        files = module.archive_files(content)
        self.assertEqual(len(files), 2)


class CopyTests(unittest.TestCase):
    def test_private_copy_changes_only_leaf_and_hidden_lock_preserving_old_bytes(self):
        with Fixture() as fixture:
            prior_umask = os.umask(0o077)
            try: receipt = fixture.copy()
            finally: os.umask(prior_umask)
            module = fixture.module
            self.assertEqual(module.dependency_inventory(fixture.source), fixture.before)
            self.assertFalse(fixture.target.is_symlink()); self.assertEqual(fixture.target.stat().st_mode & 0o777, 0o700)
            self.assertEqual((fixture.target / 'mariadb/unchanged.js').read_bytes(), (fixture.source / 'mariadb/unchanged.js').read_bytes())
            self.assertNotEqual((fixture.target / 'mariadb/unchanged.js').stat().st_ino, (fixture.source / 'mariadb/unchanged.js').stat().st_ino)
            self.assertEqual(os.readlink(fixture.target / '.bin/synthetic'), '../mariadb/unchanged.js')
            self.assertEqual(json.loads((fixture.target / 'nodemailer/package.json').read_text())['version'], '10.1.4')
            hidden = json.loads((fixture.target / '.package-lock.json').read_text())
            self.assertEqual(hidden['version'], '1.10.1'); self.assertEqual(hidden['packages'][module.LEAF], fixture.new_lock['packages'][module.LEAF])
            self.assertEqual(receipt['oldTreeSha256'], fixture.before['sha256'])
            self.assertEqual(receipt['newTreeSha256'], module.dependency_inventory(fixture.target)['sha256'])

    def test_no_space_refuses_before_any_target_creation(self):
        with Fixture() as fixture:
            with self.assertRaisesRegex(fixture.module.DependencyRefused, 'disk_space'): fixture.copy(disk_usage=lambda _: SimpleNamespace(free=0))
            self.assertFalse(fixture.target.exists()); self.assertEqual(fixture.module.dependency_inventory(fixture.source), fixture.before)

    def test_existing_output_and_dangling_target_are_preserved(self):
        for kind in ('directory', 'symlink'):
            with self.subTest(kind=kind), Fixture() as fixture:
                if kind == 'directory': fixture.target.mkdir()
                else: fixture.target.symlink_to(fixture.root / 'absent')
                before = fixture.target.lstat()
                with self.assertRaisesRegex(fixture.module.DependencyRefused, 'target_exists'): fixture.copy()
                self.assertEqual(before.st_ino, fixture.target.lstat().st_ino)

    def test_external_symlink_and_special_file_are_refused_without_target(self):
        for kind in ('absolute', 'escaping', 'fifo'):
            with self.subTest(kind=kind), Fixture() as fixture:
                bad = fixture.source / 'bad'
                if kind == 'fifo': os.mkfifo(bad, 0o600)
                else: bad.symlink_to('/tmp' if kind == 'absolute' else '../')
                with self.assertRaises(fixture.module.DependencyRefused): fixture.copy()
                self.assertFalse(fixture.target.exists())

    def test_old_installed_manifest_mismatch_is_refused(self):
        with Fixture() as fixture:
            (fixture.source / 'nodemailer/package.json').write_text('{"name":"nodemailer","version":"99.0.0"}')
            with self.assertRaisesRegex(fixture.module.DependencyRefused, 'installed_version'): fixture.copy()
            self.assertFalse(fixture.target.exists())

    def test_source_change_during_copy_is_detected_and_not_repaired(self):
        with Fixture() as fixture:
            original = fixture.module.read_stable; count = 0
            def changed(path):
                nonlocal count
                if path == fixture.source / 'mariadb/unchanged.js':
                    count += 1
                    if count == 2: path.write_bytes(b'changed externally')
                return original(path)
            with mock.patch.object(fixture.module, 'read_stable', side_effect=changed):
                with self.assertRaisesRegex(fixture.module.DependencyRefused, 'copy_changed'): fixture.copy()
            self.assertEqual((fixture.source / 'mariadb/unchanged.js').read_bytes(), b'changed externally')

    def test_unexpected_hidden_lock_record_refuses_before_copy(self):
        with Fixture() as fixture:
            path = fixture.source / '.package-lock.json'; value = json.loads(path.read_text())
            value['packages']['node_modules/unknown'] = {'version':'1.0.0'}; path.write_text(json.dumps(value))
            with self.assertRaisesRegex(fixture.module.DependencyRefused, 'hidden_record'): fixture.copy()
            self.assertFalse(fixture.target.exists())


if __name__ == '__main__': unittest.main(verbosity=2)
