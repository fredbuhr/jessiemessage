# Renouvellement et listes administratives — 0.14

Ce lot complète la gestion des accès avec le renouvellement d'un accès déjà approuvé et la consultation des clients/invitations au-delà des 500 premières entrées. Il conserve l'adresse **contact@jessiemessage.com**, les 25 migrations, les dépendances, les clés d'application et l'identité approuvée. Aucune assurance de majorité externe ni mise en production n'est créée par ce code.

## Prolonger un accès approuvé

La carte d'un client actif affiche une durée en jours, 30 par défaut, et une action de prolongation. Si sa date de fin est passée, l'état affiché est « Expiré » et l'action permet de renouveler cet accès expiré. Le statut technique du compte reste `active` dans les deux cas : l'expiration est une échéance, distincte de la révocation.

Le renouvellement exige toujours un compte client actif, un e-mail vérifié, une preuve de majorité et une approbation déjà enregistrées, toutes datées au plus tard à l'heure de l'opération, ainsi qu'une date de fin finie. Un compte en attente, suspendu, révoqué ou supprimé ne peut pas être réactivé par cette action. Un accès sans limite de durée ne nécessite pas de renouvellement. Cette route ne fabrique aucune preuve et ne propose pas de raccourcissement ou de conversion en accès illimité.

Le calcul se fait côté serveur : **nouvelle fin = maximum entre l'heure serveur et l'ancienne fin, plus la durée choisie**. Un jour représente 24 heures. La durée est un entier de 1 à 3 650 jours et la nouvelle date ne dépasse pas dix ans de 365 jours à partir de l'opération. Avant l'échéance, les jours restants sont donc conservés ; après l'échéance, la durée repart de l'opération.

`POST /api/admin/clients/{id}/renew` reçoit exactement :

```json
{"accessDays":30,"expectedExpiresAt":1791972000000}
```

`expectedExpiresAt` est la date précédemment lue, en millisecondes. Elle doit correspondre exactement à la date SQL, y compris sa précision réelle. Dans la transaction, le compte administrateur, son MFA courant et sa session sont recontrôlés, puis le client est verrouillé et ses prérequis relus. Deux demandes avec la même ancienne date ne peuvent produire qu'une prolongation : la seconde reçoit 409 `access_changed`. La répétition d'une demande dont l'accusé a été perdu ne prolonge pas une deuxième fois.

La réponse réussie contient uniquement `status: "renewed"` et `client: {id, accessExpiresAt}`. Le renouvellement préserve l'approbation initiale, les mots de passe et versions d'identifiants, les sessions existantes et leur révocation, la conversation et son administrateur affecté. Il ne crée aucun nouveau cookie ou droit sur les notes privées. Comme les autres actions de gestion des accès existantes, cette gestion reste globale pour les administrateurs autorisés ; elle ne réattribue pas les conversations.

## Parcourir toutes les listes

Les deux routes `GET /api/admin/invitations` et `GET /api/admin/clients` acceptent `limit` et `cursor`, chacun au plus une fois. La limite vaut 50 par défaut et doit être un entier canonique entre 1 et 100. Les paramètres inconnus, curseurs vides, malformés ou destinés à l'autre collection sont refusés. Chaque réponse contient sa collection, `hasMore` et `nextCursor` ; ce dernier est nul si aucune page suivante n'est annoncée.

Le tri reste **date de création décroissante, puis identifiant décroissant**. Le curseur encode la position exacte, avec les six décimales de MariaDB, la collection et un identifiant canonique. Il n'est pas un jeton d'autorisation et ne contient ni e-mail ni lien d'invitation. Sa validité ne dépend pas de l'existence de la ligne qui l'a produit. La requête lit au plus la limite demandée plus une ligne pour déterminer la suite ; elle n'emploie pas d'offset.

Les insertions plus récentes restent accessibles en revenant au début ; elles ne décalent pas la suite d'un parcours commencé. Ce parcours ne fige pas l'ensemble du contenu : statuts et échéances restent vivants, et une suppression ou une insertion datée plus ancienne peut changer une page future. Les dates affichées ont une précision en millisecondes ; les curseurs gardent les microsecondes pour ne perdre aucune ligne lors d'égalités.

L'interface conserve une seule page de 50 entrées par liste. « Plus anciens » la remplace et « Revenir au début » recharge la première page. Les deux listes progressent indépendamment. « Actualiser les accès » repart au début des deux listes ; une prolongation relit seulement la page clients courante. Il n'y a ni total fictif ni accumulation de centaines de cartes en mémoire. Le masquage ou changement de session efface les curseurs et les données privées.

Les tables actuelles n'ont pas d'index composite adapté à ce tri. La pagination borne le résultat et le DOM, pas le coût SQL de scan/tri avec une très grande base. Mesures de charge et index adaptés restent à préparer avec l'évolution des migrations avant une exploitation volumineuse.

## Fréquence et réponses tardives

Les lectures administratives de ces deux listes partagent des compteurs persistants de **60 par minute par administrateur** et **240 par minute au total**. Les renouvellements ont des compteurs distincts de **30 par minute par administrateur** et **120 au total**. Le compte est celui de la session courante ; changer de session ne réinitialise pas ses compteurs. Le budget individuel est consommé avant le global, et l'heure est relue après les quotas avant l'autorisation SQL. Les quotas publics d'inscription/connexion restent distincts ; l'[admission avant SQL de la version 0.13](server-availability.md) s'applique aussi.

Chaque action administrative vérifie la session avant le POST. Une preuve de session courante est aussi requise avant d'afficher une page ou le résultat privé d'une opération. Les générations et opérations empêchent les anciennes réponses, même arrivées malgré une annulation, de remplacer une autre page ou une nouvelle identité. Les curseurs restent uniquement en mémoire du navigateur.

Une erreur réseau, un résultat malformé ou un contrôle de session indisponible après le POST ne prouve pas son rejet. L'interface effectue une récupération GET bornée, affiche le résultat comme incertain et ne rejoue jamais le POST. Après un conflit, la page est relue pour afficher la date courante. La durée saisie n'est conservée lors d'une récupération que pour le même client et la même ancienne date ; elle ne suit pas un changement de compte ou d'échéance.

## Validation et suites

Les tests du contrôleur exécutent le code réel dans une VM avec un DOM synthétique : 650 comptes sur treize pages, listes indépendantes, masquage et changements d'identité, conflits, réponses JSON retardées, résultat de renouvellement incertain et durée saisie préservée. Les tests SQL couvrent plus de 500 lignes dans chaque collection, les égalités de microsecondes, la suppression de la ligne du curseur, les insertions récentes, les renouvellements concurrents et la révocation. Les tests HTTP/SQL vérifient aussi les cookies, CSRF, échéances et la conservation des comptes/conversations.

Implémentation `0631ab138ed515935fee7df34ed75bbf6dbfdc5e`, [PR brouillon #13](https://github.com/fredbuhr/jessiemessage/pull/13), empilée sur #12 : [CI 38692820067](https://github.com/fredbuhr/jessiemessage/actions/runs/38692820067) réussie sous Node.js 24.21.0. **838 tests généraux réussis**, 18 groupes SQL explicitement ignorés dans le job sans base ; **260 tests réels réussis sans saut sur chacune des versions MariaDB 10.11 et 11.4**. Syntaxe et build réussis. Les dix-huit groupes SQL sont séquentiels : migrations 12, authentification 16, récupération administrateur 8, accès client 20, file e-mail 13, HTTP accès 13, persistance chat 19, HTTP chat 12, persistance médias 16, HTTP médias 10, persistance CRM 19, HTTP CRM 14, persistance récupération/file 21, HTTP récupération 12, HTTP préparation 10, autorisation des diffusions/chat 13, persistance des diffusions 18 et HTTP diffusion 14.

Ces tests ne constituent pas une recette navigateur ou mobile, une validation de charge, une preuve de majorité externe ou un essai de livraison SMTP réel. Aucun changement de migration, dépendance, clé ou icône ; aucune fusion ou mise en production. L'hébergement, la majorité externe, le stockage/purge/rétention, la restauration cohérente et la recette HTTPS restent dans le [plan de publication](NEXT-STEPS.md).
