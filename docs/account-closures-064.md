# Fermeture d’un compte — parcours 0.64

**Étape 3/6 : parcours livré dans le code, effacement réel désactivé.** Le runtime hébergé reste la version 0.62. Aucun compte réel, clé, schéma, configuration d’hébergement ou outil PC n’a été modifié pour ce lot. Les preuves automatiques seront consignées dans `verification-proofs/jm064-verification.json` après les cinq jobs CI de la source, de la PR et de main.

## Le parcours prévu

Dans **Administration → Comptes clients**, le lien **Fermer définitivement** sélectionne le compte par son identifiant. **Fermeture des comptes** permet aussi de retrouver le suivi. Ouvrir un lien, lire une fiche ou actualiser ne demande aucun effacement.

La confirmation affiche le pseudo sélectionné, explique l’effacement dans l’application et l’interruption temporaire du service. Il faut reconnaître le sort distinct des copies et écrire **FERMER**, puis cliquer sur **Confirmer l’effacement**. La déconnexion, la révocation et l’expiration de l’accès gardent leur comportement antérieur ; elles conservent la conversation.

Le suivi distingue demande enregistrée, compte fermé/photos en cours, photos effacées/vérification finale et effacement terminé dans l’application. La référence du compte et son état restent consultables après disparition de son identité SQL. Ils sont conservés dans le journal chiffré minimal de 0.63 ; ni pseudo, ni e-mail, ni message, ni preuve de session n’y sont ajoutés. Les sauvegardes et téléchargements restent des copies séparées, sans promesse d’effacement de ces copies.

En mode désactivé, l’écran explique la préparation en cours, ne lit aucun compte sélectionné et n’offre aucune confirmation. Aucun endpoint public ne permet d’activer la fonction.

## Demande et exécution séparées

`closure-http.mjs` exige une session administrateur courante sur l’origine primaire, Origin/Fetch Metadata exacts et la preuve CSRF actuelle. Les champs et tailles sont fermés. La preuve est revérifiée au moment de publier le fichier chiffré. Une session perdue ensuite peut rendre la réponse incertaine ; l’intention autorisée demeure alors découvrable. Une nouvelle lecture vérifie le résultat, sans répéter automatiquement le POST.

`closure-service.mjs` contrôle le rôle client, le pseudo attendu et le graphe via l’inspection transactionnelle de 0.63. Sa seule écriture est l’intention `requested`. Aucune ligne SQL ni photo n’est effacée par cette requête. Une répétition retrouve la même intention ; un conflit concurrent impose une nouvelle lecture. Un administrateur ne peut pas être choisi comme cible.

`runManagedClosures` prend **le même verrou privé que les captures**, vérifie les préalables et la source, puis appelle l’arrêt du processus géré existant. Seule une sortie effectivement constatée, de code zéro sans signal, permet le moteur. Le verrou, l’état arrêté, l’annulation et l’identité de source sont revérifiés pendant le traitement. Une sortie forcée, un acquittement perdu ou un changement de ces preuves empêche la reprise. Les transactions et fichiers conservent leurs marqueurs reprenables. Un redémarrage explicite peut reprendre l’intention ; il n’y a pas de boucle de nouvelle tentative destructive après une erreur.

Le superviseur traite une fermeture avant une capture et partage le cycle entre appels concurrents. Une intention retrouvée au démarrage est traitée avant le premier listener. Les événements de console sont agrégés, sans identifiant client ni texte privé.

## Barrière avant redémarrage

Avec le répertoire d’opérations configuré, `createConfiguredServer` découvre les journaux avant le listener et les producteurs, **y compris lorsque les demandes de fermeture sont désactivées**. Une intention inachevée bloque. Chaque reçu terminé exige `verifyAbsent` sur la base courante. Si une restauration fait réapparaître le compte, le démarrage bloque avec `ERASURE_RESTORE_REPLAY_REQUIRED` ; aucun effacement de données restaurées n’est lancé silencieusement.

Cette barrière suppose la conservation indépendante du registre, de sa clé et de son rattachement base/racine média. Un registre perdu ou remplacé par une ancienne copie vide ne peut pas prouver l’absence de fermetures. La version 0.62 et les versions antérieures ignorent ces reçus : **après une première fermeture réelle, ne pas les utiliser pour rouvrir une base restaurée**. Le protocole de restauration doit intégrer cette obligation avant activation.

## Conditions restant à raccorder en étape 4/6

La commande de production `start-recurring-private-messaging.mjs` n’installe **aucun `closureOperations`**. Le booléen interne du processus enfant ne devient vrai que lorsqu’un propriétaire d’opération est explicitement raccordé au superviseur. Il n’existe ni variable d’environnement de déblocage, ni valeur HTTP, ni fichier d’activation déclaratif dans ce lot. Le service de production par défaut est désactivé.

Le composant exige deux lecteurs de preuves distincts :

- un inventaire SQL complet des triggers, routines et événements avec l’identité d’inspection privilégiée ; le compte DML de l’application ne permet pas de conclure à leur absence ;
- la continuité du registre chiffré lors de la capture, du déchiffrement et de la restauration, avec blocage des comptes déjà fermés avant toute réouverture.

Les callbacks de test représentent ces responsabilités ; ils ne sont pas des preuves de production. Il reste à les relier à des contrôles réels et à une sauvegarde/restauration courante. Aucune élévation de privilèges SQL n’est faite automatiquement. Les envois techniques indépendants et les accès d’opérateur doivent être inclus dans le périmètre réellement exclu ; un simple état « hors ligne » ne suffit pas.

## Validation

Les tests HTTP exercent les vrais fichiers chiffrés : lecture sans intention, confirmation exacte, répétition, changement de pseudo, révocation avant publication, réponse tardive incertaine, fermeture du handler, refus Origin/CSRF/type/taille et isolement de l’ancienne origine. Le mode désactivé reste vérifiable.

Un vrai sous-processus passe par le shim IPC et l’arrêt applicatif : requête encore active, producteur, transport et pool sont drainés avant l’exécution. Les cas verrou occupé, sortie forcée/non zéro, source/lease changée et annulation ne reprennent pas les producteurs. Les tests de superviseur couvrent priorité, concurrence, reprise avant écoute et erreurs sans nouvelle tentative.

Le scénario MariaDB supplémentaire crée uniquement des comptes fictifs dans une base loopback explicitement jetable. Il vérifie un POST confirmé sans modification SQL, un inventaire privilégié réel, le cycle IPC, les fichiers chiffrés retirés, les autres conversations inchangées et le blocage après réapparition SQL d’un compte fermé.

Les parcours Chrome couvrent les deux langues, 320/375/1280 px, clavier, confirmation distincte, annulation, masquage/BFCache, changement de session avant et après POST, perte de réponse, interruption réseau, lecture après redémarrage et pseudo contenant du balisage inerte. Aucune réception de mail ou de Push réel n’est utilisée comme preuve dans ce lot.
