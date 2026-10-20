# Évolution 2 — Profil et expressions, 1.2.0

**21 octobre 2026 — code fusionné, qualifié et publié en 1.2.0 ; staging et contrôle SQL confirmés, migration et activation Infomaniak en attente.** L’[état courant](REPRISE.md) distingue la production des candidats et consigne les références opérateur. Ce bilan décrit le périmètre et les critères de livraison du lot ; les preuves de son commit sont consignées ci-dessous.

## Périmètre

- **Mon profil**, côté client et administration : pseudonyme public de 64 caractères maximum et avatar, visibles dans les échanges authentifiés. Le nom public reste distinct du surnom privé CRM. E-mail, mot de passe et notes privées conservent leurs parcours existants.
- **Avatar** : aperçu rond, choix/remplacement/retrait puis enregistrement explicite. Le navigateur réutilise la préparation d’image existante et recadre le centre en JPEG carré de 256 pixels. L’asset passe par le stockage média privé existant ; le serveur contrôle l’appartenance et les limites avant de l’attacher au profil. L’upload ne crée aucun message. Si les médias sont désactivés, l’édition du nom reste possible.
- **Modifications simultanées** : version du profil contrôlée à l’enregistrement ; un conflit garde le brouillon et propose de recharger le profil enregistré ou de garder son brouillon avant une nouvelle confirmation. Fermer, masquer la page ou perdre le contexte du compte interrompt les opérations et libère les aperçus ; aucun profil n’est persisté dans le stockage local du navigateur.
- **Expressions** : catalogue de **180 emojis Unicode**, organisé par catégories, avec recherche en français et anglais. Un choix s’insère dans le brouillon du message ; l’utilisateur confirme toujours l’envoi. Aucun sticker graphique ni média supplémentaire n’est créé.

Le service Node et l’hébergement mutualisé sont conservés ; aucune dépendance ni infrastructure nouvelle. Annonces, vidéo, alertes de rappels et diffusion à grande échelle restent des évolutions distinctes.

## Migration et repli

Les profils nécessitent la migration **`0031`**. La compatibilité de l’ancien code avec le schéma étendu doit être qualifiée avant de toucher la production : le repli visé est **1.1.1**, distinct de la 1.1.0 actuellement livrée. La [release 1.1.1](https://github.com/fredbuhr/jessiemessage/releases/tag/v1.1.1) est publiée sur `cfa7dd3559e51c0fdc63ccc6fbc78d98609b947a`, après CI complète du commit exact. Le [bilan de compatibilité](profile-schema-111.md) conserve sa portée ; la préparation du repli est confirmée par reçu utilisateur, sans précontrôle ni démarrage.

1. **Réalisé en qualification synthétique** : passage 30→31 et fonctionnement de la 1.1.1 sur le schéma 31, y compris les contrôles d’exploitation concernés ; commit et release figés. Préparation hébergée confirmée ; précontrôle après migration encore à faire.
2. **Réalisé** : [PR 112](https://github.com/fredbuhr/jessiemessage/pull/112), [CI main exacte 5/5](https://github.com/fredbuhr/jessiemessage/actions/runs/39500108614), puis [tag/release 1.2.0](https://github.com/fredbuhr/jessiemessage/releases/tag/v1.2.0) sur `763b632185ce13eb875110c9107687b2d278ff67`, arbre `c7dce7bcdb99b298ffc43c9e31dd22ee87453926`.
3. **Préparation et contrôle SQL réalisés** : staging confirmé sans migration ni redémarrage ; reçu `checked`, moteur/TLS vérifiés, 31 migrations prévues, 30 appliquées, une en attente, aucun état interrompu. Le helper de migration et précontrôles est épinglé et qualifié ; [état et commande après arrêt Manager](REPRISE.md#migration-0031-et-précontrôles--à-exécuter-après-arrêt-manager). L’arrêt Manager, la migration 0031 et les deux précontrôles ne sont pas encore rapportés. Aucune migration n’est exécutée au démarrage de l’application.
4. Après la migration contrôlée, activer le commit 1.2.0 validé, vérifier l’identité fraîche dans l’administration et les contrôles adaptés, puis aligner REPRISE et le checkpoint en conservant le repli compatible et les autres blocs.

**Après application de `0031`, ne pas revenir au code 1.1.0 ni 1.0.0.** Le repli applicatif prévu est la **1.1.1 préqualifiée sur ce schéma**. Un repli de code ne retire pas la migration et n’implique aucune restauration SQL automatique. Avant toute migration, les références de production et de repli existantes restent celles de REPRISE.

## Validation et limites

Les contrôles ciblés couvrent les requêtes du profil, les conflits de version, le maintien des brouillons, les réponses ou aperçus devenus obsolètes, le nettoyage des URL et l’accès clavier. Le catalogue est borné et son insertion n’envoie pas le message. La persistance réelle et les contrôles intercomptes sont confirmés par les tests SQL et le nouveau parcours HTTPS/Chrome ; le retrait invalide les anciennes URLs sans supprimer l’asset propre.

Les CI de PR et du commit exact livré réussissent 5/5 : général 3 177 réussis/36 ignorés/0 échec ; MariaDB 10.11 et 11.4 : 479/479 chacune sans omission ; Chrome 168/168 ; HTTPS/MariaDB 3/3 ; syntaxe/build 583 sources. La publication vérifiée du tag immuable est le [run 39500847054](https://github.com/fredbuhr/jessiemessage/actions/runs/39500847054). Un test local ou ignoré ne vaut pas qualification native ; ces résultats ne prouvent pas une activation hébergée. Aucun appareil physique, campagne réelle ou capacité de charge nouvelle n’est revendiqué. Les preuves de la 1.1.0, les clés, les sauvegardes/PC et les états D1 restent préservés.
