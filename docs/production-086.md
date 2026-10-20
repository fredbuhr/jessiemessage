# Clôture V1 — livraison 0.86

**V1 applicative terminée ; 0.86 livrée et vérifiée le 20 octobre 2026 à 14:18:38.549451 UTC / 16:18:38 Europe/Paris.** A01 reste ouvert avant une ouverture large : cette livraison n’est pas une certification générale sans réserve Node. Pins et repli dans [REPRISE](REPRISE.md).

## Périmètre borné

- Liens **État du service / Service status** uniformisés dans les interfaces FR/EN.
- `nodeVersion` ajouté au reçu de démarrage du parent lancé par Manager. Ce champ constate une version ; il ne met pas Node à jour.
- Preuve 0.85 précisée : défaut reproduit avant correction en **VM** ; parcours **Chrome natifs réussis après correction**. Aucune reproduction Chrome antérieure revendiquée.

## V1 et réserves

| Élément | État et portée |
| --- | --- |
| Accès privé | Livré : invitations, e-mail vérifié, approbation, MFA administrateur, récupération client et sessions indépendantes. |
| Messagerie | Livrée : texte/photos, historique, galerie, brouillons et envoi confirmé après réponse HTTP perdue. |
| Administration | Livrée : CRM, fiches privées, tags/groupes, conflits, diffusions individuelles et état du service. |
| Notifications et exports | Livrés : notification neutre vers le message concerné, export client/administrateur avec photos partagées ; interfaces FR/EN et guide. |
| A01 — Node fournisseur | **Ouvert : le nouveau reçu du parent Manager confirme v24.15.0.** Aucune option de correctif dans le Manager observé ; choisir la majeure 24 ne prouve pas un correctif appliqué. Aucune divergence avec SSH démontrée. |
| A07 — PC/Avast | Différé sur instruction utilisateur, non résolu et hors des préalables de cette clôture. Artefact et états existants préservés ; aucune action PC demandée. |
| A08 — archivage | Exécuteur actif différé, sans nouvelle purge ; ne conditionne pas les lots messages. |

La priorité durable reste le cœur de la messagerie. Aucun autre manque fonctionnel nécessaire à la V1 n’est confirmé. Les réserves ne sont pas transformées en succès.

## Qualification et livraison

| Étape | État |
| --- | --- |
| Vérifications ciblées | Interface 66/66 et superviseur 46/46 ; zéro échec/omission. Syntaxe : 568 fichiers. |
| CI candidat | [PR108 fusionnée](https://github.com/fredbuhr/jessiemessage/pull/108), [CI](https://github.com/fredbuhr/jessiemessage/actions/runs/39435563786) et [push](https://github.com/fredbuhr/jessiemessage/actions/runs/39435537416) 5/5 ; général 3 101 réussites/35 wrappers SQL ignorés, Chrome 164/164, MariaDB 466/466 chacune, HTTPS 2/2. Zéro échec. |
| CI main | [Run](https://github.com/fredbuhr/jessiemessage/actions/runs/39436551982) 5/5 ; mêmes compteurs de validation, arbre identique au candidat. |
| Précontrôle serveur | 20 octobre 14:09:41.791664 UTC : `local_closure_precheck/passed`, aucune fermeture en attente, aucun démarrage/effacement ; continuité externe non vérifiée. Dépendances réutilisées après égalité des lockfiles hors deux versions racine. |
| Déploiement et contrôles | Build normal Manager réussi à 16:17 Europe/Paris, Node actif, sans réinstallation ni migration. Vérification à 16:18:38 : 26 HTTPS conformes sur deux origines — quatre santé/disponibilité 200 avec JSON exact et `no-store`, huit API auth/accès/chat 401, quatorze ressources publiques 200 identiques au code épinglé ; HSTS unique et aucun `Set-Cookie` sur les 26 réponses. Dix empreintes sensibles et identité PC préservées ; moniteur OK (`checkedAt:1792505912998`). |
| Repli | 0.85 préservée ; pins et commandes dans REPRISE. |

Le reçu prouve la version du **parent** démarré par Manager. L’enfant fork réemploie normalement son exécutable ; aucune preuve de version propre à l’enfant n’a été ajoutée. Le [bulletin Node de juillet 2026](https://nodejs.org/en/blog/vulnerability/july-2026-security-releases) publie des correctifs ultérieurs ; la [FAQ Infomaniak 2535](https://www.infomaniak.com/fr/support/faq/2535/modifier-la-configuration-dun-site-nodejs-infomaniak) décrit le choix de version. A01 reste une dépendance fournisseur non résolue.

[Preuve Manager](verification-proofs/jm086-manager.jpg) : JPEG 60 021 octets, SHA-256 `2d3ea2e82b92fcd464fe6f07c6012a8808aa3ee38e46d95af654af193b5612be`.

Les [lots 0.84](service-status-084.md) et [0.85](chat-send-ack-085.md) conservent leurs preuves. Les contrôles HTTP ne sont pas des GET privés authentifiés de production. Aucun nouvel envoi réel, effacement, restauration ou qualification PC ; aucun nouveau test mail/PC demandé. Gardes, clés, journaux, marqueurs, autorité et D1 préservés, sans garantie historique réintroduite.

Runtime retenu : `c61d1eecfefe786254416652877ba82d30cf4c90`, arbre `78c8e46224503b0691b381bf07c5aefd51ca5c7f`, identique au candidat `37110bc59d83c40eaf53fa1cb8502d287a2c9a06`.
