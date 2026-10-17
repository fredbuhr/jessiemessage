# Adresse principale — opération 0.37 du 17 octobre 2026

Le préalable 0.36 est accepté : copie indépendante du checkpoint applicatif au schéma 30 et import natif isolé authentifié, reçu personnel à 15:26 Europe/Paris. La présente opération conserve le schéma, les données, les clés et les abonnements Push. Elle ne certifie pas une reprise des appareils tant que celle-ci n’a pas été acceptée sur les appareils réels.

**État à 16:21 Europe/Paris : rattachement et activation 0.37 vérifiés, propagation inégale et recette des appareils en attente.** Le domaine est désormais lié à l’application Node et ses A/AAAA enregistrés pointent vers ce service. Le runtime de transition `a0b17ce0` a passé **62 contrôles HTTP et 38 empreintes à 16:14:07**, sans migration ni changement de clés. À 16:20:11, une nouvelle connexion normale vers l’apex utilise cependant encore l’ancienne IPv4 Apache et reçoit 503 ; recette répond toujours à 200 sur Node. La solution simple dissocie le rattachement de la mise à jour DNS automatique ; l’accès universel à l’apex n’est pas encore acquis. Les enregistrements mail mesurés, y compris le DKIM observé lors de cette reprise, sont inchangés.

**Historique à 15:48:32 : blocage initial et repli vérifié.** Les trois premiers essais d’alias avec mise à jour DNS automatique ne créaient aucun rattachement. Le lien Apache et le runtime 0.33 ont été rétablis, puis 39 contrôles HTTP et quatorze empreintes sont passés. Cette preuve reste datée ; elle n’est plus le déploiement courant.

## Candidat et repli

Le code de transition exact est `a0b17ce0a82a317b8a4f6782b26eef52fe9430b6`, arbre `44ea8cf1e0c3c2d0cbfe80aba6ac98ea22224af0`, checkout `/srv/customer/jessiemessage-operator/device-transition-a0b17ce0`. Ses cinq jobs CI exacts sont ceux de la [validation 0.35](device-origin-transition.md). La configuration primaire distincte reste `/srv/customer/jessiemessage-private/primary-origin-candidate-4a355851`, aux clés, SQL et stockage conservés. Le préflight réel passe à **15:28:57** sans démarrer de serveur.

Le nouveau lanceur privé `0700` est créé exclusivement à **15:31:23** : `/srv/customer/jessiemessage-private/start-primary-transition-a0b17ce0.sh`, SHA-256 `436b6f965c8885e85f85d33d92e9a30eff907a45f2338fa0535b96fc3a35fa52`. Il épingle révision, arbre et checkout propre, nettoie les options Node héritées et lance explicitement `--deployment primary-transition --profile photos-notify`. Sa syntaxe Bash est vérifiée ; il ne contient aucune clé ou mot de passe.

Le repli de code reste **0.33 `f2677249ebd3a29b10e1fecfa34bfd6b6c1ff612`**, arbre `3532099ddcf3dfd71545783e40967ed8feb49841`, checkout `/srv/customer/jessiemessage-operator/notification-open-f2677249`, lanceur `/srv/customer/jessiemessage-private/start-private-notification-open-f2677249.sh`. Le schéma 30 est compatible ; aucun import SQL ou retour au schéma 28 n’est nécessaire pour ce repli.

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

## Vérification réelle après activation

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

## Propagation et limites observées

Le navigateur cloud rechargé normalement puis avec actualisation forcée affiche encore « web host not found », une réponse correspondant à l’ancien frontal Apache, alors que les DNS normaux du serveur atteignent le runtime Node. Une différence de résolution ou de cache est probable ; l’adresse effectivement utilisée par ce navigateur n’a pas été mesurée. La validation visuelle cloud de l’apex reste donc en attente. Les requêtes DNS UDP directes à `1.1.1.1` et `8.8.8.8` depuis l’hébergement expirent à **16:15:26** ; elles ne constituent pas une mesure de la propagation chez ces résolveurs.

À **16:20:11**, une nouvelle connexion HTTPS normale depuis le terminal fournit cette fois une destination mesurée : **`185.176.225.16`**, l’ancienne IPv4 Apache, et HTTP **503** HTML sur `/api/entry`. La même mesure sur recette utilise **`185.125.27.89`** et reçoit **200** JSON. Cela établit une propagation/résolution inégale, y compris entre la résolution DNS directe et celle de la nouvelle connexion normale ; ce constat plus récent interdit de présenter les 62 succès de 16:14 comme une disponibilité universelle durable. Le cache précis à l’origine de cette ancienne réponse n’a pas été identifié.

À **16:21:03**, un contrôle ciblé sépare de nouveau le service de cette résolution : `/api/entry` sur l’apex, résolu explicitement vers chacune des IP Node, répond à **200** et propose les deux liens `/connect-device/…` ; recette, avec sa résolution normale, répond à **200** et conserve `/access` et `/admin/login`. TLS est validé dans les trois cas. Cette preuve confirme le nouveau service, pas la propagation universelle de son adresse.

Le [TTL documenté par Infomaniak](https://www.infomaniak.com/fr/support/faq/2563/comprendre-ttl-et-delai-de-propagation-dns) permet aux anciennes réponses de rester en cache pendant leur durée restante, ici jusqu’à une heure dans le cas normal ; ce délai ne garantit pas l’actualisation de tous les FAI. [Chromium décrit plusieurs sources et caches de résolution](https://chromium.googlesource.com/chromium/src/+/HEAD/net/dns/README.md). Une actualisation forcée des ressources Web ne prouve pas leur purge. Aucun changement d’infrastructure, de résolveur, de certificat ou de contrôle TLS n’est appliqué pour masquer cet écart.

## Suite et repli

1. Laisser les DNS stables, puis confirmer le parcours visible accueil → espace sur l’apex après renouvellement de la résolution.
2. Accepter sur les appareils la reprise des connexions, une nouvelle notification ouvrant le bon message, les textes/photos et l’installation PWA sur l’apex. Réactiver Push par appareil ; ne pas supprimer les anciennes installations ou inscriptions avant cette recette.
3. Conserver recette liée sans redirection tant que les appareils et notifications existants l’utilisent.

Le repli de code 0.33 reste disponible et compatible avec le schéma 30, mais **ne suffit plus seul après la bascule DNS**, car il refuse le Host apex. Un retour complet demanderait une opération coordonnée de rattachement Apache, de restauration des deux valeurs Web précédentes et de runtime, avec prise en compte des caches DNS. Ne pas rétablir le code 0.33 en premier tant que des caches dirigent encore l’apex vers Node : conserver le runtime de transition pour ces requêtes. Ne pas relancer le script de restauration du clone rempli pour réaliser ce repli de domaine.

Le rattachement et l’activation sont vérifiés ; l’acceptation finale demeure conditionnée à la propagation observée et aux appareils réels. Aucun résultat de contrôle anonyme ne remplace une session réelle ou une livraison Push réelle.
