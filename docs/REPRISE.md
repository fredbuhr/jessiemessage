# Reprendre JessieMessage

**0.58.0 est activée le 18 octobre 2026 à 21:08 Europe/Paris.** Depuis une fiche client, l’administrateur peut télécharger la conversation et ses photos partagées, puis les lire sans connexion. La reprise des sessions valides et l’administration simplifiée de 0.57 sont conservées. Aucun outil à réinstaller sur le PC.

Lire le [relevé 0.58](conversation-export-058.md), les [preuves structurées](activation-proofs/jm058-activation.json) et le [plan d’exploitation](production-readiness-2026-10-17.md). Les relevés [0.57](admin-comfort-057.md), [0.56](backup-verification-056.md) et [0.55](backup-destinations-055.md) sont historiques ; les outils Windows restent identiques.

## Utilisation quotidienne

[Administration](https://jessiemessage.com/admin/login) reprend une session valide. Une session effacée, expirée ou révoquée demande une connexion normale. Les conversations, invitations/clients, sauvegardes et l’état du service sont accessibles depuis l’accueil.

Pour garder les échanges : ouvrir une conversation, puis **Fiche → Télécharger la conversation → Télécharger le ZIP**. Les photos partagées sont facultatives. Extraire le ZIP puis ouvrir `Conversation.html` ; `conversation.json` contient la même conversation dans un format portable. Aucun message n’est envoyé, aucun brouillon de notes n’est enregistré. Le fichier lisible en clair reste à conserver dans un emplacement privé. Notes, surnoms internes, tags, groupes, e-mails du compte et photos non envoyées sont exclus. Ce téléchargement ne remplace ni une sauvegarde technique ni un export complet de données personnelles.

Dans Sauvegardes, le résumé donne la dernière copie ; raccordement et réglages sont repliés. Le dossier de destination se change depuis le raccourci Windows installé. Le PC doit rester allumé, connecté et avec une session ouverte pour recevoir automatiquement les copies. Le contrôle ponctuel du déchiffrement reste disponible séparément.

## Runtime actif

- HEAD exécuté et superviseur : `f92eaf38ced2fac876bd3ead538a7788e8cc1d79` ; arbre `aa5d5a4694f29c40490c92634730f16812ec3d6e`.
- Repère `release/0.58.0`, [PR #74 fusionnée](https://github.com/fredbuhr/jessiemessage/pull/74), merge `954417753f25a206586637cee1840b664979b20c`. Son arbre est identique à la source testée. Les commits documentaires suivants ne changent pas le runtime épinglé.
- Checkout : `/srv/customer/jessiemessage-operator/conversation-export-058-f92eaf38`, propre au relevé.
- Node 24, version native observée 24.15.0, port 3000 ; profil `messaging-photos-notify-recovery-crm-broadcast`, déploiement `primary-transition`, schéma 30.
- Principal `https://jessiemessage.com`. `https://recette.jessiemessage.com` partage le même runtime et les mêmes données : ce n’est pas un environnement isolé.
- Six configurations privées : `/srv/customer/jessiemessage-private/primary-origin-candidate-4a355851` ; opérations `/srv/customer/jessiemessage-private/recurring-backup-052`, 0700 et fichiers privés 0600. Aucune clé privée GPG sur le serveur.

Run Manager : `bash /srv/customer/jessiemessage-private/start-primary-conversation-export-058-f92eaf38.sh`. Lanceur 0700, 851 octets, SHA-256 `b62a13de5fa93876fbeeb1ea177ce7d3985d5918a05e6b27af9a584e7f686eb5`.

Build :

```sh
cd /srv/customer/jessiemessage-operator/conversation-export-058-f92eaf38 && test "$(git rev-parse HEAD)" = f92eaf38ced2fac876bd3ead538a7788e8cc1d79 && test "$(git rev-parse HEAD^{tree})" = aa5d5a4694f29c40490c92634730f16812ec3d6e && test -z "$(git status --porcelain)" && npm run check
```

[Manager Node.js](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/h3/118579/nodejs/239143/data/dashboard) ; [terminal SSH](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/ssh-terminal/Node.js/terminal). Utiliser le cycle normal de Build, sans réinstallation des dépendances ni réinitialisation du site.

## Validation et activation

[CI source 39156744713](https://github.com/fredbuhr/jessiemessage/actions/runs/39156744713), [PR 39156749182](https://github.com/fredbuhr/jessiemessage/actions/runs/39156749182) et [main 39156987490](https://github.com/fredbuhr/jessiemessage/actions/runs/39156987490) : cinq jobs réussis chacune. Source exacte : **2 529 réussites et 27 wrappers SQL ignorés sur 2 556 cas**, zéro échec ; **385/385** sur MariaDB 10.11 et 11.4 ; **119/119 Chrome**, sans saut ; authentification HTTPS/MFA intégrée ; syntaxe de 453 fichiers et build conformes.

L’export utilise les contrôles ordinaires de conversation et de photo attachée au message. Les intégrations SQL vérifient de vrais contenus chiffrés et l’absence de modification des reçus de lecture. Chrome exerce les vrais modules de chat, fiche et téléchargement, au clavier, en français/anglais, mobile/bureau ; changer de compte ou fermer la fiche empêche le téléchargement obsolète et toute répétition automatique.

Hébergement : **181/181 contrôles natifs sans saut**, préflight réel passé à **19:05:59.788370 UTC**, sans démarrage ni capture. Dépendances identiques à 0.57 hors numéros de version racine ; modules natifs copiés du runtime précédent. Run/Build sauvegardés puis relus après enregistrement. Cycle Manager lancé à **19:08:13.026 UTC** ; état Actif, modification **21:08 Europe/Paris**. Après le dernier message de démarrage : mesures **19:08:39.227 et 19:09:39.283 UTC**, intervalle **60 056 ms**, `current / OK`, aucun incident. Observations d’alertes à **19:08:39.228 et 19:09:39.283 UTC**, aucune en attente. [Preuve visuelle](activation-proofs/jm058-activation-20261018.jpg).

À **19:10:19.373611 UTC**, **70/70 contrôles HTTPS**, TLS vérifié sans suivre les redirections, dont **20 empreintes exactes** : fichiers des deux origines, navigations sans effacement de cookie, modules privés refusés, méthode/origine/authentification de l’export, santé et sauvegardes réservées au principal. Le premier diagnostic avait dix sondes mal définies : `chat.js` est public, la page connue est `/admin/broadcasts` et l’asset des sauvegardes `/backups.js`. Seules ces sondes ont été corrigées et répétées ; le premier rapport est conservé. Aucun code applicatif n’a changé pendant ce contrôle.

À **19:12:08.409 UTC**, version 0.58.0 et checkout propres, journal de quatre enregistrements et dernier succès inchangés ; aucun incident ni alerte en attente. L’absence de `backup-alert-state.json` correspond à l’état vide validé par le lecteur applicatif. Les relevés privés sont référencés dans le JSON de preuve ; aucun secret, archive réelle ni contenu client n’est publié.

Le navigateur cloud est anonyme : le téléchargement d’une conversation personnelle n’est pas présenté comme observé. Les essais positifs de téléchargement utilisent les fixtures synthétiques Chrome/SQL.

## Connexion et bornes de l’export

Sessions indépendantes de **180 jours glissants**, sans coupure d’inactivité. Cookies Strict/Secure/HttpOnly, MFA, origine, CSRF et révocation conservés. Les navigations HTML venant d’un autre site passent par le document public de connexion puis prouvent la session depuis la même origine ; les API gardent leurs refus. Un lien ne crée aucun nouveau droit.

L’export est réservé à un administrateur déjà autorisé à lire la conversation. Compte, CSRF et appartenance sont relus avant réponse. Le navigateur contrôle aussi son compte avant et après le téléchargement. Un export par processus à la fois, trente secondes entre préparations, 10 000 messages, huit mébioctets de texte et 32 mébioctets au total. Aucune archive partielle proposée, aucun fichier clair temporaire sur le serveur ; un flux interrompu est abandonné. La conversation peut évoluer pendant sa préparation : il ne s’agit pas d’un snapshot SQL global.

## Sauvegardes conservées

Capture quotidienne **05:15 UTC**. Ne jamais lancer `capture --offline` pendant l’exécution de l’application ; utiliser le superviseur. Aucun checkpoint déclenché dans ce lot.

Dernière archive : `capture-1792300533262-3ae62972be4d93f5`, chiffré 402 792 octets, SHA-256 `dbd63e6d1a7d91b0f9372a062a761d5e92a4b3abb9dd9a44ddbcdd330d983578`. Dernier succès `1792300539807`, 18 octobre à 05:15:39.807 UTC. Deux archives disponibles au relevé 0.56 ; aucun retrait dans ce lot.

Mon PC est raccordé et actif ; sa copie courante est confirmée par identifiant, taille et SHA-256. Dernier reçu observé **19:05:48.995 UTC**, donc **avant** l’activation 0.58 ; aucun nouveau reçu post-activation n’est revendiqué. Le moniteur de capture conserve séparément `copyStatus: not_checked`. Les deux mails [TEST] incident/rétablissement ont été confirmés reçus le 18 octobre à 15:54:05 Europe/Paris ; ne pas les renvoyer. La réception d’une copie et son déchiffrement sont des preuves distinctes.

## Repli immédiat 0.57

Run/Build antérieurs dans `/srv/customer/jessiemessage-private/manager-before-conversation-export-058.json`, mode 0600, sauvegardés avant les changements. Reprendre ces paramètres puis le cycle Manager normal :

- checkout `/srv/customer/jessiemessage-operator/admin-comfort-057-53246777` ;
- HEAD `5324677707d9bd6da85cde39c8b393fc7d7f1283`, arbre `9b517b6c9708b17461809243ca4a78b2d9aa097a` ;
- Run `bash /srv/customer/jessiemessage-private/start-primary-admin-comfort-057-53246777.sh`.

Checkout propre, lanceur 839 octets, SHA-256 observé `fac36f42ca51111a2200ea740c6e805bf899ca0105f8e404627808cc4390573f`. Le relevé écrit 0.57 avait une erreur d’un caractère, `b` au lieu de `8` à l’index 28 de cette empreinte ; le lanceur existant n’a pas été modifié. Ses pins, sa taille et son empreinte réelle sont vérifiés avant dérivation du nouveau lanceur.

Conserver les configurations, l’état de copie et les autorisations. Aucun repli réel, restauration SQL, migration, rotation de clé ou révocation de session effectués. Aucune restauration SQL n’est nécessaire pour revenir au code 0.57.

## Reste à traiter

Le déchiffrement de la capture courante avec la clé personnelle du PC, puis sa restitution native courante, restent à constater. Les preuves historiques 0.46 ne sont pas renommées en preuve de cette capture. Ne pas régénérer ni déplacer la clé privée pour contourner un problème d’interface.

Les durées de conservation, les décisions de confidentialité, le responsable du traitement et l’effacement complet restent ouverts. Aucune purge ni identité légale n’a été inventée. L’export d’une conversation ne clôt pas ces sujets. La cadence maximale de surveillance externe et la réception de ses alertes gardent leurs limites documentées. L’ensemble des P0 de mise en production n’est pas déclaré clos.
