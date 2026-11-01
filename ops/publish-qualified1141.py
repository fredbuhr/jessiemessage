#!/usr/bin/env python3
"""Publish the single qualified1141 source as latest after native main CI.

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
BASE_SOURCE = '4f3ce5de5ba059bc5fb4f3dc20aaf3c6202ea9bd'
BASE_TREE = 'e5a239eaf7b8c3395a843c9e0d600efeb7aa569b'
BASE_RELEASE_ID = 430149586
BASE_VERSION = '1.14.0'
RELEASES = (
    dict(version='1.14.1', source='c803c2c9be16c0c4ee218d8cac4a1272620d2772', tree='f391b5cebe0a8a8ffd63c818cd481b50970336f1',
         ci='41321950561', attempt=1, artifacts=4),
)
EXPECTED_JOBS = {'verify', 'MariaDB 10.11', 'MariaDB 11.4', 'Chrome keyboard and chat lifecycle',
                 'Chrome HTTPS authentication and messaging with MariaDB'}
VIDEO_NAMES = {'server/video/migrations/0034_video_storage_state.sql', 'server/video/migrations/0035_video_assets.sql', 'server/video/migrations/0036_message_video.sql'}
EXPERIENCE_NAMES = {'server/experience/migrations/0037_profile_preferences.sql', 'server/experience/migrations/0038_reply_tracking.sql'}
ACTION_COUNTS = {'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1':4,
    'actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1':4}
ARTIFACT_ACTION = 'actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9'


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


def verify_locked_dependencies(baseline, candidate):
    """SQL38's complete lock is immutable apart from its two app versions."""
    baseline, candidate = copy.deepcopy(baseline), copy.deepcopy(candidate)
    for value in (baseline, candidate):
        value['version'] = value['packages']['']['version'] = 'VERSION'
    require(candidate == baseline, 'LOCKED_DEPENDENCIES')


def metadata(release):
    version, source, ci = (release[key] for key in ('version', 'source', 'ci'))
    name = 'JessieMessage 1.14.1 — Fiabilité des médias'
    details = [
        'La préparation des photos peut être annulée pendant l’encodage et reste bornée dans le temps ; le secours HEIC encode dans le document si le worker ne dispose pas de canvas 2D, avec transfert limité aux pixels déjà réduits.',
        'Les brouillons, légendes et sélections sont préservés dans les parcours corrigés ; les erreurs utiles restent visibles et les envois incertains ne sont pas répétés automatiquement.',
        'Les sélecteurs de médias et l’avatar réutilisent la préparation locale, avec reprise des sélections non commencées après vérification du propriétaire.',
        'Le nettoyage photo retrouve ses fichiers temporaires et ses reprises interrompues ; les photos encore utilisées par une diffusion active restent protégées et le quota ne se libère qu’après nettoyage confirmé.',
        'Le format et la cause du refus de la photo cliente initiale ne sont pas attestés. Le contenu du fichier, les capacités du navigateur et les ressources de l’appareil peuvent encore empêcher sa préparation ; cette version ne garantit pas tous les fichiers ni des capacités illimitées.',
        'Node 24.22.1, SQL 38/37 tables attendues et les six dépendances verrouillées, dont libheif-js 1.23.5, restent inchangés. Autorisations, sessions et limites natives restent protégées.',
        'Cette publication ne déploie pas l’application et ne modifie ni le runtime hébergé, ni ses métadonnées ou comptes.',
    ]
    return dict(tag_name='v'+version, target_commitish=source, name=name,
        body='\n'.join(details + ['', 'Commit : `'+source+'`.',
            'Validation : [CI complète, 5/5 jobs](https://github.com/'+REPOSITORY+'/actions/runs/'+ci+'), tentative '+str(release['attempt'])+'.',
            '', 'L’identité hébergée et ses preuves sont suivies dans [REPRISE](https://github.com/'+REPOSITORY+'/blob/main/docs/REPRISE.md) ; une publication ne vaut pas activation.']),
        draft=False, prerelease=False)


def publish(*, request=github, environment=None, node_version=None):
    environment = os.environ if environment is None else environment
    for release in RELEASES:
        require(re.fullmatch('[a-f0-9]{40}', release['source']) and re.fullmatch('[a-f0-9]{40}', release['tree'])
            and re.fullmatch('[1-9][0-9]*', release['ci'])
            and type(release['attempt']) is int and release['attempt'] >= 1, 'QUALIFICATION_PINS_REQUIRED')
    require([row['version'] for row in RELEASES] == ['1.14.1']
        and len({row['source'] for row in RELEASES} | {BASE_SOURCE}) == 2, 'RELEASE_IDENTITIES')
    require(environment.get('GITHUB_REPOSITORY') == REPOSITORY
        and environment.get('GITHUB_REF') == 'refs/heads/ops/publish-v1.14.1'
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
        jobs = api('actions/runs/'+str(ci)+'/jobs?per_page=100')
        require(jobs.get('total_count') == 5 and len(jobs.get('jobs',[])) == 5
            and {job.get('name') for job in jobs['jobs']} == EXPECTED_JOBS
            and all(job.get('status') == 'completed' and job.get('conclusion') == 'success'
                and job.get('head_sha') == source and job.get('run_id') == ci and job.get('run_attempt') == release['attempt'] for job in jobs['jobs']), 'FIVE_NATIVE_JOBS_REQUIRED')
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
    def latest_state():
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
    return dict(status='published_verified',nodeVersion='24.22.1',schemaMigrations=38,applicationTables=37,
        normalMigrations=33,videoMigrations=3,experienceMigrations=2,
        releases=[dict(tag='v'+release['version'],source=release['source'],tree=release['tree'],ciRun=release['ci'],ciAttempt=release['attempt'],releaseId=value['id']) for release,value in zip(RELEASES,existing)],
        latest=dict(tag='v1.14.1',source=RELEASES[0]['source'],id=existing[0]['id']),
        publicationMode='created' if created else 'verified_existing_read_only',created=created,deploymentPerformed=False)


if __name__ == '__main__':
    try:
        require(not __import__('sys').argv[1:],'USAGE')
        print(json.dumps(publish(),separators=(',',':')))
    except Exception as error:
        code=str(error) if isinstance(error,PublicationRefused) else 'PUBLICATION_NOT_CONFIRMED'
        print(json.dumps(dict(status='publication_not_confirmed',code=code,deploymentPerformed=False),separators=(',',':')))
        raise SystemExit(1)
