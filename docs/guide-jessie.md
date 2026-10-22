# Jessie — guide quotidien

Retrouve ton espace sur [jessiemessage.com](https://jessiemessage.com/app) et l’[aide du site](https://jessiemessage.com/help).

La version **1.8.0** est active. La [preuve de mise en service et d’alignement](verification-proofs/jm180-hosted-metadata.json), transmise par l’utilisateur, confirme la source `fd6e53b14b520231b0b307a2761331dd8c740a5b`, Node **24.22.1** et SQL **36** ; la mise à jour est enregistrée et la dernière livraison publiée est aussi 1.8.0. [REPRISE](REPRISE.md) conserve les références techniques. Les essais des nouveaux parcours dans ton navigateur restent à terminer.

## Se connecter et gérer les accès

- Ouvre [Administration](https://jessiemessage.com/admin) avec ton mot de passe et le code de ton application d’authentification. Chaque appareil possède sa propre connexion.
- Choisis **Ouvrir les conversations** pour retrouver les messages.
- Dans **Invitations et clients**, crée une invitation et copie son lien. Après la création du compte et la confirmation de l’e-mail par le client, approuve son accès depuis sa carte.
- **Compte et appareils → Appareils connectés** permet de consulter les connexions et de déconnecter l’appareil choisi.
- Suspension, expiration, révocation d’accès et déconnexion conservent la conversation ; elles ne ferment pas définitivement le compte.

## Consulter l’état du service

Dans [État du service](https://jessiemessage.com/admin/readiness), consulte les fonctions configurées et les mesures du serveur. **Vérifier la connexion e-mail** est facultatif : ce contrôle vérifie la connexion et l’authentification sans envoyer d’e-mail. Les **Contrôles ponctuels** servent après un changement ou en cas de problème ; les essais déjà réussis ne sont pas à répéter systématiquement.

## Profil et emojis

Ces parcours sont disponibles dans la version active ; [REPRISE](REPRISE.md) reste la référence de livraison.

**Mon profil.** Dans la messagerie, ouvre **Options → Mon profil** pour modifier ton **Nom public**, limité à 64 caractères et visible dans tes échanges. Il est distinct du surnom privé enregistré dans une **Fiche**. Avec **Choisir ou remplacer l’avatar**, sélectionne une photo et vérifie son aperçu rond ; **Retirer l’avatar** prépare son retrait. Choisis **Enregistrer le profil** pour appliquer le nom et l’avatar. Si le profil a changé ailleurs, recharge la version enregistrée ou garde ton brouillon, puis confirme l’enregistrement.

**Emojis.** Ouvre `☺` (**Emojis**) à côté de la saisie : les 268 choix sont accessibles par catégories et par recherche en français ou en anglais. Le choix s’insère à la position du curseur ; adapte le message puis choisis **Envoyer**. La sélection ne déclenche aucun envoi automatique.

Le [catalogue enrichi en 1.3.0](emoji-inclusifs-130.md) ajoute **Doubles sens**, des gestes et des personnages adultes. Recherche les noms en français ou en anglais, par exemple « concombre », « courgette » ou « cucumber » pour 🥒. Dans **Couleur de peau**, choisis l’une des cinq carnations ou le rendu par défaut : la grille adapte les mains, doigts et personnages compatibles, y compris les peaux foncées. Le choix reste disponible pendant l’utilisation de la page et se réinitialise avec l’état du compte. Un emoji choisi s’ajoute toujours au brouillon ; vérifie le message avant **Envoyer**.

## Conversation mobile depuis 1.3.1

La [version active identifiée dans REPRISE](REPRISE.md) conserve la disposition mobile livrée depuis 1.3.1. La conversation mobile dispose d’une seule barre avec l’avatar, le nom et **Options** ; le retour aux conversations reste accessible dans l’administration.

**Options** regroupe le compte, le profil, les notifications, la langue, Contact et Aide. Les photos, les vidéos de la conversation et son téléchargement y sont accessibles lorsqu’ils sont disponibles pour ton compte. Sous les messages, `+` propose l’ajout d’une photo ou d’une vidéo, la bibliothèque et les réponses rapides selon les fonctions disponibles ; `☺` ouvre les emojis. La saisie et **Envoyer** restent directement accessibles. Choisir une photo, une vidéo, une réponse ou un emoji prépare toujours un brouillon avant envoi. Les erreurs et la reprise d’un envoi incertain restent affichées quand nécessaires.

La présentation mobile 1.3.1 a été validée visuellement par l’utilisateur. La 1.3.3 a conservé cette disposition, les textes côté client à la première personne de Jessie et les messages plus compacts du [socle 1.3.2](client-voice-message-details-132.md), avec un bouton de détails visible au toucher pour les photos. Le précontrôle hébergé, le relevé admin et le reçu final confirment la préparation, l’activation et l’enregistrement de cette livraison désormais historique et close dans [REPRISE](REPRISE.md). Tous les parcours sur téléphone physique et le clavier logiciel ne sont pas explicitement attestés.

### Détails des messages depuis 1.3.3

Touche ou clique sur le texte d’un message pour afficher sa date, ses métadonnées et les actions disponibles. Pour une photo, utilise le petit bouton `⋯` visible à côté de l’image, avec ou sans légende. Au clavier, rejoins le bouton **Détails du message du…** avec **Tab**, puis ouvre-le avec **Entrée** ou **Espace** ; pour les messages texte, le bouton `⋯` devient visible au focus. Pour masquer les détails, sélectionne de nouveau le message, choisis un autre message, clique en dehors ou utilise **Échap**. Une seule sélection reste ouverte à la fois.

La sélection n’envoie rien et ne supprime rien. Les commandes **Supprimer** et les informations **Envoyé** ou **Lu** se consultent dans ces détails selon tes droits ; le client conserve uniquement **Envoyé** sur ses propres messages. Clique sur une photo pour l’agrandir ; sélectionner sa légende ouvre les détails. Les erreurs et **Réessayer cet envoi** restent directement visibles quand une reprise est nécessaire.

## Échanger et partager une photo ou une vidéo

- Dans [Messages](https://jessiemessage.com/admin/messages), sélectionne la conversation et vérifie le nom avant d’envoyer.
- Écris ton texte, puis choisis **Envoyer**. **Envoyé** confirme l’enregistrement ; dans ton administration, **Lu** indique que le client a affiché le message dans sa conversation visible. Cela ne certifie pas une lecture attentive. À partir de **1.1.0**, le client voit seulement **Envoyé** sur ses propres messages, sans indication de ta lecture. La [version réellement active](REPRISE.md) détermine la disponibilité de cette évolution ; les accusés restent symétriques en 1.0.0.
- Si la confirmation manque, utilise **Réessayer cet envoi** : ce bouton reprend le même message.
- Avec **+ → Ajouter une photo**, choisis l’image et vérifie l’aperçu et la légende avant **Envoyer**. **Retirer la photo** annule la sélection.
- **+ → Mes photos** ouvre ta bibliothèque ; **Options → Photos** retrouve les images partagées dans cet échange.
- Avec **+ → Ajouter une vidéo**, choisis un fichier **MP4 de 100 MiB maximum** et vérifie l’aperçu local. **Retirer la vidéo** annule la sélection. Le transfert et l’envoi commencent seulement avec **Envoyer** ; **Options → Vidéos** retrouve les vidéos partagées dans l’échange. La lecture dépend des codecs acceptés par l’appareil.
- **+ → Réponses rapides** ajoute une phrase au brouillon, sans l’envoyer. Choisis sa langue, adapte le texte, puis utilise **Envoyer**.
- Tu peux supprimer tes propres messages. Pour retirer aussi une photo de **Mes photos**, supprime d’abord les messages qui l’utilisent encore.

### Tes réponses personnelles

Dans [Messages](https://jessiemessage.com/admin/messages), sélectionne une conversation, ouvre **+ → Réponses rapides**, puis retrouve la section **Mes réponses**. Choisis **Nouvelle réponse**, remplis **Titre de la réponse**, **Langue de la réponse** et **Texte de la réponse**, puis **Enregistrer la réponse**. Le catalogue accepte jusqu’à 50 phrases, avec un titre de 64 caractères et un texte de 4 096 caractères au maximum. **Modifier** reprend une phrase ; **Supprimer**, puis sa confirmation, la retire.

Les réponses enregistrées restent privées et se retrouvent dans tes sessions administrateur. Clique sur une phrase pour l’insérer dans le brouillon : cela n’envoie aucun message. Si une autre session les a modifiées ou si la confirmation manque, ton texte en cours reste affiché : utilise **Recharger les réponses enregistrées**, vérifie le résultat, puis enregistre explicitement si nécessaire.

## Fiches, notes et travail sur deux appareils

Ouvre **Options → Fiche** pour modifier le surnom privé, les notes, les tags, les groupes et le rappel. Ces informations restent dans ton espace administrateur. Le rappel est une date de suivi, sans notification automatique.

Clique sur **Enregistrer la fiche** et attends **Fiche enregistrée**.

Si **La fiche a été modifiée ailleurs** apparaît, ton brouillon reste visible. Compare les **Notes enregistrées**, puis choisis :

- **Recharger la fiche** reprend la version enregistrée et abandonne ton brouillon de fiche ;
- **Enregistrer ma version** la remplace explicitement par la tienne. Une nouvelle modification simultanée peut provoquer un autre conflit.

Le texte du message en cours et les modifications de fiche non enregistrées restent dans la page ouverte, sans synchronisation entre appareils. Enregistre tes notes et conserve ton texte avant de recharger, fermer ou te déconnecter. Après une coupure réseau, garde l’onglet ouvert et utilise **Réessayer la connexion**.

## Tâches et rappels privés

**Ce parcours est disponible depuis la livraison 1.6.0 close et conservé dans la version active indiquée par REPRISE.** Le [relevé d’identité et l’état de livraison](REPRISE.md) restent la référence. Aucun nouveau réglage, Build ou redémarrage n’est nécessaire pour utiliser ces fonctions.

Depuis la conversation d’un client, ouvre **Options → Fiche → Tâches du client**, puis **Ajouter une tâche**. Écris ce que tu veux préparer ou envoyer, ajoute une échéance si utile, puis choisis **Enregistrer la tâche**. Tu peux garder plusieurs tâches pour le même client. Ces informations restent dans ton administration ; le client ne les voit pas.

**Options → Mes tâches**, ou le lien **Mes tâches** dans Administration, rassemble les clients. Les filtres **À faire**, **À traiter maintenant** et **Terminées** retrouvent les tâches par pages ; **Autres tâches** affiche la suite. Le menu indique discrètement le nombre arrivé à échéance. **Reporter** ouvre la date à modifier ; **Terminer** et **Réouvrir** changent le statut sans créer une autre tâche.

Si la confirmation manque, utilise **Vérifier et réessayer** pour reprendre la même demande. Si une autre personne a modifié la tâche depuis un autre appareil, compare la version enregistrée : **Reprendre cette version** la recharge, **Enregistrer mon brouillon** confirme explicitement le remplacement. **Fermer** conserve le brouillon dans la page ; **Abandonner le brouillon** permet de passer à autre chose. Enregistre-le avant de fermer la page ou de te déconnecter.

Les rappels sont visibles lorsque l’application est ouverte et sont actualisés à son retour au premier plan. **Il n’y a pas de notification de tâche lorsque l’application est fermée**, et aucune alerte ni message n’est envoyé au client. L’ancienne date de suivi de la Fiche reste séparée de ces tâches et ne se transforme pas automatiquement en tâche.

## Notifications sur chaque appareil

Ouvre **Options → Notifications** dans la messagerie, ou **Compte et appareils** dans Administration. Choisis **Activer sur cet appareil** et accepte la demande du navigateur sur chaque appareil souhaité.

Sur iPhone ou iPad, utilise **Partager → Sur l’écran d’accueil** dans Safari, puis ouvre Jessie depuis son icône pour activer les notifications.

Si une alerte manque, vérifie Internet, les autorisations du navigateur et le mode silencieux, puis **Vérifier à nouveau**. Une alerte peut être retardée : ouvre directement la conversation. Après une nouvelle connexion ou un changement de mot de passe, vérifie les notifications.

Une alerte n’affiche ni nom, ni texte, ni photo du message. La désactivation sur un appareil laisse les autres appareils inchangés. [Aide notifications](https://jessiemessage.com/help#notifications).

## Télécharger une conversation

Dans **Fiche → Télécharger la conversation**, choisis **Inclure les photos partagées** et **Inclure les vidéos partagées** selon ton besoin, puis **Télécharger le ZIP**. Extrais-le et ouvre `Conversation.html` pour lire hors ligne ; `conversation.json` contient la version portable. Le ZIP est transmis progressivement, avec une limite totale de **256 MiB**. La lecture des vidéos exportées dépend des codecs de l’appareil.

L’export exclut les notes et surnoms privés, tags, groupes, tâches privées, réponses personnelles et médias non partagés. Il n’enregistre pas le brouillon de fiche. À partir de 1.1.0, l’export personnel du client ne contient pas non plus ton point de lecture ; les ZIP de conversation ne contiennent déjà aucun reçu de lecture. Le ZIP contient des échanges lisibles : garde-le dans un emplacement privé. [Détails de l’export](conversation-export-058.md).

## Diffusions à grande échelle

Ce parcours est disponible depuis la livraison 1.4.0 close et reste présent dans la version active indiquée par [REPRISE](REPRISE.md). Les références et replis historiques y conservent leurs preuves propres.

Dans [Diffusions](https://jessiemessage.com/admin/broadcasts), choisis une sélection manuelle, tous les clients ou tous les clients correspondant aux filtres. Un choix global comprend aussi les pages qui ne sont pas affichées. Le message peut inclure une photo ou une vidéo. La prévisualisation annonce le nombre réellement éligible et les éventuels médias déjà reçus ; seuls les premiers noms s’affichent comme aperçu. Confirme explicitement le nombre avant de lancer l’envoi.

Un changement d’audience, de filtres, de photo ou de vidéo demande une nouvelle prévisualisation. Si l’ensemble a changé entre l’aperçu et la confirmation, l’envoi doit être revérifié. Après un résultat d’envoi incertain, la commande de reprise réutilise la même demande. Le suivi présente les compteurs et les destinataires par pages, pendant que les messages sont traités progressivement. Chaque client reçoit son message dans sa conversation privée ; aucun salon collectif n’est créé.

## Sauvegarde manuelle depuis l’administration

Dans [Sauvegardes](https://jessiemessage.com/admin/backups), choisis **Créer une sauvegarde**. Le site affiche **Demande de sauvegarde en attente.**, puis **Sauvegarde en cours. La messagerie peut être momentanément indisponible.**, et enfin **Sauvegarde terminée.** **Actualiser l’état** consulte le résultat sans lancer une nouvelle sauvegarde. Si la confirmation manque, vérifie cet état avant de réessayer.

Sous **Dernière sauvegarde disponible**, vérifie la date et la taille, puis choisis **Télécharger**. Le fichier reste chiffré ; conserve-le dans un endroit privé. Ce parcours fonctionne sans PC raccordé et sans sauvegarde ni archivage automatiques. Les archives historiques, clés, reçus et anciens raccordements restent préservés ; aucune manipulation de clé ni nouveau raccordement n’est nécessaire.

Une sauvegarde téléchargée ne certifie pas encore son déchiffrement ou une restauration de l’application. Les [copies PC](backup-destinations-055.md) décrivent le parcours historique, qui n’est pas nécessaire à cette sauvegarde manuelle.

### Derniers essais dans ton navigateur

La mise en service et l’alignement des métadonnées sont terminés. Pour clore les vérifications de l’interface hébergée, effectue d’abord la sauvegarde : sa préparation peut interrompre brièvement la messagerie. Fais cet essai avant de préparer des brouillons.

- Crée une sauvegarde, attends sa fin, puis télécharge le fichier chiffré.
- Enregistre une phrase de test sans données client, recharge les réponses enregistrées pour vérifier sa présence, puis clique dessus pour l’insérer dans le brouillon, sans **Envoyer**.
- Choisis un petit MP4 de test sans données client, vérifie son aperçu, puis **Retirer la vidéo**, sans **Envoyer**.

Ces essais ne demandent aucun envoi à un destinataire réel, aucune fermeture ni suppression de compte. La prévisualisation vidéo ne valide pas un transfert serveur. La restauration réelle, les téléphones physiques, les notifications système et les performances de l’hébergement restent distincts de ces vérifications.

## Fermeture définitive et remise en service

Voir l’[état courant](REPRISE.md) pour le service déployé et ses limites.

L’administrateur peut choisir **Fermer définitivement** dans la carte du client, vérifier le compte et la portée, cocher la confirmation et écrire **FERMER**. **Fermeture des comptes** affichera le suivi. L’action irréversible efface le compte, sa conversation, ses notes privées et les médias appartenant au client dans l’application. Le service peut être brièvement interrompu ; sauvegardes et téléchargements restent des copies séparées.

Une restauration se fait manuellement en maintenance, avec la personne chargée de l’exploitation et un contrôle des comptes fermés avant réouverture. Les messages postérieurs à la sauvegarde choisie peuvent être perdus ; la récupération dépend de la copie effectivement conservée. [Parcours opérateur](manual-restore-operator-078.md).

Pour une question, consulte l’[aide](https://jessiemessage.com/help) ou [contact@jessiemessage.com](mailto:contact@jessiemessage.com). Ne transmets jamais ton mot de passe ni tes codes.
