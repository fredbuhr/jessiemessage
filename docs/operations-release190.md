# Mise en service de la1.9.0

**Application1.9.0 démarrée selon l’identité rapportée dans État du service.** Source `5dda0dd4453d34a0be839d2a1402301dea835381`, Nodev24.22.1, relevéUI **23/10/2026 17:31:26** à Paris. [Preuve](verification-proofs/jm190-hosted-identity.json). L’inversion des commandes expliquait le blocage ; le résultat de démarrage est maintenant acquis après la consigne de correction. Aucun nouveau démarrage ou contrôle à rejouer.

## Prochaine action unique — enregistrer les métadonnées finales

Le writer final est épinglé aux reçus réels et qualifié9/9 sous Nodev24.22.1, [run39972263974](https://github.com/fredbuhr/jessiemessage/actions/runs/39972263974), opérateur `8690a8255e1297f288f7eae8ab25811bf63d2262`, SHA256 `40cc11b177de7199d07b7552d440fcf7990a0f8e5e334c885ef8fca93c7d93b8`. Son contenu publié immuable est revérifié identique au local ; aucune suite verte à répéter.

Dans le [terminal SSH](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/ssh-terminal/Node.js/terminal), exécuter une seule fois :

```bash
env -i PATH=/usr/bin:/bin PYTHONDONTWRITEBYTECODE=1 python3 - <<'PY_RECORD190'
import hashlib, urllib.request

url = "https://raw.githubusercontent.com/fredbuhr/jessiemessage/8690a8255e1297f288f7eae8ab25811bf63d2262/ops/record-release190.py"
code = urllib.request.urlopen(url, timeout=30).read()
expected = "40cc11b177de7199d07b7552d440fcf7990a0f8e5e334c885ef8fca93c7d93b8"
if hashlib.sha256(code).hexdigest() != expected:
    raise SystemExit("Empreinte incorrecte : arrêt.")

exec(compile(code, "<enregistrement190>", "exec"), {"__name__": "__main__"})
PY_RECORD190
```

Rapporter le JSON réellement obtenu. Le writer vérifie sources, reçus, scripts, bundle, CHECKs, journal de démarrage, HTTP publics et release avant de modifier uniquement le checkpoint privé. Il ne redémarre ni ne migre l’application. Il exige un seul `application_started` cohérent, lit l’epoch réel et préserve les historiques/autres blocs. Un refus doit être rapporté et inspecté sans nouvelle tentative ni effacement du journal.

La dateUI à la seconde ne prouve ni les millisecondes ni le nombre de records ; ces données seront lues par le writer. Les HTTP courants et l’enregistrement190 ne sont pas encore acquis. Le dernier checkpoint confirmé reste184, SHA256 `3b1781bebf857c465fce429b5160d7432f1e9afa98e0c2a983784bcc3127a212`.

## Résultats acquis — ne pas répéter

- Sources190 et185, lanceurs et reçus préparés. [Preuve](verification-proofs/jm190-hosted-preparation.json).
- SQL38 appliquées/0 en attente ; reçu d’upgrade SHA256 `0d12dfd9ea9c9510729d39f743159a70a2457b2d999b6d334ae09043fa5d6dfb`, correspondant exactement à2 migrations appliquées/36 préservées. [Statut](verification-proofs/jm190-hosted-schema38-status.json), [reçu](verification-proofs/jm190-hosted-upgrade-confirmation.json). Aucun upgrade à relancer ;184/172 ne peuvent pas redémarrer sur38.
- CHECK185 et190 chacun `passed`, sans démarrage, journal SHA256 `6aac70a7b9626362009117094981574277cdbb8f3bde674096b067f5518b8712`. Cette empreinte correspond au reçu protocolaire attendu de182octets. [Preuve](verification-proofs/jm190-hosted-prechecks.json). Ne pas répéter ces CHECK manuellement ; le Build de Manager pourra naturellement ajouter un reçu de contrôle valide.
- Code190 qualifiéPR/main5/5 et publié latest421892314 sur source `5dda0dd4453d34a0be839d2a1402301dea835381`, arbre `f06a140e738f20994425c714a278b0646f651c1b`. Repli185 compatibleSQL38 publié non latest421892280, source `7a40de9742bdbedc5c0829d820882ca08bf23a91`, arbre `7ec449cb3a63a091c5233993923ceb69f8314366`.185 est précontrôlée sur l’hôte, jamais démarrée.


Le repli185 reste précontrôlé, jamais démarré ;184/172 ne doivent pas redémarrer sur SQL38. Aucune nouvelle infrastructure ou reprise de sauvegardes reportées. Téléphone physique et fonctions190 en production restent non vérifiés ; le démarrage de la bonne source est acquis séparément.
