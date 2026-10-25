# Livraison 1.11.2 — démarrage rapporté, enregistrement final attendu

L’[audit frontend/backend](AUDIT-MOBILE-PROFILES-1112.md) et sa seconde revue de couverture sont terminés :24domaines et171contrôles avec disposition, sans défaut de code bloquant identifié restant. Les corrections sont regroupées dans une seule version. **Préparation, CHECK et démarrage1112 acquis selon les retours utilisateur ; enregistrement final des métadonnées encore attendu.** [REPRISE](REPRISE.md) reste la référence courante. Ne rejouer ni préparation, CHECK ou redémarrage.

## Source et qualifications acquises

- Source immuable : `af352607ff7e12c41185f42b8232c72219a304cd` ; arbre `655f759079979d608b0ec1c62a7c892311899515`.
- [PR139](https://github.com/fredbuhr/jessiemessage/pull/139) fusionnée ; [CI PR40208512760](verification-proofs/jm1112/pr-native.json) puis [main40209568701](verification-proofs/jm1112/main-native.json) chacune5/5 dès la tentative1, même arbre complet.
- Général4072réussis/0échec/52omissions explicites ; Chrome275/275 ; HTTPS14/14 ; MariaDB10.11 et11.4 chacune608/608 sans omission. Les omissions générales ne sont pas des succès. Local202/202 ; sept captures synthétiques inspectées ; audit npm59entrées/0avis connu.
- [Tag/release/latest v1.11.2](https://github.com/fredbuhr/jessiemessage/releases/tag/v1.11.2), release423509844 ; [publication40210405799](https://github.com/fredbuhr/jessiemessage/actions/runs/40210405799)2/2, 26tests de préparation et7de publication natifs sousNode24.22.1. [Reçu et lectures indépendantes](verification-proofs/jm1112/publication-native.json).
- Opérateur immuable : `7134e6e22de4f9f4c4deb2ff89512f6e1335be01` ; arbre `4a53069b4a2142892c531a07f34c6e491afd8cb1`.
- Préparateur SHA256 : `5fe4cbef6da83788f635ac7c46e7febfd550887bd7c013c23b772561251f5e9c`, relu à cette source et identique au fichier qualifié.

## Prochaine action unique — enregistrement final

L’[identité démarrée1112](verification-proofs/jm1112/hosted-identity.json) est rapportée : version1.11.2, sourceaf352607…, Nodev24.22.1, **25/10/2026 17:35:35 à Paris** (UTC+01 ; UI à la seconde). Aucun accès direct aux champs Manager ou au processus par l’agent n’en est déduit. Ne pas redémarrer à nouveau.

Writer immuable **`67c79dc6a2225580ef783ff4e3e85742a8bb9554`**, arbre `78fa7b598b8c3b6cc48b19c20804cd0540f71b9b`, SHA256 **`1874b6b98d2a75c15ab116842f5c92190bb8c6ef23d972da597d336d1ff65919`**. [Qualification native40213097595](https://github.com/fredbuhr/jessiemessage/actions/runs/40213097595) réussie1/1, tentative1, **17/17 tests**,0échec/omission, Nodev24.22.1. [Preuve](verification-proofs/jm1112/writer-final-native.json). Le writer est lié au checkpoint1111, au reçu1112 et à la seconde de démarrage rapportée ; les millisecondes proviendront du journal réel.

Dans le [terminal Infomaniak](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/ssh-terminal/Node.js/terminal), exécuter une fois :

```bash
env -i PATH=/usr/bin:/bin PYTHONDONTWRITEBYTECODE=1 python3 - <<'PY_RECORD1112'
import hashlib, urllib.request

url = 'https://raw.githubusercontent.com/fredbuhr/jessiemessage/67c79dc6a2225580ef783ff4e3e85742a8bb9554/ops/record-release1112.py'
with urllib.request.urlopen(url, timeout=30) as response:
    if response.status != 200 or response.url != url:
        raise SystemExit('URL_OUTIL_A_VERIFIER : arrêt.')
    code = response.read(262145)
if len(code) > 262144 or hashlib.sha256(code).hexdigest() != '1874b6b98d2a75c15ab116842f5c92190bb8c6ef23d972da597d336d1ff65919':
    raise SystemExit('EMPREINTE_OUTIL_INCORRECTE : aucun outil exécuté.')
exec(compile(code, '<enregistrement1112>', 'exec'), {'__name__': '__main__'})
PY_RECORD1112
```

Il vérifie source/arbre/tag, lanceurs, Node privé, lock, migrations, bundle de configuration, précontrôles, démarrage, HTTP publics et publication avant l’écriture gardée des seules métadonnées et leur relecture. Il préserve le bloc actif1111 complet, les historiques1111/1110/1101/1100/190/184 et les autres blocs. Aucun SQL, démarrage ou changement Manager. Le repli185 conserve sa qualificationSQL38 distincte, sans garantie de lecture du nouveau snapshot publicformat2.

Recueillir le JSON `release1112_metadata_recorded`, l’identité exacte, `publicReady:true`, `noRestart:true` et la nouvelle empreinte du checkpoint. Ce résultat est encore **non reçu**. Un refus ou une interruption doit être diagnostiqué à partir du résultat affiché ; ne pas relancer automatiquement.

## Historique — activation rapportée, ne pas rejouer

Le [reçu utilisateur](verification-proofs/jm1112/hosted-preparation.json) rapporte la préparation source/arbre exacts, `CHECK1112_EXIT=0`, puis `PREPARATION_1112_CHECK_OK`. Empreinte du reçu `eef0d3f64599ee5ccfdd1e0a5bd996daf035fa3e79cab957ef7e97a3afaea628`, reconstituée identique. Les indicateurs faux et empreintes vides restent l’état avant CHECK ; aucun démarrage n’en est déduit et aucune inspection directe de l’hôte par l’agent n’est présumée.

Les instructions déjà appliquées étaient les suivantes ; le relevé1112 a été reçu ensuite.

1. Ouvrir les [réglages de l’application Node.js239143](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/h3/118579/nodejs/239143/data/advanced-settings/application). Le service reste nommé **recette.jessiemessage.com** et dessert aussi **jessiemessage.com**.
2. Enregistrer les valeurs suivantes dans les deux champs, puis redémarrer une fois l’application depuis son [tableau de bord Node.js](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/h3/118579/nodejs/239143/data/dashboard).

| Champ | Valeur1112 |
| --- | --- |
| Commande d’exécution — champ du haut | `bash /srv/customer/jessiemessage-private/start-primary-release1112-af352607.sh` |
| Commande de build — champ du bas | `bash /srv/customer/jessiemessage-private/check-primary-release1112-af352607.sh` |
| Port | `3000` |

3. Après le démarrage, ouvrir l’[état du service](https://jessiemessage.com/admin/readiness), puis recueillir **Version de l’application**, **Commit au démarrage**, **Version Node.js** et **Relevé au démarrage**. Identité attendue :1.11.2, `af352607ff7e12c41185f42b8232c72219a304cd`, `v24.22.1`. Recueillir ce résultat avant le writer final ; un réglage attendu ne prouve pas le code réellement démarré.

## Historique — préparation et CHECK acquis, ne pas rejouer

L’instruction déjà exécutée était : ouvrir le [terminal Infomaniak](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/ssh-terminal/Node.js/terminal), puis coller le bloc complet une seule fois. Il prépare le nouveau checkout, les lanceurs privés et leur reçu, puis exécute le précontrôle hébergé. Il conserve les anciennes sources, la configuration et le checkpoint1111 ; il n’active pas le nouveau runtime et n’exécute aucune migration.

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

Le JSON, `CHECK1112_EXIT=0` et `PREPARATION_1112_CHECK_OK` sont maintenant reçus et conservés. Ne pas rejouer la commande. Une sortie interrompue ou refusée doit être diagnostiquée à partir des traces, sans relance aveugle.

Chemins rapportés par le reçu :

| Élément | Chemin |
| --- | --- |
| Checkout | `/srv/customer/jessiemessage-operator/production-1112-af352607` |
| Exécution | `/srv/customer/jessiemessage-private/start-primary-release1112-af352607.sh` |
| Précontrôle | `/srv/customer/jessiemessage-private/check-primary-release1112-af352607.sh` |
| Reçu | `/srv/customer/jessiemessage-private/jm1112-staging.json` |

Le helper refuse avant mutation un checkpoint autre que `41a51d38a50c3ff07b1878a6cfd96de9e383dbafc5ccff9c96a3a97aa272d90a`, un staging1111 autre que `6b3d46c260be82a3474c71e303726e8532d1e6a5156c01f9ed464ba8f0aa688f`, des références1111 modifiées, un tag/source/arbre non concordant ou des sorties1112 déjà présentes. Il vérifie Node24.22.1 officiel privé, le lien de dépendances vers1101, les38migrations et le lock inchangés. Les tests opérateur sont synthétiques : ils ne prouvent pas le CHECK de cet hébergement.

## Limites conservées

L’activation1112 est rapportée et le writer final est qualifié ; seuls son exécution hébergée et son reçu restent attendus. Cet enregistrement n’est pas une nouvelle version applicative et ne redémarre pas le service.

L’avatar public nécessite un choix explicite de Jessie : enregistrer sa photo puis **Mettre à jour le profil public**. Aucun profil privé n’est publié automatiquement. L’ancien snapshotformat1 reste lisible par1112 ; le backend1111 ne relit pas le nouveauformat2, donc un retour ancien n’offre pas une restitution complète de ce nouveau profil public. Le repli185 compatibleSQL38 reste séparément qualifié et jamais démarré ; ne démarrer ni184 ni172.

Les appareils physiques, Safari/Firefox, clavier système et Push fermé ne sont pas qualifiés par Chrome. La sauvegarde hébergée reste reportée ; PC, A10/A11/A12 et limites de capacité gardent leur portée. Aucun contenu réel, envoi réel ou effacement réel n’a été utilisé pour cet audit.
