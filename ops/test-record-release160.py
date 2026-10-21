#!/usr/bin/env python3
"""Synthetic metadata recording tests only: no production files, SQL or service."""
import copy
import hashlib
import importlib.util
import json
import os
import re
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parent
HELPER = ROOT / 'record-release160.py'
RECORDED_AT = '2026-10-31T12:40:00Z'

# Frozen literal of the 1.2.0 CURRENT_ACTIVE qualified before this helper.
# This standalone suite loads only record-release160.py; historic writers are
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


# Frozen CURRENT_ACTIVE of the closed 1.4.0 release; used without its writer.
ACTIVE140_FIXTURE = {'source': '56d4595059df9292fc54ba4d4e948eeb793bae96',
 'tree': '8129e76c9817e79c062a4437eadee4b7ce4d90a1',
 'checkout': '/srv/customer/jessiemessage-operator/production-140-56d45950',
 'launcher': '/srv/customer/jessiemessage-private/start-primary-release140-56d45950.sh',
 'launcherSha256': '45f99cac50dc057f9be61f7db420dd7e64f92f76f67a8eaade1463780edff3b0',
 'checkLauncher': '/srv/customer/jessiemessage-private/check-primary-release140-56d45950.sh',
 'checkLauncherSha256': '38e655a8e1e2be696707650aabc5e26c11ca9f7b1ac74d7b17ff23f6016deb4c',
 'log': '/srv/customer/jessiemessage-private/jm140-node2422.log',
 'release': '1.4.0',
 'nodeAfterDeployment': 'v24.22.0',
 'schemaMigrations': 31,
 'mode': 'start-local-closures',
 'closuresEnabled': True,
 'port': 3000,
 'launcherMode': '0700',
 'logMode': '0600',
 'status': 'identity_verified_via_admin_report',
 'evidence': {'provenance': 'admin_readiness_user_report',
              'reportedStartedAtDisplay': '21/10/2026 15:31:41',
              'precheckLogSha256AtStaging': 'cb5a9e6d1d1354abe8113cb12e7c6e3d636b5111041851ada88f85c5b845fea6',
              'schemaEvidence': 'operator_reported_release140_joint_staged_prechecks_passed_schema31_unchanged',
              'limitations': ['pid_not_qualified',
                              'socket_not_qualified',
                              'executed_binary_hash_not_qualified',
                              'runtime_private_configs_not_qualified',
                              'pc_not_qualified',
                              'backups_not_qualified',
                              'reported_start_time_timezone_and_epoch_not_supplied']}}
# Frozen CURRENT_ACTIVE150 and its full prepared141 rollback; no historical writer import.
ACTIVE150_FIXTURE = {'source': 'abca467c45c9385371a9095ab359e78c99140370',
 'tree': '3238dd2224ea768e3ab2f8bcb7594cc3890dd5e4',
 'checkout': '/srv/customer/jessiemessage-operator/production-150-abca467c',
 'launcher': '/srv/customer/jessiemessage-private/start-primary-release150-abca467c.sh',
 'launcherSha256': '3620b656f528f3ad031bb4ad5f709df5ced0a21ff4326b4e5a5c4cdc6994105b',
 'checkLauncher': '/srv/customer/jessiemessage-private/check-primary-release150-abca467c.sh',
 'checkLauncherSha256': 'e06b8356074a0980975f71d2d9cf88bf463a4f6fb583bb0b40346c005dc29770',
 'log': '/srv/customer/jessiemessage-private/jm150-node2422.log',
 'release': '1.5.0',
 'nodeAfterDeployment': 'v24.22.0',
 'schemaMigrations': 32,
 'mode': 'start-local-closures',
 'closuresEnabled': True,
 'port': 3000,
 'launcherMode': '0700',
 'logMode': '0600',
 'status': 'identity_verified_via_admin_report',
 'evidence': {'provenance': 'admin_readiness_user_report',
              'reportedStartedAtDisplay': '21/10/2026 17:58:07',
              'precheckLogExpectedSha256AfterSuccessfulCheck': 'cb5a9e6d1d1354abe8113cb12e7c6e3d636b5111041851ada88f85c5b845fea6',
              'schemaEvidence': 'operator_reported_schema32_prechecks_passed',
              'limitations': ['pid_not_qualified',
                              'socket_not_qualified',
                              'executed_binary_hash_not_qualified',
                              'runtime_private_configs_not_qualified',
                              'pc_not_qualified',
                              'backups_not_qualified',
                              'reported_start_time_timezone_and_epoch_not_supplied']}}
ROLLBACK141_FIXTURE = {'source': 'bf022233fcb76ee4db89e0c33c64b9498adb9d50',
 'tree': 'a2f29930fe8ead853db6b6e8b76b613891ae4a04',
 'checkout': '/srv/customer/jessiemessage-operator/production-141-bf022233',
 'launcher': '/srv/customer/jessiemessage-private/start-primary-release141-bf022233.sh',
 'launcherSha256': 'bf8a44e8560dd6f564f974d02349859e88fde539fe0cbe21dec9fa047917669d',
 'checkLauncher': '/srv/customer/jessiemessage-private/check-primary-release141-bf022233.sh',
 'checkLauncherSha256': '1418da8240789d95cb494e65d01f97e2e319c491b6672d81984f1db013c724e7',
 'log': '/srv/customer/jessiemessage-private/jm141-node2422.log',
 'precheckLog': '/srv/customer/jessiemessage-private/jm141-preflight-bf022233.log',
 'precheckLogSha256': 'cb5a9e6d1d1354abe8113cb12e7c6e3d636b5111041851ada88f85c5b845fea6',
 'release': '1.4.1',
 'nodeVersion': 'v24.22.0',
 'schemaMigrations': 32,
 'mode': 'start-local-closures',
 'closuresEnabled': True,
 'port': 3000,
 'launcherMode': '0700',
 'logMode': '0600',
 'status': 'hosted_precheck_passed_not_started',
 'identityVerified': False,
 'announcementsEnabled': False,
 'announcementsCompatible': True,
 'compactBroadcastsCompatible': True,
 'evidence': {'provenance': 'operator_release150_schema32_prechecks_user_report',
              'bothPrechecksPassed': True,
              'rollback141HostedQualified': True,
              'schema32Confirmed': True,
              'pendingClosures': False,
              'runtimeStarted': False,
              'nodeBinarySha256': '67ca5783febb8bf85736c79fcdd92c8d6d465a0eb2a082672bcdfa76a506751c',
              'limitations': ['runtime_identity_not_observed',
                              'pid_not_qualified',
                              'socket_not_qualified',
                              'executed_binary_hash_not_qualified']}}
SYNTHETIC_STARTED_AT = '31/10/2026 12:34:56'


def load_recorder(path=HELPER, name='release160_recorder_under_test', *, qualified=True):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    source = path.read_text()
    # Only this in-memory copy receives a synthetic activation or missing-report case.
    # Loading the test copy does not inspect or record production state.
    display = SYNTHETIC_STARTED_AT if qualified else 'QUALIFICATION_REQUIRED_STARTED_AT_DISPLAY'
    attestation = 'admin_readiness_user_report' if qualified else 'QUALIFICATION_REQUIRED_ACTIVATION_ATTESTATION'
    source, display_count = re.subn(r'^REPORTED_STARTED_AT_DISPLAY = .*$', 'REPORTED_STARTED_AT_DISPLAY = ' + repr(display), source, flags=re.M)
    source, attestation_count = re.subn(r'^ACTIVATION_ATTESTATION = .*$', 'ACTIVATION_ATTESTATION = ' + repr(attestation), source, flags=re.M)
    assert display_count == attestation_count == 1
    exec(compile(source, str(path), 'exec'), module.__dict__)
    return module


class RecorderTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.recorder = load_recorder()

    def test_missing_activation_refuses_before_any_private_file_access(self):
        unqualified = load_recorder(name='release160_unqualified_fixture', qualified=False)
        with mock.patch.object(unqualified, 'verify_pins') as pins, \
                mock.patch.object(unqualified.os, 'open') as opened, \
                mock.patch.object(unqualified.Path, 'lstat') as lstat:
            with self.assertRaisesRegex(unqualified.RecordError, 'ACTIVATION_NOT_CONFIRMED'):
                unqualified.record()
        pins.assert_not_called(); opened.assert_not_called(); lstat.assert_not_called()
        before = self.document()
        with self.assertRaisesRegex(unqualified.RecordError, 'ACTIVATION_NOT_CONFIRMED'):
            unqualified.prepare(before, RECORDED_AT)
        self.assertEqual(before, self.document())

    def test_partial_activation_or_invalid_display_refuses_without_write(self):
        for attestation, display in [
                ('QUALIFICATION_REQUIRED_ACTIVATION_ATTESTATION', SYNTHETIC_STARTED_AT),
                ('admin_readiness_user_report', 'QUALIFICATION_REQUIRED_STARTED_AT_DISPLAY'),
                ('admin_readiness_user_report', '31/02/2026 12:34:56'),
                ('admin_readiness_user_report', '2026-10-31T12:34:56Z'),
                (True, SYNTHETIC_STARTED_AT), ('admin_readiness_user_report', None)]:
            with self.subTest(attestation=attestation, display=display), \
                    mock.patch.object(self.recorder, 'ACTIVATION_ATTESTATION', attestation), \
                    mock.patch.object(self.recorder, 'REPORTED_STARTED_AT_DISPLAY', display), \
                    mock.patch.object(self.recorder, 'verify_pins') as pins:
                with self.assertRaisesRegex(self.recorder.RecordError, 'ACTIVATION_NOT_CONFIRMED'):
                    self.recorder.record()
                pins.assert_not_called()

    def document(self):
        # Synthetic snapshots exercise opaque preservation of every legacy
        # release and extension. Their writers are intentionally not imported.
        active = copy.deepcopy(ACTIVE150_FIXTURE)
        active.update(operatorExtension={'nested': ['keep133', {'all': True}]},
                      legacyUnknown='complete 1.5.0 prior active fixture')
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
                'release140': {'status': 'identity_verified_via_admin_report',
                               'recordedAt': '2026-10-21T15:50:00Z',
                               'priorActiveService': copy.deepcopy(ACTIVE133_FIXTURE),
                               'priorActiveServiceSha256': '4' * 64,
                               'priorActiveServiceUsableRollback': False,
                               'rollback': {'release': '1.3.4', 'source': '4538148660fbf1487807fb1518747d8f5753cd3b',
                                            'identityVerified': False, 'status': 'hosted_precheck_passed_not_started',
                                            'unknownHistorical134': {'keep': ['all', None, False]}},
                               'rollbackSha256': '5' * 64,
                               'unknownLegacyEvidence': {'retained': ['keep140 archive', True]}},
                'release150': {'status': 'identity_verified_via_admin_report',
                               'recordedAt': '2026-10-21T18:05:00Z',
                               'priorActiveService': copy.deepcopy(ACTIVE140_FIXTURE),
                               'priorActiveServiceSha256': '6' * 64,
                               'priorActiveServiceUsableRollback': False,
                               'rollback': copy.deepcopy(ROLLBACK141_FIXTURE),
                               'rollbackSha256': '7' * 64,
                               'unknownLegacyEvidence': {'retained': ['keep150 and141 archive', True]}},
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

    def test_preserves_full_prior150_and_every_historical_or_unknown_block(self):
        before = self.document()
        document = copy.deepcopy(before)
        updated, already = self.recorder.prepare(document, RECORDED_AT)
        self.assertFalse(already)
        self.assertEqual(document, before)
        self.assertEqual(updated['activeService'], self.recorder.CURRENT_ACTIVE)
        section = updated['developmentSimplification']['release160']
        self.assertEqual(section['priorActiveService'], before['activeService'])
        self.assertEqual(section['priorActiveService']['release'], '1.5.0')
        self.assertFalse(section['priorActiveServiceUsableRollback'])
        self.assertEqual(section['priorActiveServiceSha256'], self.recorder.rollback_digest(before['activeService']))
        self.assertEqual(section['recordedAt'], RECORDED_AT)
        self.assertEqual(section['reportedStartedAtDisplay'], SYNTHETIC_STARTED_AT)
        self.assertIn('reported_start_time_timezone_and_epoch_not_supplied', section['limitations'])
        restored = copy.deepcopy(updated)
        restored['activeService'] = before['activeService']
        del restored['developmentSimplification']['release160']
        self.assertEqual(restored, before)
        self.assertEqual(updated['developmentSimplification']['release150']['rollback'], ROLLBACK141_FIXTURE)
        self.assertEqual(updated['developmentSimplification']['release150'], before['developmentSimplification']['release150'])
        updated['activeService']['evidence']['limitations'].append('synthetic mutation')
        self.assertNotIn('synthetic mutation', self.recorder.EVIDENCE['limitations'])

    def test_old_identity150_is_archived_while_separate_prepared151_is_the_rollback(self):
        self.assertEqual(self.recorder.OLD_ACTIVE, ACTIVE150_FIXTURE)
        before = self.document()
        updated, _ = self.recorder.prepare(before, RECORDED_AT)
        section = updated['developmentSimplification']['release160']
        rollback = section['rollback']
        self.assertNotEqual(rollback, before['activeService'])
        self.assertNotEqual(rollback, section['priorActiveService'])
        self.assertEqual(rollback['release'], '1.5.1')
        self.assertEqual(rollback['source'], '71e62184d2d25a4242e0349c403027e1eeb6537c')
        self.assertEqual(rollback['tree'], 'f769c99aa800486bd04065a308f1f4269841c215')
        self.assertEqual(rollback['schemaMigrations'], 33)
        self.assertEqual(rollback['status'], 'hosted_precheck_passed_not_started')
        self.assertFalse(rollback['identityVerified'])
        self.assertFalse(rollback['evidence']['runtimeStarted'])
        self.assertTrue(rollback['announcementsEnabled'])
        self.assertFalse(rollback['tasksEnabled'])
        self.assertTrue(rollback['tasksCompatible'])
        self.assertTrue(rollback['announcementsCompatible'])
        self.assertTrue(rollback['evidence']['schema33Confirmed'])
        self.assertTrue(rollback['evidence']['rollback151HostedQualified'])
        self.assertNotIn('reportedStartedAtDisplay', rollback['evidence'])
        self.assertEqual(section['rollbackSha256'], self.recorder.rollback_digest(rollback))
        self.assertFalse(section['priorActiveServiceUsableRollback'])
        self.assertEqual(updated['activeService']['release'], '1.6.0')
        self.assertEqual(updated['activeService']['source'], '9590741e7065067aee9d1ad5d1206739cc27eb6b')
        self.assertEqual(updated['activeService']['tree'], '38e72545ab4fd6feb4a04e934b2eb8685f82b970')
        self.assertEqual(updated['activeService']['schemaMigrations'], 33)
        self.assertTrue(updated['activeService']['tasksEnabled'])
        self.assertTrue(updated['activeService']['announcementsEnabled'])
        self.assertEqual(section['priorActiveService']['operatorExtension'], before['activeService']['operatorExtension'])

    def test_wrong_prior_identity_or_existing_section_refused_without_mutation(self):
        for key, value in [('source', 'a' * 40), ('tree', 'b' * 40), ('release', '1.0.0')]:
            with self.subTest(prior=key):
                document = self.document(); document['activeService'][key] = value
                before = copy.deepcopy(document)
                with self.assertRaisesRegex(self.recorder.RecordError, 'OLD_IDENTITY'):
                    self.recorder.prepare(document, RECORDED_AT)
                self.assertEqual(document, before)
        document = self.document(); document['developmentSimplification']['release160'] = {}
        with self.assertRaisesRegex(self.recorder.RecordError, 'EXISTING_SECTION'):
            self.recorder.prepare(document, RECORDED_AT)
        document = self.document(); document['developmentSimplification']['release160'] = None
        before = copy.deepcopy(document)
        with self.assertRaisesRegex(self.recorder.RecordError, 'OLD_IDENTITY'):
            self.recorder.prepare(document, RECORDED_AT)
        self.assertEqual(document, before)

    def test_existing_section_rejects_tampered_rollback_prior_and_attestations(self):
        prepared, _ = self.recorder.prepare(self.document(), RECORDED_AT)
        mutations = [
            ('rollback', 'source', 'a' * 40), ('rollback', 'tree', 'b' * 40),
            ('rollback', 'launcherSha256', 'c' * 64), ('rollback', 'schemaMigrations', 30),
            ('rollback', 'release', '1.1.0'), ('rollback', 'status', 'unconfirmed'),
            ('rollback', 'identityVerified', True),
            ('rollback', 'tasksEnabled', True), ('rollback', 'tasksCompatible', False),
            ('rollback', 'announcementsEnabled', False),
            ('priorActiveService', 'legacyUnknown', 'unexpected prior drift'),
            (None, 'priorActiveServiceSha256', 'd' * 64),
            (None, 'rollbackSha256', 'e' * 64), (None, 'priorActiveServiceUsableRollback', True),
            (None, 'priorActiveServiceUsableRollback', 1),
            (None, 'reportedStartedAtDisplay', 'unexpected date'),
        ]
        for nested, key, value in mutations:
            with self.subTest(nested=nested, key=key):
                document = copy.deepcopy(prepared)
                section = document['developmentSimplification']['release160']
                (section if nested is None else section[nested])[key] = value
                before = copy.deepcopy(document)
                with self.assertRaisesRegex(self.recorder.RecordError, 'EXISTING_SECTION_DIVERGENT'):
                    self.recorder.prepare(document, RECORDED_AT)
                self.assertEqual(document, before)
        document = copy.deepcopy(prepared)
        document['activeService']['evidence']['reportedStartedAtDisplay'] = 'altered active evidence'
        with self.assertRaisesRegex(self.recorder.RecordError, 'EXISTING_SECTION_DIVERGENT'):
            self.recorder.prepare(document, RECORDED_AT)
        for flag, value in [('closuresEnabled', 1), ('tasksEnabled', False), ('tasksEnabled', 1), ('announcementsEnabled', False)]:
            document = copy.deepcopy(prepared)
            document['activeService'][flag] = value
            with self.subTest(activeFlag=flag, value=value), self.assertRaisesRegex(self.recorder.RecordError, 'EXISTING_SECTION_DIVERGENT'):
                self.recorder.prepare(document, RECORDED_AT)

    def test_second_record_idempotent_without_inode_mtime_or_bytes_change(self):
        with tempfile.TemporaryDirectory(dir=ROOT.parent.parent, prefix='record-release160-fixture-') as temporary:
            path, _ = self.write_checkpoint(Path(temporary))
            with mock.patch.object(self.recorder, 'verify_pins') as pins:
                first = self.recorder.record(path)
                self.assertEqual(first['status'], 'release160_metadata_recorded')
                self.assertEqual(first['rollbackRelease'], '1.5.1')
                self.assertEqual(first['schemaMigrations'], 33)
                self.assertTrue(first['metadataOnly'] and first['noRestart'])
                self.assertTrue(first['priorActivePreserved'] and first['otherBlocksPreserved'])
                self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
                before, original = path.stat(), path.read_bytes()
                with mock.patch.object(self.recorder.os, 'replace') as replace:
                    second = self.recorder.record(path)
                replace.assert_not_called()
                self.assertEqual(second['status'], 'release160_metadata_already_recorded')
                self.assertEqual(path.read_bytes(), original)
                self.assertEqual((before.st_dev, before.st_ino, before.st_mtime_ns),
                                 (path.stat().st_dev, path.stat().st_ino, path.stat().st_mtime_ns))
                self.assertEqual(pins.call_count, 2)

    def test_replace_failure_and_concurrent_drift_preserve_original_bytes(self):
        with tempfile.TemporaryDirectory(dir=ROOT.parent.parent, prefix='record-release160-fixture-') as temporary:
            root = Path(temporary)
            path, original = self.write_checkpoint(root, 'replace-failure.json')
            inode = path.stat().st_ino
            with mock.patch.object(self.recorder, 'verify_pins'), \
                    mock.patch.object(self.recorder.os, 'replace', side_effect=OSError('synthetic replace failure')):
                with self.assertRaises(OSError): self.recorder.record(path)
            self.assertEqual(path.read_bytes(), original)
            self.assertEqual(path.stat().st_ino, inode)
            self.assertEqual(list(root.glob('.release160-*')), [])
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
            self.assertEqual(list(root.glob('.release160-*')), [])

    def test_duplicate_keys_bad_permissions_and_symlinks_refused(self):
        with self.assertRaisesRegex(self.recorder.RecordError, 'DUPLICATE_KEY'):
            json.loads('{"a":1,"a":2}', object_pairs_hook=self.recorder.unique_object)
        with tempfile.TemporaryDirectory(dir=ROOT.parent.parent, prefix='record-release160-fixture-') as temporary:
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
        with tempfile.TemporaryDirectory(dir=ROOT.parent.parent, prefix='record-release160-fixture-') as temporary:
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
            self.assertEqual(list(root.glob('.release160-*')), [])

    def test_pin_verification_checks_both_sources_launchers_node_prechecks_and_logs(self):
        # Expected bytes derive from pinned151 check() and JSON.stringify(report)+newline.
        canonical = b'{"version":1,"type":"local_closure_precheck","status":"passed","scope":"local_application","pendingClosures":false,"started":false,"erased":false,"externalContinuityVerified":false}\n'
        self.assertEqual(hashlib.sha256(canonical).hexdigest(), self.recorder.PRECHECK_SHA_AFTER_SUCCESS)
        self.assertEqual(self.recorder.ROLLBACK['precheckLogSha256'], self.recorder.PRECHECK_SHA_AFTER_SUCCESS)
        with tempfile.TemporaryDirectory(dir=ROOT.parent.parent, prefix='record-release160-pins-') as temporary:
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
        with tempfile.TemporaryDirectory(dir=ROOT.parent.parent, prefix='record-release160-refusal-') as temporary:
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
