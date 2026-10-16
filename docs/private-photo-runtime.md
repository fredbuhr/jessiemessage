# Photos privées — étape 0.28

L'étape 0.27 (texte, restauration SQL isolée et téléphone) est validée en
recette. Le runtime photos actif est **`37c8fcd0`**, application **0.24.0**.
**0.28 est activée en recette ; le parcours photos réel et la restauration
SQL + fichiers restent à accepter.**

Ce lot réutilise les modules médias, Sharp, le chiffrement, les autorisations,
la galerie, la déduplication et les quotas existants. Il n'ajoute aucune
dépendance ni nouvelle pile applicative. Aucun changement SQL de schéma n'est
nécessaire : les 28 migrations sont déjà appliquées.

## Profil privé et préparation

`runtime-media.json` ajoute une seule clé média aléatoire de 32 octets, un
répertoire persistant privé et les quotas. Sa publication reprend l'écriture
exclusive propriétaire `0600`, la synchronisation et les lectures ancrées des
autres fichiers privés. Les fichiers DB, MFA et messaging restent inchangés.
La lecture du profil photos rassemble les quatre configurations sous le même
ancrage ; origine et quatre clés distinctes sont contrôlées.

`prepare-runtime-media.mjs check|prepare` exige un répertoire existant privé
vide. Il vérifie la source avec les trois clés texte, refuse toute ancienne
métadonnée média et contrôle espace, capacité non initialisée et décodage
Sharp via le worker réel. Le mode `check` ne publie rien ; la clé de son essai
est éphémère. `prepare` publie une fois la clé dédiée, relit le fichier et
refuse toute configuration média déjà présente. Une erreur après publication
n'autorise pas une recréation automatique.

Le lanceur existant conserve son défaut texte. Le choix explicite
`check|start --profile photos` active AUTH, ACCESS, MAIL_DELIVERY, CHAT et MEDIA.
CRM, récupération client et diffusions restent désactivés. Son contrôle vérifie
les droits SQL, le schéma, l'initialisation de capacité, le lien physique du
stockage, l'espace libre et le décodeur avant le listener. Les secrets restent
dans l'objet de configuration interne, sans export dans `process.env`.

## Coffre et sauvegarde

Le coffre `--profile messaging-photos` contient **cinq fichiers privés**, dont
la nouvelle clé et les paramètres de stockage. Le format v3 conserve la
lecture des anciens coffres v1/v2. La création d'un coffre AUTH ou texte seul
refuse d'omettre une configuration média présente. Les origines et la
séparation des clés sont vérifiées avant chiffrement et après déchiffrement.

La procédure SQL et fichiers réutilise `backup.mjs` avec **`--profile photos`** :
quatre vraies clés, manifeste v2 signé avec quatre canaris, données chiffrées et
fichiers authentifiés. Les tables de récupération, CRM et diffusions doivent
être vides, y compris leurs métadonnées non chiffrées. Le mode complet conserve
ses cinq clés et ses manifestes v1. Aucune clé CRM fictive n'est introduite.

Les commandes restent hors ligne. Les gardes existantes de séparation
source/copie, schéma complet, inspection SQL dédiée, instantané, journal de
capacité, suppression des seules propositions connues et réassociation de la
copie restent en place. Le coffre des secrets ne remplace pas SQL et les
fichiers chiffrés. Le compte applicatif ne reçoit aucun accès à une copie de
restauration.

## Activation en recette — 16 octobre 2026

Le propriétaire confirme `COFFRE_PHOTOS_OK` à **18:23 Europe/Paris** après
sélection du coffre chiffré sur son PC, comparaison SHA-256 et déchiffrement
du profil v3 à cinq fichiers. Le coffre existant et les archives précédentes
sont conservés ; aucune clé n'est régénérée.

Le processus Node.js est arrêté depuis le Manager avant l'initialisation ;
l'URL de santé sert alors la maintenance HTML, sans réponse JSON de
l'application. La commande privée épinglée appelle l'initialiseur existant
avec `--offline`. Elle confirme `initialized: true` après inventaire complet,
sain, vide et sans élément inconnu. Le contrôle du lanceur confirme ensuite
`checks_passed`, profil `messaging-photos`, avant démarrage HTTP.

Les commandes de build et d'exécution du Manager pointent sur la révision
**`37c8fcd0b96b9c712a6a1c3ddab2e1c5ef04b228`**, arbre
**`0f411f32070bdf3946e0034b9ae6073d91c8333b`**. La construction du
16 octobre à **18:27 Europe/Paris** est suivie du démarrage confirmé du
profil `messaging-photos`. Le contrôle public après redémarrage obtient :

- santé, disponibilité et entrée `/app` : **200** ;
- capacités et bibliothèques médias client/administrateur anonymes : **401** ;
- chemins publics testés de `runtime-media.json` : **404**.

Ces contrôles confirment le démarrage et le refus d'accès anonyme. Ils ne
remplacent pas un envoi authentifié ou une restauration réelle avec photos.
Le repli AUTH compatible `14a43104` reste disponible. Aucun changement de
schéma, élargissement de droits SQL ou lancement de production n'est effectué.

## Acceptation restante

1. Effectuer un seul parcours groupé : photo JPEG/PNG dans chaque sens,
   légende, galerie, reprise d'envoi, suppression autorisée et conservation
   après réouverture. Les comptes et l'invitation déjà acceptés sont réutilisés.
2. Vérifier une sauvegarde SQL + fichiers sur une copie isolée avec les quatre
   vraies clés et les contrôles de reprise existants.

## Validation du code

Le contrôle de syntaxe et la suite générale locale passent : **1 728 tests,
1 603 réussis, 125 ignorés pour les environnements absents, aucun échec**.
Les nouveaux essais couvrent notamment le worker Sharp réel, les quatre clés
et leurs collisions, la conservation des secrets existants, les écritures
exclusives, le refus d'un répertoire non vide, les tags GCM et liaisons altérés,
les domaines désactivés et les manifestes des deux profils. Deux scénarios
SQL supplémentaires exercent préparation et restauration du profil photos sur
les bases jetables de la CI. La [CI de la révision
déployée](https://github.com/fredbuhr/jessiemessage/actions/runs/38926103151)
et celle de la PR passent les cinq jobs : **1 728 tests généraux, 1 703 réussis,
25 ignorés explicitement**, GPG v3/cinq fichiers et lectures ancrées exécutés,
**335 tests réussis sans omission sur chacune des bases MariaDB 10.11 et
11.4**, Chrome chat et authentification administrateur HTTPS. Ces essais
isolés ne remplacent pas l'acceptation des photos de la recette hébergée.

Les anciennes notes [médias](private-media.md) et [capacité](media-capacity-inventory.md)
décrivent les briques existantes et leurs limites ; leurs états d'hébergement
historiques ne remplacent pas cette note. Les informations du service,
conservation/suppression et autres conditions d'ouverture restent dans le
plan global. Le pilote élargi et la production ne sont pas ouverts par ce lot.

**Étape finale : 0.28 en cours — photos actives en recette, parcours réel et
restauration SQL + fichiers à confirmer.**
