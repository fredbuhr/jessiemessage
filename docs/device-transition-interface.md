# Page de reprise — préparation du confort d’affichage en 0.37

**État : en préparation, non livré.** Le propriétaire confirme à **17:28 Europe/Paris le 17 octobre 2026** que le fonctionnement de l’étape 0.37 est bon. La capture fournie ensuite permet de préciser un défaut d’interface sur la page de reprise. Ce retour ne détaille ni six à huit appareils simultanés, ni toutes les plateformes, ni un nouveau scénario Push précis : ces acceptations ne sont pas déduites de cette confirmation.

## Défauts constatés

Lorsque la connexion précédente est absente, le lien de connexion apparaît contre **Réessayer**, sans espacement entre les deux actions (`gap: 0`). La hiérarchie garde la nouvelle tentative au premier plan alors que la connexion est l’action utile. La palette s’écarte aussi de celle de l’entrée de l’application.

Le texte historique de conflit laisse entendre qu’un choix de compte serait proposé par le retour à l’espace. Le parcours existant ne fournit pas ce choix : le message doit inviter à revenir au compte déjà ouvert, sans promettre une commande absente.

## Ajustement retenu

- Regrouper les actions dans une grille avec un espacement de **12 px**.
- Placer le lien de connexion en premier dans le DOM. Lorsqu’il apparaît, lui donner la présentation principale et présenter **Réessayer** en action secondaire par CSS, sans réorganisation visuelle avec `order`.
- Garder l’en-tête et sa bascule de langue dans le flux avec une disposition flex, puis reprendre la palette de la page d’entrée.
- Nommer l’action de connexion **Me connecter** / **Sign in** et expliquer simplement qu’une connexion est nécessaire une fois lorsque celle de l’appareil n’est plus disponible.
- En cas de conflit, inviter à revenir au compte déjà ouvert. Ne pas laisser croire que la reprise remplace ce compte ou propose un sélecteur.

Le correctif reste limité à la présentation et aux textes. Il ne change ni le protocole de reprise, ni les fragments d’URL, ni les sessions, clés ou schéma. La transmission du choix de langue entre les deux origines reste un sujet distinct ; elle n’est pas corrigée dans ce lot.

## Vérification prévue

Des contrôles Chrome de géométrie sont en préparation en français et en anglais, aux largeurs **320, 360, 390 et 635 px** : espacement des actions, ordre du DOM, hiérarchie lorsque la connexion devient visible et absence de chevauchement de l’en-tête. Aucun résultat de ces tests ni déploiement de ce correctif n’est encore annoncé.

La [recette des appareils](notifications-device-acceptance.md) et le [compte rendu de bascule](primary-origin-cutover.md) conservent séparément les preuves de fonctionnement, les validations réelles et leurs limites.
