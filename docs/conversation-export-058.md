# Télécharger une conversation — 0.58

Préparation du 18 octobre 2026. La version active reste 0.57 jusqu’au relevé d’activation.

## Usage

Dans une conversation administrateur, ouvrir **Fiche → Télécharger la conversation → Télécharger le ZIP**. Les photos partagées peuvent être incluses ou retirées. Après extraction, ouvrir `Conversation.html` pour lire les échanges sans connexion ; `conversation.json` conserve la même conversation dans un format portable. Aucun message n’est envoyé et les brouillons de notes ne sont pas enregistrés par ce téléchargement.

Le fichier contient les messages visibles et, si demandé, leurs photos partagées. Il exclut les notes, surnoms privés, tags, groupes, e-mails du compte, identifiants de connexion, données internes de campagne et bibliothèque non partagée. Les contenus reçus par diffusion restent des messages ordinaires. Les messages déjà supprimés lors de leur lecture gardent leur trace de suppression, sans leur ancien contenu. Un administrateur qui peut consulter la conversation retrouve le même périmètre ; aucun nouveau droit de lecture n’est donné.

L’archive est lisible en clair hors du site. Elle n’est ni une sauvegarde technique ni un export complet de données personnelles. Le dossier de confidentialité, les durées et l’effacement complet restent à décider ; ce lot ne prétend pas les clore.

## Contrat et bornes

`POST /api/admin/crm/conversations/:id/export`, corps fermé `{ includePhotos: boolean }`, exige administrateur, origine exacte et CSRF. La conversation doit appartenir à cet administrateur. Le compte et le CSRF sont relus après préparation, puis l’appartenance est relue avant les en-têtes. Le navigateur prouve aussi son compte avant et après la réponse ; fermeture, masquage ou changement de fiche invalident le téléchargement, sans rejouer la requête.

L’export utilise le lecteur de messages ordinaire et le lecteur de photo attachée à un message précis. Il ne parcourt jamais une bibliothèque ni un dossier de stockage. La lecture agrégée des photos réutilise les contrôles du service média, avec un rôle administrateur fixé ; son budget global remplace le quota d’affichage photo par photo, pour ne pas interrompre une archive à la vingtième image ni empêcher ensuite la consultation.

Limites : 10 000 messages, huit mébioctets de corps de texte et 32 mébioctets pour l’archive entière ; un export à la fois, trente secondes entre préparations, communes aux deux origines du même processus. Le travail vérifie son délai de soixante secondes et l’annulation entre les lectures déjà bornées des services. Une lecture en cours doit se terminer avant la libération du créneau. Le navigateur attend au plus 65 s et borne le flux reçu avec la taille annoncée. Toute erreur interrompt l’ensemble : aucun ZIP tronqué n’est proposé.

Les nouvelles arrivées sont exclues au-delà du numéro de message observé au départ. La conversation peut évoluer pendant la préparation ; il ne s’agit pas d’un snapshot SQL global. Les photos répétées ne sont copiées qu’une fois. Seuls des noms ASCII fixes et des identifiants hexadécimaux construisent les chemins. Le HTML échappe les textes, n’exécute aucun script et ne charge aucune ressource réseau. L’archive conserve les empreintes des photos et les CRC des fichiers ; aucun jeton, chemin privé ou détail de campagne n’est sérialisé.

La préparation reste en mémoire, sans fichier clair temporaire sur le serveur. Les buffers temporaires sont effacés ; le buffer final est effacé après fin ou fermeture de la réponse. L’arrêt gracieux annule les lectures et coupe un transfert encore actif. Une réponse d’export devenue non authentifiée n’efface pas le cookie : elle peut terminer après une nouvelle connexion dans un autre onglet.

## Vérification et activation

Tests ciblés : ZIP lu indépendamment par Python, ordre/pagination et duplication des photos ; contenu privé exclu, HTML échappé ; budgets, annulation, identité et CSRF renouvelés ; refus des autres clients et administrateurs ; aucun changement de reçu de lecture. Les intégrations SQL vérifient aussi les photos réellement chiffrées et les autorisations de message.

Chrome utilise les vrais modules de chat, de fiche et de lecture du ZIP. Le parcours est exercé au clavier, en français/anglais et sur mobile/bureau. Un changement de connexion ou la fermeture de la fiche ne doit produire ni téléchargement ni répétition de la requête.

Les références CI, le relevé hébergé et le point de repli seront ajoutés après vérification. Aucun schéma, clé, compte, réglage de conservation ou script Windows n’est modifié. Le repli prévu reste 0.57 `53246777`, arbre `9b517b6c9708b17461809243ca4a78b2d9aa097a`.
