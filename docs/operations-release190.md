# Mise en service de la 1.9.0

État actif184 / Node24.22.1 ; **SQL36 désormais confirmé par le statut utilisateur** :36appliquées/2enattente. [Preuve de lecture SQL](verification-proofs/jm190-hosted-schema-status.json). Les champs38migrations/37tables décrivent le plan cible, pas un inventaire physique de la base. Aucun upgrade, CHECK ou démarrage190 acquis. Préparation190 et185 acquise selon le [reçu](verification-proofs/jm190-hosted-preparation.json), empreinte190 recalculée `3a4788b4a31cac3d55f09950e3b98f99a700e0f0dd8af21f83a6135bd01d8cd0`.

**Prochaine action personnelle : arrêter l’application, attendre son état Arrêté, puis appliquer les deux migrations.**

1. Ouvrir le [tableau de bord Node239143](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/h3/118579/nodejs/239143/data/dashboard). Le service porte le nom **recette.jessiemessage.com** et dessert aussi le principal.
2. Choisir **Arrêter** puis attendre le constat d’arrêt dans Manager. Cette observation personnelle précède l’exécution du paramètre `--service-stopped` ; aucun arrêt n’est présumé dans le présent point.
3. Seulement après cet arrêt, exécuter la commande ci-dessous dans le [terminal SSH Infomaniak](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/ssh-terminal/Node.js/terminal). Saisir le compte SQL existant **fb4hmr_jm_mig**, puis son mot de passe masqué. Ne transmettre aucun secret dans la discussion.

```bash
env -i PATH=/usr/bin:/bin PYTHONDONTWRITEBYTECODE=1 python3 - <<'PY_UPGRADE190'
import hashlib, sys, urllib.request

url = 'https://raw.githubusercontent.com/fredbuhr/jessiemessage/fbbe445bc37c90509d2af30c1ba7dc630927a40e/ops/migrate-release190.py'
code = urllib.request.urlopen(url, timeout=30).read()
if hashlib.sha256(code).hexdigest() != '3c52c95817cdbdfb0849f3d5bf8c191269937237830d398ccdc8440c6e40c0b2':
    raise SystemExit('Empreinte incorrecte : arrêt.')
sys.argv = ['migrate-release190.py', 'upgrade', '--service-stopped']
exec(compile(code, '<migration190>', 'exec'), {'__name__': '__main__'})
PY_UPGRADE190
```

Le même migrateur reste qualifié9/9 par le [run39966310677](https://github.com/fredbuhr/jessiemessage/actions/runs/39966310677), avec un vrai test PTY. Source et empreinte inchangées. [Preuve native](verification-proofs/jm190/migrator-tty-native.json). Il recontrôle l’identité et le reçu, pose un marqueur exclusif avant SQL, applique uniquement37–38 et relit le statut38/0. Une tentative préexistante ou un résultat interrompu refuse une répétition automatique.

Rapporter le JSON et son `receiptSha256` réellement obtenus, sans relancer en cas d’échec. La migration et l’arrêt ne sont acquis qu’après le résultat rapporté. Garder l’application arrêtée ensuite : les CHECK185 et190 doivent précéder l’activation190 ;184/172 ne doivent pas être démarrées surSQL38.

La lecture du statut est déjà acquise et n’est pas à répéter pour progresser normalement. Sa commande précédente était la même source avec l’unique argument `status`.

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
