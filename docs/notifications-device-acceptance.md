# Notifications — essais sur les appareils du foyer

**État courant : étape 0.38, runtime `4433309f`, déploiement `primary-transition`, schéma 30, mis à jour à 18:03 Europe/Paris le 17 octobre 2026.** L’adresse principale est désormais `https://jessiemessage.com`. L’ancienne adresse `https://recette.jessiemessage.com` reste disponible sans redirection pour conserver les connexions, installations et notifications existantes. La [correction de reprise après coupure](device-transition-retry.md) conserve le message visé lors d’une nouvelle tentative ; la [correction d’affichage](device-transition-interface.md) sépare et clarifie ses actions. Le [compte rendu de bascule](primary-origin-cutover.md) conserve les observations de routage et de propagation. La [continuité de langue 0.38](device-transition-language.md) conserve maintenant le choix FR/EN sur le pont, ses reprises et sa sortie vers la connexion.

Le propriétaire a accepté la réception réelle des notifications sur 0.31, puis signalé la friction du clic. La [correction 0.33](notification-opening.md), incluse dans ce runtime, apporte l’ouverture du message et les connexions clients durables. La [reprise des appareils](device-origin-transition.md) permet de retrouver sur l’adresse principale une connexion encore ouverte en recette. À **17:28 Europe/Paris le 17 octobre 2026**, le propriétaire répond **« c’est bon, ça fonctionne »** à la recette proposée : le parcours essayé est confirmé globalement. Ce retour ne précise pas l’appareil, le navigateur, tous les sens d’envoi ni six à huit sessions simultanées. Les étapes ci-dessous restent une référence pour les autres appareils ; elles n’imposent pas de répéter l’essai déjà satisfaisant. Les contrôles HTTP et les tests synthétiques restent distincts de ce retour réel.

## Parcours de référence — ordinateur et autres appareils

1. Dans le navigateur et le profil où l’administration est déjà ouverte en recette, ouvrir [jessiemessage.com/app](https://jessiemessage.com/app).
2. Choisir **Retrouver l’administration**, puis **Retrouver mon espace** sur l’écran suivant. Les conversations doivent apparaître sans nouveau mot de passe ni code si l’ancienne connexion est toujours valable. Si l’administration est déjà connectée sur la nouvelle adresse, son accès habituel est proposé ou ouvert directement.
3. Fermer puis rouvrir l’onglet de la nouvelle adresse : l’accès doit être conservé.
4. Dans une conversation, ouvrir **Notifications → Activer sur cet appareil**, autoriser la demande du navigateur et attendre **Notifications activées sur cet appareil.**
5. Fermer les pages destinataires jusqu’à l’alerte. Envoyer un **nouveau** message depuis le client de test, puis cliquer sur la notification : la bonne conversation doit s’ouvrir, avec le message mis en évidence, sans nouvelle identification lorsque la connexion est valable.

Le premier retour global est positif ; étendre maintenant aux autres appareils si nécessaire. Pour le client, le même parcours part de **Retrouver mon espace**. Si l’ancienne session est absente ou expirée, une connexion normale reste nécessaire une fois via **Me connecter** ; les visites suivantes bénéficient de la connexion durable.

Une alerte déjà affichée avant la correction 0.33 ne contient pas la référence de destination et garde son ancien parcours. Utiliser une nouvelle alerte pour le contrôle du clic.

## Préparer les autres appareils

1. Refaire la reprise depuis [l’adresse principale](https://jessiemessage.com/app), dans le navigateur et le profil habituellement utilisés pour ce compte.
2. Ouvrir une conversation, puis **Notifications**. Les mêmes réglages sont aussi disponibles dans **Mon compte**.
3. Choisir **Activer sur cet appareil**, puis attendre la confirmation. L’autorisation accordée à recette ne vaut pas pour la nouvelle adresse.
4. Sur iPhone/iPad, ajouter **la nouvelle adresse** à l’écran d’accueil depuis Partager, puis ouvrir Jessie depuis cette nouvelle icône avant d’activer les notifications. Selon l’installation, son stockage peut être distinct de celui du navigateur : une connexion normale peut alors être nécessaire une fois. Conserver l’ancienne icône tant que la nouvelle n’a pas été testée.

Les réglages dépendent de l’adresse, de l’appareil et du profil de navigateur. Deux comptes dans deux profils distincts ont chacun leur activation. Le compte client de test et l’administrateur déjà utilisés en recette suffisent ; aucun nouveau compte n’est nécessaire.

**Conserver les anciennes connexions et inscriptions pendant les essais. Ne pas se déconnecter de recette pour terminer la reprise :** le pont réutilise le même enregistrement de session, donc une déconnexion ou révocation de ce jeton vaut pour les deux adresses. Après avoir validé une alerte de la nouvelle adresse, on peut désactiver uniquement les notifications de recette sur cet appareil, depuis son panneau **Notifications → Désactiver sur cet appareil**. Cette action ne déconnecte pas le compte et laisse les autres appareils inchangés.

Le profil autorise seize inscriptions Push actives par compte. Tant que les deux adresses restent activées sur un appareil, celui-ci peut recevoir deux alertes. Ne supprimer ni l’ancienne installation ni son inscription avant la validation de la nouvelle.

## Parcours à confirmer

Ces lignes précisent les dimensions que le retour global positif de 17:28 ne détaille pas. Elles servent au relevé des autres appareils et n’annulent pas l’acceptation du parcours déjà essayé.

| Essai | Action | Résultat attendu | État |
| --- | --- | --- | --- |
| Reprise administrateur | Rejoindre l’adresse principale depuis le navigateur où recette est encore connecté. | Conversations retrouvées sans mot de passe ni code ; ancienne connexion conservée. | À confirmer |
| Reprise client | Même parcours avec le client de test. | Conversation retrouvée, ou page d’accès correspondant aux droits actuels, sans nouveau droit créé. | À confirmer |
| Client vers Jessie | Fermer les pages destinataires ; envoyer depuis le client et attendre l’alerte. | Alerte **Jessie — Un nouveau message t’attend.**, puis clic vers la bonne conversation et le message mis en évidence. | À confirmer |
| Jessie vers client | Fermer les pages destinataires client ; envoyer depuis l’administrateur. | Même alerte discrète ; bon message après ouverture, sans identification si la connexion est valable. | À confirmer |
| Photo | Refaire un envoi avec une photo depuis le compte opposé. | Alerte générique ; photo accessible dans la conversation après ouverture. | À confirmer |
| Brouillon ouvert | Si utile, cliquer sur une nouvelle alerte alors qu’un brouillon est déjà saisi. | Destination atteinte sans perdre le brouillon existant. | À confirmer |
| Plusieurs appareils | Activer le même compte administrateur sur ordinateur et téléphone ; fermer les pages destinataires et envoyer depuis le client. | Réception sur les appareils activés ; accès conservés simultanément. | À confirmer |
| Réglage indépendant | Désactiver les notifications sur un seul appareil, laisser l’autre activé, refaire l’envoi. | Le second continue à recevoir ; le premier reste désactivé. Réactiver ensuite si souhaité. | À confirmer |
| Sessions du foyer | Utiliser simultanément les ordinateurs/téléphones habituels, puis fermer et rouvrir l’application. | Reprise des six à huit sessions prévues sans déconnexion causée par les autres appareils. | À confirmer |

Un message lu ou supprimé avant son traitement peut ne plus déclencher d’envoi. Garder les pages destinataires fermées jusqu’à l’alerte pendant ces essais. Une alerte déjà acceptée par le fournisseur ne peut pas être rappelée.

## Limites des vérifications et relevé

Sans compte connecté, les contrôles peuvent confirmer HTTPS, routage, fichiers exacts, service worker, manifeste et refus des accès anonymes. Les tests synthétiques couvrent les règles de reprise et de clic. Seuls les appareils réels peuvent confirmer leurs cookies existants, permissions, livraison page fermée, clic sur l’alerte système et réouverture de leur installation.

| Plateforme | Reprise sur la nouvelle adresse | Activation affichée | Alerte page fermée | Clic / bon message | Session après réouverture |
| --- | --- | --- | --- | --- | --- |
| Ordinateur / navigateur à préciser | À confirmer | À confirmer | À confirmer | À confirmer | À confirmer |
| Android / navigateur à préciser | À confirmer | À confirmer | À confirmer | À confirmer | À confirmer |
| iPhone/iPad / version à préciser, si utilisé | À confirmer | À confirmer | À confirmer | À confirmer | À confirmer |

Le retour utile indique l’appareil, le navigateur, le sens d’envoi et le résultat observé, ou le texte de l’erreur. Aucune phrase de coffre, clé ou valeur d’abonnement n’est nécessaire.
