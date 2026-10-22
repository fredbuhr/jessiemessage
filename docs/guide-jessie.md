# Jessie — guide quotidien

Retrouve ton espace sur [jessiemessage.com](https://jessiemessage.com/) et l’[aide du site](https://jessiemessage.com/help).

**Ce guide décrit les parcours préparés pour la 1.8.3, dont le code est fusionné. La production confirmée reste en 1.8.2**, avec ses métadonnées alignées selon le [reçu utilisateur](verification-proofs/jm182-hosted-metadata.json). Une publication de la 1.8.3 ne vaut pas activation sur l’hébergement : consulte [REPRISE](REPRISE.md) pour l’état courant avant d’attendre les nouveaux écrans décrits ici. Les retours antérieurs confirment le fonctionnement de la [liste commune](verification-proofs/jm181-hosted-interface.json) et du [parcours vidéo](verification-proofs/jm180-hosted-interface.json), sans nouvelle recette hébergée présumée. La sauvegarde manuelle reste non vérifiée et son test est reporté à ta demande.

## Se connecter et gérer les accès

- Côté client, [l’adresse principale](https://jessiemessage.com/) et l’app installée ouvrent directement la conversation si la connexion et l’accès sont actifs. Sinon, le formulaire de connexion s’affiche ; un accès encore en attente ou expiré mène à son état d’accès. La reprise depuis l’ancienne adresse reste un parcours de migration séparé.
- Ouvre [la connexion administrateur](https://jessiemessage.com/admin/login), sans barre finale après `login`, avec ton adresse e-mail, ton mot de passe et le code de ton application d’authentification. Chaque appareil possède sa propre connexion. Après connexion, [Administration](https://jessiemessage.com/admin) affiche l’accueil et ses outils.
- Choisis **Ouvrir les conversations** ou **Messagerie** pour retrouver les messages. Depuis la messagerie et les outils, **Accueil admin** revient à l’accueil.
- Dans [Invitations et clients](https://jessiemessage.com/admin/clients), crée une invitation et copie son lien. Après la création du compte et la confirmation de l’e-mail par le client, approuve son accès depuis sa carte. Cette gestion est séparée de l’accueil administrateur.
- Si les deux espaces sont connectés sur le même appareil, **Choisis ton espace.** propose **Ma conversation** et **Administration**. Le site attend ton choix.
- Côté client, **Options → Mon accès** conserve l’accès au compte et le lien **Ouvrir ma conversation**.
- **Compte et appareils → Appareils connectés** permet de consulter les connexions et de déconnecter l’appareil choisi.
- Suspension, expiration, révocation d’accès et déconnexion conservent la conversation ; elles ne ferment pas définitivement le compte.

## Consulter l’état du service

Dans [État du service](https://jessiemessage.com/admin/readiness), consulte les fonctions configurées et les mesures du serveur. **Vérifier la connexion e-mail** est facultatif : ce contrôle vérifie la connexion et l’authentification sans envoyer d’e-mail. Les **Contrôles ponctuels** servent après un changement ou en cas de problème ; les essais déjà réussis ne sont pas à répéter systématiquement.

## Profil et emojis

Les fonctions de profil et le catalogue existent déjà ; les changements de présentation ci-dessous sont ceux de la 1.8.3. [REPRISE](REPRISE.md) reste la référence de livraison.

**Mon profil.** Dans la messagerie, ouvre **Options → Mon profil** pour modifier ton **Nom public**, limité à 64 caractères et visible dans tes échanges. Il est distinct du surnom privé enregistré dans une **Fiche**. Avec **Choisir ou remplacer l’avatar**, sélectionne une photo et vérifie son aperçu rond ; **Retirer l’avatar** prépare son retrait. Choisis **Enregistrer le profil** pour appliquer le nom et l’avatar. Si le profil a changé ailleurs, recharge la version enregistrée ou garde ton brouillon, puis confirme l’enregistrement.

**Emojis.** Ouvre `☺` (**Emojis**) à côté de la saisie : les 268 choix sont accessibles par catégories, sans champ de recherche en 1.8.3. Le choix s’insère à la position du curseur ; adapte le message puis choisis **Envoyer**. La sélection ne déclenche aucun envoi automatique.

Le [catalogue enrichi en 1.3.0](emoji-inclusifs-130.md) conserve **Doubles sens**, des gestes et des personnages adultes. Dans **Couleur de peau**, choisis l’une des cinq carnations ou le rendu par défaut : la grille adapte les mains, doigts et personnages compatibles, y compris les peaux foncées. Le choix reste disponible pendant l’utilisation de la page et se réinitialise avec l’état du compte. Un emoji choisi s’ajoute toujours au brouillon ; vérifie le message avant **Envoyer**.

## Conversation mobile en 1.8.3

La conversation mobile dispose d’une barre avec l’avatar, le nom et **Options** ; le retour aux conversations reste accessible dans l’administration.

**Options** regroupe le compte, le profil, les notifications, la langue et les médias disponibles. **Autres options** contient Contact, **Aide et confidentialité** et, côté client, **Télécharger ma conversation**. Sous les messages, `+` propose l’ajout d’une photo ou d’une vidéo, la bibliothèque et les réponses rapides selon les fonctions disponibles ; `☺` ouvre les emojis. La saisie et **Envoyer** restent directement accessibles. Choisir une photo, une vidéo, une réponse ou un emoji prépare toujours un brouillon avant envoi. Les erreurs et la reprise d’un envoi incertain restent affichées quand nécessaires.

Sur appareil tactile, la 1.8.3 évite de remettre automatiquement le curseur dans la saisie après un envoi ou l’utilisation des menus, du profil, des médias et des emojis. Touche le champ lorsque tu veux écrire une légende ou poursuivre ton message. Le comportement réel du clavier dépend aussi de l’appareil.

La présentation mobile 1.3.1 avait été validée visuellement par l’utilisateur ; la 1.3.3 et le [socle 1.3.2](client-voice-message-details-132.md) conservent leurs preuves historiques dans [REPRISE](REPRISE.md). Ces reçus antérieurs ne constituent pas une validation hébergée de tous les nouveaux parcours 1.8.3 sur téléphone physique.

### Sélection et détails des messages

Touche ou clique sur le texte d’un message ou sa légende pour afficher la date, les métadonnées et les actions disponibles. La 1.8.3 retire le petit bouton `⋯` à côté des messages. Au clavier, rejoins le bouton **Détails** avec **Tab**, puis ouvre-le avec **Entrée** ou **Espace** ; il devient visible au focus et son nom accessible précise **Détails du message du…**. Pour masquer les détails, sélectionne de nouveau le message, choisis un autre message, clique en dehors ou utilise **Échap**. Une seule sélection reste ouverte à la fois.

La sélection n’envoie rien et ne supprime rien. Dans l’interface 1.8.3, **Supprimer** est réservé à l’administrateur pour ses propres messages, avec confirmation. L’administration conserve la mention d’un message supprimé ; ce message disparaît de la conversation affichée au client. Les informations **Envoyé** ou **Lu** se consultent dans les détails selon le rôle ; le client conserve uniquement **Envoyé** sur ses propres messages. Clique sur une photo pour l’agrandir ; sélectionner sa légende ouvre les détails. Les erreurs et **Réessayer cet envoi** restent directement visibles quand une reprise est nécessaire.

## Échanger et partager une photo ou une vidéo

- Dans [Messages](https://jessiemessage.com/admin/messages), sélectionne la conversation et vérifie le nom avant d’envoyer.
- Écris ton texte, puis choisis **Envoyer**. **Envoyé** confirme l’enregistrement ; dans ton administration, **Lu** indique que le client a affiché le message dans sa conversation visible. Cela ne certifie pas une lecture attentive. À partir de **1.1.0**, le client voit seulement **Envoyé** sur ses propres messages, sans indication de ta lecture. La [version réellement active](REPRISE.md) détermine la disponibilité de cette évolution ; les accusés restent symétriques en 1.0.0.
- Si la confirmation manque, utilise **Réessayer cet envoi** : ce bouton reprend le même message.
- Avec **+ → Ajouter une photo**, choisis l’image et vérifie l’aperçu et la légende avant **Envoyer**. **Retirer la photo** annule la sélection.
- **+ → Mes photos** ouvre ta bibliothèque ; **Options → Photos** retrouve les images partagées dans cet échange.
- Avec **+ → Ajouter une vidéo**, choisis un fichier **MP4 de 100 MiB maximum** et vérifie l’aperçu local. **Retirer la vidéo** annule la sélection. Le transfert et l’envoi commencent seulement avec **Envoyer** ; **Options → Vidéos** retrouve les vidéos partagées dans l’échange. La lecture dépend des codecs acceptés par l’appareil.
- **+ → Réponses rapides** ajoute une phrase au brouillon, sans l’envoyer. Choisis sa langue, adapte le texte, puis utilise **Envoyer**.
- Dans l’administration, **Supprimer** retire tes propres messages après confirmation. Pour retirer aussi une photo de **Mes photos**, supprime d’abord les messages qui l’utilisent encore. Côté client, la 1.8.3 ne propose plus la suppression d’un message dans la conversation ; la gestion de **Mes photos** reste séparée.

### Tes réponses personnelles

Dans [Messages](https://jessiemessage.com/admin/messages), sélectionne une conversation, ouvre **+ → Réponses rapides**. Les six phrases proposées et tes réponses enregistrées sont réunies dans la même liste, selon la langue choisie. Choisis **Nouvelle réponse**, remplis **Titre de la réponse**, **Langue de la réponse** et **Texte de la réponse**, puis **Enregistrer la réponse**. Le catalogue accepte jusqu’à 50 phrases, avec un titre de 64 caractères et un texte de 4 096 caractères au maximum. Les six phrases proposées restent fixes. Pour tes seules réponses ajoutées, **Modifier** reprend une phrase ; **Supprimer**, puis sa confirmation, la retire.

Attends la confirmation **Réponses personnelles enregistrées.** : c’est cette phrase du catalogue qui est conservée, indépendamment du texte préparé pour un message. Après rechargement de la page, sélectionne de nouveau la conversation, ouvre **+ → Réponses rapides**, choisis la **Langue des réponses** correspondant à celle enregistrée, puis retrouve la phrase dans la liste commune. Clique dessus pour l’insérer dans le brouillon : cela n’envoie aucun message. Les réponses enregistrées restent privées et se retrouvent dans tes sessions administrateur. Si une autre session les a modifiées ou si la confirmation manque, ton texte en cours reste affiché : utilise **Recharger les réponses enregistrées**, vérifie le résultat, puis enregistre explicitement si nécessaire.

## Fiches, notes et travail sur deux appareils

Ouvre **Options → Fiche** pour modifier le surnom privé, les notes, les tags, les groupes et le rappel. Ces informations restent dans ton espace administrateur. Le rappel est une date de suivi, sans notification automatique.

Clique sur **Enregistrer la fiche** et attends **Fiche enregistrée**.

Si **La fiche a été modifiée ailleurs** apparaît, ton brouillon reste visible. Compare les **Notes enregistrées**, puis choisis :

- **Recharger la fiche** reprend la version enregistrée et abandonne ton brouillon de fiche ;
- **Enregistrer ma version** la remplace explicitement par la tienne. Une nouvelle modification simultanée peut provoquer un autre conflit.

Depuis 1.8.2, le texte non envoyé du message peut se retrouver après rechargement dans le **même onglet**, pour le même compte et la même connexion, après vérification de l’accès à la conversation. Cette conservation est limitée et dépend de l’autorisation du navigateur ; si elle est indisponible, le texte reste seulement dans la page ouverte. Elle ne synchronise pas tes brouillons entre appareils. Les fichiers photo et vidéo sélectionnés doivent être ajoutés de nouveau après rechargement. Si un envoi texte n’a pas reçu sa confirmation, la reprise conserve la même demande et attend ton action : aucun message n’est envoyé automatiquement.

Une phrase enregistrée dans **Réponses rapides** reste disponible dans le catalogue. Les modifications de fiche non enregistrées restent dans la page ouverte, sans synchronisation entre appareils. Enregistre tes notes et conserve le texte important avant de fermer l’onglet ou de te déconnecter. Après une coupure réseau, garde l’onglet ouvert et utilise **Réessayer la connexion**.

## Tâches et rappels privés

**Ce parcours est disponible depuis la livraison 1.6.0 close et conservé dans la version active indiquée par REPRISE.** Le [relevé d’identité et l’état de livraison](REPRISE.md) restent la référence. Aucun nouveau réglage, Build ou redémarrage n’est nécessaire pour utiliser ces fonctions.

Depuis la conversation d’un client, ouvre **Options → Fiche → Tâches du client**, puis **Ajouter une tâche**. Écris ce que tu veux préparer ou envoyer, ajoute une échéance si utile, puis choisis **Enregistrer la tâche**. Tu peux garder plusieurs tâches pour le même client. Ces informations restent dans ton administration ; le client ne les voit pas.

**Accueil admin → Tâches privées** rassemble les clients. Les filtres **À faire**, **À traiter maintenant** et **Terminées** retrouvent les tâches par pages ; **Autres tâches** affiche la suite. **Reporter** ouvre la date à modifier ; **Terminer** et **Réouvrir** changent le statut sans créer une autre tâche.

Si la confirmation manque, utilise **Vérifier et réessayer** pour reprendre la même demande. Si une autre personne a modifié la tâche depuis un autre appareil, compare la version enregistrée : **Reprendre cette version** la recharge, **Enregistrer mon brouillon** confirme explicitement le remplacement. **Fermer** conserve le brouillon dans la page ; **Abandonner le brouillon** permet de passer à autre chose. Enregistre-le avant de fermer la page ou de te déconnecter.

Les rappels sont visibles lorsque l’application est ouverte et sont actualisés à son retour au premier plan. **Il n’y a pas de notification de tâche lorsque l’application est fermée**, et aucune alerte ni message n’est envoyé au client. L’ancienne date de suivi de la Fiche reste séparée de ces tâches et ne se transforme pas automatiquement en tâche.

## Notifications sur chaque appareil

Ouvre **Options → Notifications** dans la messagerie, ou **Compte et appareils** dans Administration. Choisis **Activer sur cet appareil** et accepte la demande du navigateur sur chaque appareil souhaité.

Les réglages concernent cet appareil et l’adresse Jessie ouverte. Après une reconnexion, le panneau peut proposer **Reconnecter sur cet appareil** : choisis ce bouton pour rétablir les notifications sur cette connexion. Si le site demande **Réinitialiser sur cet appareil**, utilise-le, puis choisis **Activer sur cet appareil** ; cette action laisse les autres appareils inchangés. L’ouverture du panneau vérifie son état sans activer les notifications à ta place.

Sur iPhone ou iPad, utilise **Partager → Sur l’écran d’accueil** dans Safari, puis ouvre Jessie depuis son icône pour activer les notifications.

Si une alerte manque, vérifie Internet, les autorisations du navigateur et le mode silencieux, puis choisis **Vérifier à nouveau**. Si le navigateur les bloque, autorise les notifications dans les réglages de ce site, puis vérifie de nouveau. Une alerte peut être retardée : ouvre directement la conversation. Après une nouvelle connexion ou un changement de mot de passe, vérifie les notifications. La 1.8.3 demande à l’appareil de signaler chaque nouvelle alerte ; le son et l’affichage restent soumis au navigateur et aux réglages du système.

Une alerte n’affiche ni nom, ni texte, ni photo du message. La désactivation sur un appareil laisse les autres appareils inchangés. [Aide notifications](https://jessiemessage.com/help#notifications).

## Télécharger une conversation

Dans ton administration, ouvre **Options → Fiche → Télécharger la conversation**. Côté client, la commande discrète se trouve dans **Options → Autres options → Télécharger ma conversation**. Choisis **Inclure les photos partagées** et **Inclure les vidéos partagées** selon les choix proposés à ton compte, puis **Télécharger le ZIP**. Extrais-le et ouvre `Conversation.html` pour lire hors ligne ; `conversation.json` contient la version portable. Le ZIP est transmis progressivement, avec une limite totale de **256 MiB**. La lecture des vidéos exportées dépend des codecs de l’appareil.

L’export exclut les notes et surnoms privés, tags, groupes, tâches privées, réponses personnelles et médias non partagés. Il n’enregistre pas le brouillon de fiche. À partir de 1.1.0, l’export personnel du client ne contient pas non plus ton point de lecture ; les ZIP de conversation ne contiennent déjà aucun reçu de lecture. Le ZIP contient des échanges lisibles : garde-le dans un emplacement privé. [Détails de l’export](conversation-export-058.md).

## Diffusions à grande échelle

Ce parcours est disponible depuis la livraison 1.4.0 close et reste présent dans la version active indiquée par [REPRISE](REPRISE.md). Les références et replis historiques y conservent leurs preuves propres.

Depuis **Accueil admin → Diffusions**, ou [Diffusions](https://jessiemessage.com/admin/broadcasts), choisis une sélection manuelle, tous les clients ou tous les clients correspondant aux filtres. Un choix global comprend aussi les pages qui ne sont pas affichées. Renseigne **Titre pour ton historique**, puis prépare ton texte ou une pièce jointe, photo ou vidéo.

La 1.8.3 demande deux actions distinctes :

1. **Vérifier et préparer l’envoi** calcule les destinataires éligibles. Le nombre de destinataires **choisis · à vérifier** devient un nombre d’envois **préparés** ; seuls les premiers noms s’affichent comme aperçu. Vérifie ce récapitulatif et les éventuels médias déjà reçus.
2. **Envoyer à … clients** (ou **Envoyer à … client** pour une seule personne) lance la diffusion préparée. Le bouton reste indisponible tant que la préparation ne permet pas l’envoi. L’ancienne case générale de confirmation est retirée ; l’autorisation spécifique de renvoyer une pièce jointe déjà partagée peut encore être demandée.

Un changement d’audience, de filtres, de titre, de texte, de photo ou de vidéo demande une nouvelle préparation. Si l’ensemble a changé entre l’aperçu et la confirmation, l’envoi doit être revérifié. Après un résultat d’envoi incertain, **Vérifier et réessayer cette diffusion** réutilise la même demande. Le suivi présente les compteurs et les destinataires par pages, pendant que les messages sont traités progressivement. Chaque client reçoit son message dans sa conversation privée ; aucun salon collectif n’est créé.

## Sauvegarde manuelle depuis l’administration

Dans [Sauvegardes](https://jessiemessage.com/admin/backups), choisis **Créer une sauvegarde**. Le site affiche **Demande de sauvegarde en attente.**, puis **Sauvegarde en cours. La messagerie peut être momentanément indisponible.**, et enfin **Sauvegarde terminée.** **Actualiser l’état** consulte le résultat sans lancer une nouvelle sauvegarde. Si la confirmation manque, vérifie cet état avant de réessayer.

Sous **Dernière sauvegarde disponible**, vérifie la date et la taille, puis choisis **Télécharger**. Le fichier reste chiffré ; conserve-le dans un endroit privé. Ce parcours fonctionne sans PC raccordé et sans sauvegarde ni archivage automatiques. Les archives historiques, clés, reçus et anciens raccordements restent préservés ; aucune manipulation de clé ni nouveau raccordement n’est nécessaire.

Une sauvegarde téléchargée ne certifie pas encore son déchiffrement ou une restauration de l’application. Les [copies PC](backup-destinations-055.md) décrivent le parcours historique, qui n’est pas nécessaire à cette sauvegarde manuelle.

### Test de sauvegarde reporté

La livraison 1.8.2 est alignée ; le [retour interface 1.8.1](verification-proofs/jm181-hosted-interface.json) conserve ta confirmation de fonctionnement de la liste commune sans détailler tous les sous-cas. La sauvegarde reste non vérifiée : tu as demandé de la tester un autre jour après la page Infomaniak affichée avant l’écran de sauvegarde. Aucun nouvel essai ni diagnostic n’est demandé aujourd’hui.

Lorsque tu décideras de reprendre ce test, il s’agira de créer une sauvegarde, d’attendre sa fin puis de télécharger le fichier chiffré. Sa préparation peut interrompre brièvement la messagerie : conserver alors tes brouillons avant de commencer. Aucune manipulation du PC, fermeture de compte ou restauration n’est nécessaire à ce contrôle. Les parcours physiques et les performances de l’hébergement gardent leurs limites de qualification.

## Fermeture définitive et remise en service

Voir l’[état courant](REPRISE.md) pour le service déployé et ses limites.

L’administrateur peut choisir **Fermer définitivement** dans la carte du client, vérifier le compte et la portée, cocher la confirmation et écrire **FERMER**. **Fermeture des comptes** affichera le suivi. L’action irréversible efface le compte, sa conversation, ses notes privées et les médias appartenant au client dans l’application. Le service peut être brièvement interrompu ; sauvegardes et téléchargements restent des copies séparées.

Une restauration se fait manuellement en maintenance, avec la personne chargée de l’exploitation et un contrôle des comptes fermés avant réouverture. Les messages postérieurs à la sauvegarde choisie peuvent être perdus ; la récupération dépend de la copie effectivement conservée. [Parcours opérateur](manual-restore-operator-078.md).

Pour une question, consulte l’[aide](https://jessiemessage.com/help) ou [contact@jessiemessage.com](mailto:contact@jessiemessage.com). Ne transmets jamais ton mot de passe ni tes codes.
