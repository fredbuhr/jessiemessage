# Évolution 2 — Profil et expressions, cible 1.2.0

**20 octobre 2026 — candidat codé, qualification CI en attente, non livré.** L’[état courant](REPRISE.md) distingue la production des candidats et consigne les références opérateur. Ce bilan décrit le périmètre et les critères de livraison du lot ; les preuves propres à son commit seront ajoutées après observation.

## Périmètre

- **Mon profil**, côté client et administration : pseudonyme public de 64 caractères maximum et avatar, visibles dans les échanges authentifiés. Le nom public reste distinct du surnom privé CRM. E-mail, mot de passe et notes privées conservent leurs parcours existants.
- **Avatar** : aperçu rond, choix/remplacement/retrait puis enregistrement explicite. Le navigateur réutilise la préparation d’image existante et recadre le centre en JPEG carré de 256 pixels. L’asset passe par le stockage média privé existant ; le serveur contrôle l’appartenance et les limites avant de l’attacher au profil. L’upload ne crée aucun message. Si les médias sont désactivés, l’édition du nom reste possible.
- **Modifications simultanées** : version du profil contrôlée à l’enregistrement ; un conflit garde le brouillon et propose de recharger le profil enregistré ou de garder son brouillon avant une nouvelle confirmation. Fermer, masquer la page ou perdre le contexte du compte interrompt les opérations et libère les aperçus ; aucun profil n’est persisté dans le stockage local du navigateur.
- **Expressions** : catalogue de **180 emojis Unicode**, organisé par catégories, avec recherche en français et anglais. Un choix s’insère dans le brouillon du message ; l’utilisateur confirme toujours l’envoi. Aucun sticker graphique ni média supplémentaire n’est créé.

Le service Node et l’hébergement mutualisé sont conservés ; aucune dépendance ni infrastructure nouvelle. Annonces, vidéo, alertes de rappels et diffusion à grande échelle restent des évolutions distinctes.

## Migration et repli

Les profils nécessitent la migration **`0031`**. La compatibilité de l’ancien code avec le schéma étendu doit être qualifiée avant de toucher la production : le repli visé est **1.1.1**, distinct de la 1.1.0 actuellement livrée. La [PR 111](https://github.com/fredbuhr/jessiemessage/pull/111) prépare ce correctif ; son résultat CI et sa livraison ne sont pas présumés acquis.

1. Qualifier le passage du schéma 30 au schéma 31 et le fonctionnement de la 1.1.1 sur le schéma 31, y compris les contrôles d’exploitation concernés. Figer le commit et la release validés, préparer et vérifier leurs pins de repli.
2. Terminer la CI du lot 1.2.0 : tests métier et interface, MariaDB 10.11/11.4, Chrome et parcours HTTPS, sur des données synthétiques isolées. Publier le tag/release sur le commit exact validé.
3. Épingler ensuite les commandes de préparation et de migration, avec l’identité SQL de migration existante et une phase de maintenance maîtrisée. Aucune migration n’est exécutée au démarrage de l’application. Ces commandes restent à préparer après les validations ; ce bilan n’en fournit pas de version partielle.
4. Après la migration contrôlée, activer le commit 1.2.0 validé, vérifier l’identité fraîche dans l’administration et les contrôles adaptés, puis aligner REPRISE et le checkpoint en conservant le repli compatible et les autres blocs.

**Après application de `0031`, ne pas revenir au code 1.1.0.** Le repli applicatif prévu est la **1.1.1 préqualifiée sur ce schéma**. Un repli de code ne retire pas la migration et n’implique aucune restauration SQL automatique. Avant toute migration, les références de production et de repli existantes restent celles de REPRISE.

## Validation et limites

Les contrôles ciblés couvrent les requêtes du profil, les conflits de version, le maintien des brouillons, les réponses ou aperçus devenus obsolètes, le nettoyage des URL et l’accès clavier. Le catalogue est borné et son insertion n’envoie pas le message. Les contrôles intercomptes et la persistance réelle doivent être confirmés par les tests SQL et les parcours navigateur du lot.

Les résultats CI de compatibilité et de la 1.2.0 restent à consigner ; un test local ou ignoré ne vaut pas qualification MariaDB ou Chrome native. Aucun appareil physique, campagne réelle ou capacité de charge nouvelle n’est revendiqué. Les preuves de la 1.1.0, les clés, les sauvegardes/PC et les états D1 restent préservés.
