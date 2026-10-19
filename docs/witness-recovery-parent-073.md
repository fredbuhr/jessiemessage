# Parent explicite de récupération — 0.73.0 (C3)

Ce mode permet de raccorder le vrai CLI de récupération au PC existant après un redémarrage avec des reçus locaux non vides ou perdus. Il exige toujours les configurations privées, la racine physique source, le contrat original épinglé, le raccordement actif et la permission authentifiée `spent / 2`. Une perte de ces autorités ne crée aucun état de remplacement.

Le parent ne démarre aucun enfant applicatif, producteur, capture, moniteur, mail ou tick d'observation. Il expose seulement les deux routes PC existantes `witness/poll` et `witness/response`, avec leurs contrôles d'origine et de capacité native. Toute autre route, dont `/api/health` et `/api/ready`, répond 503. Le contrôle Unix est celui de C2, lecture seule, sans publication de registre. Le CLI conserve son propre défi neuf et authentifie la réponse originale.

## Commandes opérateur

Depuis un checkout propre de la source relue, avec ses empreintes réelles :

```sh
env -u NODE_OPTIONS -u NODE_PATH JESSIEMESSAGE_PRIVATE_PATH_MODE=linux-dirfd PORT=3000 \
node scripts/start-recurring-private-messaging.mjs check-witness-recovery \
  --runtime-directory /chemin/checkout-relu \
  --runtime-head <commit-relu> \
  --runtime-tree <arbre-relu> \
  --private-directory /chemin/configurations-privees \
  --operations-directory /chemin/exploitation-originale \
  --private-path-mode linux-dirfd \
  --witness-operator-directory /chemin/autorite-originale \
  --witness-contract-sha256 <empreinte-originale-verifiee>
```

`check-witness-recovery` est en lecture seule : aucun listener, aucun échange PC et aucune réussite fraîche annoncée (`started:false`, `externalWitnessConfirmed:false`). Pour ouvrir le parent, utiliser exactement les mêmes paramètres avec `start-witness-recovery`, seulement après arrêt contrôlé des producteurs dans la procédure de récupération retenue. Ne pas démarrer cette commande à côté du service réel comme second parent.

Le port public est réservé avant la socket privée ; une collision refuse sans déplacer ni arrêter le service existant. Le rapport `mode:recovery_only`, `status:started` n'est émis qu'après ouverture HTTP et Unix. Il ne promet aucune présence du PC. SIGTERM/SIGINT ferment HTTP, attente PC et contrôle Unix ; aucun enfant n'est repris.

Le PC conserve sa configuration et répond par le canal habituel. Exécuter alors le [CLI C2](witness-recovery-072.md) `check`, puis `restore` avec le plan confirmé. L'absence du PC, un rejeu, une autorité modifiée ou une annulation ne valent jamais réussite. Une copie réussie reste en quarantaine, avec `reconciliationRequired:true`, `sqlRestored:false`, `started:false`.

## Frontières conservées

Le démarrage normal de l'observateur, l'initialisation et la réservation restent limités au registre initial vide. Ce mode n'assouplit aucune de ces préconditions et ne fournit aucune route d'enrôlement. La réservation exclusivement IPC du dossier `control` et son contrat de nettoyage C2 restent applicables ; une collision préexistante ne doit pas être supprimée pour forcer l'ouverture.

C3 ne restaure pas le SQL et ne vérifie pas l'absence effective des comptes dans la cible. Qualification SQL, import réellement isolé et réconciliation finale restent à réaliser ensemble au lot D, avant activation des fermetures. La perte totale de l'hébergement ou de l'identité physique source reste hors de ce parcours. `recette.jessiemessage.com` partage le runtime et la base principale ; ce n'est pas une cible isolée.

Le service courant reste **0.72.0 en observation**, fermetures désactivées. Aucune bascule vers le parent de récupération pour développer ou valider C3.
