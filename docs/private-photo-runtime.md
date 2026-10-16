# Photos privées — étape 0.28

L'étape 0.27 (texte, restauration SQL isolée et téléphone) est validée en
recette. Le runtime actif demeure **`14a43104`**, application **0.24.0**.
**0.28 est en préparation ; les photos ne sont pas encore activées.**

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

## Lot d'activation restant

1. Préparer la configuration et un coffre renouvelé, puis faire confirmer sa
   copie indépendante, son empreinte et son déchiffrement par le propriétaire.
2. Arrêter les producteurs, initialiser la capacité avec la commande existante
   `media-storage.mjs initialize --offline` alimentée par le profil privé,
   contrôler puis démarrer la révision photos épinglée en recette. Le repli
   AUTH seul compatible reste disponible.
3. Effectuer un seul parcours groupé : photo JPEG/PNG dans chaque sens,
   légende, galerie, reprise d'envoi, suppression autorisée et conservation
   après réouverture. Les comptes et l'invitation déjà acceptés sont réutilisés.
4. Vérifier une sauvegarde SQL + fichiers sur une copie isolée avec les quatre
   vraies clés et les contrôles de reprise existants.

## Validation du code

Le contrôle de syntaxe et la suite générale locale passent : **1 728 tests,
1 603 réussis, 125 ignorés pour les environnements absents, aucun échec**.
Les nouveaux essais couvrent notamment le worker Sharp réel, les quatre clés
et leurs collisions, la conservation des secrets existants, les écritures
exclusives, le refus d'un répertoire non vide, les tags GCM et liaisons altérés,
les domaines désactivés et les manifestes des deux profils. Deux scénarios
SQL supplémentaires exercent préparation et restauration du profil photos sur
les bases jetables de la CI. Les fichiers privés ancrés et GPG doivent y être
exécutés ; leur absence locale n'est pas présentée comme une validation réelle.

Les anciennes notes [médias](private-media.md) et [capacité](media-capacity-inventory.md)
décrivent les briques existantes et leurs limites ; leurs états d'hébergement
historiques ne remplacent pas cette note. Les informations du service,
conservation/suppression et autres conditions d'ouverture restent dans le
plan global. Le pilote élargi et la production ne sont pas ouverts par ce lot.

**Étape finale : 0.28 en cours — préparation du profil photos et de sa sauvegarde.**
