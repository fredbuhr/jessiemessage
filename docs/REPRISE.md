# Reprendre JessieMessage

**0.57.0 est activée le 18 octobre 2026 à 19:57 Europe/Paris.** Les liens administrateur ouverts depuis un autre site reprennent une session valide ; l’accueil et l’écran des sauvegardes sont simplifiés. Aucun outil à réinstaller sur le PC. Le collecteur Windows existant continue de fonctionner.

Lire le [relevé 0.57](admin-comfort-057.md), les [preuves structurées](activation-proofs/jm057-activation.json) et le [plan d’exploitation](production-readiness-2026-10-17.md). Les relevés [0.56](backup-verification-056.md) et [0.55](backup-destinations-055.md) restent historiques et décrivent les outils Windows inchangés.

## Utilisation quotidienne

Point d’entrée : [Administration](https://jessiemessage.com/admin/login). Une session valide est reprise ; une session déjà effacée, expirée ou révoquée demande une connexion normale. Les accès aux conversations, invitations/clients, sauvegardes et état du service sont visibles sur l’accueil.

Administration → Sauvegardes affiche d’abord la dernière copie reçue, puis les destinations. Les réglages, détails techniques et la vérification ponctuelle sont repliés. Pour changer de dossier, utiliser le raccourci Bureau JessieMessage — Sauvegardes installé sur le PC. Le collecteur passe toutes les quinze minutes et à l’ouverture de session ; PC allumé, connecté, session Windows ouverte. Aucun nouveau raccordement ni nouvelle clé à demander.

Le déchiffrement personnel de la capture courante reste à constater. L’outil 0.56 est accessible dans « Vérification ponctuelle sur le PC » ; il ne s’agit pas d’une manipulation quotidienne. La clé et sa phrase restent exclusivement sur le PC. Ne pas présenter une réception chiffrée comme un déchiffrement ou une restauration SQL.

## Source et exécution

| Élément | Référence |
| --- | --- |
| Dépôt et intégration | `https://github.com/fredbuhr/jessiemessage`, main, [PR #73 fusionnée](https://github.com/fredbuhr/jessiemessage/pull/73) |
| Version et repère | `0.57.0`, `release/0.57.0` |
| Runtime et superviseur exécutés | `5324677707d9bd6da85cde39c8b393fc7d7f1283`, arbre `9b517b6c9708b17461809243ca4a78b2d9aa097a` |
| Fusion applicative | `9819f7998f9635febb69d6f19688e144b23663cf`, même arbre |
| Checkout actif | `/srv/customer/jessiemessage-operator/admin-comfort-057-53246777` |
| Profil | `messaging-photos-notify-recovery-crm-broadcast`, déploiement `primary-transition`, Node 24, port 3000 |
| Données | Schéma 30, six configurations privées, comptes, sessions, clés et autorisations PC conservés |

Les commits de documentation ultérieurs sont distincts du code exécuté. Préparer les futurs changements depuis main, dans un nouveau checkout, puis épingler leur commit et leur arbre. Le principal `https://jessiemessage.com` et la recette `https://recette.jessiemessage.com` partagent runtime et données ; la recette n’est pas une base isolée. Les sauvegardes administrées restent réservées au principal.

Configurations : `/srv/customer/jessiemessage-private/primary-origin-candidate-4a355851`. Captures, alertes et copie : `/srv/customer/jessiemessage-private/recurring-backup-052`, mode 0700 ; fichiers privés en 0600. Aucune clé privée GPG sur le serveur.

Run Manager : `bash /srv/customer/jessiemessage-private/start-primary-admin-comfort-057-53246777.sh`. Lanceur 0700, 839 octets, SHA-256 `fac36f42ca51111a2200ea740c6eb05bf899ca0105f8e404627808cc4390573f`.

Build :

```sh
cd /srv/customer/jessiemessage-operator/admin-comfort-057-53246777 && test "$(git rev-parse HEAD)" = 5324677707d9bd6da85cde39c8b393fc7d7f1283 && test "$(git rev-parse HEAD^{tree})" = 9b517b6c9708b17461809243ca4a78b2d9aa097a && test -z "$(git status --porcelain)" && npm run check
```

[Manager Node.js](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/h3/118579/nodejs/239143/data/dashboard) ; [terminal SSH](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/ssh-terminal/Node.js/terminal). Utiliser le cycle normal de Build, sans réinstallation des dépendances ni réinitialisation de site.

## Connexion et sécurité

Le cookie Strict n’est pas envoyé lors du premier GET venant d’un autre site. Les refus précédents pouvaient l’effacer. Les navigations HTML GET/HEAD sans cookie passent maintenant par le document public de connexion ; sa preuve de session depuis la même origine permet de rejoindre la page demandée. Les retours sont limités à quatre chemins exacts et à des pages activées. Les API gardent leurs refus. Un lien ne crée aucun nouveau jeton ni autorisation.

Sessions indépendantes de 180 jours glissants, sans coupure d’inactivité. Cookies Strict/Secure/HttpOnly, MFA, origine, CSRF et révocation conservés. Un 403 de capacité de conversation offre une reprise ; un 401 ferme toujours l’accès. La correction ne ressuscite aucune session expirée, révoquée ou supprimée du navigateur.

## Validation et activation

[CI source 39151369335](https://github.com/fredbuhr/jessiemessage/actions/runs/39151369335), [PR 39151389889](https://github.com/fredbuhr/jessiemessage/actions/runs/39151389889) et [main 39151664880](https://github.com/fredbuhr/jessiemessage/actions/runs/39151664880) : cinq jobs réussis chacune. Source exacte : **2 488 réussites et 27 wrappers SQL ignorés sur 2 515 cas**, zéro échec ; **383/383** par MariaDB 10.11 et 11.4 ; **112/112 Chrome**, sans saut ; authentification HTTPS/MFA intégrée ; syntaxe de 449 fichiers et build conformes.

Chrome vérifie réellement deux sites HTTPS locaux, l’absence du cookie Strict au premier GET externe, sa récupération depuis la même origine, le même jeton après reprise et le retour profond. Les retours extérieurs et doublons sont refusés. Le nouvel écran est vérifié au clavier, en français/anglais et sur trois largeurs ; un reçu de taille différente n’est pas confirmé. Aucun kit ou script Windows modifié : la validation Windows 0.56 reste applicable à ces mêmes fichiers.

Hébergement : **95/95 contrôles natifs sans saut**, préflight réel passé à **17:53:37.811758 UTC**, sans démarrage ni capture. Run/Build sauvegardés puis relus après enregistrement. Cycle Manager lancé à **17:57:51.679 UTC** ; statut Actif, modification **19:57 Europe/Paris**. Après le dernier message de démarrage : mesures **17:58:08.886 et 17:59:08.929 UTC**, intervalle **60 043 ms**, `current / OK`, aucun incident ni alerte en attente. [Preuve visuelle](activation-proofs/jm057-activation-20261018.jpg).

À **17:59:58.923900 UTC**, **44/44 contrôles HTTPS**, TLS vérifié sans suivre les redirections, dont **18 empreintes exactes** : navigations sans effacement de cookie, refus API, origine, santé et sauvegardes réservées au principal. Le navigateur cloud est anonyme ; la reprise d’une session personnelle est couverte par la régression Chrome synthétique, pas présentée comme observée sur le PC du propriétaire.

À **18:01:01.951179 UTC**, source relue propre, version 0.57.0, journal de quatre enregistrements et dernier succès inchangés ; aucun incident ni alerte en attente. L’absence de `backup-alert-state.json` correspond à l’état vide validé par le lecteur applicatif : ne pas supposer qu’un fichier est écrit à chaque mesure saine.

## Sauvegardes conservées

Capture quotidienne **05:15 UTC**. Ne jamais lancer `capture --offline` pendant l’exécution de l’application ; utiliser le superviseur. Aucun checkpoint déclenché dans ce lot.

Dernière archive : `capture-1792300533262-3ae62972be4d93f5`, chiffré 402 792 octets, SHA-256 `dbd63e6d1a7d91b0f9372a062a761d5e92a4b3abb9dd9a44ddbcdd330d983578`. Dernier succès `1792300539807`, 18 octobre à 05:15:39.807 UTC. Deux archives disponibles au relevé 0.56, aucun retrait dans ce lot.

Mon PC reste raccordé, actif et en possession de cette copie. Dernier reçu observé **17:56:29.005 UTC**, donc **avant** l’activation 0.57 ; aucun nouveau reçu post-activation n’est revendiqué. Le moniteur mesure séparément la capture et conserve `copyStatus: not_checked`. L’écran privé lit les reçus du collecteur. Les deux mails [TEST] incident/rétablissement ont été confirmés reçus à 15:54:05 Europe/Paris ; ne pas les renvoyer.

## Repli immédiat 0.56

Run/Build antérieurs dans `/srv/customer/jessiemessage-private/manager-before-admin-comfort-057.json`, mode 0600. Reprendre ces paramètres puis le cycle Manager normal :

- checkout `/srv/customer/jessiemessage-operator/backup-verification-056-2faf32ce` ;
- HEAD `2faf32ce1bf22553d6dd62f053ebcdc76bdc9a5b`, arbre `8bc8029e0b93166ee33ded9cdb6ab65647fb5b40` ;
- Run `bash /srv/customer/jessiemessage-private/start-primary-backup-verification-056-2faf32ce.sh`.

Checkout propre et lanceur vérifié avant activation : 851 octets, SHA-256 `75596f26fcd861e401f07d99507d41608ca69db02f55887f9bd5ac5926918950`. Conserver l’état de copie et ses autorisations. Aucun repli réel, aucune restauration SQL ni rotation de clé effectués ; aucune restauration SQL n’est nécessaire pour revenir au code 0.56.

## Acquis et suite

Invitations, messages, photos, notifications, récupération du mot de passe et fiches déjà acceptés. Diffusions individuelles ordinaires, sans accord supplémentaire ni métadonnées d’audience, limite 100. Adresse officielle `contact@jessiemessage.com`. Aucun message client, campagne réelle ou mail de test envoyé dans ce lot.

Coffre/copie CRM 0.46 acquis (`COFFRE_DECHIFFRE_OK`, `COPIE_CRM30_OK`) et restauration native isolée trente tables/photos vérifiée. Ne pas refaire une recette générale des appareils. Le déchiffrement personnel de l’archive courante, la restitution d’une capture contenant les campagnes, les décisions de confidentialité/durées/effacement complet restent ouverts. La restitution applicative utilise `photos-notify-recovery-crm-broadcast-application`, manifeste 10 / reçu 8, six clés et trente tables ; objets SQL exécutables exclus (`completeDatabase: false`). Aucune purge automatique. La première diffusion personnelle et l’administration simultanée ne sont pas consignées. Ne pas annoncer l’ensemble comme définitivement prêt pour la production.
