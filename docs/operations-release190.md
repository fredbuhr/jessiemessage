# Mise en service de la1.9.0

**La maintenance persiste selon la nouvelle capture. Cause actuelle non établie.** Le journal vide précédent et l’ancien champ Build incorrect restent des observations historiques ; ils ne prouvent pas le résultat de la dernière tentative. [Audit ciblé du code et de la documentation officielle](AUDIT-DEMARRAGE-190.md), [preuves](verification-proofs/jm190-startup-targeted-audit.json).

**Prochaine action : contrôle complet de messagerie en lecture seule et lecture des paramètres Manager réellement enregistrés.** Les CHECK185/190 acquis étaient les contrôles des fermetures locales, pas ce précontrôle complet. Aucun nouveau Run/Build ni changement de SQL, droits ou dépendances à faire pour diagnostiquer.

Dans le [terminal SSH Infomaniak](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/ssh-terminal/Node.js/terminal), utiliser une seule fois :

```bash
env -i PATH=/usr/bin:/bin PYTHONDONTWRITEBYTECODE=1 python3 - <<'PY_FULL190'
import hashlib, json, subprocess, urllib.request

url = 'https://raw.githubusercontent.com/fredbuhr/jessiemessage/fbbe445bc37c90509d2af30c1ba7dc630927a40e/ops/migrate-release190.py'
code = urllib.request.urlopen(url, timeout=30).read()
if hashlib.sha256(code).hexdigest() != '3c52c95817cdbdfb0849f3d5bf8c191269937237830d398ccdc8440c6e40c0b2':
    raise SystemExit('OUTIL190_A_VERIFIER : arrêt.')
ns = {'__name__': 'jm190_inspection'}
exec(compile(code, '<precontrole-complet190>', 'exec'), ns)
checkout, node = ns['identity']()
program = r'''
(async () => {
  const root = 'file:///srv/customer/jessiemessage-operator/production-190-5dda0dd4/';
  const [{run,parseArguments},{inspectDatabase},{checkRuntimeMediaStorage},{checkRuntimeVideoStorage}] = await Promise.all([
    import(root+'scripts/start-private-messaging.mjs'), import(root+'server/preflight/database.mjs'),
    import(root+'server/config/runtime-media-storage.mjs'), import(root+'server/config/runtime-video-storage.mjs')]);
  const {checkMessagingSchema} = await import(root+'scripts/start-private-messaging.mjs');
  const phases={database:'not_reached',schema:'not_reached',photos:'not_reached',videos:'not_reached'};
  let databaseChecks=[],phaseCode=null;
  const safeCode = error => /^(?:PRIVATE_MESSAGING_(?:USAGE|ENVIRONMENT|CONFIGURATION|DATABASE|SCHEMA|STARTUP)|RUNTIME_(?:MEDIA|VIDEO)_STORAGE)$/.test(error?.code ?? '') ? error.code : 'UNCLASSIFIED';
  const phase = (name,fn) => async (...args) => {
    phases[name]='running';
    try { const value=await fn(...args); phases[name]='passed'; return value; }
    catch(error) {phases[name]='failed';phaseCode=safeCode(error);throw error;}
  };
  try {
    const value=await run(parseArguments(['check','--deployment','primary-transition','--experience','1',
      '--profile','photos-notify-recovery-crm-broadcast-video','--private-directory',
      '/srv/customer/jessiemessage-private/runtime-video-180','--private-path-mode','linux-dirfd']), {
      startServer: async () => { throw Error('UNEXPECTED_START'); },
      inspect: async (...args) => {
        phases.database='running';
        const result=await inspectDatabase(...args);
        databaseChecks=result.checks.map(({name,status})=>({name,status}));
        phases.database=result.valid === true?'passed':'failed';
        return result;
      },
      checkSchema:phase('schema',checkMessagingSchema),
      checkStorage:phase('photos',checkRuntimeMediaStorage),
      checkVideoStorage:phase('videos',checkRuntimeVideoStorage)
    });
    if(value.status!=='checks_passed'||value.started!==false) throw Error();
    process.stdout.write(JSON.stringify({status:'release190_full_preflight_passed',phases,databaseChecks,
      phaseCode,runtimeStarted:false,migrated:false,filesWritten:false})+'\n');
  } catch(error) {
    process.stdout.write(JSON.stringify({status:'release190_full_preflight_failed',code:safeCode(error),
      phases,databaseChecks,phaseCode,runtimeStarted:false,migrated:false,filesWritten:false})+'\n');
    process.exitCode=1;
  }
})().catch(()=>{process.stdout.write(JSON.stringify({status:'release190_full_preflight_unavailable',runtimeStarted:false,migrated:false,filesWritten:false})+'\n');process.exitCode=1;});
'''
try:
    result = subprocess.run([str(node), '-'], cwd=checkout, env=ns['environment'](),
        input=program.encode(), stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=180)
except subprocess.TimeoutExpired:
    raise SystemExit('PRECONTROLE190_TIMEOUT : ne pas relancer.')
try:
    value = json.loads(result.stdout)
    if value.get('status') not in ('release190_full_preflight_passed', 'release190_full_preflight_failed', 'release190_full_preflight_unavailable'):
        raise ValueError()
    print(json.dumps(value, separators=(',', ':')))
except (ValueError, TypeError):
    print(json.dumps({'status':'release190_full_preflight_output_unavailable','runtimeStarted':False}))
PY_FULL190
```

Rapporter le JSON. Le contrôle n’ouvre aucun serveur, ne migre rien, n’écrit ni message ni fichier durable et n’affiche aucun secret ; le garde startServer refuse explicitement toute écoute. Les fonctions originales effacent leurs secrets en fin de contrôle. AST Python et syntaxe JavaScript vérifiés, mais aucun résultat de ce contrôle n’a encore été obtenu sur l’hôte.

Fournir également une capture des [paramètres Node.js](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/h3/118579/nodejs/239143/data/advanced-settings/application) montrant dossier d’exécution, port, Build et Run, puis la dernière erreur de la console Exécution sur le [tableau de bord](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/h3/118579/nodejs/239143/data/dashboard), sans relancer l’application. Ces éléments départageront l’initialisation applicative et le lancement Manager ; une page de maintenance seule ne le permet pas.

## Résultats acquis — ne pas répéter

- Sources190 et185, lanceurs et reçus préparés. [Preuve](verification-proofs/jm190-hosted-preparation.json).
- SQL38 appliquées/0 en attente ; reçu d’upgrade SHA256 `0d12dfd9ea9c9510729d39f743159a70a2457b2d999b6d334ae09043fa5d6dfb`, correspondant exactement à2 migrations appliquées/36 préservées. [Statut](verification-proofs/jm190-hosted-schema38-status.json), [reçu](verification-proofs/jm190-hosted-upgrade-confirmation.json). Aucun upgrade à relancer ;184/172 ne peuvent pas redémarrer sur38.
- CHECK185 et190 chacun `passed`, sans démarrage, journal SHA256 `6aac70a7b9626362009117094981574277cdbb8f3bde674096b067f5518b8712`. Cette empreinte correspond au reçu protocolaire attendu de182octets. [Preuve](verification-proofs/jm190-hosted-prechecks.json). Ne pas répéter ces CHECK manuellement ; le Build de Manager pourra naturellement ajouter un reçu de contrôle valide.
- Code190 qualifiéPR/main5/5 et publié latest421892314 sur source `5dda0dd4453d34a0be839d2a1402301dea835381`, arbre `f06a140e738f20994425c714a278b0646f651c1b`. Repli185 compatibleSQL38 publié non latest421892280, source `7a40de9742bdbedc5c0829d820882ca08bf23a91`, arbre `7ec449cb3a63a091c5233993923ceb69f8314366`.185 est précontrôlée sur l’hôte, jamais démarrée.

## Cible de configuration — démarrage suspendu au diagnostic complet

1. Ouvrir [Run/Build du service Node239143](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/h3/118579/nodejs/239143/data/advanced-settings/application). Le service porte encore le nom **recette.jessiemessage.com** et dessert aussi le domaine principal ; ce n’est pas une recette isolée.
2. Remplacer les deux commandes par ces valeurs exactes :

| Champ | Valeur |
| --- | --- |
| Build | `bash /srv/customer/jessiemessage-private/check-primary-release190-5dda0dd4.sh` |
| Run | `bash /srv/customer/jessiemessage-private/start-primary-release190-5dda0dd4.sh` |

3. Après le diagnostic complet et la correction identifiée, enregistrer les deux champs, puis ouvrir le [tableau de bord Node.js](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/h3/118579/nodejs/239143/data/dashboard). Si le service est encore **Arrêté**, cliquer **Run** pour le démarrer une seule fois. S’il est déjà démarré après enregistrement, ne pas provoquer un second démarrage. Port3000, runtime et autres paramètres existants restent identiques.
4. Ouvrir [État du service](https://jessiemessage.com/admin/readiness) dans la session admin et rapporter le bloc réel d’identité : version **1.9.0**, commit **5dda0dd4453d34a0be839d2a1402301dea835381**, Node **v24.22.1**, date/heure de démarrage. En cas d’échec, rapporter la sortie affichée sans remettre184/172 ni relancer la migration.

Aucun démarrage185 n’est demandé. Aucun résultat d’activation190 n’est encore acquis. Le Node privé officiel est épinglé ; ne pas remplacer le binaire système du fournisseur.

## Après identité190 concordante — métadonnées seules

Le writer final est déjà épinglé aux reçus réels et à la release421892314, qualifié **9/9** sous Nodev24.22.1 par le [run39972263974](https://github.com/fredbuhr/jessiemessage/actions/runs/39972263974), tentative1. Opérateur `8690a8255e1297f288f7eae8ab25811bf63d2262`, SHA256 `40cc11b177de7199d07b7552d440fcf7990a0f8e5e334c885ef8fca93c7d93b8`. [Preuve native](verification-proofs/jm190/writer-final-native.json).

Après l’identité190 réelle, la consigne fournira ce writer immuable. Il contrôlera les sources, reçus, journaux, HTTP publics et publication avant d’actualiser les seules métadonnées du checkpoint. Les historiques184/183/182/181/180/171/160 et autres blocs restent préservés ;185 sera consignée comme précontrôlée jamais démarrée. Aucune écriture190 sur l’hôte n’a encore été rapportée.

Le dernier checkpoint confirmé reste184, SHA256 `3b1781bebf857c465fce429b5160d7432f1e9afa98e0c2a983784bcc3127a212` ; ce bloc historique ne décrit plus le schéma courant38.

Chaque étape dépend de la preuve de la précédente. Les anciennes commandes de préparation, migration et CHECK sont historiques et disponibles dans Git ; elles ne sont plus des actions courantes. Aucun nouvel essai de sauvegarde reportée, compte réel, message, notification, suppression ou infrastructure n’est ouvert par cette mise en service. Téléphone physique et fonctionnalités190 en production restent non vérifiés.
