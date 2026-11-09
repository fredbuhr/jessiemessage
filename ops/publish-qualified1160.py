#!/usr/bin/env python3
"""Publish the single qualified1160 source as latest after native main CI.

The exact main CI run and all existing remote objects are inspected before
any mutation. This helper never edits releases, moves tags or deploys anything.
All source/tree/CI pins must be finalized after independent qualifications.
"""
import base64
import copy
import json
import os
import re
import subprocess
import time
import urllib.error
import urllib.request

REPOSITORY = 'fredbuhr/jessiemessage'
BASE_SOURCE = 'a4a07f9f31c47a7185b57d11b8277be1d87fd2c1'
BASE_TREE = '568530e702fa4d0a8a6b1743988c5e20b8656c40'
BASE_RELEASE_ID = 432505702
BASE_VERSION = '1.15.1'
# Exact PR150 merge and main CI run. The publish gate independently checks all five completed jobs.
MAIN_SOURCE = 'd2b57fb88d58aacf64dd51c5d1952c65f5c327ae'
MAIN_TREE = '632ec530d812fa75cf2aa4b603c91c81dcaf7e8e'
MAIN_CI = '42638900913'
RELEASES = (
    dict(version='1.16.0', source=MAIN_SOURCE, tree=MAIN_TREE,
         ci=MAIN_CI, attempt=2, artifacts=4),
)
EXPECTED_JOBS = {'verify', 'MariaDB 10.11', 'MariaDB 11.4', 'Chrome keyboard and chat lifecycle',
                 'Chrome HTTPS authentication and messaging with MariaDB'}
RETRIED_JOB = 'Chrome keyboard and chat lifecycle'
QUALIFIED_JOB_IDS = {
    1: {
        'verify': 129234374480,
        'Chrome HTTPS authentication and messaging with MariaDB': 129234374805,
        'MariaDB 11.4': 129234374831,
        RETRIED_JOB: 129234375026,
        'MariaDB 10.11': 129234375059,
    },
    2: {
        'verify': 129239086835,
        'Chrome HTTPS authentication and messaging with MariaDB': 129239038193,
        'MariaDB 11.4': 129239038489,
        RETRIED_JOB: 129239034324,
        'MariaDB 10.11': 129239105614,
    },
}
# Retained rows may normalize runner_group_id from 0 to null during a rerun.
RETAINED_JOB_FIELDS = ('started_at', 'completed_at', 'steps', 'runner_id', 'runner_name', 'runner_group_name')
VIDEO_NAMES = {'server/video/migrations/0034_video_storage_state.sql', 'server/video/migrations/0035_video_assets.sql', 'server/video/migrations/0036_message_video.sql'}
EXPERIENCE_NAMES = {'server/experience/migrations/0037_profile_preferences.sql', 'server/experience/migrations/0038_reply_tracking.sql'}
ACTION_COUNTS = {'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1':4,
    'actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1':4}
ARTIFACT_ACTION = 'actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9'


OLD_ROOT_DEPENDENCIES = {'libheif-js': '1.23.5', 'mariadb': '3.5.4', 'nodemailer': '10.1.4',
                         'otpauth': '9.5.2', 'sharp': '0.35.5', 'web-push': '3.6.7',
                         '@imagemagick/magick-wasm': '0.0.45', '@phenomen/libavif-wasm': '1.4.203', 'heic-to': '1.6.7'}


class PublicationRefused(Exception):
    pass


def require(ok, code):
    if not ok:
        raise PublicationRefused(code)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        raise PublicationRefused('API_REDIRECT')


def github(path, data=None, optional=False):
    method = 'GET' if data is None else 'POST'
    request = urllib.request.Request('https://api.github.com/repos/' + REPOSITORY + '/' + path,
        data=None if data is None else json.dumps(data).encode(), headers={
            'Authorization':'Bearer ' + os.environ['GH_TOKEN'], 'Accept':'application/vnd.github+json',
            'Content-Type':'application/json', 'X-GitHub-Api-Version':'2022-11-28'},
        method=method)
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    try:
        with opener.open(request, timeout=30) as response:
            body = response.read(2 * 1024 * 1024 + 1)
            require(response.status in (200, 201) and len(body) <= 2 * 1024 * 1024, 'API_RESPONSE')
            return json.loads(body)
    except urllib.error.HTTPError as error:
        if optional and error.code == 404:
            return None
        raise PublicationRefused('API_HTTP_' + str(error.code) + ' ' + method + ' ' + path) from None


def dependency_pins():
    require(type(OLD_ROOT_DEPENDENCIES) is dict and len(OLD_ROOT_DEPENDENCIES) == 9
        and all(isinstance(name, str) and name and isinstance(version, str)
            and re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+', version) for name, version in OLD_ROOT_DEPENDENCIES.items()),
        'DEPENDENCY_PINS_REQUIRED')


def verify_locked_dependencies(baseline, candidate):
    """Preserve the complete 1.15.1 dependency graph; only root versions change."""
    dependency_pins()
    baseline, candidate = copy.deepcopy(baseline), copy.deepcopy(candidate)
    require(baseline.get('lockfileVersion') == candidate.get('lockfileVersion') == 3
        and baseline.get('version') == baseline.get('packages', {}).get('', {}).get('version') == BASE_VERSION
        and candidate.get('version') == candidate.get('packages', {}).get('', {}).get('version') == '1.16.0',
        'LOCKED_DEPENDENCIES')
    require(baseline['packages'][''].get('dependencies') == candidate['packages'][''].get('dependencies') == OLD_ROOT_DEPENDENCIES,
        'LOCKED_DEPENDENCIES')
    for value in (baseline, candidate):
        value['version'] = value['packages']['']['version'] = 'VERSION'
    require(candidate == baseline, 'LOCKED_DEPENDENCIES')


def metadata(release):
    version, source, ci = (release[key] for key in ('version', 'source', 'ci'))
    name = 'JessieMessage 1.16.0 — Emojis et continuité du stockage'
    details = [
        '- Le sélecteur reste ouvert après chaque emoji. Les choix suivants sont insérés au curseur. [PR149](https://github.com/fredbuhr/jessiemessage/pull/149)',
        '- Les emojis sont agrandis dans les messages et les légendes. Un emoji seul dans une bulle bénéficie d’une taille supérieure. [PR149](https://github.com/fredbuhr/jessiemessage/pull/149)',
        '- Après un remontage vérifié, une attestation privée permet de retrouver l’empreinte historique des racines photo et vidéo. Le contrôle des répertoires ouverts continue d’utiliser leur identité physique actuelle. [PR150](https://github.com/fredbuhr/jessiemessage/pull/150)',
        '- La compatibilité conserve les liaisons SQL et les reçus de fermeture existants. Elle exige la qualification et l’enregistrement séparés des attestations sur l’hébergement. [PR150](https://github.com/fredbuhr/jessiemessage/pull/150)',
        '- Node.js 24.22.1, le graphe verrouillé des neuf dépendances et le schéma attendu de 38 migrations et 37 tables restent inchangés.',
        '- Cette publication ne déploie pas l’application et n’écrit aucune attestation sur l’hébergement.',
    ]
    return dict(tag_name='v'+version, target_commitish=source, name=name,
        body='\n'.join(details + ['', 'Source publiée au commit `'+source+'`.',
            '[CI complète, 5/5 jobs](https://github.com/'+REPOSITORY+'/actions/runs/'+ci+'), tentative '+str(release['attempt'])+' après reprise du seul job Chrome de clavier et messagerie. Les quatre autres jobs sont ceux de la première tentative.',
            '', 'L’identité hébergée et ses preuves sont suivies dans [REPRISE](https://github.com/'+REPOSITORY+'/blob/main/docs/REPRISE.md).']),
        draft=False, prerelease=False)


def publish(*, request=github, environment=None, node_version=None):
    environment = os.environ if environment is None else environment
    for release in RELEASES:
        require(all(isinstance(release.get(key), str) for key in ('source', 'tree', 'ci'))
            and re.fullmatch('[a-f0-9]{40}', release['source']) and re.fullmatch('[a-f0-9]{40}', release['tree'])
            and re.fullmatch('[1-9][0-9]*', release['ci'])
            and type(release['attempt']) is int and release['attempt'] >= 1, 'QUALIFICATION_PINS_REQUIRED')
    dependency_pins()
    require([(row['version'], row['attempt']) for row in RELEASES] == [('1.16.0', 2)]
        and len({row['source'] for row in RELEASES} | {BASE_SOURCE}) == 2, 'RELEASE_IDENTITIES')
    require(environment.get('GITHUB_REPOSITORY') == REPOSITORY
        and environment.get('GITHUB_REF') == 'refs/heads/ops/publish-v1.16.0'
        and environment.get('GITHUB_EVENT_NAME') == 'push', 'WORKFLOW_CONTEXT')
    if node_version is None:
        node_version = subprocess.check_output(['node','--version'], text=True, timeout=5).strip()
    require(node_version == 'v24.22.1', 'NODE_VERSION')
    qualified = False
    def api(path, data=None, optional=False):
        require(data is None or qualified, 'QUALIFICATION_BEFORE_MUTATION')
        return request(path, data=data, optional=optional)
    def confirm_created(path):
        # A successful POST is never repeated. Only its durable GET receipt
        # may lag briefly behind creation on another API replica.
        for attempt in range(3):
            value = api(path, optional=True)
            if value is not None:
                return value
            if attempt < 2:
                time.sleep(1)
        raise PublicationRefused('API_HTTP_404 GET ' + path + ' CONFIRMATION_NOT_VISIBLE')
    def contents(path, source):
        value = api('contents/'+path+'?ref='+source)
        require(value.get('type') == 'file' and value.get('encoding') == 'base64', 'SOURCE_FILE')
        return base64.b64decode(value['content']).decode('utf-8')
    def blobs(value, prefix):
        return {item['path']:(item['sha'],item['mode']) for item in value['tree']
            if item['type'] == 'blob' and item['path'].startswith(prefix)}
    def tree(source, expected):
        require(api('git/commits/'+source)['tree']['sha'] == expected, 'SOURCE_TREE')
        value = api('git/trees/'+expected+'?recursive=1'); require(value.get('truncated') is False, 'TREE_TRUNCATED')
        return value
    def ancestor(before, after):
        value = api('compare/'+before+'...'+after)
        require(value['merge_base_commit']['sha'] == before and value['status'] in ('identical','ahead'), 'SOURCE_ANCESTRY')
    def baseline_publication():
        tag = api('git/ref/tags/v' + BASE_VERSION)
        require(type(tag) is dict and tag.get('ref') == 'refs/tags/v' + BASE_VERSION
            and tag.get('object', {}).get('type') == 'commit' and tag['object'].get('sha') == BASE_SOURCE,
            'BASE_TAG_IDENTITY')
        published = api('releases/tags/v' + BASE_VERSION)
        by_id = api('releases/' + str(BASE_RELEASE_ID))
        fields = ('id', 'tag_name', 'target_commitish', 'name', 'body', 'draft', 'prerelease')
        for value in (published, by_id):
            require(type(value) is dict and type(value.get('id')) is int and value['id'] == BASE_RELEASE_ID
                and value.get('tag_name') == 'v' + BASE_VERSION and value.get('target_commitish') == BASE_SOURCE
                and value.get('draft') is False and value.get('prerelease') is False
                and isinstance(value.get('name'), str) and isinstance(value.get('body'), str), 'BASE_RELEASE_IDENTITY')
        selected = {key: published[key] for key in fields}
        require(selected == {key: by_id[key] for key in fields}, 'BASE_RELEASE_IDENTITY')
        return dict(tag=tag['ref'], source=tag['object']['sha'], release=selected)
    preserved_baseline = baseline_publication()
    def preserve_baseline():
        require(baseline_publication() == preserved_baseline, 'BASE_PUBLICATION_CHANGED')
    def unique_release(expected):
        rows = []
        for page in range(1, 11):
            values = api('releases?per_page=100&page=' + str(page))
            require(type(values) is list and len(values) <= 100 and all(type(value) is dict for value in values),
                'RELEASE_INVENTORY')
            rows.extend(values)
            if len(values) < 100:
                break
        else:
            raise PublicationRefused('RELEASE_INVENTORY_INCOMPLETE')
        prior = [value for value in rows if value.get('tag_name') == 'v' + BASE_VERSION]
        require(len(prior) == 1 and prior[0].get('id') == BASE_RELEASE_ID, 'BASE_RELEASE_UNIQUE')
        selected = [value for value in rows if value.get('tag_name') == 'v' + RELEASES[0]['version']]
        require((expected is None and not selected) or (expected is not None and len(selected) == 1
            and selected[0].get('id') == expected['id']), 'RELEASE_UNIQUE')
    baseline = tree(BASE_SOURCE, BASE_TREE)
    normal = blobs(baseline,'db/migrations/'); video = blobs(baseline,'server/video/migrations/')
    require(len(normal) == 33 and set(video) == VIDEO_NAMES, 'BASELINE_MIGRATIONS')
    base_lock = json.loads(contents('package-lock.json',BASE_SOURCE))
    experience = blobs(baseline,'server/experience/migrations/'); previous = BASE_SOURCE
    require(set(experience) == EXPERIENCE_NAMES, 'BASELINE_SQL38')
    for release in RELEASES:
        source, ci = release['source'], int(release['ci'])
        run = api('actions/runs/'+str(ci))
        require(run.get('head_sha') == source and run.get('head_branch') == 'main' and run.get('event') == 'push'
            and run.get('path') == '.github/workflows/ci.yml' and run.get('status') == 'completed'
            and run.get('conclusion') == 'success' and run.get('run_attempt') == release['attempt'], 'MAIN_CI_REQUIRED')
        jobs = api('actions/runs/'+str(ci)+'/jobs?filter=all&per_page=100')
        rows = jobs.get('jobs', [])
        selected_jobs = {(job.get('run_attempt'), job.get('name')): job for job in rows}
        expected_ids = {(attempt, name): job_id for attempt, records in QUALIFIED_JOB_IDS.items()
                        for name, job_id in records.items()}
        require(jobs.get('total_count') == len(rows) == len(selected_jobs) == 10
            and set(selected_jobs) == set(expected_ids) == {(attempt, name) for attempt in (1, 2) for name in EXPECTED_JOBS}
            and all(job.get('id') == expected_ids[key] and job.get('status') == 'completed'
                and job.get('conclusion') == ('failure' if key == (1, RETRIED_JOB) else 'success')
                and job.get('head_sha') == source and job.get('run_id') == ci
                for key, job in selected_jobs.items()), 'FIVE_NATIVE_JOBS_REQUIRED')
        for name in EXPECTED_JOBS - {RETRIED_JOB}:
            first, retained = selected_jobs[(1, name)], selected_jobs[(2, name)]
            require(all(isinstance(first.get(field), str) and first[field] for field in ('started_at', 'completed_at'))
                and isinstance(first.get('steps'), list) and first['steps']
                and all(field in first and field in retained and first[field] == retained[field]
                    for field in RETAINED_JOB_FIELDS), 'RETAINED_JOBS_REQUIRED')
        current = tree(source,release['tree']); ancestor(previous,source); previous=source
        package, lock = (json.loads(contents(name,source)) for name in ('package.json','package-lock.json'))
        require(package.get('name') == lock.get('name') == lock['packages']['']['name'] == 'jessiemessage'
            and package.get('version') == lock.get('version') == lock['packages']['']['version'] == release['version']
            and package['engines']['node'] == lock['packages']['']['engines']['node'] == '>=24 <25'
            and package.get('dependencies') == lock['packages'][''].get('dependencies'), 'PACKAGE_IDENTITY')
        verify_locked_dependencies(base_lock, lock)
        workflow = contents('.github/workflows/ci.yml',source)
        uses = re.findall(r'(?m)^\s+uses: ([^\s#]+)(?:[ \t]+#[^\n]*)?[ \t]*$',workflow)
        expected_uses = dict(ACTION_COUNTS, **{ARTIFACT_ACTION:release['artifacts']})
        require({name:uses.count(name) for name in set(uses)} == expected_uses
            and len(re.findall(r'(?m)^\s+node-version: "24\.22\.1"[ \t]*$',workflow)) == 4
            and len(re.findall(r'(?m)^\s+persist-credentials: false[ \t]*$',workflow)) == 4
            and len(re.findall(r'(?m)^\s+package-manager-cache: false[ \t]*$',workflow)) == 4, 'NATIVE_WORKFLOW')
        require(blobs(current,'db/migrations/') == normal and blobs(current,'server/video/migrations/') == video, 'IMMUTABLE_SQL36')
        selected = blobs(current,'server/experience/migrations/')
        require(set(selected) == EXPERIENCE_NAMES and all(mode == '100644' for _,mode in selected.values()), 'EXPERIENCE_SQL38')
        if experience is not None: require(selected == experience, 'ROLLBACK_SQL38_COMPATIBILITY')
        experience=selected
        require({item['path'] for item in current['tree'] if item['type'] == 'blob' and item['path'].endswith('.sql')}
            == set(normal)|set(video)|EXPERIENCE_NAMES, 'EXACT_SQL_INVENTORY')
    ancestor(RELEASES[0]['source'],'main')
    expected = [metadata(release) for release in RELEASES]
    def same_release(value, desired):
        require(type(value) is dict and type(value.get('id')) is int and value['id'] > 0
            and all(value.get(key) == item for key,item in desired.items()), 'IMMUTABLE_RELEASE_METADATA')
    def same_tag(value, release):
        require(value.get('ref') == 'refs/tags/v'+release['version'] and value['object']['type'] == 'commit'
            and value['object']['sha'] == release['source'], 'IMMUTABLE_TAG')
    references, existing = [], []
    for release, desired in zip(RELEASES,expected):
        tag='v'+release['version']; reference=api('git/ref/tags/'+tag,optional=True); published=api('releases/tags/'+tag,optional=True)
        if reference is not None: same_tag(reference,release)
        if published is not None:
            require(reference is not None,'RELEASE_WITHOUT_TAG'); same_release(published,desired)
        references.append(reference); existing.append(published)
    unique_release(existing[0])
    def latest_state():
        preserve_baseline()
        latest=api('releases/latest')
        if existing[0] is not None:
            same_release(latest,expected[0]); require(latest['id'] == existing[0]['id'],'LATEST_IDENTITY')
        else:
            require(latest.get('id') == BASE_RELEASE_ID and latest.get('tag_name') == 'v'+BASE_VERSION
                and latest.get('target_commitish') == BASE_SOURCE,'PREVIOUS_LATEST')
        return latest
    latest_state(); qualified=True
    created=[]
    for index,(release,desired) in enumerate(zip(RELEASES,expected)):
        tag='v'+release['version']; latest_state()
        if existing[index] is None:
            if references[index] is None:
                api('git/refs',{'ref':'refs/tags/'+tag,'sha':release['source']})
                reference=confirm_created('git/ref/tags/'+tag)
            else:
                reference=api('git/ref/tags/'+tag)
            same_tag(reference,release); latest_state()
            api('releases',dict(desired,make_latest='true'))
            existing[index]=confirm_created('releases/tags/'+tag); created.append(tag)
        same_tag(api('git/ref/tags/'+tag),release); same_release(existing[index],desired); latest_state()
    preserve_baseline(); unique_release(existing[0])
    return dict(status='published_verified',previousReleasePreserved=True,previousReleaseId=BASE_RELEASE_ID,uniqueReleaseVerified=True,nodeVersion='24.22.1',schemaMigrations=38,applicationTables=37,
        normalMigrations=33,videoMigrations=3,experienceMigrations=2,
        releases=[dict(tag='v'+release['version'],source=release['source'],tree=release['tree'],ciRun=release['ci'],ciAttempt=release['attempt'],releaseId=value['id']) for release,value in zip(RELEASES,existing)],
        latest=dict(tag='v1.16.0',source=RELEASES[0]['source'],id=existing[0]['id']),
        publicationMode='created' if created else 'verified_existing_read_only',created=created,deploymentPerformed=False)


if __name__ == '__main__':
    try:
        require(not __import__('sys').argv[1:],'USAGE')
        print(json.dumps(publish(),separators=(',',':')))
    except Exception as error:
        code=str(error) if isinstance(error,PublicationRefused) else 'PUBLICATION_NOT_CONFIRMED'
        print(json.dumps(dict(status='publication_not_confirmed',code=code,deploymentPerformed=False),separators=(',',':')))
        raise SystemExit(1)
