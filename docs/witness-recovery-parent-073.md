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

## Livraison C3

[PR #95](https://github.com/fredbuhr/jessiemessage/pull/95) fusionnée : source `fed209f3cc256afd83de139a19f8a3b92a301a5c`, arbre `6a59673806e27231c47b9aa7bcdc374ab54717ec`, merge `cf2b9f3843643a627d933217453a484013024fb9`, arbre identique. Les cinq jobs [candidat](https://github.com/fredbuhr/jessiemessage/actions/runs/39300959900) et les cinq jobs [main](https://github.com/fredbuhr/jessiemessage/actions/runs/39302243763) ont réussi, avec le même arbre et les mêmes comptes (Chrome 157/157, authentification HTTPS 1/1).

Sur chaque MariaDB (10.11 et 11.4 : 410/410 sans omission), les cas journal non vide puis perdu lancent chacun un vrai nouveau parent et le vrai CLI avec ses lecteurs par défaut. Cinq défis distincts par cas, reçu terminé plus récent conservé octet pour octet, quarantaine bloquée, SQL source/autorité/appariement inchangés, aucun enfant ou producteur. Provenance copiée, rejeu et PC absent suivi d’annulation refusent la réussite ; arrêt propre. Tests généraux : 2 868 réussis, aucun échec, 30 wrappers SQL ignorés dans ce job ; syntaxe 533 sources, Chrome et authentification HTTPS réussis. [Preuves](verification-proofs/jm073-verification.json).

Le défaut initial du harness de répétition concernait son nettoyage : le callback relisait l’observateur après remise à `null`. Il conserve désormais l’instance d’origine. Les délais des sous-processus et de la CI sont bornés et les diagnostics SQL en TAP restent visibles sans attendre la sortie globale. Aucun run annulé n’est compté comme réussite native.

Ce lot est fusionné en code, **non déployé et non activé** ; la santé et la disponibilité de la 0.72.0 ont été relues en HTTPS 200 à 18:23:14 UTC. Le prochain lot D qualifie l’inventaire SQL puis importe sur une cible réellement isolée pour éprouver la réconciliation finale ; aucune restauration SQL réelle effectuée dans C3.
