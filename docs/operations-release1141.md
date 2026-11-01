# Livraison 1.14.1 — terminée

État du1novembre2026. [REPRISE](REPRISE.md) reste la référence. La1.14.1 est démarrée et ses métadonnées sont alignées selon le [reçu final utilisateur](verification-proofs/jm1141/hosted-metadata.json). Aucune étape de livraison restante, aucune commande1141 ou antérieure à rejouer. `recette.jessiemessage.com` et `jessiemessage.com` partagent le service Node239143 et la même base.

Ancienne production14 et ses preuves entièrement conservées dans le [guide clos1140](operations-release1140.md). Son checkpoint19ceaa7e a servi de baseline strict à la transition1141 ; il n’est plus le checkpoint actif après le reçu final ci-dessous.

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

Le préparateur a vérifié le checkout14 `/srv/customer/jessiemessage-operator/production-1140-4f3ce5de`, puis réutilisé son **vrai répertoire** `node_modules`, mode0700. Ce répertoire n'est pas un lien symbolique. Son inventaire attendu est **1082entrées/914fichiers**, SHA256 `547c6ec03aa29027264dbb848e7830df0cb615a1eb92710498bc94d988897c37` ; les six versions et les deux fichiers du codec HEIC sont également vérifiés. Le checkout1141 a reçu un lien vers ce répertoire exact, sans réinstallation ni modification des dépendances14.

Le checkout préparé est `/srv/customer/jessiemessage-operator/production-1141-c803c2c9`. Ce checkout, ses lanceurs, journaux et reçu sont des sorties exclusives : toute sortie déjà présente, même partielle, est préservée et fait refuser une répétition. Seul le nouveau checkout créé avec le mode2700 hérité peut être normalisé0700, sous descripteur après contrôle d'identité et d'UID. Les parents existants, le checkout14 et ses dépendances gardent leurs permissions.

Le staging14 SHA256 `2fe494a43a446c882ce509f4ecf51925bd5789a94bdbdf2ce6923d83e5ff7d72`, le checkpoint14, les clés, configurations, historiques et anciens lanceurs restent préservés. La préparation ne lance ni CHECK, ni service et ne change ni Manager ni checkpoint. Son reçu initial décrit uniquement des sources préparées, avant le CHECK séparé.

## Préparation et CHECK1141 — acquis, ne pas rejouer

Le [reçu utilisateur](verification-proofs/jm1141/hosted-preparation.json) confirme la source et l’arbre1141 exacts, le checkout0700, la réutilisation des dépendances1140 vérifiées et la préservation du checkpoint14, de la configuration et des anciennes sorties. Empreinte canonique **`df4b58f79ed08af15365557fd88670cd887c4cce9382200fadbd03a9c9593d72`**,3183octets reconstruits identiques ; `CHECK1141_EXIT=0` puis `PREPARATION_1141_CHECK_OK`.

- Lanceur start0700 SHA256 `e53198d1ddf099eaf3ecbd60b6916a94921430a555eaed2a4a4c41ce64ff27a9`.
- Lanceur CHECK0700 SHA256 `6f4aa454a5d1163b9450dba8644ed50dcf034f1a916cad1891c0fa1fc2b05919`.
- Checkpoint14/19ceaa7e, staging14/2fe494a4, inventaire547c6ec0 (1082entrées/914fichiers), six versions et codec identiques selon le reçu.

Les flags `precheckPassed:false`, `started:false` et les journaux vides du JSON décrivent l’état avant le CHECK séparé. Son succès ne prouve ni démarrage1141 ni inventaire SQL physique indépendant. Aucun accès direct de l’agent au Manager, au processus ou aux fichiers privés n’est déduit.

Le [bloc exécuté reste conservé](verification-proofs/jm1141/preparation-command.sh) comme preuve historique. **Ne rejouer ni ce bloc ni le CHECK SSH1141.**

## Activation1141 — acquise selon le relevé utilisateur, ne pas rejouer

L’[identité utilisateur](verification-proofs/jm1141/hosted-identity.json) confirme version1.14.1, commit `c803c2c9be16c0c4ee218d8cac4a1272620d2772`, Nodev24.22.1, **01/11/2026 17:21:03 Europe/Paris**, secondeUTC1793550063. Aucune inspection directe de l’agent des champs Manager ou du processus n’en est déduite. Le signal de disponibilité et les millisecondes ne figuraient pas dans cet extrait initial ; le reçu final ci-dessous les complète.

| Champ correspondant à l’activation rapportée | Valeur1141 |
| --- | --- |
| Exécution, champ du haut | `bash /srv/customer/jessiemessage-private/start-primary-release1141-c803c2c9.sh` |
| Build, champ du bas | `bash /srv/customer/jessiemessage-private/check-primary-release1141-c803c2c9.sh` |
| Port | `3000` |

Le service Node239143 nommé recette.jessiemessage.com dessert aussi le principal et sa base. **Ne rejouer ni préparation, CHECK SSH, réglages ou redémarrage.** Les [réglages du service](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/h3/118579/nodejs/239143/data/advanced-settings/application) et son [tableau de bord](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/h3/118579/nodejs/239143/data/dashboard) ne sont pas à modifier pour la finalisation de métadonnées.

## Enregistrement final1141 — acquis, ne pas rejouer

Le nouvel outil est [qualifié32/32 natifs](verification-proofs/jm1141/writer-final-native.json), sans échec ni omission : [run41326737432](https://github.com/fredbuhr/jessiemessage/actions/runs/41326737432), tentative1,1/1job, Nodev24.22.1. Opérateur **`e6bfd8aa4e50c04f5b51cafe1abb309dd9c2fc57`**, arbre `bfcacffd621e5daa495961e1c946b837be1e45a4`, helper SHA256 **`83b0c3da69dc50e4263632138ba163dc40efc249b5aacffef6a19af653c83ef0`**,34880octets. Helper/test/workflow relus via API et identiques aux octets qualifiés ; log complet conservé et contre-revue indépendante sans bloqueur. Tests applicatifs déjà verts non rejoués.

Il exige le stagingdf4b58f7, le checkpoint14/19ceaa7e et la secondeUTC1793550063 ; retrouve les millisecondes dans l’unique journal de démarrage, contrôle versions/sources/locks/Node/configuration/migrations, dépendances réutilisées, précontrôles, HTTP publics et publication avant toute écriture. Normalisation de la seule version applicative entre14 et1141 ; lock14 installé623e3be5 distinct du lock1141d4b723dc. État actif14 complet, sectionrelease1140/historiques et autres blocs préservés, avec repli185 dans sa portéeSQL38 seule et publicProfileDowngradeQualified:false. Écriture gardée atomique des seules métadonnées puis relecture ; aucun nouvel envoi, SQL, installation, CHECK ou redémarrage.

**Exécution acquise selon le [reçu final utilisateur](verification-proofs/jm1141/hosted-metadata.json)** : `release1141_metadata_recorded`, version1.14.1/sourcec803c2c9/arbre f391b5ce/Nodev24.22.1 exacts ; `publicReady:true`, `metadataOnly:true`, `noRestart:true`, SQL38/37tables attendues. Checkpoint1141 SHA256 **`93d6ddf70db3b1b30d006bf2fb30ab7594ebc2d2b8f88cc59a230f247cbaca82`**. Le journal donne1793550063863ms, soit **01/11/2026 17:21:03.863 Europe/Paris**, en accord avec le relevé UI à la seconde.

Le writer a vérifié sources/tags/dépendances/Node/configuration/migrations, reçus et précontrôles, journal unique lié au démarrage et HTTP publics avant l’écriture atomique et sa relecture. État actif14 complet, sectionrelease1140/staging14, historiques1130/1112/1111/1110/1101/1100/190/184 et autres blocs conservés selon le résultat. Repli185 qualifiéSQL38 seulement, sans démarrage ; publicProfileDowngradeQualified:false et interdictions184/172 maintenus. Aucune inspection directe de l’agent de l’hôte ou du checkpoint privé complet n’en est déduite ; l’empreinte est celle du reçu du writer après relecture, non une reconstruction locale du document privé.

Le [bloc exécuté reste conservé dans l’historique Git](https://github.com/fredbuhr/jessiemessage/blob/904ff037213496e55959094a1e5c625c7c462b78/docs/verification-proofs/jm1141/record-command.sh). **Ne rejouer aucune commande acquise.**

**Livraison1141 terminée : aucune prochaine action technique.** Les GET publics ne prouvent pas seuls le commit du processus ; le writer les rapproche du journal lié au démarrage rapporté, sans inspection indépendante PID/socket/binaire par l’agent. Téléphones physiques, Safari, photo originale problématique et nouvel inventaire SQL physique restent non attestés. Aucun envoi ou changement de compte/média réel, sauvegarde reportée, manipulation PC ou chantier hors périmètre lancé.
