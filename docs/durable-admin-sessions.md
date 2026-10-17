# Sessions et confort quotidien — étape 0.30

**Suite 0.33 :** les [connexions clients durables et l’ouverture des notifications](notification-opening.md) sont désormais actives en recette sur `f2677249`. Les sessions administrateur de ce lot sont conservées ; les clients disposent aussi de 180 jours glissants sans coupure pour simple inactivité. Les descriptions de la politique client de l’époque, plus courte, restent historiques. Une session effectivement expirée ou révoquée ne peut pas être reprise.

Ce lot applique les premières corrections de l'audit du 16 octobre 2026.
Le lot est activé en recette depuis le **16 octobre 2026 à 22:49 Europe/Paris**,
sur la révision `8f38f66f5c0ca5201ef96a6cbf56f45fd96e1a19`
(arbre `6b9a26eb22cb8e7e675735f03bab92fcfff1efde`).
Le profil reste `messaging-photos`. La production reste fermée.

## Connexions sur plusieurs appareils

Une session administrateur valide dure désormais **180 jours glissants**,
sans déconnexion après 30 minutes d'inactivité. Chaque appareil conserve son
propre jeton opaque. Le serveur prolonge sa validité à l'usage et les pages
administrateur visibles renouvellent périodiquement le cookie auprès de
`/api/auth/session`. Un minuteur borné à cinq minutes évite le débordement des
minuteurs de navigateur au-delà d'environ 24,8 jours.

Le mot de passe et le second facteur restent nécessaires lors d'une nouvelle
connexion. Une session déjà expirée ou révoquée ne peut pas être réactivée.
La suppression des données du navigateur, la navigation privée, une action
de déconnexion ou une récupération du compte peuvent toujours fermer une
session. Les comptes clients conservent leurs limites de huit heures et
trente minutes d'inactivité.

Les relectures SQL d'authentification, d'accès et de conversation appliquent
la même politique. Le runtime lit l'horloge après les attentes de verrou,
ce qui empêche une requête ancienne de rejeter une activité plus récente.
Les dates réellement futures, la révocation et les générations MFA ou de
mot de passe invalides restent refusées.

La rubrique « Compte et appareils » liste les connexions administrateur par
date, signale l'appareil courant et permet une révocation ciblée. Elle ne
collecte ni nom d'appareil ni adresse réseau. L'API est limitée au compte
connecté, paginée et protégée par les contrôles d'origine et CSRF lors d'une
révocation. La déconnexion de tous les appareils demande une confirmation.
Ces fonctions réutilisent les tables existantes : **aucune migration**.

## Conversation et accès

Le budget de lecture administrateur tient compte de plusieurs écrans actifs
sur le même compte. Une coupure réseau affiche une reprise explicite et des
réessais bornés, avec reprise au retour de la connexion. Les envois ne sont
pas répétés automatiquement. Les brouillons restent en mémoire ; une alerte
prévient une fermeture avec du texte ou un envoi en attente. Aucun contenu
privé n'est ajouté au stockage persistant du navigateur.

La suppression d'un message demande confirmation. L'accès client privilégie
la conversation, explique simplement son état et sa date de fin, puis place
les actions du compte dans une rubrique secondaire. Une attente de validation
est vérifiée automatiquement lorsque la page est visible, avec un bouton
manuel. L'entrée `/app` rejoint directement la conversation lorsqu'un seul
rôle connecté est disponible. Les nouveaux textes sont disponibles en
français et en anglais.

## Photos de téléphone

Le navigateur prépare les JPEG, PNG et WebP avant l'envoi : contrôle des
dimensions avant décodage, réduction à 2048 pixels sur le grand côté et
réencodage local sans les métadonnées EXIF/XMP de la source ; le navigateur
peut ajouter un profil de couleur standard. Le serveur conserve ses validations et
son propre traitement. La limite de fichier reste dix mébioctets ; les
sources sont bornées à 64 millions de pixels et 16384 pixels par côté.
Les formats HEIC et les images animées ne sont pas pris en charge.

La lecture HTTP dispose de 30 secondes, l'admission de 35 secondes et
l'attente du navigateur de 65 secondes pour couvrir aussi la file du
décodeur. Une réservation de
stockage dont le résultat est incertain n'est pas libérée arbitrairement.
Sa réparation opérateur reste un travail distinct.

## Vérification et suite

Le contrôle de syntaxe et la construction passent sous Node.js 24.19.0.
La suite locale compte **1781 cas : 1656 réussis, 125 ignorés, aucun échec**.
Les 125 cas ignorés localement comprennent 25 cas exigeant l'environnement
SQL dédié et 100 cas dépendant de capacités système indisponibles dans cet
environnement ; ils ne sont pas présentés comme réussis. La revue croisée a notamment corrigé l'ordre des verrous entre la
liste des appareils, la révocation ciblée et la déconnexion globale.

Les cinq jobs de la [CI de la révision exacte, exécution 38963719414](https://github.com/fredbuhr/jessiemessage/actions/runs/38963719414), passent :

- suite générale : **1781 cas, 1756 réussis et 25 ignorés** ;
- MariaDB 10.11 et 11.4 : **342 réussis, aucun cas ignoré sur chaque version** ;
- Chrome : **cinq scénarios chat/photos réussis** et **un parcours HTTPS/MFA réussi**.

Le scénario photo Chrome vérifie réellement la réduction d'un JPEG de
20 mégapixels, l'orientation EXIF et l'alpha pendant la préparation locale.
Le stockage final garde le JPEG sur fond ivoire existant. Ces essais
synthétiques ne remplacent pas l'utilisation simultanée sur les ordinateurs
et téléphones du propriétaire : **l'acceptation réelle sur six à huit
appareils ou profils reste à effectuer**.

## Activation et repli

Le build Manager du 16 octobre 2026 à 22:49 Europe/Paris a réussi. Le flux de
démarrage annonce l'écoute sur le port 3000 et le profil `messaging-photos`
actif. Le relevé HTTPS de **20:50:45.888 UTC, soit 22:50:45.888 Europe/Paris**,
confirme huit fichiers servis identiques à la source attendue, avec
`Cache-Control: no-store`, ainsi que les quatorze réponses HTTP attendues :
santé, disponibilité, entrée et formulaires répondent ; les appareils et
médias anonymes sont refusés ; les pages de conversation anonymes
redirigent vers la connexion. Les fonctions désactivées et les ressources
privées ne sont pas servies.

La révision photos `37c8fcd0` et son lanceur restent conservés comme point de
repli inchangé. Ce lot n'ajoute aucune migration et ne remplace ni les clés,
ni les sauvegardes validées au lot 0.28. Les contrôles de démarrage et HTTPS
ne constituent pas une nouvelle validation du parcours réel sur plusieurs
appareils.

Le lot suivant, **0.31**, reste le système de notifications : préférences
simples, notification des nouveaux messages, déduplication entre appareils,
retrait des abonnements invalides et vérification iPhone/Android. Il doit
préserver le contenu privé sur l'écran verrouillé. La restauration en mode
exploitation, la maintenance du stockage et les décisions de conservation
restent au plan avant l'ouverture de la production.

**État ultérieur — 17 octobre 2026 :** [0.31 est activée en recette](message-notifications-release.md), après les migrations 0029/0030. Les références de repli ci-dessus décrivent le schéma historique à 28 migrations. Le repli courant utilise désormais `017cafaf` avec le profil `photos`, compatible avec les trente migrations ; les anciennes révisions demandent la restauration cohérente de leur checkpoint.


## Points à reprendre au lot 0.31

Un échec réseau isolé pendant la lecture des capacités du chat administrateur
peut laisser son bouton de conversation masqué jusqu'au prochain retour sur
la page. Prévoir un état explicite et une reprise de cette lecture sans
nouvelle connexion.

La composition d'une diffusion peut être perdue au passage en arrière-plan ;
ce parcours reste désactivé en recette et devra être traité avant son
activation. Les notifications ne sont pas encore installées : aucune alerte
fiable lorsque l'application est fermée n'est revendiquée par le lot 0.30.
