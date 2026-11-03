"""Synthetic publication and durable-state recovery; no token or network."""
import base64
import copy
import importlib.util
import json
from pathlib import Path
import unittest
from unittest import mock

HERE = Path(__file__).resolve().parent


def helper():
    spec = importlib.util.spec_from_file_location('publish1151_synthetic', HERE / 'publish-qualified1151.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class Api:
    def __init__(self, module):
        self.m = module
        self.writes, self.events, self.tags, self.releases = [], [], {}, {}
        self.visibility_delays = {}
        self.fault = None
        base_tag = 'v' + module.BASE_VERSION
        self.tags[base_tag] = dict(ref='refs/tags/' + base_tag, object=dict(type='commit', sha=module.BASE_SOURCE))
        self.releases[base_tag] = dict(id=module.BASE_RELEASE_ID, tag_name=base_tag, target_commitish=module.BASE_SOURCE,
            name='Synthetic existing1150 release', body='Preserve exact old body', draft=False, prerelease=False)
        self.latest = copy.deepcopy(self.releases[base_tag])
        self.by_source = {release['source']: release for release in module.RELEASES}
        self.by_ci = {release['ci']: release for release in module.RELEASES}
        self.tree_sources = {release['tree']: release['source'] for release in module.RELEASES}
        self.tree_sources[module.BASE_TREE] = module.BASE_SOURCE
        self.environment = dict(GITHUB_REPOSITORY=module.REPOSITORY, GITHUB_REF='refs/heads/ops/publish-v1.15.1', GITHUB_EVENT_NAME='push')

    def lock(self, version):
        dependencies = copy.deepcopy(self.m.OLD_ROOT_DEPENDENCIES)
        packages = {'': dict(name='jessiemessage', version=version, engines={'node': '>=24 <25'}, dependencies=dependencies)}
        packages.update({'node_modules/'+name: dict(version=value, integrity='synthetic-'+name,
            resolved='https://example.invalid/'+name+'.tgz') for name, value in dependencies.items()})
        packages['node_modules/transitive'] = dict(version='2.0.0', integrity='synthetic-transitive')
        value = dict(name='jessiemessage', version=version, lockfileVersion=3, requires=True, packages=packages)
        if version == '1.15.1':
            if self.fault == 'dependencies': dependencies['mariadb'] = 'changed'
            if self.fault == 'heic_version': packages['node_modules/libheif-js']['version'] = '1.23.6'
            if self.fault == 'heic_integrity': packages['node_modules/libheif-js']['integrity'] = 'changed'
            if self.fault == 'heic_missing': del packages['node_modules/libheif-js']
            if self.fault == 'added_transitive': packages['node_modules/unreviewed'] = dict(version='0.0.0')
            if self.fault == 'removed_transitive': del packages['node_modules/transitive']
            if self.fault == 'transitive_integrity': packages['node_modules/transitive']['integrity'] = 'changed'
            if self.fault == 'lock_metadata': value['lockfileVersion'] = 4
            if self.fault == 'lock_root_metadata': packages['']['license'] = 'changed'
        return value

    def contents(self, path, source):
        release = self.by_source.get(source)
        version = release['version'] if release else self.m.BASE_VERSION
        lock = self.lock(version)
        if path == 'package-lock.json': text = json.dumps(lock)
        elif path == 'package.json':
            package = lock['packages']['']
            if release and self.fault == 'package_version': package['version'] = '1.14.1'
            if release and self.fault == 'package_node': package['engines']['node'] = '>=22'
            text = json.dumps(package)
        else:
            counts = dict(self.m.ACTION_COUNTS, **{self.m.ARTIFACT_ACTION: release['artifacts']})
            text = '\n'.join('      uses: '+name for name, count in counts.items() for _ in range(count))
            text += '\n'+('\n'.join(['      node-version: "24.22.1"', '      persist-credentials: false',
                '      package-manager-cache: false'])+'\n')*4
            if self.fault == 'workflow': text = text.replace(self.m.ARTIFACT_ACTION, 'actions/upload-artifact@untrusted')
            if self.fault == 'workflow_node': text = text.replace('"24.22.1"', '"24.19.0"', 1)
            if self.fault == 'workflow_credentials': text = text.replace('persist-credentials: false', 'persist-credentials: true', 1)
            if self.fault == 'workflow_cache': text = text.replace('package-manager-cache: false', 'package-manager-cache: true', 1)
        return dict(type='file', encoding='base64', content=base64.b64encode(text.encode()).decode())

    def tree(self, source):
        paths = {f'db/migrations/{i:04d}_fixture.sql': str(i).rjust(40, '0') for i in range(1, 34)}
        paths.update({name: '7'*40 for name in self.m.VIDEO_NAMES})
        paths.update({name: '8'*40 for name in self.m.EXPERIENCE_NAMES})
        if source != self.m.BASE_SOURCE:
            if self.fault == 'sql33': paths['db/migrations/0001_fixture.sql'] = '9'*40
            if self.fault == 'sql36': paths[next(iter(self.m.VIDEO_NAMES))] = '9'*40
            if self.fault == 'sql38': paths[next(iter(self.m.EXPERIENCE_NAMES))] = '9'*40
            if self.fault == 'extra_sql': paths['other/unreviewed.sql'] = 'a'*40
        return dict(truncated=self.fault == 'truncated', tree=[dict(path=path, sha=sha, mode='100644', type='blob') for path, sha in paths.items()])

    def request(self, path, data=None, optional=False):
        self.events.append(('GET' if data is None else 'POST', path))
        if data is not None:
            self.writes.append((path, copy.deepcopy(data)))
            if path == 'git/refs':
                if self.fault == 'post_tag_http_error':
                    raise self.m.PublicationRefused('API_HTTP_404 POST git/refs')
                tag = data['ref'].removeprefix('refs/tags/')
                assert tag not in self.tags
                self.tags[tag] = dict(ref=data['ref'], object=dict(type='commit', sha=data['sha']))
                if self.fault == 'lost_tag_response':
                    self.fault = None
                    raise self.m.PublicationRefused('SYNTHETIC_RESPONSE_LOST')
                return copy.deepcopy(self.tags[tag])
            assert path == 'releases'
            if self.fault == 'post_release_http_error':
                raise self.m.PublicationRefused('API_HTTP_404 POST releases')
            tag = data['tag_name']
            assert tag not in self.releases
            value = {key: item for key, item in data.items() if key != 'make_latest'}
            value.update(id=1151000+len(self.releases), html_url='https://example.invalid/'+tag)
            self.releases[tag] = value
            if data['make_latest'] == 'true': self.latest = value
            if self.fault == 'lost_release_response':
                self.fault = None
                raise self.m.PublicationRefused('SYNTHETIC_RESPONSE_LOST')
            return copy.deepcopy(value)
        if path.startswith('releases?per_page=100&page='):
            page = int(path.rsplit('=', 1)[1]); return copy.deepcopy(list(self.releases.values())[(page-1)*100:page*100])
        if path == 'releases/' + str(self.m.BASE_RELEASE_ID): return copy.deepcopy(self.releases['v' + self.m.BASE_VERSION])
        if path == 'releases/latest': return copy.deepcopy(self.latest)
        for prefix, values in [('git/ref/tags/', self.tags), ('releases/tags/', self.releases)]:
            if path.startswith(prefix):
                value = values.get(path.removeprefix(prefix))
                if value is not None and self.fault == 'confirmation_http_500' and path == 'git/ref/tags/v1.15.1':
                    raise self.m.PublicationRefused('API_HTTP_500 GET '+path)
                if value is not None and self.visibility_delays.get(path, 0) > 0:
                    self.visibility_delays[path] -= 1
                    assert optional
                    return None
                if value is None: assert optional
                return copy.deepcopy(value)
        if path.startswith('git/commits/'):
            source = path.removeprefix('git/commits/')
            tree = self.m.BASE_TREE if source == self.m.BASE_SOURCE else self.by_source[source]['tree']
            if self.fault == 'tree' and source != self.m.BASE_SOURCE: tree = 'f'*40
            return dict(tree=dict(sha=tree))
        if path.startswith('git/trees/'):
            return self.tree(self.tree_sources[path.removeprefix('git/trees/').removesuffix('?recursive=1')])
        if path.startswith('compare/'):
            before, after = path.removeprefix('compare/').split('...')
            failed = self.fault == 'ancestry' or self.fault == 'main_ancestry' and after == 'main'
            return dict(merge_base_commit=dict(sha='f'*40 if failed else before), status='ahead')
        if path.startswith('contents/'):
            selected, source = path.removeprefix('contents/').split('?ref=')
            return self.contents(selected, source)
        if path.startswith('actions/runs/'):
            selected = path.removeprefix('actions/runs/').split('/')
            release = self.by_ci[selected[0]]
            ci = int(release['ci'])
            if len(selected) == 1:
                return dict(head_sha='f'*40 if self.fault == 'ci_sha' else release['source'],
                    head_branch='feature' if self.fault == 'ci_branch' else 'main', event='pull_request' if self.fault == 'ci_event' else 'push',
                    path='.github/workflows/other.yml' if self.fault == 'ci_path' else '.github/workflows/ci.yml',
                    status='in_progress' if self.fault == 'ci_status' else 'completed',
                    conclusion='failure' if self.fault == 'ci' else 'success', run_attempt=release['attempt']+1 if self.fault == 'rerun' else release['attempt'])
            jobs = [dict(name=name, status='completed', conclusion='success', head_sha=release['source'], run_id=ci,
                run_attempt=release['attempt']) for name in self.m.EXPECTED_JOBS]
            if self.fault == 'jobs': jobs[0]['conclusion'] = 'skipped'
            if self.fault == 'job_sha': jobs[0]['head_sha'] = 'f'*40
            if self.fault == 'job_run': jobs[0]['run_id'] = ci+1
            if self.fault == 'job_attempt': jobs[0]['run_attempt'] = release['attempt']+1
            if self.fault == 'job_duplicate': jobs[0]['name'] = jobs[1]['name']
            if self.fault == 'job_missing': jobs.pop()
            return dict(total_count=len(jobs), jobs=jobs)
        raise AssertionError('unexpected synthetic API '+path)

    def publish(self):
        return self.m.publish(request=self.request, environment=self.environment, node_version='v24.22.1')


class Publication(unittest.TestCase):
    def setUp(self):
        self.m = helper()
        self.m.RELEASES = (dict(version='1.15.1', source='c'*40, tree='d'*40, ci='1151001', attempt=1, artifacts=4),)
        self.api = Api(self.m)

    def test_exact_baseline_and_pending_real_pins_are_fail_closed(self):
        module = helper()
        self.assertEqual((module.BASE_SOURCE, module.BASE_TREE, module.BASE_RELEASE_ID, module.BASE_VERSION),
            ('6712028e08b1e04ac7628bdbb9c39fd9f90d9909', 'c80ee33ebfe01838c86cc2b4166b344acf5ea745', 430794626, '1.15.0'))
        self.assertEqual(module.RELEASES, (dict(version='1.15.1',
            source='a4a07f9f31c47a7185b57d11b8277be1d87fd2c1',
            tree='568530e702fa4d0a8a6b1743988c5e20b8656c40', ci='41612033199', attempt=1, artifacts=4),))
        pending = tuple(dict(release, source='QUALIFICATION_PENDING', tree='QUALIFICATION_PENDING',
            ci='QUALIFICATION_PENDING', attempt='QUALIFICATION_PENDING') for release in module.RELEASES)
        with mock.patch.object(module, 'RELEASES', pending), \
                mock.patch.object(module.subprocess, 'check_output', side_effect=AssertionError('no process')):
            with self.assertRaisesRegex(module.PublicationRefused, 'QUALIFICATION_PINS_REQUIRED'):
                module.publish(request=lambda *_args, **_kwargs: self.fail('no API before pins'))

    def test_metadata_scopes_clock_fix_to_invitations_and_describes_recovery_without_overclaim(self):
        value = self.m.metadata(self.m.RELEASES[0])
        body = value['body']
        self.assertIn('validité des invitations :', body)
        self.assertNotIn('validité des invitations et des sessions', body)
        for detail in ('demande seulement l’adresse e-mail', 'réponse publique uniforme',
                       'liens encore valides sont préservés', 'activation restent uniques',
                       'réponse réseau est perdue n’est pas renvoyée automatiquement',
                       'anciennes réponses de lecture ne remplacent pas',
                       'cause précise de l’incident client', 'ne déploie pas l’application'):
            self.assertIn(detail, body)
        self.assertEqual(value['tag_name'], 'v1.15.1')
        self.assertEqual(value['target_commitish'], self.m.RELEASES[0]['source'])

    def test_fresh_publication_reads_exact_qualification_and_remote_state_before_creating_only_missing_objects(self):
        result = self.api.publish()
        self.assertEqual([path for path, _ in self.api.writes], ['git/refs', 'releases'])
        first_post = self.api.events.index(('POST', 'git/refs'))
        before = self.api.events[:first_post]
        for path in ['actions/runs/1151001', 'actions/runs/1151001/jobs?per_page=100',
                     'git/ref/tags/v1.15.1', 'releases/tags/v1.15.1', 'releases/latest']:
            self.assertIn(('GET', path), before)
        self.assertEqual(result['latest']['tag'], 'v1.15.1')
        self.assertEqual(result['schemaMigrations'], 38)
        self.assertEqual(result['applicationTables'], 37)
        self.assertEqual(result['created'], ['v1.15.1'])
        self.assertTrue(result['previousReleasePreserved']); self.assertEqual(result['previousReleaseId'], 430794626)
        self.assertTrue(result['uniqueReleaseVerified'])
        self.assertEqual(self.api.writes[0][1]['ref'], 'refs/tags/v1.15.1')
        self.assertEqual(self.api.writes[1][1]['tag_name'], 'v1.15.1')
        self.assertFalse(result['deploymentPerformed'])

    def test_complete_lock_preserves_entire_existing_graph_without_mutating_inputs(self):
        before, after = self.api.lock('1.15.0'), self.api.lock('1.15.1')
        originals = copy.deepcopy((before, after))
        self.assertEqual(len(before['packages']['']['dependencies']), 9)
        self.m.verify_locked_dependencies(before, after)
        self.assertEqual((before, after), originals)
        for mutate in [lambda value: value.update(requires=False),
                       lambda value: value['packages']['node_modules/libheif-js'].update(integrity='changed'),
                       lambda value: value['packages']['node_modules/transitive'].update(version='changed')]:
            changed = copy.deepcopy(after)
            mutate(changed)
            with self.assertRaisesRegex(self.m.PublicationRefused, 'LOCKED_DEPENDENCIES'):
                self.m.verify_locked_dependencies(before, changed)

    def test_identical_retry_reads_and_verifies_everything_without_any_write(self):
        self.api.publish()
        self.api.writes, self.api.events = [], []
        result = self.api.publish()
        self.assertEqual(result['publicationMode'], 'verified_existing_read_only')
        self.assertEqual(self.api.writes, [])
        self.assertIn(('GET', 'releases/tags/v1.15.1'), self.api.events)

    def test_lost_tag_response_stops_then_recovers_from_durable_state_without_recreating_tag(self):
        self.api.fault = 'lost_tag_response'
        with self.assertRaisesRegex(self.m.PublicationRefused, 'SYNTHETIC_RESPONSE_LOST'): self.api.publish()
        self.assertEqual([path for path, _ in self.api.writes], ['git/refs'])
        self.api.writes, self.api.events = [], []
        result = self.api.publish()
        self.assertEqual(result['created'], ['v1.15.1'])
        self.assertEqual([path for path, _ in self.api.writes], ['releases'])
        self.assertLess(self.api.events.index(('GET', 'git/ref/tags/v1.15.1')), self.api.events.index(('POST', 'releases')))

    def test_lost_release_response_recovers_read_only_without_republication(self):
        self.api.fault = 'lost_release_response'
        with self.assertRaisesRegex(self.m.PublicationRefused, 'SYNTHETIC_RESPONSE_LOST'): self.api.publish()
        self.api.writes, self.api.events = [], []
        result = self.api.publish()
        self.assertEqual(result['publicationMode'], 'verified_existing_read_only')
        self.assertEqual(self.api.writes, [])

    def test_every_native_schema_and_dependency_gate_refuses_before_mutation(self):
        faults = ['ci', 'ci_sha', 'ci_branch', 'ci_event', 'ci_path', 'ci_status', 'rerun', 'jobs', 'job_sha', 'job_run',
            'job_attempt', 'job_duplicate', 'job_missing', 'tree', 'ancestry', 'main_ancestry', 'workflow', 'workflow_node',
            'workflow_credentials', 'workflow_cache', 'package_version', 'package_node', 'dependencies', 'heic_version',
            'heic_integrity', 'heic_missing', 'added_transitive', 'removed_transitive', 'transitive_integrity', 'lock_metadata',
            'lock_root_metadata', 'sql33', 'sql36', 'sql38', 'extra_sql', 'truncated']
        for fault in faults:
            with self.subTest(fault=fault):
                api = Api(self.m)
                api.fault = fault
                with self.assertRaises(self.m.PublicationRefused): api.publish()
                self.assertEqual(api.writes, [])

    def test_conflicting_latest_tag_release_or_release_without_tag_is_never_edited(self):
        for fault in ['latest', 'tag', 'annotated_tag', 'release', 'release_without_tag']:
            with self.subTest(fault=fault):
                api = Api(self.m)
                if fault == 'latest': api.latest = dict(id=999, tag_name='v1.8.5', target_commitish='a'*40)
                if fault in ['tag', 'annotated_tag', 'release']:
                    api.tags['v1.15.1'] = dict(ref='refs/tags/v1.15.1', object=dict(type='tag' if fault == 'annotated_tag' else 'commit',
                        sha='f'*40 if fault == 'tag' else 'c'*40))
                if fault in ['release', 'release_without_tag']:
                    api.releases['v1.15.1'] = dict(self.m.metadata(self.m.RELEASES[0]), id=1151000, name='modified release')
                with self.assertRaises(self.m.PublicationRefused): api.publish()
                self.assertEqual(api.writes, [])

    def test_workflow_context_and_node_fail_before_accessing_api(self):
        for environment, node in [(dict(self.api.environment, GITHUB_EVENT_NAME='pull_request'), 'v24.22.1'),
            (dict(self.api.environment, GITHUB_REPOSITORY='other/repository'), 'v24.22.1'),
            (dict(self.api.environment, GITHUB_REF='refs/heads/main'), 'v24.22.1'), (self.api.environment, 'v24.19.0')]:
            with self.subTest(environment=environment, node=node):
                with self.assertRaises(self.m.PublicationRefused):
                    self.m.publish(request=lambda *_args, **_kwargs: self.fail('no API'), environment=environment, node_version=node)

    def test_each_qualification_pin_is_required_before_node_or_api(self):
        for name in ['source', 'tree', 'ci', 'attempt']:
            with self.subTest(pin=name), mock.patch.object(self.m, 'RELEASES', (dict(self.m.RELEASES[0], **{name: 'QUALIFICATION_PENDING'}),)), \
                    mock.patch.object(self.m.subprocess, 'check_output', side_effect=AssertionError('no process')):
                with self.assertRaisesRegex(self.m.PublicationRefused, 'QUALIFICATION_PINS_REQUIRED'):
                    self.m.publish(request=lambda *_args, **_kwargs: self.fail('no API'))

    def test_exact_attempt_is_reused_for_run_jobs_and_release_notes(self):
        with mock.patch.object(self.m, 'RELEASES', (dict(self.m.RELEASES[0], attempt=2),)):
            api = Api(self.m)
            self.assertEqual(api.publish()['releases'][0]['ciAttempt'], 2)
            self.assertIn('tentative 2', api.latest['body'])
            api = Api(self.m)
            api.fault = 'job_attempt'
            with self.assertRaisesRegex(self.m.PublicationRefused, 'FIVE_NATIVE_JOBS_REQUIRED'): api.publish()
            self.assertEqual(api.writes, [])

    def test_http_error_reports_only_method_and_public_path_without_token_or_body(self):
        for data, method, path in [(None, 'GET', 'releases/tags/v1.15.1'),
            ({'private': 'SYNTHETIC_BODY_NOT_FOR_LOGS'}, 'POST', 'git/refs')]:
            opener = mock.Mock()
            opener.open.side_effect = self.m.urllib.error.HTTPError('https://example.invalid/', 404,
                'SYNTHETIC_BODY_NOT_FOR_LOGS', {}, None)
            with self.subTest(method=method), mock.patch.dict(self.m.os.environ, GH_TOKEN='SYNTHETIC_TOKEN_NOT_FOR_LOGS'), \
                    mock.patch.object(self.m.urllib.request, 'build_opener', return_value=opener):
                with self.assertRaises(self.m.PublicationRefused) as raised:
                    self.m.github(path, data=data)
                self.assertEqual(str(raised.exception), 'API_HTTP_404 '+method+' '+path)
                self.assertNotIn('SYNTHETIC_TOKEN_NOT_FOR_LOGS', str(raised.exception))
                self.assertNotIn('SYNTHETIC_BODY_NOT_FOR_LOGS', str(raised.exception))
                self.assertEqual(opener.open.call_count, 1)

    def test_initial_optional_http_404_still_returns_none_without_confirmation_wait(self):
        opener = mock.Mock()
        opener.open.side_effect = self.m.urllib.error.HTTPError('https://example.invalid/', 404, 'missing', {}, None)
        with mock.patch.dict(self.m.os.environ, GH_TOKEN='SYNTHETIC_TOKEN'), \
                mock.patch.object(self.m.urllib.request, 'build_opener', return_value=opener), \
                mock.patch.object(self.m.time, 'sleep') as pause:
            self.assertIsNone(self.m.github('git/ref/tags/v1.15.1', optional=True))
            self.assertEqual(opener.open.call_count, 1)
            pause.assert_not_called()

    def test_delayed_tag_and_release_confirmations_only_repeat_bounded_gets_after_each_post(self):
        self.api.visibility_delays = {'git/ref/tags/v1.15.1': 2, 'releases/tags/v1.15.1': 2}
        with mock.patch.object(self.m.time, 'sleep') as pause:
            result = self.api.publish()
        self.assertEqual(result['publicationMode'], 'created')
        self.assertEqual([path for path, _ in self.api.writes], ['git/refs', 'releases'])
        tag_post = self.api.events.index(('POST', 'git/refs'))
        release_post = self.api.events.index(('POST', 'releases'))
        self.assertEqual(self.api.events[tag_post+1:release_post].count(('GET', 'git/ref/tags/v1.15.1')), 3)
        self.assertEqual(self.api.events[release_post+1:].count(('GET', 'releases/tags/v1.15.1')), 3)
        self.assertEqual(pause.call_args_list, [mock.call(1)]*4)

    def test_confirmation_404_exhaustion_stops_after_three_gets_without_repeating_mutations(self):
        for path, posts in [('git/ref/tags/v1.15.1', ['git/refs']), ('releases/tags/v1.15.1', ['git/refs', 'releases'])]:
            with self.subTest(path=path), mock.patch.object(self.m.time, 'sleep') as pause:
                api = Api(self.m)
                api.visibility_delays[path] = 3
                with self.assertRaisesRegex(self.m.PublicationRefused, '^API_HTTP_404 GET '+path+' CONFIRMATION_NOT_VISIBLE$'):
                    api.publish()
                self.assertEqual([name for name, _ in api.writes], posts)
                posted_at = api.events.index(('POST', posts[-1]))
                self.assertEqual(api.events[posted_at+1:].count(('GET', path)), 3)
                self.assertEqual(pause.call_args_list, [mock.call(1)]*2)

    def test_post_http_errors_stop_immediately_without_any_retry_or_confirmation_read(self):
        for fault, posts in [('post_tag_http_error', ['git/refs']), ('post_release_http_error', ['git/refs', 'releases'])]:
            with self.subTest(fault=fault), mock.patch.object(self.m.time, 'sleep') as pause:
                api = Api(self.m)
                api.fault = fault
                with self.assertRaisesRegex(self.m.PublicationRefused, '^API_HTTP_404 POST '+posts[-1]+'$'):
                    api.publish()
                self.assertEqual([path for path, _ in api.writes], posts)
                self.assertEqual(api.events[-1], ('POST', posts[-1]))
                pause.assert_not_called()

    def test_confirmation_non_404_error_is_never_retried(self):
        self.api.fault = 'confirmation_http_500'
        with mock.patch.object(self.m.time, 'sleep') as pause:
            with self.assertRaisesRegex(self.m.PublicationRefused, '^API_HTTP_500 GET git/ref/tags/v1.15.1$'):
                self.api.publish()
        self.assertEqual([path for path, _ in self.api.writes], ['git/refs'])
        self.assertEqual(self.api.events[-1], ('GET', 'git/ref/tags/v1.15.1'))
        pause.assert_not_called()

    def test_dependency_pins_are_required_before_node_or_api(self):
        for value in ('QUALIFICATION_PENDING', {}, {'unexpected': '1.2.3'}):
            with self.subTest(value=value), mock.patch.object(self.m, 'OLD_ROOT_DEPENDENCIES', value), \
                    mock.patch.object(self.m.subprocess, 'check_output', side_effect=AssertionError('no Node process')):
                with self.assertRaisesRegex(self.m.PublicationRefused, 'DEPENDENCY_PINS_REQUIRED'):
                    self.m.publish(request=lambda *_args, **_kwargs: self.fail('no API before dependency pins'))

    def test_all_nine_existing_dependency_records_are_immutable(self):
        before, after = self.api.lock('1.15.0'), self.api.lock('1.15.1')
        for name in self.m.OLD_ROOT_DEPENDENCIES:
            with self.subTest(name=name):
                changed = copy.deepcopy(after); changed['packages']['node_modules/' + name]['integrity'] = 'different'
                with self.assertRaisesRegex(self.m.PublicationRefused, 'LOCKED_DEPENDENCIES'):
                    self.m.verify_locked_dependencies(before, changed)

    def test_old_tag_release_and_id_endpoint_are_verified_before_and_after_publication(self):
        old_tag = copy.deepcopy(self.api.tags['v1.15.0']); old_release = copy.deepcopy(self.api.releases['v1.15.0'])
        self.api.publish()
        self.assertEqual(self.api.tags['v1.15.0'], old_tag); self.assertEqual(self.api.releases['v1.15.0'], old_release)
        first_post = self.api.events.index(('POST', 'git/refs'))
        release_post = self.api.events.index(('POST', 'releases'))
        for path in ('git/ref/tags/v1.15.0', 'releases/tags/v1.15.0', 'releases/430794626'):
            self.assertIn(('GET', path), self.api.events[:first_post])
            self.assertIn(('GET', path), self.api.events[release_post + 1:])

    def test_conflicting_old_tag_release_or_id_endpoint_prevents_all_mutation(self):
        for change in ('tag-source', 'tag-type', 'release-id', 'release-target', 'draft', 'prerelease', 'id-endpoint'):
            with self.subTest(change=change):
                api = Api(self.m)
                if change == 'tag-source': api.tags['v1.15.0']['object']['sha'] = 'f' * 40
                if change == 'tag-type': api.tags['v1.15.0']['object']['type'] = 'tag'
                if change == 'release-id': api.releases['v1.15.0']['id'] = 99
                if change == 'release-target': api.releases['v1.15.0']['target_commitish'] = 'main'
                if change == 'draft': api.releases['v1.15.0']['draft'] = True
                if change == 'prerelease': api.releases['v1.15.0']['prerelease'] = True
                def request(path, data=None, optional=False):
                    value = api.request(path, data=data, optional=optional)
                    if change == 'id-endpoint' and path == 'releases/430794626': value['body'] = 'inconsistent ID response'
                    return value
                with self.assertRaisesRegex(self.m.PublicationRefused, 'BASE_TAG_IDENTITY|BASE_RELEASE_IDENTITY'):
                    self.m.publish(request=request, environment=api.environment, node_version='v24.22.1')
                self.assertEqual(api.writes, [])

    def test_concurrent_old_metadata_change_after_tag_creation_stops_without_new_release(self):
        api = self.api
        def request(path, data=None, optional=False):
            value = api.request(path, data=data, optional=optional)
            if data is not None and path == 'git/refs': api.releases['v1.15.0']['body'] = 'concurrent remote edit'
            return value
        with self.assertRaisesRegex(self.m.PublicationRefused, 'BASE_PUBLICATION_CHANGED'):
            self.m.publish(request=request, environment=api.environment, node_version='v24.22.1')
        self.assertEqual([path for path, _ in api.writes], ['git/refs'])
        self.assertIn('v1.15.1', api.tags); self.assertNotIn('v1.15.1', api.releases)

    def test_release_inventory_paginates_and_refuses_duplicate_tag_releases(self):
        for index in range(100):
            self.api.releases['v0.synthetic.' + str(index)] = dict(id=100000 + index, tag_name='v0.synthetic.' + str(index))
        self.api.publish()
        self.assertIn(('GET', 'releases?per_page=100&page=2'), self.api.events)
        api = self.api; api.writes = []
        def request(path, data=None, optional=False):
            value = api.request(path, data=data, optional=optional)
            if path == 'releases?per_page=100&page=2': value.append(dict(api.releases['v1.15.1'], id=999))
            return value
        with self.assertRaisesRegex(self.m.PublicationRefused, 'RELEASE_UNIQUE'):
            self.m.publish(request=request, environment=api.environment, node_version='v24.22.1')
        self.assertEqual(api.writes, [])


if __name__ == '__main__':
    unittest.main(verbosity=2)
