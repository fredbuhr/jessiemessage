# Reprendre JessieMessage

**0.55.0 est activée. Le propriétaire choisit son PC pour les copies automatiques et demande des réglages graphiques pour changer ensuite de destination.** L’écran **Administration → Sauvegardes** et le kit Windows sont livrés. « Mon PC » est préparé, **sans raccordement, jeton d’agent ni reçu de copie**. L’installation sur le vrai PC est la prochaine étape personnelle ; ne pas redemander de choisir une destination.

Lire la [procédure et le relevé 0.55](backup-destinations-055.md), les [preuves structurées](activation-proofs/jm055-activation.json) et le [plan d’exploitation courant](production-readiness-2026-10-17.md). Les relevés 0.54 et antérieurs restent historiques.

## Source et exécution courantes

| Élément | Référence |
| --- | --- |
| Dépôt complet | `https://github.com/fredbuhr/jessiemessage`, branche par défaut `main` |
| Version et repère | `0.55.0`, `release/0.55.0` |
| Runtime et superviseur exécutés | `088e6e1f1dc283a28ab81359f756d76eb0ac9d9b`, arbre `2c9e81dc0b4c5e0e14d35c5caae051a87ac3fcdb` |
| Intégration | [PR #70 fusionnée](https://github.com/fredbuhr/jessiemessage/pull/70), fusion `34b01aa3a5a0ef8f1a62f0c567d7b575998557ae`, arbre identique ; documentation ultérieure distincte du code exécuté |
| Checkout actif | `/srv/customer/jessiemessage-operator/backup-copies-055-088e6e1f` |
| Profil | `messaging-photos-notify-recovery-crm-broadcast`, déploiement `primary-transition`, Node 24, port 3000 |
| Données | Schéma 30, six configurations privées, mêmes clés/comptes/sessions |

Principal : `https://jessiemessage.com`. La recette `https://recette.jessiemessage.com` partage le runtime et les données ; elle n’est pas une base de test indépendante. L’administration des sauvegardes et le protocole du collecteur sont offerts sur le principal uniquement.

Configuration : `/srv/customer/jessiemessage-private/primary-origin-candidate-4a355851`. Captures, alertes et réglages de copie : `/srv/customer/jessiemessage-private/recurring-backup-052`, mode 0700. Nouveau fichier `backup-copy-state.json`, mode 0600 ; aucune clé privée de récupération sur le serveur.

Run Manager : `bash /srv/customer/jessiemessage-private/start-primary-backup-copies-055-088e6e1f.sh`. Le Build vérifie HEAD, arbre et propreté avant `npm run check` ; commande complète dans le relevé 0.55. Ne pas modifier ce checkout actif : préparer les changements dans un autre checkout, puis épingler leur commit/arbre validés.

[Manager Node.js](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/h3/118579/nodejs/239143/data/dashboard) ; [terminal SSH](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/ssh-terminal/Node.js/terminal). L’authentification SSH par clé publique n’y est pas disponible ; le collecteur utilise HTTPS.

## Étape personnelle immédiate : raccorder le PC

1. Sur le PC Windows habituel, dans la session administrateur, ouvrir `https://jessiemessage.com/admin/backups` (ou Administration → Compte et appareils → Sauvegardes).
2. Sur « Mon PC », cliquer **Raccorder Windows**. Extraire tout le ZIP et ouvrir **Installer.cmd** dans les quinze minutes.
3. Choisir le dossier dans la fenêtre. Actualiser ensuite le site pour observer le dernier contact et le reçu de copie.

Le raccourci **JessieMessage - Sauvegardes-…** sur le Bureau rouvre les réglages du dossier. Le site permet de renommer/type, suspendre/reprendre et révoquer ; un autre appareil se raccorde par un nouveau kit. Un nouveau raccordement réussi remplace l’autorisation précédente. Le chemin local reste sur le PC et changer de dossier remet le reçu à zéro au prochain contact.

Le collecteur fonctionne toutes les quinze minutes et à l’ouverture de session : PC allumé, connecté et session Windows ouverte. Aucun mot de passe Windows, session administrateur ou clé privée GPG n’est confié au collecteur. Son droit dédié est protégé par DPAPI et révocable depuis le site. Le kit est personnel, valable quinze minutes : ne pas le joindre à la discussion.

Un dossier Drive synchronisé ou partage réseau accessible peut être choisi localement. **Les API cloud directes et un collecteur Linux restent des extensions futures.** Le type choisi dans le site décrit l’emplacement du collecteur Windows ; il n’établit pas une connexion fournisseur. Copie locale, synchronisation cloud, déchiffrement et restauration sont des preuves distinctes. Aucune purge automatique des sauvegardes.

L’agent ne peut pas exécuter le kit sur le vrai PC depuis le navigateur cloud. Code, serveur et tests sont prêts ; attendre le raccordement personnel et un reçu réel avant de déclarer la copie indépendante acquise.

## Sauvegardes et alertes conservées

- Capture quotidienne **05:15 UTC** ; ne jamais lancer `capture --offline` pendant que l’application tourne. Le superviseur arrête le runtime, capture/chiffre puis le reprend.
- Deux captures disponibles, journal de quatre enregistrements ; dernière tentative `1792300533262`, dernier succès `1792300539807` (18 octobre, 05:15:39.807 UTC). Aucun checkpoint déclenché par cette activation.
- Dernière archive : `capture-1792300533262-3ae62972be4d93f5/checkpoint.tar.gz.gpg`, 402 792 octets, SHA-256 `dbd63e6d1a7d91b0f9372a062a761d5e92a4b3abb9dd9a44ddbcdd330d983578`. Le transfert HTTP n’offre que ce type de fichier chiffré.
- Clé publique : empreinte OpenPGP `B4E5570BF03A5B048B6AF394D49C2329ABD5FEE2`, SHA-256 de l’export `c759ad91a49a951adee26f51699380723515c71e4477d267c741508513f20270`. Clé privée et phrase exclusivement sur le PC.
- **Deux mails [TEST] incident/rétablissement confirmés reçus le 18 octobre à 15:54:05 Europe/Paris. Ne pas les renvoyer.** Contrôle minute, incident après trois échecs, FIFO SMTP persistante et reprise espacée jusqu’à quinze minutes.

Le contrôle copie n’altère pas le journal de capture. Le moniteur historique continue d’indiquer `copyStatus: not_checked` ; l’écran privé lit les reçus distincts du collecteur. Aucun reçu réel n’existe encore ; le déchiffrement personnel de la nouvelle archive 0.52 reste non confirmé. Les preuves 0.46 ne sont pas à refaire.

## Validation 0.55

CI [source 39139756404](https://github.com/fredbuhr/jessiemessage/actions/runs/39139756404), [PR 39139759906](https://github.com/fredbuhr/jessiemessage/actions/runs/39139759906) et [main 39139992278](https://github.com/fredbuhr/jessiemessage/actions/runs/39139992278) : cinq jobs réussis chacun. Source : 2 506 cas, 2 479 réussites et 27 wrappers SQL ignorés ; 383/383 par MariaDB 10.11 et 11.4, 110/110 Chrome, authentification HTTPS intégrée réussie. Syntaxe de 445 fichiers et build conformes.

Windows PowerShell 5.1 passe sur source/PR et main : intégrité/échecs, fichiers existants conservés, DPAPI, définition de tâche et expansion du vrai ZIP. Aucune tâche réelle ni clé GPG créée dans ces tests.

Hébergement : **159/159 tests natifs sans saut**, puis préflight sans démarrage/capture et catalogue courant conforme. Cycle Manager normal réussi, modification affichée **17:22 Europe/Paris**. Deux mesures après démarrage, **15:22:40.813 et 15:23:40.866 UTC**, sont `current / OK`, aucun incident ni alerte en attente.

À **15:25:25.403541 UTC**, **60/60 contrôles HTTPS et vingt-deux empreintes exactes** passent sur les deux origines. Source/version 0.55.0 relues propres, quatre enregistrements conservés, « Mon PC » non raccordé et sans reçu. Sans session dans le navigateur cloud, l’écran répond 401 ; les parcours authentifiés sont testés en CI, pas présentés comme acceptés personnellement.

## Repli immédiat

Run/Build précédents sauvegardés exclusivement dans `/srv/customer/jessiemessage-private/manager-before-backup-copies-055.json`, mode 0600. Ils reprennent **0.54.0**, runtime et superviseur unifiés :

- checkout `/srv/customer/jessiemessage-operator/release-054-6cfce890` ;
- HEAD `6cfce890827c835fdbda2488163b5c0f1695b2dc`, arbre `9308cb4dc736e7a869fa50796801ddc83a098d69` ;
- Run `bash /srv/customer/jessiemessage-private/start-primary-release-054-6cfce890.sh`.

Ancien checkout conservé propre et lanceur inchangé/vérifié. Reprendre les commandes sauvegardées puis le cycle Manager normal. **Aucune restauration SQL pour un repli de code.** Conserver les réglages privés de copie : 0.54 les ignore et n’offre pas ce protocole. Aucun repli réel provoqué. Le repli antérieur reste dans `manager-before-release-054.json` ; il n’est plus immédiat.

## Autres acquis et suite

- Invitations, messages, photos, notifications, mot de passe oublié et fiches déjà acceptés ; sessions administrateur indépendantes de 180 jours renouvelables, sans coupure d’inactivité.
- Diffusions individuelles sans accord supplémentaire côté invité ni métadonnées de groupe/audience ; limite actuelle 100 destinataires. Table historique `broadcast_preferences` conservée pour les sauvegardes.
- Adresse officielle : `contact@jessiemessage.com`. Aucune vraie campagne, message client ou alerte de test envoyé dans ce lot.
- Coffre/copie CRM 0.46 acquis (`COFFRE_DECHIFFRE_OK`, `COPIE_CRM30_OK`), restauration native isolée trente tables/photos vérifiée.
- Après raccordement : observer le reçu courant puis consigner le déchiffrement ciblé de la nouvelle archive. Clé privée/phrase hors discussion. Restauration de nouvelles campagnes et décisions de confidentialité/conservation/effacement complet restent distinctes.
- Sonde GitHub indépendante : passages planifiés observés espacés de plusieurs heures ; aucun délai maximal de cinq minutes ni réception de ses notifications prouvés.
- Première diffusion personnelle, administration simultanée et téléchargement réel du diagnostic non consignés. Ne pas répéter une recette générale des appareils/parcours acquis, ni annoncer l’ensemble comme définitivement prêt pour la production.
