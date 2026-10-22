"""Real isolated files and atomic replacement; no HTTP, DNS or host access."""
import hashlib
import importlib.util
import os
from pathlib import Path
import stat
import tempfile
import unittest
from unittest.mock import patch

HELPER = Path(__file__).with_name('redirect-accueil.py')


class Routing(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location('redirect_accueil_synthetic', HELPER)
        self.m = importlib.util.module_from_spec(spec); spec.loader.exec_module(self.m)
        temporary = tempfile.TemporaryDirectory(prefix='accueil-synthetic-', dir=HELPER.parent.parent)
        self.addCleanup(temporary.cleanup); self.root = Path(temporary.name)
        self.site = self.root / 'site'; self.site.mkdir()
        self.target = self.site / '.htaccess'
        self.private = self.root / 'private'; self.private.mkdir(mode=0o700)
        self.backup = self.private / self.m.BACKUP_NAME
        self.original = (b'# unrelated synthetic headers\nRewriteEngine On\n'
            b'RewriteCond %{HTTPS} ^off$ [OR]\n' + self.m.OLD + b'\n' + self.m.RULE
            + b'\n# unrelated synthetic private-entry rules\nRewriteRule ^ - [R=404,END]\n')
        self.target.write_bytes(self.original); self.target.chmod(0o644)
        self.m.CANDIDATES = (self.target, self.root / 'absent' / '.htaccess')
        self.m.PRIVATE = self.private
        self.m.BEFORE_SHA = hashlib.sha256(self.original).hexdigest()

    def refuse(self, code):
        with self.assertRaisesRegex(self.m.Refused, '^' + code + '$'):
            self.m.apply()

    def test_one_condition_changes_and_every_other_byte_and_mode_survives(self):
        receipt = self.m.apply()
        expected = self.original.replace(self.m.OLD, self.m.NEW)
        self.assertEqual(self.target.read_bytes(), expected)
        self.assertEqual(self.backup.read_bytes(), self.original)
        self.assertEqual(stat.S_IMODE(self.target.stat().st_mode), 0o644)
        self.assertEqual(stat.S_IMODE(self.backup.stat().st_mode), 0o600)
        self.assertEqual(receipt['status'], 'accueil_redirect_applied')
        self.assertEqual(receipt['beforeSha256'], hashlib.sha256(self.original).hexdigest())
        self.assertEqual(receipt['afterSha256'], hashlib.sha256(expected).hexdigest())
        self.assertTrue(receipt['pathAndQueryRulePreserved'])
        self.assertFalse(receipt['httpVerified'])
        self.assertFalse(receipt['applicationRuntimeChanged'])
        self.assertEqual(sorted(p.name for p in self.site.iterdir()), ['.htaccess'])

    def test_unknown_source_hash_refuses_before_any_copy_or_write(self):
        self.target.write_bytes(self.original + b'# changed\n')
        self.refuse('SOURCE_PIN')
        self.assertFalse(self.backup.exists())
        self.assertEqual(self.target.read_bytes(), self.original + b'# changed\n')

    def test_missing_both_fixed_paths(self):
        self.target.unlink(); self.refuse('SOURCE_NOT_FOUND')
        self.assertFalse(self.backup.exists())

    def test_two_distinct_files_are_ambiguous_even_with_identical_bytes(self):
        other = self.root / 'second'; other.write_bytes(self.original)
        self.m.CANDIDATES = (self.target, other)
        self.refuse('AMBIGUOUS_SOURCE')
        self.assertEqual(self.target.read_bytes(), other.read_bytes())
        self.assertFalse(self.backup.exists())

    def test_existing_private_copy_is_not_overwritten(self):
        self.backup.write_bytes(b'prior evidence')
        self.refuse('BACKUP_ALREADY_EXISTS')
        self.assertEqual(self.backup.read_bytes(), b'prior evidence')
        self.assertEqual(self.target.read_bytes(), self.original)

    def test_final_symlink_is_not_followed(self):
        other = self.root / 'original'; self.target.rename(other)
        self.target.symlink_to(other)
        self.refuse('SOURCE_METADATA')
        self.assertEqual(other.read_bytes(), self.original)
        self.assertFalse(self.backup.exists())

    def test_broken_final_symlink_refuses(self):
        self.target.unlink(); self.target.symlink_to(self.root / 'missing')
        self.refuse('SOURCE_METADATA')
        self.assertFalse(self.backup.exists())

    def test_group_writable_source_refuses(self):
        self.target.chmod(0o664); self.refuse('SOURCE_METADATA')
        self.assertFalse(self.backup.exists())

    def test_same_file_through_directory_alias_is_not_ambiguous(self):
        alias = self.root / 'alias'; alias.symlink_to(self.site, target_is_directory=True)
        self.m.CANDIDATES = (alias / '.htaccess', self.target)
        self.assertEqual(self.m.apply()['status'], 'accueil_redirect_applied')
        self.assertEqual(self.backup.read_bytes(), self.original)

    def test_repinning_a_fixture_without_the_expected_rule_still_refuses(self):
        changed = self.original.replace(self.m.RULE, self.m.RULE + b' # altered')
        self.target.write_bytes(changed); self.m.BEFORE_SHA = self.m.digest(changed)
        self.refuse('CANONICAL_RULE')
        self.assertFalse(self.backup.exists())

    def test_source_drift_after_private_copy_is_preserved_and_refuses_replacement(self):
        sync = self.m.sync_directory
        def concurrent_change(directory):
            sync(directory)
            if directory == self.private:
                self.target.write_bytes(self.original + b'# concurrent change\n')
        with patch.object(self.m, 'sync_directory', side_effect=concurrent_change):
            self.refuse('SOURCE_CHANGED')
        self.assertEqual(self.backup.read_bytes(), self.original)
        self.assertEqual(self.target.read_bytes(), self.original + b'# concurrent change\n')

    def test_replace_failure_preserves_copy_and_original_and_prevents_blind_retry(self):
        with patch.object(self.m.os, 'replace', side_effect=OSError('synthetic failure')):
            with self.assertRaises(OSError):
                self.m.apply()
        self.assertEqual(self.backup.read_bytes(), self.original)
        self.assertEqual(self.target.read_bytes(), self.original)
        self.assertEqual(sorted(p.name for p in self.site.iterdir()), ['.htaccess'])
        self.refuse('BACKUP_ALREADY_EXISTS')

    def test_sync_failure_after_replacement_keeps_evidence_without_false_success(self):
        sync = self.m.sync_directory
        def failed_final_sync(directory):
            if directory == self.site:
                raise OSError('synthetic final directory sync failure')
            sync(directory)
        with patch.object(self.m, 'sync_directory', side_effect=failed_final_sync):
            with self.assertRaises(OSError):
                self.m.apply()
        self.assertEqual(self.backup.read_bytes(), self.original)
        self.assertEqual(self.target.read_bytes(), self.original.replace(self.m.OLD, self.m.NEW))
        self.refuse('BACKUP_ALREADY_EXISTS')

    def test_drift_during_final_readback_refuses_without_erasing_evidence(self):
        read = self.m.os.pread
        expected = self.original.replace(self.m.OLD, self.m.NEW)
        def concurrent_change(fd, length, offset):
            data = read(fd, length, offset)
            if data == expected:
                self.target.write_bytes(expected + b'# changed during readback\n')
            return data
        with patch.object(self.m.os, 'pread', side_effect=concurrent_change):
            self.refuse('READBACK_MISMATCH')
        self.assertEqual(self.backup.read_bytes(), self.original)
        self.assertEqual(self.target.read_bytes(), expected + b'# changed during readback\n')
        self.refuse('BACKUP_ALREADY_EXISTS')


if __name__ == '__main__':
    unittest.main(verbosity=2)
