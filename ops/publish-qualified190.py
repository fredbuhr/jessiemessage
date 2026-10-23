#!/usr/bin/env python3
"""Publish qualified185 without changing latest, then qualified190 as latest.

The two exact main CI runs and all existing remote objects are inspected before
any mutation. This helper never edits releases, moves tags or deploys anything.
All source/tree/CI pins must be finalized after independent qualifications.
"""
import base64
import json
import os
import re
import subprocess
import urllib.error
import urllib.request

REPOSITORY = 'fredbuhr/jessiemessage'
BASE_SOURCE = '1a41e08abc87c3a29d9163fbf8cd2342eb04693c'
BASE_TREE = 'e0964b50c03d3881d851f01f86f58777d22b2c10'
BASE_RELEASE_ID = 421341347
RELEASES = (
    dict(version='1.8.5', source='7a40de9742bdbedc5c0829d820882ca08bf23a91', tree='7ec449cb3a63a091c5233993923ceb69f8314366', ci='39958956620', artifacts=2),
    dict(version='1.9.0', source='5dda0dd4453d34a0be839d2a1402301dea835381', tree='f06a140e738f20994425c714a278b0646f651c1b', ci='39962172927', artifacts=3),
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
    request = urllib.request.Request('https://api.github.com/repos/' + REPOSITORY + '/' + path,
        data=None if data is None else json.dumps(data).encode(), headers={
            'Authorization':'Bearer ' + os.environ['GH_TOKEN'], 'Accept':'application/vnd.github+json',
            'Content-Type':'application/json', 'X-GitHub-Api-Version':'2022-11-28'},
        method='GET' if data is None else 'POST')
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    try:
        with opener.open(request, timeout=30) as response:
            body = response.read(2 * 1024 * 1024 + 1)
            require(response.status in (200, 201) and len(body) <= 2 * 1024 * 1024, 'API_RESPONSE')
            return json.loads(body)
    except urllib.error.HTTPError as error:
        if optional and error.code == 404:
            return None
        raise PublicationRefused('API_HTTP_' + str(error.code)) from None


def metadata(release):
    version, source, ci = (release[key] for key in ('version', 'source', 'ci'))
    if version == '1.8.5':
        name = 'JessieMessage 1.8.5 — Repli technique SQL38'
        details = ['Repli technique qualifié pour SQL38, sans activation en production.',
            'Préserve les préférences chiffrées et les tâches de suivi créées par 1.9.0 ; les nouvelles rubriques restent désactivées.',
            'Conserve les messages et médias existants. Un client ne peut pas envoyer de vidéo.',
            'Ne devient pas la dernière version publique et ne constitue pas un repli hébergé vérifié avant son CHECK SQL38.']
    else:
        name = 'JessieMessage 1.9.0 — Profils, photos et suivi des réponses'
        details = ['Version fonctionnelle qualifiée ; migration SQL36 vers SQL38 et activation hébergée restent séparées.',
            'Préférences facultatives privées ; vidéos envoyées uniquement par les administrateurs.',
            'Galerie sur l’historique autorisé, navigation par date et retour au message ; envoi de plusieurs photos avec reprise ciblée.',
            'Suivi interne À répondre ; changement volontaire du mot de passe et visibilité de saisie.',
            'Node.js 24.22.1 ; 33 migrations de base, 3 vidéo et 2 expérience, soit 38 migrations et 37 tables physiques.',
            'Après migration, 184 et 172 ne doivent pas être redémarrées. Le repli 185 exige ses propres contrôles hébergés.',
            'Aucun essai hébergé de sauvegarde, message réel ou Push réel n’est effectué par cette publication.']
    return dict(tag_name='v'+version, target_commitish=source, name=name,
        body='\n'.join(details + ['', 'Commit : `'+source+'`.',
            'Validation : [CI complète, 5/5 jobs](https://github.com/'+REPOSITORY+'/actions/runs/'+ci+').',
            '', 'La production reste 1.8.4 / SQL36 jusqu’à activation ; voir [REPRISE](https://github.com/'+REPOSITORY+'/blob/main/docs/REPRISE.md).']),
        draft=False, prerelease=False)


def publish(*, request=github, environment=None, node_version=None):
    environment = os.environ if environment is None else environment
    for release in RELEASES:
        require(re.fullmatch('[a-f0-9]{40}', release['source']) and re.fullmatch('[a-f0-9]{40}', release['tree'])
            and re.fullmatch('[1-9][0-9]*', release['ci']), 'QUALIFICATION_PINS_REQUIRED')
    require([row['version'] for row in RELEASES] == ['1.8.5', '1.9.0']
        and len({row['source'] for row in RELEASES} | {BASE_SOURCE}) == 3, 'RELEASE_IDENTITIES')
    require(environment.get('GITHUB_REPOSITORY') == REPOSITORY
        and environment.get('GITHUB_REF') == 'refs/heads/ops/publish-v1.9.0'
        and environment.get('GITHUB_EVENT_NAME') == 'push', 'WORKFLOW_CONTEXT')
    if node_version is None:
        node_version = subprocess.check_output(['node','--version'], text=True, timeout=5).strip()
    require(node_version == 'v24.22.1', 'NODE_VERSION')
    qualified = False
    def api(path, data=None, optional=False):
        require(data is None or qualified, 'QUALIFICATION_BEFORE_MUTATION')
        return request(path, data=data, optional=optional)
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
    base_lock['version'] = base_lock['packages']['']['version'] = 'VERSION'
    experience = None; previous = BASE_SOURCE
    for release in RELEASES:
        source, ci = release['source'], int(release['ci'])
        run = api('actions/runs/'+str(ci))
        require(run.get('head_sha') == source and run.get('head_branch') == 'main' and run.get('event') == 'push'
            and run.get('path') == '.github/workflows/ci.yml' and run.get('status') == 'completed'
            and run.get('conclusion') == 'success' and run.get('run_attempt') == 1, 'MAIN_CI_REQUIRED')
        jobs = api('actions/runs/'+str(ci)+'/jobs?per_page=100')
        require(jobs.get('total_count') == 5 and len(jobs.get('jobs',[])) == 5
            and {job.get('name') for job in jobs['jobs']} == EXPECTED_JOBS
            and all(job.get('status') == 'completed' and job.get('conclusion') == 'success'
                and job.get('head_sha') == source and job.get('run_id') == ci and job.get('run_attempt') == 1 for job in jobs['jobs']), 'FIVE_NATIVE_JOBS_REQUIRED')
        current = tree(source,release['tree']); ancestor(previous,source); previous=source
        package, lock = (json.loads(contents(name,source)) for name in ('package.json','package-lock.json'))
        require(package.get('name') == lock.get('name') == lock['packages']['']['name'] == 'jessiemessage'
            and package.get('version') == lock.get('version') == lock['packages']['']['version'] == release['version']
            and package['engines']['node'] == lock['packages']['']['engines']['node'] == '>=24 <25'
            and package.get('dependencies') == lock['packages'][''].get('dependencies'), 'PACKAGE_IDENTITY')
        lock['version'] = lock['packages']['']['version'] = 'VERSION'
        require(lock == base_lock, 'LOCKED_DEPENDENCIES')
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
    ancestor(RELEASES[1]['source'],'main')
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
    require(existing[1] is None or existing[0] is not None,'MISSING_TECHNICAL_ROLLBACK_RELEASE')
    def latest_state():
        latest=api('releases/latest')
        if existing[1] is not None:
            same_release(latest,expected[1]); require(latest['id'] == existing[1]['id'],'LATEST_IDENTITY')
        else:
            require(latest.get('id') == BASE_RELEASE_ID and latest.get('tag_name') == 'v1.8.4'
                and latest.get('target_commitish') == BASE_SOURCE,'PREVIOUS_LATEST')
        return latest
    latest_state(); qualified=True
    created=[]
    for index,(release,desired) in enumerate(zip(RELEASES,expected)):
        tag='v'+release['version']; latest_state()
        if existing[index] is None:
            if references[index] is None: api('git/refs',{'ref':'refs/tags/'+tag,'sha':release['source']})
            same_tag(api('git/ref/tags/'+tag),release); latest_state()
            api('releases',dict(desired,make_latest='true' if index == 1 else 'false'))
            existing[index]=api('releases/tags/'+tag); created.append(tag)
        same_tag(api('git/ref/tags/'+tag),release); same_release(existing[index],desired); latest_state()
    return dict(status='published_verified',nodeVersion='24.22.1',schemaMigrations=38,applicationTables=37,
        normalMigrations=33,videoMigrations=3,experienceMigrations=2,
        releases=[dict(tag='v'+release['version'],source=release['source'],tree=release['tree'],ciRun=release['ci'],releaseId=value['id']) for release,value in zip(RELEASES,existing)],
        latest=dict(tag='v1.9.0',source=RELEASES[1]['source'],id=existing[1]['id']),
        publicationMode='created' if created else 'verified_existing_read_only',created=created,deploymentPerformed=False)


if __name__ == '__main__':
    try:
        require(not __import__('sys').argv[1:],'USAGE')
        print(json.dumps(publish(),separators=(',',':')))
    except Exception as error:
        code=str(error) if isinstance(error,PublicationRefused) else 'PUBLICATION_NOT_CONFIRMED'
        print(json.dumps(dict(status='publication_not_confirmed',code=code,deploymentPerformed=False),separators=(',',':')))
        raise SystemExit(1)
