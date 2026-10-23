# Livraison1.10.1 — reprise bornée qualifiée, reçu hébergé attendu

La version est qualifiée sur PR et sur main, cinq jobs chacun sousNode24.22.1. Source exacte `9eb99f1f68ab4beb5484894249afa8f413cc5dd6`, arbre `2a09d9d5d6698a04605e9a4b4faa551536cfca13`. [Release/latest422216628](https://github.com/fredbuhr/jessiemessage/releases/tag/v1.10.1), [publication40008910211](https://github.com/fredbuhr/jessiemessage/actions/runs/40008910211)2/2 et46 tests opérateur réussis. [Preuve](verification-proofs/final-public-1100/ci/publication-40008910211/publication-native.json). **La dernière identité active attestée et le dernier checkpoint confirmé restent1.10.0.**

## Reprise bornée — prochaine action

Le [diagnostic hébergé reçu](verification-proofs/final-public-1100/hosted-inspection1101.json) confirme les cinq sorties candidates présentes, les deux journaux vides, le reçu absent et tous les pins1100 contrôlés conformes. Checkout candidat et dépendances actives sont2700. Le défaut d’héritage setgid du préparateur est [reproduit](verification-proofs/final-public-1100/preparer1101-setgid-reproduction.json) : mkdir0700 hérite2700, puis le contrôle final exact0700 le refuse. La reprise doit encore mesurer explicitement le mode de la nouvelle racine de dépendances.

La reprise bornée est qualifiée par [le run40015619392](https://github.com/fredbuhr/jessiemessage/actions/runs/40015619392),1/1 et6/6 tests sousNode24.22.1, [preuve et log natifs](verification-proofs/final-public-1100/recovery1101-native.json). Opérateur `e279b4677f9d300eb7ad92c3e51deb423762739c`, arbre `8b5f42533b7923ee3b74498e66d0818799119353`, SHA256script `c5d4ad602a17eb3799d9b228c68e4f2f56105c794c01b0625273e47cd9b6c41f`. La validation de la copie réelle937 fichiers passe aussi [en lecture seule](verification-proofs/final-public-1100/recovery1101-real-dependencies.json).

Il mesure explicitement le cas2700, vérifie l’intégralité de l’existant, retire seulement le bit setgid de la nouvelle racine, puis crée le reçu absent. Aucun fichier actif, source candidate, lanceur, journal, configuration ou checkpoint à remplacer. Aucun stage, copie, suppression, CHECK, SQL, Manager ou démarrage. Son état final reste nonqualifié/non démarré ; le CHECK est séparé.

Dans le [terminalSSH Infomaniak](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/ssh-terminal/Node.js/terminal), exécuter une seule fois puis transmettre le JSON complet :

```bash
env -i PATH=/usr/bin:/bin PYTHONDONTWRITEBYTECODE=1 python3 - <<'PY_RECOVER1101'
import hashlib,re,urllib.request
operator='e279b4677f9d300eb7ad92c3e51deb423762739c'; expected='c5d4ad602a17eb3799d9b228c68e4f2f56105c794c01b0625273e47cd9b6c41f'
if not re.fullmatch('[a-f0-9]{40}',operator): raise SystemExit('PIN_REPRISE_MANQUANT')
code=urllib.request.urlopen('https://raw.githubusercontent.com/fredbuhr/jessiemessage/'+operator+'/ops/recover-staging1101.py',timeout=20).read(262145)
if len(code)>262144 or hashlib.sha256(code).hexdigest()!=expected: raise SystemExit('OUTIL_REPRISE_A_VERIFIER')
exec(compile(code,'<reprise1101>','exec'),{'__name__':'__main__'})
PY_RECOVER1101
```

Attendre la lecture du vrai reçu avant le CHECK, puis le Manager. En cas de refus, conserver le résultat avec sa phase et ne pas répéter la commande. Cette reprise refuse une racine déjà700 ou un reçu déjà présent afin de ne pas masquer une autre interruption.

## Historique — diagnostic en lecture seule déjà exécuté

L’utilisateur a rapporté `PREPARATION1101_NON_CONFIRMEE : conserver les traces, ne pas relancer.`, sans JSON de préparation ni marqueur `PREPARATION_1101_CHECK_OK`. [Preuve du signalement](verification-proofs/final-public-1100/hosted-preparation1101-not-confirmed.json). La phase atteinte est inconnue : le bootstrap a remplacé l’exception de `stage` par ce message générique. L’écho terminal altéré ne démontre pas la cause et l’absence de JSON ne démontre pas l’absence d’écritures. Les GET publics `/api/health` et `/api/ready` ont répondu200 après l’échec, sans attester une nouvelle identité applicative.

**Diagnostic historique exécuté :** L’inspecteur `ops/inspect-staging1101.py` est publié sur l’opérateur immuable `3b78d417b29dd28a231401edfe48913e19146026`, arbre `244c193f56a8b38581598eced0c66187fd5e2a54`, SHA256 `c12465912c57a242a088b5340fab26a617f6079a5d27232561aa90dd96446a6f`. Sa [qualification native40013315612](verification-proofs/final-public-1100/inspector1101-native.json), tentative1, est réussie1/1 avec6/6 tests. Il ne prépare ni checkout, ni dépendances, ne lance ni CHECK, runtime ou SQL et n’écrit aucun fichier privé. Son exécution hébergée n’est pas encore attestée.

Le bloc suivant a été exécuté dans le [terminal SSH Infomaniak](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/ssh-terminal/Node.js/terminal), son résultat est conservé dans la preuve ci-dessus. Ne pas le rejouer :

```bash
env -i PATH=/usr/bin:/bin PYTHONDONTWRITEBYTECODE=1 python3 - <<'PY_INSPECT1101'
import hashlib,re,urllib.request
operator='3b78d417b29dd28a231401edfe48913e19146026'; expected='c12465912c57a242a088b5340fab26a617f6079a5d27232561aa90dd96446a6f'
if not re.fullmatch('[a-f0-9]{40}',operator): raise SystemExit('PIN_INSPECTION_MANQUANT')
code=urllib.request.urlopen('https://raw.githubusercontent.com/fredbuhr/jessiemessage/'+operator+'/ops/inspect-staging1101.py',timeout=20).read(262145)
if len(code)>262144 or hashlib.sha256(code).hexdigest()!=expected: raise SystemExit('OUTIL_INSPECTION_A_VERIFIER')
exec(compile(code,'<inspection1101>','exec'),{'__name__':'__main__'})
PY_INSPECT1101
```

Le résultat a été reçu et analysé : attendre la qualification de la reprise bornée. Ne relancer ni préparation, ni CHECK, ne modifier aucun champ Manager et ne démarrer aucun writer. Les traces existantes restent à conserver ; aucune cause n’est encore établie.

## Historique — préparation et CHECK tentés, à ne pas rejouer

Le bloc ci-dessous est conservé uniquement pour expliquer la tentative et son message d’échec. **Ce n’est plus une consigne à exécuter.** Il vérifiait deux outils immuables par SHA256, préparait un nouveau checkout et ses dépendances privées distinctes, puis devait lancer le CHECK ; leur réalisation n’est pas attestée par le signalement reçu.

```bash
env -i PATH=/usr/bin:/bin PYTHONDONTWRITEBYTECODE=1 python3 - <<'PY_PREPARE1101'
import hashlib, json, os, re, subprocess, tempfile, urllib.request
from pathlib import Path

operator = 'e5dbfc124a8169a551285d4feb15b827edf07e58'
source = '9eb99f1f68ab4beb5484894249afa8f413cc5dd6'
tree = '2a09d9d5d6698a04605e9a4b4faa551536cfca13'
prepare_sha256 = '6682282bb938aa91578410d4dd317c631172b6ee71c6cadf31063995e1169608'
helper_sha256 = '293f06004d79d9b32a891473c7514b74eda58e5798f083561540a0108c58806b'
if not all(re.fullmatch('[a-f0-9]{40}', pin) for pin in (operator, source, tree)) or not all(re.fullmatch('[a-f0-9]{64}', pin) for pin in (prepare_sha256, helper_sha256)):
    raise SystemExit('PINS1101_MANQUANTS : arrêt avant téléchargement et accès privé.')

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        raise RuntimeError('URL_REDIRECT')

opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
tools = {}
for filename, expected in [('prepare-release1101.py', prepare_sha256), ('release1101-dependencies.py', helper_sha256)]:
    url = 'https://raw.githubusercontent.com/fredbuhr/jessiemessage/' + operator + '/ops/' + filename
    try:
        with opener.open(url, timeout=30) as response:
            if response.status != 200 or response.url != url:
                raise RuntimeError('URL_RESPONSE')
            code = response.read(262145)
        if len(code) > 262144 or hashlib.sha256(code).hexdigest() != expected:
            raise RuntimeError('CODE_HASH')
    except Exception:
        raise SystemExit('OUTIL1101_A_VERIFIER : arrêt, aucun outil exécuté.') from None
    tools[filename] = code

with tempfile.TemporaryDirectory(prefix='jm1101-preparation-') as directory:
    root = Path(directory)
    for filename, code in tools.items():
        path = root / filename
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, 'wb') as output:
            output.write(code)
    path = root / 'prepare-release1101.py'
    ns = {'__name__': 'jm1101_preparation', '__file__': str(path)}
    exec(compile(tools[path.name], str(path), 'exec'), ns)
    try:
        result = ns['stage'](source, tree)
    except Exception:
        raise SystemExit('PREPARATION1101_NON_CONFIRMEE : conserver les traces, ne pas relancer.') from None
    print(json.dumps(result, separators=(',', ':')), flush=True)
    try:
        check = subprocess.run(['/bin/bash', result['checkLauncher']], env=ns['clean_environment'](),
            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=180)
    except (OSError, subprocess.TimeoutExpired):
        raise SystemExit('CHECK1101_NON_CONFIRME : conserver les traces, ne pas relancer.') from None
    if check.returncode != 0:
        raise SystemExit('CHECK1101_REFUSE : conserver les traces, ne pas relancer.')
    print('PREPARATION_1101_CHECK_OK')
PY_PREPARE1101
```

Le résultat attendu était un JSON de préparation puis le marqueur séparé `PREPARATION_1101_CHECK_OK` ; aucun n’a été rapporté. Les champs `precheckPassed:false` et les journaux vides d’un éventuel reçu décrivent son état avant CHECK ; seul le marqueur séparé en confirmerait la réussite. Préserver les traces et inspecter l’état durable avant toute reprise ; ne pas répéter cette commande pour découvrir son résultat.

## Activation — suspendue jusqu’au diagnostic et aux preuves de préparation

**Ne pas appliquer les champs ou l’action Manager ci-dessous dans l’état courant.** Ces indications restent conservées pour une étape ultérieure, qui dépendra du diagnostic et de preuves valides de préparation et de CHECK.

Ouvrir le [Run/Build Manager](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/h3/118579/nodejs/239143/data/advanced-settings/application), service Node239143 nommé **recette.jessiemessage.com**, qui dessert aussi le domaine principal. Le site PHP accueil n’est pas ce service.

Avant ce redémarrage, réserver un moment sans édition de préférences : fermer les éditeurs et attendre la confirmation de fin des enregistrements déjà lancés. La1.10.0 reste affectée par F-05 pendant son propre arrêt ; la correction protège les arrêts de la1.10.1 une fois celle-ci active. La préparation et son CHECK ne redémarrent pas le service.

| Champ | Valeur |
| --- | --- |
| Commande d’exécution, en haut | `bash /srv/customer/jessiemessage-private/start-primary-release1101-9eb99f1f.sh` |
| Commande de build, en bas | `bash /srv/customer/jessiemessage-private/check-primary-release1101-9eb99f1f.sh` |
| Port |3000, conservé |

Enregistrer et déclencher une seule activation selon le parcours Manager, puis relever dans **État du service** : version1.10.1, commit complet9eb99f1f68ab4beb5484894249afa8f413cc5dd6, Nodev24.22.1 et date de démarrage. Ne pas inverser les champs Exécution et Build.

## Enregistrement final — pins non encore acquis

Le writer fourni dans le commit opérateur reste inerte. Le vrai reçu de préparation et la release422216628 devront être épinglés, puis ses16 tests natifs qualifiés sur son propre commit avant transmission de sa commande. Il vérifiera identité démarrée, HTTP publics, dépendances et publication, puis alignera les seules métadonnées privées sans redémarrer. Aucune commande writer exécutable n’est donnée à cette étape.

Le checkpoint1100, ses historiques, autres blocs et le repli185 compatibleSQL38 sont préservés. Les versions184/172 restent interdites surSQL38. Aucun retour de migration n’est ajouté.

## Mise à disposition au public

L’audit refuse l’ouverture sur la1.10.0 affectée par F-05. La1.10.1 doit être réellement activée puis enregistrée avant de lever ce blocage. [Checklist et limites](AUDIT-PUBLIC-1100-20261023.md).

Le profil partageable [jessiemessage.com/jessie](https://jessiemessage.com/jessie) est actuellement masqué. L’admin choisit explicitement son contenu dans **Mon profil → Mon profil public**, puis clique sur Publier. Les préférences privées ne sont pas publiées automatiquement. Une vérification sur son téléphone peut compléter les preuves des parcours modifiés : retour du brouillon après changement de fenêtre, fermeture/réouverture de galerie et page publique choisie. Elle ne remplace pas les limites Safari/Firefox/Push ou sauvegarde hébergée reportée.
