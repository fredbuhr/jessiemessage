"""Synthetic private files only; no hosting, network, real SQL or runtime start.

Real launcher transformations, file modes/identities, receipts, startup log,
checkpoint baseline, fsync/replace and readback are exercised. Git checkout
inspection is substituted; no synthetic executable is run.
"""
import copy
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

HELPER = Path(__file__).with_name('record-release171.py')
SCRATCH = HELPER.parent.parent


class Recording(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location('record171_test', HELPER)
        self.m = importlib.util.module_from_spec(spec); spec.loader.exec_module(self.m)
        self.temp = tempfile.TemporaryDirectory(prefix='record171-synthetic-', dir=SCRATCH)
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.private = self.root / 'private'; self.private.mkdir(mode=0o700)
        self.m.PRIVATE = self.private
        self.m.OLD = self.root / 'production-160-9590741e'; self.m.OLD.mkdir()
        self.m.SOURCE, self.m.TREE = 'b' * 40, 'c' * 40
        self.target = self.m.target(); self.target.mkdir()
        (self.target / 'public').mkdir()
        (self.target / 'public/index.html').write_bytes(b'<!doctype html>synthetic homepage171')
        old_node = self.private / 'runtime-node-v24.22.0/bin/node'
        new_node = self.private / 'runtime-node-v24.22.1/bin/node'
        old_node.parent.mkdir(parents=True); new_node.parent.mkdir(parents=True)
        self.write(old_node, b'synthetic old binary', 0o700)
        self.write(new_node, b'synthetic new binary', 0o700)
        self.m.OLD_NODE_SHA = self.m.digest(old_node.read_bytes())
        self.m.NODE_SHA = self.m.digest(new_node.read_bytes())
        for kind, log, command in [('start', 'jm160-node2422.log', 'start-local-closures'),
                                  ('check', 'jm160-preflight-9590741e.log', 'check-local-closures')]:
            text = (f'#!/bin/bash\n# source {self.m.OLD_SHA}\n# tree {self.m.OLD_TREE}\n'
                f'# Node v24.22.0 {self.m.OLD_NODE_SHA}\n# node {old_node}\n'
                f'test "{old_node}" = "{old_node}"\ncd "{self.m.OLD}"\n'
                f'exec /bin/echo {command} --runtime-directory "{self.m.OLD}" '
                f'--runtime-head {self.m.OLD_SHA} --runtime-tree {self.m.OLD_TREE} >> "{self.private / log}" 2>&1\n')
            path = self.private / f'{kind}-primary-release160-9590741e.sh'
            self.write(path, text.encode(), 0o700)
            setattr(self.m, 'START_PIN' if kind == 'start' else 'CHECK_PIN', self.m.digest(path.read_bytes()))
        self.plans171, self.plans160 = self.m.launcher_plans()
        for path, data, mode in self.plans171 + self.plans160:
            self.write(path, data, mode)
        self.check_data = json.dumps(self.m.PRECHECK, separators=(',', ':')).encode() + b'\n'
        self.write(self.plans171[3][0], self.check_data)
        self.write(self.plans160[3][0], self.check_data)
        self.release = dict(version='1.7.1', commit=self.m.SOURCE, nodeVersion='v24.22.1', startedAt=1792600000000)
        self.log = self.private / 'jm171-node24221.log'
        self.log_data = b'JessieMessage listening on port 3000\n' + json.dumps(dict(version=1,
            type='application_started', release=self.release), separators=(',', ':')).encode() + b'\n'
        self.write(self.log, self.log_data)
        common = dict(nodeVersion='v24.22.1', nodeBinary=str(new_node), nodeBinarySha256=self.m.NODE_SHA,
            precheckPassed=False, runtimeStarted=False, managerChanged=False, checkpointChanged=False,
            migrated=False, noRestart=True)
        self.stage171 = self.private / 'staging171.json'
        self.stage160 = self.private / 'staging160-node24221.json'
        self.json(self.stage171, dict(**common, status='release171_staged_not_checked', version='1.7.1',
            source=self.m.SOURCE, tree=self.m.TREE, checkout=str(self.target),
            files=self.m.files_receipt(self.plans171), schemaMigrationsExpected=33,
            migrationsUnchanged=True, dependenciesUnchanged=True, preservedSource160=self.m.OLD_SHA,
            rollback160Node24221PrecheckRequired=True, rollback151AndOriginal160Preserved=True))
        self.json(self.stage160, dict(**common, status='node24221_prepared_not_started', source=self.m.OLD_SHA,
            tree=self.m.OLD_TREE, applicationVersion='1.6.0', files=self.m.files_receipt(self.plans160),
            preservedNode=str(old_node), preservedLaunchers=[str(self.private / f'{kind}-primary-release160-9590741e.sh')
                for kind in ('start', 'check')]))
        self.observed = self.private / 'observation171.json'
        self.obs = dict(version=1, type='hosted_release_observation', provenance='hosted_startup_log_and_public_http',
            observedAtUTC='2026-10-21T19:00:00Z', source=self.m.SOURCE, tree=self.m.TREE,
            release=self.release, startupLog=str(self.log), startupLogSha256=self.m.digest(self.log_data),
            http=dict(health=dict(url='https://jessiemessage.com/api/health', status=200, body=dict(status='ok')),
                ready=dict(url='https://jessiemessage.com/api/ready', status=200, body=dict(status='ready')),
                home=dict(url='https://jessiemessage.com/', status=200,
                    sha256=self.m.digest((self.target / 'public/index.html').read_bytes())),
                entry=dict(url='https://jessiemessage.com/api/entry', status=200, administrator=None)))
        self.json(self.observed, self.obs)
        self.document = dict(activeService=copy.deepcopy(self.m.CURRENT_ACTIVE),
            developmentSimplification=dict(release160=dict(rollback=dict(release='1.5.1', nested=['preserve', {'proof': True}]),
                priorActiveService=dict(release='1.5.0', arbitrary='history'), recordedAt='2026-10-21T18:00:00Z'),
                historicalProof={'unknown': ['kept']}),
            preservedPC=dict(quarantine=True, markers=['C1', 'C5']), extension=dict(unknown='retained'))
        self.checkpoint = self.private / 'jm0702-existing-pc-update.json'
        self.json(self.checkpoint, self.document)
        self.original = self.checkpoint.read_bytes()
        self.m.CHECKPOINT_SHA = self.m.digest(self.original)
        self.m.RELEASE160_SHA = self.m.digest(self.m.canonical(self.document['developmentSimplification']['release160']))

    def write(self, path, data, mode=0o600):
        path.write_bytes(data); path.chmod(mode)

    def json(self, path, value):
        self.write(path, (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode())

    def record(self):
        with patch.object(self.m, 'source', return_value=({'normalized': 'dependencies'}, [('33', 'pinned')])):
            return self.m.record(self.stage171, self.stage160, self.observed)

    def unchanged(self):
        self.assertEqual(self.checkpoint.read_bytes(), self.original)
        self.assertEqual(list(self.private.glob('.release171-*')), [])

    def test_record_preserves_all_other_blocks_and_retry_has_no_write(self):
        result = self.record()
        self.assertEqual(result['status'], 'release171_metadata_recorded')
        self.assertTrue(result['metadataOnly']); self.assertTrue(result['noRestart'])
        updated = json.loads(self.checkpoint.read_bytes())
        self.assertEqual(updated['developmentSimplification']['release160'], self.document['developmentSimplification']['release160'])
        self.assertEqual(updated['developmentSimplification']['release171']['priorActiveService'], self.m.CURRENT_ACTIVE)
        self.assertEqual(updated['developmentSimplification']['release171']['rollback']['status'], 'hosted_precheck_passed_not_started')
        restored = copy.deepcopy(updated)
        restored['activeService'] = self.document['activeService']
        del restored['developmentSimplification']['release171']
        self.assertEqual(restored, self.document)
        self.assertEqual(self.checkpoint.stat().st_mode & 0o777, 0o600)
        before = self.m.fingerprint(self.checkpoint.stat())
        with patch.object(self.m.os, 'replace', side_effect=AssertionError('retry must not write')):
            self.assertEqual(self.record()['status'], 'release171_metadata_already_recorded')
        self.assertEqual(before, self.m.fingerprint(self.checkpoint.stat()))

    def test_unqualified_draft_refuses_before_private_reads(self):
        self.m.SOURCE = 'QUALIFICATION_REQUIRED_MERGED_SHA171'
        self.m.PRIVATE = Path('/no-host-path-may-be-read')
        with patch.object(self.m, 'file', side_effect=AssertionError('private read')):
            with self.assertRaisesRegex(self.m.RecordError, 'QUALIFICATION_REQUIRED'): self.record()
        self.unchanged()

    def test_checkpoint_bytes_and_release160_and_current_active_divergence_refuse(self):
        self.write(self.checkpoint, self.original + b' ')
        with self.assertRaisesRegex(self.m.RecordError, 'CHECKPOINT_PIN'): self.record()
        self.write(self.checkpoint, self.original)
        self.m.RELEASE160_SHA = '0' * 64
        with self.assertRaisesRegex(self.m.RecordError, 'RELEASE160_DRIFT'): self.record()
        self.m.RELEASE160_SHA = self.m.digest(self.m.canonical(self.document['developmentSimplification']['release160']))
        self.document['activeService']['source'] = '0' * 40
        self.json(self.checkpoint, self.document)
        self.m.CHECKPOINT_SHA = self.m.digest(self.checkpoint.read_bytes())
        with self.assertRaisesRegex(self.m.RecordError, 'CURRENT_ACTIVE_DRIFT'): self.record()
        self.assertNotIn('release171', json.loads(self.checkpoint.read_bytes())['developmentSimplification'])

    def test_preparation_claims_and_actual_launcher_binary_drift_refuse(self):
        for path in (self.stage171, self.stage160):
            old = path.read_bytes(); value = json.loads(old); value['runtimeStarted'] = True; self.json(path, value)
            with self.assertRaisesRegex(self.m.RecordError, 'PREPARATION_RECEIPT'): self.record()
            self.write(path, old)
        path = self.plans171[0][0]; old = path.read_bytes(); self.write(path, old + b'# drift\n', 0o700)
        with self.assertRaisesRegex(self.m.RecordError, 'LAUNCHER_PIN'): self.record()
        self.write(path, old, 0o700)
        self.write(self.private / 'runtime-node-v24.22.1/bin/node', b'wrong binary', 0o700)
        with self.assertRaisesRegex(self.m.RecordError, 'NODE_PIN'): self.record()
        self.unchanged()

    def test_prechecks_require_success_and_pending_false_and_rollback_never_started(self):
        for path in (self.plans171[3][0], self.plans160[3][0]):
            self.write(path, b'')
            with self.assertRaisesRegex(self.m.RecordError, 'PRECHECK_NOT_PASSED'): self.record()
            self.write(path, json.dumps(dict(self.m.PRECHECK, pendingClosures=True)).encode() + b'\n')
            with self.assertRaisesRegex(self.m.RecordError, 'PRECHECK_NOT_PASSED'): self.record()
            self.write(path, self.check_data)
        self.write(self.plans160[1][0], b'already started\n')
        with self.assertRaisesRegex(self.m.RecordError, 'ROLLBACK_ALREADY_STARTED'): self.record()
        self.unchanged()

    def test_repeated_successful_check_receipts_are_allowed(self):
        self.write(self.plans171[3][0], self.check_data * 2)
        self.assertEqual(self.record()['status'], 'release171_metadata_recorded')
        value = json.loads(self.checkpoint.read_bytes())
        self.assertEqual(value['developmentSimplification']['release171']['evidence']['prechecks']['release171']['passedReceipts'], 2)

    def test_real_startup_record_required_unique_and_identity_exact(self):
        for log in (b'configured but never started\n', self.log_data + self.log_data,
                    self.log_data.replace(b'v24.22.1', b'v24.22.0'),
                    self.log_data.replace(b'"startedAt":1792600000000', b'"startedAt":true')):
            self.write(self.log, log)
            with self.assertRaisesRegex(self.m.RecordError, 'STARTUP_'): self.record()
        self.unchanged()

    def test_injected_observation_must_match_real_log_and_public_home(self):
        for mutation, code in (
            (lambda v: v.update(provenance='admin_readiness_user_report'), 'OBSERVATION_IDENTITY'),
            (lambda v: v.update(startupLogSha256='0' * 64), 'OBSERVATION_LOG'),
            (lambda v: v.update(observedAtUTC='2026-10-21T19:00:00'), 'OBSERVATION_DATE'),
            (lambda v: v['http']['home'].update(sha256='0' * 64), 'PUBLIC_HOME'),
            (lambda v: v['http']['entry'].update(administrator={'destination': '/admin'}), 'PUBLIC_ENTRY'),
            (lambda v: v['http']['health'].update(url='https://recette.jessiemessage.com/api/health'), 'PUBLIC_HTTP')):
            value = copy.deepcopy(self.obs); mutation(value); self.json(self.observed, value)
            with self.assertRaisesRegex(self.m.RecordError, code): self.record()
            self.unchanged()

    def test_ready503_is_recorded_as_unavailable_without_weakening_guard(self):
        self.obs['http']['ready'].update(status=503, body=dict(status='unavailable'))
        self.json(self.observed, self.obs)
        result = self.record()
        self.assertFalse(result['publicReady'])
        identity = json.loads(self.checkpoint.read_bytes())['activeService']['evidence']
        self.assertIn('public_readiness_unavailable_at_observation', identity['limitations'])
        self.assertEqual(identity['publicHttp']['ready']['status'], 503)
        self.assertFalse(identity['publicHttpIdentityExposed'])
        self.assertNotIn('admin_readiness_user_report', identity['provenance'])

    def test_atomic_write_sync_replace_readback_and_failure_before_replace_preserves(self):
        with patch.object(self.m.os, 'replace', side_effect=OSError('synthetic replace failure')):
            with self.assertRaisesRegex(OSError, 'synthetic replace failure'): self.record()
        self.unchanged()
        real_fsync = self.m.os.fsync
        with patch.object(self.m.os, 'fsync', side_effect=OSError('synthetic sync failure')):
            with self.assertRaisesRegex(OSError, 'synthetic sync failure'): self.record()
        self.unchanged()
        with patch.object(self.m.os, 'fsync', wraps=real_fsync) as sync:
            self.record(); self.assertEqual(sync.call_count, 2)
        self.assertEqual(list(self.private.glob('.release171-*')), [])

    def test_drift_before_replace_and_divergent_retry_refuse(self):
        original_fsync = self.m.os.fsync
        changed = False
        def drift(fd):
            nonlocal changed
            original_fsync(fd)
            if not changed:
                changed = True
                with self.checkpoint.open('ab') as output: output.write(b' ')
        with patch.object(self.m.os, 'fsync', side_effect=drift):
            with self.assertRaisesRegex(self.m.RecordError, 'CHECKPOINT_CHANGED'): self.record()
        self.assertEqual(self.checkpoint.read_bytes(), self.original + b' ')
        self.write(self.checkpoint, self.original)
        self.record()
        updated = json.loads(self.checkpoint.read_bytes()); updated['extension']['unknown'] = 'drift'
        self.json(self.checkpoint, updated)
        divergent = self.checkpoint.read_bytes()
        with self.assertRaisesRegex(self.m.RecordError, 'EXISTING_SECTION_DIVERGENT'): self.record()
        self.assertEqual(self.checkpoint.read_bytes(), divergent)

    def test_private_modes_symlinks_hardlinks_duplicate_keys_and_fifo_refuse(self):
        self.observed.chmod(0o644)
        with self.assertRaisesRegex(self.m.RecordError, 'FILE_METADATA'): self.record()
        self.observed.chmod(0o600)
        original = self.observed.read_bytes()
        self.observed.unlink(); self.observed.symlink_to(self.stage171)
        with self.assertRaisesRegex(self.m.RecordError, 'FILE_PATH'): self.record()
        self.observed.unlink(); os.link(self.stage171, self.observed)
        with self.assertRaisesRegex(self.m.RecordError, 'FILE_METADATA'): self.record()
        self.observed.unlink(); os.mkfifo(self.observed, 0o600)
        with self.assertRaisesRegex(self.m.RecordError, 'FILE_METADATA'): self.record()
        self.observed.unlink(); self.write(self.observed, original)
        self.write(self.checkpoint, b'{"activeService":{},"activeService":{}}')
        with self.assertRaisesRegex(self.m.RecordError, 'DUPLICATE_KEY'): self.record()
        self.assertEqual(list(self.private.glob('.release171-*')), [])


if __name__ == '__main__':
    unittest.main(verbosity=2)
