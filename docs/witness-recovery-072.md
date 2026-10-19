# Récupération attestée — 0.72.0 (C2)

Le CLI utilise le canal PC déjà raccordé du parent, via une socket Unix sous `<witness-operator-directory>/control`, dossier 0700 et socket 0600. Aucun nouvel accès HTTP public, nouvel appariement, clé ou publication de registre n'est ajouté. Le relais accepte uniquement une lecture ; le CLI crée son propre défi et authentifie les enveloppes originales avec `createErasureContinuity.recover()`.

La tête distante doit contenir tous les reçus du journal local et de la sauvegarde, sans recul. Une perte des fichiers de journaux locaux n'efface donc pas les reçus récents du PC. La préparation privacy est comparée séparément. Les octets et le rattachement source des enveloppes restent intacts.

## Précontrôle et copie en quarantaine

Les configurations et répertoires source doivent être encore accessibles. Le parent d'observation doit être démarré avec son contrôle privé disponible, et le PC doit pouvoir répondre au nouveau défi. Exemple opérateur, avec chemins explicitement sélectionnés :

```sh
env -u NODE_OPTIONS -u NODE_PATH JESSIEMESSAGE_PRIVATE_PATH_MODE=linux-dirfd \
node scripts/restore-private-operations.mjs check \
  --private-directory /chemin/configurations-privees \
  --operations-directory /chemin/exploitation-courante \
  --checkpoint-directory /chemin/capture-selectionnee \
  --destination-private-directory /chemin/quarantaine-absente \
  --database base_clone_isolee \
  --media-root /chemin/photos-clone-isole \
  --witness-operator-directory /chemin/autorite-originale \
  --witness-contract-sha256 <empreinte-originale-verifiee>
```

Le résultat fournit `planSha256`. Pour copier, reprendre exactement les paramètres, remplacer `check` par `restore` et ajouter `--confirm-plan-sha256 <planSha256>`. L'ancien `--confirm-current-sha256` est refusé : la confirmation doit couvrir capsule, source, cible, destinations, état local et tête distante.

Chaque frontière de publication redemande une lecture avec un défi neuf. Une dérive ou un refus invalide le résultat ; après début de copie, le marqueur `operational-restore.json` reste bloquant. Aucun fichier de destination existant n'est écrasé ou supprimé.

Le succès signifie `externalRegistryContinuityVerified:true`, mais conserve `reconciliationRequired:true`, `sqlRestored:false`, `started:false`. Il atteste la lecture indépendante et la sélection des reçus ; il ne certifie ni l'import SQL, ni l'absence effective des comptes dans la cible, ni la réouverture de celle-ci.

## Portée de cette sous-étape

L'observateur de production reste limité au registre local initial vide à sa construction et à son démarrage. Le relais peut lire une tête PC plus récente pendant cette instance, sans dépendre du journal local pour son échange. Un redémarrage avec registre local non vide n'est pas encore une composition de récupération générale : ce cas exige une voie explicite de récupération en quarantaine, sans producteur, à terminer dans C. Ne pas desserrer le démarrage normal pour contourner ce préalable.

C2 ne lève jamais la quarantaine, n'importe aucun SQL et n'active aucun propriétaire de fermeture. La perte totale de l'hébergement et le remplacement de l'identité physique source restent hors de ce parcours. `recette.jessiemessage.com` partage le runtime et la base principale ; ce n'est pas une cible isolée.

Le sous-dossier `control` est réservé exclusivement au transport temporaire : aucune clé, sauvegarde ou donnée métier ne doit y être placée. Une collision préexistante au nom `witness-recovery.sock` refuse le démarrage du contrôle sans suppression. Après écoute, ce nom appartient au listener Node : sa fermeture le supprime, y compris si un autre processus du même UID a violé cette réservation en le remplaçant. Les dérives d'inode, de type ou de permissions invalident les échanges. La racine 0700 et la socket 0600 excluent les autres UID ; le même UID est déjà propriétaire des clés et des configurations. Les chemins natifs et ce contrat doivent être vérifiés en Linux CI avant fusion et déploiement.
