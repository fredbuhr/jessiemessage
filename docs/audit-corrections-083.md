# Corrections de l’audit — lot 4, version 0.83

**Lot 4 terminé : version 0.83.0 fusionnée, CI verte, déployée et vérifiée le 20 octobre à 13:22 Europe/Paris.** C01 confirmé et corrigé ; boucle C02 confirmée dans une séquence de visibilité contrôlée puis corrigée, autre race non reproduite en natif.

| Périmètre | État |
| --- | --- |
| C01 — navigation externe vers une API et cookie Strict | Défaut confirmé dans Chrome/HTTPS/SQL : cookie Strict omis lors du retour cross-site puis supprimé par la réponse 401, session SQL conservée. Correction minimale codée dans les neuf modules concernés ; gardes d’accès conservés. |
| C02 — ancienne réponse de Sauvegardes après reprise | Boucle de réamorçage confirmée dans Chrome avec fetch/Abort natifs et hide/show contrôlés dans une même tâche. Ancien finally libérant une nouvelle action non reproduit avec tâches séparées. Gardes existants de génération réutilisés pour ignorer les anciennes requêtes. |
| Petit code mort | Export interne `constantTimeText` sans consommateur applicatif ou CLI retiré avec son seul test ; package privé, aucune API publique de bibliothèque. Comparaisons cryptographiques utilisées conservées. |
| Entrées documentaires | README, PRODUCT et DESIGN-KISS réduits de 295 à 121 lignes, fonctions actuelles et limites décrites ; anciens textes reliés par commit daté. REPRISE reste l’unique état courant. |

Caractérisation sur le code produit original : commit `a9ca4eb4eeaf1b6f5fac35464683882d0abf1370`, [CI](https://github.com/fredbuhr/jessiemessage/actions/runs/39409824889). Job HTTPS/SQL `118584559514` réussi (2/2), client et administrateur : navigation native cross-site, cookie Strict absent à l’aller, 401 supprimant le cookie, session SQL originale encore active. Job Chrome `118584559329` réussi (163/163) : boucle C02 arrêtée au troisième réamorçage, un seul POST ; autre parcours natif annulé puis nouvelle action réussi sans déverrouillage indu. Cette visibilité contrôlée ne qualifie pas un onglet physique ou le BFCache.

Aucune refonte, dépendance, table ou infrastructure ajoutée. Les petites duplications non nécessaires à ces corrections restent en place. Les preuves historiques, mécanismes d’autorité, états PC et D1 sont conservés.

C01 utilise un prédicat partagé de présence exacte du cookie propre au rôle. GET/HEAD sans ce cookie n’émettent plus de suppression ; cookies présents mais invalides et POST explicites gardent leur traitement. Agent PC, exports et nonce de transition restent inchangés. Le parcours Chrome final vérifie session et conversation pour chacun des deux rôles, conservation du même cookie et réouverture sans reconnexion.

C02 vérifie le ticket courant avant requête, publication, réarmement et libération de l’action. Une ancienne erreur ne relance plus le chargement de page. La reprise après changement réel de session reste portée par la preuve de session qui constate ce changement. Aucun rejeu automatique de POST.

Local : **3 125 tests, 2 911 réussis, 214 ignorés, zéro échec**, syntaxe **568 fichiers**. Revues indépendantes du correctif C01 dans les neuf modules, du correctif C02 et des entrées documentaires sans blocage. Les omissions procfs/SQL locales restent distinctes des preuves natives.

[PR #105](https://github.com/fredbuhr/jessiemessage/pull/105) fusionnée : candidat `86fcf161fa839306aee7c34e563c4cf58f8e2f99`, code exécuté `682864cec3b8d0eb1c8a6dd92c4b9bd9dfc097b1`, arbre commun `5eb0c133625b734c8aa92ce3f3642e281a51f380`. Les cinq jobs [candidat](https://github.com/fredbuhr/jessiemessage/actions/runs/39411247045) et [main](https://github.com/fredbuhr/jessiemessage/actions/runs/39412009288) sont réussis : **3 094 tests généraux réussis, 35 wrappers SQL ignorés, zéro échec ; 466/466 par MariaDB 10.11 et 11.4 sans omission ; Chrome 163 ; HTTPS/SQL 2 ; syntaxe 568 ; aperçu construit.** Les suites se recouvrent ; ces nombres ne constituent pas un total de cas uniques.

Build normal du Manager à **13:10 Europe/Paris**, sans réinstallation, migration ni nouveau processus SSH. Vérification à **11:22:24.917246 UTC / 13:22:24 Europe/Paris** : source, arbre, propreté, version, lanceur et permissions concordants ; dix empreintes sensibles et identité de la destination PC préservées ; démarrage du superviseur observé, moniteur OK. Santé et disponibilité répondent 200 avec JSON attendu, `no-store`, sans cookie et HSTS unique sur les deux origines. Sur le principal, huit chemins privés répondent 401 anonymes ; sur recette, les quatre API connexion/messagerie répondent 401 et les quatre chemins réservés au principal répondent 404. Aucun de ces seize refus ne supprime un cookie absent. Quatre contrôles avec cookie invalide présent conservent sa suppression ; quatre avec le cookie de l’autre rôle ne le suppriment pas. Aucun compte réel utilisé. [Capture Manager](verification-proofs/jm083-manager.jpg).

La vérification initiale s’est arrêtée sur un attendu erroné : elle exigeait 401 pour les quatre chemins réservés au principal sur recette. La chaîne de routage, inchangée dans ce lot, y prévoit 404. Revue indépendante confirmée, attendu corrigé sans modifier le serveur. Une seconde erreur de transcription dans l’empreinte locale du lanceur a été corrigée après comparaison avec son fichier et le registre privé, qui concordaient déjà. Les contrôles complets ont ensuite abouti avant de déclarer le déploiement vérifié. La cause de l’interruption de la conversation n’est pas établie par une trace ; aucun échec de déploiement n’en est déduit.

Les documents courants et le checkpoint unique indiquent désormais 0.83 ; repli immédiat 0.82 conservé, sans retour SQL ni suppression d’état. Les PID SSH et un GET privé authentifié de production n’ont pas été observés. Le lot 5 de clôture générale reste distinct ; aucun nouveau chantier fonctionnel ouvert ici.

Les [preuves structurées](verification-proofs/jm083-verification.json) distinguent hypothèse, caractérisation native, correction, CI et déploiement. Aucun test ignoré ni parcours synthétique n’est présenté comme une observation sur appareil physique ou production.

L’installation personnelle du kit PC, A01 hébergeur et l’exécuteur actif A08 restent distincts. Ce lot ne les ferme pas ; aucune nouvelle recette de mail, compte réel ou déchiffrement personnel.
