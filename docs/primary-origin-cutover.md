# Adresse principale — opération 0.37 du 17 octobre 2026

Le préalable 0.36 est accepté : copie indépendante du checkpoint applicatif au schéma 30 et import natif isolé authentifié, reçu personnel à 15:26 Europe/Paris. La présente opération conserve le schéma, les données, les clés et les abonnements Push. Le retour personnel de 17:28 confirme globalement le parcours proposé ; sa portée et les précisions encore manquantes figurent ci-dessous.

**État à 17:40 Europe/Paris : fonctionnement confirmé, présentation de la reprise corrigée.** Le propriétaire confirme globalement le parcours proposé à **17:28** ; cette recette n’est pas à refaire en bloc. Toutes les plateformes, six à huit appareils simultanés ou un nouveau scénario Push précis ne sont pas détaillés. Le runtime courant `0c88f61bf6b0a9bcf45917862462db838bf73c78`, arbre `7df1c850d84597be96f458a69ca9955f8e6c257a`, est activé à **17:38**. Les cinq jobs CI exacts réussissent ; **50 contrôles sur 50 et vingt-deux empreintes** passent à **17:38:47.078215**, dont 46 requêtes HTTPS ordinaires et quatre contrôles Host loopback. Le [correctif d’interface](device-transition-interface.md) espace les actions, donne la priorité à la connexion si nécessaire et corrige le texte de conflit. Il conserve la correction réseau précédente, sans changement DNS, SQL, clés, sessions ou protocole. Son recontrôle visuel en ligne vers **17:40** confirme le nouveau rendu, notamment l’espacement de 12 px entre les deux actions. Le parcours d’accueil confirmé à 17:00 et les vérifications de 16:14/16:59 sont conservés ci-dessous comme preuves datées. Recette reste accessible sans redirection et `www` redirige vers l’apex.

**Historique à 15:48:32 : blocage initial et repli vérifié.** Les trois premiers essais d’alias avec mise à jour DNS automatique ne créaient aucun rattachement. Le lien Apache et le runtime 0.33 ont été rétablis, puis 39 contrôles HTTP et quatorze empreintes sont passés. Cette preuve reste datée ; elle n’est plus le déploiement courant.

## Runtime courant, candidat initial et repli

Le runtime courant est **`0c88f61bf6b0a9bcf45917862462db838bf73c78`**, arbre **`7df1c850d84597be96f458a69ca9955f8e6c257a`**, checkout `/srv/customer/jessiemessage-operator/device-transition-ui-0c88f61b`. Le [correctif d’interface, PR #52](https://github.com/fredbuhr/jessiemessage/pull/52), est construit sur `feat/device-transition-notification-retry`. Ses cinq [jobs CI exacts](https://github.com/fredbuhr/jessiemessage/actions/runs/39045662415) réussissent : 2 076 cas généraux réussis et 27 wrappers SQL ignorés sur 2 103 ; 370/370 sur chacune des MariaDB 10.11 et 11.4, 53/53 Chrome applicatifs et une authentification Chrome/HTTPS/MariaDB, sans échec. Les contrôles de géométrie couvrent 24 contextes et 48 mesures FR/EN, six états et quatre largeurs. Localement, 1 960 réussites et 143 intégrations ignorées sur 2 103 ; les 59 tests ciblés passent sans saut.

Le préflight du runtime d’interface passe sans listener à **17:35:13**. Le lanceur exclusif `/srv/customer/jessiemessage-private/start-primary-transition-ui-0c88f61b.sh` est créé à **17:35:42.068922**, mode `0700`, SHA-256 **`01721dd4ea63db50ef269138cee9098047ffb57e4b5c57a7763c16edbd761787`**. Run/Build sont épinglés ; build/redémarrage réussissent à **17:38** et les logs confirment `primary-transition` sur le même listener, pool et ensemble de workers. Aucun DNS, SQL, clé, session ou protocole de reprise n’est changé.

Le **repli direct privilégié** est `3e952101f7c7aa3d7536e7cb7cc57de83dee71ac`, arbre `8dd5d28c750edc6f417b2339aa67c3ab344d183e`, checkout `/srv/customer/jessiemessage-operator/device-transition-retry-3e952101`, avec son lanceur conservé `/srv/customer/jessiemessage-private/start-primary-transition-retry-3e952101.sh`. Ce lanceur `0700`, créé à **16:55:29.516139**, a le SHA-256 **`5dc3436530d1ab5dba4370aff03b8bd041aea43b03baab9ee530e8e2c27e21c4`**. Son préflight à 16:54:46 et son activation à 16:57 restent des preuves historiques. Il préserve la correction de reprise réseau mais perd la nouvelle présentation.

Le code de transition initial reste `a0b17ce0a82a317b8a4f6782b26eef52fe9430b6`, arbre `44ea8cf1e0c3c2d0cbfe80aba6ac98ea22224af0`, checkout `/srv/customer/jessiemessage-operator/device-transition-a0b17ce0`. Ses cinq jobs CI sont ceux de la [validation 0.35](device-origin-transition.md). Il accepte les deux origines mais est un repli plus ancien, qui perdrait la correction réseau et la nouvelle présentation ; privilégier `3e952101`. La configuration primaire reste `/srv/customer/jessiemessage-private/primary-origin-candidate-4a355851`, avec les mêmes clés, SQL et stockage. Le préflight initial passe à **15:28:57** sans démarrer de serveur.

Le lanceur privé initial `0700` est créé exclusivement à **15:31:23** : `/srv/customer/jessiemessage-private/start-primary-transition-a0b17ce0.sh`, SHA-256 `436b6f965c8885e85f85d33d92e9a30eff907a45f2338fa0535b96fc3a35fa52`. Il épingle révision, arbre et checkout propre, nettoie les options Node héritées et lance explicitement `--deployment primary-transition --profile photos-notify`. Sa syntaxe Bash est vérifiée ; il ne contient aucune clé ou mot de passe. Il reste disponible pour cet ancien repli ; le lanceur `3e952101` est désormais privilégié.

L’ancien code **0.33 `f2677249ebd3a29b10e1fecfa34bfd6b6c1ff612`**, arbre `3532099ddcf3dfd71545783e40967ed8feb49841`, checkout `/srv/customer/jessiemessage-operator/notification-open-f2677249`, lanceur `/srv/customer/jessiemessage-private/start-private-notification-open-f2677249.sh`, reste compatible avec le schéma 30. Il ne suffit toutefois pas seul après la bascule DNS : son refus du Host apex exige une opération coordonnée domaine/DNS et runtime, décrite en fin de document. Aucun import SQL ou retour au schéma 28 n’est nécessaire pour cette compatibilité de code.

## Inventaire observé avant déplacement

| Élément | Valeur conservée |
| --- | --- |
| Hébergement | `812119`, offre 3 sites utilisés sur 21 |
| Site Node.js | environnement `118579`, application `239143`, Node 24, port 3000 |
| Domaines Node initiaux | `recette.jessiemessage.com` principal ; nom de prévisualisation temporaire |
| Site Apache d’accueil | `1532641`, principal `accueil.jessiemessage.com` ; alias apex et `www` |
| Document root Apache | `/sites/jessiemessage-entry-1f669e45` |
| IPv4 / IPv6 Apache | `185.176.225.16` / `2001:1600:0:aaaa::80:81` |
| IPv4 / IPv6 Node | `185.125.27.89` / `2001:1600:4:11::576` |

Les trois noms apex, `www` et recette disposent de A/AAAA indépendants, sans CNAME. Le certificat effectivement présenté par Node couvre déjà `jessiemessage.com` et `recette.jessiemessage.com`, jusqu’au 13 janvier 2027 ; son empreinte SHA-256 est `79ebd3d14cd0ed5b7b4ecd3d33ea615732b578673a044d740e413895cf51cb70`. Le Manager n’énumère cependant que recette comme domaine lié. Le certificat Apache couvre accueil, apex et `www`, jusqu’au 13 janvier 2027 ; empreinte `1400772e9c48807aa20bdf940cb5a8be72c410e21d6e8ebbca149bbd0ff25d67`. Les vérifications TLS emploient la chaîne et le nom attendus, sans exception de confiance.

Les valeurs MX, TXT de l’apex et TXT DMARC sont hachées avant l’opération pour comparer leur état ensuite, sans publier leur contenu. Aucun réglage de messagerie n’est édité. `www` doit rester sur Apache pour sa canonicalisation fixe vers l’apex ; le supprimer ou le diriger vers le listener privé ferait perdre ce comportement. Recette doit rester liée à Node sans redirection afin de conserver les anciens appareils et liens Push.

## Historique — premier essai de runtime et de rattachement

Le Manager enregistre Run/Build épinglés sur le candidat, puis le build réussit et redémarre l’unique application à **15:34**. Les logs annoncent `deployment: primary-transition`, écoute sur 3000. À **15:35:31**, cinq contrôles HTTPS sur recette passent : disponibilité, empreintes de `/app`, du script de transition et de sa page administrateur, refus de session anonyme. Aucun second listener ni worker n’est démarré.

L’alias apex est délié d’Apache en laissant **décochée la suppression des DNS** ; l’accueil, son dossier et `www` restent conservés. Le formulaire Node d’ajout est ensuite essayé sur le seul apex, sans ajout de `www`, avec mise à jour DNS Web. Après le retour sans rattachement, il est rechargé et le domaine existant est choisi dans la liste de l’organisation. Une demande avec mise à jour du certificat est également essayée. Dans les trois cas, le bouton redevient disponible sans navigation, sans erreur affichée ni alias ajouté. L’inventaire Node rechargé reste à deux noms. Les journaux de console ne fournissent pas d’erreur applicative exploitable ; les erreurs de l’extension du navigateur ne sont pas attribuées à Infomaniak.

Un contrôle direct avec résolution explicite de l’apex vers l’IPv4 Node échoue pendant la négociation TLS par fermeture de connexion ; il ne prouve donc ni un Host transmis au runtime ni une affectation effective. Aucun contrôle TLS n’est contourné et aucun DNS n’est changé manuellement pour forcer une route non confirmée. Le certificat couvrant un nom ne prouve pas que ce nom est rattaché au frontal.

Le même ajout de l’apex à l’accueil Apache réussit, en laissant décochés ajout de `www`, mise à jour DNS et mise à jour SSL. Le Manager retrouve ses trois noms. L’accueil et son lien temporaire vers recette sont ainsi rétablis. Les contrôles de navigateur confirment accueil visible, `/app` vers recette et `www` vers l’apex ; la disponibilité de recette reste à 200. Run/Build sont ensuite rétablis sur la révision 0.33 épinglée ci-dessus. Le build et le redémarrage réussissent à **15:47** ; les logs confirment l’unique service `messaging-photos-notify` sans le déploiement `primary-transition`. Ce repli conserve des liens d’invitation utilisables tant que l’apex n’est pas rattaché à Node.

## Historique — vérification réelle du repli à 15:48

À **15:48:32 Europe/Paris**, le checkout hébergé 0.33 est propre, sa révision et son arbre sont exacts, et son préflight privé retourne `checks_passed`. Le contrôle HTTPS avec vérification TLS et un User-Agent explicite renvoie :

```json
{"status":"rollback_http_verified","checks":39,"passed":39,"assetHashes":14,"failedChecks":[],"authenticatedSessionsTested":false,"pushDeliveryTested":false}
```

Les quatorze fichiers sont comparés aux octets du checkout 0.33 : entrée et son modèle/style, chat et son modèle, notifications et lien ciblé, service worker, manifeste, horloge de session et les trois fichiers de langue/style. Santé et disponibilité répondent à 200 ; les sessions et API privées anonymes sont refusées ; les pages privées rejoignent leur connexion ; les fichiers privés et sources sont à 404 ; deux POST avec une Origin étrangère sont refusés à 403. L’accueil apex répond à 200, son `/app` à 302 vers recette, et `www/app` à 308 vers l’apex. Ces contrôles n’envoient pas de notification et n’ouvrent pas de compte réel.

Les A/AAAA de l’apex, de `www` et de recette correspondent à l’inventaire initial. Les empreintes des trois jeux d’enregistrements mail mesurés restent identiques :

| Jeu mesuré | Nombre | SHA-256 canonique |
| --- | --- | --- |
| MX apex | 1 | `d421570af14198b678536dd3d13697410c9d3b6c08e187b4128ce008d26e4f0a` |
| TXT apex | 1 | `4d6701cea77973b17af3e4124492fbc008430565e71ab57c93cd13c5fffb963a` |
| TXT DMARC | 1 | `16e19f1c00f7ce1b3f561c899a6d05b5aedd370783110dd11a2f46a3fa151456` |

Le hash porte sur le JSON de la liste triée des représentations JSON de chaque réponse DNS. Aucun sélecteur DKIM n’avait alors été interrogé : ce relevé de 15:48 ne prétend pas certifier les enregistrements non mesurés. Aucun DNS mail, secret, droit SQL ou schéma n’a été changé pendant l’opération 0.37.

Le mécanisme interne de l’échec silencieux n’était pas établi. Il ne prouvait ni une limite de l’offre ni une panne générale. La [procédure officielle d’alias](https://www.infomaniak.com/fr/support/faq/1946/ajouter-un-nom-de-domaine-supplementaire-a-un-site-chez-infomaniak) distingue explicitement le rattachement et les options de mise à jour DNS/SSL. Le [guide de passage du sous-domaine au domaine](https://www.infomaniak.com/fr/support/faq/2160/remplacer-un-sous-domaine-par-un-domaine) propose ensuite l’inversion des rôles ; sa suppression finale de l’ancien nom ne convient pas à notre transition des appareils.

## Résolution KISS sans recours au support

Les trois essais initiaux avaient tous **mise à jour DNS automatique activée**. Cette opération était donc encore couplée au rattachement, alors que l’ajout Apache sans cette option avait réussi. L’essai distinct suivant est réalisé :

1. Délier le seul apex d’Apache, **suppression DNS décochée**, en conservant accueil, `www` et le dossier.
2. Ouvrir à neuf l’ajout de domaine Node et sélectionner le domaine existant de l’organisation.
3. Décocher **www, mise à jour DNS et mise à jour SSL**, puis valider.

Cette variante réussit : toast « Le ou les domaines ont été ajoutés », retour au tableau de bord et trois domaines, dont `jessiemessage.com` alias. À **16:04:49**, une résolution explicite vers les IPv4 et IPv6 Node reçoit HTTP **421** avec TLS vérifié ; c’est le refus attendu du runtime 0.33 encore actif. Le frontal accepte donc désormais le SNI, puis transmet le Host à l’application. Le même contrôle échouait avant le rattachement pendant TLS.

Le problème est ainsi contourné en séparant l’opération combinée avec DNS automatique. Cette comparaison ne révèle pas l’erreur interne exacte de cette automatisation. Aucun correctif applicatif, proxy supplémentaire, nouvelle application ou nouveau secret n’est nécessaire.

## Activation du runtime et des deux entrées Web

Run/Build sont réenregistrés sur le candidat exact et son lanceur privé déjà vérifié. Le build et le redémarrage réussissent à **16:06**, avec `deployment: primary-transition` dans le log du même service. À **16:07:08**, l’apex résolu explicitement sur chacune des IP Node et recette avec ses DNS normaux répondent tous à 200 sur `/api/ready`. Le checkout propre, sa révision, son arbre et l’empreinte du lanceur sont recontrôlés ; le préflight renvoie `checks_passed`, sans listener supplémentaire, à **16:07:51**.

La [modification d’enregistrements existants](https://www.infomaniak.com/fr/support/faq/2000/modifier-une-zone-dns-mode-simple-dun-domaine-gere-par-infomaniak) est ensuite utilisée pour les **deux seules entrées Web de l’apex**, sans changer le TTL d’une heure :

| Entrée | Avant | Après |
| --- | --- | --- |
| `jessiemessage.com A` | `185.176.225.16` | `185.125.27.89` |
| `jessiemessage.com AAAA` | `2001:1600:0:aaaa::80:81` | `2001:1600:4:11::576` |

L’A est enregistré à **16:09:53**, l’AAAA vers **16:12**. À **16:12:35**, le résolveur normal du serveur renvoie les deux nouvelles adresses. `www` conserve ses A/AAAA Apache et sa redirection fixe 308 vers l’apex ; recette conserve ses A/AAAA Node et **aucune redirection**.

Le libellé principal du Manager reste `recette.jessiemessage.com`, et l’apex reste alias. Le dialogue d’inversion a été consulté puis annulé : il annonce la perte des statistiques, et ce changement administratif n’est pas nécessaire au routage. Les origines de l’application sont fixes et le Host sélectionne les handlers ; `https://jessiemessage.com` est bien l’adresse principale publique et celle des nouveaux e-mails. Le [guide d’inversion](https://www.infomaniak.com/fr/support/faq/2070/modifier-le-nom-de-domaine-dun-site) confirme que renommer un hébergement n’agit pas sur ses URL. Aucune inversion, suppression d’ancien domaine ou redirection de recette n’a été appliquée.

## Historique — vérification de l’activation initiale

À **16:14:07 Europe/Paris**, le lot comprend **58 requêtes HTTPS avec les DNS normaux du serveur**, chaîne et nom TLS vérifiés, et **quatre requêtes HTTP sur le listener loopback** pour contrôler les Host. Les 62 contrôles passent :

```json
{"status":"primary_transition_http_verified","checks":62,"passed":62,"assetHashes":38,"failedChecks":[],"authenticatedSessionsTested":false,"pushDeliveryTested":false}
```

Les **38 empreintes** sont réparties en dix-neuf par origine : dix-sept fichiers statiques, dont accueil, entrée, notifications, service worker, manifeste et scripts/styles de reprise ; plus les deux pages de reprise avec substitution des deux origines fixes. Les attentes HTTP complètent ces comparaisons :

| Contrôle | Résultat sur les deux origines |
| --- | --- |
| `/api/ready` | 200 et `status: ready` |
| `/api/entry` sans cookie | 200 ; apex propose `/connect-device/client` et `/connect-device/admin`, recette conserve `/access` et `/admin/login` |
| Sessions administrateur/client anonymes | 401 |
| POST logout avec l’Origin de l’autre adresse | 403 avant authentification ou mutation |
| HEAD de `.env`, `.git/config` et configuration SQL privée | 404 |
| Listener local, Host apex et recette | 200 ; `www` et nom arbitraire refusés à 421 |
| `www/` et `www/app` | 308 vers les mêmes chemins sur l’apex |

Les empreintes MX, TXT apex/SPF et DMARC restent celles du tableau de 15:48. Le sélecteur **`20261014._domainkey.jessiemessage.com`**, désormais identifié dans la zone visible, est comparé avant et après les deux changements Web : une réponse TXT, SHA-256 canonique **`a4201741b38de3a890e7a4a3ad8eec7669b1ebe5f9e6f3d86b485474abeaf97b`**, identique. Aucun de ces enregistrements mail n’a été modifié.

Ces contrôles n’utilisent aucun compte connecté, n’envoient aucun e-mail et ne déclenchent aucun Push. Ils ne remplacent pas la recette sur les appareils réels.

## Mise à jour de reprise — vérification à 16:59

Le [correctif de reprise](device-transition-retry.md) conserve la référence de notification lorsqu’une erreur pendant l’autorisation ou la fin de transfert impose de recommencer. Il ne modifie ni les sessions, ni les cookies, ni les clés, ni le schéma. Le runtime `3e952101` passe **50 contrôles sur 50 à 16:59:57.564340 Europe/Paris** : **46 requêtes HTTPS avec résolution normale et TLS vérifié**, plus **quatre contrôles Host sur le listener loopback**.

Les **dix-huit empreintes** correspondent à neuf fichiers sur chacune des deux origines : `entry.js`, `entry.css`, `device-transition.js`, `device-transition.css`, `notifications.js`, `notifications.css`, `notification-link.js`, `sw.js` et `manifest.webmanifest`. Les pages `/` et `/app` répondent à 200 sur les deux origines ; `/api/ready` et `/api/entry` répondent à 200 avec les liens attendus. Les sessions anonymes sont à 401, les quatre logout avec Origin croisée à 403, six HEAD de fichiers privés à 404, et les quatre pages de reprise à 200 avec `no-store`. `www/` et `www/app` renvoient 308 vers l’apex. Les Host locaux apex et recette sont acceptés, `www` et un nom arbitraire refusés. Les connexions normales mesurées atteignent `185.125.27.89` pour l’apex et recette, et `185.176.225.16` pour `www`.

Le premier lot à **16:58:10** comptait 44/50 avant correction du script de vérification : plusieurs comparaisons utilisaient une casse de noms d’en-têtes différente de celle retournée ; la requête sans User-Agent vers `www/` recevait réellement 403. Une comparaison ciblée confirme 403 sans User-Agent et 308 avec `JessieMessage-operator-check/1.0` ; Chrome suit aussi le 308 attendu. Le lot final normalise les noms d’en-têtes et identifie son User-Agent. Aucune configuration du service n’a été changée pour obtenir ce résultat.

Ces contrôles restent anonymes. Le parcours de reprise administrateur observé à **16:55** rejoint bien recette puis affiche le message attendu de connexion absente dans le navigateur cloud. Il ne constitue pas une reprise de session du propriétaire ni une livraison Push réelle.

## Mise à jour d’interface — livraison et rendu à 17:38–17:40

La capture du propriétaire et la reproduction dans Chrome confirment avant correction un espacement nul lorsque le lien de connexion apparaît. Le [correctif d’interface](device-transition-interface.md) place ce lien en premier dans le DOM, le présente comme action principale et donne à **Réessayer** la présentation secondaire, dans une grille espacée de 12 px. L’en-tête reste dans le flux, la palette rejoint l’entrée et les textes **Me connecter** / **Sign in** expliquent la connexion nécessaire. Le texte de conflit invite à revenir au compte déjà ouvert, sans promettre un sélecteur absent. Le choix de langue lors du passage entre origines n’est pas corrigé.

À **17:38:47.078215 Europe/Paris**, le runtime `0c88f61b` passe **50/50 contrôles**, dont **46 HTTPS ordinaires avec TLS vérifié et quatre Host loopback**. Les **vingt-deux empreintes exactes** couvrent les neuf fichiers statiques de la vérification précédente sur les deux origines, plus les pages HTML des deux rôles sur chaque origine. Les destinations restent Node `185.125.27.89` pour l’apex/recette et Apache `185.176.225.16` pour `www`. Ces contrôles anonymes n’ouvrent aucune session du propriétaire et ne déclenchent aucun Push.

Vers **17:40**, le contrôle visuel en ligne reprend le même état administrateur sans session que la capture initiale : **Me connecter** est premier et principal, **Réessayer** secondaire ; l’écart mesuré est **12 px** et les deux actions mesurent **52 px** de haut. À un viewport de **1 363 px**, la largeur de page est aussi de 1 363 px et l’en-tête ne chevauche pas le contenu. Les fonds mesurés des actions sont `rgb(113, 53, 79)` et `rgb(37, 28, 41)`. Le nouveau rendu est conforme dans ce Chrome ; la couverture des petites largeurs relève séparément de la matrice automatisée FR/EN.

Le propriétaire avait confirmé globalement le parcours proposé à **17:28**. Ce retour conserve sa valeur sans être transformé en matrice complète des plateformes, six à huit appareils simultanés ou scénario Push détaillé. Les étapes de recette servent désormais de référence pour les autres appareils.

## Propagation et limites observées

Lors du relevé initial, le navigateur cloud rechargé normalement puis avec actualisation forcée affiche encore « web host not found », une réponse correspondant à l’ancien frontal Apache, alors que les DNS normaux du serveur atteignent le runtime Node. Une différence de résolution ou de cache est probable ; l’adresse effectivement utilisée par ce navigateur n’a pas été mesurée. La validation visuelle cloud de l’apex reste alors en attente. Les requêtes DNS UDP directes à `1.1.1.1` et `8.8.8.8` depuis l’hébergement expirent à **16:15:26** ; elles ne constituent pas une mesure de la propagation chez ces résolveurs.

À **16:20:11**, une nouvelle connexion HTTPS normale depuis le terminal fournit cette fois une destination mesurée : **`185.176.225.16`**, l’ancienne IPv4 Apache, et HTTP **503** HTML sur `/api/entry`. La même mesure sur recette utilise **`185.125.27.89`** et reçoit **200** JSON. Cela établit une propagation/résolution inégale, y compris entre la résolution DNS directe et celle de la nouvelle connexion normale ; ce constat plus récent interdit de présenter les 62 succès de 16:14 comme une disponibilité universelle durable. Le cache précis à l’origine de cette ancienne réponse n’a pas été identifié.

À **16:21:03**, un contrôle ciblé sépare de nouveau le service de cette résolution : `/api/entry` sur l’apex, résolu explicitement vers chacune des IP Node, répond à **200** et propose les deux liens `/connect-device/…` ; recette, avec sa résolution normale, répond à **200** et conserve `/access` et `/admin/login`. TLS est validé dans les trois cas. Cette preuve confirme le nouveau service, pas la propagation universelle de son adresse.

À **16:37**, Chrome cloud montre encore l’ancien hébergement. À **16:38:05**, une connexion HTTPS ordinaire rejoint toutefois l’IPv4 Node `185.125.27.89` et reçoit **200** sur `/`, `/app` et `/api/ready`. À **16:54**, Chrome affiche réellement `/app` sur l’apex. À **17:00**, le parcours `www` → `https://jessiemessage.com/` → **Ouvrir mon espace** → `/app` est confirmé visuellement. L’ancien affichage n’est donc plus le blocage du parcours mesuré. Ces observations restent distinctes d’une garantie de propagation sur tous les réseaux et de la recette des appareils du foyer.

Le [TTL documenté par Infomaniak](https://www.infomaniak.com/fr/support/faq/2563/comprendre-ttl-et-delai-de-propagation-dns) permet aux anciennes réponses de rester en cache pendant leur durée restante, ici jusqu’à une heure dans le cas normal ; ce délai ne garantit pas l’actualisation de tous les FAI. [Chromium décrit plusieurs sources et caches de résolution](https://chromium.googlesource.com/chromium/src/+/HEAD/net/dns/README.md). Une actualisation forcée des ressources Web ne prouve pas leur purge. Aucun changement d’infrastructure, de résolveur, de certificat ou de contrôle TLS n’est appliqué pour masquer cet écart.

## Suite et repli

1. Conserver les DNS stables. Le parcours visible `www` → accueil apex → espace est confirmé à 17:00 sur Chrome ; compléter l’acceptation sur les réseaux et appareils habituels.
2. Utiliser le parcours confirmé globalement à 17:28 comme référence pour les autres appareils, sans demander une répétition en bloc. Compléter leur relevé de reprise, notifications et installation sur l’apex ; conserver les anciennes installations et inscriptions jusqu’à leur validation.
3. Conserver recette liée sans redirection tant que les appareils et notifications existants l’utilisent.

Le **repli direct privilégié** utilise `3e952101` et son lanceur conservé : il accepte les deux origines et le schéma 30, conserve le correctif réseau et perd la nouvelle présentation. `a0b17ce0` reste un repli plus ancien. Le repli de code 0.33 reste disponible et compatible avec le schéma 30, mais **ne suffit plus seul après la bascule DNS**, car il refuse le Host apex. Un retour complet demanderait une opération coordonnée de rattachement Apache, de restauration des deux valeurs Web précédentes et de runtime, avec prise en compte des caches DNS. Ne pas rétablir le code 0.33 en premier tant que des caches dirigent encore l’apex vers Node : conserver le runtime de transition pour ces requêtes. Ne pas relancer le script de restauration du clone rempli pour réaliser ce repli de domaine.

Le rattachement, l’activation et le parcours visible d’accueil sont vérifiés sur les parcours mesurés ; le propriétaire confirme le fonctionnement à 17:28. Cette confirmation ne décrit pas une matrice complète d’appareils ou de nouveaux scénarios Push. Aucun résultat anonyme ni aucun essai synthétique ne remplace une session du propriétaire ou une livraison Push réelle. Les observations ne constituent pas une certification de propagation sur tous les réseaux.
