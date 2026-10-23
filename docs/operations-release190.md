# Mise en service de la1.9.0

**Cause identifiée dans les nouvelles captures : les deux commandes Manager sont inversées.** En haut, « Commande d’exécution » contient check190 ; en bas, « Commande de build » contient start190. Node est arrêté, port3000 et Node24 sont corrects. CHECK termine sans ouvrir de listener ; START doit rester actif et appartient à la commande d’exécution. [Preuve](verification-proofs/jm190-Manager-command-inversion.json). Le précontrôle complet est acquis ; aucune nouvelle commande SSH ou migration n’est nécessaire.

## Prochaine action — correction ciblée puis démarrage

1. Ouvrir les [paramètres Node.js239143](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/h3/118579/nodejs/239143/data/advanced-settings/application), site **recette.jessiemessage.com**.
2. Dans le champ du haut **Commande d’exécution**, saisir :

```bash
bash /srv/customer/jessiemessage-private/start-primary-release190-5dda0dd4.sh
```

3. Dans le champ du bas **Commande de build**, saisir :

```bash
bash /srv/customer/jessiemessage-private/check-primary-release190-5dda0dd4.sh
```

4. Cliquer **Enregistrer**. Ouvrir le [tableau de bord](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/h3/118579/nodejs/239143/data/dashboard) et cliquer une seule fois **Run** si encore **Arrêté**. Si déjà démarré après enregistrement, ne pas relancer. Le port3000 et Node24 restent identiques.
5. Ouvrir [État du service](https://jessiemessage.com/admin/readiness) et rapporter version, commit, Node et date de démarrage réellement affichés. Cible :1.9.0/source5dda0dd4453d34a0be839d2a1402301dea835381/Nodev24.22.1.

La correction sauvegardée et le démarrage ne sont pas encore rapportés. Aucun autre diagnostic, SQL, CHECK ou installation demandé.185 reste précontrôlée jamais démarrée.

## Résultats acquis — ne pas répéter

- Sources190 et185, lanceurs et reçus préparés. [Preuve](verification-proofs/jm190-hosted-preparation.json).
- SQL38 appliquées/0 en attente ; reçu d’upgrade SHA256 `0d12dfd9ea9c9510729d39f743159a70a2457b2d999b6d334ae09043fa5d6dfb`, correspondant exactement à2 migrations appliquées/36 préservées. [Statut](verification-proofs/jm190-hosted-schema38-status.json), [reçu](verification-proofs/jm190-hosted-upgrade-confirmation.json). Aucun upgrade à relancer ;184/172 ne peuvent pas redémarrer sur38.
- CHECK185 et190 chacun `passed`, sans démarrage, journal SHA256 `6aac70a7b9626362009117094981574277cdbb8f3bde674096b067f5518b8712`. Cette empreinte correspond au reçu protocolaire attendu de182octets. [Preuve](verification-proofs/jm190-hosted-prechecks.json). Ne pas répéter ces CHECK manuellement ; le Build de Manager pourra naturellement ajouter un reçu de contrôle valide.
- Code190 qualifiéPR/main5/5 et publié latest421892314 sur source `5dda0dd4453d34a0be839d2a1402301dea835381`, arbre `f06a140e738f20994425c714a278b0646f651c1b`. Repli185 compatibleSQL38 publié non latest421892280, source `7a40de9742bdbedc5c0829d820882ca08bf23a91`, arbre `7ec449cb3a63a091c5233993923ceb69f8314366`.185 est précontrôlée sur l’hôte, jamais démarrée.

## Après identité190 concordante — métadonnées seules

Le writer final est déjà épinglé aux reçus réels et à la release421892314, qualifié **9/9** sous Nodev24.22.1 par le [run39972263974](https://github.com/fredbuhr/jessiemessage/actions/runs/39972263974), tentative1. Opérateur `8690a8255e1297f288f7eae8ab25811bf63d2262`, SHA256 `40cc11b177de7199d07b7552d440fcf7990a0f8e5e334c885ef8fca93c7d93b8`. [Preuve native](verification-proofs/jm190/writer-final-native.json).

Après l’identité190 réelle, la consigne fournira ce writer immuable. Il contrôlera les sources, reçus, journaux, HTTP publics et publication avant d’actualiser les seules métadonnées du checkpoint. Les historiques184/183/182/181/180/171/160 et autres blocs restent préservés ;185 sera consignée comme précontrôlée jamais démarrée. Aucune écriture190 sur l’hôte n’a encore été rapportée.

Le dernier checkpoint confirmé reste184, SHA256 `3b1781bebf857c465fce429b5160d7432f1e9afa98e0c2a983784bcc3127a212` ; ce bloc historique ne décrit plus le schéma courant38.

Chaque étape dépend de la preuve de la précédente. Les anciennes commandes de préparation, migration et CHECK sont historiques et disponibles dans Git ; elles ne sont plus des actions courantes. Aucun nouvel essai de sauvegarde reportée, compte réel, message, notification, suppression ou infrastructure n’est ouvert par cette mise en service. Téléphone physique et fonctionnalités190 en production restent non vérifiés.
