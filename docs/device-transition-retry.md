# Reprise après coupure — conserver le message visé

**Correction livrée en 0.37 le 17 octobre 2026 à 16:57 Europe/Paris.** Runtime `3e952101f7c7aa3d7536e7cb7cc57de83dee71ac`, arbre `8dd5d28c750edc6f417b2339aa67c3ab344d183e`, déploiement `primary-transition`, schéma 30. [PR brouillon #51](https://github.com/fredbuhr/jessiemessage/pull/51) ; [CI de la révision exacte, cinq jobs réussis](https://github.com/fredbuhr/jessiemessage/actions/runs/39042669295).

Cette preuve de livraison est historique. Le runtime courant `4433309f`, activé en 0.38 à 18:03, conserve intégralement cette correction, la [présentation des actions de reprise](device-transition-interface.md) et la [continuité de langue](device-transition-language.md). Le propriétaire confirme globalement à 17:28 que le parcours proposé fonctionne ; ce retour ne détaille pas toutes les plateformes ou les sessions simultanées.

## Défaut confirmé

Dans le runtime de transition `a0b17ce0`, un clic de notification peut lancer la reprise avec une référence de message. Le premier aller-retour réussit normalement, car le serveur conserve cette référence dans les paquets authentifiés. Mais après une erreur réseau, une réponse 503 ou un délai dépassé pendant l’autorisation ou la fin de reprise, **Réessayer** recommence avec un nouveau `begin` sans cette référence. La connexion peut alors aboutir sans ouvrir le message initial.

La régression est reproduite avec le vrai contrôleur JavaScript. Les anciens tests couvraient surtout une nouvelle tentative du début de reprise, sans référence ; ils ne démontraient pas sa conservation après les deux étapes suivantes.

## Correction simple

Le contrôleur transporte également la référence non secrète de notification dans le fragment des deux sauts. Un parseur fermé n’accepte qu’un paquet borné et, éventuellement, une référence de trente-deux caractères hexadécimaux minuscules. Le fragment est toujours effacé avant tout travail asynchrone.

Cette référence sert à **recommencer** un parcours interrompu. L’autorisation et la fin normales continuent à envoyer leur unique champ de paquet au serveur ; seule sa destination authentifiée décide du résultat. Un indice de fragment différent ne remplace donc pas la destination d’un ticket valable. Les anciens fragments sans indice restent acceptés.

Aucune modification serveur, session, cookie, clé, table ou migration n’est nécessaire. Aucun stockage navigateur supplémentaire n’est ajouté. Le service worker ne met pas les scripts ni les données privées en cache ; les pages de reprise restent servies avec les en-têtes privés existants.

## Validation et livraison

Les régressions couvrent les deux rôles et les erreurs 503, réseau ou délai dépassé pendant l’autorisation et la fin de reprise, le nouveau départ après un ticket consommé, la priorité de la destination authentifiée, les formats refusés et l’annulation en quittant la page. Les scénarios Chrome utilisent deux origines HTTPS locales et les vrais cookies du navigateur avec des comptes synthétiques.

Les **59 tests ciblés** du contrôleur, du service et du HTTP passent sans saut. La suite locale générale compte **2 103 tests : 1 960 réussis, 143 ignorés sans leurs moteurs, aucun échec** ; syntaxe et construction du workbench passent. La CI exacte réussit ses cinq jobs :

| Job | Résultat |
| --- | --- |
| Vérification générale | 2 076 réussis, 27 wrappers SQL ignorés dans ce job, aucun échec ; syntaxe et build réussis |
| Chrome, clavier et parcours applicatifs | 28/28, aucun saut |
| Authentification Chrome/HTTPS/MariaDB | 1/1, aucun saut |
| MariaDB 10.11 | 370/370, aucun saut |
| MariaDB 11.4 | 370/370, aucun saut |

La première CI de `92e6902b` avait quatre jobs réussis et deux scénarios Chrome réseau en échec : fermer avant les en-têtes permettait au navigateur de rejouer le POST sans afficher **Réessayer**. Le commit `3e952101` ne change que la fixture et ses diagnostics bornés : elle envoie des en-têtes puis un JSON tronqué avec une longueur annoncée supérieure au corps. La lecture JSON échoue réellement. Les scénarios de coupure, de ticket consommé et d’indice différent passent alors dans Chrome. Aucun changement du code de production n’a servi à contourner cet échec de fixture.

Le checkout distinct `/srv/customer/jessiemessage-operator/device-transition-retry-3e952101` passe son préflight à **16:54:46** sans démarrer de listener. Le lanceur privé `0700`, créé exclusivement à **16:55:29.516**, épingle SHA, arbre et checkout propre ; SHA-256 `5dc3436530d1ab5dba4370aff03b8bd041aea43b03baab9ee530e8e2c27e21c4`. Le Manager enregistre les commandes épinglées puis construit et redémarre le service existant à **16:57**, avec `primary-transition` dans les logs.

À **16:59:57.564**, **50/50 contrôles** passent : 46 requêtes HTTPS avec résolution normale et validation TLS, quatre contrôles Host sur le listener loopback, dont **18 empreintes exactes** de neuf fichiers sur chacune des deux origines. Accueil, entrée, disponibilité, pages de reprise privées, refus anonymes et cross-origin, fermeture des chemins privés et canonicalisation `www` sont vérifiés. Le premier lot avait des assertions sensibles à la casse des noms d’en-têtes et une requête Apache sans User-Agent refusée ; le lot final normalise les noms et identifie le client comme `JessieMessage-operator-check/1.0`. Le navigateur confirme également `www/` → accueil apex → `/app`. Aucun réglage Apache n’est modifié pour ces contrôles.

Le repli direct conserve le runtime de transition précédent `a0b17ce0`, compatible avec l’apex et le schéma 30. Un retour à 0.33 demanderait aussi un repli coordonné du domaine et des DNS.

Aucun contrôle anonyme ni test synthétique ne remplace une nouvelle notification système et sa reprise sur les appareils du foyer. Le navigateur de contrôle ne possédant pas d’ancienne session administrateur, son parcours affiche correctement la connexion unique nécessaire ; il ne démontre pas la reprise d’une session du propriétaire.

La [recette des appareils](notifications-device-acceptance.md) conserve l’ancienne connexion et les anciennes installations jusqu’à validation de l’apex. Le [compte rendu de bascule](primary-origin-cutover.md) distingue les réponses du nouveau service de la propagation DNS encore observée sur certains parcours.
