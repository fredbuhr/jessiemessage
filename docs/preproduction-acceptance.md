# Recette de préproduction — étapes 0.18–0.22, version 0.24.0

Ce document prépare les vérifications de l'entrée PWA et d'un pilote privé. Il ne constate aucun déploiement, changement DNS, compte réel, réception e-mail ou installation sur téléphone. Les essais locaux et CI utilisent des identités fictives, des données synthétiques et des services maîtrisés.

Le [relevé d’hébergement de l’étape 0.23](hosting-inventory-2026-10-15.md) constate seulement l’état public et prépare la consultation du Manager. Projet privé, sous-domaine isolé et paramètres réels restent à identifier.

## 1. Fixer l'environnement et la révision

- [ ] Consigner le SHA exact et les cinq résultats CI de cette révision : tests généraux, MariaDB 10.11, MariaDB 11.4, Chrome chat et Chrome HTTPS/authentification. Relever également la version Node.js 24 installée.
- [ ] Réserver un sous-domaine HTTPS de `jessiemessage.com` à cette recette ; par exemple `preprod.jessiemessage.com`, uniquement après sa configuration effective. `JESSIEMESSAGE_SITE_ORIGIN` doit correspondre exactement à cette origine, sans chemin ni barre finale. L'expéditeur officiel reste `contact@jessiemessage.com`.
- [ ] Utiliser une base MariaDB dédiée et jetable, un répertoire média privé persistant hors du checkout, et des clés propres à la préproduction. Ne copier aucun compte, clé, portrait, média ou message de production. Préserver les ressources ZTIKIX.
- [ ] Confirmer MariaDB 10.11+, TLS avec vérification du certificat, `GET_LOCK`, compte DML d'exécution distinct du compte de migration et contraintes SQL actives. Les confirmations de base doivent désigner uniquement la base de recette. Voir [DATABASE.md](DATABASE.md) et [auth-admin.md](auth-admin.md).
- [ ] Confirmer chez l'hébergeur le processus Node persistant, son port, la persistance et les permissions du stockage, les limites mémoire/connexions, la topologie du proxy et le temps accordé à SIGTERM. L'application ignore les adresses déclarées par `Forwarded` et `X-Forwarded-For` ; plusieurs clients peuvent partager le budget du proxy.
- [ ] Prévoir une collecte privée des événements fixes de supervision. N'enregistrer ni URL contenant un secret, ni cookie, corps de message, adresse client, dump, clé ou transcription SMTP.

La création du schéma, l'initialisation média hors ligne et l'initialisation du compte administrateur sont des opérations distinctes. Les exécuter seulement dans l'environnement isolé confirmé, en suivant leurs procédures existantes ; aucun de ces changements n'est déclenché par ce document ou par l'ouverture de `/app`.

### Compatibilité Infomaniak : état documentaire au 15 octobre 2026

Le [comparatif officiel](https://www.infomaniak.com/fr/hebergement/tarifs-et-caracteristiques) annonce un site Node.js et MariaDB 10.11 sur l’offre Hébergement Web. La [FAQ de création](https://www.infomaniak.com/fr/support/faq/2537/creer-un-site-nodejs-chez-infomaniak) explique l’ajout d’un projet Node à un plan Web. Un serveur Cloud n’est donc pas démontré nécessaire par principe. Le compte et les options de l’abonnement existant n’ont pas été consultés ; ces sources ne prouvent pas son éligibilité.

| Contrat documenté | Vérification restant à faire dans la préproduction isolée |
| --- | --- |
| [Commande Node et port dynamique `PORT`](https://www.infomaniak.com/fr/support/faq/2535/modifier-la-configuration-dun-site-nodejs-infomaniak) ; le code utilise déjà `PORT` et `0.0.0.0` | Node 24 réellement sélectionnable, commande `npm start`, disponibilité durable des workers et configuration du proxy |
| MariaDB 10.11 annoncé | Version attribuée, TLS/CA, comptes séparés, contraintes et verrou `GET_LOCK` |
| [Sorties TCP 587/465 et 3306 pour Node](https://www.infomaniak.com/fr/support/faq/2516/decouvrir-les-ports-ouverts-pour-nodejs) | Connexion chiffrée puis réception contrôlée avec `contact@jessiemessage.com` ; aucune livraison attestée par les ports seuls |
| Le stockage privé et l’arrêt du processus restent non attestés par ces guides | Sharp installé, médias hors racine Web conservés après rebuild/redémarrage, permissions, signal d’arrêt et délai de drainage |

Aucune option, configuration, donnée ou commande de service n’a été modifiée chez l’hébergeur par cette revue documentaire. La compatibilité complète de JessieMessage doit être constatée sur le sous-domaine de recette.

## 2. Contrôles locaux sans services externes

Dans un checkout local de la révision retenue, les commandes suivantes ne déploient pas l'application :

```sh
npm ci --ignore-scripts
npm run check
npm test
npm run build
# Avec Chrome et ChromeDriver déjà installés :
npm run test:browser
```

Le build produit l'atelier HTML fictif. Il ne prouve pas le fonctionnement des comptes réels, du SMTP, du navigateur ou de l'installation PWA. `npm run test:db` doit être réservé à la configuration explicitement jetable attendue par les tests : ces groupes créent et suppriment leurs tables. Ne jamais le pointer vers une base à conserver.

- [ ] Le serveur configuré sans authentification sert `/app` et son manifeste, annonce une entrée indisponible, conserve `/api/health` à 200 et `/api/ready` à 503.
- [ ] Le serveur réel configuré en authentification seule utilise une base de test et une clé MFA synthétique ; accès client, chat, médias, CRM, récupération, diffusions et livraison e-mail sont explicitement désactivés. L'entrée propose uniquement la connexion administrateur et le service de messagerie reste indisponible.
- [ ] Les tests d'assemblage vérifient l'arrêt propre, le drainage de la supervision et une fermeture unique du pool. Ils n'initialisent aucun SMTP.
- [ ] Les contrôleurs synthétiques vérifient les réponses tardives, changements de session et masquage de page. Cette preuve ne remplace pas une recette visuelle dans de vrais navigateurs.

Avant le premier démarrage, suivre les [diagnostics opérateur](preproduction-preflight.md) : configuration de la seule authentification, Node/Sharp et répertoire de sonde neuf, puis SQL en lecture seule avec confirmation explicite. Le résultat ne certifie pas l’arrêt des autres producteurs, la bonne clé des données existantes, la persistance du média ou l’isolation de l’abonnement.

La [recette intégrée d’authentification](authentication-rehearsal.md) ajoute un job Chrome avec le vrai serveur, HTTPS local et MariaDB 10.11. Sa commande dédiée crée et supprime des tables dans une base jetable initialement vide ; elle ne doit jamais viser une base à conserver ni être exécutée sur l’hébergement comme diagnostic. Elle ne prouve pas le certificat public, le proxy ou l’arrêt Infomaniak.

## 3. Premier démarrage HTTPS, authentification seule

Commencer avec `JESSIEMESSAGE_ENABLE_AUTH=1` et toutes les fonctions client ainsi que `JESSIEMESSAGE_ENABLE_MAIL_DELIVERY` désactivées. Les secrets et identifiants restent dans la configuration privée de l'hébergement. Cette phase permet de contrôler l'entrée, l'administrateur et l'exploitation avant d'activer des producteurs de messages.

| Contrôle | Résultat attendu dans ce mode |
| --- | --- |
| `GET /app`, `HEAD /app` | Page d'entrée HTTP 200, réponses sans mise en cache ; HEAD sans corps |
| `GET /manifest.webmanifest` | `start_url` vaut `/app`, `id` reste `/`, icônes approuvées et scope `/` |
| `GET /api/entry`, sans cookie | `status: available`, `client: null`, `administrator: {state: signed_out, href: /admin/login}` |
| `GET /api/health` | HTTP 200, `status: ok` |
| `GET /api/ready` | HTTP 503, `status: unavailable` : le chat est désactivé |
| `/admin/readiness`, sans session | Refus d'authentification ; aucune mesure privée affichée |
| Connexion administrateur synthétique | Mot de passe et MFA requis ; destination fixe dans le site |
| SIGTERM puis redémarrage | Drainage borné, résultat observé, reprise sans ancien état privé affiché |

`/api/entry` sert à choisir une entrée disponible et à vérifier les sessions concernées. Son résumé n'est pas une liste de configuration SMTP/SQL et ne certifie aucune aptitude à publier. Les routes finales gardent leurs propres contrôles d'autorisation. Une disponibilité de l'entrée n'implique pas que la messagerie soit prête.

Le signal `/api/ready` observe la configuration accès/chat, la fraîcheur de son échantillon SQL et les boucles de travail. Un 200 ne teste ni la livraison SMTP, ni chaque photo, ni la restauration, ni la majorité, ni la charge. Au démarrage, attendre les premières observations saines avant d'interpréter son état ; ne pas empêcher une reconnexion uniquement sur la base de cette sonde. Voir [operations-readiness.md](operations-readiness.md).

## 4. Parcours clients avec sorties e-mail maîtrisées

L'accès client nécessite actuellement la configuration e-mail. Son activation démarre les workers avec le listener : elle ne doit donc pas être utilisée comme un simple contrôle passif sur une base qui contient d'anciens jobs.

- [ ] Pour la recette synthétique, bloquer les sorties SMTP vers les services réels et n'autoriser qu'un serveur de capture de test maîtrisé, compatible avec TLS et l'authentification exigés. Les comptes, clés et destinataires restent synthétiques. Sans ce dispositif, conserver la livraison et l'accès client désactivés pour cette phase.
- [ ] Vérifier une invitation unique, son expiration/révocation et le refus d'une seconde consommation. Contrôler le lien d'e-mail dans la capture privée ; aucune adresse de client réel n'est employée.
- [ ] Vérifier le compte en attente, la vérification d'adresse, l'absence d'accès au chat avant les preuves requises et l'expiration d'un accès déjà approuvé. Une déclaration 18+ ne doit jamais devenir une preuve de majorité.
- [ ] Avec des preuves de test indépendantes dans la base jetable, tester deux clients : chaque client ne voit que sa conversation. Essayer les identifiants de l'autre client et confirmer le refus sans contenu dans la réponse.
- [ ] Tester texte, photo synthétique, galerie, suppression d'un message, doublon après réponse incertaine, pagination et retour réseau. Une livraison photo supprimée ne rend pas toute la médiathèque du propriétaire supprimée.
- [ ] Tester récupération de mot de passe : ancien lien, expiration, seconde consommation et révocation des sessions ; vérifier qu'aucun de ces parcours ne renouvelle un accès expiré.
- [ ] Si les diffusions sont incluses dans le pilote, tester consentement initial désactivé, retrait pendant le traitement, annulation partielle et reprise. Les groupes et destinataires d'une campagne restent invisibles au client.

La réception externe est une recette séparée, avec une boîte maîtrisée et des destinataires de test explicitement choisis. Elle implique un véritable envoi et n'est pas effectuée par ces vérifications locales. Le bouton de diagnostic administrateur ne fait qu'une connexion/authentification SMTP ; il ne garantit pas la réception. Contrôler ensuite SPF/DKIM/DMARC et l'acceptation de l'expéditeur selon [mail-readiness.md](mail-readiness.md), sans inventer les paramètres fournis par l'hébergeur.

## 5. Navigateurs, appareil partagé et lancement installé

Consigner pour chaque essai le navigateur, sa version, l'appareil, le SHA et le résultat. Utiliser au minimum Firefox/Chromium sur ordinateur, Safari sur iPhone et Chrome sur Android lorsque ces appareils sont disponibles. L'existence d'un manifeste ne garantit pas une installation ou un comportement identique dans tous les navigateurs.

- [ ] Vérifier FR et EN sur accès, récupération, administration, chat/photos, CRM, diffusions et préparation : titres, boutons, erreurs, noms accessibles, dates/nombres et liens. Basculer pendant une saisie et une requête en cours : aucun champ, message, légende ou nom privé ne doit être traduit ou perdu, aucun envoi répété. Voir [private-ui-languages.md](private-ui-languages.md).
- [ ] Vérifier la préférence de langue lors des navigations, puis avec `sessionStorage` bloqué : la bascule courante doit rester utilisable sans bloquer la connexion. Après masquage/déconnexion, changer de langue ne doit restaurer aucune ancienne donnée. Les e-mails de service demeurent en français.
- [ ] Ouvrir l'entrée depuis un onglet puis depuis l'icône installée : déconnecté, client en attente, actif, expiré et administrateur. La destination doit rester interne au site ; aucune URL de retour arbitraire ne doit être suivie.
- [ ] Si deux sessions de rôles différents existent sur le même navigateur, vérifier le choix explicite du rôle et l'absence de bascule silencieuse vers les données de l'autre compte.
- [ ] Masquer puis réafficher la page, verrouiller l'écran, utiliser Précédent/Suivant et restaurer une page du cache de navigation. Les données privées doivent être retirées au masquage selon le parcours existant puis revérifiées au retour.
- [ ] Déconnecter le compte, puis confier le même appareil à un autre compte : aucun ancien texte, brouillon, note, miniature ou URL d'objet ne doit réapparaître. Tester aussi la déconnexion depuis un second onglet.
- [ ] Contrôler les réponses privées `no-store`, le comportement hors réseau et la réouverture après redémarrage. N'ajouter aucun cache de messages/photos ni promesse de consultation hors ligne pour satisfaire un critère d'installation.
- [ ] Au lecteur d’écran, vérifier qu’une vraie réception produit une annonce neutre comptée, sans nom ni contenu. Chargement initial, historique, reprise après masquage, accusés, suppression, doublons et propres envois restent silencieux pour cette région. Un polling vide ne doit pas réannoncer le dernier compteur. Changer de langue efface cette annonce transitoire ; la réception suivante utilise la langue choisie.
- [ ] Au clavier, tester le lien d’évitement, sélection puis retour d’une conversation, contact focalisé pendant le polling, suppression de son message, dernière page d’historique et galerie : aucun focus perdu ou déplacé après une action effectuée ailleurs. Tester les dialogues natifs avec Tab/Maj+Tab/Échap, retour logique et masque de la page pendant une photo. Voir [chat-accessibility.md](chat-accessibility.md).
- [ ] Vérifier clavier virtuel, hauteur visible, scroll, orientation, zoom, navigation au clavier, focus, annonces d'état et contraste. Contrôler les photos depuis les formats acceptés et l'absence de métadonnées dans les images normalisées.

## 6. Données, restauration et critères de sortie

- [ ] Fixer les durées de conservation, les obligations applicables et le traitement des sauvegardes avant toute purge réelle. L'inventaire, l'export et la simulation de suppression ne sont pas un exécuteur de suppression et ne constituent pas une décision de rétention. Voir [private-data-export.md](private-data-export.md).
- [ ] Effectuer un exercice de sauvegarde externe puis restauration isolée en suivant [backup-clone-recovery.md](backup-clone-recovery.md). Conserver séparément les clés, le manifeste et les données ; mesurer durée, espace nécessaire et reprise. Le vérificateur ne crée pas de dump, ne programme pas les copies et ne prouve pas à lui seul l'arrêt de producteurs externes.
- [ ] Éprouver le retour arrière avec le code, les migrations, les médias et les clés de la même génération. Le contrôle de l'historique ne certifie pas le schéma physique et un ancien checkout peut refuser une base plus récente.
- [ ] Mesurer une charge représentative sur le proxy et le stockage de préproduction. Vérifier les quotas partagés, les files, la mémoire, les délais et l'arrêt sous requêtes en cours.
- [ ] Résoudre la majorité externe avant l'ouverture des contenus concernés et confirmer les conditions d'hébergement et les documents réellement applicables. Les indicateurs de préparation restent en attente tant que ces éléments ne sont pas intégrés et vérifiés.
- [ ] Revoir les PR dans leur ordre d'empilement, retenir une révision de publication précise et définir le pilote privé limité, son observation et sa procédure de retour arrière. Aucun compte réel ni hébergement de production n'est activé automatiquement par cette étape.

Une case cochée doit être accompagnée d'un résultat constaté ; une case non exécutée reste ouverte. Les données de preuve partagées restent synthétiques et dépourvues de secrets. Le pilote ne peut pas être déclaré validé à partir du seul build, de la sonde de vie, du signal de disponibilité ou d'une CI réussie.
