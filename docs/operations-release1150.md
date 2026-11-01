# Livraison 1.15.0 — démarrée, métadonnées finales en cours

La **1.15.0 est démarrée selon le [relevé utilisateur](verification-proofs/jm1150/hosted-identity.json)** : source6712028e08b1e04ac7628bdbb9c39fd9f90d9909, Nodev24.22.1,01/11/2026 20:27:30Paris, seconde1793561250. Millisecondes et signal disponible non fournis. Le dernier checkpoint de métadonnées reste1141/93d6, préservé à la préparation ; un nouveau writer1150 doit être qualifié. Ne rejouer ni préparation, CHECK, activation ou ancien outil1141.

La [PR147](https://github.com/fredbuhr/jessiemessage/pull/147) est fusionnée. Source/tag [v1.15.0](https://github.com/fredbuhr/jessiemessage/releases/tag/v1.15.0) : **`6712028e08b1e04ac7628bdbb9c39fd9f90d9909`**, arbre **`c80ee33ebfe01838c86cc2b4166b344acf5ea745`**, release/latest **430794626**. Le main documentaire peut avancer ensuite ; ne pas le confondre avec le code publié.

PR [41338555685](verification-proofs/jm1150/pr-native.json), puis main [41339290231](verification-proofs/jm1150/main-native.json) : **5/5 jobs chacun**, tentative1. Général4524tests/4472réussites/52omissions explicites ; Chrome324/324, HTTPS14/14, MariaDB617/617 sur10.11 et11.4. Les omissions ne sont pas des réussites. Le premier run en échec est [conservé](verification-proofs/jm1150/pr-initial-failure.json) ; seuls sept fichiers de fixtures ont été corrigés. [Rapport et limites](photo-acceptance-1150.md), [couverture](verification-proofs/jm1150/coverage.json), [cinq captures](verification-proofs/jm1150/visual-native.json).

Publication : [41340064560](verification-proofs/jm1150/publication-native.json), deux jobs et23/23tests natifs, opérateur `2b238dc6e94da5c4228070a50d8b2ef50e25999a`. Tag/release/latest relus exacts et ancienne1141/430681218 préservée. Aucune activation par ce workflow.

Préparateur : opérateur **`6b6342ba784572d89b076a56647ccb887587f10f`**, arbre `bd00255613868d8a74c82b887e931749a702fc3f`, helper **38463octets**, SHA256 **`2bb7a901a3e18321fd7ad428e8bc017594e94517af111efe6a6de73320c7e10f`**. [Qualification41339490486](verification-proofs/jm1150/preparation-native.json) :23/23tests natifs et installation neuve réellement isolée sous Node24.22.1/npm11.19.1, avec conversion réelle six familles. Inventaire1180entrées/988fichiers, SHA256 `4df6d0b94070f09f2180c9478446b38e07ba58f3bb3e25de083ae79cf14a6152` ; lock `1c0f01051219030260877c438566a5be69bedf28b433907ebe0f9a26cd36fdd1`. Les onze ressources et tous les anciens records sont épinglés ; scripts npm désactivés. Cette qualification a été menée en parallèle du main, sur son même SHA/arbre, puis le main5/5 et la publication ont été confirmés avant toute consigne hébergée.

## Préparation/CHECK acquis — ne pas rejouer

[Reçu utilisateur](verification-proofs/jm1150/hosted-preparation.json) : `CHECK1150_EXIT=0`, puis `PREPARATION_1150_CHECK_OK`. Empreinte canonique **`6384c78bf94ce688ec33060d672019d8ae534466d7de57c701046e75c6c46a4b`**,6008octets vérifiés. Source/arbre/Node, inventaire1180/988/4df6, lock1c0f, onze ressources codec et sorties smoke identiques au natif. Configuration/bcca, checkpoint1141/93d6, staging1141/df4b et ancien inventaire547 préservés selon ce reçu. Checkout0700, lanceurs0700 ; start SHA256 `da4c86b73649a0939d8ff37f1bd35175b5d2d2b31aa0f15bcd8e1f9fcb191b56`, CHECK SHA256 `c165522014d83d09d5fcb0032b41d91fa13e2f5e146f5aaffde61062620459ba`.

Les flags faux et journaux vides du JSON décrivent le staging avant le CHECK séparé. À cette phase, aucun démarrage1150 n’était déduit ; le relevé suivant l’atteste séparément. Métadonnées1150 et inventaire SQL physique indépendant restent non acquis. **Préparation et CHECK SSH1150 ne doivent pas être rejoués.**

## Activation personnelle — acquise selon le relevé, ne pas rejouer

Les valeurs ci-dessous documentent l’activation rapportée ; aucune manipulation ou relance supplémentaire à effectuer.

1. Ouvrir [Run & Build du service Node239143](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/h3/118579/nodejs/239143/data/advanced-settings/application), nommé **recette.jessiemessage.com**, qui dessert aussi le principal.
2. Remplacer les deux champs :

| Champ | Valeur1150 |
| --- | --- |
| Exécution, champ du haut | `bash /srv/customer/jessiemessage-private/start-primary-release1150-6712028e.sh` |
| Build, champ du bas | `bash /srv/customer/jessiemessage-private/check-primary-release1150-6712028e.sh` |
| Port | `3000`, conservé |
| Répertoire Manager | Conserver la valeur existante ; aucune nouvelle valeur à saisir |

3. Cliquer **Enregistrer**. Si cela relance déjà l’application, attendre ; sinon cliquer une seule fois **Redémarrer** dans le [tableau de bord Node](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/h3/118579/nodejs/239143/data/dashboard). Aucun CHECK manuel supplémentaire en SSH. Le Node effectif reste le binaire privé24.22.1 du lanceur ; ne pas modifier PHP/DNS/SSL.
4. Ouvrir [État du service](https://jessiemessage.com/admin/readiness), puis transmettre Version de l’application, Commit au démarrage complet, Version Node.js et Relevé au démarrage. Attendus : **1.15.0**, **`6712028e08b1e04ac7628bdbb9c39fd9f90d9909`**, **v24.22.1**, nouvelle date réelle. Le signal disponible peut compléter le relevé. Une seule activation : ne pas redémarrer de nouveau si l’identité est déjà correcte.

Ce relevé est désormais acquis, à la seconde1793561250. Prochaine étape : terminer et qualifier un nouveau writer1150 de métadonnées seules lié à cette seconde et au staging6384c78b ; aucun ancien writer à réutiliser. Le dernier checkpoint actif attesté reste1141/93d6 en attendant. Repli historique185 SQL38 seul, jamais démarré, sans garantie de downgrade publicformat2 ;184/172 restent interdits. Aucun test client réel, sauvegarde reportée ou chantier juridique ouvert.

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
