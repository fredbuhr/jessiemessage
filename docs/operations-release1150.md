# Livraison 1.15.0 — terminée, aucune commande à rejouer

La **1.15.0 est démarrée et ses métadonnées sont alignées selon le [reçu final utilisateur](verification-proofs/jm1150/hosted-metadata.json)** : source6712028e08b1e04ac7628bdbb9c39fd9f90d9909, Nodev24.22.1,01/11/2026 20:27:30.173Paris,1793561250173ms. Statut `release1150_metadata_recorded`, `metadataOnly:true`, `noRestart:true`, `publicReady:true` ; checkpoint **`989de548cb42ac6784cbc4c341e43b240b63386a089fb2d107d4f6a067798814`** après écriture et relecture du writer. Active1141 entier, sections/historiques/staging antérieurs et autres blocs préservés selon le reçu. Aucune étape de livraison restante ; ne rejouer ni préparation, CHECK, activation ou writer.

La [PR147](https://github.com/fredbuhr/jessiemessage/pull/147) est fusionnée. Source/tag [v1.15.0](https://github.com/fredbuhr/jessiemessage/releases/tag/v1.15.0) : **`6712028e08b1e04ac7628bdbb9c39fd9f90d9909`**, arbre **`c80ee33ebfe01838c86cc2b4166b344acf5ea745`**, release/latest **430794626**. Le main documentaire peut avancer ensuite ; ne pas le confondre avec le code publié.

PR [41338555685](verification-proofs/jm1150/pr-native.json), puis main [41339290231](verification-proofs/jm1150/main-native.json) : **5/5 jobs chacun**, tentative1. Général4524tests/4472réussites/52omissions explicites ; Chrome324/324, HTTPS14/14, MariaDB617/617 sur10.11 et11.4. Les omissions ne sont pas des réussites. Le premier run en échec est [conservé](verification-proofs/jm1150/pr-initial-failure.json) ; seuls sept fichiers de fixtures ont été corrigés. [Rapport et limites](photo-acceptance-1150.md), [couverture](verification-proofs/jm1150/coverage.json), [cinq captures](verification-proofs/jm1150/visual-native.json).

Publication : [41340064560](verification-proofs/jm1150/publication-native.json), deux jobs et23/23tests natifs, opérateur `2b238dc6e94da5c4228070a50d8b2ef50e25999a`. Tag/release/latest relus exacts et ancienne1141/430681218 préservée. Aucune activation par ce workflow.

Préparateur : opérateur **`6b6342ba784572d89b076a56647ccb887587f10f`**, arbre `bd00255613868d8a74c82b887e931749a702fc3f`, helper **38463octets**, SHA256 **`2bb7a901a3e18321fd7ad428e8bc017594e94517af111efe6a6de73320c7e10f`**. [Qualification41339490486](verification-proofs/jm1150/preparation-native.json) :23/23tests natifs et installation neuve réellement isolée sous Node24.22.1/npm11.19.1, avec conversion réelle six familles. Inventaire1180entrées/988fichiers, SHA256 `4df6d0b94070f09f2180c9478446b38e07ba58f3bb3e25de083ae79cf14a6152` ; lock `1c0f01051219030260877c438566a5be69bedf28b433907ebe0f9a26cd36fdd1`. Les onze ressources et tous les anciens records sont épinglés ; scripts npm désactivés. Cette qualification a été menée en parallèle du main, sur son même SHA/arbre, puis le main5/5 et la publication ont été confirmés avant toute consigne hébergée.

## Préparation/CHECK acquis — ne pas rejouer

[Reçu utilisateur](verification-proofs/jm1150/hosted-preparation.json) : `CHECK1150_EXIT=0`, puis `PREPARATION_1150_CHECK_OK`. Empreinte canonique **`6384c78bf94ce688ec33060d672019d8ae534466d7de57c701046e75c6c46a4b`**,6008octets vérifiés. Source/arbre/Node, inventaire1180/988/4df6, lock1c0f, onze ressources codec et sorties smoke identiques au natif. Configuration/bcca, checkpoint1141/93d6, staging1141/df4b et ancien inventaire547 préservés selon ce reçu. Checkout0700, lanceurs0700 ; start SHA256 `da4c86b73649a0939d8ff37f1bd35175b5d2d2b31aa0f15bcd8e1f9fcb191b56`, CHECK SHA256 `c165522014d83d09d5fcb0032b41d91fa13e2f5e146f5aaffde61062620459ba`.

Les flags faux et journaux vides du JSON décrivent le staging avant le CHECK séparé. À cette phase, aucun démarrage1150 n’était déduit ; le relevé suivant l’atteste séparément. Métadonnées1150 et inventaire SQL physique indépendant restent non acquis. **Préparation et CHECK SSH1150 ne doivent pas être rejoués.**

## Activation personnelle — acquise, ne pas rejouer

L’[identité utilisateur](verification-proofs/jm1150/hosted-identity.json) confirme version1.15.0, source6712028e08b1e04ac7628bdbb9c39fd9f90d9909, Nodev24.22.1, **01/11/2026 20:27:30 Europe/Paris**, secondeUTC1793561250. Millisecondes et signal disponible étaient absents de cet extrait initial ; le reçu final complète le journal réel et les GET publics. Les champs Manager, PID/socket/binaire et inventaire SQL physique ne sont pas indépendamment inspectés par l’agent. Aucun nouveau redémarrage demandé.

| Champ de l’activation rapportée | Valeur1150 |
| --- | --- |
| Exécution, champ du haut | `bash /srv/customer/jessiemessage-private/start-primary-release1150-6712028e.sh` |
| Build, champ du bas | `bash /srv/customer/jessiemessage-private/check-primary-release1150-6712028e.sh` |
| Port | `3000`, conservé |

Le service Node239143 encore nommé recette.jessiemessage.com dessert aussi le principal. Ne modifier ni ces champs ni la configuration pour la finalisation des métadonnées ci-dessous.

## Enregistrement final — acquis, ne pas rejouer

Le nouveau writer est [qualifié39/39 tests natifs](verification-proofs/jm1150/writer-final-native.json), sans omission, Node24.22.1, tentative1,1/1job : [run41342830219](https://github.com/fredbuhr/jessiemessage/actions/runs/41342830219). Opérateur **`c12846680c30ce008d9cc2f170aa87f06b8d78aa`**, arbre `e79d4eee550bdbd1299e37f2e4f35564e953029a`, helper **44256octets**, SHA256 **`dc8e7e45aa0d4ec68bc0bd050c65869d1a3bcc8840e577f79996b32995c74c6b`**. Helper/test/workflow relus identiques aux octets qualifiés ; [contre-revue](verification-proofs/jm1150/writer-counter-review.md) sans bloqueur restant. Les39tests locaux et39natifs concernent le même lot, sans addition ; aucune suite applicative verte rejouée.

Il vérifie la seconde1793561250 dans le démarrage unique, le staging6384c78b/6008octets, l’ancien checkpoint1141/93d6, les sources/tags, Node/configuration/migrations, l’installation1150 réelle et l’ancien lien1141→vrai1140. Neuf versions, onze ressources, les quatre logs d’installation/smoke et le graphe strictement préservé sont liés. Les codecs dépassant2Mio disposent d’une lecture hash bornée dédiée ; la limite JSON/checkpoint2Mio demeure. Préconditions et identité HTTP publics doivent concorder avant l’écriture atomique/relecture des seules métadonnées. Active1141 entier, section1141, tous historiques/autres blocs et scopes185 SQL38seul/publicProfileDowngradeQualified:false/184172interdits préservés. Aucun CHECK, installation, SQL en écriture ou redémarrage.

Le bloc ci-dessous a été exécuté une fois dans le terminal SSH et son résultat est acquis. **Historique seulement : ne pas le rejouer.**

```bash
env -i PATH=/usr/bin:/bin PYTHONDONTWRITEBYTECODE=1 python3 - <<'PY_RECORD1150'
import hashlib, urllib.request

url = 'https://raw.githubusercontent.com/fredbuhr/jessiemessage/c12846680c30ce008d9cc2f170aa87f06b8d78aa/ops/record-release1150.py'
with urllib.request.urlopen(url, timeout=30) as response:
    if response.status != 200 or response.url != url:
        raise SystemExit('URL_OUTIL_A_VERIFIER : arret.')
    code = response.read(65537)
if len(code) > 65536 or hashlib.sha256(code).hexdigest() != 'dc8e7e45aa0d4ec68bc0bd050c65869d1a3bcc8840e577f79996b32995c74c6b':
    raise SystemExit('EMPREINTE_OUTIL_INCORRECTE : aucun outil execute.')
exec(compile(code, '<enregistrement1150>', 'exec'), {'__name__': '__main__'})
PY_RECORD1150
```

Le [JSON final utilisateur](verification-proofs/jm1150/hosted-metadata.json) confirme `release1150_metadata_recorded`, `publicReady:true`, métadonnées seules et aucun redémarrage. Démarrage exact20:27:30.173Paris conforme au relevé UI, checkpoint989de548. Le fichier privé complet et les PID/socket/SQL physiques n’ont pas été indépendamment inspectés par l’agent. Aucun reçu ou action de livraison restant. Si réponse perdue/interruption/statut non confirmé, ne jamais relancer pour découvrir le résultat : inspecter le checkpoint et les traces en lecture seule. Repli185 reste SQL38seulement, jamais démarré, sans garantie de downgrade publicformat2. Aucun compte/message/média réel, sauvegarde reportée ou chantier juridique touché.

## Historique — bloc préparation/CHECK exécuté, ne pas rejouer

Le bloc ci-dessous est conservé pour traçabilité. Son résultat est acquis selon le reçu utilisateur ; aucune relance dans le terminal SSH. Il a préparé uniquement les nouvelles sources et dépendances, puis lancé le CHECK séparé ; Node24.22.1 et schéma38/37tables attendu inchangés.

```bash
env -i PATH=/usr/bin:/bin PYTHONDONTWRITEBYTECODE=1 python3 - <<'PY_PREPARE1150'
import hashlib, json, subprocess, urllib.request

url = 'https://raw.githubusercontent.com/fredbuhr/jessiemessage/6b6342ba784572d89b076a56647ccb887587f10f/ops/prepare-release1150.py'
with urllib.request.urlopen(url, timeout=30) as response:
    if response.status != 200 or response.url != url:
        raise SystemExit('URL_OUTIL_A_VERIFIER : aucun outil execute.')
    code = response.read(65537)
if len(code) > 65536 or hashlib.sha256(code).hexdigest() != '2bb7a901a3e18321fd7ad428e8bc017594e94517af111efe6a6de73320c7e10f':
    raise SystemExit('OUTIL1150_A_VERIFIER : aucun outil execute.')
ns = {'__name__': 'jm1150_preparation'}
exec(compile(code, '<preparation1150>', 'exec'), ns)
try:
    result = ns['stage'](ns['RELEASE_SOURCE'], ns['RELEASE_TREE'])
except (Exception, KeyboardInterrupt):
    raise SystemExit('PREPARATION1150_NON_CONFIRMEE : conserver les traces, ne pas relancer.') from None
print(json.dumps(result, separators=(',', ':')), flush=True)
try:
    check = subprocess.run(['/bin/bash', result['checkLauncher']], env=ns['clean_environment'](),
        stdin=subprocess.DEVNULL, capture_output=True, timeout=180, check=False)
except (OSError, subprocess.TimeoutExpired, KeyboardInterrupt):
    raise SystemExit('CHECK1150_NON_CONFIRME : conserver les traces, ne pas relancer.') from None
print('CHECK1150_EXIT=' + str(check.returncode), flush=True)
if check.returncode != 0:
    raise SystemExit('CHECK1150_REFUSE : conserver les traces, ne pas relancer.')
print('PREPARATION_1150_CHECK_OK')
PY_PREPARE1150
```

En cas de réponse future incertaine, conserver les traces et inspecter l’état durable en lecture seule avant toute reprise. Le reçu présent ne doit jamais servir à relancer la préparation ou le CHECK pour découvrir leur résultat.
