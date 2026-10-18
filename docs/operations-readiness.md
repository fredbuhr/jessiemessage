# Supervision du service — 0.17a (version 0.17.0)

**Suite livrée 0.42 :** le [diagnostic privé téléchargeable](operations-diagnostic.md) réutilise cette supervision dans la page existante, avec projection des seules métadonnées autorisées et contrôle renouvelé de la session. Le lecteur navigateur accepte désormais les quatre traitements, notifications comprises. Les trois files et le schéma 27 décrits ci-dessous restent les preuves historiques de 0.17a ; le runtime 0.42 `ed78b55e`, activé à 21:03 Europe/Paris le 17 octobre 2026, reste au schéma 30. Ses 34 contrôles HTTPS après activation passent ; le téléchargement authentifié réel n’est pas exercé dans le navigateur opérateur sans session. Aucun nouveau module n’est activé par le diagnostic.

Ce lot traite les constats A09/A10 de l’audit : la santé HTTP ne signalait pas les dépendances indisponibles et les erreurs globales des diffusions étaient silencieuses. Il ajoute un signal de disponibilité en cache, des observations des workers et une vue privée de métadonnées bornées. Il ne termine pas l’ensemble du lot données/exploitation 0.17.

## Deux signaux distincts

| Route | Réponse | Signification |
| --- | --- | --- |
| `GET /api/health` | HTTP 200, `{"status":"ok"}` | Le serveur HTTP répond ; ce signal de vie ne teste pas les fonctions privées. |
| `GET /api/ready` | HTTP 200, `{"status":"ready"}`, ou HTTP 503, `{"status":"unavailable"}` | La configuration de messagerie est active, l’échantillon SQL est récent et les workers configurés ont terminé un lot sans erreur et restent observés. |

`HEAD /api/ready` est également accepté ; mutations et paramètres de requête sont refusés. Les réponses sont `no-store`, sans cookie ni détail de dépendance. Le mode neutre par défaut et le mode authentification seule restent indisponibles pour la messagerie, même si leur santé HTTP est verte. Pendant le drainage, les nouvelles demandes reçoivent HTTP 503.

La sonde publique lit uniquement la mémoire : aucune requête SQL, authentification ou lecture de fichier n’est déclenchée par sa consultation. Un échec du fournisseur de statut donne un résultat indisponible sans exposer son erreur.

Ce signal porte sur la configuration accès/chat, l’échantillonnage SQL et les boucles de travail. Il ne réalise pas un envoi, une lecture de message, un diagnostic SMTP ou un contrôle cryptographique de contenus. Il ne vérifie pas périodiquement chaque table, permission ou fichier média. Un signal vert ne certifie ni réception e-mail, stockage/restauration, majorité, conformité, capacité sous charge ou fonctionnement sur appareils.

## Mesures et bornes

- Échantillonnage immédiat après ouverture du listener, puis toutes les **15 secondes**. Un échantillon utilise une seule connexion du pool DML existant et commence par `SELECT 1`.
- Délai d’observation **2 secondes**. Si la connexion ou les lectures dépassent ce délai, le signal devient indisponible ; la requête réelle reste suivie jusqu’à son règlement. Aucun nouvel échantillon SQL ne démarre en parallèle et un résultat tardif ne rétablit pas le signal. Les délais du pool/driver existants restent applicables.
- Un échantillon SQL devient ancien après **45 secondes**. Un worker sans observation, y compris avant son premier passage, devient ancien après **180 secondes**. L’âge repose sur une horloge monotone ; les dates de présentation utilisent l’horloge civile. Les horloges invalides et le recul monotone échouent de façon fermée.
- Au plus trois files suivies selon la configuration : vérification e-mail, récupération, diffusions. Pour chacune : état `pending`, `sending`, `failed`, au plus **1 001 lignes par lecture** et compteur affiché au maximum à 1 000. Une troncature signifie **« au moins 1 000 »**. Les requêtes utilisent les index d’état existants et ne calculent aucun agrégat sur tout l’historique.
- L’échéance la plus ancienne provient des éléments `pending`, ordonnés par `available_at`, avec comparaison SQL à six décimales. Son retard est une ancienneté de planification, pas la preuve que l’élément est livrable : utilisateur, campagne, consentement ou durée de validité peuvent exclure sa livraison. Les éléments `sending` ne fournissent pas ici une mesure d’âge des baux.

Les états de file sont lus successivement, sans transaction d’instantané : ils peuvent évoluer pendant l’échantillonnage. Les compteurs de la base portent sur les lignes encore présentes ; les purges existantes des outbox peuvent les réduire. Ils ne sont pas des totaux historiques ou des statistiques de réception.

## Workers et journalisation

Chaque boucle observe début, fin, erreur et arrêt. Un lot vide sain fournit aussi une preuve de passage. Les échecs partiels et les résultats incertains dégradent le signal ; un simple début de boucle ne les efface pas. Un lot sain suivant permet le rétablissement, sans effacer les compteurs d’incidents déjà observés.

Les compteurs en mémoire saturent au maximum entier sûr et repartent à zéro au redémarrage. Ils ne remplacent pas les états durables des files et ne prouvent pas la réception SMTP. La confirmation d’envoi des e-mails conserve sa sémantique « au moins une fois » ; les identifiants et transactions des diffusions restent inchangés.

Le journal émet des événements fixes de transition : `database_unavailable`, `database_recovered`, `worker_unavailable`, `worker_recovered`. Seul le nom fixe du worker est ajouté quand nécessaire. Une panne répétée dans le même état ne produit pas une ligne à chaque polling. Ni erreur brute SQL/SMTP, adresse, identifiant de client/campagne, contenu, clé ou chemin privé ne sont journalisés par cette supervision. Les callbacks qui lèvent une exception ou renvoient une promesse rejetée ne perturbent pas le travail.

Les événements des workers arrivent aussi après une demande d’arrêt ; ils ne peuvent pas rétablir un service en drainage. L’arrêt de la supervision bloque immédiatement les nouveaux échantillons et attend l’opération SQL réelle avant la fermeture du pool, dans le budget global d’arrêt existant de 15 secondes.

## Vue d’administration

La page existante `/admin/readiness` affiche **État du service** avec date de contrôle SQL, état de chaque traitement, compteurs du processus et mesures plafonnées des files. Ce sont des totaux globaux du site pour un administrateur courant, pas des données de conversation ou des mesures limitées à son affectation CRM.

Le résumé privé relit l’autorisation administrateur après les quotas, puis projette une copie des seuls champs permis. Les éléments supplémentaires d’un fournisseur ne sont pas retransmis. Le navigateur copie à nouveau ces champs ; aucun contenu privé persistant n’est ajouté. Masquage, déconnexion et réponses tardives gardent les protections existantes. L’actualisation manuelle récupère le dernier instantané du serveur ; elle ne force ni requête SQL immédiate ni envoi de diagnostic SMTP.

## Procédure d’exploitation à éprouver en préproduction

1. Démarrer la révision complète avec ses secrets privés et les fonctions prévues ; vérifier le SHA servi. Le démarrage des fonctions activées continue de contrôler le schéma avant le listener.
2. Observer santé HTTP et disponibilité séparément. Le démarrage reste indisponible jusqu’au premier échantillon et au premier passage sain de tous les workers configurés.
3. En cas de 503 persistant, consulter la page privée et les événements fixes. Contrôler la connectivité SQL et les privilèges, l’état des workers et la date des mesures. Un retard de file peut justifier un examen privé ; ne pas rejouer manuellement un message ou une campagne à partir d’un compteur.
4. Configurer ensuite la collecte des journaux, des sondes externes et les alertes de l’hébergement. Ce lot ne crée aucun compte de supervision ni notification externe, et n’agrège pas plusieurs processus.
5. Pour arrêter, utiliser le parcours SIGTERM existant et vérifier son résultat ; ne pas considérer un timeout comme une opération annulée avec certitude. Le protocole de reprise des files reste durable et idempotent selon son domaine.

## Validation et suite

Les tests synthétiques couvrent le cache HTTP sans SQL par requête, les droits du résumé privé, les projections, les timeouts sans chevauchement, les résultats tardifs, les horloges, workers bloqués, erreurs partielles, callbacks défaillants, rétablissement et arrêt. Le groupe SQL supplémentaire vérifie avec un compte DML les lectures plafonnées, la microseconde, l’absence de mutation des files et l’assemblage/arrêt réel d’un serveur configuré en authentification seule, sans SMTP.

La CI ajoute ce vingtième groupe SQL aux dix-neuf précédents et conserve MariaDB 10.11/11.4. Aucun succès SQL local, test d’hébergement, recette visuelle ou installation d’une supervision externe n’est déduit des tests unitaires.

Validation locale sous Node.js 24.19.0 : **1 051 tests généraux réussis, aucun échec, 20 groupes SQL ignorés sans base locale** ; build, syntaxe, liens locaux de documentation et contrôle du diff réussis. La CI du SHA exact doit être vérifiée avant intégration, notamment le nouveau parcours SQL/serveur configuré.

La prochaine étape est **0.17b — politique et inventaire/export des données**, puis suppression/rétention reprenable et procédure de retour arrière code/base/médias/clés. Les durées doivent être fixées avant d’activer des purges réelles. Le déploiement, la restauration chez l’hébergeur, SMTP externe, majorité et recette appareils restent ouverts.

Aucune migration ou dépendance n’est ajoutée ; schéma inchangé à 27 migrations. Clés et identité visuelle conservées. Adresse officielle : **contact@jessiemessage.com**. Aucune fusion ou publication n’est effectuée par ce lot.
