# Mise en service de la1.9.0

**Précontrôle complet de messagerie acquis selon le résultat utilisateur** : database, schema, photos et videos `passed`, les neuf contrôles SQL `pass`, sans démarrage, migration ni écriture. [Preuve](verification-proofs/jm190-hosted-full-preflight.json). Ce résultat vaut pour l’environnement SSH propre du contrôle ; il ne prouve pas les paramètres Manager, la création des services serveur, l’écoute HTTP ou le routage public.

**Prochaine action unique : lecture des paramètres Manager et de son erreur réelle, sans nouveau démarrage.** Fournir :

1. Une capture des [paramètres Node.js](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/h3/118579/nodejs/239143/data/advanced-settings/application) montrant le dossier d’exécution, le port et les commandes Build et Run complètes.
2. Une capture du [tableau de bord239143](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/h3/118579/nodejs/239143/data/dashboard) montrant l’état Node et l’erreur de la console Exécution. Si besoin, cliquer seulement « Ouvrir la console » sous Exécution, jamais Run/Build pour produire ce relevé.

Aucun autre SSH, SQL, CHECK local ou complet, changement de droits ou installation à effectuer pour ce relevé. L’ancienne capture Build=start190 et le journal190 vide sont historiques ; la configuration corrigée réellement enregistrée reste inconnue. [Audit du démarrage](AUDIT-DEMARRAGE-190.md). Le résultat demandé permettra de distinguer le lancement Manager/lanceur et un échec de création/écoute du serveur.

## Résultats acquis — ne pas répéter

- Sources190 et185, lanceurs et reçus préparés. [Preuve](verification-proofs/jm190-hosted-preparation.json).
- SQL38 appliquées/0 en attente ; reçu d’upgrade SHA256 `0d12dfd9ea9c9510729d39f743159a70a2457b2d999b6d334ae09043fa5d6dfb`, correspondant exactement à2 migrations appliquées/36 préservées. [Statut](verification-proofs/jm190-hosted-schema38-status.json), [reçu](verification-proofs/jm190-hosted-upgrade-confirmation.json). Aucun upgrade à relancer ;184/172 ne peuvent pas redémarrer sur38.
- CHECK185 et190 chacun `passed`, sans démarrage, journal SHA256 `6aac70a7b9626362009117094981574277cdbb8f3bde674096b067f5518b8712`. Cette empreinte correspond au reçu protocolaire attendu de182octets. [Preuve](verification-proofs/jm190-hosted-prechecks.json). Ne pas répéter ces CHECK manuellement ; le Build de Manager pourra naturellement ajouter un reçu de contrôle valide.
- Code190 qualifiéPR/main5/5 et publié latest421892314 sur source `5dda0dd4453d34a0be839d2a1402301dea835381`, arbre `f06a140e738f20994425c714a278b0646f651c1b`. Repli185 compatibleSQL38 publié non latest421892280, source `7a40de9742bdbedc5c0829d820882ca08bf23a91`, arbre `7ec449cb3a63a091c5233993923ceb69f8314366`.185 est précontrôlée sur l’hôte, jamais démarrée.

## Cible de configuration — démarrage suspendu au relevé Manager

1. Ouvrir [Run/Build du service Node239143](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/h3/118579/nodejs/239143/data/advanced-settings/application). Le service porte encore le nom **recette.jessiemessage.com** et dessert aussi le domaine principal ; ce n’est pas une recette isolée.
2. Remplacer les deux commandes par ces valeurs exactes :

| Champ | Valeur |
| --- | --- |
| Build | `bash /srv/customer/jessiemessage-private/check-primary-release190-5dda0dd4.sh` |
| Run | `bash /srv/customer/jessiemessage-private/start-primary-release190-5dda0dd4.sh` |

3. Après le relevé Manager et la correction identifiée, enregistrer les deux champs, puis ouvrir le [tableau de bord Node.js](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/h3/118579/nodejs/239143/data/dashboard). Si le service est encore **Arrêté**, cliquer **Run** pour le démarrer une seule fois. S’il est déjà démarré après enregistrement, ne pas provoquer un second démarrage. Port3000, runtime et autres paramètres existants restent identiques.
4. Ouvrir [État du service](https://jessiemessage.com/admin/readiness) dans la session admin et rapporter le bloc réel d’identité : version **1.9.0**, commit **5dda0dd4453d34a0be839d2a1402301dea835381**, Node **v24.22.1**, date/heure de démarrage. En cas d’échec, rapporter la sortie affichée sans remettre184/172 ni relancer la migration.

Aucun démarrage185 n’est demandé. Aucun résultat d’activation190 n’est encore acquis. Le Node privé officiel est épinglé ; ne pas remplacer le binaire système du fournisseur.

## Après identité190 concordante — métadonnées seules

Le writer final est déjà épinglé aux reçus réels et à la release421892314, qualifié **9/9** sous Nodev24.22.1 par le [run39972263974](https://github.com/fredbuhr/jessiemessage/actions/runs/39972263974), tentative1. Opérateur `8690a8255e1297f288f7eae8ab25811bf63d2262`, SHA256 `40cc11b177de7199d07b7552d440fcf7990a0f8e5e334c885ef8fca93c7d93b8`. [Preuve native](verification-proofs/jm190/writer-final-native.json).

Après l’identité190 réelle, la consigne fournira ce writer immuable. Il contrôlera les sources, reçus, journaux, HTTP publics et publication avant d’actualiser les seules métadonnées du checkpoint. Les historiques184/183/182/181/180/171/160 et autres blocs restent préservés ;185 sera consignée comme précontrôlée jamais démarrée. Aucune écriture190 sur l’hôte n’a encore été rapportée.

Le dernier checkpoint confirmé reste184, SHA256 `3b1781bebf857c465fce429b5160d7432f1e9afa98e0c2a983784bcc3127a212` ; ce bloc historique ne décrit plus le schéma courant38.

Chaque étape dépend de la preuve de la précédente. Les anciennes commandes de préparation, migration et CHECK sont historiques et disponibles dans Git ; elles ne sont plus des actions courantes. Aucun nouvel essai de sauvegarde reportée, compte réel, message, notification, suppression ou infrastructure n’est ouvert par cette mise en service. Téléphone physique et fonctionnalités190 en production restent non vérifiés.
