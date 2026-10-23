# Mise en service de la 1.9.0

**Node239143 arrêté, confirmé par le retour utilisateur et la capture. La migrationSQL est incertaine** : consoleSSH effacée pendant l’absence du propriétaire. [Observation et limites](verification-proofs/jm190-hosted-interruption.json). Le dernier statut connu était36appliquées/2pending ; il ne vaut pas lecture actuelle après une éventuelle exécution d’upgrade. La préparation190/185 reste acquise.

**Prochaine action unique : inspection en lecture seule. Ne pas relancer l’upgrade ou les préparations pour découvrir leur résultat.** Garder Node arrêté ; le Manager affiche encore le Build184, à ne pas exécuter sur un schéma potentiellement38.

Dans le [terminal SSH Infomaniak](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/ssh-terminal/Node.js/terminal), utiliser :

```bash
env -i PATH=/usr/bin:/bin PYTHONDONTWRITEBYTECODE=1 python3 - <<'PY_INSPECT190'
import hashlib, json, urllib.request

url = 'https://raw.githubusercontent.com/fredbuhr/jessiemessage/fbbe445bc37c90509d2af30c1ba7dc630927a40e/ops/migrate-release190.py'
code = urllib.request.urlopen(url, timeout=30).read()
if hashlib.sha256(code).hexdigest() != '3c52c95817cdbdfb0849f3d5bf8c191269937237830d398ccdc8440c6e40c0b2':
    raise SystemExit('Empreinte incorrecte : arrêt.')
helper = {'__name__': 'jm190_inspection'}
exec(compile(code, '<inspection190>', 'exec'), helper)
try:
    helper['identity']()
    for name in ('jm190-upgrade-attempt.json', 'jm190-schema38.json'):
        path = helper['PRIVATE'] / name
        present = path.exists() or path.is_symlink()
        result = {'file': name, 'present': present}
        if present:
            result['sha256'] = hashlib.sha256(helper['file'](path)).hexdigest()
        print(json.dumps(result), flush=True)
    helper['main'](['status'])
except Exception as error:
    reason = str(error) if isinstance(error, helper['MigrationRefused']) else type(error).__name__
    print(json.dumps({'status': 'inspection190_incomplete', 'code': reason}))
    raise SystemExit(1)
PY_INSPECT190
```

La commande utilise le même migrateur qualifié9/9, importé sans lancer son main. Elle contrôle ses pins, lit uniquement la présence et l’empreinte du marqueur et du reçu via son lecteur strict, puis appelle `main(['status'])` ; aucun contenu privé de fichier n’est affiché. Elle demande le compte SQL **fb4hmr_jm_mig** puis son mot de passe masqué, uniquement dans le terminal. Aucun marqueur/reçu n’est créé ou effacé et aucune migration n’est appliquée.

Rapporter toutes les lignes JSON.38/0 avec un reçu présent permet d’instruire la suite ;36/2 sans marqueur ne permet pas de supposer qu’un upgrade a été effectué. Un marqueur présent sans reçu, un statut partiel ou un verrou SQL impose l’inspection avant toute décision. Un statut38/0 sans reçu ne constitue pas un reçu de migration. Aucune de ces issues n’est encore observée.

La base évolue explicitement de36 à38 migrations : une table de préférences chiffrées, puis des champs dans les tâches existantes. Les33 migrations de base et3 vidéo sont identiques. Le repli technique185 accepte38 et conserve les données nouvelles sans afficher les rubriques190. Après migration, ne pas démarrer184 ou172 sur38.

Les qualificationsPR/main5/5 et la [publication2/2](verification-proofs/jm190/publication-native.json) sont acquises. Source190 `5dda0dd4453d34a0be839d2a1402301dea835381`, arbre `f06a140e738f20994425c714a278b0646f651c1b`, release421892314 ;185 non latest421892280. Les49 tests opérateurs natifs sont réussis. Préparateur qualifié à l’opérateur `5859b591e0349bae011147e6aed6ebf330a7a4ba`, SHA256 `d976c224b7ff898720f44b1f018440a29791c40936c504c7782a2874758e35d6`. Les reçus de préparation et le statutSQL sont acquis ; le reçu de migrationSQL38 et les CHECK restent inconnus.

Commande historique de préparation, **déjà exécutée avec succès — ne pas relancer** :

```bash
env -i PATH=/usr/bin:/bin PYTHONDONTWRITEBYTECODE=1 python3 - <<'PY_JM190'
import hashlib, sys, urllib.request

url = 'https://raw.githubusercontent.com/fredbuhr/jessiemessage/5859b591e0349bae011147e6aed6ebf330a7a4ba/ops/prepare-release190.py'
code = urllib.request.urlopen(url, timeout=30).read()
if hashlib.sha256(code).hexdigest() != 'd976c224b7ff898720f44b1f018440a29791c40936c504c7782a2874758e35d6':
    raise SystemExit('Empreinte incorrecte : arrêt.')
sys.argv = ['prepare-release190.py', '5dda0dd4453d34a0be839d2a1402301dea835381', 'f06a140e738f20994425c714a278b0646f651c1b']
exec(compile(code, '<preparation190>', 'exec'), {'__name__': '__main__'})
print('PREPARATION_190_SOURCES_OK')
PY_JM190
```

Le résultat doit donner les deux sources préparées, le reçu190 et son empreinte, `rollback185Prepared:true`, `started:false` et `migrated:false`. Le marqueur confirme seulement la préparation ; SQL36 est encore actif. Conserver la sortie avant la prochaine étape ; ne pas exécuter le champ `nextCheckCommand` avant migrationSQL38.

1. **Préparation190 et185 acquise — ne pas relancer.** Dans le [terminal SSH Infomaniak](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/ssh-terminal/Node.js/terminal), exécuter uniquement le préparateur190 épinglé. Il crée deux worktrees, leurs lanceurs et deux reçus distincts. Il préserve le service184, ses paramètres, les clés et le checkpoint. Il n’exécute ni migration, ni CHECK38, ni démarrage. Conserver le reçu et son empreinte ; en cas de résultat interrompu, inspecter l’état avant toute relance.
2. **StatutSQL acquis — ne pas répéter normalement.** Le reçu rapporté confirme36appliquées/2pending sans migration, source5dda0dd4 et Node24.22.1. Le migrateur est épinglé au reçu190 réel et qualifié9/9.
3. **Arrêter le service puis migrer.** Sur le [tableau de bord Node.js239143](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/h3/118579/nodejs/239143/data/dashboard), le service s’appelle encore **recette.jessiemessage.com** et dessert aussi le domaine principal. Arrêter personnellement l’application et confirmer son arrêt. Le migrateur qualifié `upgrade --service-stopped` marque durablement sa tentative puis applique seulement les deux migrations et relit38 appliquées/0 en attente. Un résultat intermédiaire ou interrompu exige une inspection, sans répétition automatique.
4. **Précontrôler les deux versions.** Après preuveSQL38, exécuter séparément les CHECK185 et190 indiqués dans leurs reçus. Chaque journal doit confirmer le contrôle local sans démarrage ni effacement. Le repli185 n’est précontrôlé sur l’hôte qu’après son propre résultat.
5. **Activer190.** Dans [Run/Build du service239143](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/h3/118579/nodejs/239143/data/advanced-settings/application), utiliser le lanceur190 exact du reçu, selon la consigne fournie après les CHECK. Démarrer puis relever l’identité dans [État du service](https://jessiemessage.com/admin/readiness) : version1.9.0, commit exact qualifié et Nodev24.22.1. Aucun démarrage185 n’est nécessaire.
6. **Enregistrer l’identité réelle.** Épingler et qualifier le writer avec les empreintes des reçus obtenus et l’ID de release réel. Après concordance du journal, de l’identité et des HTTP courants, il met à jour les seules métadonnées du checkpoint. Les anciens blocs et historiques sont préservés. Le reçu distingue185 précontrôlée jamais démarrée et190 active.

Chaque étape dépend de la preuve de la précédente ; aucune n’est acquise par sa simple description. Aucun essai de sauvegarde hébergée reporté, nouveau service, compte réel de test, message réel ou suppression de données n’est demandé par ce parcours.
