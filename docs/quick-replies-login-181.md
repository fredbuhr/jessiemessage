# Correctifs 1.8.1 — réponses rapides et accès aux sauvegardes

**Correctif fusionné, qualifié, publié et identité active 1.8.1 rapportée.** La [preuve admin USER_REPORTED](verification-proofs/jm181-hosted-identity.json) conserve source et Node attendus, relevé exact `22/10/2026 15:30:16` ; production, latest et checkpoint privé sont désormais alignés sur 1.8.1 selon le [reçu final USER_REPORTED](verification-proofs/jm181-hosted-metadata.json), sans redémarrage et avec les historiques et le repli préservés. [REPRISE](REPRISE.md) centralise l’état courant. Ce correctif regroupe les deux retours utilisateur du 22 octobre ; il ne change ni SQL36, ni Node 24.22.1, ni les configurations privées.

## Comportement attendu

- Les six phrases proposées et les réponses ajoutées apparaissent dans une seule liste de réponses rapides, filtrée par langue. Les réponses ajoutées conservent leurs commandes de modification et de suppression ; choisir une phrase l’insère dans le brouillon sans l’envoyer.
- L’adresse exacte `/admin/login/` redirige automatiquement vers `/admin/login` pour GET et HEAD, avec ses paramètres. Les autres chemins et les API gardent leurs règles. Cette correction concerne les requêtes qui atteignent l’application ; le [contrôle HTTP anonyme hébergé](verification-proofs/jm181-public-http.json) confirme désormais le GET à 308 avec les paramètres conservés. Une page produite par le frontal Infomaniak reste distincte de cette route.

L’utilisateur confirme désormais que **la liste commune fonctionne**, selon le [retour interface](verification-proofs/jm181-hosted-interface.json), sans détail séparé de tous les sous-cas de rechargement et d’insertion. La vidéo était déjà validée par son retour précédent. **La sauvegarde reste non vérifiée ; l’utilisateur reporte son test à un autre jour.** La nouvelle capture montre une page Infomaniak sur l’adresse de connexion avec une barre finale, avant l’écran de sauvegarde. La cause de cette page fournisseur n’est pas établie ; ni cette capture ni le 308 observé antérieurement ne prouvent création, fin ou téléchargement d’une sauvegarde. Aucun diagnostic ni nouvel essai n’est lancé aujourd’hui.

## Qualification et livraison

La [PR 128](https://github.com/fredbuhr/jessiemessage/pull/128) est fusionnée sur `1ae4c75152795ea6f31c2ff364e337a1d5a04e31`, arbre `eb427f887248fa9db5c656c3773e016f8688efc9`. La [CI PR corrigée 39782399251](https://github.com/fredbuhr/jessiemessage/actions/runs/39782399251) et la [CI main 39783509428](https://github.com/fredbuhr/jessiemessage/actions/runs/39783509428) réussissent chacune 5/5, tentative 1, sur ce même arbre : général 3 803 tests, 3 756 réussis, 47 omissions explicites ; Chrome 218/218, HTTPS 4/4 et chaque moteur MariaDB 564/564 sans omission ; contrôles Python 15/15. Les 47 omissions générales sont 45 cas SQL sur opt-in et deux cas procfs inapplicables ; elles ne sont pas transformées en succès. Les journaux complets et métriques synthétiques séparées sont référencés dans la [preuve 1.8.1](verification-proofs/jm181-verification.json).

Le [tag et la release v1.8.1](https://github.com/fredbuhr/jessiemessage/releases/tag/v1.8.1), identifiant `420741528`, sont publiés le `2026-10-22T13:13:04Z` sur cette source exacte. La [publication 39784801295](https://github.com/fredbuhr/jessiemessage/actions/runs/39784801295), opérateur `e618b94506da42f21b0a194e90c294ab872a8bd2`, arbre `ece78482eaf616a257a0f534f3390b24dea91523`, réussit ses deux jobs à la première tentative, après 25 tests de publication et 19 de préparation isolée. Latest est désormais **v1.8.1**, identifiant `420741528`, après l’alignement du seul marqueur par le workflow opérateur ; le repli 1.7.2 est préservé. Le correctif utilise le bundle vidéo existant et ne demande aucune migration, initialisation, nouvelle clé, suppression ou manipulation du PC.

Contrôles locaux sous Node 24.22.1 : connexion/navigation 26/26 ; cycle de vie 81/81 ; accessibilité 21/21 ; internationalisation 14/14 ; phrases fixes 4/4. Le premier passage du cycle de vie a révélé un sélecteur absent de sa fixture VM ; la fixture corrigée et le nouveau cas de focus passent, l’échec initial reste conservé. La syntaxe de 704 sources et le build de la révision locale initiale passent ; le build de la source publiée exacte est qualifié par sa CI. Chrome n’était pas disponible localement ; les deux CI réussies apportent la qualification native.

La [première CI PR 39780819468](https://github.com/fredbuhr/jessiemessage/actions/runs/39780819468) conserve ses résultats : général et HTTPS réussis, chaque moteur MariaDB 564/564 ; Chrome 217/218, avec un clic visant un bouton fixe remplacé entre sa sélection et son activation par le chargement asynchrone. La correction conserve les six nœuds fixes tant que la langue ne change pas. Huit cas locaux ciblés passent sur cette correction, dont identité des boutons et focus pendant un chargement différé ; le scénario Chrome est renforcé sans ajouter d’attente au clic concerné. Les CI corrigée et main qualifient cette nouvelle révision ; le premier run reste échoué et n’est pas relancé.

La préparation et la bascule ont été réalisées depuis les accès personnels de l’utilisateur, avec les liens et commandes exacts fournis dans le chat ; l’identité 1.8.1 est rapportée. Le navigateur cloud n’est pas utilisé. La sauvegarde complète reste non vérifiée et son test est reporté à la demande de l’utilisateur ; aucune action supplémentaire n’est demandée aujourd’hui. Les preuves et commandes historiques ne sont pas rejouées.

## Activation dans le terminal personnel

**Préparation et CHECK acquis** selon les [deux résultats utilisateur](verification-proofs/jm181-hosted-preparation.json) du 22 octobre : `local_closure_precheck` v2 `passed`, `pendingClosures:false`, `started:false`. Le bloc de préparation ci-dessous est désormais une référence historique à ne pas rejouer. L’identité 1.8.1 est maintenant rapportée après les étapes Manager ; ces instructions sont elles aussi historiques et ne doivent pas être rejouées. Les métadonnées 1.8.1 sont elles aussi acquises selon le reçu final ; ne pas rejouer ces opérations.

État initial historique avant la bascule : service et métadonnées 1.8.0 actifs. Instructions de préparation conservées pour preuve, à ne pas rejouer : ouvrir le [terminal SSH Infomaniak](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/ssh-terminal/Node.js/terminal) et coller le bloc suivant une seule fois. Il prépare la référence publiée puis exécute seulement CHECK181, pendant que 1.8.0 continue de fonctionner. Le helper refuse de remplacer une préparation existante ; en cas d’échec ou de résultat incomplet, conserver les sorties sans relancer ni nettoyer.

```bash
env -i PATH=/usr/bin:/bin python3 - <<'PY_RELEASE181'
import hashlib
import json
import pathlib
import subprocess
import sys
import urllib.request

url = 'https://raw.githubusercontent.com/fredbuhr/jessiemessage/e618b94506da42f21b0a194e90c294ab872a8bd2/ops/prepare-release181.py'
with urllib.request.urlopen(url, timeout=30) as response:
    code = response.read(15077)
if len(code) != 15076 or hashlib.sha256(code).hexdigest() != 'a8d6b3a3dc699e2ae06d30b44465648b146193ac9b5301f702e905d26a31073c':
    raise SystemExit('Empreinte incorrecte : arrêt.')
sys.argv = [url, '1ae4c75152795ea6f31c2ff364e337a1d5a04e31', 'eb427f887248fa9db5c656c3773e016f8688efc9']
exec(compile(code, url, 'exec'), {'__name__': '__main__'})

private = pathlib.Path('/srv/customer/jessiemessage-private')
try:
    with (private / 'jm181-preflight-node24221-1ae4c751.log').open('rb') as log:
        log.seek(0, 2)
        result = subprocess.run([
            'timeout', '--kill-after=5s', '60s', 'bash',
            str(private / 'check-primary-release181-1ae4c751.sh')
        ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if result.returncode != 0:
            raise ValueError()
        report = None
        for line in log:
            try:
                value = json.loads(line)
            except (ValueError, UnicodeError):
                continue
            if type(value) is dict and value.get('type') == 'local_closure_precheck':
                report = value
        if not (type(report) is dict and type(report.get('version')) is int
                and report['version'] == 2 and report.get('status') == 'passed'
                and report.get('pendingClosures') is False and report.get('started') is False):
            raise ValueError()
        print(json.dumps({k: report[k] for k in (
            'version', 'type', 'status', 'pendingClosures', 'started'
        )}, separators=(',', ':')))
except Exception:
    print('{"status":"release181_precheck_not_confirmed","noAutomaticRetry":true}')
    sys.exit(1)
PY_RELEASE181
```

Résultats attendus : un reçu `release181_sources_staged_not_qualified`, puis **un nouveau** `local_closure_precheck`, `version:2`, `status:"passed"`, `pendingClosures:false`, `started:false`. Le second résultat est extrait uniquement des lignes ajoutées pendant ce CHECK. Rapporter les deux sorties avant la bascule Manager ; aucun journal privé complet ni secret n’est demandé.

Après ces résultats, ouvrir le [tableau de bord Node.js](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/h3/118579/nodejs/239143/data/dashboard), service nommé **recette.jessiemessage.com**, qui dessert aussi le principal, puis l’arrêter. Dans [Run/Build](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/h3/118579/nodejs/239143/data/advanced-settings/application), remplacer uniquement les deux commandes par :

- Run : `bash /srv/customer/jessiemessage-private/start-primary-release181-1ae4c751.sh`
- Build : `bash /srv/customer/jessiemessage-private/check-primary-release181-1ae4c751.sh`

Conserver le port **3000** et la sélection Node **24** du Manager ; le lanceur utilise le binaire privé **24.22.1** qualifié. Enregistrer puis démarrer. La page [état du service](https://jessiemessage.com/admin/readiness) doit afficher **1.8.1**, source **`1ae4c75152795ea6f31c2ff364e337a1d5a04e31`**, Node **v24.22.1**, avec le nouveau relevé au démarrage. Ces valeurs ont été rapportées, avec le relevé `22/10/2026 15:30:16`, dans la [preuve d’identité](verification-proofs/jm181-hosted-identity.json). Le [reçu final](verification-proofs/jm181-hosted-metadata.json) confirme désormais l’exécution du writer 1.8.1 et l’alignement sans redémarrage. Ni ce writer ni celui de la 1.8.0 ne doivent être rejoués pour cette livraison.

La liste commune est validée par le retour utilisateur. La création, la fin et le téléchargement d’une sauvegarde restent non vérifiés et sont reportés à un autre jour à sa demande. Les liens [Messages](https://jessiemessage.com/admin/messages), [Sauvegardes](https://jessiemessage.com/admin/backups) et [connexion canonique](https://jessiemessage.com/admin/login?continue=%2Fadmin%2Fbackups) sont conservés pour une reprise ultérieure ; aucun essai, diagnostic ou chantier PHP n’est lancé aujourd’hui.

## Métadonnées enregistrées sans redémarrage — référence historique

La [qualification opérateur](verification-proofs/jm181-metadata-operator-verification.json), run [39788433888](https://github.com/fredbuhr/jessiemessage/actions/runs/39788433888), réussit ses deux jobs à la première tentative : 16 tests isolés du writer et 55 simulations API, puis alignement de latest 1.8.1. L’opérateur `eb0e0b2e1cdacf24730c8767db92e9df9dd0d2d6`, arbre `cc90fd3361e5288343b8db500141b985fbe648eb`, est distinct de la source applicative active. Le writer exige le checkpoint 1.8.0 épinglé, le reçu de préparation 1.8.1, les sources/lanceurs exacts, le bundle existant, les précontrôles conservés, un vrai démarrage 1.8.1 et les contrôles HTTP avant l’écriture atomique. Il ne démarre rien, ne migre rien et ne réexécute aucun CHECK.

**Exécution acquise :** le [reçu `release181_metadata_recorded`](verification-proofs/jm181-hosted-metadata.json) confirme version/source/arbre exacts, Node v24.22.1, SQL36, `publicReady:true`, métadonnées seules et aucun redémarrage. Checkpoint SHA-256 `53bd5312c42f34934de04d1e4e7994a864892cdf5a945c6a72c7b4c46ef5be76` ; ancien actif, historiques 1.8.0/1.7.1/1.6.0, repli 1.7.2 et autres blocs préservés. Le bloc du [terminal SSH personnel](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/ssh-terminal/Node.js/terminal) ci-dessous est conservé comme référence historique, **à ne pas rejouer** :

```bash
env -i PATH=/usr/bin:/bin python3 - <<'PY_METADATA181'
import hashlib
import urllib.request

url = 'https://raw.githubusercontent.com/fredbuhr/jessiemessage/eb0e0b2e1cdacf24730c8767db92e9df9dd0d2d6/ops/record-release181.py'
with urllib.request.urlopen(url, timeout=30) as response:
    code = response.read(24721)
if len(code) != 24720 or hashlib.sha256(code).hexdigest() != '78458879fe9a2ed022c430e1a3565ed704492f63f6089c7bfb7a7bfd561380c7':
    raise SystemExit('Empreinte incorrecte : arrêt.')
exec(compile(code, url, 'exec'), {'__name__': '__main__'})
PY_METADATA181
```

Le reçu attendu a été obtenu et est conservé sans en déduire d’autres garanties d’exploitation. Il ne reste aucune commande de déploiement ou de métadonnées à exécuter pour cette livraison. La liste commune fonctionne selon le retour utilisateur ; seule la vérification fonctionnelle sauvegarde reste reportée, sans nouveau diagnostic ni essai aujourd’hui.
