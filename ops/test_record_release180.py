"""Synthetic metadata transition; no network, SQL, runtime or hosting operation.

The fixture uses real files, permissions, links, JSON receipts and atomic writes.
Only Git source inspection and public HTTP transport are substituted.
"""
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

HELPER = Path(__file__).with_name('record-release180.py')
SCRATCH = HELPER.parent.parent
BASE_NAMES = sorted(['runtime-database.json', 'runtime-auth.json', 'runtime-messaging.json',
    'runtime-media.json', 'runtime-notifications.json', 'runtime-crm.json'])
BUNDLE_NAMES = sorted(BASE_NAMES + ['runtime-video.json'])


class Recording(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location('record180_synthetic', HELPER)
        self.m = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.m)
        self.temp = tempfile.TemporaryDirectory(prefix='record180-synthetic-', dir=SCRATCH)
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.private = self.root / 'private'; self.private.mkdir(mode=0o700)
        self.operator = self.root / 'operator'; self.operator.mkdir(mode=0o700)
        self.m.PRIVATE = self.private
        self.m.OPERATOR = self.operator
        self.stage = dict(format='jessiemessage-release180-staging', version=1,
            status='release180_sources_staged_not_qualified', releases=[], nodeVersion='v24.22.1',
            expectedActiveServiceVersion='1.7.1', priorActivePreserved=True, rollbackRelease='1.7.2',
            rollbackPrepared=True, rollbackHostedQualified=False,
            videoConfigurationDirectory=str(self.private/'runtime-video-180'),
            operationsDirectory=str(self.private/'recurring-backup-052'), baselineMigrationFiles=33,
            schemaMigrationsExpected=36, normalMigrationsPreserved=True,
            candidateVideoMigrationsIdentical=True, sqlStatusChecked=False,
            videoConfigurationPrepared=False, hostedQualified=False, started=False, migrated=False,
            runtimeStarted=False, noRestart=True, managerChanged=False, checkpointChanged=False)
        for version in ['1.7.2', '1.8.0']:
            release = {name:str(value) if isinstance(value,Path) else value
                for name,value in self.m.release(version).items()}
            release.update(launcherMode='0700', checkLauncherMode='0700', logMode='0600',
                logSha256=self.m.digest(b''), precheckLogMode='0600', precheckLogSha256=self.m.digest(b''),
                profile='photos-notify-recovery-crm-broadcast-video',
                videoConfigurationDirectory=str(self.private/'runtime-video-180'),
                videoConfigurationPrepared=False, hostedQualified=False, started=False,
                migrated=False, precheckPassed=False)
            self.stage['releases'].append(release)
        self.node = self.private / 'runtime-node-v24.22.1/bin/node'
        self.node.parent.mkdir(parents=True)
        self.write(self.node, b'synthetic-only Node binary; never executed', 0o700)
        self.m.NODE_SHA = self.m.digest(self.node.read_bytes())
        self.stage['nodeBinarySha256'] = self.m.NODE_SHA
        self.home = b'<!doctype html>synthetic-only qualified180 home'
        self.check_data = json.dumps(self.m.PRECHECK, separators=(',', ':')).encode() + b'\n'
        self.checks = []
        for index, release in enumerate(self.stage['releases']):
            checkout = Path(release['checkout']); checkout.mkdir()
            (checkout / 'public').mkdir(); (checkout / 'public/index.html').write_bytes(self.home)
            for field, hash_field in [('launcher', 'launcherSha256'), ('checkLauncher', 'checkLauncherSha256')]:
                path = Path(release[field]); data = f'#!/bin/bash\n# synthetic-only {index} {field}\n'.encode()
                self.write(path, data, 0o700); release[hash_field] = self.m.digest(data)
            self.write(Path(release['log']), b'')
            check = Path(release['precheckLog']); self.write(check, self.check_data); self.checks.append(check)
        self.source171 = self.operator / 'production-171-c2d7b3b3'; self.source171.mkdir()
        self.active = dict(source=self.m.OLD_SOURCE, tree=self.m.OLD_TREE,
            checkout=str(self.source171), release='1.7.1', nodeAfterDeployment='v24.22.1',
            nodeBinary=str(self.node), nodeBinarySha256=self.m.NODE_SHA, schemaMigrations=33,
            mode='start-local-closures', port=3000,
            status='identity_observed_via_startup_log_and_public_http',
            evidence=dict(release=dict(version='1.7.1', commit=self.m.OLD_SOURCE,
                nodeVersion='v24.22.1', startedAt=1792590000000)))
        self.document = dict(activeService=copy.deepcopy(self.active),
            developmentSimplification=dict(release160=dict(rollback={'release':'1.5.1','preserve':[1,2]}),
                release171=dict(status='identity_observed_via_startup_log_and_public_http',
                    rollback=dict(release='1.6.0', nodeVersion='v24.22.1', schemaMigrations=33),
                    priorActiveService=dict(release='1.6.0', preserve='history')),
                custom={'preserve':['unknown', {'nested':True}]}),
            preservedPC={'quarantine':True,'markers':['C1','C2','C3','C4','C5']},
            extension={'unknown':'retained'})
        self.checkpoint = self.private / 'jm0702-existing-pc-update.json'
        self.json(self.checkpoint, self.document)
        self.original = self.checkpoint.read_bytes(); self.m.CHECKPOINT_SHA = self.m.digest(self.original)
        self.stage_path = self.private / 'jm180-staging.json'
        self.json(self.stage_path, self.stage); self.m.STAGING_SHA = self.m.digest(self.stage_path.read_bytes())
        self.bundle = self.private / 'runtime-video-180'; self.bundle.mkdir(mode=0o700)
        self.source6 = self.private / 'primary-origin-candidate-4a355851'; self.source6.mkdir(mode=0o700)
        self.video_root = self.private / 'video-180'; self.video_root.mkdir(mode=0o700)
        digest = hashlib.sha256()
        for name in BUNDLE_NAMES:
            data = ('  '+json.dumps({'format':'synthetic-only-'+name,'preserve':'fixture'})+'\n\n').encode()
            self.write(self.bundle/name, data)
            if name in BASE_NAMES: self.write(self.source6/name, data)
            digest.update(name.encode()); digest.update(b'\0'); digest.update(str(len(data)).encode()); digest.update(b'\0'); digest.update(data)
        self.m.BUNDLE_SHA = digest.hexdigest()
        self.video = dict(status='video180_runtime_prepared', files=7,
            existingConfigurationsByteExact=True, keysPreserved=True, independentVideoKey=True,
            emptyVideoRoot=True, bundleFingerprintSha256=self.m.BUNDLE_SHA,
            quotas=dict(ownerBytes='1073741824',totalBytes='10737418240',minimumFreeBytes='536870912'),
            source=self.m.SOURCE, tree=self.m.TREE, sqlConnected=False, schemaInitialized=False,
            runtimeStarted=False, managerChanged=False, checkpointChanged=False,
            format='jessiemessage-video180-runtime-preparation', version=1,
            observedAtUTC='2026-10-22T10:58:50.619683+00:00',
            operatorSource='79680445793a160be8f96f82c7337e260e944808',
            helperSha256='f9180f1db9e1ce7901d14c6c44c7e2827dedabb3db6ed7a218adf32dce0a5442',
            stagingReceiptSha256=self.m.STAGING_SHA)
        self.video_path = self.private / 'jm180-video-runtime-preparation.json'
        self.json(self.video_path, self.video); self.m.VIDEO_RECEIPT_SHA = self.m.digest(self.video_path.read_bytes())
        self.release = dict(version='1.8.0', commit=self.m.SOURCE, nodeVersion='v24.22.1', startedAt=1792600000000)
        self.log = self.private / 'jm180-node24221.log'
        self.log_data = b'JessieMessage listening on port 3000\n' + json.dumps(dict(version=1,
            type='application_started', release=self.release), separators=(',', ':')).encode() + b'\n'
        self.write(self.log, self.log_data)
        self.http = dict(health=dict(url='https://jessiemessage.com/api/health',status=200,body={'status':'ok'}),
            ready=dict(url='https://jessiemessage.com/api/ready',status=200,body={'status':'ready'}),
            home=dict(url='https://jessiemessage.com/',status=200,sha256=self.m.digest(self.home)),
            entry=dict(url='https://jessiemessage.com/api/entry',status=200,administrator=None))

    def write(self, path, data, mode=0o600):
        path.write_bytes(data); path.chmod(mode)

    def json(self, path, value):
        self.write(path, (json.dumps(value, ensure_ascii=False, indent=2)+'\n').encode())

    def unchanged(self):
        self.assertEqual(self.checkpoint.read_bytes(), self.original)
        self.assertEqual(list(self.private.glob('.release180-*')), [])

    def source_fixture(self, root, sha, tree, version):
        normal = [(f'{i:04d}_fixture.sql', 'a'*64) for i in range(1,34)]
        video = [('0034_video_storage_state.sql', 'b'*64),
            ('0035_video_assets.sql', 'c'*64), ('0036_message_video.sql', 'd'*64)]
        return {'normalized':'same locked dependencies'}, normal, [] if version=='1.7.1' else video

    def record(self):
        with patch.object(self.m, 'source', side_effect=self.source_fixture), \
                patch.object(self.m, 'collect_http', return_value=copy.deepcopy(self.http)):
            return self.m.record()

    def test_transition_preserves_all_history_and_exact_retry_is_read_only(self):
        before_stage = self.stage_path.read_bytes(); before_video = self.video_path.read_bytes()
        result = self.record()
        self.assertEqual(result['status'], 'release180_metadata_recorded')
        self.assertTrue(result['metadataOnly']); self.assertTrue(result['noRestart'])
        self.assertEqual(result['schemaMigrations'],36)
        value = json.loads(self.checkpoint.read_bytes())
        self.assertEqual(value['activeService']['release'],'1.8.0')
        self.assertEqual(value['activeService']['source'],self.m.SOURCE)
        self.assertEqual(value['activeService']['schemaMigrations'],36)
        section = value['developmentSimplification']['release180']
        self.assertEqual(section['priorActiveService'],self.active)
        self.assertEqual(section['rollback']['release'],'1.7.2')
        self.assertEqual(section['rollback']['status'],'hosted_precheck_passed_not_started')
        restored=copy.deepcopy(value); restored['activeService']=copy.deepcopy(self.active)
        del restored['developmentSimplification']['release180']
        self.assertEqual(restored,self.document)
        self.assertEqual(self.stage_path.read_bytes(),before_stage)
        self.assertEqual(self.video_path.read_bytes(),before_video)
        self.assertEqual(self.checkpoint.stat().st_mode & 0o777,0o600)
        before=self.m.fingerprint(self.checkpoint.stat())
        with patch.object(self.m.os,'replace',side_effect=AssertionError('exact retry must not replace')):
            self.assertEqual(self.record()['status'],'release180_metadata_already_recorded')
        self.assertEqual(self.m.fingerprint(self.checkpoint.stat()),before)
        self.assertEqual(list(self.private.glob('.release180-*')),[])

    def test_unqualified_source_refuses_before_private_file_reads(self):
        self.m.SOURCE='QUALIFICATION_REQUIRED_SOURCE180'
        with patch.object(self.m,'file',side_effect=AssertionError('private read forbidden')):
            with self.assertRaises(self.m.RecordError): self.record()
        self.unchanged()

    def test_pinned_receipts_and_actual_bundle_copies_refuse_drift(self):
        paths=[self.stage_path,self.video_path,self.bundle/'runtime-video.json',self.source6/'runtime-crm.json']
        for path in paths:
            original=path.read_bytes();self.write(path,original+b' ')
            with self.subTest(path=path.name),self.assertRaises(self.m.RecordError):self.record()
            self.write(path,original);self.unchanged()
        changed=copy.deepcopy(self.stage);changed['started']=True;self.json(self.stage_path,changed)
        with self.assertRaises(self.m.RecordError):self.record()
        self.unchanged()

    def test_binary_and_launcher_drift_refuse_before_metadata(self):
        for path in [self.node,Path(self.stage['releases'][0]['launcher']),Path(self.stage['releases'][1]['checkLauncher'])]:
            original=path.read_bytes();mode=path.stat().st_mode & 0o777
            self.write(path,original+b'drift',mode)
            with self.subTest(path=path.name),self.assertRaises(self.m.RecordError):self.record()
            self.write(path,original,mode);self.unchanged()

    def test_prechecks_are_video_version2_success_without_pending_and_rollback_never_started(self):
        for path in self.checks:
            for data in [b'',json.dumps(dict(self.m.PRECHECK,version=1)).encode()+b'\n',
                    json.dumps(dict(self.m.PRECHECK,pendingClosures=True)).encode()+b'\n']:
                self.write(path,data)
                with self.subTest(path=path.name,data=data),self.assertRaises(self.m.RecordError):self.record()
                self.unchanged()
            self.write(path,self.check_data)
        path=self.private/'jm172-node24221.log';self.write(path,b'started rollback unexpectedly\n')
        with self.assertRaises(self.m.RecordError):self.record()
        self.unchanged()

    def test_actual_unique_startup_identity_is_required_even_when_public_http_is_good(self):
        cases=[b'configured but never started\n',self.log_data+self.log_data,
            self.log_data.replace(b'1.8.0',b'1.7.1'),self.log_data.replace(self.m.SOURCE.encode(),b'0'*40),
            self.log_data.replace(b'v24.22.1',b'v24.22.0'),
            self.log_data.replace(b'"startedAt":1792600000000',b'"startedAt":true')]
        for data in cases:
            self.write(self.log,data)
            with self.subTest(data=data[:80]),self.assertRaises(self.m.RecordError):self.record()
            self.unchanged()

    def test_non_startup_live_log_appends_preserve_identity_digest_and_read_only_retry(self):
        self.record();before=self.checkpoint.read_bytes()
        with self.log.open('ab') as f:f.write(b'{"version":1,"type":"worker_available"}\n')
        with patch.object(self.m.os,'replace',side_effect=AssertionError('live log append is not metadata drift')):
            self.assertEqual(self.record()['status'],'release180_metadata_already_recorded')
        self.assertEqual(self.checkpoint.read_bytes(),before)

    def test_public_http_must_be_healthy_ready_and_match_qualified_home(self):
        mutations=[lambda v:v['health'].update(status=503,body={'status':'unavailable'}),
            lambda v:v['ready'].update(status=503,body={'status':'unavailable'}),
            lambda v:v['home'].update(sha256='0'*64),
            lambda v:v['entry'].update(administrator={'role':'admin'}),
            lambda v:v['health'].update(url='https://recette.jessiemessage.com/api/health')]
        original=copy.deepcopy(self.http)
        for change in mutations:
            self.http=copy.deepcopy(original);change(self.http)
            with self.assertRaises(self.m.RecordError):self.record()
            self.unchanged()

    def test_checkpoint_baseline_and_active_identity_must_match(self):
        self.write(self.checkpoint,self.original+b' ')
        with self.assertRaises(self.m.RecordError):self.record()
        self.unchanged_after_restore()
        for field,value in [('release','1.6.0'),('source','0'*40),('nodeAfterDeployment','v24.22.0'),('schemaMigrations',36)]:
            document=copy.deepcopy(self.document);document['activeService'][field]=value
            self.json(self.checkpoint,document);self.m.CHECKPOINT_SHA=self.m.digest(self.checkpoint.read_bytes())
            before=self.checkpoint.read_bytes()
            with self.subTest(field=field),self.assertRaises(self.m.RecordError):self.record()
            self.assertEqual(self.checkpoint.read_bytes(),before)
        self.write(self.checkpoint,self.original);self.m.CHECKPOINT_SHA=self.m.digest(self.original)

    def unchanged_after_restore(self):
        self.write(self.checkpoint,self.original);self.unchanged()

    def test_atomic_replace_and_sync_failures_preserve_old_checkpoint_and_cleanup(self):
        for target in ['replace','fsync']:
            with patch.object(self.m.os,target,side_effect=OSError('synthetic publication failure')):
                with self.assertRaises(OSError):self.record()
            self.unchanged()
        with patch.object(self.m.os,'fsync',wraps=self.m.os.fsync) as sync:
            self.record();self.assertGreaterEqual(sync.call_count,2)
        self.assertEqual(list(self.private.glob('.release180-*')),[])

    def test_concurrent_drift_and_divergent_retry_refuse_without_overwriting_evidence(self):
        sync=self.m.os.fsync;changed=False
        def drift(fd):
            nonlocal changed
            sync(fd)
            if not changed:
                changed=True
                with self.checkpoint.open('ab') as f:f.write(b' ')
        with patch.object(self.m.os,'fsync',side_effect=drift):
            with self.assertRaises(self.m.RecordError):self.record()
        self.assertEqual(self.checkpoint.read_bytes(),self.original+b' ')
        self.unchanged_after_restore();self.record()
        value=json.loads(self.checkpoint.read_bytes());value['extension']['unknown']='unexpected drift'
        self.json(self.checkpoint,value);before=self.checkpoint.read_bytes()
        with self.assertRaises(self.m.RecordError):self.record()
        self.assertEqual(self.checkpoint.read_bytes(),before)
        self.assertEqual(list(self.private.glob('.release180-*')),[])

    def test_private_modes_symlinks_hardlinks_fifo_and_duplicate_json_keys_refuse(self):
        original=self.video_path.read_bytes()
        self.video_path.chmod(0o644)
        with self.assertRaises(self.m.RecordError):self.record()
        self.video_path.chmod(0o600);self.unchanged()
        for kind in ['symlink','hardlink','fifo']:
            self.video_path.unlink()
            if kind=='symlink':self.video_path.symlink_to(self.stage_path)
            elif kind=='hardlink':os.link(self.stage_path,self.video_path)
            else:os.mkfifo(self.video_path,0o600)
            with self.subTest(kind=kind),self.assertRaises(self.m.RecordError):self.record()
            self.video_path.unlink();self.write(self.video_path,original);self.unchanged()
        self.write(self.checkpoint,b'{"activeService":{},"activeService":{}}')
        with self.assertRaises(self.m.RecordError):self.record()
        self.assertEqual(list(self.private.glob('.release180-*')),[])

    def test_directory_sync_failure_after_replace_converges_by_read_only_retry(self):
        sync=self.m.os.fsync;calls=0
        def directory_failure(fd):
            nonlocal calls
            calls+=1
            if calls==2:raise OSError('synthetic directory sync failure after replace')
            sync(fd)
        with patch.object(self.m.os,'fsync',side_effect=directory_failure):
            with self.assertRaisesRegex(OSError,'directory sync failure after replace'):self.record()
        self.assertEqual(calls,2)
        value=json.loads(self.checkpoint.read_bytes())
        self.assertEqual(value['activeService']['release'],'1.8.0')
        self.assertEqual(value['activeService']['schemaMigrations'],36)
        self.assertIn('release180',value['developmentSimplification'])
        self.assertEqual(list(self.private.glob('.release180-*')),[])
        before=self.checkpoint.read_bytes();identity=self.m.fingerprint(self.checkpoint.stat())
        with patch.object(self.m.os,'replace',side_effect=AssertionError('partial success retry must not replace')):
            self.assertEqual(self.record()['status'],'release180_metadata_already_recorded')
        self.assertEqual(self.checkpoint.read_bytes(),before)
        self.assertEqual(self.m.fingerprint(self.checkpoint.stat()),identity)


if __name__ == '__main__':
    unittest.main(verbosity=2)
