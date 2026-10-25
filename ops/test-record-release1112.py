"""Real local receipts/permissions/atomic replacement; Git and public HTTP fake."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock

HERE = Path(__file__).resolve().parent


def helper():
    spec = importlib.util.spec_from_file_location('record1112_synthetic', HERE / 'record-release1112.py')
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module


class Recording(unittest.TestCase):
    def setUp(self):
        self.m = helper()
        self.temp = tempfile.TemporaryDirectory(prefix='record1112-synthetic-', dir=HERE.parent)
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.m.PRIVATE, self.m.OPERATOR = root / 'private', root / 'operator'
        self.m.PRIVATE.mkdir(mode=0o700); self.m.OPERATOR.mkdir(mode=0o700)
        self.m.SOURCE, self.m.TREE, self.m.RELEASE_ID = 'a' * 40, 'b' * 40, 1112001
        self.m.ROLLBACK185_SOURCE = self.m.ROLLBACK185_TREE = 'QUALIFICATION_PENDING'
        self.m.ROLLBACK185_STAGING_SHA = 'STAGING_PENDING'
        self.old = dict(release='1.11.1', source=self.m.OLD_SOURCE, tree=self.m.OLD_TREE,
            nodeAfterDeployment='v24.22.1', schemaMigrations=38, preserve='prior exact state')
        self.document = dict(activeService=copy.deepcopy(self.old),
            developmentSimplification=dict(release1111={'status':'complete','priorActiveService':{'full':'history1110'}}, release1110={'status':'historical1110','keep':['full older block']}, release1101={'status':'historical1101','keep':['full historical block']}, release1100={'status':'historical1100'}, release190={'status':'historical190'}, release184=dict(status='historical', rollback=dict(release='1.7.2', schemaMigrations=36)),
                release183={'history':'preserved'}, release180={'history':'preserved'}, other=['untouched']),
            separateBlock={'authority':'do not alter'})
        self.path = self.m.PRIVATE / 'jm0702-existing-pc-update.json'
        self.write(self.path, self.m.render(self.document)); self.m.CHECKPOINT_SHA = self.m.digest(self.path.read_bytes())
        self.node = self.m.PRIVATE / 'runtime-node-v24.22.1/bin/node'
        self.write(self.node, b'synthetic binary never executed', 0o700); self.m.NODE_SHA = self.m.digest(self.node.read_bytes())
        bundle = self.m.PRIVATE / 'runtime-video-180'; bundle.mkdir(mode=0o700)
        aggregate = self.m.hashlib.sha256()
        for name in self.m.BUNDLE_NAMES:
            data = ('synthetic configuration ' + name).encode(); self.write(bundle / name, data)
            aggregate.update(name.encode()); aggregate.update(b'\0'); aggregate.update(str(len(data)).encode()); aggregate.update(b'\0'); aggregate.update(data)
        self.m.BUNDLE_SHA = aggregate.hexdigest()
        self.current = self.m.release('1.11.2'); self.current['checkout'].mkdir(mode=0o700)
        self.previous = self.m.release('1.11.1'); self.previous['checkout'].mkdir(mode=0o700)
        self.old_modules = self.m.OPERATOR / 'production-1101-9eb99f1f' / 'node_modules'
        self.old_modules.parent.mkdir(mode=0o700); self.old_modules.mkdir(mode=0o700)
        self.m.DEPENDENCY_ROOT = self.old_modules
        (self.previous['checkout'] / 'node_modules').symlink_to(self.old_modules, target_is_directory=True)
        (self.current['checkout'] / 'node_modules').symlink_to(self.old_modules, target_is_directory=True)
        self.m.OLD_STAGING_SHA = self.pin_json(self.m.PRIVATE / 'jm1111-staging.json', self.staged('1.11.1'))
        (self.current['checkout'] / 'public').mkdir(); self.home = b'<!doctype html>synthetic access'
        self.write(self.current['checkout'] / 'public/access.html', self.home, 0o644)
        self.stage = self.staged('1.11.2')
        self.stage.update(priorActiveStagingSha256=self.m.OLD_STAGING_SHA, dependenciesReused=True, dependencyDirectory=str(self.old_modules), checkoutMode='0700')
        self.m.STAGING_SHA = self.pin_json(self.m.PRIVATE / 'jm1112-staging.json', self.stage)
        check = self.m.canonical(self.m.PRECHECK) + b'\n'
        self.write(self.current['precheckLog'], check)
        self.startup = dict(version=1, type='application_started', release=dict(version='1.11.2', commit=self.m.SOURCE, nodeVersion='v24.22.1', startedAt=self.m.REPORTED_STARTUP_SECOND * 1000 + 772))
        self.write(self.current['log'], self.m.canonical(self.startup) + b'\n')
        self.published = dict(repository='fredbuhr/jessiemessage', releaseId=self.m.RELEASE_ID, tag='v1.11.2', source=self.m.SOURCE,
            tagObjectType='commit', latest='v1.11.2', latestSource=self.m.SOURCE, draft=False, prerelease=False, transport='anonymous_https_get_only')
        self.http = {name:dict(url='https://jessiemessage.com'+suffix,status=200) for name,suffix in [('health','/api/health'),('ready','/api/ready'),('home','/'),('entry','/api/entry')]}
        self.http['health']['body']={'status':'ok'}; self.http['ready']['body']={'status':'ready'}
        self.http['home']['sha256']=self.m.digest(self.home); self.http['entry']['administrator']=None
        self.base_inventory = ({'locked':'dependencies'}, [('base', '1'*64)] * 33, [(name,'2'*64) for name in self.m.VIDEO_DDL], [(name,'3'*64) for name in self.m.EXPERIENCE_DDL])
        self.candidate_inventory = copy.deepcopy(self.base_inventory)
        self.source_patch = mock.patch.object(self.m, 'source', side_effect=lambda _root,_sha,_tree,version: self.base_inventory if version == '1.11.1' else ({'locked':'rollback-older-nodemailer'}, *self.base_inventory[1:]) if version == '1.8.5' else self.candidate_inventory)
        self.http_patch = mock.patch.object(self.m, 'collect_http', side_effect=lambda: copy.deepcopy(self.http))
        self.publication_patch = mock.patch.object(self.m, 'collect_published_release', side_effect=lambda: copy.deepcopy(self.published))
        for patcher in (self.source_patch,self.http_patch,self.publication_patch):
            patcher.start(); self.addCleanup(patcher.stop)

    @staticmethod
    def write(path, data, mode=0o600):
        path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(data); path.chmod(mode)

    def pin_json(self, path, value):
        self.write(path, self.m.render(value)); return self.m.digest(path.read_bytes())

    def staged(self, version):
        pin = self.m.release(version)
        value = {key:str(pin[key]) for key in ('source','tree','checkout','launcher','checkLauncher','log','precheckLog')}
        value.update(format='jessiemessage-release'+version.replace('.','')+'-staging',version=1,release=version,
            status='release'+version.replace('.','')+'_sources_staged_not_qualified',schemaMigrationsExpected=38,
            applicationTablesExpected=37,experienceEnabled=True,profile=self.m.PROFILE,nodeVersion='v24.22.1',
            nodeBinarySha256=self.m.NODE_SHA,preservedActiveCheckpointSha256=self.m.CHECKPOINT_SHA)
        for key in ('launcher','checkLauncher'):
            content=('#!/bin/bash\n# synthetic '+version+' '+key+'\n').encode(); self.write(pin[key],content,0o700)
            value[key+'Sha256']=self.m.digest(content)
        return value

    def add_rollback(self):
        self.m.ROLLBACK185_SOURCE,self.m.ROLLBACK185_TREE='d'*40,'e'*40
        self.rollback=self.m.release('1.8.5'); staged=self.staged('1.8.5')
        staged.update(preferencesEnabled=False,replyTrackingEnabled=False)
        self.m.ROLLBACK185_STAGING_SHA=self.pin_json(self.m.PRIVATE/'jm185-staging.json',staged)
        self.write(self.rollback['log'],b''); self.write(self.rollback['precheckLog'],self.m.canonical(self.m.PRECHECK)+b'\n')

    def test_records_only_current_metadata_preserves_every_historical_block_and_is_idempotent(self):
        result=self.m.record(); updated=self.m.parse(self.path.read_bytes())
        self.assertEqual(result['status'],'release1112_metadata_recorded'); self.assertEqual(result['schemaMigrations'],38)
        self.assertFalse(result['rollbackAfterMigrationQualified']); self.assertIsNone(result['rollbackRelease'])
        section=updated['developmentSimplification'].pop('release1112')
        self.assertEqual(section['priorActiveService'],self.old); self.assertIsNone(section['rollback'])
        self.assertTrue(section['historicalRelease1111Preserved']); self.assertTrue(section['historicalRelease1101Preserved'])
        self.assertTrue(result['historicalRelease1111Preserved']); self.assertTrue(result['historicalRelease1101Preserved'])
        self.assertTrue(section['priorRelease1111SqlCompatible']); self.assertFalse(section['publicProfileDowngradeQualified']); self.assertFalse(result['publicProfileDowngradeQualified']); self.assertEqual(section['rollbackQualificationScope'], 'sql38_precheck_only'); self.assertTrue(section['historicalRelease1110Preserved']); self.assertTrue(result['historicalRelease1110Preserved']); self.assertTrue(section['schemaUnchanged']); self.assertFalse(section['restart184Allowed']); self.assertFalse(section['restart172Allowed'])
        updated['activeService']=self.old; self.assertEqual(updated,self.document)
        before=self.path.read_bytes(); inode=self.path.stat().st_ino
        self.assertEqual(self.m.record()['status'],'release1112_metadata_already_recorded')
        self.assertEqual(self.path.read_bytes(),before); self.assertEqual(self.path.stat().st_ino,inode)

    def test_185_is_never_inferred_from_historical172_and_requires_its_own_current_evidence(self):
        self.add_rollback(); result=self.m.record(); updated=self.m.parse(self.path.read_bytes())
        self.assertEqual(result['rollbackRelease'],'1.8.5'); self.assertTrue(result['rollbackAfterMigrationQualified'])
        rollback=updated['developmentSimplification']['release1112']['rollback']
        self.assertEqual(rollback['schemaMigrations'],38); self.assertFalse(rollback['identityVerified'])
        self.assertEqual(rollback['status'],'hosted_precheck_passed_not_started')
        self.assertEqual(updated['developmentSimplification']['release184']['rollback'],self.document['developmentSimplification']['release184']['rollback'])

    def test_precheck_accepts_all_passed_receipts_within_byte_limit(self):
        line = self.m.canonical(self.m.PRECHECK) + b'\n'
        self.assertEqual(len(line), 182)
        for count in (1, 16, 17, 21, 360):
            with self.subTest(count=count):
                data = line * count
                self.write(self.current['precheckLog'], data)
                result = self.m.precheck(self.current['precheckLog'])
                self.assertEqual(result['passedReceipts'], count)
                self.assertEqual(result['sha256'], self.m.digest(data))
                self.assertEqual(self.current['precheckLog'].read_bytes(), data)
        data = line[:-1] + b' ' * (65536 - len(line)) + b'\n'
        self.assertEqual(len(data), 65536)
        self.write(self.current['precheckLog'], data)
        self.assertEqual(self.m.precheck(self.current['precheckLog'])['passedReceipts'], 1)

    def test_repeated_current_prechecks_record_and_retry_preserve_all_evidence(self):
        self.add_rollback()
        data = (self.m.canonical(self.m.PRECHECK) + b'\n') * 21
        self.write(self.current['precheckLog'], data)
        result = self.m.record()
        self.assertEqual(result['status'], 'release1112_metadata_recorded')
        updated = self.m.parse(self.path.read_bytes())
        section = updated['developmentSimplification'].pop('release1112')
        self.assertEqual(section['evidence']['precheck']['passedReceipts'], 21)
        self.assertEqual(section['evidence']['precheck']['sha256'], self.m.digest(data))
        self.assertEqual(section['rollback']['precheck']['passedReceipts'], 1)
        self.assertEqual(section['priorActiveService'], self.old)
        updated['activeService'] = self.old
        self.assertEqual(updated, self.document)
        before, inode = self.path.read_bytes(), self.path.stat().st_ino
        self.assertEqual(self.m.record()['status'], 'release1112_metadata_already_recorded')
        self.assertEqual(self.path.read_bytes(), before)
        self.assertEqual(self.path.stat().st_ino, inode)
        self.assertEqual(self.current['precheckLog'].read_bytes(), data)

    def test_empty_and_oversized_prechecks_refuse_before_http_without_writes(self):
        self.add_rollback()
        line = self.m.canonical(self.m.PRECHECK) + b'\n'
        for log in (self.current['precheckLog'], self.rollback['precheckLog']):
            original = log.read_bytes()
            for data in (b'', line * 361):
                with self.subTest(log=log.name, size=len(data)):
                    self.write(log, data)
                    before = self.path.read_bytes()
                    with mock.patch.object(self.m, 'collect_http', side_effect=AssertionError('invalid precheck must precede HTTP')):
                        with self.assertRaises(self.m.RecordError):
                            self.m.record()
                    self.assertEqual(self.path.read_bytes(), before)
                    self.assertEqual(log.read_bytes(), data)
            self.write(log, original)

    def test_every_precheck_line_is_required_even_among_many_passed_receipts(self):
        self.add_rollback()
        line = self.m.canonical(self.m.PRECHECK) + b'\n'
        wrong = [self.m.canonical(dict(self.m.PRECHECK, **change)) + b'\n' for change in (
            {'status': 'failed'}, {'pendingClosures': True}, {'version': 1},
            {'scope': 'other'}, {'started': True}, {'unexpected': False})]
        wrong += [b'\n', b'not a receipt\n', b'{"version":2,"version":2}\n', b'{"version":NaN}\n']
        for log in (self.current['precheckLog'], self.rollback['precheckLog']):
            original = log.read_bytes()
            for bad in wrong:
                for offset in (0, 10, 21):
                    with self.subTest(log=log.name, bad=bad[:45], offset=offset):
                        data = line * offset + bad + line * (21 - offset)
                        self.write(log, data)
                        before = self.path.read_bytes()
                        with mock.patch.object(self.m, 'collect_http', side_effect=AssertionError('invalid precheck must precede HTTP')):
                            with self.assertRaises((self.m.RecordError, ValueError)):
                                self.m.record()
                        self.assertEqual(self.path.read_bytes(), before)
                        self.assertEqual(log.read_bytes(), data)
            self.write(log, original)

    def test_partial_rollback_pins_fail_without_checkpoint_write(self):
        before=self.path.read_bytes(); self.m.ROLLBACK185_SOURCE='d'*40
        with self.assertRaisesRegex(self.m.RecordError,'ROLLBACK_PINS_REQUIRED'):self.m.record()
        self.assertEqual(self.path.read_bytes(),before)

    def test_started_or_unchecked_185_refuses_checkpoint_write(self):
        self.add_rollback(); before=self.path.read_bytes(); self.write(self.rollback['log'],b'was started\n')
        with self.assertRaisesRegex(self.m.RecordError,'ROLLBACK_ALREADY_STARTED'):self.m.record()
        self.assertEqual(self.path.read_bytes(),before)

    def test_every_lock_and_migration_inventory_must_match_active1111_before_http(self):
        original=self.candidate_inventory
        for index in range(4):
            with self.subTest(index=index):
                changed=list(copy.deepcopy(original)); changed[index]=('tampered',)
                self.candidate_inventory=tuple(changed)
                with mock.patch.object(self.m,'collect_http',side_effect=AssertionError('HTTP must follow inventory validation')):
                    with self.assertRaisesRegex(self.m.RecordError,'DEPENDENCIES_OR_MIGRATIONS'): self.m.verify_evidence()
        self.candidate_inventory=original

    def test_wrong_runtime_log_public_identity_or_publication_refuses_write(self):
        before=self.path.read_bytes()
        for selected in ['startup','ready','publication']:
            with self.subTest(selected=selected):
                self.write(self.current['log'],self.m.canonical(self.startup)+b'\n'); self.http['ready']['body']={'status':'ready'}; self.published['latest']='v1.11.2'
                if selected=='startup':self.write(self.current['log'],self.m.canonical(dict(self.startup,release=dict(self.startup['release'],commit='f'*40)))+b'\n')
                if selected=='ready':self.http['ready']['body']={'status':'starting'}
                if selected=='publication':self.published['latest']='v1.8.4'
                with self.assertRaises(self.m.RecordError):self.m.record()
                self.assertEqual(self.path.read_bytes(),before)

    def test_startup_must_match_reported_second_before_http_or_write(self):
        before = self.path.read_bytes()
        expected = self.m.REPORTED_STARTUP_SECOND * 1000
        for offset in (-1, 1000):
            with self.subTest(offset=offset):
                changed = dict(self.startup, release=dict(self.startup['release'], startedAt=expected + offset))
                self.write(self.current['log'], self.m.canonical(changed) + b'\n')
                with mock.patch.object(self.m, 'collect_http', side_effect=AssertionError('wrong startup must precede HTTP')):
                    with self.assertRaisesRegex(self.m.RecordError, 'STARTUP_IDENTITY'):
                        self.m.record()
                self.assertEqual(self.path.read_bytes(), before)
        for offset in (0, 999):
            changed = dict(self.startup, release=dict(self.startup['release'], startedAt=expected + offset))
            self.write(self.current['log'], self.m.canonical(changed) + b'\n')
            self.assertEqual(self.m.startup(self.current['log'])['release']['startedAt'], expected + offset)
        self.assertEqual(self.path.read_bytes(), before)

    def test_metadata_refuses_symlink_hardlink_and_wrong_mode(self):
        for fault in ['mode','link','symlink']:
            with self.subTest(fault=fault):
                original=self.m.render(self.document); self.path.unlink(missing_ok=True); self.write(self.path,original)
                if fault=='mode':self.path.chmod(0o644)
                if fault=='link':os.link(self.path,self.path.with_name('extra-hardlink'))
                if fault=='symlink':self.path.rename(self.path.with_name('original')); self.path.symlink_to(self.path.with_name('original'))
                with self.assertRaises(self.m.RecordError):self.m.record()
                self.assertEqual(self.path.read_bytes(),original)

    def test_duplicate_json_keys_are_rejected(self):
        with self.assertRaisesRegex(self.m.RecordError,'DUPLICATE_KEY'):self.m.parse(b'{"x":1,"x":2}')


    def test_reused_dependencies_must_be_the_active_directory_and_candidate_private(self):
        before = self.path.read_bytes()
        link = self.current['checkout'] / 'node_modules'
        link.unlink(); link.mkdir(mode=0o700)
        with self.assertRaisesRegex(self.m.RecordError, 'REUSED_DEPENDENCIES'): self.m.record()
        link.rmdir(); link.symlink_to(self.old_modules, target_is_directory=True)
        self.current['checkout'].chmod(0o2700)
        with self.assertRaisesRegex(self.m.RecordError, 'PRIVATE_DIRECTORY'): self.m.record()
        self.current['checkout'].chmod(0o700)
        self.assertEqual(self.path.read_bytes(), before)

    def test_prior_staging_and_dependency_receipt_link_are_pinned_before_http(self):
        before = self.path.read_bytes()
        self.stage['priorActiveStagingSha256'] = '0' * 64
        self.m.STAGING_SHA = self.pin_json(self.m.PRIVATE / 'jm1112-staging.json', self.stage)
        with mock.patch.object(self.m, 'collect_http', side_effect=AssertionError('must refuse first')):
            with self.assertRaisesRegex(self.m.RecordError, 'STAGING_PRIOR_RECEIPT'): self.m.record()
        self.stage['priorActiveStagingSha256'] = self.m.OLD_STAGING_SHA
        self.stage['dependenciesReused'] = False
        self.m.STAGING_SHA = self.pin_json(self.m.PRIVATE / 'jm1112-staging.json', self.stage)
        with self.assertRaisesRegex(self.m.RecordError, 'REUSED_DEPENDENCIES'): self.m.record()
        self.assertEqual(self.path.read_bytes(), before)

    def test_both_release_links_must_use_the_pinned_shared_private_directory(self):
        before = self.path.read_bytes()
        for pin in (self.previous, self.current):
            link = pin['checkout'] / 'node_modules'
            link.unlink(); link.symlink_to(os.path.relpath(self.old_modules, pin['checkout']), target_is_directory=True)
            with self.assertRaisesRegex(self.m.RecordError, 'REUSED_DEPENDENCIES'): self.m.record()
            self.assertEqual(self.path.read_bytes(), before)
            link.unlink(); link.symlink_to(self.old_modules, target_is_directory=True)
        self.old_modules.chmod(0o755)
        with self.assertRaisesRegex(self.m.RecordError, 'PRIVATE_DIRECTORY'): self.m.record()
        self.assertEqual(self.path.read_bytes(), before)


class Pending(unittest.TestCase):
    def test_pending_pins_refuse_before_private_or_network_access(self):
        module=helper()
        with mock.patch.multiple(module,SOURCE='QUALIFICATION_PENDING',TREE='QUALIFICATION_PENDING'), \
                mock.patch.object(module,'private_directory',side_effect=AssertionError('no private access')), \
                mock.patch.object(module,'collect_http',side_effect=AssertionError('no network')):
            with self.assertRaisesRegex(module.RecordError,'QUALIFICATION_REQUIRED'):module.record()


if __name__=='__main__':unittest.main(verbosity=2)
