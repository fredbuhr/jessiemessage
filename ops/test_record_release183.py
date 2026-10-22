"""Synthetic metadata transition; no network, SQL, runtime or hosting operation.

The fixture uses real files, permissions, links, JSON receipts and atomic writes.
Only Git source inspection and public HTTP transport are substituted.
"""
import copy
import hashlib
import importlib.util
import io
import json
import os
import re
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

HELPER = Path(__file__).with_name('record-release183.py')
SCRATCH = HELPER.parent.parent
BASE_NAMES = sorted(['runtime-database.json', 'runtime-auth.json', 'runtime-messaging.json',
    'runtime-media.json', 'runtime-notifications.json', 'runtime-crm.json'])
BUNDLE_NAMES = sorted(BASE_NAMES + ['runtime-video.json'])


def assert_pin_modes(test, module):
    # Shipped pins may be pending or finalized. This checks coherent shapes,
    # never treats a filled value as evidence of qualification or hosted state.
    source_pending = module.SOURCE == 'QUALIFICATION_PENDING'
    tree_pending = module.TREE == 'QUALIFICATION_PENDING'
    test.assertEqual(source_pending, tree_pending, 'source and tree must be finalized together')
    if not source_pending:
        test.assertTrue(re.fullmatch(r'[a-f0-9]{40}', module.SOURCE) is not None)
        test.assertTrue(re.fullmatch(r'[a-f0-9]{40}', module.TREE) is not None)
    stage_pending = module.STAGING_SHA == 'STAGING_PENDING'
    test.assertTrue(stage_pending or re.fullmatch(r'[a-f0-9]{64}', module.STAGING_SHA) is not None)
    test.assertTrue(module.RELEASE_ID is None or type(module.RELEASE_ID) is int and module.RELEASE_ID > 0)
    if source_pending:
        test.assertTrue(stage_pending, 'a staged receipt cannot precede qualified source/tree pins')
        test.assertIsNone(module.RELEASE_ID, 'publication identity cannot precede qualified source/tree pins')


class Recording(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location('record183_synthetic', HELPER)
        self.m = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.m)
        assert_pin_modes(self, self.m)
        self.assertEqual(self.m.STAGING182_SHA, 'ba1aa8d0527dd8bbff76c86e274c9681ce9b6546bfd997a47e44988a92e3157f')
        self.assertEqual(self.m.CHECKPOINT_SHA, '148b1e0f1ef0e585aa0e0be99ba4e65517b30d2827e3dc26768684bfc5afa280')
        self.assertEqual(self.m.OLD_SOURCE, '78e6b8b2f6b19020c060345b9313a81829e9c8da')
        self.assertEqual(self.m.OLD_TREE, '7b722ca1fbd3416acecffa3c122e967511184d4c')
        self.assertEqual(self.m.RELEASE_TAG, 'v1.8.3')
        self.temp = tempfile.TemporaryDirectory(prefix='record183-synthetic-', dir=SCRATCH)
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.private = self.root / 'private'; self.private.mkdir(mode=0o700)
        self.operator = self.root / 'operator'; self.operator.mkdir(mode=0o700)
        self.m.PRIVATE = self.private
        self.m.OPERATOR = self.operator
        self.m.SOURCE = 'a' * 40
        self.m.TREE = 'b' * 40
        self.m.RELEASE_ID = 183001  # synthetic fixture identity, not a real release pin
        self.published = dict(repository='fredbuhr/jessiemessage', releaseId=self.m.RELEASE_ID,
            tag='v1.8.3', source=self.m.SOURCE, tagObjectType='commit', latest='v1.8.3',
            latestSource=self.m.SOURCE, draft=False, prerelease=False, transport='anonymous_https_get_only')
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
        self.home = b'<!doctype html>synthetic-only historical home'
        self.home183_index = b'<!doctype html>synthetic-only183 inactive public index'
        self.home183_access = b'<!doctype html>synthetic-only183 active signed-out access'
        self.entry_response = dict(status='available', client=dict(state='signed_out', href='/access'), administrator=None)
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
        self.source182 = self.m.release('1.8.2')['checkout']
        self.active = dict(source=self.m.OLD_SOURCE, tree=self.m.OLD_TREE,
            checkout=str(self.source182), release='1.8.2', nodeAfterDeployment='v24.22.1',
            nodeBinary=str(self.node), nodeBinarySha256=self.m.NODE_SHA, schemaMigrations=36,
            mode='start-local-closures', port=3000,
            status='identity_observed_via_startup_log_and_public_http',
            evidence=dict(release=dict(version='1.8.2', commit=self.m.OLD_SOURCE,
                nodeVersion='v24.22.1', startedAt=1792590000000)))
        self.document = dict(activeService=copy.deepcopy(self.active),
            developmentSimplification=dict(release160=dict(rollback={'release':'1.5.1','preserve':[1,2]}),
                release171=dict(status='identity_observed_via_startup_log_and_public_http',
                    rollback=dict(release='1.6.0', nodeVersion='v24.22.1', schemaMigrations=33),
                    priorActiveService=dict(release='1.6.0', preserve='history')),
                release180=dict(status='identity_observed_via_startup_log_and_public_http',
                    rollback=self.m.service(self.m.release('1.7.2'), dict(
                        launchers={'1.7.2':self.stage['releases'][0]},
                        prechecks={'rollback172':self.m.precheck(self.checks[0])}), rollback=True),
                    priorActiveService=dict(release='1.7.1', preserve='history180')),
                release181=dict(status='identity_observed_via_startup_log_and_public_http',
                    rollback=self.m.service(self.m.release('1.7.2'), dict(
                        launchers={'1.7.2':self.stage['releases'][0]},
                        prechecks={'rollback172':self.m.precheck(self.checks[0])}), rollback=True),
                    priorActiveService=dict(release='1.8.0', preserve='history181')),
                release182=dict(status='identity_observed_via_startup_log_and_public_http',
                    rollback=self.m.service(self.m.release('1.7.2'), dict(
                        launchers={'1.7.2':self.stage['releases'][0]},
                        prechecks={'rollback172':self.m.precheck(self.checks[0])}), rollback=True),
                    priorActiveService=dict(release='1.8.1', preserve='history182')),
                custom={'preserve':['unknown', {'nested':True}]}),
            preservedPC={'quarantine':True,'markers':['C1','C2','C3','C4','C5']},
            extension={'unknown':'retained'})
        self.checkpoint = self.private / 'jm0702-existing-pc-update.json'
        self.json(self.checkpoint, self.document)
        self.original = self.checkpoint.read_bytes(); self.m.CHECKPOINT_SHA = self.m.digest(self.original)
        self.stage_path = self.private / 'jm180-staging.json'
        self.json(self.stage_path, self.stage); self.m.STAGING180_SHA = self.m.digest(self.stage_path.read_bytes())
        self.stage181 = {name:str(value) if isinstance(value,Path) else value
            for name,value in self.m.release('1.8.1').items()}
        self.stage181['release'] = self.stage181.pop('version')
        self.stage181.update(format='jessiemessage-release181-staging', version=1,
            status='release181_sources_staged_not_qualified', nodeVersion='v24.22.1',
            nodeBinarySha256=self.m.NODE_SHA, expectedActiveServiceVersion='1.8.0', priorActivePreserved=True,
            existingConfigurationUntouched=True, baselineMigrationFiles=33, schemaMigrationsExpected=36,
            normalMigrationsPreserved=True, videoMigrationsIdentical=True, sqlStatusChecked=False,
            configurationPrepared=False, hostedQualified=False, precheckPassed=False, started=False, migrated=False,
            runtimeStarted=False, noRestart=True, managerChanged=False, checkpointChanged=False,
            videoConfigurationDirectory=str(self.private/'runtime-video-180'),
            operationsDirectory=str(self.private/'recurring-backup-052'), profile=self.m.PROFILE)
        checkout=Path(self.stage181['checkout']); checkout.mkdir();(checkout/'public').mkdir()
        (checkout/'public/index.html').write_bytes(self.home)
        for field in ('launcher','checkLauncher'):
            data=f'#!/bin/bash\n# synthetic-only 181 {field}\n'.encode()
            self.write(Path(self.stage181[field]),data,0o700);self.stage181[field+'Sha256']=self.m.digest(data)
        self.write(Path(self.stage181['log']),b'')
        check=Path(self.stage181['precheckLog']);self.write(check,self.check_data);self.checks.append(check)
        self.stage181_path=self.private/'jm181-staging.json'
        self.json(self.stage181_path,self.stage181);self.m.STAGING181_SHA=self.m.digest(self.stage181_path.read_bytes())
        self.stage182 = {name:str(value) if isinstance(value,Path) else value
            for name,value in self.m.release('1.8.2').items()}
        self.stage182['release'] = self.stage182.pop('version')
        self.stage182.update({k:copy.deepcopy(v) for k,v in self.stage181.items() if k not in self.stage182})
        self.stage182.update(format='jessiemessage-release182-staging', status='release182_sources_staged_not_qualified',
            expectedActiveServiceVersion='1.8.1')
        checkout=Path(self.stage182['checkout']); checkout.mkdir();(checkout/'public').mkdir()
        (checkout/'public/index.html').write_bytes(self.home)
        for field in ('launcher','checkLauncher'):
            data=f'#!/bin/bash\n# synthetic-only182 {field}\n'.encode()
            self.write(Path(self.stage182[field]),data,0o700);self.stage182[field+'Sha256']=self.m.digest(data)
        self.write(Path(self.stage182['log']),b'')
        check=Path(self.stage182['precheckLog']);self.write(check,self.check_data);self.checks.append(check)
        self.stage182_path=self.private/'jm182-staging.json'
        self.json(self.stage182_path,self.stage182);self.m.STAGING182_SHA=self.m.digest(self.stage182_path.read_bytes())
        self.stage183 = {name:str(value) if isinstance(value,Path) else value
            for name,value in self.m.release('1.8.3').items()}
        self.stage183['release'] = self.stage183.pop('version')
        self.stage183.update({k:copy.deepcopy(v) for k,v in self.stage182.items() if k not in self.stage183})
        self.stage183.update(format='jessiemessage-release183-staging', status='release183_sources_staged_not_qualified',
            expectedActiveServiceVersion='1.8.2', preservedActiveCheckpointSha256=self.m.CHECKPOINT_SHA)
        checkout=Path(self.stage183['checkout']); checkout.mkdir();(checkout/'public').mkdir()
        (checkout/'public/index.html').write_bytes(self.home183_index)
        (checkout/'public/access.html').write_bytes(self.home183_access)
        for field in ('launcher','checkLauncher'):
            data=f'#!/bin/bash\n# synthetic-only183 {field}\n'.encode()
            self.write(Path(self.stage183[field]),data,0o700);self.stage183[field+'Sha256']=self.m.digest(data)
        self.write(Path(self.stage183['log']),b'')
        check=Path(self.stage183['precheckLog']);self.write(check,self.check_data);self.checks.append(check)
        self.stage183_path=self.private/'jm183-staging.json'
        self.json(self.stage183_path,self.stage183);self.m.STAGING_SHA=self.m.digest(self.stage183_path.read_bytes())
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
            quotas=dict(ownerBytes='1073741834',totalBytes='10737418340',minimumFreeBytes='536870912'),
            source=self.m.LEGACY180_SOURCE, tree=self.m.LEGACY180_TREE, sqlConnected=False, schemaInitialized=False,
            runtimeStarted=False, managerChanged=False, checkpointChanged=False,
            format='jessiemessage-video180-runtime-preparation', version=1,
            observedAtUTC='2026-10-22T10:58:50.619683+00:00',
            operatorSource='79680445793a160be8f96f82c7337e260e944808',
            helperSha256='f9180f1db9e1ce7901d14c6c44c7e2827dedabb3db6ed7a218adf32dce0a5442',
            stagingReceiptSha256=self.m.STAGING180_SHA)
        self.video_path = self.private / 'jm180-video-runtime-preparation.json'
        self.json(self.video_path, self.video); self.m.VIDEO_RECEIPT_SHA = self.m.digest(self.video_path.read_bytes())
        self.release = dict(version='1.8.3', commit=self.m.SOURCE, nodeVersion='v24.22.1', startedAt=1792600000000)
        self.log = self.private / 'jm183-node24221.log'
        self.log_data = b'JessieMessage listening on port 3000\n' + json.dumps(dict(version=1,
            type='application_started', release=self.release), separators=(',', ':')).encode() + b'\n'
        self.write(self.log, self.log_data)
        self.http = dict(health=dict(url='https://jessiemessage.com/api/health',status=200,body={'status':'ok'}),
            ready=dict(url='https://jessiemessage.com/api/ready',status=200,body={'status':'ready'}),
            home=dict(url='https://jessiemessage.com/',status=200,sha256=self.m.digest(self.home183_access)),
            entry=dict(url='https://jessiemessage.com/api/entry',status=200,administrator=None))

    def write(self, path, data, mode=0o600):
        path.write_bytes(data); path.chmod(mode)

    def json(self, path, value):
        self.write(path, (json.dumps(value, ensure_ascii=False, indent=2)+'\n').encode())

    def unchanged(self):
        self.assertEqual(self.checkpoint.read_bytes(), self.original)
        self.assertEqual(list(self.private.glob('.release183-*')), [])

    def source_fixture(self, root, sha, tree, version):
        normal = [(f'{i:04d}_fixture.sql', 'a'*64) for i in range(1,34)]
        video = [('0034_video_storage_state.sql', 'b'*64),
            ('0035_video_assets.sql', 'c'*64), ('0036_message_video.sql', 'd'*64)]
        return {'normalized':'same locked dependencies'}, normal, [] if version=='1.7.1' else video

    def record(self):
        with patch.object(self.m, 'source', side_effect=self.source_fixture), \
                patch.object(self.m, 'collect_http', return_value=copy.deepcopy(self.http)), \
                patch.object(self.m, 'collect_published_release', return_value=copy.deepcopy(self.published)):
            return self.m.record()

    def test_transition_preserves_all_history_and_exact_retry_is_read_only(self):
        before_stage182 = self.stage182_path.read_bytes()
        before_stage = self.stage_path.read_bytes(); before_stage183 = self.stage183_path.read_bytes(); before_video = self.video_path.read_bytes()
        result = self.record()
        self.assertEqual(result['status'], 'release183_metadata_recorded')
        self.assertTrue(result['metadataOnly']); self.assertTrue(result['noRestart'])
        self.assertEqual(result['schemaMigrations'],36)
        value = json.loads(self.checkpoint.read_bytes())
        self.assertEqual(value['activeService']['release'],'1.8.3')
        self.assertEqual(value['activeService']['source'],self.m.SOURCE)
        self.assertEqual(value['activeService']['schemaMigrations'],36)
        section = value['developmentSimplification']['release183']
        self.assertEqual(section['priorActiveService'],self.active)
        self.assertEqual(section['rollback']['release'],'1.7.2')
        self.assertEqual(section['rollback']['status'],'hosted_precheck_passed_not_started')
        self.assertEqual(section['rollback'],self.document['developmentSimplification']['release182']['rollback'])
        restored=copy.deepcopy(value); restored['activeService']=copy.deepcopy(self.active)
        del restored['developmentSimplification']['release183']
        self.assertEqual(restored,self.document)
        self.assertEqual(self.stage_path.read_bytes(),before_stage)
        self.assertEqual(self.stage183_path.read_bytes(),before_stage183)
        self.assertEqual(self.stage182_path.read_bytes(),before_stage182)
        self.assertEqual(value['developmentSimplification']['release182'],self.document['developmentSimplification']['release182'])
        self.assertEqual(value['developmentSimplification']['release180'],self.document['developmentSimplification']['release180'])
        self.assertEqual(value['developmentSimplification']['release181'],self.document['developmentSimplification']['release181'])
        self.assertEqual(self.video_path.read_bytes(),before_video)
        self.assertEqual(self.checkpoint.stat().st_mode & 0o777,0o600)
        before=self.m.fingerprint(self.checkpoint.stat())
        with patch.object(self.m.os,'replace',side_effect=AssertionError('exact retry must not replace')):
            self.assertEqual(self.record()['status'],'release183_metadata_already_recorded')
        self.assertEqual(self.m.fingerprint(self.checkpoint.stat()),before)
        self.assertEqual(list(self.private.glob('.release183-*')),[])

    def test_unqualified_source_refuses_before_private_file_reads(self):
        self.m.SOURCE='QUALIFICATION_REQUIRED_SOURCE180'
        with patch.object(self.m,'file',side_effect=AssertionError('private read forbidden')):
            with self.assertRaises(self.m.RecordError): self.record()
        self.unchanged()

    def test_pending_staging_pin_refuses_before_private_paths_or_network(self):
        self.m.STAGING_SHA = 'STAGING_PENDING'
        with patch.object(self.m, 'private_directory', side_effect=AssertionError('private paths forbidden')), \
                patch.object(self.m, 'file', side_effect=AssertionError('private reads forbidden')), \
                patch.object(self.m, 'collect_http', side_effect=AssertionError('network forbidden')):
            with self.assertRaisesRegex(self.m.RecordError, '^RECEIPT_PINS_REQUIRED$'):
                self.m.record()
        self.unchanged()

    def test_pending_publication_identity_refuses_before_private_paths_or_network(self):
        for release_id in (None, True, 0, -1, '183001'):
            self.m.RELEASE_ID = release_id
            with self.subTest(release_id=release_id), \
                    patch.object(self.m, 'private_directory', side_effect=AssertionError('private paths forbidden')), \
                    patch.object(self.m, 'file', side_effect=AssertionError('private reads forbidden')), \
                    patch.object(self.m, 'collect_http', side_effect=AssertionError('network forbidden')):
                with self.assertRaisesRegex(self.m.RecordError, '^PUBLICATION_PIN_REQUIRED$'):
                    self.m.record()
            with patch.object(self.m.urllib.request, 'build_opener', side_effect=AssertionError('network forbidden')):
                with self.assertRaisesRegex(self.m.RecordError, '^PUBLICATION_PIN_REQUIRED$'):
                    self.m.collect_published_release()
            self.unchanged()

    def test_pinned_receipts_and_actual_bundle_copies_refuse_drift(self):
        paths=[self.stage_path,self.stage181_path,self.stage182_path,self.stage183_path,self.video_path,self.bundle/'runtime-video.json',self.source6/'runtime-crm.json']
        for path in paths:
            original=path.read_bytes();self.write(path,original+b' ')
            with self.subTest(path=path.name),self.assertRaises(self.m.RecordError):self.record()
            self.write(path,original);self.unchanged()
        changed=copy.deepcopy(self.stage);changed['started']=True;self.json(self.stage_path,changed)
        with self.assertRaises(self.m.RecordError):self.record()
        self.unchanged()

    def test_release183_staging_semantics_refuse_even_with_synthetic_repin(self):
        original=self.stage183_path.read_bytes(); original_pin=self.m.STAGING_SHA
        changes=[('release','1.8.0'),('expectedActiveServiceVersion','1.7.1'),
            ('videoMigrationsIdentical',False),('existingConfigurationUntouched',False),
            ('started',True),('migrated',True),('checkpointChanged',True),
            ('source','0'*40),('checkout',str(self.operator/'unexpected')),('preservedActiveCheckpointSha256','0'*64)]
        for field,value in changes:
            staged=copy.deepcopy(self.stage183);staged[field]=value
            self.json(self.stage183_path,staged);self.m.STAGING_SHA=self.m.digest(self.stage183_path.read_bytes())
            with self.subTest(field=field),self.assertRaises(self.m.RecordError):self.record()
            self.unchanged()
        self.write(self.stage183_path,original);self.m.STAGING_SHA=original_pin

    def test_preserved_historical_sections_and_rollback_must_be_present_and_qualified(self):
        def without(name):
            value=copy.deepcopy(self.document);del value['developmentSimplification'][name];return value
        documents=[without(name) for name in ('release160','release171','release180','release181','release182')]
        for field,value in [('release','1.7.1'),('schemaMigrations',33),('identityVerified',True),
                ('source','0'*40),('status','started'),('precheck',{})]:
            document=copy.deepcopy(self.document)
            document['developmentSimplification']['release182']['rollback'][field]=value
            documents.append(document)
        for document in documents:
            self.json(self.checkpoint,document);before=self.checkpoint.read_bytes()
            self.m.CHECKPOINT_SHA=self.m.digest(before)
            with self.subTest(document=document['developmentSimplification'].keys()),self.assertRaises(self.m.RecordError):self.record()
            self.assertEqual(self.checkpoint.read_bytes(),before)
        self.write(self.checkpoint,self.original);self.m.CHECKPOINT_SHA=self.m.digest(self.original)

    def test_release183_dependency_and_both_migration_inventories_must_match(self):
        for part in (0,1,2):
            def drift(root,sha,tree,version):
                result=list(self.source_fixture(root,sha,tree,version))
                if version=='1.8.3':
                    if part==0:result[0]={'normalized':'different dependency'}
                    elif part==1:result[1]=result[1][:-1]
                    else:result[2]=result[2][:-1]
                return tuple(result)
            with patch.object(self.m,'source',side_effect=drift), \
                    patch.object(self.m,'collect_http',return_value=copy.deepcopy(self.http)):
                with self.subTest(part=part),self.assertRaises(self.m.RecordError):self.m.record()
            self.unchanged()

    def test_binary_and_launcher_drift_refuse_before_metadata(self):
        for path in [self.node,Path(self.stage['releases'][0]['launcher']),Path(self.stage['releases'][1]['checkLauncher']),Path(self.stage181['launcher']),Path(self.stage181['checkLauncher']),Path(self.stage182['launcher']),Path(self.stage182['checkLauncher']),Path(self.stage183['launcher']),Path(self.stage183['checkLauncher'])]:
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
            self.log_data.replace(b'1.8.3',b'1.8.0'),self.log_data.replace(self.m.SOURCE.encode(),b'0'*40),
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
            self.assertEqual(self.record()['status'],'release183_metadata_already_recorded')
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

    def test_home_uses_active_access_page_and_rejects_inactive_index_page(self):
        checkout = Path(self.stage183['checkout'])
        index = (checkout / 'public/index.html').read_bytes()
        access = (checkout / 'public/access.html').read_bytes()
        self.assertNotEqual(index, access)
        self.http['home']['sha256'] = self.m.digest(index)
        with self.assertRaisesRegex(self.m.RecordError, '^PUBLIC_HOME$'):
            self.record()
        self.unchanged()
        self.http['home']['sha256'] = self.m.digest(access)
        self.assertEqual(self.record()['status'], 'release183_metadata_recorded')

    def test_public_http_collector_accepts_actual_anonymous183_entry_shape(self):
        root = 'https://jessiemessage.com'
        payloads = {
            '/api/health': json.dumps({'status':'ok'}).encode(),
            '/api/ready': json.dumps({'status':'ready'}).encode(),
            '/': self.home183_access,
            '/api/entry': json.dumps(self.entry_response).encode(),
        }
        calls = []
        class Response(io.BytesIO):
            status = 200
            def geturl(inner): return inner.url
        class Opener:
            def open(inner, url, timeout):
                self.assertEqual(timeout, 15)
                self.assertIsInstance(url, str)
                self.assertTrue(url.startswith(root))
                suffix = url[len(root):]
                self.assertIn(suffix, payloads)
                calls.append(suffix)
                value = Response(payloads[suffix]); value.url = url
                return value
        with patch.object(self.m.urllib.request, 'build_opener', return_value=Opener()):
            self.assertEqual(self.m.collect_http(), self.http)
        self.assertEqual(calls, ['/api/health', '/api/ready', '/', '/api/entry'])
        self.assertEqual(self.entry_response, {'status':'available', 'client':{'state':'signed_out','href':'/access'}, 'administrator':None})
        self.unchanged()

    def test_published_release_tag_and_latest_require_exact_identities_before_write(self):
        original=copy.deepcopy(self.published)
        for field,value in [('releaseId',1),('tag','v1.8.1'),('source','0'*40),('latest','v1.8.1'),
                ('latestSource','0'*40),('tagObjectType','tag'),('draft',True),('prerelease',True)]:
            self.published=copy.deepcopy(original);self.published[field]=value
            with self.subTest(field=field),self.assertRaises(self.m.RecordError):self.record()
            self.unchanged()

    def test_published_release_transport_is_only_three_anonymous_gets_and_rejects_drift(self):
        root='https://api.github.com/repos/fredbuhr/jessiemessage'
        release=dict(id=self.m.RELEASE_ID,tag_name='v1.8.3',target_commitish=self.m.SOURCE,draft=False,prerelease=False)
        tag=dict(ref='refs/tags/v1.8.3',object=dict(type='commit',sha=self.m.SOURCE))
        documents=[release,tag,release]
        paths=['/releases/'+str(self.m.RELEASE_ID),'/git/ref/tags/v1.8.3','/releases/latest']
        class Response(io.BytesIO):
            status=200
            def geturl(inner):return inner.url
        class Opener:
            def open(inner,request,timeout):
                self.assertEqual(timeout,15)
                self.assertEqual(request.get_method(),'GET');self.assertIsNone(request.data)
                self.assertIsNone(request.get_header('Authorization'))
                index=len(calls);self.assertLess(index,3)
                self.assertEqual(request.full_url,root+paths[index]);calls.append(request.full_url)
                response=Response(json.dumps(values[index]).encode());response.url=request.full_url
                return response
        calls=[];values=copy.deepcopy(documents)
        with patch.object(self.m.urllib.request,'build_opener',return_value=Opener()):
            self.assertEqual(self.m.collect_published_release(),self.published)
        self.assertEqual(len(calls),3)
        for index,field,value in [(0,'draft',True),(0,'id',1),(2,'target_commitish','0'*40),
                (2,'tag_name','v1.8.1'),(1,'ref','refs/tags/v1.8.1'),(1,'object',dict(type='tag',sha=self.m.SOURCE))]:
            calls=[];values=copy.deepcopy(documents);values[index][field]=value
            with self.subTest(index=index,field=field),patch.object(self.m.urllib.request,'build_opener',return_value=Opener()):
                with self.assertRaises(self.m.RecordError):self.m.collect_published_release()
        self.unchanged()

    def test_checkpoint_baseline_and_active_identity_must_match(self):
        self.write(self.checkpoint,self.original+b' ')
        with self.assertRaises(self.m.RecordError):self.record()
        self.unchanged_after_restore()
        for field,value in [('release','1.6.0'),('source','0'*40),('nodeAfterDeployment','v24.22.0'),('schemaMigrations',33)]:
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
        self.assertEqual(list(self.private.glob('.release183-*')),[])

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
        self.assertEqual(list(self.private.glob('.release183-*')),[])

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
        self.assertEqual(list(self.private.glob('.release183-*')),[])

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
        self.assertEqual(value['activeService']['release'],'1.8.3')
        self.assertEqual(value['activeService']['schemaMigrations'],36)
        self.assertIn('release183',value['developmentSimplification'])
        self.assertEqual(list(self.private.glob('.release183-*')),[])
        before=self.checkpoint.read_bytes();identity=self.m.fingerprint(self.checkpoint.stat())
        with patch.object(self.m.os,'replace',side_effect=AssertionError('partial success retry must not replace')):
            self.assertEqual(self.record()['status'],'release183_metadata_already_recorded')
        self.assertEqual(self.checkpoint.read_bytes(),before)
        self.assertEqual(self.m.fingerprint(self.checkpoint.stat()),identity)


class UnqualifiedWriter(unittest.TestCase):
    def load(self):
        spec = importlib.util.spec_from_file_location('record183_explicit_guard_fixture', HELPER)
        module = importlib.util.module_from_spec(spec)
        with patch('subprocess.run', side_effect=AssertionError('process forbidden')), \
                patch('urllib.request.build_opener', side_effect=AssertionError('network forbidden')):
            spec.loader.exec_module(module)
        return module

    def assert_refuses_before_io(self, module, code):
        with patch.object(module, 'private_directory', side_effect=AssertionError('private paths forbidden')), \
                patch.object(module, 'file', side_effect=AssertionError('private reads forbidden')), \
                patch.object(module.os, 'open', side_effect=AssertionError('file open forbidden')), \
                patch.object(module.subprocess, 'run', side_effect=AssertionError('process forbidden')), \
                patch.object(module.urllib.request, 'build_opener', side_effect=AssertionError('network forbidden')):
            with self.assertRaisesRegex(module.RecordError, '^' + code + '$'):
                module.record()

    def qualified_fixture(self):
        module = self.load()
        # Explicit model pins, independent of the actual shipped pending/final
        # literals. No fixture reaches any private path or external resource.
        module.SOURCE, module.TREE = 'a' * 40, 'b' * 40
        module.STAGING_SHA, module.RELEASE_ID = 'c' * 64, 183001
        return module

    def test_pin_modes_accept_pending_and_finalized_shapes_without_qualifying_either(self):
        pending = self.qualified_fixture()
        pending.SOURCE = pending.TREE = 'QUALIFICATION_PENDING'
        pending.STAGING_SHA, pending.RELEASE_ID = 'STAGING_PENDING', None
        assert_pin_modes(self, pending)
        assert_pin_modes(self, self.qualified_fixture())
        partial = self.qualified_fixture(); partial.STAGING_SHA = 'STAGING_PENDING'
        assert_pin_modes(self, partial)

    def test_explicit_all_pending_variant_has_no_private_process_or_network_side_effect(self):
        module = self.load()
        module.SOURCE = module.TREE = 'QUALIFICATION_PENDING'
        module.STAGING_SHA, module.RELEASE_ID = 'STAGING_PENDING', None
        self.assert_refuses_before_io(module, 'QUALIFICATION_REQUIRED')
        with patch.object(module.urllib.request, 'build_opener', side_effect=AssertionError('network forbidden')):
            with self.assertRaisesRegex(module.RecordError, '^PUBLICATION_PIN_REQUIRED$'):
                module.collect_published_release()

    def test_partial_source_or_tree_qualification_refuses_before_any_io(self):
        for field in ('SOURCE', 'TREE'):
            with self.subTest(pending=field):
                module = self.qualified_fixture()
                setattr(module, field, 'QUALIFICATION_PENDING')
                self.assert_refuses_before_io(module, 'QUALIFICATION_REQUIRED')
                with patch.object(module.urllib.request, 'build_opener', side_effect=AssertionError('network forbidden')):
                    with self.assertRaisesRegex(module.RecordError, '^PUBLICATION_PIN_REQUIRED$'):
                        module.collect_published_release()

    def test_partial_receipt_or_release_identity_refuses_with_other_fixture_pins_valid(self):
        for field, value, code in [('STAGING_SHA', 'STAGING_PENDING', 'RECEIPT_PINS_REQUIRED'),
                ('RELEASE_ID', None, 'PUBLICATION_PIN_REQUIRED')]:
            with self.subTest(pending=field):
                module = self.qualified_fixture()
                setattr(module, field, value)
                self.assert_refuses_before_io(module, code)


if __name__ == '__main__':
    unittest.main(verbosity=2)
