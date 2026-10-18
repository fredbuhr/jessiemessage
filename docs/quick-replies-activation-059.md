# Relevé d’activation 0.59 — réponses rapides

Relevé historique du 18 octobre 2026. La version 0.60 d’export côté client a été fusionnée ensuite par la [PR #76](https://github.com/fredbuhr/jessiemessage/pull/76). Pour la version courante, lire [REPRISE.md](REPRISE.md). Les preuves ci-dessous restent celles du lot 0.59.

**0.59.0 est activée le 18 octobre 2026 à 21:45 Europe/Paris.** Dans une conversation administrateur, **Réponses rapides** ajoute une phrase française ou anglaise au brouillon. Relire ou modifier, puis utiliser **Envoyer**. Aucun envoi automatique. L’export de conversation 0.58 et la connexion simplifiée 0.57 sont conservés. Aucun outil à réinstaller sur le PC.

Lire le [relevé 0.59](quick-replies-059.md), les [preuves structurées](activation-proofs/jm059-activation.json) et le [plan d’exploitation](production-readiness-2026-10-17.md). Les relevés [0.58](conversation-export-058.md), [0.57](admin-comfort-057.md), [0.56](backup-verification-056.md) et [0.55](backup-destinations-055.md) restent historiques ; les outils Windows restent identiques.

## Utilisation quotidienne

[Administration](https://jessiemessage.com/admin/login) reprend une session valide. Une session effacée, expirée ou révoquée demande une connexion normale. Conversations, invitations/clients, sauvegardes et état du service sont accessibles depuis l’accueil.

Dans une conversation, **Réponses rapides** propose six phrases courantes. Choisir **Français / English**, puis une phrase : elle s’ajoute à la fin du texte existant, sans l’effacer. Le choix de langue des phrases est indépendant de celui de l’interface. Modifier si besoin, puis cliquer sur **Envoyer**. Le catalogue est fixe ; aucun nouvel enregistrement de données ou éditeur de phrases personnelles n’est ajouté.

Pour garder les échanges : **Fiche → Télécharger la conversation → Télécharger le ZIP**. Les photos partagées sont facultatives. Extraire le ZIP puis ouvrir `Conversation.html` ; `conversation.json` contient les mêmes échanges dans un format portable. Notes, surnoms privés, tags, groupes, e-mails du compte et photos non envoyées sont exclus. Aucun message n’est envoyé et aucun brouillon de notes n’est enregistré. Le dossier lisible en clair reste à conserver dans un emplacement privé. Il ne remplace ni une sauvegarde technique ni un export complet de données personnelles.

Dans Sauvegardes, le résumé montre la dernière copie ; raccordement et réglages sont repliés. Le dossier se change depuis le raccourci Windows installé. Le PC doit rester allumé, connecté et avec une session ouverte pour recevoir automatiquement les copies. La vérification ponctuelle du déchiffrement reste disponible séparément.

## Runtime actif

- HEAD exécuté et superviseur : `6fab86ff2f346303cde2143d862b07c1137f65a2` ; arbre `29ee7d3b884e41c778308b1f07e47f90201426d9`.
- Repère `release/0.59.0`, [PR #75 fusionnée](https://github.com/fredbuhr/jessiemessage/pull/75), merge `36aee069ca557ae662f400d2aee4233510db9072`. Son arbre est identique à la source testée. Les commits documentaires suivants ne changent pas le runtime épinglé.
- Checkout : `/srv/customer/jessiemessage-operator/quick-replies-059-6fab86ff`, propre au relevé.
- Node 24, version native observée 24.15.0, port 3000 ; profil `messaging-photos-notify-recovery-crm-broadcast`, déploiement `primary-transition`, schéma 30.
- Principal `https://jessiemessage.com`. `https://recette.jessiemessage.com` partage le même runtime et les mêmes données : ce n’est pas un environnement isolé.
- Six configurations privées : `/srv/customer/jessiemessage-private/primary-origin-candidate-4a355851` ; opérations `/srv/customer/jessiemessage-private/recurring-backup-052`, 0700 et fichiers privés 0600. Aucune clé privée GPG sur le serveur.

Run Manager : `bash /srv/customer/jessiemessage-private/start-primary-quick-replies-059-6fab86ff.sh`. Lanceur 0700, 839 octets, SHA-256 `5329eeba534085f84d40a441fec64ea2f45f85a391f4877e1559abda50e1b052`.

Build :

```sh
cd /srv/customer/jessiemessage-operator/quick-replies-059-6fab86ff && test "$(git rev-parse HEAD)" = 6fab86ff2f346303cde2143d862b07c1137f65a2 && test "$(git rev-parse HEAD^{tree})" = 29ee7d3b884e41c778308b1f07e47f90201426d9 && test -z "$(git status --porcelain)" && npm run check
```

[Manager Node.js](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/h3/118579/nodejs/239143/data/dashboard) ; [terminal SSH](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/ssh-terminal/Node.js/terminal). Utiliser le cycle normal de Build, sans réinstallation des dépendances ni réinitialisation du site.

## Copie locale et travail parallèle

Ce lot a été isolé dans `/workspace/scratch/b01756ad0fe5/jessiemessage-quick-replies-059`, à partir de `98e189a`. Le dossier initial `/workspace/scratch/b01756ad0fe5/jessiemessage` contenait des modifications d’export apparues en parallèle. Elles ont été conservées, sans être intégrées à cette livraison. Ne pas écraser ce travail : comparer les états avant une reprise ou une fusion. La branche source publiée est `feat/quick-replies-059-isolated` ; le code actif est toujours le HEAD/arbre épinglé ci-dessus.

## Validation et activation

[CI source 39159780258](https://github.com/fredbuhr/jessiemessage/actions/runs/39159780258), [PR 39159783819](https://github.com/fredbuhr/jessiemessage/actions/runs/39159783819) et [main 39160034447](https://github.com/fredbuhr/jessiemessage/actions/runs/39160034447) : cinq jobs réussis chacune. Source exacte : **2 535 réussites et 27 wrappers SQL ignorés sur 2 562 cas**, zéro échec ; **385/385** sur MariaDB 10.11 et 11.4 ; **124/124 Chrome**, sans saut ; authentification HTTPS/MFA ; syntaxe de 455 fichiers et build conformes. Les 96 tests locaux ciblés passent sans saut.

Chrome vérifie les vrais modules en français/anglais sur 320 et 1 280 px : ouverture au clavier, langue des phrases indépendante, texte préexistant conservé, édition puis un seul envoi explicite. Échap, dépassement de longueur et retour à la liste ne produisent aucun envoi. Les tests du contrôleur rejettent les anciens boutons après masquage ou remplacement de compte et l’ajout lorsque l’envoi est suspendu. Les intégrations 0.58 d’export et les anciennes régressions restent acquises.

Hébergement : **240/240 contrôles natifs sans saut**, préflight réel passé à **19:40:35.582052 UTC**, sans démarrage ni capture. Dépendances identiques à 0.58 hors numéros de version racine ; modules natifs copiés du runtime précédent. Run/Build sauvegardés puis relus après enregistrement ; paramètres 0.58 contrôlés inchangés avant modification. Cycle Manager lancé à **19:45:55.569 UTC** ; état Actif, modification **21:45 Europe/Paris**. Après le dernier message de démarrage : mesures **19:46:11.843 et 19:47:11.902 UTC**, intervalle **60 059 ms**, `current / OK`, aucun incident et aucune alerte en attente. [Preuve visuelle](activation-proofs/jm059-activation-20261018.jpg).

À **19:48:21.586622 UTC**, **82/82 contrôles HTTPS**, TLS vérifié sans suivre les redirections, dont **24 empreintes exactes** : douze fichiers sur chaque origine, nouveau module public et assets du chat, navigations sans effacement de cookie, modules privés/capacités refusés, méthode/origine/authentification de l’export, santé et sauvegardes réservées au principal. Le premier diagnostic exigeait à tort `Content-Length` sur six réponses HEAD dont le handler existant omet cet en-tête. Seules ces six sondes ont été corrigées et répétées : statut, corps vide, type MIME et longueur exacte si présente. Les six en-têtes étaient absents ; le rapport initial est conservé. Aucun code applicatif n’a changé pendant cette vérification.

À **19:52:15.565 UTC**, version 0.59.0, HEAD et checkout propres, journal de quatre enregistrements et dernier succès inchangés ; aucun incident ni alerte en attente. L’absence de `backup-alert-state.json` correspond à l’état vide validé par le lecteur applicatif. Le terminal s’est reconnecté avant le premier relevé ; son absence a été vérifiée puis la seule observation relancée. Aucune capture, émission de test ni opération de service répétée.

Le navigateur cloud reste anonyme : aucun message personnel n’a été envoyé pour tester les réponses rapides. Les essais positifs d’envoi utilisent exclusivement les fixtures synthétiques Chrome/SQL.

## Connexion, brouillons et bornes

Sessions indépendantes de **180 jours glissants**, sans coupure d’inactivité. Cookies Strict/Secure/HttpOnly, MFA, origine, CSRF et révocation conservés. Les navigations HTML venant d’un autre site passent par la page publique de connexion puis prouvent la session depuis la même origine ; les API gardent leurs refus. Aucun nouveau droit n’est créé.

Réponses rapides utilise le brouillon et l’envoi ordinaires : 4 096 caractères pour un message, 1 000 pour une légende. Si la phrase ne tient pas, le texte reste intact et le panneau permet de reprendre. Le panneau suit le compte, le CSRF et la conversation ; il se ferme au masquage, à la perte de droit d’envoi et au nettoyage de session. Aucun choix obsolète n’est rejoué ni enregistré dans un nouveau stockage.

L’export reste réservé à l’administrateur autorisé : compte, CSRF et appartenance relus avant réponse ; contrôle d’identité aussi dans le navigateur. Un travail à la fois, trente secondes entre préparations, 10 000 messages, huit mébioctets de texte et 32 mébioctets au total. Aucune archive partielle ni fichier clair temporaire sur le serveur. La conversation peut évoluer pendant sa préparation ; ce n’est pas un snapshot SQL global.

## Sauvegardes conservées

Capture quotidienne **05:15 UTC**. Ne jamais lancer `capture --offline` pendant l’exécution de l’application ; utiliser le superviseur. Aucun checkpoint déclenché dans ce lot.

Dernière archive : `capture-1792300533262-3ae62972be4d93f5`, chiffré 402 792 octets, SHA-256 `dbd63e6d1a7d91b0f9372a062a761d5e92a4b3abb9dd9a44ddbcdd330d983578`. Dernier succès `1792300539807`, le 18 octobre à 05:15:39.807 UTC. Deux archives disponibles au relevé 0.56 ; aucun retrait dans ce lot.

Mon PC reste raccordé et actif ; sa copie courante est confirmée par identifiant, taille et SHA-256. Dernier reçu observé **19:50:51.025 UTC**, donc **après** l’activation 0.59. Le moniteur de capture conserve séparément `copyStatus: not_checked`. Les deux mails [TEST] incident/rétablissement ont été confirmés reçus le 18 octobre à 15:54:05 Europe/Paris ; ne pas les renvoyer. La réception d’une copie et son déchiffrement sont des preuves distinctes.

## Repli immédiat 0.58

Run/Build antérieurs dans `/srv/customer/jessiemessage-private/manager-before-quick-replies-059.json`, mode 0600, sauvegardés avant les changements. Reprendre ces paramètres puis le cycle Manager normal :

- checkout `/srv/customer/jessiemessage-operator/conversation-export-058-f92eaf38` ;
- HEAD `f92eaf38ced2fac876bd3ead538a7788e8cc1d79`, arbre `aa5d5a4694f29c40490c92634730f16812ec3d6e` ;
- Run `bash /srv/customer/jessiemessage-private/start-primary-conversation-export-058-f92eaf38.sh`.

Checkout propre, lanceur 851 octets, SHA-256 `b62a13de5fa93876fbeeb1ea177ce7d3985d5918a05e6b27af9a584e7f686eb5`, vérifiés avant dérivation du nouveau lanceur. Conserver les configurations, l’état de copie et les autorisations. Aucun repli réel, restauration SQL, migration, rotation de clé ou révocation de session effectués. Aucune restauration SQL n’est nécessaire pour revenir au code 0.58.

## Reste à traiter

Le déchiffrement de la capture courante avec la clé personnelle du PC, puis sa restitution native courante, restent à constater. Les preuves historiques 0.46 ne sont pas renommées en preuve de cette capture. Ne pas régénérer ni déplacer la clé privée pour contourner un problème d’interface.

Les durées de conservation, les décisions de confidentialité, le responsable du traitement et l’effacement complet restent ouverts. Aucune purge ni identité légale n’a été inventée. Export et réponses rapides ne clôturent pas ces sujets. La cadence maximale de surveillance externe et la réception de ses alertes gardent leurs limites documentées. L’ensemble des P0 de mise en production n’est pas déclaré clos.
