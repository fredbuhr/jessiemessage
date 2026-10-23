# Mise en service de la1.9.0

**Application190 démarrée et identité conforme, mais l’enregistrement final est refusé : `PRECHECK_NOT_PASSED`.** [Refus utilisateur et analyse](verification-proofs/jm190-hosted-writer-precheck-refusal.json). Ce refus intervient dans verify_evidence avant ouverture du checkpoint ; aucune métadonnée n’a été modifiée et aucun redémarrage n’a eu lieu. L’identité1.9.0/source5dda0dd4/Node24.22.1 reste acquise, relevé23octobre17:31:26 Paris.

## Prochaine action unique — lire les deux journaux de contrôle

Le writer exige1–16 reçus exacts par journal. Les deux journaux initiaux étaient conformes ; leur état après les essais Manager reste à lire. Un nombre trop élevé de contrôles est une hypothèse, pas un résultat. Aucun effacement de journal ou assouplissement de validation avant les données réelles.

Dans le [terminal SSH](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/ssh-terminal/Node.js/terminal), utiliser ce diagnostic en lecture seule :

```bash
env -i PATH=/usr/bin:/bin PYTHONDONTWRITEBYTECODE=1 python3 - <<'PY_PRECHECK_LOGS190'
import hashlib, json, re, urllib.request

url = 'https://raw.githubusercontent.com/fredbuhr/jessiemessage/fbbe445bc37c90509d2af30c1ba7dc630927a40e/ops/migrate-release190.py'
code = urllib.request.urlopen(url, timeout=30).read()
if hashlib.sha256(code).hexdigest() != '3c52c95817cdbdfb0849f3d5bf8c191269937237830d398ccdc8440c6e40c0b2':
    raise SystemExit('OUTIL190_A_VERIFIER : arrêt.')
ns = {'__name__': 'jm190_inspection'}
exec(compile(code, '<inspection-prechecks190>', 'exec'), ns)
ns['identity']()
expected = dict(version=2, type='local_closure_precheck', status='passed',
    scope='local_application', pendingClosures=False, started=False,
    erased=False, externalContinuityVerified=False)
canonical = lambda value: json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False)
class DuplicateKey(Exception):
    pass
def unique(pairs):
    result = dict(pairs)
    if len(result) != len(pairs):
        raise DuplicateKey()
    return result
pattern = rb'^((?:RECURRING_(?:SUPERVISOR|FILES)|CHECKPOINT_ENCRYPTION|MANAGED_RUNTIME|ERASURE|WITNESS_(?:ORIGIN|GENESIS|ENROLLMENT|OBSERVATION|RECOVERY))_[A-Z_]{1,40})(?::|$)'
for release, name in (
    ('1.9.0', 'jm190-preflight-node24221-5dda0dd4.log'),
    ('1.8.5', 'jm185-preflight-node24221-7a40de97.log'),
):
    data = ns['file'](ns['PRIVATE'] / name, limit=8*1024*1024)
    lines, details, counts = data.splitlines(), [], {}
    for index, line in enumerate(lines, 1):
        item = dict(line=index)
        try:
            value = json.loads(line, object_pairs_hook=unique)
            exact = canonical(value) == canonical(expected)
            category = 'expected_passed' if exact else 'json_mismatch'
            if not exact and type(value) is dict:
                item['missingExpectedFields'] = [key for key in expected if key not in value]
                item['extraFieldCount'] = len(set(value) - set(expected))
                item['differentExpectedFields'] = [key for key in expected if key in value and canonical(value[key]) != canonical(expected[key])]
                for key, allowed in (('type', ('local_closure_precheck', 'recurring_supervisor', 'recurring_backup_notice', 'account_closures')), ('status', ('passed', 'failed', 'unavailable', 'started', 'stopped', 'completed'))):
                    item[key] = value.get(key) if type(value.get(key)) is str and value[key] in allowed else 'other'
        except DuplicateKey:
            category = 'duplicate_keys'
        except (ValueError, TypeError, UnicodeError):
            category = 'non_json_or_invalid_constant'
            match = re.match(pattern, line)
            if match:
                item['operationalCode'] = match[1].decode('ascii')
        item['classification'] = category
        counts[category] = counts.get(category, 0) + 1
        if category != 'expected_passed' and len(details) < 64:
            details.append(item)
    matches_writer = len(data) <= 65536 and 1 <= len(lines) <= 16 and counts.get('expected_passed', 0) == len(lines)
    print(json.dumps(dict(release=release, logSha256=ns['digest'](data), bytes=len(data),
        lineCount=len(lines), writerSizeLimitExceeded=len(data)>65536,
        writerLineLimitExceeded=len(lines)>16, matchesWriterPrecheck=matches_writer,
        classifications=counts, lines=details, omittedLineDetails=max(0, len(lines)-counts.get('expected_passed',0)-64),
        inspectionReadOnly=True, runtimeStartedByInspection=False), separators=(',', ':')), flush=True)
PY_PRECHECK_LOGS190
```

Rapporter les deux JSON. Ils indiquent nombre de lignes, volume, catégories, différences sur les champs protocolaires et SHA256, sans lignes brutes ni secret. Les succès exacts sont comptés ; seuls les détails d’anomalies sont projetés, au maximum64. Aucun CHECK ou writer n’est rejoué. L’application reste en marche.

Après le relevé, corriger uniquement la cause établie et qualifier un writer modifié si nécessaire. Conserver les journaux complets ; ne pas ignorer une erreur ou choisir seulement le dernier reçu pour obtenir un résultat vert. Le writer8690a825 qualifié9/9 conserve sa preuve historique et son refus réel ; il n’est pas à relancer automatiquement.

## Résultats acquis — ne pas répéter

- Sources190 et185, lanceurs et reçus préparés. [Preuve](verification-proofs/jm190-hosted-preparation.json).
- SQL38 appliquées/0 en attente ; reçu d’upgrade SHA256 `0d12dfd9ea9c9510729d39f743159a70a2457b2d999b6d334ae09043fa5d6dfb`, correspondant exactement à2 migrations appliquées/36 préservées. [Statut](verification-proofs/jm190-hosted-schema38-status.json), [reçu](verification-proofs/jm190-hosted-upgrade-confirmation.json). Aucun upgrade à relancer ;184/172 ne peuvent pas redémarrer sur38.
- CHECK185 et190 chacun `passed`, sans démarrage, journal SHA256 `6aac70a7b9626362009117094981574277cdbb8f3bde674096b067f5518b8712`. Cette empreinte correspond au reçu protocolaire attendu de182octets. [Preuve](verification-proofs/jm190-hosted-prechecks.json). Ne pas répéter ces CHECK manuellement ; le Build de Manager pourra naturellement ajouter un reçu de contrôle valide.
- Code190 qualifiéPR/main5/5 et publié latest421892314 sur source `5dda0dd4453d34a0be839d2a1402301dea835381`, arbre `f06a140e738f20994425c714a278b0646f651c1b`. Repli185 compatibleSQL38 publié non latest421892280, source `7a40de9742bdbedc5c0829d820882ca08bf23a91`, arbre `7ec449cb3a63a091c5233993923ceb69f8314366`.185 est précontrôlée sur l’hôte, jamais démarrée.


Le repli185 reste précontrôlé, jamais démarré ;184/172 ne doivent pas redémarrer sur SQL38. Aucune nouvelle infrastructure ou reprise de sauvegardes reportées. Téléphone physique et fonctions190 en production restent non vérifiés ; le démarrage de la bonne source est acquis séparément.
