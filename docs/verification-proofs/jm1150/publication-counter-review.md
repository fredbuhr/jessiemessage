# Contre-revue publication 1.15.0 — lecture seule

Verdict : **aucun bloqueur concret établi** dans `ops/publish-qualified1150.py` et ses 23 cas synthétiques. Aucun helper ni test exécuté, aucune mutation distante, aucun déploiement, aucune édition du code.

Pins relus : source `6712028e08b1e04ac7628bdbb9c39fd9f90d9909`, arbre `c80ee33ebfe01838c86cc2b4166b344acf5ea745`, run main `41339290231`, tentative 1. Le run reste une qualification à observer par root ; cette revue ne l’atteste pas réussi.

- **Avant mutations** : contextes dépôt/branche opérateur/push et Node 24.22.1 stricts ; `qualified` reste faux jusqu’après le run terminé/success du SHA main exact, les cinq jobs natifs exacts réussis, arbre/ascendance, package/lock, workflow épinglé, SQL 33+3+2 et état release/latest (lignes 138–158, 225–282). Un run pending échoue à `MAIN_CI_REQUIRED` avant tout POST.
- **Dépendances** : comparaison indépendante du lock au commit candidat via API (blob `c17700369cd30a2d3df94521d723cea423430307`) et du baseline c803 via Git. 61 → 64 records ; aucun ancien record non-racine modifié/supprimé ; seuls Magick 0.0.45, phenomen 1.4.203 et heic-to 1.6.7 ajoutés, records complets exactement égaux aux pins. La fonction compare le graphe complet après seule normalisation des versions racines et retrait des trois ajouts (lignes 97–117).
- **Baseline 1.14.1 préservé** : tag léger à c803, release par tag et ID 430681218 cohérents, puis même snapshot complet des champs identité/name/body/draft/prerelease recontrôlé avant et après création. Inventaire paginé borne dix pages et exige unicité des releases ancienne/nouvelle (lignes 184–218, 273–296).
- **Immutabilité/reprise** : objets existants strictement identiques seulement ; aucun PATCH/DELETE/move/overwrite. Les deux seuls POST possibles sont création du tag v1.15.0 puis création de release/latest. Une réponse POST perdue arrête le tour ; une reprise commence par lectures durables et ne recrée pas l’objet observé. Après POST réussi, seules trois GET maximum avec deux pauses de 1 s confirment sa visibilité ; aucune mutation répétée (lignes 160–169, 259–295).
- **Périmètre et erreurs** : seul subprocess fixe `node --version` ; pas d’appel aux anciens opérateurs, npm, SQL, SSH, préparation, CHECK ou démarrage. Erreurs API exposent seulement méthode et chemin public, sans corps ni token ; autres exceptions neutralisées (lignes 70–87, 304–311).

Couverture relue : 23 fonctions de tests, dont pending CI, job refusé/omis/dupliqué, graphe intégral, SQL/workflow, baseline changé, unicité, réponses perdues, confirmation GET bornée et erreurs POST sans répétition. Le log fermé `publish1150-final-local.log` annonce 23 tests OK ; il n’a pas été rejoué.

Hashes relus :
- helper : `710aa4bbc1438674db0479303c6f3617ab7c1ab5cb7a4c392457bce4e8e2acc8`
- tests : `ab7cbd8f4a837fe4a59c5a899b092c6df366a20097f179f1485726272c9fb63a`

Limite explicite : cette revue du code et du lock ne remplace ni l’observation main 5/5, ni une qualification opérateur native, ni le reçu de publication. Root publie seulement après réussite acquise du run main épinglé.

