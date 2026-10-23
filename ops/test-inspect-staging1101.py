#!/usr/bin/env python3
"""Six isolated inspector checks: fake probes, no private paths or real network."""
import ast
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock

HERE = Path(__file__).resolve().parent
TARGET = HERE / 'inspect-staging1101.py'


def load():
    spec = importlib.util.spec_from_file_location('inspect1101_synthetic', TARGET)
    module = importlib.util.module_from_spec(spec)
    with mock.patch('subprocess.run', side_effect=AssertionError('no import process')), \
            mock.patch('urllib.request.build_opener', side_effect=AssertionError('no import network')):
        spec.loader.exec_module(module)
    return module


class Inspector(unittest.TestCase):
    def test_import_and_source_have_no_staging_or_mutation_capability(self):
        module = load()
        self.assertEqual(module.SOURCE, '9eb99f1f68ab4beb5484894249afa8f413cc5dd6')
        tree = ast.parse(TARGET.read_text())
        forbidden = {'stage', 'copy_dependencies', 'download_archive', 'write_bytes', 'write_text', 'unlink', 'rename', 'replace', 'mkdir', 'chmod', 'symlink_to', 'record', 'system', 'Popen'}
        invoked = {node.func.attr if isinstance(node.func, ast.Attribute) else node.func.id if isinstance(node.func, ast.Name) else ''
                   for node in ast.walk(tree) if isinstance(node, ast.Call)}
        self.assertFalse(invoked & forbidden)
        self.assertFalse(any(isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                             and node.func.attr == 'run' and node.func.value.id != 'subprocess'
                             for node in ast.walk(tree) if isinstance(getattr(node, 'func', None), ast.Attribute)
                             and isinstance(node.func.value, ast.Name)))

    def test_probe_and_unknown_errors_emit_only_neutral_codes(self):
        module = load(); marker = 'PRIVATE_CONTENT_token_secret_/srv/customer/client'
        self.assertEqual(module.probe(lambda: None), {'ok': True})
        self.assertEqual(module.probe(lambda: False), {'ok': False})
        for error, expected in ((RuntimeError(marker), 'not_confirmed'), (FileNotFoundError(marker), 'missing'),
                                (PermissionError(marker), 'permission'), (RuntimeError('dependency_directory_metadata'), 'dependency_directory_metadata')):
            def fail(error=error): raise error
            result = module.probe(fail)
            self.assertEqual(result, {'ok': False, 'code': expected})
            self.assertNotIn(marker, json.dumps(result))
        self.assertEqual(module.code(RuntimeError('dependency_bad: '+marker)), 'not_confirmed')

    def test_metadata_reports_modes_and_links_without_reading_contents(self):
        module = load()
        with tempfile.TemporaryDirectory(prefix='inspect1101-metadata-') as directory:
            root = Path(directory); file = root/'neutral'; file.write_bytes(b'PRIVATE_CONTENT_NOT_TO_PRINT')
            with mock.patch.object(Path, 'read_bytes', side_effect=AssertionError('metadata never reads content')):
                for mode in (0o600, 0o644):
                    file.chmod(mode); result = module.metadata(file)
                    self.assertEqual(result, {'present': True, 'kind': 'file', 'owned': True, 'mode': format(mode,'04o'), 'empty': False})
                link = root/'link'; link.symlink_to(root/'missing')
                self.assertEqual(module.metadata(link)['kind'], 'symlink')
                self.assertEqual(module.metadata(root/'missing'), {'present': False})
                self.assertNotIn('PRIVATE_CONTENT', json.dumps(result))

    def test_git_accepts_only_the_pinned_read_whitelist(self):
        module = load()
        result = SimpleNamespace(returncode=0, stdout=b'read-only result\n', stderr=b'never print this')
        with mock.patch.object(module.subprocess, 'run', return_value=result) as run:
            for arguments in sorted(module.READS):
                self.assertEqual(module.read_git(*arguments), result.stdout)
            for arguments in (('fetch','origin'), ('checkout','main'), ('worktree','add','/tmp/never'), ('status',), ('show','other:private')):
                before = run.call_count
                with self.assertRaisesRegex(module.InspectionRefused, '^git_read_forbidden$'): module.read_git(*arguments)
                self.assertEqual(run.call_count, before)
            args, kwargs = run.call_args
            self.assertEqual(args[0][0], '/usr/bin/git'); self.assertIn('--no-optional-locks', args[0])
            self.assertEqual(kwargs['stdin'], subprocess.DEVNULL)
            self.assertEqual(kwargs['env']['GIT_TERMINAL_PROMPT'], '0')
        with mock.patch.object(module.subprocess, 'run', return_value=SimpleNamespace(returncode=1,stdout=b'',stderr=b'PRIVATE_CONTENT')):
            with self.assertRaisesRegex(module.InspectionRefused, '^git_read_failed$'): module.read_git('rev-parse','HEAD')

    def test_tools_are_all_hash_checked_before_any_code_executes(self):
        module = load(); payloads = {'prepare-release1101.py': b'loaded = 1\n', 'release1101-dependencies.py': b'loaded = 2\n'}
        pins = {name: hashlib.sha256(value).hexdigest() for name,value in payloads.items()}
        class Response:
            status = 200
            def __init__(self,url): self.url=url
            def __enter__(self): return self
            def __exit__(self,*_): pass
            def read(self,limit): return payloads[self.url.rsplit('/',1)[1]][:limit]
        opener = SimpleNamespace(open=lambda url,timeout: Response(url))
        with mock.patch.object(module.urllib.request,'build_opener',return_value=opener), mock.patch.object(module,'PINS',dict(pins, **{'release1101-dependencies.py':'0'*64})), \
                mock.patch('builtins.exec',side_effect=AssertionError('hash mismatch must precede all execution')) as execute:
            with self.assertRaisesRegex(module.InspectionRefused,'^pinned_tool_hash$'): module.load_tools()
            execute.assert_not_called()
        with mock.patch.object(module.urllib.request,'build_opener',return_value=opener), mock.patch.object(module,'PINS',pins):
            self.assertEqual([tool.loaded for tool in module.load_tools()], [1,2])

    def test_phase_report_uses_fake_probes_and_never_resumes_or_leaks(self):
        module = load(); pin='a'*64
        with tempfile.TemporaryDirectory(prefix='inspect1101-phase-') as directory:
            root=Path(directory); checkout=root/'baseline'; (checkout/'node_modules').mkdir(parents=True)
            plan={name: root/name for name in ('checkout','start','check','log','prelog')}
            prepare=SimpleNamespace(RELEASE_TREE='c'*40,BASE_TREE='b'*40,BASE_STAGING_SHA=pin,CHECKPOINT_PIN=pin,START_PIN=pin,CHECK_PIN=pin,NODE_PIN=pin,
                release_plan=lambda *_:plan,regular=lambda *_args,**_kwargs:pin,private_directory=lambda *_:None,
                stage=mock.Mock(side_effect=AssertionError('never stage')))
            def inventory(_): raise RuntimeError('dependency_directory_metadata')
            dependencies=SimpleNamespace(validate_lock_transition=lambda *_:None,dependency_inventory=inventory,verify_installed=lambda *_:None,
                read_stable=lambda *_:b'{"version":"3.5.4"}',normalized_hidden_lock=lambda *_:None,
                copy_dependencies=mock.Mock(side_effect=AssertionError('never copy')),download_archive=mock.Mock(side_effect=AssertionError('never download archive')))
            values={('rev-parse','HEAD'):module.BASE,('rev-parse','HEAD^{tree}'):prepare.BASE_TREE,
                ('status','--porcelain','--untracked-files=normal'):'',('rev-parse','refs/tags/v1.10.1^{commit}'):module.SOURCE,
                ('rev-parse',module.SOURCE+'^{tree}'):prepare.RELEASE_TREE}
            package={'dependencies':{'mariadb':'3.5.4'}}
            def git(*arguments):
                self.assertIn(tuple(arguments),module.READS)
                return (json.dumps(package) if arguments[0]=='show' else values[tuple(arguments)]).encode()
            def metadata(path): return {'present':path==plan['checkout'],'kind':'directory'} if path==plan['checkout'] else {'present':False}
            with mock.patch.object(module,'CHECKOUT',checkout),mock.patch.object(module,'PRIVATE',root/'private'),mock.patch.object(module,'read_git',side_effect=git), \
                    mock.patch.object(module,'metadata',side_effect=metadata),mock.patch.object(module.subprocess,'run',side_effect=AssertionError('no process')):
                result=module.inspect((prepare,dependencies))
            self.assertEqual(set(result['outputs']),{'checkout','start','check','log','prelog','receipt'})
            self.assertTrue(result['outputs']['checkout']['present']); self.assertFalse(result['outputs']['receipt']['present'])
            self.assertEqual(result['inventory'],{'ok':False,'code':'dependency_directory_metadata'})
            self.assertTrue(all(result[name] for name in ('noResume','noCheck','noRuntimeAction')))
            self.assertNotIn(str(root),json.dumps(result)); self.assertNotIn('PRIVATE_CONTENT',json.dumps(result))
            prepare.stage.assert_not_called(); dependencies.copy_dependencies.assert_not_called(); dependencies.download_archive.assert_not_called()


if __name__=='__main__': unittest.main(verbosity=2)
