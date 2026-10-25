#!/usr/bin/env python3
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('inspection', ROOT / 'inspect-access1112.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ReadOnlyFileTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.root.chmod(0o700)
        self.file = self.root / 'synthetic.json'
        self.file.write_bytes(b'{"synthetic":true}')
        self.file.chmod(0o600)

    def tearDown(self):
        self.temp.cleanup()

    def test_preserves_bytes_and_metadata_and_streams_hash(self):
        before = self.file.stat()
        self.assertEqual(module.file(self.file), b'{"synthetic":true}')
        self.assertEqual(module.file(self.file, hash_only=True), hashlib.sha256(self.file.read_bytes()).hexdigest())
        after = self.file.stat()
        for key in ('st_ino', 'st_mode', 'st_size', 'st_mtime_ns', 'st_ctime_ns'):
            self.assertEqual(getattr(before, key), getattr(after, key))

    def test_rejects_symlink_hardlink_mode_and_size(self):
        link = self.root / 'link'
        link.symlink_to(self.file)
        with self.assertRaises(module.Refused): module.file(link)
        link.unlink()
        os.link(self.file, link)
        with self.assertRaises(module.Refused): module.file(self.file)
        link.unlink()
        self.file.chmod(0o644)
        with self.assertRaises(module.Refused): module.file(self.file)
        self.file.chmod(0o600)
        with self.assertRaises(module.Refused): module.file(self.file, limit=1)

    def test_changed_checkpoint_stops_before_process_or_email(self):
        (self.root / 'jm0702-existing-pc-update.json').write_text('synthetic different checkpoint')
        (self.root / 'jm0702-existing-pc-update.json').chmod(0o600)
        with mock.patch.object(module, 'PRIVATE', self.root), mock.patch.object(module, 'command') as command, \
                mock.patch.object(module, 'local_email') as email:
            with self.assertRaisesRegex(module.Refused, 'ACTIVE_CHECKPOINT_CHANGED'): module.inspect()
            command.assert_not_called(); email.assert_not_called()

    def test_log_emits_only_startup_counts_not_private_lines(self):
        log = self.root / 'jm1112-node24221.log'
        entry = {'version': 1, 'type': 'application_started', 'release': {'version': '1.11.2',
            'commit': module.SOURCE, 'nodeVersion': 'v24.22.1', 'startedAt': 1792946135648}}
        log.write_text('private synthetic content never emitted\n' + json.dumps(entry) + '\n' + json.dumps(entry) + '\n')
        log.chmod(0o600)
        with mock.patch.object(module, 'PRIVATE', self.root): result = module.startup_summary()
        self.assertEqual(result['matchingStartupRecords'], 2)
        self.assertTrue(result['originalStartupPresent'])
        self.assertNotIn('private', json.dumps(result))
        self.assertFalse(result['liveProcessIdentityProven'])

    def test_malformed_startup_is_reported_without_private_value(self):
        log = self.root / 'jm1112-node24221.log'
        log.write_bytes(b'application_started with synthetic secret\n')
        log.chmod(0o600)
        with mock.patch.object(module, 'PRIVATE', self.root): result = module.startup_summary()
        self.assertEqual(result['otherOrMalformedStartupRecords'], 1)
        self.assertNotIn('secret', json.dumps(result))

    def test_http_classification_never_echoes_body_or_external_location(self):
        result = module.classify_http(503, b'<h1>This website is currently undergoing maintenance.</h1>Infomaniak synthetic private string', 'https://other.invalid/private')
        self.assertEqual(result, {'status': 503, 'kind': 'provider_maintenance', 'redirect': True})
        self.assertEqual(module.classify_http(404, b'Not found')['kind'], 'app_not_found')
        self.assertEqual(module.classify_http(200, b'{"status":"ready"}')['kind'], 'app_ready')

    def test_public_http_has_no_credentials_and_does_not_follow_redirects(self):
        handler = module.NoRedirect()
        self.assertIsNone(handler.redirect_request(None, None, None, None, None, None))
        requests = []
        class Response:
            status = 200
            headers = {}
            def __enter__(self): return self
            def __exit__(self, *_): pass
            def read(self, limit):
                self.limit = limit
                return b'{"status":"ok"}'
        class Opener:
            def open(self, request, timeout):
                requests.append(request)
                return Response()
        with mock.patch.object(module.urllib.request, 'build_opener', return_value=Opener()):
            result = module.public_http()
        self.assertEqual(len(result), 6)
        self.assertEqual(len(requests), 6)
        for request in requests:
            self.assertEqual(request.get_method(), 'GET')
            self.assertTrue(request.full_url.startswith('https://jessiemessage.com/'))
            self.assertNotIn('cookie', {k.lower() for k in request.headers})
            self.assertNotIn('authorization', {k.lower() for k in request.headers})

    def test_production_entry_never_imports_stores_or_sends_password(self):
        self.assertNotIn('/access/store', module.NODE_ENTRY)
        self.assertNotIn('/access/service', module.NODE_ENTRY)
        self.assertNotIn('verifyPassword', module.NODE_ENTRY)
        self.assertIn("readFile('/dev/stdin'", module.NODE_ENTRY)
        self.assertNotIn('process.env.JESSIEMESSAGE_DB', module.NODE_ENTRY)


if __name__ == '__main__':
    unittest.main()
