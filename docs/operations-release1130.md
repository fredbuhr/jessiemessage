# Livraison 1.13.0 — publication acquise, hébergement non préparé

État du31octobre2026. [REPRISE](REPRISE.md) reste la référence courante ; ce guide distingue la publication de l'installation sur le service Node239143. `recette.jessiemessage.com` et `jessiemessage.com` partagent ce service et sa base.

## Résultat acquis

- [PR144](https://github.com/fredbuhr/jessiemessage/pull/144) fusionnée ; source/tag **`b9e2ad78b47dccb72b8e793cdc448e6b70424430`**, arbre **`dc8933723a54c0307a3fd52719bdd4fd3ac3f96a`**. `main` documentaire peut avancer ensuite, sans déplacement du tag.
- Qualifications finales [PR41221505431](verification-proofs/jm1130/pr-native.json) et [main41222320731](verification-proofs/jm1130/main-native.json), tentative1,5/5 chacune. Général4170réussis/52omissions sur4222 ; Chrome292/292, HTTPS14/14, MariaDB613/613 chacune. Douze captures finales inspectées, arbre complet identique sur main. [Bilan et limites](conversation-lists-1130.md).
- [Publication41223112832](verification-proofs/jm1130/publication-native.json), tentative1,2/2 ; neuf tests natifs de l'opérateur sans omission. Opérateur `01c448fb65432366acb8b07a5df2743053a5611e`, arbre `728079800a5d44ed8c729f647daca75ced4a0c5a`. Scripts et workflow relus aux octets qualifiés. [Tag/release/latestv1.13.0](https://github.com/fredbuhr/jessiemessage/releases/tag/v1.13.0), release430071184, concordants.
- Nodev24.22.1,38migrations/37tables attendues, dépendances inchangées. Aucun inventaire physique de production nouveau déduit de la CI.

**Aucune préparation1130, aucun CHECK, changement Manager, redémarrage ou writer n'a eu lieu.** La dernière identité active rapportée reste1.12.0/source9bfdae07, arbre4aef91b8, démarrée le31octobre02:29:16Europe/Paris. Sa préparation/CHECK et son démarrage sont acquis et ne sont pas à répéter.

## Inspection en lecture seule — acquise

Le [reçu transmis par l’utilisateur](verification-proofs/jm1130/hosted-checkpoint-inspection.json) retrouve le checkpoint privé **1.11.2**, source `af352607ff7e12c41185f42b8232c72219a304cd`, arbre `655f759079979d608b0ec1c62a7c892311899515`, SHA256 **`3f1ae16dbadcee48643cbd2c0435b3eb5d36870cf72aa26cd080b5a0ac2f400f`**, `release1120Present:false`.

L’enregistrement final1120 n’est pas présent dans le fichier relu. Le démarrage1120 reste confirmé séparément ; l’inspection ne décrit ni le processus, ni le Manager, ni la disponibilité HTTP. Elle ne permet pas de conclure au déroulement de l’ancienne commande. Ne rejouer aucun writer1120/1113 et ne pas refaire cette lecture sans élément nouveau. Le [bloc de lecture qualifié sur sept cas synthétiques](verification-proofs/jm1130/checkpoint-inspection-command.json) et son historique sont préservés dans Git.

## Préparation et CHECK 1.13.0 — à exécuter une fois

Le nouvel opérateur est qualifié : [run41226621742](verification-proofs/jm1130/preparation-native.json), tentative1, **1/1 job et33/33 tests natifs sans omission** sousNodev24.22.1. Source **`7f2051b75c24bf6ec947349205070e62fbeb8aa0`**, arbre **`b1499dab714e606f7741e93abc4d1e96a83a89a1`**. Préparateur SHA256 **`0be0e7c51836a9c0576e785fc56373b1b60ea98564a473fd628fadda09e52980`**,19215octets, relu au commit qualifié. Tests SHA256 `8b1d882aa23211f8563e806597479c80be1578182550c8f1b752bc52af3f9399`, workflow `c284e96bf004393b676f30cc4afe9f0511e089eab2c30b9e93132f1cb802b22c`.

Le préparateur crée exclusivement le checkout `/srv/customer/jessiemessage-operator/production-1130-b9e2ad78`, ses deux lanceurs et ses nouveaux journaux. Il réutilise Node24.22.1 et les dépendances1101 inchangées ; il préserve les sources, lanceurs et staging1120 ainsi que le checkpoint1112 exact. Toute sortie préexistante ou partielle refuse sans nettoyage ni relance automatique. Aucun ancien outil1120/1113 n’est appelé et aucun enregistrement final absent n’est fabriqué.

Le bloc appelle ensuite une fois le **nouveau** lanceur CHECK1130. C’est un préflight avec lectures SQL et verrous, assertions des38migrations et lectures de capacité/journaux ; il revient avant le démarrage des workers et du runtime. Il ne fait ni migration, modification de compte, envoi SMTP/Push, écriture de configuration ni changement Manager. Ses sorties sont conservées dans les nouveaux journaux privés. Ce CHECK ne qualifie pas un téléphone physique ou une livraison réelle de message.

1. Ouvrir le [terminal SSH Infomaniak](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/ssh-terminal/Node.js/terminal), pour le service JessieMessage.
2. Coller le bloc entier une seule fois. Aucune modification Run/Build ni activation à ce stade.
3. Transmettre uniquement le JSON, `CHECK1130_EXIT` et le marqueur final. Ne pas transmettre de journal privé.

```bash
env -i PATH=/usr/bin:/bin PYTHONDONTWRITEBYTECODE=1 python3 - <<'PY_PREPARE1130'
import hashlib, json, subprocess, urllib.request

url = 'https://raw.githubusercontent.com/fredbuhr/jessiemessage/7f2051b75c24bf6ec947349205070e62fbeb8aa0/ops/prepare-release1130.py'
with urllib.request.urlopen(url, timeout=30) as response:
    if response.status != 200 or response.url != url:
        raise SystemExit('URL_OUTIL_A_VERIFIER')
    code = response.read(65537)
if len(code) > 65536 or hashlib.sha256(code).hexdigest() != '0be0e7c51836a9c0576e785fc56373b1b60ea98564a473fd628fadda09e52980':
    raise SystemExit('OUTIL1130_A_VERIFIER : aucun outil execute.')
ns = {'__name__': 'jm1130_preparation'}
exec(compile(code, '<preparation1130>', 'exec'), ns)
try:
    result = ns['stage'](ns['RELEASE_SOURCE'], ns['RELEASE_TREE'])
except (Exception, KeyboardInterrupt):
    raise SystemExit('PREPARATION1130_NON_CONFIRMEE : conserver les traces, ne pas relancer.') from None
print(json.dumps(result, separators=(',', ':')), flush=True)
try:
    check = subprocess.run(['/bin/bash', result['checkLauncher']], env=ns['clean_environment'](),
        stdin=subprocess.DEVNULL, capture_output=True, timeout=180, check=False)
except (OSError, subprocess.TimeoutExpired, KeyboardInterrupt):
    raise SystemExit('CHECK1130_NON_CONFIRME : conserver les traces, ne pas relancer.') from None
print('CHECK1130_EXIT=' + str(check.returncode), flush=True)
if check.returncode != 0:
    raise SystemExit('CHECK1130_REFUSE : conserver les traces, ne pas relancer.')
print('PREPARATION_1130_CHECK_OK')
PY_PREPARE1130
```

Attendu : reçu `release1130_sources_staged_not_qualified` sur sourceb9e2ad78/arbre dc893372, checkpoint préservé3f1ae16d et `baselineMetadataRelease:1.11.2`, puis `CHECK1130_EXIT=0` et `PREPARATION_1130_CHECK_OK`. Les flags `precheckPassed:false` et logs vides du reçu décrivent le staging **avant** le CHECK exécuté ensuite ; ils ne doivent pas être réécrits pour fabriquer une qualification. Un résultat absent, interrompu ou refusé exige une inspection durable avant toute suite ; ne pas relancer le bloc.

## Activation 1.13.0 — pas encore effectuée

Examiner le reçu de préparation/CHECK avant de fournir les réglages Manager. Le service239143, nommé `recette.jessiemessage.com`, dessert aussi `jessiemessage.com` et sa base ; il ne s’agit pas d’une cible isolée. La dernière version démarrée rapportée reste1.12.0. Aucun nouveau redémarrage1120, ancien writer, test de sauvegarde, SMTP/Push réel, compte réel ou chantier juridique n’est demandé.
