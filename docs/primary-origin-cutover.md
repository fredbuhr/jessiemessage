# Adresse principale — opération 0.37 du 17 octobre 2026

Le préalable 0.36 est accepté : copie indépendante du checkpoint applicatif au schéma 30 et import natif isolé authentifié, reçu personnel à 15:26 Europe/Paris. La présente opération conserve le schéma, les données, les clés et les abonnements Push. Elle ne certifie pas une reprise des appareils tant que celle-ci n’a pas été acceptée sur les appareils réels.

**État à 15:48:32 Europe/Paris : bascule 0.37 bloquée, repli vérifié.** Le candidat a démarré et répondu correctement sur recette, mais le formulaire d’ajout du domaine Node revient sans message et sans créer le rattachement de l’apex. Le lien Apache et le runtime 0.33 sont rétablis. Les 39 contrôles HTTP passent, dont quatorze empreintes de fichiers conformes ; les DNS Web et les enregistrements mail mesurés sont inchangés. La cause du refus de rattachement reste à résoudre avec Infomaniak avant une nouvelle tentative.

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

## Essai de runtime et observation du rattachement

Le Manager enregistre Run/Build épinglés sur le candidat, puis le build réussit et redémarre l’unique application à **15:34**. Les logs annoncent `deployment: primary-transition`, écoute sur 3000. À **15:35:31**, cinq contrôles HTTPS sur recette passent : disponibilité, empreintes de `/app`, du script de transition et de sa page administrateur, refus de session anonyme. Aucun second listener ni worker n’est démarré.

L’alias apex est délié d’Apache en laissant **décochée la suppression des DNS** ; l’accueil, son dossier et `www` restent conservés. Le formulaire Node d’ajout est ensuite essayé sur le seul apex, sans ajout de `www`, avec mise à jour DNS Web. Après le retour sans rattachement, il est rechargé et le domaine existant est choisi dans la liste de l’organisation. Une demande avec mise à jour du certificat est également essayée. Dans les trois cas, le bouton redevient disponible sans navigation, sans erreur affichée ni alias ajouté. L’inventaire Node rechargé reste à deux noms. Les journaux de console ne fournissent pas d’erreur applicative exploitable ; les erreurs de l’extension du navigateur ne sont pas attribuées à Infomaniak.

Un contrôle direct avec résolution explicite de l’apex vers l’IPv4 Node échoue pendant la négociation TLS par fermeture de connexion ; il ne prouve donc ni un Host transmis au runtime ni une affectation effective. Aucun contrôle TLS n’est contourné et aucun DNS n’est changé manuellement pour forcer une route non confirmée. Le certificat couvrant un nom ne prouve pas que ce nom est rattaché au frontal.

Le même ajout de l’apex à l’accueil Apache réussit, en laissant décochés ajout de `www`, mise à jour DNS et mise à jour SSL. Le Manager retrouve ses trois noms. L’accueil et son lien temporaire vers recette sont ainsi rétablis. Les contrôles de navigateur confirment accueil visible, `/app` vers recette et `www` vers l’apex ; la disponibilité de recette reste à 200. Run/Build sont ensuite rétablis sur la révision 0.33 épinglée ci-dessus. Le build et le redémarrage réussissent à **15:47** ; les logs confirment l’unique service `messaging-photos-notify` sans le déploiement `primary-transition`. Ce repli conserve des liens d’invitation utilisables tant que l’apex n’est pas rattaché à Node.

## Vérification réelle du repli

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

Le hash porte sur le JSON de la liste triée des représentations JSON de chaque réponse DNS. Aucun sélecteur DKIM n’a été interrogé : ce relevé ne prétend pas certifier les enregistrements non mesurés. Aucun DNS mail, secret, droit SQL ou schéma n’a été changé pendant l’opération 0.37.

La cause exacte du retour sans ajout du formulaire Node n’est pas établie. Ce n’est pas présenté comme une limite certaine de l’offre ou une panne générale. La [procédure officielle d’alias](https://www.infomaniak.com/fr/support/faq/1946/ajouter-un-nom-de-domaine-supplementaire-a-un-site-chez-infomaniak) exige de libérer l’ancien lien, puis de rattacher le nom au nouveau site. Le [guide de passage du sous-domaine au domaine](https://www.infomaniak.com/fr/support/faq/2160/remplacer-un-sous-domaine-par-un-domaine) poursuit par l’inversion des rôles ; sa suppression finale de l’ancien nom ne convient pas à notre transition des appareils. Le [diagnostic officiel Node.js](https://www.infomaniak.com/fr/support/faq/2536/resoudre-un-probleme-de-site-nodejs) renvoie vers le support si le problème demeure après vérification.

## Demande au support à transmettre par le propriétaire

Le [support Infomaniak](https://www.infomaniak.com/fr/aide) peut recevoir le texte suivant. Aucun message n’a été envoyé par l’agent.

> Bonjour, sur l’hébergement 812119, je souhaite rattacher jessiemessage.com à l’application Node.js 239143, environnement 118579, tout en conservant recette.jessiemessage.com. Le 17 octobre 2026 vers 15:35–15:45 Europe/Paris, même après avoir délié l’apex du site Apache 1532641 sans supprimer ses DNS, l’ajout dans Node revient au formulaire sans erreur et ne crée aucun alias. Les variantes avec et sans mise à jour SSL échouent ; l’ajout à Apache réussit et a été rétabli pour maintenir l’accès. Pouvez-vous vérifier le rattachement côté plateforme et indiquer la procédure adaptée ? Merci de préserver les fichiers, recette et les enregistrements mail.

## Critères pour reprendre

1. Résoudre et confirmer dans le Manager le rattachement effectif du seul apex au site Node, puis son rôle principal, en conservant recette comme alias sans redirection.
2. Activer le lanceur de transition et vérifier les deux adresses, les certificats, les empreintes, les réponses d’entrée et les contrôles Host/Origin ; `/api/health` seul ne prouve pas le routage Host.
3. Comparer les DNS mail au relevé initial et les DNS `www` à leur destination Apache conservée.
4. Accepter sur les appareils la reprise des connexions, une nouvelle notification ouvrant le bon message, les textes/photos et l’installation PWA sur l’apex. Réactiver Push par appareil ; ne pas supprimer les anciennes installations ou inscriptions avant cette recette.

Cette opération n’est pas encore une bascule finale acceptée. Aucun résultat de contrôle anonyme ne remplace une session réelle ou une livraison Push réelle.
