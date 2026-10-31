"""Disposable checkpoint fixtures; never accesses the private host path."""
import contextlib
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock

HERE = Path(__file__).resolve().parent


def helper():
    import types
    spec = importlib.util.spec_from_file_location('access1113_embedded_test', HERE / 'inspect-access1113.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    baseline = types.ModuleType("embedded_baseline_test")
    exec(compile(module.BASELINE_MODULE, "<embedded-baseline-test>", "exec"), baseline.__dict__)
    return baseline

class Baseline(unittest.TestCase):
    def setUp(self):
        self.m = helper()
        self.temp = tempfile.TemporaryDirectory(prefix='jm1120-baseline-test-')
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'checkpoint.json'
        self.uid = os.getuid()

    def document(self, release='1.11.2'):
        source, tree = self.m.IDENTITIES[release]
        value = dict(activeService=dict(release=release, source=source, tree=tree,
            nodeAfterDeployment='v24.22.1', schemaMigrations=38, confidentialExtension='synthetic secret do not print'),
            developmentSimplification=dict(release1112={'history': ['synthetic preserved data']}),
            anotherBlock=dict(email='synthetic@example.invalid', secret='never exported'))
        if release == '1.11.3':
            value['developmentSimplification']['release1113'] = dict(priorCheckpointSha256='3f1ae16dbadcee48643cbd2c0435b3eb5d36870cf72aa26cd080b5a0ac2f400f',
                priorActiveService={'preserved': 'synthetic history'}, evidence={'secret': 'never exported'})
        return value

    def write(self, value, pretty=False):
        raw = (json.dumps(value, ensure_ascii=False, indent=2 if pretty else None) + '\n').encode()
        self.path.write_bytes(raw)
        self.path.chmod(0o600)
        return raw

    def inspect(self):
        return self.m.read(self.path, self.uid)

    def assert_narrow(self, result, raw):
        expected = {'format', 'version', 'status', 'noPersistentWrite', 'checkpointSha256', 'activeService', 'release1113MetadataPresent'}
        if result['release1113MetadataPresent']:
            expected.add('priorCheckpointSha256')
        self.assertEqual(set(result), expected)
        self.assertEqual(set(result['activeService']), {'release', 'source', 'tree', 'nodeAfterDeployment', 'schemaMigrations'})
        self.assertEqual(result['checkpointSha256'], hashlib.sha256(raw).hexdigest())
        self.assertTrue(result['noPersistentWrite'])
        rendered = json.dumps(result)
        for private in ('confidentialExtension', 'synthetic@example.invalid', 'never exported', 'preserved data'):
            self.assertNotIn(private, rendered)
        self.assertEqual(self.path.read_bytes(), raw)

    def test_valid_1112_compact_bytes_preserved_and_only_read_flags(self):
        raw = self.write(self.document())
        before = self.path.stat()
        original = self.m.os.open
        calls = []
        def open_read(path, flags, *args, **kwargs):
            calls.append(flags)
            return original(path, flags, *args, **kwargs)
        with mock.patch.object(self.m.os, 'open', side_effect=open_read):
            result = self.inspect()
        self.assertEqual(calls, [os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK])
        self.assertEqual(result['activeService']['release'], '1.11.2')
        self.assertFalse(result['release1113MetadataPresent'])
        self.assert_narrow(result, raw)
        after = self.path.stat()
        self.assertEqual((before.st_mode, before.st_uid, before.st_size, before.st_mtime_ns, before.st_ctime_ns),
            (after.st_mode, after.st_uid, after.st_size, after.st_mtime_ns, after.st_ctime_ns))

    def test_valid_1112_pretty_unicode_keeps_exact_original_hash(self):
        value = self.document()
        value['anotherBlock']['secret'] = 'Données synthétiques privées ↵'
        raw = self.write(value, pretty=True)
        result = self.inspect()
        self.assert_narrow(result, raw)
        self.assertNotIn('Données', json.dumps(result, ensure_ascii=False))

    def test_valid_1113_metadata_returns_only_prior_hex_digest(self):
        value = self.document('1.11.3')
        raw = self.write(value, pretty=True)
        result = self.inspect()
        self.assertTrue(result['release1113MetadataPresent'])
        self.assertEqual(result['priorCheckpointSha256'], value['developmentSimplification']['release1113']['priorCheckpointSha256'])
        self.assert_narrow(result, raw)

    def test_permissions_owner_oversize_and_hardlinks_refused_without_change(self):
        raw = self.write(self.document())
        for mode in (0o644, 0o400, 0o700):
            with self.subTest(mode=mode):
                self.path.chmod(mode)
                with self.assertRaises(self.m.InspectionRefused):
                    self.inspect()
                self.assertEqual(self.path.read_bytes(), raw)
        self.path.chmod(0o600)
        with self.assertRaises(self.m.InspectionRefused):
            self.m.read(self.path, self.uid + 1)
        linked = self.path.parent / 'other-link.json'
        os.link(self.path, linked)
        with self.assertRaises(self.m.InspectionRefused):
            self.inspect()
        linked.unlink()
        self.path.write_bytes(b' ' * (self.m.LIMIT + 1))
        with self.assertRaises(self.m.InspectionRefused):
            self.inspect()

    def test_symlink_and_non_regular_files_refused_without_read(self):
        self.write(self.document())
        link = self.path.parent / 'link.json'
        link.symlink_to(self.path)
        with self.assertRaises(self.m.InspectionRefused):
            self.m.read(link, self.uid)
        directory = self.path.parent / 'directory.json'
        directory.mkdir(mode=0o600)
        with self.assertRaises(self.m.InspectionRefused):
            self.m.read(directory, self.uid)
        fifo = self.path.parent / 'pipe.json'
        os.mkfifo(fifo, mode=0o600)
        with self.assertRaises(self.m.InspectionRefused):
            self.m.read(fifo, self.uid)

    def test_every_unexpected_active_identity_is_refused(self):
        for key, bad in [('release', '1.12.0'), ('source', '0' * 40), ('tree', '0' * 40),
                ('nodeAfterDeployment', 'v24.22.0'), ('schemaMigrations', 37), ('schemaMigrations', True)]:
            with self.subTest(key=key, value=bad):
                value = self.document()
                value['activeService'][key] = bad
                raw = self.write(value)
                with self.assertRaises(self.m.InspectionRefused):
                    self.inspect()
                self.assertEqual(self.path.read_bytes(), raw)

    def test_invalid_metadata_or_hash_cannot_be_exported(self):
        for section in (None, 'secret', {'priorCheckpointSha256': 'secret'},
                {'priorCheckpointSha256': 'A' * 64}, {'priorCheckpointSha256': 123}):
            with self.subTest(section=section):
                value = self.document('1.11.3')
                value['developmentSimplification']['release1113'] = section
                self.write(value)
                with self.assertRaises(self.m.InspectionRefused):
                    self.inspect()

    def test_invalid_duplicate_or_non_finite_json_is_refused(self):
        valid = self.write(self.document())
        for raw in (b'{', b'[]', b'{"activeService":{},"activeService":{}}',
                valid.replace(b'"anotherBlock": {', b'"nonFinite": NaN, "anotherBlock": {')):
            with self.subTest(raw=raw[:50]):
                self.path.write_bytes(raw)
                with self.assertRaises(self.m.InspectionRefused):
                    self.inspect()

    def test_changed_lstat_metadata_is_refused(self):
        self.write(self.document())
        original = self.m.Path.lstat
        calls = 0
        def changed(path):
            nonlocal calls
            value = original(path)
            if path == self.path:
                calls += 1
                if calls >= 2:
                    fields = {name: getattr(value, name) for name in ('st_dev', 'st_ino', 'st_mode', 'st_uid', 'st_nlink', 'st_size', 'st_mtime_ns', 'st_ctime_ns')}
                    fields['st_mtime_ns'] += 1
                    return type('ChangedMetadata', (), fields)()
            return value
        with mock.patch.object(self.m.Path, 'lstat', changed):
            with self.assertRaises(self.m.InspectionRefused):
                self.inspect()

    def test_cli_success_prints_narrow_json_and_errors_are_fixed(self):
        raw = self.write(self.document('1.11.3'))
        with mock.patch.object(self.m, 'CHECKPOINT_PATH', self.path), contextlib.redirect_stdout(io.StringIO()) as output:
            self.assertEqual(self.m.main([]), 0)
        self.assert_narrow(json.loads(output.getvalue()), raw)
        for arguments in (['unexpected-sensitive-argument'], []):
            with mock.patch.object(self.m, 'read', side_effect=OSError('private path /secret + exception')), contextlib.redirect_stdout(io.StringIO()) as output:
                self.assertEqual(self.m.main(arguments), 1)
            value = json.loads(output.getvalue())
            self.assertEqual(value, dict(format=self.m.FORMAT, version=1, status='release1120_baseline_unconfirmed', noPersistentWrite=True, code='BASELINE_CHECK_FAILED'))
            self.assertNotIn('/secret', output.getvalue())


if __name__ == '__main__':
    unittest.main(verbosity=2)
