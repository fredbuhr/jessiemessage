# Prérequis runtime hébergés — suite de l’étape 0.25

Relevé du **15 octobre 2026**, après les [27 migrations hébergées vérifiées](hosted-database-preparation.md). L’application reste en **0.24.0**, avec le processus HTTP à `55fb30aa` et les huit fonctions privées désactivées. Le présent lot n’active aucun service, ne crée aucun compte réel et ne change aucune permission fournisseur.

## Observations et inconnues

| Sujet | Observation | Suite nécessaire |
| --- | --- | --- |
| Permissions SQL du Manager | L’édition du compte présente trois profils par base : lecture, écriture et administration. Aucun réglage individuel ou par table n’apparaît dans cet écran. | Établir une procédure de droits fins, sans utiliser le compte de migration pour HTTP. L’absence de réglage visible ne prouve pas l’impossibilité d’une intervention du fournisseur. |
| Profil écriture | La [FAQ officielle 1981](https://www.infomaniak.com/fr/support/faq/1981/gerer-les-utilisateurs-et-bases-de-donnees-mysqlmariadb), consultée ce jour, inclut les tables temporaires et `LOCK TABLES` dans ce profil. | Un simple profil lecture/écriture ne répond pas à notre séparation : mutations sur les seules tables applicatives, registre des migrations en lecture seule et aucun DDL. Les grants réels du futur runtime restent à relever. |
| Réglages Node.js | Les écrans Général et Node.js présentent le dossier, les commandes build/start, le port et la version. Aucun champ distinct de secrets n’a été trouvé dans ces écrans. La [FAQ 2535](https://www.infomaniak.com/fr/support/faq/2535/modifier-la-configuration-dun-site-nodejs-infomaniak) ne décrit pas de coffre. | Faire préciser le mécanisme privé disponible. Ne pas placer de secret réel dans les commandes du Manager ou leurs journaux. |
| Répertoire personnel | Sa résolution canonique rejoint la racine client déjà observée. Son ancêtre système root possède les permissions de base 775 avec le bit setgid (mode 2775). | Les contrôles actuels refusent cet ancêtre accessible en écriture au groupe. Un enfant 0700 ne lève pas ce refus ; aucun chmod système ni assouplissement des contrôles n’a été effectué. |
| Répertoire temporaire | La lecture des seules métadonnées montre le mode 2777, sans sticky bit, et un propriétaire root. Aucune sonde de fichiers n’y a été créée. | Cet emplacement n’est pas admissible pour nos fichiers privés ; sa persistance n’est pas établie non plus. Identifier un emplacement durable officiellement fourni. |
| Isolation de recette | Le quota Node observé reste 1/1 ; l’alias de prévisualisation dessert le même processus. | Confirmer une recette distincte avant l’ouverture de l’authentification. Aucun nouvel abonnement n’a été commandé. |

Ces observations de permissions ne constituent pas une démonstration de vulnérabilité du fournisseur : la portée d’isolation de son infrastructure reste inconnue. Les sondes ont lu des métadonnées des chemins standard, sans lire de fichier utilisateur, créer de secret ou toucher aux fichiers ZTIKIX.

## Correctif du diagnostic SQL

Le [diagnostic de préproduction](preproduction-preflight.md) pouvait auparavant accepter des DML sur le registre, sur une autre base nommée ou via une portée base trop large. Il exige désormais les droits explicites sur les tables connues et SELECT seul sur le registre ; les portées larges, inconnues ou de délégation sont refusées. Les règles de wildcard au niveau base et les identifiants littéraux au niveau table sont distingués conformément à la [documentation MariaDB](https://mariadb.com/docs/maxscale/maxscale-security/authentication-modules#wildcard-database-grants).

Ce correctif ne fournit aucun droit manquant sur l’hébergement et ne certifie pas l’ensemble des droits effectifs. La fixture SQL dédiée ne porte que sur des comptes et bases synthétiques de CI ; elle ne modifie pas l’hébergement.

## Demande prête pour le support, non envoyée

Objet : **JessieMessage — droits MariaDB fins et stockage privé Node.js**

Bonjour,

Je prépare JessieMessage sur mon hébergement Web Node.js existant. Le site reste neutre et la base de recette dédiée a reçu ses 27 migrations. Avant d’activer l’authentification, pourriez-vous préciser :

1. Comment obtenir un utilisateur MariaDB distinct avec des droits par table : SELECT/INSERT/UPDATE/DELETE sur les tables applicatives nécessaires, SELECT seul sur `schema_migrations`, sans DDL, création de tables temporaires, `LOCK TABLES`, délégation ni accès à une autre base ? Le Manager ne présente que les trois profils par base.
2. Quel emplacement persistant, hors répertoire HTTP et checkout, recommandez-vous pour les secrets et médias privés ? Notre contrôle exige un répertoire final 0700 et refuse les ancêtres modifiables par groupe/autres. L’ancêtre système de la racine client observée est en 2775. Merci de préciser les garanties d’isolation et de conservation lors des reconstructions/redémarrages.
3. Existe-t-il un mécanisme de variables secrètes pour Node.js, hors des commandes build/start visibles et de leurs journaux ?
4. Avec le quota Node actuel 1/1, quelle possibilité existe pour une recette isolée ? L’alias de prévisualisation semble pointer sur la même application. Merci de présenter les possibilités de l’offre actuelle avant toute proposition payante.

Merci. Adresse de contact du projet : **contact@jessiemessage.com**.

La demande ne contient ni mot de passe, ni clé, ni nom de base/compte complet. Elle doit être envoyée dans le contexte authentifié de l’hébergement concerné après accord du propriétaire. Aucun message de support n’a été envoyé par l’agent.
