# Livraison 1.11.2 — publiée, préparation hébergée attendue

L’[audit frontend/backend](AUDIT-MOBILE-PROFILES-1112.md) et sa seconde revue de couverture sont terminés : 24 domaines et 171 contrôles avec disposition, sans défaut de code bloquant identifié restant. Les corrections sont regroupées dans une seule version. **La production confirmée reste 1.11.1 ; aucune préparation, aucun CHECK, aucun démarrage ni enregistrement final1112 n’a encore été effectué sur l’hébergement.** [REPRISE](REPRISE.md) reste la référence courante.

## Source et qualifications acquises

- Source immuable : `af352607ff7e12c41185f42b8232c72219a304cd` ; arbre `655f759079979d608b0ec1c62a7c892311899515`.
- [PR139](https://github.com/fredbuhr/jessiemessage/pull/139) fusionnée ; [CI PR40208512760](verification-proofs/jm1112/pr-native.json) puis [main40209568701](verification-proofs/jm1112/main-native.json) chacune5/5 dès la tentative1, même arbre complet.
- Général4072réussis/0échec/52omissions explicites ; Chrome275/275 ; HTTPS14/14 ; MariaDB10.11 et11.4 chacune608/608 sans omission. Les omissions générales ne sont pas des succès. Local202/202 ; sept captures synthétiques inspectées ; audit npm59entrées/0avis connu.
- [Tag/release/latest v1.11.2](https://github.com/fredbuhr/jessiemessage/releases/tag/v1.11.2), release423509844 ; [publication40210405799](https://github.com/fredbuhr/jessiemessage/actions/runs/40210405799)2/2, 26tests de préparation et7de publication natifs sousNode24.22.1. [Reçu et lectures indépendantes](verification-proofs/jm1112/publication-native.json).
- Opérateur immuable : `7134e6e22de4f9f4c4deb2ff89512f6e1335be01` ; arbre `4a53069b4a2142892c531a07f34c6e491afd8cb1`.
- Préparateur SHA256 : `5fe4cbef6da83788f635ac7c46e7febfd550887bd7c013c23b772561251f5e9c`, relu à cette source et identique au fichier qualifié.

## Prochaine action unique — préparation et CHECK

Ouvrir le [terminal Infomaniak](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/ssh-terminal/Node.js/terminal), puis coller le bloc complet une seule fois. Il prépare le nouveau checkout, les lanceurs privés et leur reçu, puis exécute le précontrôle hébergé. Il conserve les anciennes sources, la configuration et le checkpoint1111 ; il n’active pas le nouveau runtime et n’exécute aucune migration.

```bash
env -i PATH=/usr/bin:/bin PYTHONDONTWRITEBYTECODE=1 python3 - <<'PY_PREPARE1112'
import hashlib, json, subprocess, urllib.request

url = 'https://raw.githubusercontent.com/fredbuhr/jessiemessage/7134e6e22de4f9f4c4deb2ff89512f6e1335be01/ops/prepare-release1112.py'
with urllib.request.urlopen(url, timeout=30) as response:
    if response.status != 200 or response.url != url:
        raise SystemExit('URL_OUTIL_A_VERIFIER : arrêt.')
    code = response.read(262145)
if len(code) > 262144 or hashlib.sha256(code).hexdigest() != '5fe4cbef6da83788f635ac7c46e7febfd550887bd7c013c23b772561251f5e9c':
    raise SystemExit('OUTIL1112_A_VERIFIER : aucun outil exécuté.')
ns = {'__name__': 'jm1112_preparation'}
exec(compile(code, '<preparation1112>', 'exec'), ns)
try:
    result = ns['stage']('af352607ff7e12c41185f42b8232c72219a304cd', '655f759079979d608b0ec1c62a7c892311899515')
except Exception:
    raise SystemExit('PREPARATION1112_NON_CONFIRMEE : conserver les traces, ne pas relancer.') from None
print(json.dumps(result, separators=(',', ':')), flush=True)
try:
    check = subprocess.run(['/bin/bash', result['checkLauncher']], env=ns['clean_environment'](),
        stdin=subprocess.DEVNULL, capture_output=True, timeout=180, check=False)
except (OSError, subprocess.TimeoutExpired):
    raise SystemExit('CHECK1112_NON_CONFIRME : conserver les traces, ne pas relancer.') from None
print('CHECK1112_EXIT=' + str(check.returncode), flush=True)
if check.returncode != 0:
    raise SystemExit('CHECK1112_REFUSE : conserver les traces, ne pas relancer.')
print('PREPARATION_1112_CHECK_OK')
PY_PREPARE1112
```

Recueillir le JSON affiché, `CHECK1112_EXIT=0` et `PREPARATION_1112_CHECK_OK` avant de donner les instructions Manager. Une sortie interrompue ou refusée doit être diagnostiquée à partir des traces ; ne pas relancer la préparation pour découvrir son état.

Chemins attendus après succès :

| Élément | Chemin |
| --- | --- |
| Checkout | `/srv/customer/jessiemessage-operator/production-1112-af352607` |
| Exécution | `/srv/customer/jessiemessage-private/start-primary-release1112-af352607.sh` |
| Précontrôle | `/srv/customer/jessiemessage-private/check-primary-release1112-af352607.sh` |
| Reçu | `/srv/customer/jessiemessage-private/jm1112-staging.json` |

Le helper refuse avant mutation un checkpoint autre que `41a51d38a50c3ff07b1878a6cfd96de9e383dbafc5ccff9c96a3a97aa272d90a`, un staging1111 autre que `6b3d46c260be82a3474c71e303726e8532d1e6a5156c01f9ed464ba8f0aa688f`, des références1111 modifiées, un tag/source/arbre non concordant ou des sorties1112 déjà présentes. Il vérifie Node24.22.1 officiel privé, le lien de dépendances vers1101, les38migrations et le lock inchangés. Les tests opérateur sont synthétiques : ils ne prouvent pas le CHECK de cet hébergement.

## Étapes dépendantes encore non effectuées

Après le reçu de préparation/CHECK, activer ce commit depuis l’unique service Node existant, puis relever l’identité réellement démarrée. Ensuite qualifier le writer1112, vérifier démarrage/HTTP/publication, enregistrer les seules métadonnées et relire. Ces étapes ne sont pas des versions applicatives supplémentaires.

L’avatar public nécessite un choix explicite de Jessie : enregistrer sa photo puis **Mettre à jour le profil public**. Aucun profil privé n’est publié automatiquement. L’ancien snapshotformat1 reste lisible par1112 ; le backend1111 ne relit pas le nouveauformat2, donc un retour ancien n’offre pas une restitution complète de ce nouveau profil public. Le repli185 compatibleSQL38 reste séparément qualifié et jamais démarré ; ne démarrer ni184 ni172.

Les appareils physiques, Safari/Firefox, clavier système et Push fermé ne sont pas qualifiés par Chrome. La sauvegarde hébergée reste reportée ; PC, A10/A11/A12 et limites de capacité gardent leur portée. Aucun contenu réel, envoi réel ou effacement réel n’a été utilisé pour cet audit.
