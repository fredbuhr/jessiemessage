#!/usr/bin/env python3
"""Synthetic files only: never prepares a hosted runtime or starts a service."""
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
SPEC = importlib.util.spec_from_file_location('prepare_node', Path(__file__).with_name('prepare-node24221.py'))
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class PreparationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='node24221-synthetic-', dir=Path(__file__).resolve().parents[2])
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.private = self.root / 'private'
        self.private.mkdir(mode=0o700)
        self.checkout = self.root / 'checkout'
        self.checkout.mkdir()
        self.source = 'a' * 40
        self.tree = 'b' * 40
        self.node = b'#!/bin/sh\nprintf "v24.22.1\\n"\n'
        self.old_hash = hashlib.sha256(b'preserved old binary fixture\n').hexdigest()
        old = self.private / MODULE.OLD_RUNTIME / 'bin/node'
        old.parent.mkdir(parents=True)
        old.write_bytes(b'preserved old binary fixture\n')
        old.chmod(0o700)
        self.old_node = old
        launchers = []
        for old_name, _, new_name, old_log, new_log, command in MODULE.LAUNCHERS:
            text = (f'#!/bin/bash\n# {self.source}\n# {self.tree}\ncd "{self.checkout}"\n'
                    f'[[ $(sha256sum "{old}" | cut -d" " -f1) == {self.old_hash} ]]\n'
                    f'[[ $("{old}" --version) == v24.22.0 ]]\n'
                    f'exec "{old}" fixture.mjs {command} >> "{self.private / old_log}" 2>&1\n')
            target = self.private / old_name
            target.write_text(text)
            target.chmod(0o700)
            launchers.append((old_name, hashlib.sha256(text.encode()).hexdigest(), new_name, old_log, new_log, command))
        self.archive = self.root / 'distribution.tar.xz'
        self.make_archive()
        self.patches = patch.multiple(MODULE, CHECKOUT=self.checkout, SOURCE=self.source, TREE=self.tree,
            LAUNCHERS=tuple(launchers), OLD_NODE_SHA256=hashlib.sha256(old.read_bytes()).hexdigest(),
            NODE_SHA256=hashlib.sha256(self.node).hexdigest(), NODE_BYTES=len(self.node),
            ARCHIVE_SHA256=hashlib.sha256(self.archive.read_bytes()).hexdigest(), ARCHIVE_BYTES=self.archive.stat().st_size)
        self.patches.start()
        self.addCleanup(self.patches.stop)
        self.source_patch = patch.object(MODULE, 'source_check')
        self.source_check = self.source_patch.start()
        self.addCleanup(self.source_patch.stop)

    def make_archive(self, *, link=False, duplicate=False):
        with tarfile.open(self.archive, 'w:xz') as archive:
            member = tarfile.TarInfo(MODULE.MEMBER)
            member.size = len(self.node)
            if link:
                member.type = tarfile.SYMTYPE
                member.linkname = '/outside'
                archive.addfile(member)
            else:
                archive.addfile(member, io.BytesIO(self.node))
                if duplicate:
                    archive.addfile(member, io.BytesIO(self.node))
            # An unrelated unsafe name is never extracted or created.
            extra = tarfile.TarInfo('../../outside')
            extra.size = 3
            archive.addfile(extra, io.BytesIO(b'bad'))

    def prepare(self):
        return MODULE.prepare(self.archive, self.private, self.checkout)

    def originals(self):
        return {str(path.relative_to(self.private)): path.read_bytes()
                for path in self.private.rglob('*') if path.is_file()}

    def assert_no_new_outputs(self):
        self.assertEqual(self.originals(), self.before)
        self.assertFalse(any(path.name.startswith('.node24221-') for path in self.private.iterdir()))

    def test_prepares_separate_node_and_exact_launcher_copies_without_running_them(self):
        before = self.originals()
        receipt = self.prepare()
        self.assertEqual(receipt['status'], 'node24221_prepared_not_started')
        self.assertEqual(receipt['nodeVersion'], 'v24.22.1')
        self.assertEqual(receipt['source'], self.source)
        for flag in ('runtimeStarted', 'precheckPassed', 'managerChanged', 'checkpointChanged', 'migrated', 'signatureVerified'):
            self.assertIs(receipt[flag], False)
        for name, value in before.items():
            self.assertEqual((self.private / name).read_bytes(), value)
        binary = self.private / MODULE.RUNTIME / 'bin/node'
        self.assertEqual(binary.read_bytes(), self.node)
        self.assertEqual(binary.stat().st_mode & 0o777, 0o700)
        self.assertEqual(binary.stat().st_nlink, 1)
        self.assertEqual((binary.parent.stat().st_mode & 0o777, binary.parent.parent.stat().st_mode & 0o777), (0o700, 0o700))
        self.assertFalse((self.root.parent / 'outside').exists())
        for old_name, _, new_name, old_log, new_log, _ in MODULE.LAUNCHERS:
            expected = (self.private / old_name).read_text().replace(str(self.old_node), str(binary)).replace(old_log, new_log)
            expected = expected.replace(self.old_hash, MODULE.NODE_SHA256).replace('v24.22.0', 'v24.22.1')
            self.assertEqual((self.private / new_name).read_text(), expected)
            self.assertEqual((self.private / new_log).read_bytes(), b'')
            self.assertEqual((self.private / new_log).stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.source_check.call_count, 2)
        self.assertEqual(len(receipt['files']), 4)
        self.assertFalse(any(path.name.startswith('.node24221-') for path in self.private.iterdir()))

    def test_repeat_refuses_without_truncating_logs(self):
        self.prepare()
        (self.private / MODULE.LAUNCHERS[0][4]).write_bytes(b'prior log retained\n')
        self.before = self.originals()
        with self.assertRaisesRegex(RuntimeError, 'existing_output'):
            self.prepare()
        self.assert_no_new_outputs()

    def test_archive_tamper_refuses_before_preparation(self):
        self.before = self.originals()
        with self.archive.open('ab') as file:
            file.write(b'tampered')
        with self.assertRaisesRegex(RuntimeError, 'archive_checksum'):
            self.prepare()
        self.assert_no_new_outputs()

    def test_wrong_extracted_digest_refuses_and_cleans_staging(self):
        self.before = self.originals()
        with patch.object(MODULE, 'NODE_SHA256', '0' * 64):
            with self.assertRaisesRegex(RuntimeError, 'node_checksum'):
                self.prepare()
        self.assert_no_new_outputs()

    def test_wrong_version_refuses_and_cleans_staging(self):
        self.before = self.originals()
        with patch.object(MODULE, 'VERSION', 'v24.22.2'):
            with self.assertRaisesRegex(RuntimeError, 'node_version'):
                self.prepare()
        self.assert_no_new_outputs()

    def test_symlink_and_duplicate_binary_members_refused(self):
        self.before = self.originals()
        for options in ({'link': True}, {'duplicate': True}):
            with self.subTest(options=options):
                self.make_archive(**options)
                with patch.multiple(MODULE, ARCHIVE_SHA256=hashlib.sha256(self.archive.read_bytes()).hexdigest(),
                        ARCHIVE_BYTES=self.archive.stat().st_size):
                    with self.assertRaisesRegex(RuntimeError, 'archive_node_member'):
                        self.prepare()
                self.assert_no_new_outputs()

    def test_untrusted_original_launcher_and_old_binary_refused(self):
        self.before = self.originals()
        for path in (self.old_node, self.private / MODULE.LAUNCHERS[0][0]):
            original = path.read_bytes()
            path.write_bytes(original + b'tampered')
            with self.assertRaisesRegex(RuntimeError, 'old_node_hash|launcher_hash'):
                self.prepare()
            path.write_bytes(original)
            self.assert_no_new_outputs()

    def test_private_permissions_symlink_and_existing_output_refused(self):
        self.before = self.originals()
        self.private.chmod(0o755)
        with self.assertRaisesRegex(RuntimeError, 'private_metadata'):
            self.prepare()
        self.private.chmod(0o700)
        link = self.root / 'private-link'
        link.symlink_to(self.private, target_is_directory=True)
        with self.assertRaisesRegex(RuntimeError, 'private_path'):
            MODULE.prepare(self.archive, link, self.checkout)
        output = self.private / MODULE.LAUNCHERS[0][2]
        output.symlink_to(self.root / 'absent-target')
        with self.assertRaisesRegex(RuntimeError, 'existing_output'):
            self.prepare()
        output.unlink()
        self.assert_no_new_outputs()

    def test_hardlinked_input_and_root_in_checkout_refused(self):
        self.before = self.originals()
        hardlink = self.root / 'archive-hardlink'
        os.link(self.archive, hardlink)
        with self.assertRaisesRegex(RuntimeError, 'file_metadata'):
            self.prepare()
        hardlink.unlink()
        (self.private / '.git').mkdir()
        with self.assertRaisesRegex(RuntimeError, 'private_outside_checkout'):
            self.prepare()
        self.assert_no_new_outputs()

    def test_exclusive_candidate_preserves_a_raced_empty_directory(self):
        stage = self.private / 'stage'
        target = self.private / 'target'
        (stage / 'bin').mkdir(parents=True, mode=0o700)
        (stage / 'bin/node').write_bytes(self.node)
        (stage / 'bin/node').chmod(0o700)
        target.mkdir()
        fd = os.open(self.private, os.O_RDONLY | os.O_DIRECTORY)
        try:
            with self.assertRaises(FileExistsError):
                MODULE.publish_directory(fd, stage.name, target.name)
            self.assertTrue(stage.is_dir())
            self.assertTrue(target.is_dir())
        finally:
            os.close(fd)

    def test_named_pipe_is_refused_without_waiting_for_a_writer(self):
        fifo = self.root / 'named-pipe'
        os.mkfifo(fifo, mode=0o600)
        code = ('import sys,importlib.util,pathlib\n'
                'sys.dont_write_bytecode=True\n'
                'spec=importlib.util.spec_from_file_location("candidate",sys.argv[1])\n'
                'module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)\n'
                'module.regular(pathlib.Path(sys.argv[2]))\n')
        result = subprocess.run([sys.executable, '-c', code, SPEC.origin, str(fifo)], timeout=3,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(b'file_metadata:named-pipe', result.stderr)

    def test_failure_after_node_publish_preserves_originals_and_refuses_blind_retry(self):
        before = self.originals()
        with patch.object(MODULE, 'write_exclusive', side_effect=OSError('synthetic disk failure')):
            with self.assertRaisesRegex(OSError, 'synthetic disk failure'):
                self.prepare()
        self.assertEqual((self.private / MODULE.RUNTIME / 'bin/node').read_bytes(), self.node)
        for name, value in before.items():
            self.assertEqual((self.private / name).read_bytes(), value)
        self.before = self.originals()
        with self.assertRaisesRegex(RuntimeError, 'existing_output'):
            self.prepare()
        self.assert_no_new_outputs()

    def test_copy_fsync_failure_leaves_only_unactivated_candidate_and_reports_phase(self):
        before = self.originals()
        real_fsync = MODULE.os.fsync
        calls = 0
        def fsync(fd):
            nonlocal calls
            calls += 1
            if calls == 4:
                raise OSError(28, 'synthetic candidate disk failure')
            return real_fsync(fd)
        with patch.object(MODULE.os, 'fsync', side_effect=fsync):
            with self.assertRaisesRegex(OSError, 'candidate_publication:node_fsync') as caught:
                self.prepare()
        self.assertEqual(caught.exception.errno, 28)
        self.assertEqual((self.private / MODULE.RUNTIME / 'bin/node').read_bytes(), self.node)
        for name, value in before.items():
            self.assertEqual((self.private / name).read_bytes(), value)
        self.assertFalse(any((self.private / value[index]).exists() for value in MODULE.LAUNCHERS for index in (2, 4)))
        self.before = self.originals()
        with self.assertRaisesRegex(RuntimeError, 'existing_output'):
            self.prepare()
        self.assert_no_new_outputs()

    def test_copy_readback_detects_changed_bytes_before_launcher_creation(self):
        before = self.originals()
        real_fsync = MODULE.os.fsync
        calls = 0
        def fsync(fd):
            nonlocal calls
            calls += 1
            if calls == 4:
                os.pwrite(fd, b'X', 0)
            return real_fsync(fd)
        with patch.object(MODULE.os, 'fsync', side_effect=fsync):
            with self.assertRaisesRegex(RuntimeError, 'publication_node_checksum'):
                self.prepare()
        for name, value in before.items():
            self.assertEqual((self.private / name).read_bytes(), value)
        self.assertFalse(any((self.private / value[index]).exists() for value in MODULE.LAUNCHERS for index in (2, 4)))
        self.assertFalse(any(path.name.startswith('.node24221-') for path in self.private.iterdir()))

    def test_source_check_uses_exact_git_identity_without_contacting_remote(self):
        self.source_patch.stop()
        (self.checkout / 'package.json').write_text(json.dumps({'version': '1.6.0'}))
        for answers, valid in (([self.source, self.tree, ''], True),
                (['0' * 40, self.tree, ''], False), ([self.source, self.tree, ' M package.json'], False)):
            with self.subTest(answers=answers):
                with patch.object(subprocess, 'check_output', side_effect=answers) as command:
                    if valid:
                        MODULE.source_check(self.checkout)
                    else:
                        with self.assertRaisesRegex(RuntimeError, 'checkout_identity'):
                            MODULE.source_check(self.checkout)
                    self.assertTrue(all('fetch' not in call.args[0] for call in command.call_args_list))


if __name__ == '__main__':
    unittest.main(verbosity=2)
