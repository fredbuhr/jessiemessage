# Reprendre JessieMessage

**0.62.0 est activée le 18 octobre 2026 à 23:10 Europe/Paris.** Les choix de l’itération 1/6 sont intégrés : **Jessie en France, sans structure, espace privé ; conversation conservée jusqu’à la fermeture définitive du compte**. Ne plus redemander ces deux réponses. L’administration affiche un résumé simple ; le dossier détaillé est facultatif et replié. L’aide FR/EN est actualisée, les anciens brouillons sont préservés. Le moteur 0.63 et le parcours graphique 0.64 sont préparés dans le code, sans activation d’effacement. Le prochain lot est l’étape 4/6 : sauvegarde/restauration courantes et continuité du registre avant raccordement de production.

**Étape 3/6 — 0.64 préparée, non activée.** Lire [le parcours et ses limites](account-closures-064.md). Confirmation distincte et suivi après disparition SQL, intention chiffrée minimale, arrêt réel du processus et verrou commun aux captures. Le serveur vérifie les reçus avant toute écoute/production, même si les demandes sont désactivées ; une intention inachevée ou un compte restauré bloque. La commande de production n’installe aucun `closureOperations`. Il reste à fournir un inventaire SQL privilégié réel et une continuité du registre protégée pendant la capture/restauration ; les callbacks de tests ne sont pas ces preuves. Aucun changement du Manager, des clés, des configurations privées ni du PC. Les preuves CI de ce lot seront enregistrées dans `verification-proofs/jm064-verification.json`.

**Étape 2/6 livrée dans main — 0.63, sans activation de suppression réelle.** Source `71de968ebe5a036ffdd76325844b68c148069648`, arbre `e0ff079995cc8ee33f0b33085f298c7d262c0bef`, [PR #79](https://github.com/fredbuhr/jessiemessage/pull/79), merge `8b5a2f5b7f405aec473861d0b5f1706dca3165c2`, repère `release/0.63.0`. Le [moteur d’effacement](account-erasure-063.md) et ses [preuves](verification-proofs/jm063-verification.json) sont distincts du runtime actif épinglé ci-dessous. CI source/PR/main réussie : 402/402 sur chaque MariaDB, 144/144 Chrome, 2 592 réussites générales et 28 wrappers SQL ignorés. Aucun compte réel effacé, endpoint ou adaptateur de maintenance de production installé.

Lire le [relevé 0.62](privacy-choices-062.md), les [preuves structurées](activation-proofs/jm062-activation.json) et le [plan d’exploitation](production-readiness-2026-10-17.md). Les relevés 0.61 et précédents sont historiques ; ne pas reprendre leurs anciens Run/Build comme paramètres actifs. L’utilisateur a autorisé la poursuite, les corrections, fusions et mises à jour nécessaires ; ne pas lui redemander une autorisation générale à chaque lot. Aucun envoi réel ou effacement de compte réel n’est demandé par cette autorisation de développement.

## Utilisation quotidienne

[Ouvrir mon espace](https://jessiemessage.com/app) ou [Administration](https://jessiemessage.com/admin/login). Une session valide est reprise. Depuis l’accueil : conversations, invitations/clients, sauvegardes, confidentialité et état du service. Sessions indépendantes de **180 jours glissants**, sans coupure d’inactivité ; cookies Strict/Secure/HttpOnly, MFA, origine, CSRF et révocation conservés. Les liens administrateur externes passent par le document public de connexion puis prouvent la session sur la même origine.

**Confidentialité** : Jessie — France, contact et conservation jusqu’à fermeture définitive sont directement visibles. Déconnexion, expiration et suspension ne ferment pas définitivement le compte. Les suppressions volontaires de messages/photos restent possibles. Le dossier détaillé permet de conserver des notes et des notices FR/EN privées chiffrées ; il ne modifie pas les choix confirmés et ne déclenche pas d’effacement. Les réponses existantes restent intégrales. Conflits entre appareils et révision optimiste sont conservés ; aucune répétition automatique de l’écriture ni stockage local des brouillons. Le résumé ne prétend pas que l’exécuteur ou la notice définitive sont achevés.

Côté client : **Télécharger ma conversation → Télécharger le ZIP**, photos partagées facultatives ; extraire et ouvrir `Conversation.html`, ou conserver `conversation.json`. Côté administration : **Fiche → Télécharger la conversation → Télécharger le ZIP**. Notes, noms internes, tags et photos non partagées sont exclus. Ces archives en clair hors du service ne remplacent ni la sauvegarde technique ni un dossier complet d’exercice des droits.

**Réponses rapides** propose six phrases FR/EN ajoutées au brouillon et modifiables avant Envoyer. Diffusions : message ordinaire par destinataire, sans réglage d’acceptation ni métadonnées d’audience côté invité ; aperçu et confirmation administrateur conservés, limite actuelle de 100 destinataires.

Dans **Sauvegardes**, le résumé donne l’état des copies. Le dossier se change par le raccourci Windows déjà installé. Le PC doit être allumé, connecté et avec une session ouverte ; rien à réinstaller. Le contrôle ponctuel du déchiffrement reste séparé. Le changement graphique de destination et les connexions directes à Drive restent distincts d’une restauration prouvée.

## Runtime actif et déploiement

- HEAD exécuté/superviseur : `a15b5595b804f2eccf95c13be46152570a6ebc12` ; arbre `d653aeb733cdc2bc7bd87853f747fbdd3010141c`.
- [PR #78 fusionnée](https://github.com/fredbuhr/jessiemessage/pull/78), merge `c241ef67cdb1955beb14f698d0f60d8dffb56490`, arbre identique ; repère `release/0.62.0`. Les commits documentaires suivants ne changent pas le runtime épinglé.
- Checkout `/srv/customer/jessiemessage-operator/privacy-choices-062-a15b5595`, propre au relevé. Node 24, natif 24.15.0, port 3000, profil `messaging-photos-notify-recovery-crm-broadcast`, déploiement `primary-transition`, schéma 30.
- Principal `https://jessiemessage.com` ; `https://recette.jessiemessage.com` partage runtime et base : ce n’est pas une préproduction isolée.
- Six configurations dans `/srv/customer/jessiemessage-private/primary-origin-candidate-4a355851` ; opérations dans `/srv/customer/jessiemessage-private/recurring-backup-052`, répertoire 0700 et fichiers 0600. Aucune clé privée GPG installée sur le serveur.

Run Manager : `bash /srv/customer/jessiemessage-private/start-primary-privacy-choices-062-a15b5595.sh`. Lanceur 0700, **843 octets**, SHA-256 `1d9160db7e9b8752dfe9104f6ddedf48b4ae482af24653b253c95b9073ab30ce`.

Build :

```sh
cd /srv/customer/jessiemessage-operator/privacy-choices-062-a15b5595 && test "$(git rev-parse HEAD)" = a15b5595b804f2eccf95c13be46152570a6ebc12 && test "$(git rev-parse HEAD^{tree})" = d653aeb733cdc2bc7bd87853f747fbdd3010141c && test -z "$(git status --porcelain)" && npm run check
```

[Manager Node.js](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/h3/118579/nodejs/239143/data/dashboard) ; [terminal SSH](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/ssh-terminal/Node.js/terminal). Cycle normal de Build, sans réinstallation des dépendances ni réinitialisation du site. Run/Build enregistrés puis relus persistés avant lancement.

## Validation et portée

[CI source 39166239884](https://github.com/fredbuhr/jessiemessage/actions/runs/39166239884), [PR 39166243635](https://github.com/fredbuhr/jessiemessage/actions/runs/39166243635) et [main 39166461333](https://github.com/fredbuhr/jessiemessage/actions/runs/39166461333) : cinq jobs réussis chacune. **2 565 réussites générales, 27 wrappers SQL ignorés sur 2 592 cas**, zéro échec ; **387/387** sur chaque MariaDB 10.11/11.4 ; **144/144 Chrome**, authentification HTTPS/MFA intégrée, syntaxe de 471 sources et build réussis. Localement : 2 412 réussites et 180 intégrations indisponibles ignorées, zéro échec.

Hébergement : **195/195 contrôles natifs**, assertions CI activées et vrais ancrages privés inclus. Préflight réel terminé à **21:06:22.367582 UTC**, sans démarrage ni capture ; dépendances identiques et modules natifs repris de 0.61. Build/redémarrage normal, état Actif, modification **23:10 Europe/Paris**, précision à la minute.

Après le dernier message de démarrage : mesures **1792357854287 et 1792357914345**, intervalle **60 058 ms**, `current/OK`, aucun incident ; alertes correspondantes sans envoi en attente. À **21:11:22.962093 UTC**, **121/121 contrôles HTTPS** et **44 empreintes publiques exactes** sur les deux origines, TLS vérifié sans suivre les redirections ; faits de l’aide et refus anonymes vérifiés. À **21:12:30.784796 UTC**, source/arbre/version propres et copie PC courante conformes. [Preuve visuelle de l’aide publiée](activation-proofs/jm062-activation-20261018.jpg).

Le navigateur cloud reste anonyme. Les parcours administrateur positifs, conflits et changements de connexion sont éprouvés par les fixtures synthétiques Chrome/HTTP/natives. Aucun contenu client consulté/exporté ou message réel envoyé. Aucun fichier personnel de préparation au relevé.

## Préparation privée et sauvegardes

Les choix confirmés sont séparés des notes dans `server/privacy/choices.mjs`. L’API de préparation refuse leur mutation. D01/D04 sont préremplis uniquement pour une préparation nouvelle ; les anciens brouillons ne sont pas réécrits. Le futur `privacy-preparation.json` reste hors checkout, chiffré AES-256-GCM avec une sous-clé HKDF dérivée de la clé CRM existante. Aucune nouvelle clé, migration ni changement de format. Sa couverture par les sauvegardes et sa fin de vie restent à traiter avant de considérer une restauration applicative comme couvrante. `publication: draft_only` et `retention: not_enabled` qualifient la préparation, pas l’absence du critère de conversation désormais acquis.

Capture quotidienne **05:15 UTC**. Ne jamais lancer `capture --offline` pendant que l’application fonctionne ; utiliser le superviseur. Aucun checkpoint déclenché par ce lot. Dernière archive : `capture-1792300533262-3ae62972be4d93f5`, **402 792 octets** chiffrés, SHA-256 `dbd63e6d1a7d91b0f9372a062a761d5e92a4b3abb9dd9a44ddbcdd330d983578`. Dernier succès `1792300539807`, le 18 octobre à 05:15:39.807 UTC ; deux archives disponibles.

PC raccordé et actif ; reçu courant par identifiant/taille/SHA-256 relu à 21:12:30.784796 UTC. Dernier reçu **21:05:50.750 UTC**, **antérieur** à l’activation 0.62 ; la copie courante reste acquise. Le moniteur de capture conserve séparément `copyStatus: not_checked`. Les deux mails [TEST] incident/rétablissement sont confirmés reçus à **15:54:05 Europe/Paris** ; ne pas les renvoyer.

## Repli immédiat 0.61

Run/Build précédents dans `/srv/customer/jessiemessage-private/manager-before-privacy-choices-062.json`, 0600. Reprendre ces paramètres puis le cycle normal :

- checkout `/srv/customer/jessiemessage-operator/privacy-preparation-061-bc09053c` ;
- HEAD `bc09053c2d52a4d9b99e532d54ee382b0e92c510`, arbre `59c6273e2c8a5616d8bd0a3710749911d0d16e6e` ;
- Run `bash /srv/customer/jessiemessage-private/start-primary-privacy-preparation-061-bc09053c.sh` ;
- lanceur **851 octets**, SHA-256 `0d0faf9ec0be200445b2b5c4684946a946d3ed6de155ac2bc9e51f654f381355`.

Le checkout de référence est resté propre. Pas de restauration SQL nécessaire pour revenir au code 0.61 ; aucun repli réel provoqué. Conserver la préparation si elle apparaît, les configurations, copies et autorisations existantes. Le [relevé 0.61](privacy-preparation-061.md) conserve son repli historique 0.60.

## Raccordement prévu pour l’étape 3

Le moteur est une bibliothèque, sans commande de production permissive. Utiliser `createAccountErasure` avec `createErasureStore` et les journaux privés existants ; **clé de messages/diffusions pour les campagnes**, **clé CRM pour le journal**. La racine média doit correspondre à l’empreinte SQL. `readErasureJournalBatch` permet de retrouver les travaux après redémarrage, même si le compte SQL a disparu ; paginer jusqu’au bout et traiter aussi les reçus terminés pour détecter une réapparition.

Raccorder une intention administrative durable à une seule exclusion de l’application, des uploads, des transports et des captures. Examiner le protocole de drainage du superviseur de sauvegarde existant ; un verrou SQL, un snapshot ou un booléen offline ne remplace pas cette exclusion. Les points d’entrée HTTP sont autorisés et confirmés avant publication de l’intention, et jamais exposés comme un outil sans authentification. Les erreurs et accusés incertains restent des opérations à reprendre, sans prétendre à une fermeture terminée. Une restauration qui réintroduit un compte effacé doit rester bloquée avant réouverture jusqu’à sa réconciliation ; les changements de racine et la durée des reçus restent à traiter.

Les anciennes commandes `data … plan` restent des simulations non exécutables. Leur blocage historique ne constitue pas l’interface du nouveau moteur. Ne pas réutiliser les recettes destructives CI sur une base réelle.

## Plan restant en six lots

1. **Confidentialité/conservation — choix intégrés, textes définitifs encore ouverts** : Jessie/France et critère de conversation acquis. Ne pas ajouter de structure ni conclure à une exemption juridique parce que l’espace est privé. Traiter les autres familles, copies et conditions avec les fonctions correspondantes ; pas de nouveau questionnaire général à chaque reprise. La notice finale doit correspondre au comportement livré.
2. **Moteur d’effacement — code livré en 0.63** : transactions et journal chiffré reprenables, compte/sessions/files, messages/photos du client, profil CRM et audiences partagées. Essais réels sur données fictives acquis ; aucun compte réel effacé. Le moteur reste hors du runtime tant que le parcours et l’exclusion de tous les producteurs ne sont pas raccordés.
3. **Administration et conservation — prochain lot** : parcours graphique simple de fermeture définitive, requête authentifiée/CSRF et confirmation explicite, exclusion/drain des producteurs par le superviseur existant, progression/reprise et réouverture contrôlée ; copies et prévention de réapparition après restauration. Ne pas invoquer directement le moteur sur le runtime en activité.
4. **Sauvegarde/restauration courantes** : résultat personnel de déchiffrement sur le PC, puis restauration native isolée du profil courant ; couvrir la préparation d’exploitation. Les acquis de 0.46 (`COFFRE_DECHIFFRE_OK`, `COPIE_CRM30_OK`, import natif isolé) ne sont pas à refaire ou renommer en preuve de la capture actuelle. Ne pas régénérer ni déplacer la clé privée pour contourner une difficulté d’interface.
5. **Surveillance externe** : cadence fiable indépendante de l’hébergement et réception d’une alerte de panne totale ; ne pas redemander les mails locaux déjà acceptés.
6. **Recette finale** : contrôles ciblés de sécurité/fonctionnement, deux appareils habituels, premier essai personnel de diffusion, guide/repli consolidés. Les fonctions déjà acceptées restent acquises ; aucune campagne réelle envoyée sans instruction explicite.

Les P0 ne sont pas tous clos. Les fonctions de confort supplémentaires et connexions directes à Drive constituent une phase ultérieure. Garder ce périmètre pour terminer la version de base.
