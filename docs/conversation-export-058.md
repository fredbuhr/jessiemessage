# Télécharger une conversation — 0.58

**Activée le 18 octobre 2026 à 21:08 Europe/Paris**, source `f92eaf38`, arbre `aa5d5a46`, [PR #74 fusionnée](https://github.com/fredbuhr/jessiemessage/pull/74). Le [dossier de reprise](REPRISE.md) et les [preuves structurées](activation-proofs/jm058-activation.json) conservent les commandes et le repli exacts.

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

CI [source](https://github.com/fredbuhr/jessiemessage/actions/runs/39156744713), [PR](https://github.com/fredbuhr/jessiemessage/actions/runs/39156749182) et [main](https://github.com/fredbuhr/jessiemessage/actions/runs/39156987490) : cinq jobs réussis chacune. Source exacte : 2 529 réussites et 27 wrappers SQL ignorés sur 2 556 cas ; 385/385 sur chacune des deux MariaDB ; 119/119 Chrome, sans saut ; authentification HTTPS/MFA ; syntaxe de 453 fichiers et build conformes. Les 160 tests locaux ciblés puis 181/181 sur l’hébergement passent sans saut. Le préflight réel passe à 19:05:59.788370 UTC sans démarrage ni capture.

Cycle Manager lancé à 19:08:13.026 UTC, sans réinstallation des dépendances ; paramètres Run/Build relus après enregistrement. État Actif et modification 21:08 Europe/Paris. Après le dernier démarrage, mesures 19:08:39.227 et 19:09:39.283 UTC, intervalle 60 056 ms : current / OK, aucun incident ; observations d’alertes correspondantes sans envoi en attente. [Preuve visuelle](activation-proofs/jm058-activation-20261018.jpg).

À 19:10:19.373611 UTC, 70/70 contrôles HTTPS et vingt empreintes exactes des fichiers publics, avec TLS vérifié et redirections non suivies. Le premier relevé avait dix sondes mal définies : `chat.js` est public et les chemins réels sont `/admin/broadcasts` et `/backups.js`. Seules ces sondes sont corrigées et répétées ; le rapport initial est conservé. Aucun changement applicatif pendant ce contrôle. Le navigateur cloud reste anonyme ; aucun téléchargement personnel positif n’est revendiqué.

À 19:12:08.409 UTC, version 0.58.0 et checkout propres, quatre enregistrements de journal et même dernier succès de capture, sans incident ni alerte en attente. La copie PC courante est confirmée ; le dernier reçu observé, 19:05:48.995 UTC, précède cette activation. Déchiffrement personnel toujours non constaté. Aucun schéma, clé, compte, réglage de conservation ou script Windows n’est modifié.

Repli : 0.57 `53246777`, arbre `9b517b6c9708b17461809243ca4a78b2d9aa097a`, anciens Run/Build enregistrés en 0600 dans `/srv/customer/jessiemessage-private/manager-before-conversation-export-058.json`. Le lanceur antérieur est conservé. Son empreinte réelle corrige une erreur écrite d’un caractère dans le relevé 0.57 ; voir REPRISE.md. Aucun repli, restauration SQL ni capture hors ligne n’a été provoqué.
