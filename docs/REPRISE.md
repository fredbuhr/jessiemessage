# Reprendre JessieMessage

**0.61.0 est activée le 18 octobre 2026 à 22:40 Europe/Paris.** Itération 1/6 : la préparation graphique privée des décisions de confidentialité et des notices FR/EN est livrée. Les faits D01–D08 et les textes définitifs restent à finaliser ; aucun effacement ou consentement nouveau n’est activé. Les versions 0.60 (export client), 0.59 (réponses rapides), 0.58 (export administrateur) et la connexion simplifiée sont conservées.

Lire le [relevé 0.61](privacy-preparation-061.md), les [preuves structurées](activation-proofs/jm061-activation.json) et le [plan d’exploitation](production-readiness-2026-10-17.md). Le [relevé 0.60](client-conversation-export-060.md) et les précédents sont historiques ; ne pas reprendre leurs anciens Run/Build comme paramètres actifs.

## Utilisation quotidienne

[Ouvrir mon espace](https://jessiemessage.com/app) ou [Administration](https://jessiemessage.com/admin/login). Une session valide est reprise. Depuis l’accueil : conversations, invitations/clients, sauvegardes, confidentialité et état du service. Sessions indépendantes de **180 jours glissants**, sans coupure d’inactivité ; cookies Strict/Secure/HttpOnly, MFA, origine, CSRF et révocation conservés. Les navigations administrateur depuis un autre site passent par le document public de connexion puis prouvent la session sur la même origine ; les API gardent leurs refus.

**Confidentialité** : trois panneaux regroupent les huit points D01–D08 ; réponses partielles et textes FR/EN enregistrables en brouillon privé chiffré. La langue de l’aperçu est indépendante de l’interface. Saisies et textes restent littéraux, sans traduction automatique. Une autre connexion retire la préparation locale ; un conflit entre appareils conserve les modifications et propose une comparaison, sans répétition automatique de l’écriture. Huit points renseignés ne signifient pas validation juridique. Aucun fichier personnel dans Git/CI et aucune notice incomplète servie au public.

Côté client : **Télécharger ma conversation → Télécharger le ZIP**, photos partagées facultatives ; extraire et ouvrir `Conversation.html`, ou conserver `conversation.json`. Côté administration : **Fiche → Télécharger la conversation → Télécharger le ZIP**. Les archives excluent notes et noms internes, tags, groupes, e-mails, clés, données d’audience et photos non partagées. Elles restent en clair hors du service ; elles ne remplacent ni la sauvegarde technique ni un dossier complet d’exercice des droits.

**Réponses rapides** propose six phrases FR/EN ajoutées à la fin du brouillon, modifiables avant Envoyer. Aucun envoi automatique. Diffusions : chaque destinataire reçoit un message ordinaire, sans réglage client d’acceptation ni métadonnées d’audience ; aperçu et confirmation administrateur conservés, limite actuelle de 100 destinataires par campagne.

Dans **Sauvegardes**, le résumé donne l’état des copies. Le dossier se change par le raccourci Windows déjà installé. Le PC doit être allumé, connecté et avec une session ouverte ; aucun outil à réinstaller. Le contrôle ponctuel du déchiffrement reste disponible séparément.

## Runtime actif et déploiement

- HEAD exécuté et superviseur : `bc09053c2d52a4d9b99e532d54ee382b0e92c510` ; arbre `59c6273e2c8a5616d8bd0a3710749911d0d16e6e`.
- [PR #77 fusionnée](https://github.com/fredbuhr/jessiemessage/pull/77), merge `c06d70b6ad0bebd787e6d3cfa458f774691ada15`, arbre identique ; repère `release/0.61.0`. Les commits documentaires suivants ne changent pas le runtime épinglé.
- Checkout `/srv/customer/jessiemessage-operator/privacy-preparation-061-bc09053c`, propre au relevé. Node 24, natif 24.15.0, port 3000, profil `messaging-photos-notify-recovery-crm-broadcast`, déploiement `primary-transition`, schéma 30.
- Principal `https://jessiemessage.com` ; `https://recette.jessiemessage.com` partage le runtime et la base : ce n’est pas un environnement isolé.
- Six configurations dans `/srv/customer/jessiemessage-private/primary-origin-candidate-4a355851` ; opérations dans `/srv/customer/jessiemessage-private/recurring-backup-052`, répertoire 0700 et fichiers 0600. Aucune clé privée GPG sur le serveur.

Run Manager : `bash /srv/customer/jessiemessage-private/start-primary-privacy-preparation-061-bc09053c.sh`. Lanceur 0700, 851 octets, SHA-256 `0d0faf9ec0be200445b2b5c4684946a946d3ed6de155ac2bc9e51f654f381355`.

Build :

```sh
cd /srv/customer/jessiemessage-operator/privacy-preparation-061-bc09053c && test "$(git rev-parse HEAD)" = bc09053c2d52a4d9b99e532d54ee382b0e92c510 && test "$(git rev-parse HEAD^{tree})" = 59c6273e2c8a5616d8bd0a3710749911d0d16e6e && test -z "$(git status --porcelain)" && npm run check
```

[Manager Node.js](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/h3/118579/nodejs/239143/data/dashboard) ; [terminal SSH](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/ssh-terminal/Node.js/terminal). Utiliser le cycle normal de Build, sans réinstallation des dépendances ni réinitialisation du site. Les commandes sont vérifiées avant Build puis relues après enregistrement.

## Validation et limites des preuves

[CI source 39163785035](https://github.com/fredbuhr/jessiemessage/actions/runs/39163785035), [PR 39163789313](https://github.com/fredbuhr/jessiemessage/actions/runs/39163789313) et [main 39164050712](https://github.com/fredbuhr/jessiemessage/actions/runs/39164050712) : cinq jobs réussis chacune. Source exacte : **2 563 réussites générales et 27 wrappers SQL ignorés sur 2 590 cas**, zéro échec ; **387/387** sur MariaDB 10.11 et 11.4 ; **144/144 Chrome** sans saut ; authentification HTTPS/MFA intégrée, syntaxe de 470 sources et build réussis.

Hébergement : **175/178 contrôles natifs réussis**, zéro échec, trois assertions réservées à CI ignorées lorsque CI est absent ; les vrais essais d’ancrage Linux passent. Préflight réel à **20:36:53.053846 UTC**, sans démarrage ni capture. Dépendances comparées inchangées et modules natifs copiés de 0.60. Après le cycle Manager : état Actif, modification **22:40 Europe/Paris**.

Après le dernier message de démarrage : mesures **1792356054020 et 1792356114072**, intervalle **60 052 ms**, `current/OK`, aucun incident ; alertes correspondantes sans envoi en attente. À **20:41:50.037841 UTC**, **122/122 contrôles HTTPS** et **44 empreintes exactes publiques** sur les deux origines, TLS vérifié sans redirection, refus anonymes de la préparation, des exports et des fichiers privés vérifiés. À **20:43:30.630312 UTC**, source/arbre/version relus propres, copie PC courante et fraîcheur saine. [Preuve visuelle](activation-proofs/jm061-activation-20261018.jpg).

Le navigateur cloud reste anonyme : les écritures positives et changements de compte de l’écran de préparation sont éprouvés par les fixtures synthétiques Chrome/HTTP/natives. Aucun contenu client exporté ni message réel envoyé. Au relevé, aucun fichier personnel de préparation n’existe encore.

## Préparation privée et sauvegardes

Le fichier futur `privacy-preparation.json` reste hors checkout, chiffré AES-256-GCM avec une sous-clé HKDF dédiée dérivée de la clé CRM existante. Aucune nouvelle clé persistante ni migration. Sa couverture par les sauvegardes et sa fin de vie doivent être traitées dans les lots conservation/restauration avant de les considérer acquises. Le repli du code conserve ce fichier s’il apparaît. Enregistrer un brouillon ne publie pas de notice, n’active aucune durée ni aucun effacement et ne recueille pas un consentement.

Capture quotidienne **05:15 UTC**. Ne jamais lancer `capture --offline` pendant que l’application fonctionne ; utiliser le superviseur. Aucun checkpoint déclenché dans ce lot. Dernière archive : `capture-1792300533262-3ae62972be4d93f5`, 402 792 octets chiffrés, SHA-256 `dbd63e6d1a7d91b0f9372a062a761d5e92a4b3abb9dd9a44ddbcdd330d983578`. Dernier succès `1792300539807`, le 18 octobre à 05:15:39.807 UTC ; deux archives disponibles.

PC raccordé et actif ; reçu courant par identifiant/taille/SHA-256 relu à 20:43:30.630312 UTC. Dernier reçu **20:35:51.068 UTC**, **antérieur** à l’activation 0.61 ; la copie courante reste acquise, sans revendication de reçu postérieur à ce lot. Le moniteur de capture garde séparément `copyStatus: not_checked`. Les deux mails [TEST] incident/rétablissement ont été confirmés reçus à **15:54:05 Europe/Paris** ; ne pas les renvoyer.

## Repli immédiat 0.60

Run/Build sauvegardés dans `/srv/customer/jessiemessage-private/manager-before-privacy-preparation-061.json`, 0600. Reprendre ces paramètres puis le cycle normal :

- checkout `/srv/customer/jessiemessage-operator/client-conversation-export-060-dd50d098` ;
- HEAD `dd50d098dd5c35433190b8799359c7af00384d71`, arbre `714aa8255d2184a2adbd413af2a989c1d7641119` ;
- Run `bash /srv/customer/jessiemessage-private/start-primary-client-conversation-export-060-dd50d098.sh` ;
- lanceur 865 octets, SHA-256 `883812e812bce05bf99b5999e76c80291d451733c48418dfe25f6a2dc24f86f8`.

Le checkout de référence a été contrôlé propre avant préparation. Aucune restauration SQL nécessaire pour revenir au code 0.60, aucune restauration ou aucun repli réel provoqué. Conserver les configurations, l’état des copies et toutes les autorisations existantes. Le [relevé 0.60](client-conversation-export-060.md) conserve son repli historique 0.59.

## Plan restant en six lots

1. **Confidentialité/conservation — en cours** : outil privé livré ; compléter les faits et décisions D01–D08, finaliser les notices FR/EN et leur publication concordante. Prévoir un recueil/retrait distinct si une condition de consentement est retenue pour les contenus sensibles. Aucun nom juridique ni durée générale inventés.
2. **Effacement complet** : moteur durable et reprenable, compte/sessions/files, messages/photos et références partagées ; tests synthétiques de reprise et d’isolation.
3. **Administration et conservation** : parcours graphique d’effacement, application des règles choisies, copies et prévention de réapparition après restauration.
4. **Sauvegarde/restauration courantes** : résultat personnel de déchiffrement sur le PC, puis restauration native isolée du profil courant ; intégrer la couverture de la préparation d’exploitation. Les acquis du coffre et de 0.46 (`COFFRE_DECHIFFRE_OK`, `COPIE_CRM30_OK`, import natif isolé) ne sont pas à refaire ou à renommer en preuve de la capture actuelle. Ne pas régénérer ou déplacer la clé privée pour contourner une difficulté d’interface.
5. **Surveillance externe** : cadence fiable indépendante de l’hébergement et réception d’alerte de panne totale ; ne pas redemander les mails locaux déjà acceptés.
6. **Recette finale** : contrôles ciblés de sécurité et de fonctionnement, deux appareils habituels, premier essai personnel de diffusion et consolidation du guide/repli. Les nombreuses fonctions déjà acceptées restent acquises ; aucune campagne réelle envoyée par l’agent sans instruction explicite.

Les P0 ne sont pas tous clos. Les nouvelles fonctions de confort et connexions directes à Drive constituent une phase ultérieure. Maintenir ce périmètre pour terminer la version de base.
