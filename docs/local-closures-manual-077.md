# Fermeture locale et réconciliation manuelle — 0.77

## Périmètre de ce lot S2a

Réutiliser le moteur d'effacement, ses transactions et ses journaux chiffrés. Le nouveau mode local ne demande aucune réponse du PC pendant une fermeture. Il ne fournit pas de garantie autonome après perte simultanée du serveur et des fermetures non encore copiées.

Le service courant reste celui indiqué dans [REPRISE](REPRISE.md). La présence du code 0.77 ne suffit pas à activer les fermetures : le lancement habituel `start` reste inchangé.

## Fermeture locale

Les commandes `check-local-closures` et `start-local-closures` de `scripts/start-recurring-private-messaging.mjs` utilisent les six arguments déjà employés par `check`/`start` : répertoire du code, commit, arbre, configuration privée, opérations et mode `linux-dirfd`. Elles n'acceptent aucun argument de témoin.

`check-local-closures` vérifie les préalables sans démarrer la messagerie ni effacer de données. Il indique si des intentions attendent une reprise. `start-local-closures` compose explicitement le propriétaire local avec le superviseur existant. Il n'est pas lancé par une mise à jour du code ou un démarrage ordinaire.

Le parcours d'administration existant enregistre l'intention après confirmation « FERMER ». Le superviseur prend le même verrou que les captures, arrête réellement l'enfant et attend le drainage des requêtes, téléchargements et producteurs avant l'effacement. Il reprend le journal après interruption et vérifie l'absence du compte avant de rouvrir. Un résultat incertain garde le service arrêté. Un compte réapparu après un reçu terminé bloque la réouverture ; le démarrage normal ne l'efface jamais silencieusement.

Le registre minimal existant conserve l'identifiant opaque, les dates et l'avancement, sans pseudonyme ni contenu des conversations. Il reste dans la capsule opérationnelle des captures et leurs copies PC asynchrones. Aucune purge de ces reçus ou archives n'est ajoutée : les reçus doivent couvrir toutes les archives encore restaurables.

## Réconciliation d'une restauration manuelle isolée

`server/backup/manual-restore.mjs` expose `reconcileManualRestore`. Ce moteur est destiné à un opérateur, sans route HTTP ni commande de publication dans ce lot. Il réutilise l'import et les contrôles applicatifs existants ; il ne réalise pas lui-même l'import SQL.

L'opérateur doit d'abord arrêter tous les producteurs et captures, choisir l'archive, importer sur une base et un dossier photo distincts, puis conserver les éléments de quarantaine. La cible ne doit avoir aucun processus applicatif ou envoi actif. `recette.jessiemessage.com` partage le service principal et ne constitue pas une cible isolée.

Le moteur exige le registre récent explicitement sélectionné et son empreinte, ainsi qu'une relecture de ce registre pendant le traitement. Un registre manquant ou modifié bloque l'opération. L'opérateur reste responsable de sa complétude et de sa fraîcheur ; une empreinte locale ne prouve pas une continuité externe.

Il vérifie la capture, ses six clés, les trente tables applicatives, les fichiers photo, les identités source/cible et les relations attendues. Le profil reste `completeDatabase:false`, sans prétendre inventorier tous les objets SQL invisibles de l'hébergement. Les contrats historiques C4/C5 restent stricts et inchangés.

Les comptes fermés depuis la capture sont traités sur la cible avec de nouveaux journaux liés à cette cible, depuis l'intention initiale. Une phase ou un curseur de la source n'autorise jamais à sauter l'effacement sur la copie restaurée. La capacité est réattachée par le mécanisme existant ; les anciennes sessions sont révoquées ; l'absence finale et les données restantes sont contrôlées.

Avant toute mutation, un marqueur bloquant est posé dans le futur dossier de journaux cible. Le résultat reste **en quarantaine, sans démarrage et avec réouverture manuelle requise**. Le marqueur de quarantaine d'origine est conservé. Le D1 réel et son marqueur ne sont pas modifiés.

## Suite S2b livrée en 0.78

Le [parcours opérateur 0.78](manual-restore-operator-078.md) raccorde ce moteur à l’import isolé et à la publication explicite après une nouvelle vérification sous maintenance. Les [preuves S2b](verification-proofs/jm078-verification.json) distinguent exercice synthétique et déploiement réel. Ne pas supprimer un marqueur pour faire passer le démarrage et ne pas réinitialiser le PC ou l'ancien témoin.

## Vérifications

Les tests dédiés exercent le vrai drainage du processus, les photos chiffrées, les reçus durables et les interruptions. Les scénarios MariaDB utilisent uniquement les bases synthétiques explicitement autorisées de la CI ; les tests ignorés localement ne constituent pas une validation SQL. Le résultat exact de la CI et la source fusionnée sont consignés dans REPRISE et les preuves du lot.
