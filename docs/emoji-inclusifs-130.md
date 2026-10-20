# Emojis enrichis et inclusifs — 1.3.0

**21 octobre 2026 — code fusionné, qualifié et publié en v1.3.0 ; préparation Infomaniak et activation encore en attente.** La production reste en **1.2.0**, dont l’utilisateur confirme le bon fonctionnement. [REPRISE](REPRISE.md) centralise les références et preuves de livraison.

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

1. **Validé** : variantes Unicode, recherche bilingue, insertion au curseur et limites de brouillon, y compris les séquences de plusieurs caractères.
2. **Validé en CI Chrome** : les deux rôles, choix de peau foncée, changement de langue, clavier et petits écrans, sans envoi automatique.
3. **CI, fusion et publication consignées** ci-dessous. Préparation hébergée et activation restent à confirmer ; ne déclarer la 1.3.0 active qu’après vérification distincte du service.

Les diffusions à grande échelle restent la prochaine évolution métier après cette demande d’enrichissement. Le lot 1.2.0 et ses preuves conservent leur périmètre historique de 180 emojis.

## Qualification locale

105 tests ciblés réussis, sans échec ni omission : catalogue, cycle de session, traduction et accessibilité. Ils couvrent les cinq carnations, VS16/ZWJ/couples, recherche d’un emoji teinté, insertion, limites de texte/légende et réinitialisation au changement de compte. Le nouveau parcours Chrome 320 px client/admin est écrit et sa syntaxe vérifiée ; Chrome est absent localement ; son exécution réelle est désormais confirmée par la CI citée ci-dessous. Une revue indépendante statique n’a relevé aucun point bloquant.

## Livraison et activation en attente

- [PR 113](https://github.com/fredbuhr/jessiemessage/pull/113), source livrée `afd0e98cdb4027ac4cb444ddb05afeda0a84fb6b`, arbre `37b3b2e9358972c95581fc0bcf16896e4074d5f9`.
- [CI PR](https://github.com/fredbuhr/jessiemessage/actions/runs/39514681589) et [CI main exacte](https://github.com/fredbuhr/jessiemessage/actions/runs/39515366616) réussies 5/5 : général 3 181 réussis, zéro échec, 36 ignorés ; MariaDB 10.11 et 11.4 479/479 chacune, Chrome 169/169, HTTPS/MariaDB 3/3, sans omission dans ces jobs natifs ; syntaxe et build 583 sources. Le nouveau parcours Chrome des carnations passe.
- [Tag/release v1.3.0](https://github.com/fredbuhr/jessiemessage/releases/tag/v1.3.0) sur le commit exact, publiés le `2026-10-20T23:36:15Z` par le [workflow vérifié](https://github.com/fredbuhr/jessiemessage/actions/runs/39516082828). [Preuves structurées](verification-proofs/jm130-verification.json).
- [Helper de préparation](https://github.com/fredbuhr/jessiemessage/blob/3e327d29c653b8e82eeb393046ba6271790f0c35/ops/prepare-release130.sh), SHA-256 `b38ad31c4838415632774877d9cd0529522cb5b617c70a970375379bc781af3b` : 15 tests synthétiques réussis sur les pins livrés, aucun staging réel exécuté par l’agent. Il conserve le repli 1.2.0 et ne modifie ni Manager ni suivi opérateur.

Exécuter la préparation épinglée une fois puis lire son reçu avant d’enregistrer les nouveaux Run/Build du Manager. La production reste 1.2.0 tant que la nouvelle identité n’est pas confirmée. Aucun compte SQL de migration n’est requis ; les 31 migrations restent identiques. Ne rejouer aucune ancienne migration ou préparation 1.2.0.
