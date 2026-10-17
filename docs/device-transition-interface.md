# Page de reprise — actions distinctes et claires en 0.37

**Correctif livré le 17 octobre 2026 à 17:38 Europe/Paris.** Runtime `0c88f61bf6b0a9bcf45917862462db838bf73c78`, arbre `7df1c850d84597be96f458a69ca9955f8e6c257a`, déploiement `primary-transition`, schéma 30. [PR brouillon #52](https://github.com/fredbuhr/jessiemessage/pull/52) ; [CI exacte, cinq jobs réussis](https://github.com/fredbuhr/jessiemessage/actions/runs/39045662415).

La preuve ci-dessus décrit la livraison 0.37. Le runtime courant `4433309f`, activé en 0.38 à 18:03, conserve ces corrections et ajoute la [continuité de langue](device-transition-language.md).

Le propriétaire confirme à **17:28** que le parcours proposé fonctionne, puis fournit une capture exploitable du défaut d’interface. Le retour global est accepté ; il ne détaille ni six à huit appareils simultanés, ni toutes les plateformes, ni un scénario Push précis. La recette conserve ces distinctions sans imposer de répéter le parcours satisfaisant.

## Défauts constatés

Lorsque la connexion précédente est absente, le lien de connexion apparaissait contre **Réessayer**, sans espacement entre les deux actions. L’ancien runtime est reproduit dans Chrome vers **17:33** : écart mesuré **0 px**, hauteurs 48 et 50 px. La hiérarchie gardait la nouvelle tentative au premier plan alors que la connexion était l’action utile. La palette s’écartait aussi de celle de l’entrée de l’application.

Le texte historique de conflit laissait entendre qu’un choix de compte serait proposé par le retour à l’espace. Le parcours existant ne fournit pas ce choix : le message invite désormais à revenir au compte déjà ouvert.

## Correction livrée

- Regrouper les actions dans une grille avec un espacement de **12 px**.
- Placer le lien de connexion en premier dans le DOM. Lorsqu’il apparaît, lui donner la présentation principale et présenter **Réessayer** en action secondaire par CSS, sans réorganisation visuelle avec `order`.
- Garder l’en-tête et sa bascule de langue dans le flux avec une disposition flex, puis reprendre la palette de la page d’entrée.
- Nommer l’action de connexion **Me connecter** / **Sign in** et expliquer simplement qu’une connexion est nécessaire une fois lorsque celle de l’appareil n’est plus disponible.
- En cas de conflit, inviter à revenir au compte déjà ouvert. Ne pas laisser croire que la reprise remplace ce compte ou propose un sélecteur.

Le correctif reste limité à la présentation et aux textes. Il ne change ni le protocole de reprise, ni les fragments d’URL, ni les sessions, clés ou schéma. La transmission du choix de langue entre les deux origines reste un sujet distinct ; elle n’est pas corrigée dans ce lot.

## Vérifications

Les **59 tests ciblés** passent sans saut. Localement, la suite générale compte **2 103 cas : 1 960 réussis, 143 intégrations ignorées sans leurs moteurs, aucun échec** ; syntaxe et workbench réussis. ChromeDriver étant absent localement, les essais navigateur sont exécutés en CI, sans installation supplémentaire.

La révision exacte passe ses cinq jobs : **2 076 réussites et 27 wrappers SQL ignorés** dans le job général, **53/53 tests Chrome**, **1/1 authentification Chrome/HTTPS/MariaDB**, **370/370 sur chacune des MariaDB 10.11 et 11.4**. Aucun échec. Le nouveau scénario représente **24 contextes et 48 mesures FR/EN** : état initial, préparation, indisponibilité, connexion client absente, connexion administrateur absente et conflit, aux largeurs **320, 360, 390 et 635 px**. Il vérifie absence de débordement horizontal, cibles d’au moins 44 px, écart d’au moins 12 px, ordre DOM et Tab, focus visible, couleurs distinctes des actions et en-tête sans chevauchement. Le défilement vertical reste autorisé lorsque le contenu le nécessite. L’assertion d’espacement échouerait sur le défaut mesuré avant correction.

Le checkout distinct `/srv/customer/jessiemessage-operator/device-transition-ui-0c88f61b` passe son préflight à **17:35:13**, sans listener supplémentaire. Le lanceur privé `0700` `/srv/customer/jessiemessage-private/start-primary-transition-ui-0c88f61b.sh` est créé exclusivement et vérifié à **17:35:42.068922** ; SHA-256 `01721dd4ea63db50ef269138cee9098047ffb57e4b5c57a7763c16edbd761787`. Il épingle SHA, arbre et checkout propre. Le Manager enregistre les commandes épinglées puis construit et redémarre le service existant à **17:38**.

À **17:38:47.078215**, **50/50 contrôles hébergés** passent : 46 requêtes HTTPS avec résolution normale et TLS vérifié, plus quatre contrôles Host loopback. Les **22 comparaisons d’empreintes** comprennent neuf fichiers statiques par origine et les deux pages HTML de reprise par origine, après substitution des origines fixes. L’entrée, les refus anonymes/cross-origin, les fichiers privés fermés et les redirections `www` restent conformes. Aucun compte connecté, e-mail ou Push réel n’est utilisé par ce lot.

Vers **17:40**, le même état que la capture est vérifié dans le navigateur sur le service en ligne : **Me connecter** précède **Réessayer**, écart **12 px**, deux hauteurs **52 px**, couleurs primaire/secondaire distinctes, aucun chevauchement de l’en-tête et largeur de page égale au viewport de 1 363 px. Cette preuve d’interface anonyme ne remplace pas le retour du propriétaire et n’étend pas sa portée à tous les appareils.

Le repli direct privilégié est `3e952101`, dont le checkout et le lanceur sont conservés. Il maintient les deux origines et la correction de reprise après coupure, en perdant seulement cette présentation et ces textes. Aucun repli DNS ou SQL n’est nécessaire pour ce retour de code.

La [recette des appareils](notifications-device-acceptance.md) et le [compte rendu de bascule](primary-origin-cutover.md) conservent séparément les preuves de fonctionnement, les validations réelles et leurs limites.
