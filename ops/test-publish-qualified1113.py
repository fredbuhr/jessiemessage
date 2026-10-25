"""Publication API simulation; no remote mutation, Git tag or real token."""
import base64
import copy
import importlib.util
import json
from pathlib import Path
import unittest
from unittest import mock

HERE=Path(__file__).resolve().parent


def helper():
    spec=importlib.util.spec_from_file_location('publish1113_synthetic',HERE/'publish-qualified1113.py')
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module


class Api:
    def __init__(self,module):
        self.m=module;self.writes=[];self.tags={};self.releases={};self.reads=[];self.fault=None
        self.latest=dict(id=module.BASE_RELEASE_ID,tag_name='v1.11.2',target_commitish=module.BASE_SOURCE)
        self.by_source={release['source']:release for release in module.RELEASES}
        self.by_ci={release['ci']:release for release in module.RELEASES}
        self.tree_sources={release['tree']:release['source'] for release in module.RELEASES}
        self.tree_sources[module.BASE_TREE]=module.BASE_SOURCE
        self.environment=dict(GITHUB_REPOSITORY=module.REPOSITORY,GITHUB_REF='refs/heads/ops/publish-v1.11.3',GITHUB_EVENT_NAME='push')

    def lock(self,version):
        return dict(name='jessiemessage',version=version,packages={'':dict(name='jessiemessage',version=version,engines={'node':'>=24 <25'},dependencies={'mariadb':'3.5.4'})})

    def contents(self,path,source):
        release=self.by_source.get(source);version=release['version'] if release else '1.11.2'
        if path=='package-lock.json':
            value=self.lock(version)
            if self.fault=='dependencies' and version=='1.11.3':value['packages']['']['dependencies']['mariadb']='different'
            text=json.dumps(value)
        elif path=='package.json':text=json.dumps(self.lock(version)['packages'][''])
        else:
            counts=dict(self.m.ACTION_COUNTS,**{self.m.ARTIFACT_ACTION:release['artifacts']})
            text='\n'.join('      uses: '+name for name,count in counts.items() for _ in range(count))
            text+='\n'+('\n'.join(['      node-version: "24.22.1"','      persist-credentials: false','      package-manager-cache: false'])+'\n')*4
            if self.fault=='workflow' and version=='1.11.3':text=text.replace(self.m.ARTIFACT_ACTION,'actions/upload-artifact@untrusted')
        return dict(type='file',encoding='base64',content=base64.b64encode(text.encode()).decode())

    def tree(self,source):
        paths={f'db/migrations/{i:04d}_fixture.sql':str(i).rjust(40,'0') for i in range(1,34)}
        paths.update({name:'7'*40 for name in self.m.VIDEO_NAMES})
        if True:paths.update({name:'8'*40 for name in self.m.EXPERIENCE_NAMES})
        if self.fault=='sql36' and source==self.m.RELEASES[0]['source']:paths[next(iter(self.m.VIDEO_NAMES))]='9'*40
        if self.fault=='rollback38' and source==self.m.RELEASES[0]['source']:paths[next(iter(self.m.EXPERIENCE_NAMES))]='9'*40
        if self.fault=='extra_sql' and source==self.m.RELEASES[0]['source']:paths['other/unreviewed.sql']='a'*40
        return dict(truncated=self.fault=='truncated',tree=[dict(path=path,sha=sha,mode='100644',type='blob') for path,sha in paths.items()])

    def request(self,path,data=None,optional=False):
        if data is not None:
            self.writes.append((path,copy.deepcopy(data)))
            if path=='git/refs':
                tag=data['ref'].removeprefix('refs/tags/');assert tag not in self.tags
                self.tags[tag]=dict(ref=data['ref'],object=dict(type='commit',sha=data['sha']));return copy.deepcopy(self.tags[tag])
            assert path=='releases';tag=data['tag_name'];assert tag not in self.releases
            value={key:item for key,item in data.items() if key!='make_latest'};value.update(id=1112000+len(self.releases),html_url='https://example.invalid/'+tag)
            self.releases[tag]=value
            if data['make_latest']=='true':self.latest=value
            return copy.deepcopy(value)
        self.reads.append(path)
        if path=='releases/latest':return copy.deepcopy(self.latest)
        if path.startswith('git/ref/tags/'):
            value=self.tags.get(path.removeprefix('git/ref/tags/'))
            if value is None:assert optional
            return copy.deepcopy(value)
        if path.startswith('releases/tags/'):
            value=self.releases.get(path.removeprefix('releases/tags/'))
            if value is None:assert optional
            return copy.deepcopy(value)
        if path.startswith('git/commits/'):
            source=path.removeprefix('git/commits/');tree=self.m.BASE_TREE if source==self.m.BASE_SOURCE else self.by_source[source]['tree']
            if self.fault=='tree' and source==self.m.RELEASES[0]['source']:tree='f'*40
            return dict(tree=dict(sha=tree))
        if path.startswith('git/trees/'):return self.tree(self.tree_sources[path.removeprefix('git/trees/').removesuffix('?recursive=1')])
        if path.startswith('compare/'):
            before,_after=path.removeprefix('compare/').split('...')
            return dict(merge_base_commit=dict(sha='f'*40 if self.fault=='ancestry' else before),status='ahead')
        if path.startswith('contents/'):
            selected,source=path.removeprefix('contents/').split('?ref=');return self.contents(selected,source)
        if path.startswith('actions/runs/'):
            selected=path.removeprefix('actions/runs/').split('/');release=self.by_ci[selected[0]];ci=int(release['ci'])
            if len(selected)==1:
                return dict(head_sha=release['source'],head_branch='main',event='push',path='.github/workflows/ci.yml',status='completed',
                    conclusion='failure' if self.fault=='ci' else 'success',run_attempt=2 if self.fault=='rerun' else 1)
            jobs=[dict(name=name,status='completed',conclusion='success',head_sha=release['source'],run_id=ci,run_attempt=1) for name in self.m.EXPECTED_JOBS]
            if self.fault=='jobs':jobs[0]['conclusion']='skipped'
            return dict(total_count=5,jobs=jobs)
        raise AssertionError('unexpected synthetic API '+path)

    def publish(self):return self.m.publish(request=self.request,environment=self.environment,node_version='v24.22.1')


class Publication(unittest.TestCase):
    def setUp(self):
        self.m=helper();self.m.RELEASES=(dict(version='1.11.3',source='c'*40,tree='d'*40,ci='1112001',artifacts=4),)
        self.api=Api(self.m)

    def test_exact_source_qualified_before_writes_and_1113_becomes_latest(self):
        result=self.api.publish();self.assertEqual(result['created'],['v1.11.3'])
        releases=[value for path,value in self.api.writes if path=='releases']
        self.assertEqual([row['make_latest'] for row in releases],['true'])
        self.assertEqual(self.api.latest['tag_name'],'v1.11.3');self.assertFalse(result['deploymentPerformed'])
        self.assertEqual(result['schemaMigrations'],38);self.assertEqual(result['applicationTables'],37)

    def test_identical_retry_verifies_existing_objects_without_any_mutation(self):
        self.api.publish();self.api.writes=[]
        result=self.api.publish();self.assertEqual(result['publicationMode'],'verified_existing_read_only');self.assertEqual(self.api.writes,[])

    def test_interruption_after_tag_creation_resumes_only_release(self):
        self.api.publish();del self.api.releases['v1.11.3'];self.api.latest=dict(id=self.m.BASE_RELEASE_ID,tag_name='v1.11.2',target_commitish=self.m.BASE_SOURCE)
        self.api.writes=[];result=self.api.publish()
        self.assertEqual(result['created'],['v1.11.3']);self.assertEqual([path for path,_ in self.api.writes],['releases'])

    def test_every_native_or_schema_gate_refuses_before_mutation(self):
        for fault in ['ci','rerun','jobs','tree','ancestry','workflow','dependencies','sql36','rollback38','extra_sql','truncated']:
            with self.subTest(fault=fault):
                api=Api(self.m);api.fault=fault
                with self.assertRaises(self.m.PublicationRefused):api.publish()
                self.assertEqual(api.writes,[])

    def test_wrong_latest_or_existing_conflict_is_never_repaired_by_a_write(self):
        for fault in ['latest','tag','release']:
            with self.subTest(fault=fault):
                api=Api(self.m)
                if fault=='latest':api.latest=dict(id=999,tag_name='v1.8.5',target_commitish='a'*40)
                if fault=='tag':api.tags['v1.11.3']=dict(ref='refs/tags/v1.11.3',object=dict(type='commit',sha='f'*40))
                if fault=='release':
                    api.tags['v1.11.3']=dict(ref='refs/tags/v1.11.3',object=dict(type='commit',sha='c'*40))
                    api.releases['v1.11.3']=dict(self.m.metadata(self.m.RELEASES[0]),id=1112001,name='modified existing release')
                with self.assertRaises(self.m.PublicationRefused):api.publish()
                self.assertEqual(api.writes,[])

    def test_unexpected_workflow_context_or_node_version_never_accesses_api(self):
        for environment,node in [(dict(self.api.environment,GITHUB_EVENT_NAME='pull_request'),'v24.22.1'),(self.api.environment,'v24.19.0')]:
            with self.subTest(node=node),mock.patch.object(self.m,'github',side_effect=AssertionError('no network')):
                with self.assertRaises(self.m.PublicationRefused):self.m.publish(request=lambda *_args,**_kwargs:(_ for _ in ()).throw(AssertionError('no API')),environment=environment,node_version=node)

    def test_pending_pins_refuse_before_node_or_api(self):
        module=helper()
        pending=tuple(dict(release,source='QUALIFICATION_PENDING',tree='QUALIFICATION_PENDING',ci='QUALIFICATION_PENDING') for release in module.RELEASES)
        with mock.patch.object(module,'RELEASES',pending), \
                mock.patch.object(module.subprocess,'check_output',side_effect=AssertionError('no process')):
            with self.assertRaisesRegex(module.PublicationRefused,'QUALIFICATION_PINS_REQUIRED'):
                module.publish(request=lambda *_args,**_kwargs:(_ for _ in ()).throw(AssertionError('no API')))


if __name__=='__main__':unittest.main(verbosity=2)
