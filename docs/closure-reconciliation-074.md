# Plan de réconciliation source → cible — 0.74.0

## Résultat et portée

Le CLI `scripts/plan-closure-reconciliation.mjs check` produit l’empreinte d’un **plan en lecture seule** pour une quarantaine existante. Il lie la capture authentifiée, les reçus source originaux, le journal local, deux réponses PC fraîches, le marqueur exact, les chemins opérateur et l’identité physique de la cible distincte.

Le plan ne connecte pas la base cible et n’effectue aucun SQL, effacement, rebind, transfert d’autorité ou démarrage. Sa sortie conserve `reconciliationRequired:true`, `sqlMutationAuthorized:false`, `targetSqlInspected:false`, `targetAbsenceVerified:false`, `targetMutated:false`, `quarantineRetained:true`, `started:false`. **Un plan réussi ne clôt ni C ni D et ne permet pas d’effacer le marqueur.**

Le service réel reste 0.72.0 en observation, fermetures désactivées. L’essai D1 est acquis : ne pas réimporter sa base ou refaire les actions personnelles Windows/GPG.

## Contrat du contrôle

1. Charger les six configurations existantes par le lecteur strict, sans secret ambiant ; vérifier base et stockage cible réellement distincts de la source.
2. Authentifier capsule et reçu de capture. Lire le journal local source et la quarantaine complète avec les permissions, liens, tailles et identités de fichiers contrôlés. Le marqueur v1 est canonique et relu ; son empreinte d’état doit correspondre à toutes les enveloppes effectivement présentes. Une copie interrompue est refusée.
3. Acquérir une réponse authentifiée sur un nouveau défi par le client Unix, le parent courant et le PC existant. Le registre PC doit contenir tous les reçus de la capture, de la quarantaine **et du journal local**, sans perte, régression ni conflit. Les reçus plus récents sont conservés avec leurs octets et leur binding source originaux.
4. Inscrire chaque reçu, terminé ou encore en cours, comme exigence `replay_from_start`. Le curseur et la phase source décrivent la source ; ils ne décrivent pas les données réintroduites par la sauvegarde cible. Le plan privé conserve les enveloppes, leurs références opaques, phases/révisions et empreintes, jamais une progression d’effacement cible inventée.
5. Relire toutes les ressources et obtenir une seconde réponse sur un autre défi. Tête, révision et inventaire PC doivent rester identiques. Toute dérive ou annulation invalide le résultat.

L’empreinte couvre aussi le contrat de témoin choisi et tous les chemins du CLI. Deux contrôles d’un même état ont la même empreinte, mais exigent chacun de nouveaux défis. Après redémarrage, un ancien succès ne remplace aucune lecture fraîche. Le marqueur est un des éléments contrôlés ; son JSON non signé n’est pas une capacité d’administration.

## Interface opérateur

Seule la commande `check` existe, avec ces huit paramètres obligatoires :

```text
--private-directory <configuration-source>
--operations-directory <journal-source>
--checkpoint-directory <capture-existante>
--quarantine-private-directory <quarantaine-existante>
--database <base-cible-distincte>
--media-root <stockage-cible-distinct>
--witness-operator-directory <autorité-originale>
--witness-contract-sha256 <empreinte-originale>
```

L’environnement natif conserve `JESSIEMESSAGE_PRIVATE_PATH_MODE=linux-dirfd`. Aucun mode `apply`, `restore`, `--offline`, confirmation d’écriture ou booléen de fraîcheur n’est accepté. La sortie JSON ne contient que le résumé, les empreintes et les comptes de reçus. Le plan détaillé avec enveloppes reste en mémoire et n’est ni écrit sur disque ni envoyé dans stdout ; aucune identité cliente n’est exportée. Les erreurs CLI restent neutres.

## Protocole d’exécution restant à implémenter

Le contrôle prépare la réconciliation ; son exécution devra rester distincte du moteur normal `createAccountErasure`, qui refuse volontairement un compte restauré face à un reçu déjà terminé.

- **Qualification SQL :** inventaire privilégié exact de la cible et schéma applicatif attendu. Le profil réel D1 `shared_admin / raw_underscore_pattern` reste non qualifié ; le plan ne transforme pas cette limite en réussite SQL.
- **Travail cible :** exclusion réelle des producteurs/captures, vérification de l’import et transition explicite du binding de capacité. La capacité D1 reste liée à la source. Journal de progression cible distinct, lié au plan et aux reçus source immuables ; reprise depuis le début pour chaque identité concernée, y compris les intentions inachevées. Vérifier l’absence effective du graphe et des fichiers sans toucher aux pairs.
- **Transfert d’autorité :** le registre du témoin dépend de la base et de la racine. Une bascule finale exigera une succession durable sur le PC existant, liant tête source → cible, avec exclusion de l’ancien propriétaire. Ne pas créer une nouvelle genèse, réapparier le PC, réécrire les reçus ou copier simplement un succès JSON. La première ouverture cible devra acquérir sa propre preuve fraîche.

Le marqueur de quarantaine reste bloquant pendant ces phases et après toute interruption incertaine. Ni un inventaire vide ni zéro reçu ne constituent une autorisation de réouverture.

## Vérification

Les tests ciblés couvrent marqueurs incomplets/corrompus, fichiers dangereux, nouvelles fermetures après capture, journal perdu, curseur source élevé, absence/régression/rejeu du PC, faux gate, annulation, dérive de capsule/racine/marqueur et nouveaux défis après redémarrage.

Le parcours natif est intégré à `tests/witness-runtime.integration.test.mjs` sur MariaDB 10.11 et 11.4 : nouveau processus CLI → vrai contrôle Unix → vrai parent de récupération → boîte HTTP du PC synthétique → témoin durable, avec journal source non vide puis perdu. Deux défis supplémentaires par cas ; SQL source, autorité, appariement, enveloppes et marqueur restent inchangés. Le garde refuse toujours le démarrage. Le PC de ces essais est synthétique ; la présence de comptes terminés dans ce registre ne prouve pas leur absence dans SQL, explicitement hors portée.

Les résultats datés, commits et CI sont consignés dans les [preuves 0.74](verification-proofs/jm074-verification.json) et l’[état courant](REPRISE.md).
