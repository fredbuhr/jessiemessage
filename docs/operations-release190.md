# Mise en service de la 1.9.0

**Application190 démarrée ; correctif de finalisation qualifié13/13, exécution hébergée restante.** L’identité1.9.0/source5dda0dd4/Node24.22.1 est acquise, relevé23octobre17:31:26 Paris. Le checkpoint privé confirmé reste184 jusqu’au reçu final.

Le refus de l’ancien writer venait uniquement de sa borne arbitraire16 : le journal190 contient21 reçus strictement réussis,3822octets ;185 contient1 reçu conforme,182octets. Leurs empreintes sont reconstituées exactement. [Inspection utilisateur](verification-proofs/jm190-hosted-precheck-log-inspection.json). L’ancien refus et sa qualification restent historiques ; aucun journal n’est effacé ou filtré.

## Prochaine action unique — enregistrer les métadonnées finales

Opérateur corrigé `1b54fa79bb4ab8fa92867b9764ed497a30cca23e`, arbre `76dfb2bd5ebbeb0de1940177d3961d9e9b8f97fd`. SHA256 `4bf91668b9ae60b74a1269e35e3c7dc21b176c450e4dae41cb7431fcbbd8bf72`. [Qualification native13/13](verification-proofs/jm190/writer-precheck-count-native.json), [run39982156936](https://github.com/fredbuhr/jessiemessage/actions/runs/39982156936), tentative1, Nodev24.22.1. Seuls writer et tests ciblés sont modifiés ; l’application publiée reste5dda0dd4.

Dans le [terminal SSH](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/ssh-terminal/Node.js/terminal), coller une fois :

```bash
env -i PATH=/usr/bin:/bin PYTHONDONTWRITEBYTECODE=1 python3 - <<'PY_RECORD190'
import hashlib, urllib.request

url = "https://raw.githubusercontent.com/fredbuhr/jessiemessage/1b54fa79bb4ab8fa92867b9764ed497a30cca23e/ops/record-release190.py"
code = urllib.request.urlopen(url, timeout=30).read()
expected = "4bf91668b9ae60b74a1269e35e3c7dc21b176c450e4dae41cb7431fcbbd8bf72"
if hashlib.sha256(code).hexdigest() != expected:
    raise SystemExit("Empreinte incorrecte : arrêt.")

exec(compile(code, "<enregistrement190>", "exec"), {"__name__": "__main__"})
PY_RECORD190
```

Rapporter le JSON. Le résultat attendu est `release190_metadata_recorded` avec1.9.0/source5dda0dd4, SQL38, `publicReady:true`, repli1.8.5 précontrôlé et préservation des historiques/autres blocs. Seul le reçu effectif permettra de conclure ; il n’est pas encore acquis.

Le writer conserve le plafond64KiB et exige chaque reçu exact d’un journal non vide. Il revalide les preuves locales, l’identité du démarrage, les HTTP publics et la publication avant d’ouvrir le checkpoint, puis préserve l’ancien état et les autres blocs par remplacement atomique gardé. Aucun démarrage, migration, CHECK ou modification de configuration. Si le writer refuse, conserver son JSON et inspecter la cause précise avant toute autre exécution.

## Résultats acquis — ne pas répéter

- Sources190 et185, lanceurs et reçus préparés. [Preuve](verification-proofs/jm190-hosted-preparation.json).
- SQL38 appliquées/0 en attente ; reçu d’upgrade SHA256 `0d12dfd9ea9c9510729d39f743159a70a2457b2d999b6d334ae09043fa5d6dfb`, correspondant exactement à2 migrations appliquées/36 préservées. [Statut](verification-proofs/jm190-hosted-schema38-status.json), [reçu](verification-proofs/jm190-hosted-upgrade-confirmation.json). Aucun upgrade à relancer ;184/172 ne peuvent pas redémarrer sur38.
- CHECK185 et190 chacun `passed`, sans démarrage, journal SHA256 `6aac70a7b9626362009117094981574277cdbb8f3bde674096b067f5518b8712`. Cette empreinte correspond au reçu protocolaire attendu de182octets. [Preuve](verification-proofs/jm190-hosted-prechecks.json). Ne pas répéter ces CHECK manuellement ; le Build de Manager pourra naturellement ajouter un reçu de contrôle valide.
- Code190 qualifiéPR/main5/5 et publié latest421892314 sur source `5dda0dd4453d34a0be839d2a1402301dea835381`, arbre `f06a140e738f20994425c714a278b0646f651c1b`. Repli185 compatibleSQL38 publié non latest421892280, source `7a40de9742bdbedc5c0829d820882ca08bf23a91`, arbre `7ec449cb3a63a091c5233993923ceb69f8314366`.185 est précontrôlée sur l’hôte, jamais démarrée.


Le repli185 reste précontrôlé, jamais démarré ;184/172 ne doivent pas redémarrer sur SQL38. Aucune nouvelle infrastructure ou reprise de sauvegardes reportées. Téléphone physique et fonctions190 en production restent non vérifiés ; le démarrage de la bonne source est acquis séparément.
