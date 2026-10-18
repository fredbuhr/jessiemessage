# Reprendre JessieMessage

**0.60.0 est activée le 18 octobre 2026 à 22:00 Europe/Paris.** Chaque client peut télécharger sa propre conversation et les photos partagées, puis les lire hors ligne. Les réponses rapides administrateur FR/EN de 0.59, l’export administrateur 0.58 et la connexion simplifiée sont conservés. Aucun outil à réinstaller sur le PC.

Lire le [relevé 0.60](client-conversation-export-060.md), les [preuves structurées](activation-proofs/jm060-activation.json) et le [plan d’exploitation](production-readiness-2026-10-17.md). Les relevés [0.59](quick-replies-059.md), [0.58](conversation-export-058.md), [0.57](admin-comfort-057.md) et [0.56](backup-verification-056.md) sont historiques.

## Utilisation quotidienne

[Ouvrir mon espace](https://jessiemessage.com/app) ou [Administration](https://jessiemessage.com/admin/login). Une session valide est reprise ; une session effacée, expirée ou révoquée demande une connexion normale. Les conversations, invitations/clients, sauvegardes et l’état du service restent accessibles depuis l’accueil.

Côté client : dans la messagerie, **Télécharger ma conversation → Télécharger le ZIP**. Les photos partagées sont facultatives. Extraire le ZIP et ouvrir `Conversation.html` ; `conversation.json` conserve le même contenu dans un format portable. Le brouillon est conservé et aucun message n’est envoyé. Seule la conversation du compte invité actif est accessible.

Côté administration : **Fiche → Télécharger la conversation → Télécharger le ZIP** conserve le parcours 0.58. **Réponses rapides** propose six phrases en français ou en anglais, ajoutées à la fin du brouillon ; elles restent modifiables avant l’usage ordinaire d’Envoyer. Aucun envoi automatique.

Les archives lisibles en clair doivent rester dans un emplacement privé. Notes et noms internes, tags, groupes, e-mails du compte, clés, données de diffusion et bibliothèque non partagée sont exclus. Le téléchargement ne remplace ni une sauvegarde technique ni un dossier complet d’exercice des droits. Le fichier client ne révèle pas le classement interne ni une audience d’envoi.

Dans Sauvegardes, le résumé donne la dernière copie. Le dossier de destination se change depuis le raccourci Windows déjà installé. Le PC doit rester allumé, connecté et avec une session ouverte pour recevoir automatiquement les copies. Le contrôle ponctuel de déchiffrement est disponible séparément.

## Runtime actif

- HEAD exécuté et superviseur : `dd50d098dd5c35433190b8799359c7af00384d71` ; arbre `714aa8255d2184a2adbd413af2a989c1d7641119`.
- Repère `release/0.60.0`, [PR #76 fusionnée](https://github.com/fredbuhr/jessiemessage/pull/76), merge `1f2aad9ee256dc910bc79589493aaaeb07ce504d`. Arbre identique à la source testée. Les commits documentaires suivants ne changent pas le runtime épinglé.
- Inclut les réponses rapides 0.59 `6fab86ff2f346303cde2143d862b07c1137f65a2`. Les travaux simultanés du dossier partagé ont été préservés et les deux fonctions réunies et testées dans un checkout isolé.
- Checkout : `/srv/customer/jessiemessage-operator/client-conversation-export-060-dd50d098`, propre au relevé.
- Node 24, version native observée 24.15.0, port 3000 ; profil `messaging-photos-notify-recovery-crm-broadcast`, déploiement `primary-transition`, schéma 30.
- Principal `https://jessiemessage.com` ; `https://recette.jessiemessage.com` partage le même runtime et les mêmes données : ce n’est pas un environnement isolé.
- Six configurations privées : `/srv/customer/jessiemessage-private/primary-origin-candidate-4a355851` ; opérations `/srv/customer/jessiemessage-private/recurring-backup-052`, 0700 et fichiers privés 0600. Aucune clé privée GPG sur le serveur.

Run Manager : `bash /srv/customer/jessiemessage-private/start-primary-client-conversation-export-060-dd50d098.sh`. Lanceur 0700, 865 octets, SHA-256 `883812e812bce05bf99b5999e76c80291d451733c48418dfe25f6a2dc24f86f8`.

Build :

```sh
cd /srv/customer/jessiemessage-operator/client-conversation-export-060-dd50d098 && test "$(git rev-parse HEAD)" = dd50d098dd5c35433190b8799359c7af00384d71 && test "$(git rev-parse HEAD^{tree})" = 714aa8255d2184a2adbd413af2a989c1d7641119 && test -z "$(git status --porcelain)" && npm run check
```

[Manager Node.js](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/h3/118579/nodejs/239143/data/dashboard) ; [terminal SSH](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/ssh-terminal/Node.js/terminal). Utiliser le cycle normal de Build, sans réinstallation des dépendances ni réinitialisation du site.

## Validation et activation

[CI source 39160023380](https://github.com/fredbuhr/jessiemessage/actions/runs/39160023380), [PR 39160027765](https://github.com/fredbuhr/jessiemessage/actions/runs/39160027765) et [main 39160962667](https://github.com/fredbuhr/jessiemessage/actions/runs/39160962667) : cinq jobs réussis chacune. Source exacte : **2 545 réussites et 27 wrappers SQL ignorés sur 2 572 cas**, zéro échec ; **387/387** sur MariaDB 10.11 et 11.4 ; **133/133 Chrome**, sans saut ; authentification HTTPS/MFA intégrée ; syntaxe de 460 fichiers et build conformes.

Les tests client vérifient admission actuelle, compte/CSRF, conversation propre et photo du message exact, refus des autres comptes et absence de changement des reçus de lecture. Python lit réellement le ZIP et compare les textes et auteurs normalisés ; une première assertion de fixture cherchait à tort le texte brut dans des octets JSON/HTML échappés. Chrome exerce les vrais modules au clavier, en FR/EN, mobile/bureau : brouillon conservé, reprise explicite sans photos, changement de connexion, fermeture et masquage. Le même ensemble conserve les essais des réponses rapides.

Hébergement : **250/250 contrôles natifs sans saut**, préflight réel passé à **19:52:21.297144 UTC**, sans démarrage ni capture. Dépendances identiques à 0.59 hors versions racine, modules natifs copiés du runtime précédent. Run/Build sauvegardés puis relus après enregistrement. Cycle Manager lancé à **20:00:27.168 UTC** ; état Actif, modification **22:00 Europe/Paris**.

Après le dernier message de démarrage : mesures **20:00:50.200 et 20:01:50.233 UTC**, intervalle **60 033 ms**, `current / OK`, aucun incident ; observations d’alertes correspondantes sans envoi en attente. [Preuve visuelle](activation-proofs/jm060-activation-20261018.jpg).

À **20:07:11.906506 UTC**, **114/114 contrôles HTTPS**, TLS vérifié sans suivre les redirections, dont **32 empreintes exactes** : fichiers des deux origines, aide publique, navigations administrateur, modules privés, méthode/origine et refus anonymes des exports client/administrateur, santé et sauvegardes réservées au principal. Une erreur de syntaxe du script de relevé a été corrigée avant son exécution ; les 114 sondes ont ensuite toutes passé. Aucun Build, capture ou mail de test répété.

À **20:08:42.834 UTC**, source et version 0.60.0 relues propres, journal de quatre enregistrements et dernier succès inchangés ; aucun incident ni alerte en attente. L’absence de `backup-alert-state.json` correspond à l’état vide validé par le lecteur applicatif. Les rapports privés sont référencés dans le JSON de preuve ; aucun contenu client ni secret n’est publié.

Le navigateur cloud reste anonyme : aucun téléchargement d’une conversation personnelle n’est présenté comme observé. Les essais positifs utilisent les fixtures SQL/Chrome synthétiques. Une coupure de la saisie native a été contournée avec les contrôles DOM documentés de la console ; aucune modification de compte ou d’identifiant. La capture finale utilise une nouvelle vue du même service actif.

## Connexion et bornes de l’export

Sessions indépendantes de **180 jours glissants**, sans coupure d’inactivité. Cookies Strict/Secure/HttpOnly, MFA, origine, CSRF et révocation conservés. Les navigations HTML administrateur venant d’un autre site passent par le document public de connexion puis prouvent la session depuis la même origine. Les API gardent leurs refus ; aucun nouveau droit de lecture.

Le rôle client est fixé côté serveur et le compte doit être actuellement admis. La conversation est comparée à celle du compte avant/après préparation ; compte et CSRF sont aussi relus avant les en-têtes. Le navigateur contrôle son identité avant et après la réponse. Un 401 d’export tardif n’efface pas une nouvelle connexion.

Limites : 10 000 messages, huit mébioctets de texte et 32 mébioctets au total ; soixante secondes de préparation, délai de 65 s pour le transfert et le navigateur, trente secondes entre préparations. Un export avec son transfert par rôle à la fois, partagé entre les deux origines ; créneaux client et administrateur distincts. Un destinataire lent ne libère pas son créneau pour accumuler d’autres archives. Annulation sur fermeture, masquage, changement de compte ou arrêt, sans répétition ; buffers effacés et URL temporaires révoquées. Aucun fichier clair temporaire sur le serveur ni ZIP partiel proposé.

La conversation peut évoluer pendant la préparation : pas de snapshot SQL global. Le format v1 conserve les auteurs normalisés (`me` = Jess, `peer` = client), quel que soit le compte qui télécharge.

## Sauvegardes conservées

Capture quotidienne **05:15 UTC**. Ne jamais lancer `capture --offline` pendant l’exécution de l’application ; utiliser le superviseur. Aucun checkpoint déclenché dans ce lot.

Dernière archive : `capture-1792300533262-3ae62972be4d93f5`, chiffré 402 792 octets, SHA-256 `dbd63e6d1a7d91b0f9372a062a761d5e92a4b3abb9dd9a44ddbcdd330d983578`. Dernier succès `1792300539807`, 18 octobre à 05:15:39.807 UTC. Deux archives disponibles au relevé 0.56 ; aucun retrait dans ce lot.

Mon PC est raccordé et actif ; sa copie courante est confirmée par identifiant, taille et SHA-256. Dernier reçu observé **20:05:52.663 UTC**, donc **après** l’activation 0.60. Le moniteur de capture conserve séparément `copyStatus: not_checked`. Réception de copie et déchiffrement sont des preuves distinctes. Les deux mails [TEST] incident/rétablissement ont été confirmés reçus le 18 octobre à 15:54:05 Europe/Paris ; ne pas les renvoyer.

## Repli immédiat 0.59

Run/Build antérieurs dans `/srv/customer/jessiemessage-private/manager-before-client-conversation-export-060.json`, mode 0600, sauvegardés avant changement. Reprendre ces paramètres puis le cycle Manager normal :

- checkout `/srv/customer/jessiemessage-operator/quick-replies-059-6fab86ff` ;
- HEAD `6fab86ff2f346303cde2143d862b07c1137f65a2`, arbre `29ee7d3b884e41c778308b1f07e47f90201426d9` ;
- Run `bash /srv/customer/jessiemessage-private/start-primary-quick-replies-059-6fab86ff.sh`.

Checkout propre, lanceur 839 octets, SHA-256 `5329eeba534085f84d40a441fec64ea2f45f85a391f4877e1559abda50e1b052`. Sa dérivation exacte depuis le lanceur 0.58 déjà vérifié a été contrôlée avant préparation. Les [preuves 0.59](activation-proofs/jm059-activation.json) conservent son activation antérieure et sa recette. Aucun repli réel ni restauration SQL provoqué pour ce lot ; aucune restauration SQL n’est nécessaire pour revenir au code 0.59. Conserver les configurations, l’état de copie et les autorisations.

## Reste à traiter

Le déchiffrement de la capture courante avec la clé personnelle du PC, puis sa restitution native courante, restent à constater. Les acquis historiques du coffre de configurations et du relevé 0.46 (`COFFRE_DECHIFFRE_OK`, `COPIE_CRM30_OK`, import natif isolé de trente tables et photos) restent acquis, sans devenir une preuve de cette capture. Ne pas régénérer ni déplacer la clé privée pour contourner une difficulté d’interface.

Les durées de conservation, les décisions de confidentialité, le responsable du traitement et l’effacement complet restent ouverts. Aucune purge ni identité légale inventée. L’export d’une conversation ne clôt pas ces sujets. La cadence maximale de surveillance externe et la réception de ses alertes gardent leurs limites documentées. L’ensemble des P0 de mise en production n’est pas déclaré clos.
