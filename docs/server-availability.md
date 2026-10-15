# Disponibilité et arrêt du serveur — 0.13

Ce lot corrige les quatre défauts de disponibilité reproduits dans l'audit : admission tardive des imports, absence de budget sur certaines lectures, connexion SMTP survivant au délai du diagnostic et workers continuant leur lot après la demande d'arrêt. L'adresse officielle reste **contact@jessiemessage.com**. Aucune migration, dépendance, clé d'application ou icône approuvée n'est modifiée.

## Admission avant la base

Lorsqu'un handler privé est configuré, une garde synchrone précède les handlers sur les routes `/api/*` sauf `/api/health`, les pages authentifiées et les fichiers CRM/diffusion/préparation qui consultent eux aussi une session. Elle intervient avant les recherches de session SQL, même pour un cookie canonique mais invalide. Un refus renvoie 429, `Retry-After`, `Cache-Control: no-store` et ferme la connexion sans attendre un corps incomplet. La page neutre et les routes désactivées du serveur sans authentification gardent leur comportement initial.

| Budget en mémoire par serveur HTTP | Limite |
| --- | --- |
| Admissions, tous acteurs | 2 400 par fenêtre |
| Admissions, pair TCP réel | 1 200 par fenêtre |
| Admissions, cookie de session canonique | 300 par fenêtre |
| Nouveaux compteurs de cookies, par pair | 128 par fenêtre |
| Opérations/réponses simultanées | 32 au total, 16 par pair, 8 par cookie |
| Capacité des tables | 1 024 pairs, 2 048 cookies |

Les fenêtres fixes de 60 secondes sont alignées sur l'horloge, sans glissement ; un recul de l'horloge ne rouvre pas un ancien budget. Les deux cookies administrateur/client sont comptés séparément. Les clés des compteurs sont des HMAC avec une clé aléatoire propre à l'instance : ni adresse IP ni jeton brut n'est conservé dans ces tables. Une entrée active ou de la fenêtre courante n'est jamais évincée pour admettre une nouvelle identité. Le nettoyage des anciennes entrées inactives intervient lorsque la capacité est nécessaire ; la saturation refuse les nouvelles entrées.

Le pair est exclusivement `socket.remoteAddress`. Les en-têtes `Forwarded` et `X-Forwarded-For` ne sont jamais utilisés comme identité fiable. Derrière un proxy, plusieurs utilisateurs peuvent donc partager le budget du proxy : la topologie et les limites doivent être vérifiées en préproduction. Ces compteurs se réinitialisent au redémarrage et ne sont pas partagés entre plusieurs processus. Ils bornent l'admission applicative ; ils ne remplacent pas les limites du proxy ou les mesures de charge. Une place n'est libérée qu'après **la fin de l'opération et la fin/fermeture de la réponse** : une déconnexion n'annule pas un SQL ou un accès disque déjà lancé.

## Lectures et imports

Les limites suivantes utilisent les compteurs HMAC persistants déjà présents dans MariaDB. L'utilisateur est obtenu par authentification courante ; changer de session ne change pas son budget. La preuve de session `actor()` n'est pas comptée une seconde fois comme une lecture métier. Les quotas d'envoi de messages partagés avec les diffusions restent inchangés.

| Opération | Budget utilisateur par 60 s | Budget global par 60 s |
| --- | --- | --- |
| Listes, conversation client, messages et événements du chat, ensemble | 120 | 1 200 |
| Liste des photos propriétaires | 60 | 300 partagé avec la galerie |
| Galerie de conversation | 60 | 300 partagé avec la liste |
| Admission d'import photo | 10 | 30 |

Le budget utilisateur est consommé avant le global : un utilisateur déjà limité ne dépense plus la capacité commune sur ses refus. Les budgets existants des lectures de photos complètes et miniatures restent distincts.

Un import réserve au maximum **une place par compte authentifié**, toutes ses sessions confondues, dans les **trois places du processus**. La réservation et ses quotas précèdent la lecture du corps et la normalisation. Un import admis puis incomplet, abandonné ou invalide reste compté. Le service remet au handler un ticket opaque à usage unique, lié au rôle, au condensat de session et au compte ; un ticket forgé, réutilisé, d'un autre service ou d'une autre session ne permet pas d'importer. Un appel direct à `upload()` sans ticket passe par la même admission.

Le ticket en attente expire après 15 secondes ; le lecteur HTTP conserve sa limite de 8 secondes et 10 Mio. L'expiration ou un appel de libération ne restitue jamais une place pendant une vérification SQL, le décodage, le stockage ou l'enregistrement encore en cours. L'identité est revalidée à la consommation du ticket et la transaction SQL contrôle encore les droits au moment de l'enregistrement. Une confirmation SQL incertaine continue de conserver les fichiers chiffrés ; leur réconciliation et les plafonds de stockage restent à implémenter.

## Annulation SMTP

Le transport possède ses sockets TCP dès leur création via le hook public `getSocket` de Nodemailer. `close()` interdit de nouvelles opérations, rejette les vérifications/envois encore actifs et détruit ces sockets, y compris pendant STARTTLS. Une résolution DNS du système déjà lancée n'est pas annulée ; son retour tardif ne peut plus ouvrir une connexion. TLS implicite sur 465, STARTTLS obligatoire sur 587, vérification des certificats et du nom, CA configurée et minimum TLS 1.2 restent appliqués par Nodemailer.

Le diagnostic conserve son délai de 20 secondes et son transport isolé. Son arrêt ferme aussi un transport créé tardivement après une attente de quota ou de factory. Les erreurs restent neutres et le contrôle ne crée aucun e-mail. Les envois des workers gardent leur limite d'inactivité de 45 secondes ; ils n'acquièrent pas de délai total d'envoi en fonctionnement normal. Leur fermeture explicite à l'arrêt annule réellement la connexion. Une acceptation SMTP déjà obtenue ne peut pas être rappelée ; un accusé perdu peut conduire à un renvoi en doublon. Aucune réception n'est garantie.

## Un budget global d'arrêt

Au signal SIGTERM/SIGINT, le serveur refuse immédiatement le nouveau travail, signale l'arrêt à **tous** les producteurs et ferme le diagnostic SMTP actif avant toute attente. Les requêtes déjà commencées et les workers peuvent finir pendant une grâce de **5 secondes**. À son terme, les connexions HTTP restantes et le transport SMTP partagé sont fermés. Le pool n'est normalement fermé qu'après les handlers asynchrones, les connexions et les producteurs ; une connexion HTTP fermée seule ne prouve pas la fin d'une transaction.

Le budget total est de **15 secondes**, fermeture du pool comprise. À cette échéance, le processus CLI sort avec le code 1 et un message fixe signalant les opérations incertaines. Il ne transforme aucun résultat en succès. Les identifiants idempotents, les baux et les réservations durables permettent les reprises prévues ; un arrêt pendant un commit ou une acceptation SMTP peut laisser un résultat à réconcilier.

Les workers n'initient plus de nouveau `claim()` après l'arrêt. Une réservation déjà en vol mais non émise est restituée par CAS : pour les e-mails, son essai est remboursé, y compris le huitième ; pour les diffusions, elle est immédiatement remise en attente sans échec de traitement. Une émission SMTP ou une transaction de livraison déjà commencée conserve les règles normales des accusés incertains. Fermer les deux workers de mail ne ferme leur transport partagé qu'une fois.

## Validation et limites

Les tests couvrent les budgets avant handlers, rotations de cookies, faux en-têtes de proxy, capacités fixes, réponse/opération terminées dans les deux ordres, imports lents et tickets, quotas de lecture, fermeture en cours de réservation et restitution SQL concurrente. Les tests SMTP utilisent de vrais sockets et TLS avec Nodemailer sur la boucle locale, des certificats et messages synthétiques ; ils vérifient les ports logiques 465/587, les certificats refusés et l'absence de connexion restante. Un processus enfant teste aussi SIGTERM avec un producteur bloqué.

La preuve CI exacte est ajoutée après les suites complètes. Ces résultats ne valident pas le SMTP externe, le DNS du domaine, l'hébergement réel, la charge, un navigateur ou un appareil. Majorité externe, renouvellement d'accès, pagination administrative, quotas de stockage, purge/rétention, restauration cohérente et recette HTTPS restent dans le [plan de publication](NEXT-STEPS.md).
