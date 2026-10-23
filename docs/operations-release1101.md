# Livraison1.10.1 — activation acquise, enregistrement final attendu

La version est qualifiée sur PR et sur main, cinq jobs chacun sousNode24.22.1. Source exacte `9eb99f1f68ab4beb5484894249afa8f413cc5dd6`, arbre `2a09d9d5d6698a04605e9a4b4faa551536cfca13`. [Release/latest422216628](https://github.com/fredbuhr/jessiemessage/releases/tag/v1.10.1), [publication40008910211](https://github.com/fredbuhr/jessiemessage/actions/runs/40008910211)2/2 et46 tests opérateur réussis. [Preuve](verification-proofs/final-public-1100/ci/publication-40008910211/publication-native.json). **L’[identité active1.10.1](verification-proofs/final-public-1100/hosted-identity1101.json) est rapportée par l’utilisateur**, source exacte9eb99f1f68ab4beb5484894249afa8f413cc5dd6, Nodev24.22.1, texte Paris `23/10/2026 22:30:40` ; epoch en millisecondes non relevée. **Le checkpoint reste le dernier état confirmé1.10.0/SQL38**, en attente de l’enregistrement final1101.

## Enregistrement final — prochaine action

Le writer final est épinglé sur le vrai reçu de préparation `aa2d9240ded66106ee919ad1baa8949559be816edc93bc6998954359bccc2b1a` et la release422216628. Opérateur `ac101b4bfbfa3a7f765752cb2adc74287846145e`, arbre `7a09dc8d72c6393c3f69adf0154cdb1df7e1658a`, SHA256writer `638a3b7019654e840f403acc14f8384ec15ce255aea423cbc33b621240efda75`, helper inchangé293f0600…. [Qualification native40018506473](verification-proofs/final-public-1100/writer1101-final-native.json)1/1 et16/16 sousNode24.22.1 acquise, tentative1. Le diff du draft contient seulement les deux pins. Le CHECK et l’identité démarrée1.10.1 sont acquis séparément. Son exécution n’est pas encore rapportée ; la commande exacte ci-dessous est prête. Il contrôlera identité, HTTP publics, dépendances et publication avant d’aligner les seules métadonnées privées, sans redémarrage. Attendre le reçu final avant de conclure sur le checkpoint et l’ouverture au public. Ne rejouer ni Manager, CHECK ou récupération.

Dans le [terminalSSH Infomaniak](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/ssh-terminal/Node.js/terminal), exécuter une fois ce bloc. Il vérifie les deux outils immuables avant toute exécution, place uniquement leurs sources publiques dans un dossier temporaire privé puis exécute le writer avec son chemin correct. Aucun nouveau démarrage, SQL, envoi, sauvegarde ou manipulation PC.

```bash
env -i PATH=/usr/bin:/bin PYTHONDONTWRITEBYTECODE=1 python3 - <<'PY_RECORD1101'
import hashlib,os,tempfile,urllib.request
from pathlib import Path
operator='ac101b4bfbfa3a7f765752cb2adc74287846145e'
pins={'record-release1101.py':'638a3b7019654e840f403acc14f8384ec15ce255aea423cbc33b621240efda75','release1101-dependencies.py':'293f06004d79d9b32a891473c7514b74eda58e5798f083561540a0108c58806b'}
tools={}
for filename,expected in pins.items():
    url='https://raw.githubusercontent.com/fredbuhr/jessiemessage/'+operator+'/ops/'+filename
    with urllib.request.urlopen(url,timeout=30) as response:
        if response.status!=200 or response.url!=url: raise SystemExit('URL_OUTIL_A_VERIFIER')
        code=response.read(262145)
    if len(code)>262144 or hashlib.sha256(code).hexdigest()!=expected:
        raise SystemExit('EMPREINTE_OUTIL_INCORRECTE : arrêt, aucun outil exécuté.')
    tools[filename]=code
with tempfile.TemporaryDirectory(prefix='jm1101-enregistrement-') as directory:
    root=Path(directory)
    for filename,code in tools.items():
        path=root/filename
        fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
        with os.fdopen(fd,'wb') as output:
            output.write(code)
    path=root/'record-release1101.py'
    exec(compile(tools[path.name],str(path),'exec'),{'__name__':'__main__','__file__':str(path)})
PY_RECORD1101
```

Transmettre le JSON complet. Le statut attendu est `release1101_metadata_recorded` ou `release1101_metadata_already_recorded`, avec `publicReady:true` et un nouveau checkpoint concordant. Si le statut est non confirmé ou si la connexion est interrompue, conserver les traces et lire l’état avant toute reprise ; ne pas répéter la commande pour découvrir son résultat.

Les [GET anonymes postactivation](verification-proofs/final-public-1100/post-activation1101-http.json) répondent200 pour accueil/health/ready, sans Set-Cookie ; health=ok et ready=ready. Ils attestent la disponibilité observée, pas l’alignement des métadonnées. Le writer vérifie séparément HTTP depuis l’hôte, publication exacte et empreinte de l’accueil actif avant son écriture.


Le checkpoint1100, ses historiques, autres blocs et le repli185 compatibleSQL38 sont préservés. Les versions184/172 restent interdites surSQL38. Aucun retour de migration n’est ajouté.

## Historique — activation Manager effectuée, à ne pas rejouer

Le [CHECK1101 est acquis selon le résultat utilisateur](verification-proofs/final-public-1100/hosted-check1101.json) : `CHECK1101_EXIT=0`, puis `CHECK_1101_OK`. Préparation, inspection, récupération et CHECK ne sont pas à rejouer. **L’activation est acquise selon l’[identité utilisateur](verification-proofs/final-public-1100/hosted-identity1101.json)**, version1.10.1/source9eb99f1f68ab4beb5484894249afa8f413cc5dd6/Nodev24.22.1, texte Paris `23/10/2026 22:30:40`. Le writer reste à exécuter ; ne pas redémarrer de nouveau.

Les valeurs ci-dessous étaient consignées pour cette activation dans le [Run/Build Manager](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/h3/118579/nodejs/239143/data/advanced-settings/application), service Node239143 nommé **recette.jessiemessage.com**, qui dessert aussi le domaine principal. Le site PHP accueil n’est pas ce service.

Avant ce redémarrage, la consigne était de réserver un moment sans édition de préférences : fermer les éditeurs et attendre la confirmation de fin des enregistrements déjà lancés. La1.10.0 reste affectée par F-05 pendant son propre arrêt ; la correction protège les arrêts de la1.10.1 une fois celle-ci active. La préparation et son CHECK ne redémarrent pas le service.

| Champ | Valeur |
| --- | --- |
| Commande d’exécution, en haut | `bash /srv/customer/jessiemessage-private/start-primary-release1101-9eb99f1f.sh` |
| Commande de build, en bas | `bash /srv/customer/jessiemessage-private/check-primary-release1101-9eb99f1f.sh` |
| Port |3000, conservé |

Le CHECK exécuté par le champ Build pendant cette activation est attendu ; ne pas relancer son bootstrap SSH.

Enregistrer et déclencher une seule activation selon le parcours Manager, puis relever dans [État du service](https://jessiemessage.com/admin/readiness) : version1.10.1, commit complet9eb99f1f68ab4beb5484894249afa8f413cc5dd6, Nodev24.22.1 et date de démarrage. Ne pas inverser les champs Exécution et Build.

## Historique — CHECK1101 réussi, à ne pas rejouer

La [récupération et la préparation sont rapportées par le reçu utilisateur](verification-proofs/final-public-1100/hosted-preparation1101.json), SHA256 `aa2d9240ded66106ee919ad1baa8949559be816edc93bc6998954359bccc2b1a`. Le candidat exact est préparé ; le statut du reçu reste non qualifié et non démarré. Le [CHECK séparé](verification-proofs/final-public-1100/hosted-check1101.json) est désormais acquis selon l’utilisateur : `CHECK1101_EXIT=0`, puis `CHECK_1101_OK`. Activation acquise séparément selon l’identité utilisateur ; enregistrement final non acquis. La préparation initiale, l’inspection et la récupération ci-dessous sont historiques et ne doivent pas être rejouées.

Le bloc suivant a été exécuté avec succès et reste conservé comme historique. Ne pas le rejouer :

```bash
env -i PATH=/usr/bin:/bin PYTHONDONTWRITEBYTECODE=1 python3 - <<'PY_CHECK1101'
import subprocess
try:
    result = subprocess.run(['/bin/bash', '/srv/customer/jessiemessage-private/check-primary-release1101-9eb99f1f.sh'],
        stdin=subprocess.DEVNULL, capture_output=True, timeout=180, check=False)
except (OSError, subprocess.TimeoutExpired):
    raise SystemExit('CHECK1101_NON_CONFIRME : conserver les traces, ne pas relancer.') from None
print('CHECK1101_EXIT=' + str(result.returncode), flush=True)
if result.returncode != 0:
    raise SystemExit('CHECK1101_REFUSE : conserver les traces, ne pas relancer.')
print('CHECK_1101_OK')
PY_CHECK1101
```

Ce bootstrap capture les sorties du CHECK sans afficher les journaux bruts et borne son attente à180secondes. Le CHECK ne démarre pas le service. Le succès `CHECK1101_EXIT=0` puis `CHECK_1101_OK` a été rapporté séparément du reçu de préparation. L’activation Manager a depuis été rapportée ; le CHECK ne doit pas être répété. L’enregistrement final reste la prochaine action.

## Historique — récupération bornée exécutée, à ne pas rejouer

Le [diagnostic hébergé reçu](verification-proofs/final-public-1100/hosted-inspection1101.json) avait confirmé les cinq sorties candidates présentes, les deux journaux vides, le reçu absent et les pins1100 contrôlés conformes. Checkout candidat et dépendances actives étaient2700. Le défaut d’héritage setgid du préparateur est [reproduit](verification-proofs/final-public-1100/preparer1101-setgid-reproduction.json) : mkdir0700 hérite2700, puis le contrôle final exact0700 le refuse. La récupération exécutée a vérifié ce cas sur la nouvelle racine, rétabli0700 et créé le reçu manquant.

La reprise bornée est qualifiée par [le run40015619392](https://github.com/fredbuhr/jessiemessage/actions/runs/40015619392),1/1 et6/6 tests sousNode24.22.1, [preuve et log natifs](verification-proofs/final-public-1100/recovery1101-native.json). Opérateur `e279b4677f9d300eb7ad92c3e51deb423762739c`, arbre `8b5f42533b7923ee3b74498e66d0818799119353`, SHA256script `c5d4ad602a17eb3799d9b228c68e4f2f56105c794c01b0625273e47cd9b6c41f`. La validation de la copie réelle937 fichiers passe aussi [en lecture seule](verification-proofs/final-public-1100/recovery1101-real-dependencies.json).

Il a mesuré explicitement le cas2700, vérifié l’intégralité de l’existant, retiré seulement le bit setgid de la nouvelle racine, puis créé le reçu absent. Aucun fichier actif, source candidate, lanceur, journal, configuration ou checkpoint à remplacer. Aucun stage, copie, suppression, CHECK, SQL, Manager ou démarrage. Son état final reste nonqualifié/non démarré ; le CHECK est séparé.

Le bloc suivant a déjà été exécuté ; il est conservé uniquement comme historique. Ne pas le rejouer :

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

Le vrai reçu et le résultat positif du CHECK ont été rapportés séparément. Cette reprise refuse une racine déjà700 ou un reçu déjà présent afin de ne pas masquer une autre interruption ; ne pas la répéter.

## Historique — diagnostic en lecture seule déjà exécuté

L’utilisateur a rapporté `PREPARATION1101_NON_CONFIRMEE : conserver les traces, ne pas relancer.`, sans JSON de préparation ni marqueur `PREPARATION_1101_CHECK_OK`. [Preuve du signalement](verification-proofs/final-public-1100/hosted-preparation1101-not-confirmed.json). La phase atteinte est inconnue : le bootstrap a remplacé l’exception de `stage` par ce message générique. L’écho terminal altéré ne démontre pas la cause et l’absence de JSON ne démontre pas l’absence d’écritures. Les GET publics `/api/health` et `/api/ready` ont répondu200 après l’échec, sans attester une nouvelle identité applicative.

**Diagnostic historique exécuté :** L’inspecteur `ops/inspect-staging1101.py` est publié sur l’opérateur immuable `3b78d417b29dd28a231401edfe48913e19146026`, arbre `244c193f56a8b38581598eced0c66187fd5e2a54`, SHA256 `c12465912c57a242a088b5340fab26a617f6079a5d27232561aa90dd96446a6f`. Sa [qualification native40013315612](verification-proofs/final-public-1100/inspector1101-native.json), tentative1, est réussie1/1 avec6/6 tests. Il ne prépare ni checkout, ni dépendances, ne lance ni CHECK, runtime ou SQL et n’écrit aucun fichier privé. Son exécution hébergée est attestée par le [résultat utilisateur reçu](verification-proofs/final-public-1100/hosted-inspection1101.json).

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

Ce résultat a été reçu et analysé, puis la récupération bornée a été qualifiée et exécutée. Diagnostic, préparation initiale et récupération ne sont pas à rejouer. Le CHECK séparé a depuis réussi ; l’activation et l’identité réelle1.10.1 ont depuis été rapportées. Le writer attend sa commande exacte et son reçu final.

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

Lors de cette tentative initiale, le résultat attendu était un JSON de préparation puis le marqueur séparé `PREPARATION_1101_CHECK_OK` ; aucun des deux n’avait été rapporté. Le reçu de préparation a depuis été établi par la récupération bornée ; son CHECK séparé a depuis réussi selon le résultat utilisateur. Les champs `precheckPassed:false` et les journaux vides d’un éventuel reçu décrivent son état avant CHECK ; seul le marqueur séparé en confirmerait la réussite. Préserver les traces et inspecter l’état durable avant toute reprise ; ne pas répéter cette commande pour découvrir son résultat.

## Mise à disposition au public

La1.10.1 est démarrée selon l’identité utilisateur ; l’enregistrement final concordant reste attendu avant décision d’ouverture. Aucun GO final ni alignement du checkpoint n’est déduit de cette seule identité. [Checklist et limites](AUDIT-PUBLIC-1100-20261023.md).

Le profil partageable [jessiemessage.com/jessie](https://jessiemessage.com/jessie) est masqué par défaut. L’admin choisit explicitement son contenu dans **Mon profil → Mon profil public**, puis clique sur Publier. Les préférences privées ne sont pas publiées automatiquement. Une vérification sur son téléphone peut compléter les preuves des parcours modifiés : retour du brouillon après changement de fenêtre, fermeture/réouverture de galerie et page publique choisie. Elle ne remplace pas les limites Safari/Firefox/Push ou sauvegarde hébergée reportée.
