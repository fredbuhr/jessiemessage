# Destinations graphiques et collecteur Windows — 0.55

**Suite 0.56 :** Mon PC est désormais raccordé et les reçus de la dernière copie sont observés avant et après activation. Le [vérificateur graphique du déchiffrement](backup-verification-056.md) est livré ; son résultat personnel reste attendu. Le relevé 0.55 ci-dessous conserve son état daté avant ce raccordement. [Reprise courante](REPRISE.md).

Le propriétaire choisit son PC comme première destination et demande le 18 octobre 2026 de pouvoir changer ces paramètres par une interface graphique. Cette version ajoute **Administration → Sauvegardes**, sur l’origine principale uniquement. La capture quotidienne, son chiffrement, les six configurations, les trente tables, les comptes et les clés de récupération restent ceux de la version précédente.

## Utilisation

1. Ouvrir `https://jessiemessage.com/admin/backups` avec la session administrateur. La destination « Mon PC » peut être préparée par l’opérateur ; elle reste **À raccorder**, sans autorisation active.
2. Cliquer **Raccorder Windows** sur la destination et télécharger le kit personnel. Extraire tout le ZIP et ouvrir **Installer.cmd** dans les quinze minutes. Le lanceur applique une politique d’exécution à ce seul processus PowerShell ; il ne modifie pas la politique Windows persistante et ne demande pas d’élévation.
3. Choisir le dossier dans la fenêtre. Le collecteur copie les archives chiffrées disponibles, vérifie leur taille et SHA-256 avant renommage, les relit puis transmet un reçu borné au site. Ni la clé privée GPG ni sa phrase ne sont lues.
4. Le raccourci du Bureau **JessieMessage - Sauvegardes-…** rouvre les réglages du dossier. Un autre appareil se raccorde par un nouveau kit depuis la même carte. Le nouveau raccordement remplace le droit de l’ancien lorsqu’il aboutit ; télécharger un kit seul n’interrompt pas le collecteur courant.

Le site permet de renommer la destination, d’indiquer son type, de suspendre/reprendre les copies et de révoquer le droit. La révocation ne supprime pas les fichiers déjà reçus. Cinq destinations au maximum. Un changement de dossier local possède une nouvelle génération : le premier contact remet à zéro le reçu précédent et un ancien processus ne peut pas déclarer une copie pour ce nouveau dossier.

## Ce qui fonctionne et ce qui reste distinct

| Destination | Fonctionnement de cette version |
| --- | --- |
| PC Windows | Collecteur dans la session Windows courante, dossier choisi graphiquement |
| Dossier Drive/OneDrive/Dropbox synchronisé | Même collecteur ; sélectionner le dossier disponible localement. JessieMessage vérifie la copie locale, pas sa synchronisation cloud |
| Autre ordinateur / serveur | Raccorder un Windows compatible, ou sélectionner un partage réseau accessible dans sa session. Aucun secret de serveur n’est conservé sur le site |
| API cloud directe / collecteur Linux | Extension future ; aucune connexion directe ni intégration fournisseur n’est annoncée comme opérationnelle |

Le choix du type sert à décrire la destination du collecteur. Il ne réalise pas une connexion à un fournisseur. Le chemin complet reste sur l’appareil. L’application montre la dernière archive chiffrée, le dernier contact et le dernier reçu. **« Dernière archive copiée » signifie un reçu de taille/empreinte correspondant au catalogue, déclaré par le collecteur après sa relecture**, sans preuve de déchiffrement, de restauration ou de conservation permanente par un cloud.

La tâche Windows fonctionne toutes les quinze minutes et à l’ouverture de session, avec le compte courant, privilèges limités et jeton interactif. Le PC doit rester allumé, connecté et la session ouverte. Aucun mot de passe Windows n’est demandé. Mise en veille/arrêt/déconnexion interrompent ce fonctionnement ; un prochain passage reprend les fichiers manquants. Maximum vingt nouvelles archives et dix minutes par passage ; un échec de transfert n’est jamais acquitté. Les fichiers existants d’empreinte différente sont conservés et bloquent la copie sous ce nom. Aucun fichier de sauvegarde n’est purgé automatiquement. Des fichiers `.part` peuvent rester après un arrêt forcé du PC ; ils ne sont jamais considérés comme des copies réussies.

## Frontières de sécurité

- Routes de gestion et tous les nouveaux fichiers d’interface : session administrateur courante ; mutations POST avec origine principale, CSRF, JSON borné et champs fermés. Aucun stockage de session/jeton dans localStorage.
- Kit téléchargé par un POST explicite : code aléatoire 256 bits, usage unique, quinze minutes. Seule son empreinte est persistée. Ne pas partager le kit pendant sa validité. Un second téléchargement invalide le précédent code.
- Après raccordement : nouveau jeton aléatoire dédié aux seuls fichiers chiffrés et reçus de cette destination. Empreinte côté serveur ; `PSCredential` chiffré par DPAPI côté PC, lié à l’utilisateur et au PC, dans un dossier dont les ACL sont limitées au compte courant et SYSTEM.
- Agent HTTPS : origine principale fixée, validation TLS native, TLS 1.2, redirections refusées, jeton dans Authorization, jamais dans l’URL. Les endpoints natifs refusent Origin et Sec-Fetch-Site ; aucune autorisation par cookie ni CORS.
- État `backup-copy-state.json` 0600, répertoire 0700, révisions, verrou court exclusif, fichier temporaire exclusif, fsync/renommage/relecture. Aucun secret dans les journaux ou le dépôt public.
- Catalogue limité aux captures à journal de succès et reçu de chiffrement conforme au destinataire courant. Répertoires et fichiers épinglés, sans symlink/hardlink, fichiers fixes `encryption-receipt.json` et `checkpoint.tar.gz.gpg`, tailles bornées. Préhash du chiffrement avant les en-têtes HTTP, puis contrôle de stabilité. Aucun export de tar clair, configuration ou clé.
- Deux transferts simultanés au maximum ; 240 requêtes natives par minute, taille maximale de chiffrement 2 Gio + 4 Mio et délai maximal dix minutes. Un arrêt du runtime annule immédiatement les transferts et attend leurs opérations de fichiers avant la capture ; une copie interrompue sera reprise sans reçu de succès.
- Révocation/suspension revérifiées après le préhash avant les en-têtes. Un transfert déjà commencé peut recevoir ses octets en vol ; il n’accorde aucun nouvel accès après révocation.

Le protocole sépare configuration et transport : types stables, identifiant de destination, génération locale, catalogue de fichiers chiffrés, reçu strict. De futurs adaptateurs peuvent être ajoutés sans changer la récupération GPG ni les données applicatives.

## Activation opérateur

Déployer les mêmes sources épinglées pour superviseur et runtime. Le superviseur passe son `operationsDirectory` au child IPC par argument explicite. Le child transmet `backupDirectory` aux options internes de démarrage ; aucun nouveau secret ou alias d’environnement n’est accepté. Le serveur refuse cette option hors profil principal complet avec diffusions. Les replis anciens ne reçoivent pas cette nouvelle option.

Depuis le nouveau checkout validé, d’abord :

```sh
node scripts/configure-private-backup-copies.mjs check --operations-directory /srv/customer/jessiemessage-private/recurring-backup-052
```

Puis, pour préparer le PC choisi si aucune destination n’existe : même commande avec `initialize-pc`. Cette opération ne crée aucun kit, jeton d’agent, tâche Windows ou capture ; elle crée une carte « Mon PC » en attente. Réexécuter ne remplace aucune destination existante. Ne jamais transférer l’archive dans le dépôt public.

La première copie personnelle et le déchiffrement de l’archive 0.52 restent à consigner après le raccordement du PC. Les tests Windows utilisent exclusivement des fichiers synthétiques et aucune tâche réelle n’y est enregistrée.

## Activation vérifiée le 18 octobre 2026

La source runtime/superviseur `088e6e1f1dc283a28ab81359f756d76eb0ac9d9b`, arbre `2c9e81dc0b4c5e0e14d35c5caae051a87ac3fcdb`, est activée dans `/srv/customer/jessiemessage-operator/backup-copies-055-088e6e1f`. La [PR #70](https://github.com/fredbuhr/jessiemessage/pull/70) est fusionnée dans main par `34b01aa3a5a0ef8f1a62f0c567d7b575998557ae`, arbre identique. Le repère `release/0.55.0` pointe la source exécutée ; les ajouts de documentation ultérieurs ne changent pas ce runtime.

- CI [source 39139756404](https://github.com/fredbuhr/jessiemessage/actions/runs/39139756404), [PR 39139759906](https://github.com/fredbuhr/jessiemessage/actions/runs/39139759906) et [main 39139992278](https://github.com/fredbuhr/jessiemessage/actions/runs/39139992278) : cinq jobs réussis chacun. Source : 2 479 réussites générales et 27 wrappers SQL ignorés sur 2 506 cas ; 383/383 par MariaDB 10.11 et 11.4, 110/110 Chrome, authentification HTTPS intégrée réussie. Syntaxe de 445 fichiers et build conformes.
- Windows [39139759897](https://github.com/fredbuhr/jessiemessage/actions/runs/39139759897) et [main 39139992258](https://github.com/fredbuhr/jessiemessage/actions/runs/39139992258) réussis : PowerShell 5.1, copies/empreintes, échecs sans reçu, absence d’écrasement, DPAPI, définition de tâche et vrai ZIP extrait par Windows. L’installation sur le PC personnel reste distincte de ces tests.
- **159/159 tests natifs sans saut** sur l’hébergement, sous umask restrictif. Les fixtures de permissions appliquent explicitement chmod pour éprouver le refus de 0640, y compris sous umask 077. Préflight réel passé sans démarrage ni capture, deux archives courantes lisibles dans le catalogue.
- Préparation à **15:19:24.095003 UTC** : Run/Build précédents sauvegardés en 0600, nouveau lanceur vérifié par `bash -n` en 0700, carte « Mon PC » créée sans code de raccordement, jeton ni reçu.
- Cycle Manager normal réussi, modification affichée **17:22 Europe/Paris**. Après le nouveau démarrage : **15:22:40.813 et 15:23:40.866 UTC**, intervalle 60 053 ms, `current / OK`, aucun incident ni alerte en attente.
- À **15:25:25.403541 UTC**, **60/60 lectures HTTPS et vingt-deux empreintes exactes** passent sur les deux origines. Les nouveaux fichiers privés et réglages sont 401 en anonyme sur le principal, 404 sur la recette ; protocole natif 403 sans marqueur, 401 avec marqueur mais sans droit dédié. La redirection normale `/admin` → `/admin/login` est vérifiée sans la suivre. Pas de cookie accordant une session ; seuls les anciens cookies expirés sont effacés par 401/303.
- Version 0.55.0 et source relues propres ; journal inchangé à quatre enregistrements, dernier succès `1792300539807`, aucune nouvelle capture. « Mon PC » est non raccordé avec `lastReceipt: null`. Les parcours authentifiés sont validés en CI ; le navigateur cloud n’a pas de session administrateur personnelle et ne les déclare pas acceptés en ligne.

Run courant :

```sh
bash /srv/customer/jessiemessage-private/start-primary-backup-copies-055-088e6e1f.sh
```

Build courant :

```sh
cd /srv/customer/jessiemessage-operator/backup-copies-055-088e6e1f && test "$(git rev-parse HEAD)" = 088e6e1f1dc283a28ab81359f756d76eb0ac9d9b && test "$(git rev-parse HEAD^{tree})" = 2c9e81dc0b4c5e0e14d35c5caae051a87ac3fcdb && test -z "$(git status --porcelain)" && npm run check
```

**Repli immédiat 0.54** : reprendre Run/Build dans `/srv/customer/jessiemessage-private/manager-before-backup-copies-055.json`, puis le cycle Manager normal. Ancien checkout `/srv/customer/jessiemessage-operator/release-054-6cfce890`, source `6cfce890827c835fdbda2488163b5c0f1695b2dc`, arbre `9308cb4dc736e7a869fa50796801ddc83a098d69`, Run `bash /srv/customer/jessiemessage-private/start-primary-release-054-6cfce890.sh`. Checkout conservé propre et lanceur inchangé/vérifié ; aucun repli réel provoqué et aucune restauration SQL requise. Les réglages privés de copie restent conservés, simplement ignorés par 0.54.

Les [preuves structurées](activation-proofs/jm055-activation.json) et la [capture du Manager](activation-proofs/jm055-activation-20261018.jpg) complètent le relevé. Journaux complets exclusivement privés : `backup-copies-native-tests-055-final.log`, `backup-copies-preflight-055.json`, `backup-copies-preparation-055.json`, `backup-copies-https-055.json`. Aucun message/campagne réel envoyé, aucune alerte de test renvoyée, clé GPG privée ni phrase lues. La réception des deux alertes locales reste acquise ; la première copie PC et le déchiffrement restent ouverts.

Références techniques utilisées : [DPAPI et Export-Clixml PowerShell 5.1](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.utility/export-clixml?view=powershell-5.1), [principal de tâche Interactive/Limited](https://learn.microsoft.com/en-us/powershell/module/scheduledtasks/new-scheduledtaskprincipal?view=windowsserver2025-ps).
