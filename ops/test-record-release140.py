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
HELPER = ROOT / 'record-release140.py'
RECORDED_AT = '2026-10-21T11:30:00Z'

# Frozen literal of the 1.2.0 CURRENT_ACTIVE qualified before this helper.
# The published suite imports only record-release140.py; historic writers are
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


# Frozen CURRENT_ACTIVE of the pinned 1.3.0 writer; used without importing it.
ACTIVE130_FIXTURE = {'source': 'afd0e98cdb4027ac4cb444ddb05afeda0a84fb6b',
 'tree': '37b3b2e9358972c95581fc0bcf16896e4074d5f9',
 'checkout': '/srv/customer/jessiemessage-operator/production-130-afd0e98c',
 'launcher': '/srv/customer/jessiemessage-private/start-primary-release130-afd0e98c.sh',
 'launcherSha256': '7bc16887caa01e0644ef200f9ab099049963af9fa1f6db0ad7a1c37bec7232d5',
 'checkLauncher': '/srv/customer/jessiemessage-private/check-primary-release130-afd0e98c.sh',
 'checkLauncherSha256': 'af327346122802092763969269e17e3f48b73b2bf704bb04d06d78c1dfdd3815',
 'log': '/srv/customer/jessiemessage-private/jm130-node2422.log',
 'release': '1.3.0',
 'nodeAfterDeployment': 'v24.22.0',
 'schemaMigrations': 31,
 'mode': 'start-local-closures',
 'closuresEnabled': True,
 'port': 3000,
 'launcherMode': '0700',
 'logMode': '0600',
 'status': 'identity_verified_via_admin_report',
 'evidence': {'provenance': 'admin_readiness_user_report',
              'reportedStartedAtDisplay': '21/10/2026 01:50:02',
              'schemaEvidence': 'operator_reported_release130_staged_precheck_passed_schema31_unchanged',
              'limitations': ['pid_not_qualified',
                              'socket_not_qualified',
                              'executed_binary_hash_not_qualified',
                              'runtime_private_configs_not_qualified',
                              'pc_not_qualified',
                              'backups_not_qualified',
                              'reported_start_time_timezone_and_epoch_not_supplied']}}


# Frozen CURRENT_ACTIVE of the pinned 1.3.1 writer; no import of that writer.
ACTIVE131_FIXTURE = {'source': 'baf91e0e7ec9ffee7723e7332e07b7437c8dc5a8',
 'tree': 'adcdf8e8e2aa202163da665aa0df8344abf7a194',
 'checkout': '/srv/customer/jessiemessage-operator/production-131-baf91e0e',
 'launcher': '/srv/customer/jessiemessage-private/start-primary-release131-baf91e0e.sh',
 'launcherSha256': '0c481fc45f9038897b1c897e75148a0fa9bcc19a92c098ba05183761ad755572',
 'checkLauncher': '/srv/customer/jessiemessage-private/check-primary-release131-baf91e0e.sh',
 'checkLauncherSha256': 'e1ee74f6ecc39db15719c3eccbf85445fc494a7b1831a6f85749f069460f37d9',
 'log': '/srv/customer/jessiemessage-private/jm131-node2422.log',
 'release': '1.3.1',
 'nodeAfterDeployment': 'v24.22.0',
 'schemaMigrations': 31,
 'mode': 'start-local-closures',
 'closuresEnabled': True,
 'port': 3000,
 'launcherMode': '0700',
 'logMode': '0600',
 'status': 'identity_verified_via_admin_report',
 'evidence': {'provenance': 'admin_readiness_user_report',
              'reportedStartedAtDisplay': '21/10/2026 03:04:01',
              'schemaEvidence': 'operator_reported_release131_staged_precheck_passed_schema31_unchanged',
              'limitations': ['pid_not_qualified',
                              'socket_not_qualified',
                              'executed_binary_hash_not_qualified',
                              'runtime_private_configs_not_qualified',
                              'pc_not_qualified',
                              'backups_not_qualified',
                              'reported_start_time_timezone_and_epoch_not_supplied']}}


# Frozen CURRENT_ACTIVE from the pinned 1.3.3 recorder.
ACTIVE133_FIXTURE = {'source': 'ca0d40648036d57fdee55b91d47d5d5a874a626e',
 'tree': 'b1fe882ede0450cbf135d2ff8cb19e780d18a0e5',
 'checkout': '/srv/customer/jessiemessage-operator/production-133-ca0d4064',
 'launcher': '/srv/customer/jessiemessage-private/start-primary-release133-ca0d4064.sh',
 'launcherSha256': '88aad7a731cc58a4367e808c9f4156b47c6f647f71b10f4b2e0fb65d093cea89',
 'checkLauncher': '/srv/customer/jessiemessage-private/check-primary-release133-ca0d4064.sh',
 'checkLauncherSha256': '80bfd6dbeebacc4f550baf95d76921e85b3e196814b12554333c80561d155623',
 'log': '/srv/customer/jessiemessage-private/jm133-node2422.log',
 'release': '1.3.3',
 'nodeAfterDeployment': 'v24.22.0',
 'schemaMigrations': 31,
 'mode': 'start-local-closures',
 'closuresEnabled': True,
 'port': 3000,
 'launcherMode': '0700',
 'logMode': '0600',
 'status': 'identity_verified_via_admin_report',
 'evidence': {'provenance': 'admin_readiness_user_report',
              'reportedStartedAtDisplay': '21/10/2026 13:20:11',
              'schemaEvidence': 'operator_reported_release133_staged_precheck_passed_schema31_unchanged',
              'limitations': ['pid_not_qualified',
                              'socket_not_qualified',
                              'executed_binary_hash_not_qualified',
                              'runtime_private_configs_not_qualified',
                              'pc_not_qualified',
                              'backups_not_qualified',
                              'reported_start_time_timezone_and_epoch_not_supplied']}}


def load_recorder(path=HELPER, name='release140_recorder_under_test'):
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
        active = copy.deepcopy(ACTIVE133_FIXTURE)
        active.update(operatorExtension={'nested': ['keep133', {'all': True}]},
                      legacyUnknown='complete 1.3.3 prior active fixture')
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
                'release130': {'status': 'identity_verified_via_admin_report',
                               'recordedAt': '2026-10-20T23:55:00Z',
                               'priorActiveService': copy.deepcopy(ACTIVE120_FIXTURE),
                               'priorActiveServiceSha256': 'e' * 64,
                               'priorActiveServiceUsableRollback': True,
                               'rollback': copy.deepcopy(ACTIVE120_FIXTURE), 'rollbackSha256': 'f' * 64,
                               'reportedStartedAtDisplay': '21/10/2026 01:50:02',
                               'unknownLegacyEvidence': {'retained': ['keep130 archive', True]}},
                'release131': {'status': 'identity_verified_via_admin_report',
                               'recordedAt': '2026-10-21T01:05:00Z',
                               'priorActiveService': copy.deepcopy(ACTIVE130_FIXTURE),
                               'priorActiveServiceSha256': '1' * 64,
                               'priorActiveServiceUsableRollback': True,
                               'rollback': copy.deepcopy(ACTIVE130_FIXTURE), 'rollbackSha256': '2' * 64,
                               'reportedStartedAtDisplay': '21/10/2026 03:04:01',
                               'unknownLegacyEvidence': {'retained': ['keep131 archive', True]}},
                'release133': {'status': 'identity_verified_via_admin_report',
                               'priorActiveService': copy.deepcopy(ACTIVE131_FIXTURE),
                               'priorActiveServiceSha256': '3' * 64,
                               'priorActiveServiceUsableRollback': True,
                               'rollback': copy.deepcopy(ACTIVE131_FIXTURE),
                               'unknownLegacyEvidence': {'retained': ['keep133 archive', True]}},
                'C1-C5': {'doNotChange': ['authority', 'quarantine', 'keys']},
                'D1': {'status': 'preserved', 'operationalRestore': True},
                'PC': {'qualified': False, 'opaqueState': [None, 0, 'preserve']},
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

    def test_preserves_full_prior133_and_every_historical_or_unknown_block(self):
        before = self.document()
        document = copy.deepcopy(before)
        updated, already = self.recorder.prepare(document, RECORDED_AT)
        self.assertFalse(already)
        self.assertEqual(document, before)
        self.assertEqual(updated['activeService'], self.recorder.CURRENT_ACTIVE)
        section = updated['developmentSimplification']['release140']
        self.assertEqual(section['priorActiveService'], before['activeService'])
        self.assertEqual(section['priorActiveService']['release'], '1.3.3')
        self.assertFalse(section['priorActiveServiceUsableRollback'])
        self.assertEqual(section['priorActiveServiceSha256'], self.recorder.rollback_digest(before['activeService']))
        self.assertEqual(section['recordedAt'], RECORDED_AT)
        self.assertEqual(section['reportedStartedAtDisplay'], '21/10/2026 15:31:41')
        self.assertIn('reported_start_time_timezone_and_epoch_not_supplied', section['limitations'])
        restored = copy.deepcopy(updated)
        restored['activeService'] = before['activeService']
        del restored['developmentSimplification']['release140']
        self.assertEqual(restored, before)
        updated['activeService']['evidence']['limitations'].append('synthetic mutation')
        self.assertNotIn('synthetic mutation', self.recorder.EVIDENCE['limitations'])

    def test_old_identity133_is_archived_while_separate_prepared134_is_the_rollback(self):
        self.assertEqual(self.recorder.OLD_ACTIVE, ACTIVE133_FIXTURE)
        before = self.document()
        updated, _ = self.recorder.prepare(before, RECORDED_AT)
        section = updated['developmentSimplification']['release140']
        rollback = section['rollback']
        self.assertNotEqual(rollback, before['activeService'])
        self.assertNotEqual(rollback, section['priorActiveService'])
        self.assertEqual(rollback['release'], '1.3.4')
        self.assertEqual(rollback['source'], '4538148660fbf1487807fb1518747d8f5753cd3b')
        self.assertEqual(rollback['tree'], '248477f9c63064a57445e5b15023e58fdde8e02c')
        self.assertEqual(rollback['schemaMigrations'], 31)
        self.assertEqual(rollback['status'], 'hosted_precheck_passed_not_started')
        self.assertFalse(rollback['identityVerified'])
        self.assertFalse(rollback['evidence']['runtimeStarted'])
        self.assertNotIn('reportedStartedAtDisplay', rollback['evidence'])
        self.assertEqual(section['rollbackSha256'], self.recorder.rollback_digest(rollback))
        self.assertFalse(section['priorActiveServiceUsableRollback'])
        self.assertEqual(updated['activeService']['release'], '1.4.0')
        self.assertEqual(updated['activeService']['source'], '56d4595059df9292fc54ba4d4e948eeb793bae96')
        self.assertEqual(updated['activeService']['tree'], '8129e76c9817e79c062a4437eadee4b7ce4d90a1')
        self.assertEqual(updated['activeService']['schemaMigrations'], 31)
        self.assertEqual(section['priorActiveService']['operatorExtension'], before['activeService']['operatorExtension'])

    def test_wrong_prior_identity_or_existing_section_refused_without_mutation(self):
        for key, value in [('source', 'a' * 40), ('tree', 'b' * 40), ('release', '1.0.0')]:
            with self.subTest(prior=key):
                document = self.document(); document['activeService'][key] = value
                before = copy.deepcopy(document)
                with self.assertRaisesRegex(self.recorder.RecordError, 'OLD_IDENTITY'):
                    self.recorder.prepare(document, RECORDED_AT)
                self.assertEqual(document, before)
        document = self.document(); document['developmentSimplification']['release140'] = {}
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
            (None, 'rollbackSha256', 'e' * 64), (None, 'priorActiveServiceUsableRollback', True),
            (None, 'priorActiveServiceUsableRollback', 1),
            (None, 'reportedStartedAtDisplay', 'unexpected date'),
        ]
        for nested, key, value in mutations:
            with self.subTest(nested=nested, key=key):
                document = copy.deepcopy(prepared)
                section = document['developmentSimplification']['release140']
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
        with tempfile.TemporaryDirectory(dir=ROOT, prefix='record-release140-fixture-') as temporary:
            path, _ = self.write_checkpoint(Path(temporary))
            with mock.patch.object(self.recorder, 'verify_pins') as pins:
                first = self.recorder.record(path)
                self.assertEqual(first['status'], 'release140_metadata_recorded')
                self.assertEqual(first['rollbackRelease'], '1.3.4')
                self.assertEqual(first['schemaMigrations'], 31)
                self.assertTrue(first['metadataOnly'] and first['noRestart'])
                self.assertTrue(first['priorActivePreserved'] and first['otherBlocksPreserved'])
                self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
                before, original = path.stat(), path.read_bytes()
                with mock.patch.object(self.recorder.os, 'replace') as replace:
                    second = self.recorder.record(path)
                replace.assert_not_called()
                self.assertEqual(second['status'], 'release140_metadata_already_recorded')
                self.assertEqual(path.read_bytes(), original)
                self.assertEqual((before.st_dev, before.st_ino, before.st_mtime_ns),
                                 (path.stat().st_dev, path.stat().st_ino, path.stat().st_mtime_ns))
                self.assertEqual(pins.call_count, 2)

    def test_replace_failure_and_concurrent_drift_preserve_original_bytes(self):
        with tempfile.TemporaryDirectory(dir=ROOT, prefix='record-release140-fixture-') as temporary:
            root = Path(temporary)
            path, original = self.write_checkpoint(root, 'replace-failure.json')
            inode = path.stat().st_ino
            with mock.patch.object(self.recorder, 'verify_pins'), \
                    mock.patch.object(self.recorder.os, 'replace', side_effect=OSError('synthetic replace failure')):
                with self.assertRaises(OSError): self.recorder.record(path)
            self.assertEqual(path.read_bytes(), original)
            self.assertEqual(path.stat().st_ino, inode)
            self.assertEqual(list(root.glob('.release140-*')), [])
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
            self.assertEqual(list(root.glob('.release140-*')), [])

    def test_duplicate_keys_bad_permissions_and_symlinks_refused(self):
        with self.assertRaisesRegex(self.recorder.RecordError, 'DUPLICATE_KEY'):
            json.loads('{"a":1,"a":2}', object_pairs_hook=self.recorder.unique_object)
        with tempfile.TemporaryDirectory(dir=ROOT, prefix='record-release140-fixture-') as temporary:
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
        with tempfile.TemporaryDirectory(dir=ROOT, prefix='record-release140-fixture-') as temporary:
            root = Path(temporary)
            path, original = self.write_checkpoint(root)
            hardlink = root / 'hardlink.json'; os.link(path, hardlink)
            with mock.patch.object(self.recorder, 'verify_pins'):
                with self.assertRaisesRegex(self.recorder.RecordError, 'FILE_METADATA'):
                    self.recorder.record(path)
            self.assertEqual(path.read_bytes(), original)
            hardlink.unlink()
            document = self.document()
            document['activeService']['largeUnknownExtension'] = ''
            original_size = len(json.dumps(document, separators=(',', ':')).encode())
            document['activeService']['largeUnknownExtension'] = 'x' * (2 * 1024 * 1024 - 512 - original_size)
            original = json.dumps(document, separators=(',', ':')).encode()
            self.assertLess(len(original), 2 * 1024 * 1024)
            path.write_bytes(original)
            with mock.patch.object(self.recorder, 'verify_pins'), mock.patch.object(self.recorder.os, 'replace') as replace:
                with self.assertRaisesRegex(self.recorder.RecordError, 'CHECKPOINT_LIMIT'):
                    self.recorder.record(path)
            replace.assert_not_called()
            self.assertEqual(path.read_bytes(), original)
            self.assertEqual(list(root.glob('.release140-*')), [])

    def test_pin_verification_checks_both_sources_launchers_node_prechecks_and_logs(self):
        with tempfile.TemporaryDirectory(dir=ROOT, prefix='record-release140-pins-') as temporary:
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
            for name, mode in [('current-start', 0o700), ('current-check', 0o700),
                    ('rollback-start', 0o700), ('rollback-check', 0o700), ('node', 0o700),
                    ('current-precheck', 0o600), ('rollback-precheck', 0o600)]:
                path = root / name; path.write_text('synthetic pinned bytes ' + name); path.chmod(mode)
                files.append((path, hashlib.sha256(path.read_bytes()).hexdigest()))
            current_log = root / 'current.log'; current_log.write_text('existing runtime log preserved'); current_log.chmod(0o600)
            rollback_log = root / 'rollback.log'; rollback_log.write_bytes(b''); rollback_log.chmod(0o600)
            rollback = {**self.recorder.ROLLBACK, 'checkout': str(sources[1][0]), 'source': sources[1][1],
                'tree': sources[1][2], 'launcher': str(files[2][0]), 'launcherSha256': files[2][1],
                'checkLauncher': str(files[3][0]), 'checkLauncherSha256': files[3][1], 'log': str(rollback_log),
                'precheckLog': str(files[6][0]), 'precheckLogSha256': files[6][1]}
            patches = dict(CHECKOUT=sources[0][0], SHA=sources[0][1], TREE=sources[0][2],
                LAUNCHER=files[0][0], LAUNCHER_SHA=files[0][1], CHECK_LAUNCHER=files[1][0],
                CHECK_LAUNCHER_SHA=files[1][1], NODE=files[4][0], NODE_SHA=files[4][1],
                PRECHECK_LOG=files[5][0],
                ROLLBACK=rollback, CURRENT_ACTIVE={**self.recorder.CURRENT_ACTIVE, 'log': str(current_log)})
            with mock.patch.multiple(self.recorder, **patches):
                self.recorder.verify_pins()
                for index, (path, _) in enumerate(files):
                    if index == 5: continue  # Active precheck may legitimately grow during Manager Build.
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
                active_precheck = files[5][0]
                appended = active_precheck.read_bytes() + b'\nsecond successful Manager Build receipt'
                active_precheck.write_bytes(appended)
                self.recorder.verify_pins()
                self.assertEqual(active_precheck.read_bytes(), appended)
                active_precheck.chmod(0o644)
                with self.assertRaisesRegex(self.recorder.RecordError, 'FILE_METADATA'):
                    self.recorder.verify_pins()
                active_precheck.chmod(0o600)
                rollback_log.write_text('unexpected runtime start')
                with self.assertRaisesRegex(self.recorder.RecordError, 'ROLLBACK_RUNTIME_LOG_CHANGED'):
                    self.recorder.verify_pins()
                rollback_log.write_bytes(b'')
                current_log.chmod(0o644)
                with self.assertRaisesRegex(self.recorder.RecordError, 'FILE_METADATA'):
                    self.recorder.verify_pins()
                current_log.chmod(0o600)
                self.recorder.verify_pins()
                self.assertEqual(current_log.read_text(), 'existing runtime log preserved')
                self.assertEqual(rollback_log.read_bytes(), b'')

    def test_pin_failure_and_duplicate_checkpoint_refuse_without_write(self):
        with tempfile.TemporaryDirectory(dir=ROOT, prefix='record-release140-refusal-') as temporary:
            path, original = self.write_checkpoint(Path(temporary))
            with mock.patch.object(self.recorder, 'verify_pins', side_effect=self.recorder.RecordError('PIN_MISMATCH')), \
                    mock.patch.object(self.recorder.os, 'replace') as replace:
                with self.assertRaisesRegex(self.recorder.RecordError, 'PIN_MISMATCH'):
                    self.recorder.record(path)
            replace.assert_not_called()
            self.assertEqual(path.read_bytes(), original)
            duplicate = b'{"activeService":{},"activeService":{},"developmentSimplification":{}}'
            path.write_bytes(duplicate)
            with mock.patch.object(self.recorder, 'verify_pins'), mock.patch.object(self.recorder.os, 'replace') as replace:
                with self.assertRaisesRegex(self.recorder.RecordError, 'DUPLICATE_KEY'):
                    self.recorder.record(path)
            replace.assert_not_called()
            self.assertEqual(path.read_bytes(), duplicate)

if __name__ == '__main__':
    unittest.main(verbosity=2)
