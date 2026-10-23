# Mise en service de la 1.9.0

**Migration SQL38 terminée et reçu confirmé selon les preuves utilisateur.** Le statut indique 38 migrations appliquées/0 en attente. Les empreintes du marqueur et du reçu correspondent exactement aux corps déterministes du helper qualifié : `applied:2`, `unchanged:36`, `migrated:true`. [Statut SQL](verification-proofs/jm190-hosted-schema38-status.json), [traces et reconstruction du reçu](verification-proofs/jm190-hosted-upgrade-confirmation.json). La lecture précédente `migrated:false` n’avait rien appliqué ; elle ne contredisait pas la migration. Aucun inventaire physique nouveau n’est déduit.

**Prochaine action : CHECK185 puis CHECK190, sans démarrer Node.** Les sources et scripts sont déjà préparés. La commande vérifie les deux traces, les deux reçus de préparation et les scripts avant toute exécution. Si un journal contient déjà exclusivement les reçus attendus, elle le réutilise ; sinon elle exécute une seule fois le CHECK correspondant et valide son journal. Aucun mot de passe SQL demandé, aucune migration, aucun démarrage ou effacement de données. Node239143 reste arrêté ; ne pas utiliser le Run/Build184 encore affiché dans Manager sur SQL38.

Dans le [terminal SSH Infomaniak](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/ssh-terminal/Node.js/terminal), utiliser :

```bash
env -i PATH=/usr/bin:/bin PYTHONDONTWRITEBYTECODE=1 python3 - <<'PY_CHECKS190'
import hashlib, json, subprocess, urllib.request

url = 'https://raw.githubusercontent.com/fredbuhr/jessiemessage/fbbe445bc37c90509d2af30c1ba7dc630927a40e/ops/migrate-release190.py'
code = urllib.request.urlopen(url, timeout=30).read()
if hashlib.sha256(code).hexdigest() != '3c52c95817cdbdfb0849f3d5bf8c191269937237830d398ccdc8440c6e40c0b2':
    raise SystemExit('OUTIL190_A_VERIFIER : arrêt.')
ns = {'__name__': 'jm190_inspection'}
exec(compile(code, '<verification-checks190>', 'exec'), ns)
ns['identity']()
private, read, digest, require = ns['PRIVATE'], ns['file'], ns['digest'], ns['require']
for name, expected in (
    ('jm190-upgrade-attempt.json', 'db873cb4f9d751ab167bd960bd35a5962b89df23a5f99616d0693d6fa4b4b48e'),
    ('jm190-schema38.json', '0d12dfd9ea9c9510729d39f743159a70a2457b2d999b6d334ae09043fa5d6dfb'),
):
    require(digest(read(private / name)) == expected, 'TRACE190_A_VERIFIER')

expected = dict(version=2, type='local_closure_precheck', status='passed',
    scope='local_application', pendingClosures=False, started=False,
    erased=False, externalContinuityVerified=False)
canonical = lambda value: json.dumps(value, sort_keys=True, separators=(',', ':'))
def unique(pairs):
    value = dict(pairs)
    require(len(value) == len(pairs), 'JOURNAL_CLES_DUPLIQUEES')
    return value
def valid_log(data):
    lines = data.splitlines()
    require(1 <= len(lines) <= 16 and all(
        canonical(json.loads(line, object_pairs_hook=unique)) == canonical(expected)
        for line in lines), 'JOURNAL_A_VERIFIER_NE_PAS_RELANCER')

plans = []
for number, version, source, tree, receipt_sha in (
    ('185', '1.8.5', '7a40de9742bdbedc5c0829d820882ca08bf23a91', '7ec449cb3a63a091c5233993923ceb69f8314366', '8b3cb7d8b40d26ce16fa3b453a2f1fda265021a5b9f4584ec5533905f87ca11e'),
    ('190', '1.9.0', '5dda0dd4453d34a0be839d2a1402301dea835381', 'f06a140e738f20994425c714a278b0646f651c1b', '3a4788b4a31cac3d55f09950e3b98f99a700e0f0dd8af21f83a6135bd01d8cd0'),
):
    data = read(private / ('jm' + number + '-staging.json'))
    require(digest(data) == receipt_sha, 'PREPARATION_A_VERIFIER')
    staged = json.loads(data)
    check = private / ('check-primary-release' + number + '-' + source[:8] + '.sh')
    prelog = private / ('jm' + number + '-preflight-node24221-' + source[:8] + '.log')
    require(staged.get('release') == version and staged.get('source') == source
        and staged.get('tree') == tree and staged.get('checkLauncher') == str(check)
        and staged.get('precheckLog') == str(prelog), 'PLAN_A_VERIFIER')
    check_sha = staged['checkLauncherSha256']
    require(digest(read(check, 0o700)) == check_sha, 'CHECK_A_VERIFIER')
    log = read(prelog, limit=65536)
    if log:
        valid_log(log)
    plans.append((version, check, check_sha, prelog, log))

for version, check, check_sha, prelog, prior in plans:
    require(digest(read(check, 0o700)) == check_sha and read(prelog, limit=65536) == prior,
        'CHECK_OU_JOURNAL_MODIFIE')
    if not prior:
        result = subprocess.run(['/bin/bash', str(check)], env=ns['environment'](),
            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            timeout=180)
        require(result.returncode == 0, 'CHECK_ECHOUE_INSPECTER_JOURNAL_NE_PAS_RELANCER')
    data = read(prelog, limit=65536)
    valid_log(data)
    print(json.dumps(dict(release=version, status='already_passed' if prior else 'passed',
        precheckLogSha256=digest(data), runtimeStarted=False), separators=(',', ':')), flush=True)
PY_CHECKS190
```

Rapporter les deux résultats JSON : versions1.8.5 et1.9.0, `status:passed` ou `already_passed`, `runtimeStarted:false` et empreinte du journal. En cas d’erreur, conserver la sortie et ne pas relancer automatiquement. Aucun CHECK n’est encore acquis avant ces résultats réels.

Après les deux CHECK réussis, configurer les commandes Build et Run190 dans Manager, démarrer et relever l’identité exacte. Le writer final est déjà épinglé au reçu réel et qualifié **9/9** sous Nodev24.22.1, [run39972263974](https://github.com/fredbuhr/jessiemessage/actions/runs/39972263974), opérateur `8690a8255e1297f288f7eae8ab25811bf63d2262`, SHA256 `40cc11b177de7199d07b7552d440fcf7990a0f8e5e334c885ef8fca93c7d93b8`. [Preuve native](verification-proofs/jm190/writer-final-native.json). Ne l’exécuter qu’après CHECK185/190 et identité190 concordants ; il n’a pas encore écrit les métadonnées sur l’hôte.

La base évolue explicitement de36 à38 migrations : une table de préférences chiffrées, puis des champs dans les tâches existantes. Les33 migrations de base et3 vidéo sont identiques. Le repli technique185 accepte38 et conserve les données nouvelles sans afficher les rubriques190. Après migration, ne pas démarrer184 ou172 sur38.

Les qualificationsPR/main5/5 et la [publication2/2](verification-proofs/jm190/publication-native.json) sont acquises. Source190 `5dda0dd4453d34a0be839d2a1402301dea835381`, arbre `f06a140e738f20994425c714a278b0646f651c1b`, release421892314 ;185 non latest421892280. Les49 tests opérateurs natifs sont réussis. Préparateur qualifié à l’opérateur `5859b591e0349bae011147e6aed6ebf330a7a4ba`, SHA256 `d976c224b7ff898720f44b1f018440a29791c40936c504c7782a2874758e35d6`. Les reçus de préparation, le statutSQL38/0 et le reçu durable d’upgrade sont acquis selon les preuves utilisateur ; les CHECK restent à obtenir.

Commande historique de préparation, **déjà exécutée avec succès — ne pas relancer** :

```bash
env -i PATH=/usr/bin:/bin PYTHONDONTWRITEBYTECODE=1 python3 - <<'PY_JM190'
import hashlib, sys, urllib.request

url = 'https://raw.githubusercontent.com/fredbuhr/jessiemessage/5859b591e0349bae011147e6aed6ebf330a7a4ba/ops/prepare-release190.py'
code = urllib.request.urlopen(url, timeout=30).read()
if hashlib.sha256(code).hexdigest() != 'd976c224b7ff898720f44b1f018440a29791c40936c504c7782a2874758e35d6':
    raise SystemExit('Empreinte incorrecte : arrêt.')
sys.argv = ['prepare-release190.py', '5dda0dd4453d34a0be839d2a1402301dea835381', 'f06a140e738f20994425c714a278b0646f651c1b']
exec(compile(code, '<preparation190>', 'exec'), {'__name__': '__main__'})
print('PREPARATION_190_SOURCES_OK')
PY_JM190
```

Le résultat doit donner les deux sources préparées, le reçu190 et son empreinte, `rollback185Prepared:true`, `started:false` et `migrated:false`. Le marqueur confirmait seulement la préparation ; SQL36 était actif à cette étape historique. Conserver la sortie avant la prochaine étape ; ne pas exécuter le champ `nextCheckCommand` avant migrationSQL38.

1. **Préparation190 et185 acquise — ne pas relancer.** Les deux sources, lanceurs et reçus ont été préparés ; leurs empreintes sont conservées dans le point de reprise.
2. **StatutSQL38/0 acquis selon l’utilisateur.** La lecture précédente36/2 est historique. Le reçu durable d’upgrade est confirmé séparément par son empreinte exacte.
3. **Migration terminée, traces acquises.** Ne relancer ni upgrade ni préparation. Le reçu indique 2 migrations appliquées et 36 préservées ; garder Node arrêté avant les CHECK.184/172 sont incompatibles SQL38.
4. **Précontrôler les deux versions.** Après preuveSQL38, exécuter séparément les CHECK185 et190 indiqués dans leurs reçus. Chaque journal doit confirmer le contrôle local sans démarrage ni effacement. Le repli185 n’est précontrôlé sur l’hôte qu’après son propre résultat.
5. **Activer190.** Dans [Run/Build du service239143](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/h3/118579/nodejs/239143/data/advanced-settings/application), utiliser le lanceur190 exact du reçu, selon la consigne fournie après les CHECK. Démarrer puis relever l’identité dans [État du service](https://jessiemessage.com/admin/readiness) : version1.9.0, commit exact qualifié et Nodev24.22.1. Aucun démarrage185 n’est nécessaire.
6. **Enregistrer l’identité réelle.** Utiliser le writer final déjà épinglé et qualifié9/9 avec les reçus réels et la release421892314. Après concordance du journal, de l’identité et des HTTP courants, il met à jour les seules métadonnées du checkpoint. Les anciens blocs et historiques sont préservés. Le reçu distingue185 précontrôlée jamais démarrée et190 active.

Chaque étape dépend de la preuve de la précédente ; aucune n’est acquise par sa simple description. Aucun essai de sauvegarde hébergée reporté, nouveau service, compte réel de test, message réel ou suppression de données n’est demandé par ce parcours.
