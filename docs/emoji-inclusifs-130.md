# Emojis enrichis et inclusifs — cible 1.3.0

**21 octobre 2026 — développement et qualification en cours ; aucune fusion, publication ou activation 1.3.0 encore constatée.** La production reste en **1.2.0**, dont l’utilisateur confirme le bon fonctionnement. [REPRISE](REPRISE.md) centralise les références et preuves de livraison.

## Périmètre

- **268 choix**, soit 88 ajouts au catalogue de 1.2.0 : 42 dans Doubles sens et 21 dans Personnes. Les cinq carnations adaptent 61 choix compatibles, sans multiplier les entrées de la grille. Les 180 anciens identifiants restent disponibles.
- Conserver le catalogue Unicode existant et ajouter une catégorie **Doubles sens** : fruits, légumes, gourmandises et objets suggestifs, avec noms et recherche en français et anglais. Le concombre peut aussi être retrouvé par « courgette » ; il ne s’agit pas d’un nouvel emoji Unicode de courgette.
- Ajouter des gestes, doigts et personnages adultes, ainsi que des représentations de couples inclusives.
- Proposer **Couleur de peau** : cinq carnations, de claire à foncée, en plus du rendu par défaut. La grille adapte les gestes et personnages compatibles au choix effectué ; elle ne répète pas six fois chaque entrée. Les objets et visages sans variante de carnation conservent leur représentation.
- Insérer le choix dans le brouillon à la position du curseur, avec envoi toujours explicite et conservation des limites de texte et de légende. Le choix de carnation reste en mémoire dans la page ouverte et est effacé avec l’état du compte.

Tout reste du texte Unicode local : aucune API, bibliothèque graphique, dépendance, migration SQL ou infrastructure supplémentaire. Le rendu visuel dépend du système de l’appareil. La mise à jour conserve le schéma 31 et ne change aucun fichier de migration historique.

## Flirtmoji : partage personnel et bibliothèque intégrée

L’utilisateur précise un usage non commercial. La [FAQ officielle](https://flirtmoji.co/pages/faq/) prévoit l’enregistrement ou la copie d’une icône choisie puis son partage individuel dans une messagerie. Les [conditions publiques](https://flirtmoji.co/pages/terms-of-service/) accordent toutefois des droits limités de consultation et de partage personnel ; elles n’établissent pas clairement le droit de réhéberger et redistribuer leur catalogue dans une autre application. La collecte automatisée exige également une permission expresse.

Aucune illustration Flirtmoji n’est récupérée ou intégrée à ce lot. Une bibliothèque réhébergée nécessite un droit spécifique du titulaire ; cette limite est distincte du partage individuel prévu par leur FAQ et ne bloque pas l’enrichissement Unicode.

## Critères de livraison

1. Vérifier les variantes Unicode, la recherche bilingue, l’insertion au curseur et les limites de brouillon, y compris pour les séquences de plusieurs caractères.
2. Qualifier dans Chrome les deux rôles, le choix de peau foncée, le changement de langue, le clavier et les petits écrans, sans envoi automatique.
3. Consigner CI, fusion et publication sur le même commit ; préparer l’activation sans attribuer de succès aux étapes non observées. Ne déclarer la 1.3.0 active qu’après vérification distincte du service.

Les diffusions à grande échelle restent la prochaine évolution métier après cette demande d’enrichissement. Le lot 1.2.0 et ses preuves conservent leur périmètre historique de 180 emojis.

## Qualification locale

105 tests ciblés réussis, sans échec ni omission : catalogue, cycle de session, traduction et accessibilité. Ils couvrent les cinq carnations, VS16/ZWJ/couples, recherche d’un emoji teinté, insertion, limites de texte/légende et réinitialisation au changement de compte. Le nouveau parcours Chrome 320 px client/admin est écrit et sa syntaxe vérifiée ; Chrome est absent localement et son exécution reste à qualifier en CI. Une revue indépendante statique n’a relevé aucun point bloquant.
