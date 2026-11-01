# Livraison 1.15.0 — publiée, préparation hébergée à effectuer

La production demeure la **1.14.1** selon le dernier reçu utilisateur : source `c803c2c9be16c0c4ee218d8cac4a1272620d2772`, checkpoint `93d6ddf70db3b1b30d006bf2fb30ab7594ebc2d2b8f88cc59a230f247cbaca82`. Aucun reçu de préparation, CHECK ou démarrage1150 n’est encore acquis. Ne rejouer aucun outil1141.

La [PR147](https://github.com/fredbuhr/jessiemessage/pull/147) est fusionnée. Source/tag [v1.15.0](https://github.com/fredbuhr/jessiemessage/releases/tag/v1.15.0) : **`6712028e08b1e04ac7628bdbb9c39fd9f90d9909`**, arbre **`c80ee33ebfe01838c86cc2b4166b344acf5ea745`**, release/latest **430794626**. Le main documentaire peut avancer ensuite ; ne pas le confondre avec le code publié.

PR [41338555685](verification-proofs/jm1150/pr-native.json), puis main [41339290231](verification-proofs/jm1150/main-native.json) : **5/5 jobs chacun**, tentative1. Général4524tests/4472réussites/52omissions explicites ; Chrome324/324, HTTPS14/14, MariaDB617/617 sur10.11 et11.4. Les omissions ne sont pas des réussites. Le premier run en échec est [conservé](verification-proofs/jm1150/pr-initial-failure.json) ; seuls sept fichiers de fixtures ont été corrigés. [Rapport et limites](photo-acceptance-1150.md), [couverture](verification-proofs/jm1150/coverage.json), [cinq captures](verification-proofs/jm1150/visual-native.json).

Publication : [41340064560](verification-proofs/jm1150/publication-native.json), deux jobs et23/23tests natifs, opérateur `2b238dc6e94da5c4228070a50d8b2ef50e25999a`. Tag/release/latest relus exacts et ancienne1141/430681218 préservée. Aucune activation par ce workflow.

Préparateur : opérateur **`6b6342ba784572d89b076a56647ccb887587f10f`**, arbre `bd00255613868d8a74c82b887e931749a702fc3f`, helper **38463octets**, SHA256 **`2bb7a901a3e18321fd7ad428e8bc017594e94517af111efe6a6de73320c7e10f`**. [Qualification41339490486](verification-proofs/jm1150/preparation-native.json) :23/23tests natifs et installation neuve réellement isolée sous Node24.22.1/npm11.19.1, avec conversion réelle six familles. Inventaire1180entrées/988fichiers, SHA256 `4df6d0b94070f09f2180c9478446b38e07ba58f3bb3e25de083ae79cf14a6152` ; lock `1c0f01051219030260877c438566a5be69bedf28b433907ebe0f9a26cd36fdd1`. Les onze ressources et tous les anciens records sont épinglés ; scripts npm désactivés. Cette qualification a été menée en parallèle du main, sur son même SHA/arbre, puis le main5/5 et la publication ont été confirmés avant toute consigne hébergée.

## Prochaine action unique : préparation et CHECK

Ouvrir le [terminal SSH Infomaniak](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/ssh-terminal/Node.js/terminal). Coller le bloc entier ci-dessous une seule fois. Il vérifie l’outil avant exécution, préserve checkpoint/configuration/lanceurs/dépendances1141→1140, installe des dépendances1150 neuves privées et lance le CHECK séparé. Aucun changement Manager, démarrage ou écriture de métadonnées. Node reste24.22.1 ; schéma38/37tables attendu inchangé, sans migration nouvelle.

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

Conserver et transmettre le JSON, `CHECK1150_EXIT` et le dernier statut. Les flags faux du JSON décrivent le staging avant le CHECK séparé. En cas de sortie ou reçu incertain, ne pas relancer : inspecter les traces et l’état durable en lecture seule. Aucun redémarrage demandé avant ce résultat.

## Étapes suivantes, dépendantes du reçu

Après préparation/CHECK acquis seulement : comparer source/arbre/inventaire/lanceurs, puis fournir les champs exacts du [Run & Build Node.js](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/h3/118579/nodejs/239143/data/advanced-settings/application), application encore nommée `recette.jessiemessage.com` et servant aussi le principal. Ne pas modifier PHP/DNS/SSL ou le port3000. Le [dashboard Node](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/h3/118579/nodejs/239143/data/dashboard) et [l’identité applicative](https://jessiemessage.com/admin/readiness) serviront au relevé réel.

Après démarrage réellement rapporté seulement : qualifier un nouveau writer1150 lié au reçu et à la seconde observée ; aucun ancien writer à réutiliser. Repli historique185 qualifié SQL38 seulement, jamais démarré ; aucune garantie de downgrade publicformat2 déduite,184/172 restent interdits. Safari/téléphones physiques, original client et passage des gros originaux à travers le proxy hébergé restent non attestés. Aucun message réel, modification de compte/média, sauvegarde reportée ou chantier juridique ouvert.
