# Lot 1 de l’audit — 0.80.0

**20 octobre 2026 — lot 1 applicatif livré et vérifié en 0.80.0.** A02, A03, A04 et A11 de l’[audit](AUDIT-CODE-2026-10-20.md) sont corrigés ; A01 reste ouvert indépendamment. Aucun schéma, dépendance ou infrastructure ajouté. [Preuves complètes](verification-proofs/jm080-verification.json).

## Comportements corrigés

- **A02, quotas publics :** le débit global puis réseau s’effectue dans la transaction SQL existante. Si le réseau refuse, un retour au savepoint annule les deux débits. Le plafond global conserve sa priorité et borne la création des compteurs réseau ; les budgets d’identité, seuils et hashes persistés sont conservés. Les autres usages de `consumeRateLimit` gardent leur interface. Cette correction ne promet pas une disponibilité contre plusieurs réseaux encore admissibles.
- **A03, diffusions :** horloge partagée relue après verrous campagne/destinataire, après les contrôles média et avant validation finale. Une expiration durant l’insertion ou les écritures suivantes entraîne le rollback de la transaction complète, sans message, événement ou notification engagé tardivement. Le jeton de bail, l’idempotence et les contrôles d’accès restent actifs.
- **A04, liens :** récupération, consommation d’invitation, vérification email et réémission utilisent une heure après les verrous pertinents. Les mutations valides partagent cet instant ; une proposition de nouveau lien déjà expirée refuse avant révocation de l’ancien. Les dates d’expiration originales ne sont pas prolongées. `createConfiguredServer` injecte la même horloge aux stores et services.
- **A11, HTTPS :** une politique HSTS `max-age=31536000`, limitée à l’hôte, est posée à la frontière HTTP commune pour les autorités HTTPS configurées. Les réponses privées, erreurs, refus d’admission et drainage la conservent. Les en-têtes de transfert ne peuvent pas activer la politique sur un serveur neutre. Aucun `includeSubDomains` ni préchargement ajouté. Le TLS est terminé par le frontal d’hébergement existant.

## A01 — Node, dépendance d’hébergement encore ouverte

Le Manager a été actualisé puis son sélecteur lu sans enregistrement de paramètres : branches 25, 24 recommandée, 23, 22, 21 et 20 ; aucune version corrective précise sélectionnable. La branche 24 est déjà choisie. À **00:28:46.040082 UTC**, `/usr/local/bin/node` donne encore **24.15.0**, avec dix empreintes sensibles préservées.

A01 n’est donc pas déclaré résolu. Ne pas passer à une autre version majeure hors `engines >=24 <25`, installer un runtime parallèle ou changer d’offre pour masquer cette limite. Les correctifs applicatifs sont livrables indépendamment. La [documentation Infomaniak](https://www.infomaniak.com/fr/support/faq/2535/modifier-la-configuration-dun-site-nodejs-infomaniak) décrit le choix de version et le redémarrage ; le [bulletin officiel Node](https://nodejs.org/en/blog/vulnerability/july-2026-security-releases) reste la référence pour les correctifs déjà publiés.

## Vérifications réalisées

Qualification locale du candidat : **3 082 tests, 2 868 réussis, 214 ignorés, zéro échec**, Node 24.19.0, TMPDIR accessible et concurrence 2 ; syntaxe de **563 fichiers** validée. Les suites ciblées recoupent la suite générale : leurs comptes ne sont pas additionnés.

Cinq jobs [candidat](https://github.com/fredbuhr/jessiemessage/actions/runs/39348463757) et cinq [main](https://github.com/fredbuhr/jessiemessage/actions/runs/39349061528) réussis : général **3 051 réussis / 35 wrappers SQL ignorés / zéro échec**, **458/458 sur MariaDB 10.11 et 458/458 sur 11.4 sans omission**, Chrome **160**, recettes HTTPS/SQL **2**, syntaxe **563**, aperçu construit. Les régressions SQL natives ci-dessous sont donc qualifiées en CI, distinctement des omissions locales.

- Quotas : refus réseau sans débit global, fenêtres et retour en arrière transactionnel, cardinalité bornée malgré les adresses tournantes, concurrence et panne de rollback.
- Liens : attente de connexion et de derniers verrous, expiration exacte refusée, limite moins une milliseconde acceptée, timestamps frais, générations/révocation/usage unique préservés.
- Diffusions : attentes sur campagne, destinataire et média ; bail/campagne expirés refusés ; envoi valide ; rollback après insertion d’événement, avec zéro message/événement/notification résiduel.
- HSTS : réponse publique, privée 401, erreur 503, admission 429, HEAD, drainage, origine historique ; absence sur serveur neutre ou Host étranger malgré des en-têtes de transfert.
- Suite générale, syntaxe, MariaDB 10.11/11.4, Chrome et parcours HTTPS/SQL requis sur le candidat ; contrôles de livraison non destructifs.

## Déploiement et portée de la preuve

[PR #102](https://github.com/fredbuhr/jessiemessage/pull/102) fusionnée : candidat `5edff7ca5899e564e6b96555528ec1887d08fbfe`, merge exécuté `eb3e93c534bdfe5d426b1be42d6bebb093b548ce`, arbre commun `60eeeb39bf22f0ac894e46b8d444b18a795a2167`. Précontrôle sans démarrage/effacement réussi à 00:42:08 UTC ; build normal du Manager à **02:50 Europe/Paris**, sans réinstallation. [Preuve visuelle](verification-proofs/jm080-manager.jpg).

À **00:54:16.691594 UTC / 02:54:16 Europe/Paris**, source/arbre/propreté/version/lanceur vérifiés ; dix empreintes sensibles préservées ; reçu de démarrage du superviseur et moniteur OK. Santé/disponibilité 200, JSON attendu, `no-store` et sans cookie sur les deux origines ; trois API administrateur refusent les anonymes en 401. Les sept réponses ont un HSTS unique `max-age=31536000`. L’entrée publique `/app` est rendue dans Chrome.

Les PID parent/enfant n’ont pas été observés depuis SSH ; la preuve de démarrage repose sur le reçu du superviseur (après IPC/disponibilité de l’enfant) et les contrôles HTTPS frais. Aucun GET privé authentifié en production ni essai réel d’envoi, d’effacement ou de restauration effectué pour valider. Le repli immédiat 0.79 est conservé. Node après déploiement est toujours **24.15.0** : A01 demeure ouvert.

Le [point de reprise](REPRISE.md) contient les commandes courantes. Les candidats C01/C02 restent au lot 4 ; les copies PC, clés, états d’autorité et D1 restent préservés. Prochain travail prévu : lot 2.
