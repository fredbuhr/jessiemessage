"""Synthetic files only; Git transport/source checks are replaced, no hosting.

Real file metadata, launcher transformation, bash syntax, exclusive output,
dependency/migration comparisons and Node --version execution are exercised.
"""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

HELPER = Path(__file__).with_name('prepare-release171.py')


class Staging(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location('release171_draft', HELPER)
        self.m = importlib.util.module_from_spec(spec); spec.loader.exec_module(self.m)
        self.temp = tempfile.TemporaryDirectory(prefix='release171-synthetic-')
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.old, self.private = root / 'old160', root / 'private'
        self.old.mkdir(); self.private.mkdir(mode=0o700)
        self.m.OLD, self.m.PRIVATE = self.old, self.private
        self.m.OLD_SHA, self.m.OLD_TREE = 'a' * 40, 'd' * 40
        self.m.SOURCE, self.m.TREE = 'b' * 40, 'c' * 40
        self.target = root / ('production-171-' + self.m.SOURCE[:8])
        old_node = self.private / 'runtime-node-v24.22.0/bin/node'
        new_node = self.private / 'runtime-node-v24.22.1/bin/node'
        old_node.parent.mkdir(parents=True); new_node.parent.mkdir(parents=True)
        old_node.write_bytes(b'synthetic old binary'); old_node.chmod(0o700)
        new_node.write_text('#!/bin/sh\n[ "$1" = "--version" ] || exit 92\nprintf "v24.22.1\\n"\n'); new_node.chmod(0o700)
        self.m.OLD_NODE_SHA = self.m.digest(old_node.read_bytes())
        self.m.NODE_SHA = self.m.digest(new_node.read_bytes())
        for kind, log, command in [('start', 'jm160-node2422.log', 'start-local-closures'),
                                   ('check', 'jm160-preflight-9590741e.log', 'check-local-closures')]:
            text = (f'#!/bin/bash\n# source {self.m.OLD_SHA}\n# tree {self.m.OLD_TREE}\n'
                    f'# version v24.22.0\n# hash {self.m.OLD_NODE_SHA}\n# node {old_node}\n'
                    f'test "{old_node}" = "{old_node}"\ncd "{self.old}"\n'
                    f'exec /bin/echo {command} --runtime-directory "{self.old}" '
                    f'--runtime-head {self.m.OLD_SHA} --runtime-tree {self.m.OLD_TREE} >> "{self.private / log}" 2>&1\n')
            path = self.private / f'{kind}-primary-release160-9590741e.sh'
            path.write_text(text); path.chmod(0o700)
            setattr(self.m, 'START_PIN' if kind == 'start' else 'CHECK_PIN', self.m.digest(path.read_bytes()))
        self.package(self.old, '1.6.0')
        (self.old / 'node_modules').mkdir()
        directory = self.old / 'db/migrations'; directory.mkdir(parents=True)
        for index in range(1, 34):
            (directory / f'{index:04d}_fixture.sql').write_text(f'-- synthetic {index}\n')
        self.before = {str(path.relative_to(root)): path.read_bytes() for path in root.rglob('*') if path.is_file()}
        self.calls = []; self.change = None; self.tag = self.m.SOURCE

    def package(self, root, version):
        (root / 'package.json').write_text(json.dumps({'version': version}))
        (root / 'package-lock.json').write_text(json.dumps({'version': version,
            'packages': {'': {'version': version, 'dependencies': {'synthetic': '1.0.0'}}}}))

    def git(self, root, *args, **kwargs):
        self.calls.append(args)
        if args == ('remote', 'get-url', 'origin'): return self.m.REMOTE
        if args[0] == 'fetch': return ''
        if args == ('rev-parse', 'refs/tags/v1.7.1^{commit}'): return self.tag
        if args == ('rev-parse', self.m.SOURCE + '^{tree}'): return self.m.TREE
        if args[0] == 'merge-base': return ''
        if args[:2] == ('worktree', 'add'):
            shutil.copytree(self.old, self.target, ignore=shutil.ignore_patterns('node_modules'))
            self.package(self.target, '1.7.1')
            if self.change: self.change()
            return ''
        raise AssertionError(args)

    def prepare(self):
        with patch.object(self.m, 'git', self.git), patch.object(self.m, 'source'):
            return self.m.prepare()

    def preserved(self):
        root = Path(self.temp.name)
        for name, data in self.before.items(): self.assertEqual((root / name).read_bytes(), data, name)

    def test_stage_and_retry_preserve_originals(self):
        result = self.prepare()
        self.assertEqual(result['status'], 'release171_staged_not_checked')
        self.assertFalse(result['precheckPassed']); self.assertFalse(result['runtimeStarted'])
        self.assertFalse(result['migrated']); self.assertFalse(result['managerChanged'])
        self.assertEqual((self.target / 'node_modules').resolve(), self.old / 'node_modules')
        for file in result['files']:
            content = Path(file['path']).read_bytes()
            self.assertEqual(self.m.digest(content), file['sha256'])
            self.assertEqual(os.stat(file['path']).st_mode & 0o777, int(file['mode'], 8))
            if file['path'].endswith('.sh'):
                self.assertIn(self.m.SOURCE.encode(), content); self.assertIn(self.m.TREE.encode(), content)
                self.assertIn(b'runtime-node-v24.22.1/bin/node', content)
                self.assertIn(self.m.NODE_SHA.encode(), content); self.assertNotIn(b'v24.22.0', content)
            else: self.assertEqual(content, b'')
        self.preserved()
        with self.assertRaisesRegex(RuntimeError, 'existing_output'): self.prepare()
        self.preserved()

    def test_unqualified_draft_refuses_before_host_reads(self):
        self.m.SOURCE = 'QUALIFICATION_REQUIRED_MERGED_SHA171'
        self.m.PRIVATE = Path('/no-hosting-path-may-be-read')
        with self.assertRaisesRegex(RuntimeError, 'qualification_required'): self.m.prepare()

    def test_changed_original_launcher_refused_before_fetch(self):
        path = self.private / 'start-primary-release160-9590741e.sh'
        path.write_text(path.read_text() + '# drift\n')
        with self.assertRaisesRegex(RuntimeError, 'original_launcher_hash'): self.prepare()
        self.assertFalse(any(call[0] == 'fetch' for call in self.calls))
        self.assertFalse(self.target.exists())

    def test_wrong_prepared_node_refused(self):
        self.m.NODE_SHA = '0' * 64
        with self.assertRaisesRegex(RuntimeError, 'prepared_node_hash'): self.prepare()
        self.assertFalse(self.target.exists()); self.preserved()

    def test_existing_log_is_not_truncated(self):
        path = self.private / 'jm171-node24221.log'; path.write_bytes(b'preserve')
        with self.assertRaisesRegex(RuntimeError, 'existing_output'): self.prepare()
        self.assertEqual(path.read_bytes(), b'preserve'); self.assertFalse(self.target.exists()); self.preserved()

    def test_wrong_tag_refused_before_checkout(self):
        self.tag = '0' * 40
        with self.assertRaisesRegex(RuntimeError, 'published_source_identity'): self.prepare()
        self.assertFalse(self.target.exists()); self.preserved()

    def test_changed_migration_leaves_unactivated_candidate(self):
        self.change = lambda: (self.target / 'db/migrations/0033_fixture.sql').write_text('-- drift')
        with self.assertRaisesRegex(RuntimeError, 'dependencies_or_migrations_changed'): self.prepare()
        self.assertTrue(self.target.exists()); self.assertFalse((self.target / 'node_modules').exists())
        self.assertFalse((self.private / 'jm171-node24221.log').exists()); self.preserved()

    def test_changed_dependency_leaves_unactivated_candidate(self):
        self.change = lambda: (self.target / 'package-lock.json').write_text(json.dumps({'version': '1.7.1',
            'packages': {'': {'version': '1.7.1', 'dependencies': {'synthetic': '2.0.0'}}}}))
        with self.assertRaisesRegex(RuntimeError, 'dependencies_or_migrations_changed'): self.prepare()
        self.assertTrue(self.target.exists()); self.assertFalse((self.target / 'node_modules').exists())
        self.assertFalse((self.private / 'jm171-node24221.log').exists()); self.preserved()


if __name__ == '__main__':
    unittest.main(verbosity=2)
