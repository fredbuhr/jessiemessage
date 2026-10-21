#!/usr/bin/env python3
"""Synthetic metadata recording tests only: no production files, SQL or service."""
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parent
HELPER = ROOT / 'record-release130.py'
RECORDED_AT = '2026-10-20T23:55:00Z'

# Frozen literal of the 1.2.0 CURRENT_ACTIVE qualified before this helper.
# The published suite imports only record-release130.py; historic writers are
# neither required nor executed. Legacy sections below are inert synthetic data.
ACTIVE120_FIXTURE = {'source': '763b632185ce13eb875110c9107687b2d278ff67',
 'tree': 'c7dce7bcdb99b298ffc43c9e31dd22ee87453926',
 'checkout': '/srv/customer/jessiemessage-operator/production-120-763b6321',
 'launcher': '/srv/customer/jessiemessage-private/start-primary-release120-763b6321.sh',
 'launcherSha256': 'f846b72a252b69d881264da76b60025325b4e2262ef3a850f1f58ec61f5da84f',
 'checkLauncher': '/srv/customer/jessiemessage-private/check-primary-release120-763b6321.sh',
 'checkLauncherSha256': 'b5e7a6ef89c3fca613944757699ecb26b80a53838234fb84302ef1466fff3810',
 'log': '/srv/customer/jessiemessage-private/jm120-node2422.log',
 'release': '1.2.0',
 'nodeAfterDeployment': 'v24.22.0',
 'schemaMigrations': 31,
 'mode': 'start-local-closures',
 'closuresEnabled': True,
 'port': 3000,
 'launcherMode': '0700',
 'logMode': '0600',
 'status': 'identity_verified_via_admin_report',
 'evidence': {'provenance': 'admin_readiness_user_report',
              'reportedStartedAtDisplay': '21/10/2026 00:21:24',
              'schemaEvidence': 'operator_reported_schema31_prechecks_passed',
              'limitations': ['pid_not_qualified',
                              'socket_not_qualified',
                              'executed_binary_hash_not_qualified',
                              'runtime_private_configs_not_qualified',
                              'pc_not_qualified',
                              'backups_not_qualified',
                              'reported_start_time_timezone_and_epoch_not_supplied']}}



def load_recorder(path=HELPER, name='release130_recorder_under_test'):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class RecorderTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.recorder = load_recorder()

    def document(self):
        # Synthetic snapshots exercise opaque preservation of every legacy
        # release and extension. Their writers are intentionally not imported.
        active = copy.deepcopy(ACTIVE120_FIXTURE)
        active.update(operatorExtension={'nested': ['keep120', {'all': True}]},
                      legacyUnknown='complete 1.2.0 prior active fixture')
        prior110 = {'source': '84669ed570b59b10a1a94a164f24f0e60e6cb5a7',
                    'release': '1.1.0', 'nodeAfterDeployment': 'v24.22.0',
                    'operatorExtension': {'nested': ['keep110', {'all': True}]}}
        rollback111 = {'source': 'cfa7dd3559e51c0fdc63ccc6fbc78d98609b947a',
                       'release': '1.1.1', 'schemaMigrations': 31,
                       'status': 'hosted_precheck_passed_not_started', 'identityVerified': False}
        return {
            'activeService': active,
            'developmentSimplification': {
                'release100': {'status': 'identity_verified_via_admin_report',
                               'recordedAt': '2026-10-20T21:20:00Z',
                               'rollback': {'release': '0.86.0', 'historicalExtension': {'retained': 'synthetic historical rollback'}},
                               'rollbackSha256': 'a' * 64, 'unknown100': {'nested': ['keep100']}},
                'release110': {'status': 'identity_verified_via_admin_report',
                               'recordedAt': '2026-10-20T21:30:00Z',
                               'rollback': {'release': '1.0.0', 'legacyUnknown': 'keep all legacy fields'},
                               'rollbackSha256': 'b' * 64},
                'release120': {'status': 'identity_verified_via_admin_report',
                               'recordedAt': '2026-10-20T22:25:00Z',
                               'priorActiveService': prior110, 'priorActiveServiceSha256': 'c' * 64,
                               'priorActiveServiceUsableRollback': False,
                               'rollback': rollback111, 'rollbackSha256': 'd' * 64,
                               'reportedStartedAtDisplay': '21/10/2026 00:21:24',
                               'unknownLegacyEvidence': {'retained': [None, False, 7.5]}},
                'unrelatedRelease': {'status': 'unchanged', 'nested': [1, 2, {'x': 'y'}]},
                'unknownExtension': None,
            },
            'unknownRoot': {'operators': ['synthetic-only'], 'value': 7.5},
            'backupEvidence': {'qualified': False, 'opaque': 'preserve-verbatim-value'},
        }

    def write_checkpoint(self, root, name='checkpoint.json'):
        path = root / name
        original = (json.dumps(self.document(), ensure_ascii=False, indent=3) + '\n').encode()
        path.write_bytes(original)
        path.chmod(0o600)
        return path, original

    def test_preserves_full_prior120_and_all_historical_sections(self):
        before = self.document()
        document = copy.deepcopy(before)
        updated, already = self.recorder.prepare(document, RECORDED_AT)
        self.assertFalse(already)
        self.assertEqual(document, before)
        self.assertEqual(updated['activeService'], self.recorder.CURRENT_ACTIVE)
        section = updated['developmentSimplification']['release130']
        for historical in ('release120', 'release110', 'release100', 'unrelatedRelease', 'unknownExtension'):
            self.assertEqual(updated['developmentSimplification'][historical],
                             before['developmentSimplification'][historical])
        self.assertEqual(section['priorActiveService'], before['activeService'])
        self.assertEqual(section['priorActiveService']['release'], '1.2.0')
        self.assertTrue(section['priorActiveServiceUsableRollback'])
        self.assertEqual(section['priorActiveServiceSha256'], self.recorder.rollback_digest(before['activeService']))
        self.assertEqual(section['rollback'], before['activeService'])
        self.assertEqual(section['rollbackSha256'], self.recorder.rollback_digest(before['activeService']))
        self.assertEqual(section['recordedAt'], RECORDED_AT)
        self.assertEqual(section['reportedStartedAtDisplay'], '21/10/2026 01:50:02')
        self.assertIn('reported_start_time_timezone_and_epoch_not_supplied', section['limitations'])
        restored = copy.deepcopy(updated)
        restored['activeService'] = before['activeService']
        del restored['developmentSimplification']['release130']
        self.assertEqual(restored, before)
        updated['activeService']['evidence']['limitations'].append('synthetic mutation')
        self.assertNotIn('synthetic mutation', self.recorder.EVIDENCE['limitations'])

    def test_old_identity_is_exact_record120_and_full_120_remains_usable_rollback(self):
        self.assertEqual(self.recorder.OLD_ACTIVE, ACTIVE120_FIXTURE)
        self.assertEqual(self.recorder.ROLLBACK, ACTIVE120_FIXTURE)
        before = self.document()
        updated, _ = self.recorder.prepare(before, RECORDED_AT)
        section = updated['developmentSimplification']['release130']
        rollback = section['rollback']
        self.assertEqual(rollback, before['activeService'])
        self.assertEqual(rollback, section['priorActiveService'])
        self.assertEqual(rollback['release'], '1.2.0')
        self.assertEqual(rollback['source'], '763b632185ce13eb875110c9107687b2d278ff67')
        self.assertEqual(rollback['tree'], 'c7dce7bcdb99b298ffc43c9e31dd22ee87453926')
        self.assertEqual(rollback['schemaMigrations'], 31)
        self.assertEqual(rollback['evidence']['reportedStartedAtDisplay'], '21/10/2026 00:21:24')
        self.assertEqual(rollback['evidence'], ACTIVE120_FIXTURE['evidence'])
        self.assertEqual(rollback['operatorExtension'], before['activeService']['operatorExtension'])
        self.assertTrue(section['priorActiveServiceUsableRollback'])
        self.assertEqual(updated['activeService']['release'], '1.3.0')
        self.assertEqual(updated['activeService']['source'], 'afd0e98cdb4027ac4cb444ddb05afeda0a84fb6b')
        self.assertEqual(updated['activeService']['tree'], '37b3b2e9358972c95581fc0bcf16896e4074d5f9')
        self.assertEqual(updated['activeService']['schemaMigrations'], 31)

    def test_wrong_prior_identity_or_existing_section_refused_without_mutation(self):
        for key, value in [('source', 'a' * 40), ('tree', 'b' * 40), ('release', '1.0.0')]:
            with self.subTest(prior=key):
                document = self.document(); document['activeService'][key] = value
                before = copy.deepcopy(document)
                with self.assertRaisesRegex(self.recorder.RecordError, 'OLD_IDENTITY'):
                    self.recorder.prepare(document, RECORDED_AT)
                self.assertEqual(document, before)
        document = self.document(); document['developmentSimplification']['release130'] = {}
        with self.assertRaisesRegex(self.recorder.RecordError, 'EXISTING_SECTION'):
            self.recorder.prepare(document, RECORDED_AT)

    def test_existing_section_rejects_tampered_rollback_prior_and_attestations(self):
        prepared, _ = self.recorder.prepare(self.document(), RECORDED_AT)
        mutations = [
            ('rollback', 'source', 'a' * 40), ('rollback', 'tree', 'b' * 40),
            ('rollback', 'launcherSha256', 'c' * 64), ('rollback', 'schemaMigrations', 30),
            ('rollback', 'release', '1.1.0'), ('rollback', 'status', 'unconfirmed'),
            ('rollback', 'identityVerified', True),
            ('priorActiveService', 'legacyUnknown', 'unexpected prior drift'),
            (None, 'priorActiveServiceSha256', 'd' * 64),
            (None, 'rollbackSha256', 'e' * 64), (None, 'priorActiveServiceUsableRollback', False),
            (None, 'priorActiveServiceUsableRollback', 1),
            (None, 'reportedStartedAtDisplay', 'unexpected date'),
        ]
        for nested, key, value in mutations:
            with self.subTest(nested=nested, key=key):
                document = copy.deepcopy(prepared)
                section = document['developmentSimplification']['release130']
                (section if nested is None else section[nested])[key] = value
                before = copy.deepcopy(document)
                with self.assertRaisesRegex(self.recorder.RecordError, 'EXISTING_SECTION_DIVERGENT'):
                    self.recorder.prepare(document, RECORDED_AT)
                self.assertEqual(document, before)
        document = copy.deepcopy(prepared)
        document['activeService']['evidence']['reportedStartedAtDisplay'] = 'altered active evidence'
        with self.assertRaisesRegex(self.recorder.RecordError, 'EXISTING_SECTION_DIVERGENT'):
            self.recorder.prepare(document, RECORDED_AT)
        document = copy.deepcopy(prepared)
        document['activeService']['closuresEnabled'] = 1
        with self.assertRaisesRegex(self.recorder.RecordError, 'EXISTING_SECTION_DIVERGENT'):
            self.recorder.prepare(document, RECORDED_AT)

    def test_second_record_idempotent_without_inode_mtime_or_bytes_change(self):
        with tempfile.TemporaryDirectory(dir=ROOT, prefix='record-release130-fixture-') as temporary:
            path, _ = self.write_checkpoint(Path(temporary))
            with mock.patch.object(self.recorder, 'verify_pins') as pins:
                first = self.recorder.record(path)
                self.assertEqual(first['status'], 'release130_metadata_recorded')
                self.assertEqual(first['rollbackRelease'], '1.2.0')
                self.assertEqual(first['schemaMigrations'], 31)
                self.assertTrue(first['metadataOnly'] and first['noRestart'])
                self.assertTrue(first['priorActivePreserved'] and first['otherBlocksPreserved'])
                self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
                before, original = path.stat(), path.read_bytes()
                with mock.patch.object(self.recorder.os, 'replace') as replace:
                    second = self.recorder.record(path)
                replace.assert_not_called()
                self.assertEqual(second['status'], 'release130_metadata_already_recorded')
                self.assertEqual(path.read_bytes(), original)
                self.assertEqual((before.st_dev, before.st_ino, before.st_mtime_ns),
                                 (path.stat().st_dev, path.stat().st_ino, path.stat().st_mtime_ns))
                self.assertEqual(pins.call_count, 2)

    def test_replace_failure_and_concurrent_drift_preserve_original_bytes(self):
        with tempfile.TemporaryDirectory(dir=ROOT, prefix='record-release130-fixture-') as temporary:
            root = Path(temporary)
            path, original = self.write_checkpoint(root, 'replace-failure.json')
            inode = path.stat().st_ino
            with mock.patch.object(self.recorder, 'verify_pins'), \
                    mock.patch.object(self.recorder.os, 'replace', side_effect=OSError('synthetic replace failure')):
                with self.assertRaises(OSError): self.recorder.record(path)
            self.assertEqual(path.read_bytes(), original)
            self.assertEqual(path.stat().st_ino, inode)
            self.assertEqual(list(root.glob('.release130-*')), [])
            path, original = self.write_checkpoint(root, 'concurrent-change.json')
            concurrent = original + b' \n'
            real_fsync = os.fsync
            mutated = False
            def mutate_before_commit(fd):
                nonlocal mutated
                if not mutated:
                    mutated = True; path.write_bytes(concurrent)
                return real_fsync(fd)
            with mock.patch.object(self.recorder, 'verify_pins'), \
                    mock.patch.object(self.recorder.os, 'fsync', side_effect=mutate_before_commit), \
                    mock.patch.object(self.recorder.os, 'replace') as replace:
                with self.assertRaisesRegex(self.recorder.RecordError, 'CHECKPOINT_CHANGED'):
                    self.recorder.record(path)
            replace.assert_not_called()
            self.assertEqual(path.read_bytes(), concurrent)
            self.assertEqual(list(root.glob('.release130-*')), [])

    def test_duplicate_keys_bad_permissions_and_symlinks_refused(self):
        with self.assertRaisesRegex(self.recorder.RecordError, 'DUPLICATE_KEY'):
            json.loads('{"a":1,"a":2}', object_pairs_hook=self.recorder.unique_object)
        with tempfile.TemporaryDirectory(dir=ROOT, prefix='record-release130-fixture-') as temporary:
            root = Path(temporary)
            path, original = self.write_checkpoint(root)
            path.chmod(0o644)
            with mock.patch.object(self.recorder, 'verify_pins'):
                with self.assertRaisesRegex(self.recorder.RecordError, 'FILE_METADATA'):
                    self.recorder.record(path)
            self.assertEqual(path.read_bytes(), original)
            path.chmod(0o600)
            alias = root / 'alias.json'; alias.symlink_to(path)
            with mock.patch.object(self.recorder, 'verify_pins'):
                with self.assertRaisesRegex(self.recorder.RecordError, 'FILE_METADATA'):
                    self.recorder.record(alias)

    def test_hardlinks_and_overlarge_result_refused_without_checkpoint_change(self):
        with tempfile.TemporaryDirectory(dir=ROOT, prefix='record-release130-fixture-') as temporary:
            root = Path(temporary)
            path, original = self.write_checkpoint(root)
            hardlink = root / 'hardlink.json'; os.link(path, hardlink)
            with mock.patch.object(self.recorder, 'verify_pins'):
                with self.assertRaisesRegex(self.recorder.RecordError, 'FILE_METADATA'):
                    self.recorder.record(path)
            self.assertEqual(path.read_bytes(), original)
            hardlink.unlink()
            document = self.document()
            document['activeService']['largeUnknownExtension'] = 'x' * (1200 * 1024)
            original = json.dumps(document, separators=(',', ':')).encode()
            self.assertLess(len(original), 2 * 1024 * 1024)
            path.write_bytes(original)
            with mock.patch.object(self.recorder, 'verify_pins'), mock.patch.object(self.recorder.os, 'replace') as replace:
                with self.assertRaisesRegex(self.recorder.RecordError, 'CHECKPOINT_LIMIT'):
                    self.recorder.record(path)
            replace.assert_not_called()
            self.assertEqual(path.read_bytes(), original)
            self.assertEqual(list(root.glob('.release130-*')), [])

    def test_pin_verification_checks_both_sources_and_all_five_binaries(self):
        with tempfile.TemporaryDirectory(dir=ROOT, prefix='record-release130-pins-') as temporary:
            root = Path(temporary)
            sources = []
            for name in ('current', 'rollback'):
                directory = root / name; directory.mkdir()
                def git(*args):
                    return subprocess.check_output(['/usr/bin/git', '-c', 'core.hooksPath=/dev/null',
                        '-C', str(directory), *args], stderr=subprocess.DEVNULL).decode().strip()
                git('init', '-q')
                (directory / 'fixture.txt').write_text('synthetic only')
                git('add', 'fixture.txt')
                git('-c', 'user.name=Synthetic Fixture', '-c', 'user.email=fixture@example.invalid',
                    'commit', '-qm', 'synthetic')
                sources.append((directory, git('rev-parse', 'HEAD'), git('rev-parse', 'HEAD^{tree}')))
            files = []
            for name in ('current-start', 'current-check', 'rollback-start', 'rollback-check', 'node'):
                path = root / name; path.write_text('synthetic pinned bytes ' + name); path.chmod(0o700)
                files.append((path, hashlib.sha256(path.read_bytes()).hexdigest()))
            logs = []
            for name in ('current.log', 'rollback.log'):
                path = root / name; path.write_text('existing log preserved'); path.chmod(0o600); logs.append(path)
            rollback = {**self.recorder.ROLLBACK, 'checkout': str(sources[1][0]), 'source': sources[1][1],
                'tree': sources[1][2], 'launcher': str(files[2][0]), 'launcherSha256': files[2][1],
                'checkLauncher': str(files[3][0]), 'checkLauncherSha256': files[3][1], 'log': str(logs[1])}
            patches = dict(CHECKOUT=sources[0][0], SHA=sources[0][1], TREE=sources[0][2],
                LAUNCHER=files[0][0], LAUNCHER_SHA=files[0][1], CHECK_LAUNCHER=files[1][0],
                CHECK_LAUNCHER_SHA=files[1][1], NODE=files[4][0], NODE_SHA=files[4][1],
                ROLLBACK=rollback, CURRENT_ACTIVE={**self.recorder.CURRENT_ACTIVE, 'log': str(logs[0])})
            with mock.patch.multiple(self.recorder, **patches):
                self.recorder.verify_pins()
                for path, _ in files:
                    original = path.read_bytes(); path.write_bytes(original + b' drift')
                    with self.assertRaisesRegex(self.recorder.RecordError, 'PIN_MISMATCH'):
                        self.recorder.verify_pins()
                    path.write_bytes(original)
                for directory, _, _ in sources:
                    fixture = directory / 'fixture.txt'; original = fixture.read_text()
                    fixture.write_text('changed source')
                    with self.assertRaisesRegex(self.recorder.RecordError, 'SOURCE_CHANGED'):
                        self.recorder.verify_pins()
                    fixture.write_text(original)
                self.recorder.verify_pins()
                self.assertEqual([path.read_text() for path in logs], ['existing log preserved'] * 2)


if __name__ == '__main__':
    unittest.main(verbosity=2)
