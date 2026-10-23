# Mise en service de la 1.9.0

État hébergé acquis : **1.8.4 / SQL36 / Node24.22.1**, selon les reçus utilisateur conservés dans [REPRISE](REPRISE.md). Les fonctions190 ne sont pas encore activées. [Périmètre des six fonctions](experience190.md).

La base évolue explicitement de36 à38 migrations : une table de préférences chiffrées, puis des champs dans les tâches existantes. Les33 migrations de base et3 vidéo sont identiques. Le repli technique185 accepte38 et conserve les données nouvelles sans afficher les rubriques190. Après migration, ne pas démarrer184 ou172 sur38.

Les qualificationsPR/main5/5 et la [publication2/2](verification-proofs/jm190/publication-native.json) sont acquises. Source190 `5dda0dd4453d34a0be839d2a1402301dea835381`, arbre `f06a140e738f20994425c714a278b0646f651c1b`, release421892314 ;185 non latest421892280. Les49 tests opérateurs natifs sont réussis. Préparateur qualifié à l’opérateur `5859b591e0349bae011147e6aed6ebf330a7a4ba`, SHA256 `d976c224b7ff898720f44b1f018440a29791c40936c504c7782a2874758e35d6`. Les reçus hébergés restent inconnus : aucun résultat n’en est déduit.

Première commande, **préparation des sources uniquement**, dans le terminal SSH ci-dessous :

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

1. **Préparer les sources190 et185.** Dans le [terminal SSH Infomaniak](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/ssh-terminal/Node.js/terminal), exécuter uniquement le préparateur190 épinglé. Il crée deux worktrees, leurs lanceurs et deux reçus distincts. Il préserve le service184, ses paramètres, les clés et le checkpoint. Il n’exécute ni migration, ni CHECK38, ni démarrage. Conserver le reçu et son empreinte ; en cas de résultat interrompu, inspecter l’état avant toute relance.
2. **Lire le statut SQL.** Épingler le migrateur au reçu190 réellement obtenu et qualifier cette révision. Le compte de migration et son secret sont saisis localement dans le terminal ; ne pas les coller dans la discussion. `status` n’effectue aucune mise à niveau. Le statut attendu avant migration est36 appliquées et2 en attente.
3. **Arrêter le service puis migrer.** Sur le [tableau de bord Node.js239143](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/h3/118579/nodejs/239143/data/dashboard), le service s’appelle encore **recette.jessiemessage.com** et dessert aussi le domaine principal. Arrêter personnellement l’application et confirmer son arrêt. Le migrateur qualifié `upgrade --service-stopped` marque durablement sa tentative puis applique seulement les deux migrations et relit38 appliquées/0 en attente. Un résultat intermédiaire ou interrompu exige une inspection, sans répétition automatique.
4. **Précontrôler les deux versions.** Après preuveSQL38, exécuter séparément les CHECK185 et190 indiqués dans leurs reçus. Chaque journal doit confirmer le contrôle local sans démarrage ni effacement. Le repli185 n’est précontrôlé sur l’hôte qu’après son propre résultat.
5. **Activer190.** Dans [Run/Build du service239143](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/h3/118579/nodejs/239143/data/advanced-settings/application), utiliser le lanceur190 exact du reçu, selon la consigne fournie après les CHECK. Démarrer puis relever l’identité dans [État du service](https://jessiemessage.com/admin/readiness) : version1.9.0, commit exact qualifié et Nodev24.22.1. Aucun démarrage185 n’est nécessaire.
6. **Enregistrer l’identité réelle.** Épingler et qualifier le writer avec les empreintes des reçus obtenus et l’ID de release réel. Après concordance du journal, de l’identité et des HTTP courants, il met à jour les seules métadonnées du checkpoint. Les anciens blocs et historiques sont préservés. Le reçu distingue185 précontrôlée jamais démarrée et190 active.

Chaque étape dépend de la preuve de la précédente ; aucune n’est acquise par sa simple description. Aucun essai de sauvegarde hébergée reporté, nouveau service, compte réel de test, message réel ou suppression de données n’est demandé par ce parcours.
