# Livraison 1.14.1 — guide en cours

État du 1 novembre 2026. [REPRISE](REPRISE.md) reste la référence de production. La source1141 est qualifiée et publiée ; le bloc de préparation est prêt. **Préparation hébergée, CHECK, activation et enregistrement final1141 restent à effectuer et à attester.**

**Production acquise : 1.14.0, livraison close.** Source `4f3ce5de5ba059bc5fb4f3dc20aaf3c6202ea9bd`, arbre `e5a239eaf7b8c3395a843c9e0d600efeb7aa569b`, checkpoint14 SHA256 `19ceaa7e91d32daba7da5b71d7dfe02ad964e8d9d2850ae016cfa732b8a9c6e0`. [Bilan clos1140](operations-release1140.md), [reçu final](verification-proofs/jm1140/hosted-metadata.json). Ne rejouer aucune préparation, CHECK, activation ou commande de métadonnées1140.

## Source qualifiée et publication acquises

La source applicative **`c803c2c9be16c0c4ee218d8cac4a1272620d2772`**, arbre **`f391b5cebe0a8a8ffd63c818cd481b50970336f1`**, est qualifiée sur main : [run41321950561](verification-proofs/jm1141/main-native.json), tentative1, **5/5 jobs réussis**. Les omissions explicites restent des omissions, pas des réussites.

| Référence | Résultat acquis |
| --- | --- |
| Opérateur de publication final | `1af81e39b0b995aae650f0dcc1c98995e3943767` |
| Arbre de cet opérateur | `d8d5e292ef221513ee125676a256886665eb793f` |
| Publication | [run41322823806](https://github.com/fredbuhr/jessiemessage/actions/runs/41322823806), tentative1, **2/2 jobs réussis** |
| Tag/release/latest | [v1.14.1](https://github.com/fredbuhr/jessiemessage/releases/tag/v1.14.1), release **430681218**, source exacte `c803c2c9be16c0c4ee218d8cac4a1272620d2772` |
| Préparateur qualifié | `fac6890fa0650c785fcbaa464a9d228ba519a312` |
| Arbre du préparateur | `ea382dd779e7fc98bf32a88a0fc3d2befdd3c208` |
| Qualification native du préparateur | [run41322003894](verification-proofs/jm1141/preparation-native.json), tentative1, **1/1 job et39/39 tests sans omission**, Nodev24.22.1 |
| Préparateur,23585octets, SHA256 | `e1ecb05e40667ad4eadbd029c971d9b44b7f68f7f7bec7c6e7d2f52c79ce0197` |

Le tag immuable, la release et latest ont été contrôlés concordants avec la source main qualifiée. [Preuve de publication](verification-proofs/jm1141/publication-native.json). Un [premier essai](verification-proofs/jm1141/publication-initial-failure.json) avait échoué sur une fixture,16/17 tests : le job de publication était ignoré. La correction a porté sur le test uniquement ; cet échec ne devient pas une publication réussie et reste distinct du run final ci-dessus.

Le helper de préparation, son test et son workflow ont été relus par API au commit qualifié, identiques aux fichiers locaux ; le [journal natif complet](verification-proofs/jm1141/logs/preparation-native.log.gz) est conservé en gzip,mtime0. Cette qualification synthétique ne prouve aucune exécution hébergée. Le [bloc exact1141](verification-proofs/jm1141/preparation-command.sh) a sa syntaxe Python et bash vérifiée ; il n'a jamais été exécuté sur l'hébergement.

## Portée de la préparation

Le correctif conserve **Node24.22.1, les six dépendances verrouillées et SQL38/37tables attendues**. Aucune installation npm, nouvelle dépendance, migration SQL ou modification du bundle de configuration n'est prévue.

Le préparateur doit vérifier le checkout14 `/srv/customer/jessiemessage-operator/production-1140-4f3ce5de`, puis réutiliser son **vrai répertoire** `node_modules`, mode0700. Ce répertoire n'est pas un lien symbolique. Son inventaire attendu est **1082entrées/914fichiers**, SHA256 `547c6ec03aa29027264dbb848e7830df0cb615a1eb92710498bc94d988897c37` ; les six versions et les deux fichiers du codec HEIC sont également vérifiés. Le nouveau checkout1141 recevra un lien vers ce répertoire exact, sans réinstallation ni modification des dépendances14.

Le nouveau checkout attendu est `/srv/customer/jessiemessage-operator/production-1141-c803c2c9`. Ce checkout, ses lanceurs, journaux et reçu sont des sorties exclusives : toute sortie déjà présente, même partielle, est préservée et fait refuser une répétition. Seul le nouveau checkout créé avec le mode2700 hérité peut être normalisé0700, sous descripteur après contrôle d'identité et d'UID. Les parents existants, le checkout14 et ses dépendances gardent leurs permissions.

Le staging14 SHA256 `2fe494a43a446c882ce509f4ecf51925bd5789a94bdbdf2ce6923d83e5ff7d72`, le checkpoint14, les clés, configurations, historiques et anciens lanceurs restent préservés. La préparation ne lance ni CHECK, ni service et ne change ni Manager ni checkpoint. Son reçu initial décrit uniquement des sources préparées, avant le CHECK séparé.

## Première étape personnelle — un passage au terminal, reçu attendu

**Préparation et CHECK1141 non reçus à ce stade.** Aucun démarrage1141 n'est acquis.

**La première et unique action à effectuer maintenant est le bloc terminal ci-dessous ; attendre son reçu avant l'activation.**

1. Dans ton propre navigateur, ouvrir le [terminal SSH Infomaniak](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/ssh-terminal/Node.js/terminal).
2. Ouvrir le [bloc exact de préparation/CHECK1141](verification-proofs/jm1141/preparation-command.sh), copier toutes ses lignes, de `env -i` jusqu'à `PY_PREPARE1141`, puis les coller dans ce terminal et valider **une seule fois**. Le bloc télécharge le helper au commit `fac6890fa0650c785fcbaa464a9d228ba519a312`, vérifie son SHA256 avant exécution, prépare les nouvelles sorties et conserve le reçu initial, puis effectue le CHECK séparé1141.
3. Transmettre le JSON de staging et son empreinte canonique, la ligne `CHECK1141_EXIT=0` et le marqueur `PREPARATION_1141_CHECK_OK` s'ils sont présents. Ne transmettre aucun secret ou fichier privé. Si la réponse est interrompue ou refusée, conserver l'état et le message ; une réponse manquante n'autorise pas une répétition du bloc.

**Attendre la validation du reçu avant de modifier le Manager ou d'activer1141.** Des flags `precheckPassed:false`, `started:false` et des journaux vides dans le reçu initial décrivent l'étape avant CHECK ; ils ne doivent pas être réécrits pour fabriquer un succès. Un CHECK réussi ne prouve pas que le processus1141 a démarré.

## Activation personnelle — seulement après le reçu validé

Le service Node **239143**, nommé **recette.jessiemessage.com** dans le Manager, dessert aussi **jessiemessage.com**, avec le même runtime et la même base. Le site PHP `accueil.jessiemessage.com` n'est pas la cible de cette opération.

**Activation future : ne pas appliquer les valeurs suivantes avant validation du reçu de préparation et du CHECK1141.** Elles devront correspondre aux chemins et empreintes du reçu validé.

| Champ Manager | Valeur1141 attendue après le reçu validé |
| --- | --- |
| Exécution, champ du haut | `bash /srv/customer/jessiemessage-private/start-primary-release1141-c803c2c9.sh` |
| Build, champ du bas | `bash /srv/customer/jessiemessage-private/check-primary-release1141-c803c2c9.sh` |
| Port | `3000` |

Après cette validation seulement :

1. Ouvrir les [réglages Run/Build du service Node239143](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/h3/118579/nodejs/239143/data/advanced-settings/application).
2. Renseigner **Exécution, champ du haut**, et **Build, champ du bas**, avec les deux valeurs1141 du tableau, confirmées par le reçu. Conserver le port **3000**. Les valeurs1140 du guide clos ne sont pas des commandes à rejouer.
3. Après enregistrement des valeurs exactes, effectuer l'activation personnelle selon les consignes alors fournies, puis ouvrir le [tableau de bord Node.js du même service](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/h3/118579/nodejs/239143/data/dashboard).
4. Relever la nouvelle identité réelle de démarrage : version1.14.1, commit complet, Nodev24.22.1, date/heure et fuseau affichés, ainsi que l'état disponible. Transmettre ce relevé avant toute étape de métadonnées. Ne pas inventer les millisecondes absentes de l'interface et ne pas recommencer le démarrage pour les obtenir.

L'agent n'a pas inspecté le Manager ou le processus hébergé. Les réglages et le nouveau démarrage restent non attestés tant que leur relevé n'est pas reçu.

## Critère de fin — writer1141 encore à qualifier

Après la nouvelle identité de démarrage, un writer1141 devra être préparé et qualifié séparément, lié aux sources exactes, au reçu de staging, au CHECK, au démarrage réel et au checkpoint14 préservé. Il devra vérifier ces preuves avant une écriture gardée des seules métadonnées, puis relire le résultat ; aucun nouveau redémarrage ou SQL n'est prévu pour cette finalisation.

La livraison ne sera close qu'après réception et vérification du résultat de ce writer : application/checkpoint/publication1141 concordants, disponibilité publique confirmée dans sa portée, état14 complet et autres blocs préservés. **Writer1141 non qualifié et non exécuté à ce stade ; aucun enregistrement final1141 acquis.**

Les GET publics ne prouvent pas seuls le commit du processus. Téléphones physiques, Safari, photo originale problématique et inventaire SQL physique nouveau ne sont pas déduits de cette livraison. La sauvegarde reportée, les comptes et médias réels, le PC et les chantiers hors périmètre gardent leur état acquis, sans nouvel essai automatique.
