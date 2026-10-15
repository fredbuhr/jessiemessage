# Diffusions individuelles 0.11

Ce lot ajoute une file durable de messages individuels. La sélection utilise les contacts et filtres CRM ; les groupes restent des classements privés. Chaque destinataire reçoit un message ordinaire dans sa conversation avec Jess, sans audience, nom de campagne, données CRM ni identité d'autres clients.

## Activation privée

`JESSIEMESSAGE_ENABLE_BROADCAST=1` exige le CRM, donc l'authentification administrateur, les accès clients et la messagerie déjà configurés. Le défaut est désactivé ; une valeur différente de `0` ou `1` échoue. Le serveur ne lance aucune migration à son démarrage. Les trois nouvelles migrations `0023`–`0025` doivent être revues et appliquées séparément dans la base dédiée ; les 22 précédentes restent identiques.

Les campagnes réutilisent `JESSIEMESSAGE_MESSAGE_KEY` avec une finalité cryptographique distincte, une clé dérivée et une liaison au propriétaire et à la campagne. Leur contenu et leur audience sont authentifiés et chiffrés au repos. Les messages finaux emploient le chiffrement habituel, lié à leur propre conversation, auteur et identifiant. Le serveur peut les déchiffrer ; il ne s'agit pas de chiffrement de bout en bout. Aucun nouveau secret, compte, fournisseur, paquet npm ou canal e-mail n'est ajouté. L'adresse du site reste **contact@jessiemessage.com**.

La page `/admin/broadcasts` et ses fichiers sont réservés à une session administrateur actuelle avec MFA. L'option photo exige également l'activation des médias ; elle réutilise un fichier actif appartenant à Jess. Une photo encore en file est exclue si les médias sont désactivés. Les routes restent inaccessibles quand les diffusions sont désactivées.

## Consentement et confirmation

Chaque client commence avec les diffusions désactivées. Il peut enregistrer son choix dans son espace de compte, y compris avec une adresse vérifiée et un accès encore en attente ou expiré. Le choix exige sa propre session actuelle, Origin et CSRF ; l'administrateur ne peut pas l'activer pour lui. Un conflit entre deux fenêtres oblige à recharger le choix actuel. Ce consentement concerne les diffusions ; la conversation individuelle conserve ses règles existantes.

Jess sélectionne explicitement entre 1 et 100 conversations, rédige un titre privé et un texte, ou choisit une photo avec une légende facultative. L'aperçu indique les destinataires actuellement éligibles et les photos déjà partagées. La confirmation refuse entièrement une sélection contenant un client inéligible. Une répétition de photo demande une autorisation explicite. Le contrôle porte sur l'identifiant exact de la photo et inclut les anciens messages supprimés ; un nouveau téléversement avec un autre identifiant n'est pas comparé à cet historique.

La confirmation crée une campagne immuable. **L'envoi continue après la fermeture de la page ou la déconnexion de Jess.** Le bouton d'annulation arrête les destinataires encore en attente ou réservés ; les messages déjà inscrits dans leurs conversations restent présents. La désactivation ou révocation du compte administrateur et le changement de version MFA arrêtent définitivement le reste de cette approbation. Une nouvelle confirmation est nécessaire pour recommencer ; aucune route ne réactive une campagne en pause.

## Garanties de la file

Le navigateur conserve en mémoire le même identifiant de confirmation tant que le résultat est incertain. Une nouvelle requête identique retrouve la campagne ; un contenu différent avec cet identifiant provoque un conflit. Recharger la page perd ce brouillon en mémoire : consulter l'historique avant de confirmer une nouvelle campagne lorsque la réponse précédente est inconnue.

Avant chaque inscription de message, une transaction relit et verrouille l'administrateur et sa version MFA, l'affectation et l'ouverture de la conversation, les preuves et la durée d'accès du client, son consentement et la disponibilité de la photo. Un retrait de consentement et un envoi se sérialisent sur le compte client. Si l'envoi a déjà validé sa transaction, le retrait ne supprime pas ce message. Les contrôles utilisent l'heure échantillonnée pour l'opération ; une attente de verrou n'est pas un mécanisme d'échéance à la milliseconde près.

Les identifiants de message sont créés et enregistrés avant le travail. L'insertion du message, de sa photo, de l'événement et de l'état « livré » se fait dans une seule transaction MariaDB. Une interruption ou un accusé de validation perdu permet de reprendre avec les mêmes identifiants. Un message supprimé ne peut pas être ressuscité par une reprise. « Livré » signifie inscrit dans la conversation ; cela ne certifie ni lecture, ni appareil connecté, ni notification.

Les réservations durent normalement deux minutes. Une réservation expirée est récupérable ; un ancien worker ne peut plus finaliser son ancien bail. Les erreurs de traitement terminées sont réessayées avec attente croissante, jusqu'à huit échecs. Les limitations de débit et les reprises après interruption ne consomment pas ce compteur. La durée maximale d'une campagne est de sept jours. Le travail séquentiel traite au plus cinq destinataires par lot, avec un intervalle normal de deux secondes ; le débit partage exactement les quotas des messages manuels : 30 envois par administrateur et 300 globalement par minute. L'arrêt du serveur attend le travail en cours avant de fermer la base.

Au plus dix campagnes non terminées peuvent coexister par administrateur. L'historique est paginé, les corps JSON et les listes sont bornés, et aucun détail SQL ni contenu privé n'est enregistré dans les erreurs de la file. Les identifiants et états relationnels restent visibles dans la base ; la politique de conservation et de purge des campagnes reste à définir avant exploitation prolongée.

## Validation et publication

Les tests unitaires, HTTP et de modèle couvrent les contrats, les réponses tardives, les frontières de rôle, Origin/CSRF, le consentement et les confirmations incertaines. Trois groupes MariaDB supplémentaires couvrent les hooks de conversation, la persistance des campagnes et le parcours HTTP réel, avec des comptes et messages synthétiques. Le compte d'exécution reste limité à SELECT/INSERT/UPDATE/DELETE et les groupes s'exécutent successivement sur une base jetable explicitement reconnue.

La preuve CI exacte est ajoutée au bilan après exécution. La vérification navigateur, l'accessibilité, le rendu sur iPhone/Android et la recette HTTPS restent à faire sur l'environnement privé. Aucun moteur de navigateur n'est disponible dans cet environnement de travail. Le lot n'envoie aucun e-mail ou message réel et n'applique aucune migration de production. Les diffusions peuvent rester désactivées pendant le premier pilote si la recette de cette interface n'est pas terminée.
