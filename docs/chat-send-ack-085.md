# Messagerie 0.85 — confirmer un envoi retrouvé dans l’historique

**0.85 livrée et vérifiée le 20 octobre 2026 à 15:43:44 Europe/Paris.** Le propriétaire demande à 15:12 de consacrer le développement au fonctionnement de la messagerie, sans bloquer sur les sauvegardes. Ce lot ne modifie ni leurs fichiers ni leurs mécanismes.

## Défaut et correction

Un POST pouvait être enregistré alors que sa réponse était perdue. L’ouverture d’une notification ou le retour aux messages récents retrouvait ensuite sa clé et acquittait l’envoi, mais le composeur gardait son texte ou sa légende. Un nouveau clic sur **Envoyer** pouvait créer une autre clé et une seconde copie. La reproduction synthétique du vrai contrôleur a compté deux POST avec deux clés ; le chemin événements nettoyait déjà correctement le champ.

Les trois lectures de pages de messages utilisent désormais le même rapprochement : vider le brouillon et le champ seulement quand le message propre portant la clé exacte est retrouvé. Le modèle existant libère aussi la photo préparée. **Réessayer** s’arrête si le chargement vient de confirmer l’envoi ; aucun nouveau POST ni erreur de texte vide. Les brouillons ordinaires et les envois encore incertains restent conservés. Aucun changement d’API, stockage, dépendance ou infrastructure.

## Qualification

| Contrôle | Résultat |
| --- | --- |
| Régression locale du contrôleur | 46/46, zéro échec/omission ; quatre variantes métier échouent avant le correctif, puis passent ; brouillon ordinaire et clé étrangère préservés. |
| Chrome natif | 164/164 ; nouveau test client/administrateur × texte/photo avec vrai Fetch/Abort, réponse retenue après persistance synthétique, historique acquittant, champ vidé, polling repris et un seul POST. |
| Suite générale | 3 101 réussites et 35 wrappers ignorés attendus sur 3 136, zéro échec. |
| MariaDB 10.11 et 11.4 | 466/466 chacune, zéro échec/omission. |
| Authentification et messagerie HTTPS/SQL | 2/2. |
| Syntaxe et build | 568 fichiers, aperçu construit. |

Deux revues ciblées n’ont relevé aucun blocage ; gardes de sélection, visibilité et propriétaire de session conservés. Les suites se recouvrent et ne sont pas additionnées.

PR [107](https://github.com/fredbuhr/jessiemessage/pull/107) fusionnée. Candidat `900791007243eedb591a5657d1091dc6f0782e2b`, main/runtime `de335f6cfce6e362a5595f2418ed142b44376fe2`, arbre commun `0026c652e9cdf29cef6771b81cbd39da0b46fb7b`. [CI candidate](https://github.com/fredbuhr/jessiemessage/actions/runs/39430124726) et [CI main](https://github.com/fredbuhr/jessiemessage/actions/runs/39431127110) : **5/5** ; [push candidat](https://github.com/fredbuhr/jessiemessage/actions/runs/39430118999) également vert.

## Livraison

Précontrôle réussi à **13:32:51.771707 UTC**, sans démarrage ni effacement. Dépendances verrouillées identiques hors versions racine, réutilisées. Build normal Manager réussi à **15:40 Europe/Paris**, sans réinstallation ni migration ; [preuve visuelle](verification-proofs/jm085-manager.jpg), JPEG 60 022 octets, SHA-256 `3a12c226f98d248c2a20f5b16f423373fa0530f7d9b43457f0300b3097849be9`.

À **13:43:44.068382 UTC / 15:43:44 Europe/Paris**, source/arbre propres, version et lanceur/modes vérifiés, reçu réel de démarrage, dix empreintes sensibles et identité PC préservées. **20 contrôles HTTPS** sur les deux origines : quatre santé/disponibilité 200 avec JSON exact et `no-store`, huit API privées auth/accès/chat 401, huit fichiers d’interface publics 200 identiques au code épinglé. HSTS unique et aucun cookie ajouté sur les vingt réponses. Le premier contrôle attendait à tort 401 pour les assets chat : leur route est volontairement publique, avant l’authentification ; la matrice a été corrigée après lecture du handler, sans modifier le code. Moniteur OK (`1792503821833`), Node fourni inchangé `24.15.0`.

Les parcours fonctionnels sont qualifiés sur données synthétiques en CI ; aucun GET privé authentifié de production, nouvel envoi réel ou appareil physique n’est revendiqué. Mode local et port 3000 conservés. [Pins, commandes et repli immédiat 0.84](REPRISE.md) ; anciens replis préservés. L’incident PC reste différé, sans être déclaré résolu ni devenir un préalable aux lots messages. Lot terminé ; aucun chantier suivant ouvert automatiquement.
