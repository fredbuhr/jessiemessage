# Correctifs 1.8.1 — réponses rapides et accès aux sauvegardes

**Correctif fusionné, qualifié et publié ; pas encore déployé.** La production reste la 1.8.0, identifiée dans [REPRISE](REPRISE.md). Ce correctif regroupe les deux retours utilisateur du 22 octobre ; il ne change ni SQL36, ni Node 24.22.1, ni les configurations privées.

## Comportement attendu

- Les six phrases proposées et les réponses ajoutées apparaissent dans une seule liste de réponses rapides, filtrée par langue. Les réponses ajoutées conservent leurs commandes de modification et de suppression ; choisir une phrase l’insère dans le brouillon sans l’envoyer.
- L’adresse exacte `/admin/login/` redirige automatiquement vers `/admin/login` pour GET et HEAD, avec ses paramètres. Les autres chemins et les API gardent leurs règles. Cette correction concerne les requêtes qui atteignent l’application ; le contrôle après déploiement reste nécessaire si une page est produite par le frontal Infomaniak.

L’utilisateur confirme que l’enregistrement d’une réponse fonctionne. La vidéo est déjà validée par son retour précédent. La sauvegarde reste non testée : les nouvelles captures montrent encore une page Infomaniak sur l’adresse de connexion avec une barre finale, avant l’accès à l’écran de sauvegarde. La cause de cette page fournisseur n’est pas établie.

## Qualification et livraison

La [PR 128](https://github.com/fredbuhr/jessiemessage/pull/128) est fusionnée sur `1ae4c75152795ea6f31c2ff364e337a1d5a04e31`, arbre `eb427f887248fa9db5c656c3773e016f8688efc9`. La [CI PR corrigée 39782399251](https://github.com/fredbuhr/jessiemessage/actions/runs/39782399251) et la [CI main 39783509428](https://github.com/fredbuhr/jessiemessage/actions/runs/39783509428) réussissent chacune 5/5, tentative 1, sur ce même arbre : général 3 803 tests, 3 756 réussis, 47 omissions explicites ; Chrome 218/218, HTTPS 4/4 et chaque moteur MariaDB 564/564 sans omission ; contrôles Python 15/15. Les 47 omissions générales sont 45 cas SQL sur opt-in et deux cas procfs inapplicables ; elles ne sont pas transformées en succès. Les journaux complets et métriques synthétiques séparées sont référencés dans la [preuve 1.8.1](verification-proofs/jm181-verification.json).

Le [tag et la release v1.8.1](https://github.com/fredbuhr/jessiemessage/releases/tag/v1.8.1), identifiant `420741528`, sont publiés le `2026-10-22T13:13:04Z` sur cette source exacte. La [publication 39784801295](https://github.com/fredbuhr/jessiemessage/actions/runs/39784801295), opérateur `e618b94506da42f21b0a194e90c294ab872a8bd2`, arbre `ece78482eaf616a257a0f534f3390b24dea91523`, réussit ses deux jobs à la première tentative, après 25 tests de publication et 19 de préparation isolée. Latest reste **v1.8.0**, identifiant `420607423`, jusqu’à l’activation vérifiée ; le repli 1.7.2 est préservé. Le correctif utilise le bundle vidéo existant et ne demande aucune migration, initialisation, nouvelle clé, suppression ou manipulation du PC.

Contrôles locaux sous Node 24.22.1 : connexion/navigation 26/26 ; cycle de vie 81/81 ; accessibilité 21/21 ; internationalisation 14/14 ; phrases fixes 4/4. Le premier passage du cycle de vie a révélé un sélecteur absent de sa fixture VM ; la fixture corrigée et le nouveau cas de focus passent, l’échec initial reste conservé. La syntaxe de 704 sources et le build de la révision locale initiale passent ; le build de la source publiée exacte est qualifié par sa CI. Chrome n’était pas disponible localement ; les deux CI réussies apportent la qualification native.

La [première CI PR 39780819468](https://github.com/fredbuhr/jessiemessage/actions/runs/39780819468) conserve ses résultats : général et HTTPS réussis, chaque moteur MariaDB 564/564 ; Chrome 217/218, avec un clic visant un bouton fixe remplacé entre sa sélection et son activation par le chargement asynchrone. La correction conserve les six nœuds fixes tant que la langue ne change pas. Huit cas locaux ciblés passent sur cette correction, dont identité des boutons et focus pendant un chargement différé ; le scénario Chrome est renforcé sans ajouter d’attente au clic concerné. Les CI corrigée et main qualifient cette nouvelle révision ; le premier run reste échoué et n’est pas relancé.

Le déploiement sera réalisé depuis le terminal personnel de l’utilisateur, avec les liens et commandes exacts fournis dans le chat. Le navigateur cloud n’est pas utilisé. La création, la fin et le téléchargement d’une sauvegarde restent le contrôle fonctionnel hébergé à effectuer ; les preuves et commandes historiques ne sont pas rejouées.

## Activation dans le terminal personnel

État initial : service et métadonnées 1.8.0 actifs. Ouvrir le [terminal SSH Infomaniak](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/ssh-terminal/Node.js/terminal) et coller le bloc suivant une seule fois. Il prépare la référence publiée puis exécute seulement CHECK181, pendant que 1.8.0 continue de fonctionner. Le helper refuse de remplacer une préparation existante ; en cas d’échec ou de résultat incomplet, conserver les sorties sans relancer ni nettoyer.

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

Conserver le port **3000** et la sélection Node **24** du Manager ; le lanceur utilise le binaire privé **24.22.1** qualifié. Enregistrer puis démarrer. La page [état du service](https://jessiemessage.com/admin/readiness) doit afficher **1.8.1**, source **`1ae4c75152795ea6f31c2ff364e337a1d5a04e31`**, Node **v24.22.1**, avec le nouveau relevé au démarrage. Rapporter ces valeurs avant l’alignement des métadonnées : le writer 1.8.0 ne doit pas être rejoué pour la transition 1.8.1. Aucun writer 1.8.1 n’a encore été exécuté.

Recette à effectuer après activation : dans [Messages](https://jessiemessage.com/admin/messages), retrouver une réponse enregistrée après rechargement, dans la liste commune, puis l’insérer sans envoi ; dans [Sauvegardes](https://jessiemessage.com/admin/backups), créer, attendre la fin et télécharger une sauvegarde. Si une connexion est demandée, utiliser [cette adresse canonique](https://jessiemessage.com/admin/login?continue=%2Fadmin%2Fbackups). Une page fournisseur persistante sera traitée selon le résultat effectivement observé, sans conclure que la sauvegarde a échoué ni ouvrir de chantier PHP secondaire.
