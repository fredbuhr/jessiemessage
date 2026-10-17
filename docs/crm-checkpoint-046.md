# JessieMessage — coffre validé et checkpoint courant, étape 0.46

## Coffre de configuration accepté

Le propriétaire fournit le reçu de création du coffre primaire à six fichiers, puis la capture PowerShell du SHA-256 de sa copie PC à **22:44 Europe/Paris le 17 octobre 2026**. Il confirme **`COFFRE_DECHIFFRE_OK` à 22:48:05** après le contrôle local GPG qui masque la sortie déchiffrée. La copie personnelle, son empreinte et son déchiffrement sont donc acceptés. La phrase et le contenu privé restent hors de la conversation et du dépôt.

| Élément | Valeur vérifiée |
| --- | --- |
| Profil / format du coffre | `primary-crm`, secrets v5, six fichiers |
| Fichier | `jessiemessage-primary-crm-045.json.gpg` |
| Taille chiffrée | 2 681 octets |
| SHA-256 | `a5267ef914e4f21945e3b477f9d1bb56d1d0fa0344fc3db05aebd7a6e17c21d4` |
| Copie personnelle | Répertoire Téléchargements du PC, empreinte concordante |
| Déchiffrement personnel | Reçu `COFFRE_DECHIFFRE_OK` |

À **22:50:01.064499**, le fichier chiffré du serveur est relu sans déchiffrement : propriétaire courant, mode `0600`, fichier régulier à lien unique, taille et empreinte concordantes. Cette lecture ne collecte aucune valeur de configuration. Les anciens coffres, notamment celui de l’enrôlement administrateur, restent conservés.

## Précontrôles du checkpoint

La source opérateur reste **`8f4162a4468b1e1548e1276f2d6e2a8033bbb213`**, arbre **`c6f17aaffba71c16e4e8ecd3e3b4c80abbe9bd3f`**, checkout propre `/srv/customer/jessiemessage-operator/crm-runtime-backup-8f4162a4`. Ses cinq jobs exacts réussis et la répétition MariaDB à 379 cas sont décrits dans la [validation du profil CRM](crm-runtime-backup.md).

La configuration source est `/srv/customer/jessiemessage-private/primary-origin-candidate-4a355851`. La destination neuve prévue est **`/srv/customer/jessiemessage-private/checkpoint-primary-crm-046`**. Le profil SQL/photos est `photos-notify-recovery-crm-application` : manifeste v8, reçu v6, six clés authentifiées et couverture limitée aux trente tables applicatives. Les objets SQL exécutables restent exclus/non prouvés.

Les contrôles hébergés suivants passent le 17 octobre :

- **22:50:02.433706** : préflight CRM complet, droits SQL, schémas et stockage, `started: false`.
- **22:50:02.555337** : `application_precheck_passed`, destination absente, `databaseConnected: false` et `checkpointSaved: false`.
- **22:50:02.729271** : `application_inspection_verified`, trente tables et migrations avec l’identité runtime, aucune capture ni migration.
- Le Manager affiche Node.js 24 actif, port 3000, le Run 0.42 `start-primary-operations-checked-ed78b55e.sh` et son Build épinglé inchangés. Le planificateur indique aucune tâche configurée. Le lanceur 0.42 est relu et son empreinte `343a71c5976c2a27f0061bb6419115a3e2d5ac8c8ed6b8f924add3a765a9cc86` concorde.

## Capture préparée, attente de pause autorisée

Le lanceur privé **`/srv/customer/jessiemessage-private/capture-primary-crm-046.sh`** est créé exclusivement et relu à **22:53:20.599360**, mode `0700`, **741 octets**, SHA-256 **`029033eb1bed7182e11c8e2da350bb061668fbb7be2e881f495dae3eea01182c`**. Sa syntaxe Bash passe. Il exige l’argument `--offline-confirmed`, épingle source, arbre et suivi Git propre, puis appelle le seul outil de capture applicative avec le profil CRM et la destination ci-dessus. Il n’arrête ni ne relance un service lui-même.

**Le contrôle automatique d’approbation refuse l’arrêt temporaire du service Node.js actif, faute d’autorisation explicite pour cette interruption.** L’arrêt n’est pas effectué et aucun autre moyen d’arrêt n’est tenté. Le Manager conserve son état actif. Le lanceur de capture reste inexécuté ; aucun nouveau checkpoint, archive SQL/photos ou clone restauré n’est annoncé.

Après l’accord ponctuel pour la pause : confirmer l’état arrêté dans le Manager, effectuer la capture bornée, puis remettre immédiatement le même Run 0.42 en service et contrôler santé/disponibilité. En cas d’échec de capture, conserver les artefacts et reprendre le service avant diagnostic. Une destination partiellement remplie ne sera pas réutilisée.

La pause concerne les deux origines du même service. Elle est prévue pour environ une minute, sans bascule de code ou de schéma. Le paramètre `--offline` est réservé à une absence réelle de producteurs d’écriture ; aucun essai de capture en ligne n’est effectué.

Après capture réussie, les étapes restantes sont la copie personnelle de l’archive et son empreinte, la création d’une nouvelle base isolée vide, puis l’import natif et la vérification avec le profil CRM et l’empreinte SQL figée. L’identité de maintenance existante et sa saisie personnelle seront utilisées ; aucun nouveau droit n’est accordé à ce stade. Le résultat final devra confirmer `application_checkpoint_restored_verified`, `applicationSnapshotMatched: true`, `checkpointFilesMatched: true` et `sourceMutated: false`. Les fiches restent désactivées jusqu’à ces validations et à l’activation distincte.
