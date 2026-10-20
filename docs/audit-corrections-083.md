# Corrections de l’audit — lot 4, version 0.83

**Corrections codées, relues et qualifiées localement ; CI finale en attente, service 0.82 conservé.** C01 confirmé ; boucle C02 confirmée dans une séquence de visibilité contrôlée, autre race non reproduite en natif.

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

Les [preuves structurées](verification-proofs/jm083-verification.json) distinguent hypothèse, caractérisation native, correction, CI et déploiement. Aucun test ignoré ni parcours synthétique n’est présenté comme une observation sur appareil physique ou production.

L’installation personnelle du kit PC, A01 hébergeur et l’exécuteur actif A08 restent distincts. Ce lot ne les ferme pas ; aucune nouvelle recette de mail, compte réel ou déchiffrement personnel.
