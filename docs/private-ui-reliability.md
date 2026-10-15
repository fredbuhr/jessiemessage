# Fiabilité des interfaces privées — 0.12

Ce lot corrige les premiers défauts reproduits dans l'audit de la révision `c3baf922`. Il ne change ni les autorisations métier, ni les clés, ni les 25 migrations, ni les dépendances ou les icônes approuvées. L'adresse du site reste **contact@jessiemessage.com**.

## Propriétaire des données du navigateur

Le chat rattache son état privé à l'utilisateur, son rôle et le CSRF de sa session actuelle. Un autre compte ou une nouvelle connexion du même compte invalide messages, brouillons, envois en attente, fiches et URL de photos avant de charger le nouvel espace. Le même compte avec la même session conserve ses identifiants d'envoi incertains. Aucun POST n'est rejoué automatiquement lors d'une reprise.

Les réponses privées sont adoptées après une nouvelle vérification de session. Une vérification déjà envoyée avant l'arrivée d'une autre réponse ne sert pas à valider cette dernière. Les générations de page, visibilité, sélection et opération bloquent aussi les anciennes réponses lorsque le réseau ignore l'annulation. Les photos et leurs URL sont contrôlées de la même façon, y compris pour une ancienne réponse 401/403 qui ne doit pas déconnecter une nouvelle session.

Au masquage du chat, l'espace est caché pendant la revalidation de retour. L'état du même utilisateur peut rester en mémoire pour reprendre son brouillon ; le changement d'identité le purge. La page de diffusion efface son brouillon et son audience au masquage comme auparavant. Les vérifications avant/après réponse assurent la cohérence des changements de connexion observables ; elles ne constituent pas un rappel des données déjà reçues ni une garantie de révocation instantanée à chaque octet du réseau.

Une panne de vérification après un POST ne prouve pas le rejet de ce POST. Le chat et les diffusions conservent donc l'identifiant incertain, à condition de rester dans la même session. L'interface demande une action explicite pour réessayer. Un changement de propriétaire efface l'ancien brouillon plutôt que de le présenter au nouveau compte.

## Administration et récupération

La connexion client ne présente pas directement l'identité renvoyée par le POST. Un GET final valide la session courante, son identifiant, son rôle, son CSRF, son échéance et la forme de son accès ; seule cette réponse est affichée. Une session différente est signalée. Si cette preuve échoue après la connexion, le résultat reste incertain et aucun POST n'est répété automatiquement.

Le masquage ou `pagehide` de l'administration invalide les opérations, annule les requêtes et efface identité, listes d'e-mails, lien d'invitation et champs sensibles. Le retour charge une seule session puis vérifie l'identité avant d'afficher les données privées. Les anciens `finally` ne peuvent pas réactiver une nouvelle action. L'échéance absolue de la session reste conservée ; masquer la page ne la prolonge pas.

Une erreur réseau, 429, 503 ou réponse malformée lors de la vérification de disponibilité de la récupération reste réessayable. Seule une réponse 404 désactive la fonction pour la page courante. Un bouton permet de relancer explicitement cette vérification ; le retour de visibilité peut aussi refaire un GET. Il n'y a ni boucle de nouvelles tentatives immédiates, ni répétition automatique des demandes ou changements de mot de passe. Les réponses tardives ne peuvent pas masquer un formulaire ou vider des champs plus récents.

## Activité des diffusions

La route administrateur `GET /api/broadcast/admin/activity` renvoie l'union des **20 campagnes les plus récentes** et des **10 campagnes au maximum encore en cours**, sans doublon : au plus 30 campagnes, ordonnées par date de création puis identifiant décroissants. La session et la propriété SQL sont recontrôlées ; la réponse n'inclut ni destinataires, ni preuve d'approbation, ni données techniques de file. Les quotas de lecture existants s'appliquent.

Ce flux ne dépend plus de la première page d'identifiants aléatoires de l'archive. Le navigateur actualise aussi, par lots bornés, les campagnes précédemment actives qui viennent de sortir du flux, afin d'apprendre leur état terminal. Le rafraîchissement automatique normal est de 30 secondes, avec respect des délais `Retry-After`. Les compteurs terminaux ne régressent pas lorsqu'une ancienne réponse arrive.

L'archive complète conserve sa pagination par identifiant. « Actualiser l'historique » repart explicitement de son début ; les rafraîchissements automatiques conservent la progression. Si plus de 20 campagnes terminées sont créées entre deux passages, les plus anciennes restent accessibles par cette pagination, pas toutes dans le flux récent.

Les tris SQL des campagnes récentes ne portent que sur identifiants et dates, avant lecture des contenus chiffrés retenus. La réponse est bornée ; cela ne démontre pas un temps SQL constant avec un historique arbitrairement grand. Un index propriétaire/date adapté et des mesures de charge restent à prévoir avec l'évolution des migrations avant une exploitation volumineuse.

## Validation et limites

Les nouveaux tests exécutent les contrôleurs réels dans une VM avec un DOM et des réponses synthétiques contrôlables, dont des réponses qui arrivent malgré `abort()`. Ils couvrent changements de compte/session, masquage/retour, anciens POST et `finally`, photos, indisponibilité temporaire de récupération, historique de plus de 20 campagnes et délais de nouvelle tentative. Ce sont des tests du code de contrôle, pas une recette visuelle ou une exécution dans un navigateur.

Les tests HTTP et MariaDB vérifient aussi la nouvelle vue d'activité, sa propriété, ses bornes et l'inclusion d'une ancienne campagne active derrière plus de 20 campagnes récentes. L'implémentation `0cf3b0faf9d95f49c6dc3ad963f05f08b0cb2fd9`, [PR brouillon #11](https://github.com/fredbuhr/jessiemessage/pull/11), passe la [CI 38663130943](https://github.com/fredbuhr/jessiemessage/actions/runs/38663130943) sous Node.js 24.21.0 : **711 tests généraux réussis**, 18 groupes DB ignorés uniquement sans base ; **245 tests SQL réussis sans saut sur chacune des versions MariaDB 10.11 et 11.4**. Syntaxe et build réussissent également.

Les correctifs d'admission des uploads, quotas de lecture/session, annulation SMTP et arrêt gracieux appartiennent au lot suivant. Majorité externe, renouvellement d'accès, pagination administrative, quotas de stockage, purge, restauration complète, hébergement réel, recette HTTPS/appareils, FR/EN et Push restent dans le [plan de publication](NEXT-STEPS.md). Aucun compte, e-mail ou contenu client réel n'est utilisé dans ces tests.
