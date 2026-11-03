# Livraison1.15.1 — parcours d’accès

Source applicative `a4a07f9f31c47a7185b57d11b8277be1d87fd2c1`, arbre `568530e702fa4d0a8a6b1743988c5e20b8656c40`. Node24.22.1, neuf dépendances et schéma attendu38/37tables inchangés. [Diagnostic et couverture](access-reliability-1151.md). La1.15.1 est démarrée et ses métadonnées alignées selon le [reçu final utilisateur](verification-proofs/jm1151/hosted-metadata.json) :03/11/2026 12:44:52.415Paris,1793706292415ms, `release1151_metadata_recorded`, `metadataOnly:true`, `noRestart:true`, `publicReady:true`, checkpoint0a2f64c3. **Livraison close, aucun opérateur ou redémarrage à rejouer.**

Préparateur `1c37c5b8055a205df71c8fa86555ae34426f2d61`, arbre `8656cddb0886545a50de3785d32a4072bf75315e`, [qualification41612307744](verification-proofs/jm1151/preparation-native.json) :40/40tests natifs sans omission,1/1job, tentative1. Helper24855octets/SHA256 `481ae7f8ad6c9293316993431fe582a4a743554d6645c7f6e0546548c6d1b102`. Les trois fichiers du helper/test/workflow ont été relus identiques au commit qualifié. Les40locaux/40natifs sont le même lot ; cinq tests de liaison ont ensuite contrôlé les pins finaux sans répéter tout le lot local.

La préparation réemploie exactement le vrai `node_modules`1150, via un nouveau lien1151. Neuf versions, onze ressources, graphe complet, lock1150 `1c0f0105…` et inventaire `4df6d0b9…`/1180entrées/988fichiers sont contrôlés avant et après. Aucun npm, nouvelle installation ou smoke de codecs inchangés rejoué. Checkpoint1150 `989de548…`, staging1150 `6384c78b…`, anciens lanceurs, dépendances et configuration préservés. Sorties exclusives, aucun effacement de sortie partielle ni reprise automatique. La préparation ne lance ni CHECK, migration, runtime, changement Manager ou écriture des métadonnées ; le bloc ci-dessous lance séparément le CHECK en lecture seule après le reçu de préparation.

Publication acquise : tag/release/latestv1.15.1/432505702, sourcea4a07f9f, [41613109924](verification-proofs/jm1151/publication-native.json)2/2jobs et24/24tests natifs. Qualification [PR41610784906](verification-proofs/jm1151/pr-native.json) puis [main41612033199](verification-proofs/jm1151/main-native.json)5/5 chacune, même arbre exact ;52omissions générales conservées. La préparation et le CHECK sont acquis selon le reçu ci-dessous ; l’activation1151 est confirmée par le relevé utilisateur ci-dessous.

## Préparation et CHECK — acquis, ne pas rejouer

Le [reçu utilisateur](verification-proofs/jm1151/hosted-preparation.json) confirme une préparation1151 réussie suivie de `CHECK1151_EXIT=0` et `PREPARATION_1151_CHECK_OK`. Empreinte du reçu canonique **`0323f8631bc6c0f4c6f1fee22e68a2bc1c5b8d730a6d2c93545f929518cb7216`**,4257octets reconstruits identiques par deux lectures indépendantes. Source/arbre/Node, neuf versions/onze ressources, inventaire4df6 et lock1c0f concordent. Checkpoint1150/989, staging1150/6384 et autres états préservés selon le reçu. Aucune activation1151 n’est déduite du CHECK. **Ne pas exécuter de nouveau le bloc historique ci-dessous.** Un résultat futur incertain impose une lecture durable, jamais une mutation pour découvrir son résultat.

[Terminal SSH Infomaniak](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/ssh-terminal/Node.js/terminal) :

```bash
env -i PATH=/usr/bin:/bin PYTHONDONTWRITEBYTECODE=1 python3 - <<'PY_PREPARE1151'
import hashlib, json, subprocess, urllib.request

url = 'https://raw.githubusercontent.com/fredbuhr/jessiemessage/1c37c5b8055a205df71c8fa86555ae34426f2d61/ops/prepare-release1151.py'
with urllib.request.urlopen(url, timeout=30) as response:
    if response.status != 200 or response.url != url:
        raise SystemExit('URL_OUTIL_A_VERIFIER : aucun outil execute.')
    code = response.read(65537)
if len(code) > 65536 or hashlib.sha256(code).hexdigest() != '481ae7f8ad6c9293316993431fe582a4a743554d6645c7f6e0546548c6d1b102':
    raise SystemExit('OUTIL1151_A_VERIFIER : aucun outil execute.')
ns = {'__name__': 'jm1151_preparation'}
exec(compile(code, '<preparation1151>', 'exec'), ns)
try:
    result = ns['stage'](ns['RELEASE_SOURCE'], ns['RELEASE_TREE'])
except (Exception, KeyboardInterrupt):
    raise SystemExit('PREPARATION1151_NON_CONFIRMEE : conserver les traces, ne pas relancer.') from None
print(json.dumps(result, separators=(',', ':')), flush=True)
try:
    check = subprocess.run(['/bin/bash', result['checkLauncher']], env=ns['clean_environment'](),
        stdin=subprocess.DEVNULL, capture_output=True, timeout=180, check=False)
except (OSError, subprocess.TimeoutExpired, KeyboardInterrupt):
    raise SystemExit('CHECK1151_NON_CONFIRME : conserver les traces, ne pas relancer.') from None
print('CHECK1151_EXIT=' + str(check.returncode), flush=True)
if check.returncode != 0:
    raise SystemExit('CHECK1151_REFUSE : conserver les traces, ne pas relancer.')
print('PREPARATION_1151_CHECK_OK')
PY_PREPARE1151
```

Le JSON de préparation précède le CHECK : ses flags `precheckPassed:false`, `started:false` et ses journaux vides décrivent cet instant, sans invalider un `CHECK1151_EXIT=0` ultérieur. Résultat observé selon le reçu utilisateur : source/arbre exacts, `dependenciesReused:true`, `checkpointChanged:false`, puis `CHECK1151_EXIT=0` et `PREPARATION_1151_CHECK_OK`. Aucun démarrage n’est déduit du CHECK.

## Activation — acquise, ne pas rejouer

Les chemins et empreintes réels sont ceux du reçu :

| Élément | Chemin | SHA256 rapporté |
| --- | --- | --- |
| Exécution | `/srv/customer/jessiemessage-private/start-primary-release1151-a4a07f9f.sh` | `6ec4d5e5e38752ceecf01dbd68c007e3052fa4e8c395cfc8a32f67e3459359df` |
| Build | `/srv/customer/jessiemessage-private/check-primary-release1151-a4a07f9f.sh` | `89db31ab008fbe3af3d8dacd053e740c28f47ef906b496cfc981d01e6aaff8b9` |

Lanceurs0700, checkout `/srv/customer/jessiemessage-operator/production-1151-a4a07f9f`0700, journaux0600 selon le reçu. Aucun accès direct aux octets privés des lanceurs par l’agent ; leur identité est contrôlée par les gardes du préparateur qualifié et leur liaison au reçu.

Le [relevé utilisateur](verification-proofs/jm1151/hosted-identity.json) confirme **1.15.1**, source **`a4a07f9f31c47a7185b57d11b8277be1d87fd2c1`**, Node **v24.22.1**, démarrage **03/11/2026 12:44:52 Europe/Paris**, secondeUTC1793706292. Millisecondes et signal disponible absents de cet extrait. Aucun contrôle direct des champs Manager/PID/socket/binaire ou nouvel inventaire SQL physique par l’agent. Ne pas redemander un redémarrage pour obtenir ces informations.

Les deux commandes communiquées étaient `bash /srv/customer/jessiemessage-private/start-primary-release1151-a4a07f9f.sh` en Exécution et `bash /srv/customer/jessiemessage-private/check-primary-release1151-a4a07f9f.sh` en Build, port3000 et dossier de travail conservés. Elles restent une trace de l’étape achevée, pas une instruction de les appliquer à nouveau.

## Métadonnées — acquises, ne pas rejouer

Démarrage1151 et enregistrement final confirmés par le reçu utilisateur ci-dessous. Le writer final est [qualifié36/36tests natifs sans omission](verification-proofs/jm1151/writer-final-native.json),1/1job, tentative1, [run41631279412](https://github.com/fredbuhr/jessiemessage/actions/runs/41631279412). Opérateur **`73e0fd4fadd23dcbd854daa24cb8b6475de17987`**, arbre **`1bb97c8fd795821c8ab0334e0f122340bb73a89e`**. Helper36208octets/SHA256 **`5fe08d685e1e0c973bd3bb23da2cfc0083f754fb67834f4c3211be376265ab41`**. Les trois fichiers qualifiés ont été relus identiques, contre-revue sans blocage ;36locaux/36natifs non additionnés.

Il vérifie la seconde1793706292, le staging0323/4257octets, l’ancien checkpoint1150/989, sources/tags/versions, Node/configuration/migrations, CHECK existants et identité HTTP avant écriture/relecture du seul checkpoint. Dépendances1151→vrai1150/inventaire4df6, neuf versions/onze ressources et graphe normalisé exact ; les locks d’installation1c0f et applicatifeb620 sont distingués. Gros codecs hachés en flux, JSON/checkpoint2Mio. Active1150 entier, section1150, historiques et autres blocs, repli185 SQL38seulement/downgradefalse/184172interdits préservés. Aucun démarrage/CHECK/install/SQL en écriture.

Bloc historique exécuté une fois avec succès par l’utilisateur dans son terminal SSH. **Ne pas le rejouer** :

```bash
env -i PATH=/usr/bin:/bin PYTHONDONTWRITEBYTECODE=1 python3 - <<'PY_RECORD1151'
import hashlib, urllib.request

url = 'https://raw.githubusercontent.com/fredbuhr/jessiemessage/73e0fd4fadd23dcbd854daa24cb8b6475de17987/ops/record-release1151.py'
with urllib.request.urlopen(url, timeout=30) as response:
    if response.status != 200 or response.url != url:
        raise SystemExit('URL_OUTIL_A_VERIFIER : arret.')
    code = response.read(65537)
if len(code) > 65536 or hashlib.sha256(code).hexdigest() != '5fe08d685e1e0c973bd3bb23da2cfc0083f754fb67834f4c3211be376265ab41':
    raise SystemExit('EMPREINTE_OUTIL_INCORRECTE : aucun outil execute.')
exec(compile(code, '<enregistrement1151>', 'exec'), {'__name__': '__main__'})
PY_RECORD1151
```

Le [reçu final utilisateur](verification-proofs/jm1151/hosted-metadata.json) confirme `release1151_metadata_recorded`, `metadataOnly:true`, `noRestart:true`, sourcea4a07f9f/arbre568530e7, `publicReady:true`. Millisecondes réelles **1793706292415**, soit **03/11/2026 12:44:52.415Europe/Paris**, conformes à l’UI à la seconde1793706292. Empreinte du checkpoint1151 **`0a2f64c3f77082f374289883b3607a27e3447bdcb37e4ca43faea2971e6267c3`**, rapportée après écriture/relecture du writer qualifié. Le fichier privé complet n’a pas été fourni, aucune reconstruction indépendante de son hash par l’agent.

Active1150 entier, section1150, historiques1141/1140/1130/1112/1111/1110/1101/1100/190/184, staging1150 et autres blocs préservés selon le reçu. La qualification36/36 native et l’exécution hébergée rapportée restent des preuves distinctes. Repli185 limité au précontrôleSQL38, jamais démarré ; downgrade public non qualifié,184/172 interdits. Aucun nouvel inventaire SQL physique ou appareil réel déduit.

**Aucune étape restante.** Ne rejouer ni préparation, CHECK, activation, writer ou suite verte sans raison nouvelle ; aucun nouveau redémarrage. Si une réponse future est perdue ou incertaine, préserver les traces et inspecter l’état durable en lecture seule avant toute suite ; ne pas relancer pour découvrir un succès éventuel. Sauvegarde manuelle reportée, PC et juridique non rouverts. Attendre la prochaine demande utilisateur.
