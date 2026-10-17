# Lot 0.38 — conserver la langue pendant la reprise

**État : en préparation, non livré.** Le runtime de départ reste `0c88f61bf6b0a9bcf45917862462db838bf73c78`. Ce lot traite la continuité français/anglais de la page de reprise, distincte du correctif d’espacement déjà livré en 0.37. La CI exacte et l’activation de cette nouvelle révision ne sont pas encore réalisées.

## Choix retenus

La page de reprise charge et réutilise `i18n.js`, avec ses opérations existantes `getLanguage`, `setLanguage` et `onChange`, au lieu de maintenir une préférence indépendante. Les titres de page suivent aussi le français ou l’anglais. Le module partagé n’est pas modifié.

La préférence courante accompagne seulement les fragments fermés de reprise : challenge, ticket et indication de notification/locale. Le contexte, le rôle et le sens du passage entre les deux origines doivent être valides avant d’appliquer la préférence reçue. Le fragment est effacé avant tout travail asynchrone. La dernière langue choisie pendant une requête reste prioritaire sur une préférence antérieure transportée par celle-ci. Les anciennes variantes sans locale restent acceptées.

La destination authentifiée renvoyée par le serveur reste prioritaire sur les indications de fragment. Sa validation exige la chaîne complète, y compris le refus d’un saut de ligne final ; aucun chemin arbitraire ne peut être ajouté au parcours.

## Revenir à la connexion depuis recette

Lorsqu’une session manque, **Me connecter** peut quitter recette avec un seul intent primaire fermé :

```text
#signin=fr|en[&notification=<32 caractères hexadécimaux minuscules>]
```

La page de reprise sur l’apex valide cet intent, enregistre la préférence sur cette origine puis rejoint `/access` ou `/admin/login` selon le rôle fixe de sa propre route. Une référence de notification valide est conservée uniquement sous la forme canonique `#notification=…`.

Cet intent ne lance aucun `begin`, `authorize` ou `complete` : il conduit à la connexion normale. Il n’existe pas de paramètre `next` libre. Le lot ne modifie ni `NotificationLink`, ni les contrôleurs de connexion ou de chat, ni le module de langue partagé.

## Périmètre et vérification

Aucun payload API, cookie de session, session serveur, table SQL, clé ou abonnement Push n’est changé. Si le stockage de préférence est indisponible, l’interface reste utilisable et le passage prévu peut transporter sa langue ; la persistance du choix sur les pages ordinaires suivantes n’est alors pas garantie.

**Preuve obtenue à ce stade : 85 tests de contrôleur réussis**, selon le relevé du lot. Ce résultat n’est ni une validation Chrome complète, ni une livraison hébergée. La CI exacte, le préflight, l’activation et la vérification visuelle restent à consigner après leur réalisation.

Le [plan de récupération client 0.39](client-recovery-readiness.md) accompagne ce lot comme préparation future uniquement : profil explicite et compatibilité sauvegarde/restauration avant toute activation. La récupération client reste inactive.
