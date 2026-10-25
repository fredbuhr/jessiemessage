#!/usr/bin/env python3
import hashlib
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import pty
import select
import signal
import subprocess
import sys
import tempfile
import termios
import time
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

    def terminal_child(self, *, interrupt=False):
        master, slave = pty.openpty()
        original = termios.tcgetattr(slave)
        child = (
            'import importlib.util\n'
            f'spec=importlib.util.spec_from_file_location("diagnostic",{str(ROOT / "inspect-access1112.py")!r})\n'
            'm=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)\n'
            'try:\n'
            '    value=m.local_email()\n'
            '    print("ADDRESS_ACQUIRED_LENGTH="+str(len(value)),flush=True)\n'
            'except BaseException as e:\n'
            '    print("INPUT_ERROR="+type(e).__name__,flush=True)\n'
        )
        # stdin is unavailable, just as with the source supplied by heredoc.
        # No controlling terminal is installed; stdout/stderr still have a PTY.
        process = subprocess.Popen([sys.executable, '-c', child], stdin=subprocess.DEVNULL,
            stdout=slave, stderr=slave, start_new_session=True,
            env={'PATH': '/usr/bin:/bin', 'PYTHONDONTWRITEBYTECODE': '1'})
        received = b''
        try:
            deadline = time.monotonic() + 5
            while b'saisie masqu' not in received and b'INPUT_ERROR=' not in received:
                self.assertGreater(deadline - time.monotonic(), 0, 'terminal prompt not reached')
                if select.select([master], [], [], max(0, deadline - time.monotonic()))[0]:
                    received += os.read(master, 4096)
            self.assertIn(b'saisie masqu', received, 'must reach prompt without /dev/tty or stdin')
            self.assertEqual(termios.tcgetattr(slave)[3] & termios.ECHO, 0, 'address input must not echo')
            if interrupt:
                process.send_signal(signal.SIGINT)
            else:
                os.write(master, b'synthetic-private@example.invalid\n')
            process.wait(timeout=5)
            while select.select([master], [], [], 0)[0]:
                received += os.read(master, 4096)
            self.assertEqual(termios.tcgetattr(slave), original, 'terminal settings must be restored')
            self.assertNotIn(b'synthetic-private@example.invalid', received)
            self.assertEqual(process.returncode, 0)
            return received
        finally:
            if process.poll() is None:
                process.kill(); process.wait(timeout=5)
            termios.tcsetattr(slave, termios.TCSANOW, original)
            os.close(master); os.close(slave)

    def test_local_email_reads_terminal_without_controlling_tty(self):
        received = self.terminal_child()
        self.assertIn(b'ADDRESS_ACQUIRED_LENGTH=33', received)

    def test_local_email_restores_echo_after_interrupt(self):
        received = self.terminal_child(interrupt=True)
        self.assertIn(b'INPUT_ERROR=KeyboardInterrupt', received)

    def test_failure_output_reports_guard_stage_without_paths_or_private_values(self):
        checkpoint = self.root / 'jm0702-existing-pc-update.json'
        checkpoint.write_text('synthetic mismatched state'); checkpoint.chmod(0o600)
        output = io.StringIO()
        with mock.patch.object(module, 'PRIVATE', self.root), contextlib.redirect_stdout(output), \
                mock.patch.object(module, 'local_email') as email:
            result = module.main()
        data = json.loads(output.getvalue())
        self.assertEqual(result, 1)
        self.assertEqual(data['step'], 'active_checkpoint')
        self.assertEqual(data['reason'], 'ACTIVE_CHECKPOINT_CHANGED')
        self.assertTrue(data['noAccountMutation']); email.assert_not_called()
        self.assertNotIn(str(self.root), output.getvalue())
        self.assertNotIn('synthetic mismatched state', output.getvalue())

    def test_unexpected_failure_never_prints_exception_message(self):
        for error in (RuntimeError('synthetic-private@example.invalid sql password'),
                FileNotFoundError(2, 'synthetic secret message', '/synthetic/private-path')):
            with self.subTest(error=type(error).__name__):
                output = io.StringIO()
                with mock.patch.object(module, 'inspect', side_effect=error), contextlib.redirect_stdout(output):
                    result = module.main()
                self.assertEqual(result, 1)
                data = json.loads(output.getvalue())
                self.assertIn(data['reason'], ('UNEXPECTED_EXCEPTION', 'FileNotFoundError'))
                self.assertNotIn('synthetic', output.getvalue())

    def test_no_terminal_refuses_without_consuming_or_echoing_piped_email(self):
        code = ('import importlib.util\n'
            f'spec=importlib.util.spec_from_file_location("diagnostic",{str(ROOT / "inspect-access1112.py")!r})\n'
            'm=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)\n'
            'try: m.local_email()\n'
            'except OSError: print("TERMINAL_UNAVAILABLE_NO_FALLBACK")\n'
            'import sys\n'
            'remaining=sys.stdin.read()\n'
            'print("STDIN_PRESERVED="+str(remaining=="synthetic-private@example.invalid\\n"))\n')
        result = subprocess.run([sys.executable, '-c', code], input='synthetic-private@example.invalid\n',
            capture_output=True, text=True, start_new_session=True, timeout=5,
            env={'PATH': '/usr/bin:/bin', 'PYTHONDONTWRITEBYTECODE': '1'})
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout, 'TERMINAL_UNAVAILABLE_NO_FALLBACK\nSTDIN_PRESERVED=True\n')
        self.assertEqual(result.stderr, '')

    def test_node_queries_and_entry_are_identical_to_native_qualified_revision(self):
        # The SQL/Node code remains that of operator1d4c38e9, qualified on both
        # MariaDB versions by run40236054759; this revision fixes only Python.
        self.assertEqual(hashlib.sha256(module.NODE_MODULE.encode()).hexdigest(),
            '3f00601bba2d13b521268946b6bcfb92549c566abf62d1f696a8f92a4eb225ee')
        self.assertEqual(hashlib.sha256(module.NODE_ENTRY.encode()).hexdigest(),
            'd2986518c84137f7afe5c830b29e8bf03e609c716e496a27efe6bc16efa665ee')


if __name__ == '__main__':
    unittest.main()
