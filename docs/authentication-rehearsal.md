# Recette intégrée de l’authentification — étape 0.22

Version applicative 0.24.0, branche `feat/authentication-rehearsal`, construite sur le diagnostic opérateur 0.23.0 / PR #24. Le résultat automatique de référence est celui de la CI associée au SHA exact de cette branche.

Cette étape exerce l’interface administrateur servie par l’application, le service d’authentification et ses transactions SQL depuis un vrai Chrome. Elle utilise uniquement des identités fictives. Aucun compte Infomaniak n’a été consulté ; l’existence et la configuration d’une préproduction séparée restent inconnues. Aucun compte réel, envoi e-mail ou déploiement n’est effectué.

## Environnement d’essai

Le job `Chrome HTTPS authentication with MariaDB` dispose de MariaDB 10.11, Node.js 24 et des binaires Chrome/ChromeDriver du runner Ubuntu 24.04. Il démarre le vrai `createConfiguredServer` en authentification seule, derrière un proxy HTTPS lié à la boucle locale. La clé MFA, le mot de passe, le secret TOTP et les codes de secours appartiennent à un administrateur synthétique créé pour cet exercice.

Le certificat TLS auto-signé est généré pour cet essai. L’option Chrome d’acceptation de ce certificat est limitée au nouveau scénario HTTPS. Cela permet d’exercer les cookies natifs `Secure` et `HttpOnly`, mais ne valide ni une autorité de certification publique ni le proxy Infomaniak. Le code de production conserve ses contrôles HTTPS, Origin, MFA et CSRF.

Accès client, chat, médias, CRM, récupération client, diffusions et livraison e-mail sont explicitement désactivés. Aucun transport SMTP n’est initialisé. Le service de messagerie reste indisponible : un administrateur connecté ne transforme pas `/api/ready` en validation de publication.

## Exécution et limites des données

La commande dédiée est :

```sh
npm run test:auth-browser
```

Elle exige Chrome, ChromeDriver, OpenSSL et une configuration de base **jetable, vide au départ et liée à la boucle locale**. Elle échoue si les prérequis manquent ; elle n’annonce pas une réussite en sautant les essais. Le job CI fournit sa propre base et ses comptes. Les identifiants publics de ce service CI sont exclusivement des fixtures, jamais des paramètres de déploiement.

La fixture refuse une exécution sans `JESSIEMESSAGE_DB_TEST=1`, une cible non locale, un nom hors du préfixe de test, des confirmations de cible incohérentes ou un compte runtime identique au compte de migration. Elle refuse également toute table préexistante avant de créer le schéma de l’exercice. Le compte runtime est limité au DML ; les migrations utilisent un compte séparé.

Ce scénario **écrit et supprime des données de test**. Il applique les migrations à sa base vide, initialise l’administrateur fictif, crée/consomme/révoque des sessions et codes de secours, puis retire les tables de l’exercice. Ne jamais le lancer sur une base à conserver, même nommée « test », ni comme sonde de l’hébergement. Les commandes [preflight](preproduction-preflight.md) restent la voie de diagnostic sans migration.

Les journaux et artefacts publics ne doivent pas contenir les secrets générés, les cookies, les corps de réponses privés ou des dumps. Le job n’exporte aucune capture, aucun profil Chrome ni fichier de configuration TLS/MFA. Seuls les trois fichiers déjà autorisés de l’aperçu fictif restent publiés par le job de build.

## Ce que la preuve automatique peut établir

Les scénarios couvrent les refus de connexion, l’authentification à deux facteurs, les propriétés et l’invisibilité JavaScript du cookie, l’accès administrateur authentifié et la fermeture de session. Les contrôles de rejeu et d’expiration utilisent les mêmes services et tables SQL ; les résultats détaillés sont consignés dans le journal du job.

Le job Chrome historique conserve ses trois scénarios de chat avec API synthétiques. Leurs outils WebDriver sont partagés avec la nouvelle recette. Les 23 groupes SQL restent séparés et exécutés sur MariaDB 10.11 et 11.4. La nouvelle recette Chrome/SQL ne s’exécute que sur MariaDB 10.11.

Cette preuve ne certifie pas Safari, Firefox, les téléphones, les lecteurs d’écran, l’installation PWA, les sorties SMTP, le processus de majorité, la charge, la restauration ou les ressources réellement attribuées par l’hébergeur. Les transactions d’authentification modifient légitimement la base jetable ; il ne s’agit pas d’un contrôle en lecture seule.

## Reprendre la validation Infomaniak

La prochaine vérification sur le compte consiste à relever, dans le Manager et sans modifier les services, les éléments suivants :

| Élément à relever | Utilité |
| --- | --- |
| Site ou projet Node.js attribué à JessieMessage | Identifier l’environnement existant et son domaine |
| Existence d’un sous-domaine de recette distinct | Éviter d’utiliser le domaine public pour l’exercice |
| Version Node, commande de démarrage et port fournis | Comparer l’environnement au contrat de l’application |
| Base dédiée, version MariaDB, TLS et séparation des comptes | Préparer la configuration privée sans réutiliser des données réelles |
| Emplacement privé persistant et possibilités de redémarrage | Préparer ensuite les essais de stockage et d’arrêt |

Les noms de services et leur état suffisent pour cet inventaire ; aucun mot de passe, clé MFA, cookie ou code de secours ne doit être partagé dans la discussion. La création d’un environnement, les migrations et l’initialisation administrateur sont des opérations ultérieures, distinctes de ce relevé.

Une fois l’environnement isolé établi, suivre les [diagnostics opérateur](preproduction-preflight.md), puis la [recette de préproduction](preproduction-acceptance.md) et l’[initialisation administrateur](auth-admin.md). Conserver `contact@jessiemessage.com` comme adresse officielle ; les identités de CI ne doivent jamais devenir celles du compte réel. Les essais sur l’hébergement devront consigner leur propre SHA, navigateur, résultats et limites.
