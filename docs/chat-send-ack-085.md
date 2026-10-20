# Messagerie 0.85 — confirmer un envoi retrouvé dans l’historique

**Correctif codé et relu, 46 tests ciblés réussis ; qualification Chrome/CI et livraison en attente. Le service actif reste 0.84.** Le propriétaire demande le 20 octobre à 15:12 Europe/Paris de consacrer le développement au fonctionnement de la messagerie, sans bloquer sur les sauvegardes. Ce lot ne modifie ni leurs fichiers ni leurs mécanismes.

## Défaut reproduit

Après un POST enregistré dont la réponse est perdue, le navigateur conserve correctement sa clé de reprise. Une notification peut ouvrir un ancien message, puis **Réessayer cet envoi** recharge les messages récents. Cette page retrouve la clé et acquitte l’envoi, mais le composeur gardait son texte ou sa légende. Un nouveau clic sur **Envoyer** pouvait créer une autre clé et une seconde copie. Une reproduction synthétique utilisant le vrai contrôleur a compté deux POST avec deux clés et deux copies du texte. Le chemin événements, lui, vidait déjà correctement le champ.

## Correction limitée

Les trois lectures de pages de messages utilisent le même rapprochement : effacer le brouillon et le champ seulement quand le message propre portant la clé exacte de l’envoi incertain est retrouvé. La photo préparée est libérée par le modèle existant. **Réessayer** s’arrête proprement si le chargement vient de confirmer l’envoi ; aucun nouveau POST ni erreur de texte vide. Les brouillons ordinaires et les envois encore incertains restent conservés. Aucun changement d’API, modèle de stockage, dépendance ou infrastructure.

## Qualification et livraison

`node --test tests/chat-lifecycle.test.mjs` : **46/46**, sans échec ni omission. Les quatre sous-cas métier échouent sur le code précédent puis passent avec le correctif ; brouillon ordinaire et clé étrangère conservés. Syntaxe : **568 fichiers**. Un test Chrome ajoute quatre scénarios client/administrateur × texte/photo, avec vrai Fetch/Abort et réponse HTTP retenue après persistance synthétique ; aucune substitution du contrôleur ou de Fetch. Sa fixture HTTP a été vérifiée, mais Chrome reste à exécuter en CI. Deux revues ciblées ne relèvent aucun blocage : refus de réponse obsolète et preuve de session conservés. Aucun nouvel essai de compte réel, envoi réel, migration ou dépendance. Le code n’est pas encore annoncé fusionné ou déployé.

[État actif et repli](REPRISE.md). Le lot se termine après qualification, livraison du correctif et bilan ; aucune nouvelle étape de sauvegarde n’en est un préalable.
