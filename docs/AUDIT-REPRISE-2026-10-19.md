# Audit et reprise JessieMessage — 19 octobre 2026

## Point d’arrêt retrouvé

La discussion « Audit et reprise JessieMessage » s’est arrêtée à **l’étape 4/6**, après la fusion de la PR #83, logiciel 0.67. Le dernier commit documentaire est `6b6cac2f7107b3237b71de8293e5938af316dc85`, publié le 19 octobre à 00:45:24 UTC. Le code 0.67 provient de `745a4beb`, arbre `cdd92048`, fusion `cbf378b1` ; le protocole 0.66 et le transport/kit Windows 0.67 sont dans `main` mais ne sont pas activés.

La source complète a été récupérée depuis `fredbuhr/jessiemessage`, sans modification locale préexistante. Contrairement au relevé historique du 18 octobre, `main` contient maintenant l’application complète. Les anciennes PR empilées encore ouvertes ne sont pas une raison de réappliquer ces modifications ou de repartir d’une ancienne branche.

La recherche de conversations a échoué deux fois. Le point d’arrêt n’est donc pas présenté comme une relecture intégrale du fil : il est établi par `docs/REPRISE.md`, les commits, les preuves versionnées et les observations actuelles de l’hébergement.

## Service et sauvegardes vérifiés

Le terminal Infomaniak existant est accessible. Le checkout actif reste **0.65**, `f53d6982d0fd54e50fe7af43e1d08a5758553703`, arbre `51717124bf15df3845a97e4f675c8549d59715c2`, sans modification Git. L’empreinte du lanceur reste exactement `8ac14501e02220a50bf004cabb3c9fa2ca260f0d90d4bd98b5cc73b8fc1169c3`. Aucun changement du Manager ou redémarrage pendant cet audit.

À **10:57:23 UTC**, le contrôle de fraîcheur est `current / OK`, dernière tentative réussie, et les sondes HTTPS santé/disponibilité sont saines. À **10:59:24.266 UTC**, quatre archives sont présentes, horaire conservé **05:15 UTC**. L’archive courante du matin et le reçu du PC concordent par identifiant, taille et SHA-256 ; le PC reste activé et apparié. Cela prouve la copie courante, sans prétendre que le PC est connecté à l’instant de la lecture. Le déchiffrement personnel courant reste `not_checked`.

Aucun journal d’effacement ni marqueur de restauration n’est présent dans les opérations au relevé. Aucune fermeture réelle n’est activée. Les configurations, comptes, sessions et clés existantes sont conservés. Aucun message, courriel, Push ou campagne de test réel n’est envoyé.

Les vérifications HTTPS complémentaires comparent les ressources servies à celles du checkout 0.65 sur les deux origines et vérifient les frontières anonymes. Le parcours `/admin/messages` redirige **303 vers `/admin/login`**, conformément au confort livré en 0.57 ; les API privées restent 401, les fichiers serveur/configuration 404. Un premier script de contrôle attendait encore 401 pour cette page et refusait les redirections ; cet outil d’audit a été corrigé, sans modification de l’application.

## Validation du code repris

Les cinq jobs de la CI de `main` 0.67, run `39181920393`, sont relus via l’API et réussis. Les preuves exactes 0.67 restent dans `docs/verification-proofs/jm067-verification.json` ; elles ne valent pas activation du témoin sur le PC personnel.

Le build local initial vérifie 504 sources et réussit. La suite initiale comporte **2 692 cas : 2 504 réussites, un échec et 187 ignorés**. L’échec concerne le délai de 80 ms d’un enfant coopératif dans le banc `managed-runtime`, sous charge. Le fichier isolé passe **23/23**. Le banc est corrigé à 400 ms pour l’arrêt coopératif, tout en conservant 80 ms dans le scénario d’arrêt forcé ; le code de production n’est pas changé.

Le lot de continuation **0.68** ajoute le [contrat d’origine authentifié](witness-genesis-068.md), hors du runtime courant. Après les changements, **2 710 cas locaux : 2 521 réussites, aucun échec, 189 ignorés** ; le build réussit avec 506 sources. Les intégrations SQL et les contrôles natifs indisponibles localement restent comptés comme ignorés. Les nouveaux contrôles exigent leur exécution native en Linux CI ; aucune réussite native locale n’est inventée.

## Reprise de l’implémentation

Le prochain bloc connu était la genèse contrôlée du témoin, son raccordement au parent et la réconciliation de restauration. La première partie est préparée dans ce lot : contrat immuable authentifié, identité originale du dossier et capacité exacte du PC, publication exclusive sous verrou, absence de recréation automatique. Il n’est connecté à aucune route ou commande de production.

Restent le raccordement opérateur de cette provenance, l’initialisation personnelle explicite et authentifiée, l’aller-retour indépendant réel, la politique de démarrage avec PC éteint et la réconciliation source/cible. Déchiffrement personnel courant, inspection SQL qualifiée et import natif isolé courant demeurent distincts et non confirmés. Les étapes 5/6 (surveillance externe fiable) et 6/6 (recette finale ciblée) restent ensuite à terminer.

Le point d’entrée courant reste `docs/REPRISE.md`. Ne pas demander à nouveau les choix Jessie/France, les mails déjà acceptés, un nouvel appariement ou une exportation de clé privée. Ne pas déployer les logiciels 0.66–0.68 comme si la continuité indépendante était déjà acquise.
