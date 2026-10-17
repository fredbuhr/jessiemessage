# Lot 0.38 — conserver la langue pendant la reprise

**Lot 0.38 livré le 17 octobre 2026 à 18:03 Europe/Paris.** Runtime `4433309f09f0eb6bd2a4f498d32394d0d39b5cb2`, arbre `b8f82034b61c1837552c2d50c7749475453a1909`, déploiement `primary-transition`, profil `messaging-photos-notify`, schéma 30. [PR brouillon #53](https://github.com/fredbuhr/jessiemessage/pull/53) ; [CI exacte, cinq jobs réussis](https://github.com/fredbuhr/jessiemessage/actions/runs/39047525163). Le correctif d’espacement 0.37 est conservé.

Le défaut est reproduit avant correction sur le service réel : le choix anglais de `/app` conduit encore à un pont en français. Le contrôleur ignorait le module de préférence partagé déjà utilisé par les autres pages.

**Runtime courant :** le lot 0.39 `b651d44e`, activé à 18:28, conserve cette correction et ajoute la [récupération client sur l’adresse principale](client-recovery-activation.md). Les résultats ci-dessous restent les preuves datées de livraison du lot 0.38.

## Choix retenus

La page de reprise charge et réutilise `i18n.js`, avec ses opérations existantes `getLanguage`, `setLanguage` et `onChange`, au lieu de maintenir une préférence indépendante. Les titres de page suivent aussi le français ou l’anglais. Le module partagé n’est pas modifié.

La préférence courante accompagne seulement les fragments fermés de reprise : challenge, ticket et indication de notification/locale. Le contexte, le rôle et le sens du passage entre les deux origines doivent être valides avant d’appliquer la préférence reçue. Le fragment est effacé avant tout travail asynchrone. La dernière langue choisie pendant une requête reste prioritaire sur une préférence antérieure transportée par celle-ci. Les anciennes variantes sans locale restent acceptées.

La destination authentifiée renvoyée par le serveur reste prioritaire sur les indications de fragment. Sa validation exige la chaîne complète, y compris le refus d’un saut de ligne final ; aucun chemin arbitraire ne peut être ajouté au parcours.

## Revenir à la connexion depuis recette

Lorsqu’une session manque, **Me connecter** peut quitter recette avec un seul intent primaire fermé :

```text
#signin=fr|en[&notification=<32 caractères hexadécimaux minuscules>]
```

La page de reprise sur l’apex valide cet intent, enregistre la préférence sur cette origine puis rejoint `/access` ou `/admin/login` selon le rôle fixe de sa propre route. Une référence de notification valide est conservée uniquement sous la forme canonique `#notification=…`.

Cet intent ne lance aucun `begin`, `authorize` ou `complete` : il conduit à la connexion normale. Il n’existe pas de paramètre `next` libre. Le lot ne modifie ni `NotificationLink`, ni les contrôleurs de connexion ou de chat, ni le module de langue partagé.

## Périmètre et vérification

Aucun payload API, cookie de session, session serveur, table SQL, clé ou abonnement Push n’est changé. Si le stockage de préférence est indisponible, l’interface reste utilisable et le passage prévu peut transporter sa langue ; la persistance du choix sur les pages ordinaires suivantes n’est alors pas garantie.

Les **96 tests contrôleur/HTTP** passent, dont 86 du contrôleur avec le vrai runtime de langue. Les treize tests du service restent conformes. Localement, la suite générale compte **2 153 cas : 2 010 réussis, 143 intégrations ignorées sans leurs moteurs, aucun échec**. Syntaxe et build du workbench réussissent. ChromeDriver étant absent localement, les tests navigateur sont exécutés en CI.

| Job CI de la révision exacte | Résultat |
| --- | --- |
| Vérification générale | 2 126 réussis, 27 wrappers SQL ignorés sur 2 153 ; aucun échec, syntaxe/build réussis |
| Chrome applicatif | 58/58, aucun saut |
| Authentification Chrome/HTTPS/MariaDB | 1/1, aucun saut |
| MariaDB 10.11 | 370/370, aucun saut |
| MariaDB 11.4 | 370/370, aucun saut |

Les régressions couvrent anciennes variantes, langues opposées entre origines, priorité d’un choix pendant les trois étapes et après erreur, formats fermés/valeurs encodées/doublons refusés, stockage bloqué, intent sans API et référence serveur prioritaire sur un hint altéré. Les sorties avec LF final sont refusées. La fixture Chrome charge les vrais modules de traduction et vérifie une destination réellement traduite, en plus des cookies natifs ; cette destination reste une page synthétique, distincte du contrôle hébergé du vrai login.

## Livraison et contrôle réel

Le checkout distinct `/srv/customer/jessiemessage-operator/device-transition-language-4433309f` passe son préflight à **18:01:15**, sans listener supplémentaire. Le lanceur privé exclusif `0700` `/srv/customer/jessiemessage-private/start-primary-transition-language-4433309f.sh` est créé et vérifié à **18:01:47.061370** ; SHA-256 `65d833c49731822426437f2e73099fc6e89947814ebf9a3ec2602777930fb581`. Il épingle révision, arbre et checkout propre. Run/Build sont enregistrés et le build/redémarrage Manager réussit à **18:03**, sur le même service et les mêmes données.

À **18:04:25.741575**, **52/52 contrôles** passent : 48 requêtes HTTPS avec résolution normale et TLS vérifié, quatre contrôles Host loopback. Les **24 empreintes exactes** comprennent dix fichiers statiques par origine, dont `i18n.js`, et les deux pages HTML de reprise par origine. Entrées, disponibilité, refus anonymes/cross-origin, fermeture des fichiers privés et canonicalisation `www` restent conformes. Aucun compte connecté, e-mail ou Push réel n’est utilisé par ce lot anonyme.

Le navigateur reprend ensuite l’anglais précédemment choisi sur `/app` dans le vrai pont primaire, titre compris. Après **Find my space**, le pont recette reste en anglais et son fragment est effacé. Le choix **FR** sur recette met à jour le lien **Me connecter** ; celui-ci conduit automatiquement à la vraie page `/admin/login` primaire en français, avec titre et libellés français et fragment effacé. Aucun identifiant, mot de passe ou code n’est saisi. Ce contrôle vérifie la continuité de l’interface ; le retour global du propriétaire sur son parcours reste celui de 17:28.

Le repli direct conserve `0c88f61b` et son lanceur, compatibles avec les deux origines et le schéma 30. Il perd la continuité de langue mais conserve la correction de reprise après coupure et l’affichage 0.37. Comme pour tout redémarrage du pont, les paquets en mémoire en cours sont invalidés ; reprendre depuis `/app` après un repli. Aucun retour SQL, clé ou DNS n’est nécessaire.

À la livraison 0.38, le [plan de récupération client 0.39](client-recovery-readiness.md) était une préparation future. Le lot est ensuite activé à 18:28 et son parcours essayé accepté par le propriétaire à 18:52:47 ; voir le [compte rendu courant et sa portée](client-recovery-activation.md).
