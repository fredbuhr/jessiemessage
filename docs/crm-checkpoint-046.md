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

La configuration source est `/srv/customer/jessiemessage-private/primary-origin-candidate-4a355851`. Le checkpoint courant est **`/srv/customer/jessiemessage-private/checkpoint-primary-crm-046`**. Le profil SQL/photos est `photos-notify-recovery-crm-application` : manifeste v8, reçu v6, six clés authentifiées et couverture limitée aux trente tables applicatives. Les objets SQL exécutables restent exclus/non prouvés.

Les contrôles hébergés suivants passent le 17 octobre :

- **22:50:02.433706** : préflight CRM complet, droits SQL, schémas et stockage, `started: false`.
- **22:50:02.555337** : `application_precheck_passed`, destination absente, `databaseConnected: false` et `checkpointSaved: false`.
- **22:50:02.729271** : `application_inspection_verified`, trente tables et migrations avec l’identité runtime, aucune capture ni migration.
- Le Manager affiche Node.js 24 actif, port 3000, le Run 0.42 `start-primary-operations-checked-ed78b55e.sh` et son Build épinglé inchangés. Le planificateur indique aucune tâche configurée. Le lanceur 0.42 est relu et son empreinte `343a71c5976c2a27f0061bb6419115a3e2d5ac8c8ed6b8f924add3a765a9cc86` concorde.

## Capture hors activité et reprise de 0.42

Le lanceur privé **`/srv/customer/jessiemessage-private/capture-primary-crm-046.sh`** est créé exclusivement et relu à **22:53:20.599360**, mode `0700`, **741 octets**, SHA-256 **`029033eb1bed7182e11c8e2da350bb061668fbb7be2e881f495dae3eea01182c`**. Sa syntaxe Bash passe. Il exige l’argument `--offline-confirmed`, épingle source, arbre et suivi Git propre, puis appelle le seul outil de capture applicative avec le profil CRM et la destination ci-dessus. Il n’arrête ni ne relance un service lui-même.

Le premier arrêt est refusé par le contrôle automatique faute d’autorisation explicite pour l’interruption ; aucun autre moyen d’arrêt n’est tenté. À **23:01:17 Europe/Paris**, le propriétaire autorise explicitement la courte pause proposée et la poursuite des opérations. Le même arrêt est alors effectué normalement dans le Manager, qui confirme **Node.js Arrêté**. Le Run et le Build ne sont pas modifiés.

Le lanceur capture le checkpoint entre **23:04:17.389446** et **23:04:20.229947**, avec `application_checkpoint_saved`, trente tables/migrations, archive listée et contenu vérifié. Les doubles exports et inventaires concordent. Quatre fichiers photo chiffrés sont copiés ; aucune extraction d’archive, migration ou activation n’est effectuée. La reprise du même Run 0.42 est lancée immédiatement après lecture du résultat ; le Manager confirme **Node.js Actif**, le profil `messaging-photos-notify-recovery`, le déploiement `primary-transition` et le listener 3000.

À **23:06:14.062306**, les **38/38 contrôles HTTPS** des deux origines et **seize comparaisons d’empreintes exactes** réussissent avec TLS normal et sans session connectée. Ils confirment la source 0.42 `ed78b55e99480ce07967b4c54c7e2de13e46951e`, arbre `5bdb9e75989ca30ad800053ed783dd6ed3edfd70`. Les ressources privées sont refusées, les configurations restent inaccessibles et les fiches sont désactivées. Aucun compte, mot de passe, e-mail ou Push réel n’est exercé par ces sondes.

## Empreintes du checkpoint courant

Le reçu privé est relu par le lecteur ancré à **23:06:51.627683**. Le fichier SQL compressé est relu, décompressé de façon bornée, son empreinte brute comparée et son format applicatif validé, sans imprimer de donnée SQL. Les empreintes SQL et archive sont de nouveau comparées littéralement avant création du lanceur de restauration corrigé à 23:12.

| Élément | Taille / preuve |
| --- | --- |
| `checkpoint.tar.gz` | 401 920 octets |
| SHA-256 archive | `d9444937c4f920f976ed8e5b4efacc487457aa5f94267eb735fc9b2b420ab8a9` |
| `database.sql.gz` | 17 286 octets |
| SHA-256 SQL compressé | `d9b5ab2941a0524a44930a018e18fe0ad0a5ac2d7ac34c0fbbe6501fc2b16ac5` |
| SQL décompressé | 80 250 octets |
| SHA-256 SQL brut | `95a8b201a7aeaa7317578c5e2f35468246b7976add2f776f5607499a959453dd` |
| Photos chiffrées | 4 fichiers, 380 528 octets |
| Portée | 30 tables applicatives / 30 migrations ; objets SQL exécutables exclus/non prouvés |

Le reçu de capture conserve `independentCopyPending: true`, `sqlRestorePending: true`, `capacityRebound: false`, `started: false` et `migrationPerformed: false`. Il ne constitue pas une preuve de restauration.

## Base et lanceur de restauration préparés

La nouvelle base **`fb4hmr_jm_crm30_20261017`** est créée dans le Manager. L’inventaire affiche six bases, la nouvelle à **0 octet**, sans utilisateur ni site lié. Les anciennes copies et la base source sont conservées. Aucun droit SQL n’est ajouté à ce stade. L’inspection SQL du vide réel et de TLS reste obligatoire au moment de l’import avec l’identité de maintenance `fb4hmr_jm_mig` ; l’indication 0 octet du Manager ne remplace pas ce contrôle.

Le premier lanceur `restore-primary-crm-046.sh` contient une erreur de recopie du hash brut. Son précontrôle échoue avec `APPLICATION_CHECKPOINT_IMPORT_CHECKPOINT`, avant toute connexion SQL ou import. Il reste conservé et **ne doit pas être utilisé**. Les quatre blocs de seize caractères du hash original sont relus ; le lanceur corrigé est créé exclusivement sous un nouveau nom.

Le seul lanceur à utiliser est **`/srv/customer/jessiemessage-private/restore-primary-crm-046-verified.sh`**, propriétaire `0700`, **1 116 octets**, SHA-256 **`c3110164724e87309e0928aa5b76934209e52645c2e145a29f5c0cdb672424ae`**. Il épingle source/arbre/propreté `8f4162a4`, la nouvelle base et sa confirmation, le profil CRM, l’utilisateur de maintenance existant et l’empreinte SQL brute correcte. Sans argument, il utilise le wrapper interactif existant qui lit le mot de passe SQL une fois, de façon masquée, et le transmet par entrée standard. Aucun secret n’est ajouté au fichier, à la ligne de commande ou au dépôt.

Sa syntaxe Bash et son mode `check` passent à **23:12:14.903783** :

- `application_restore_precheck_passed`, reçu v6, profil applicatif CRM, trente tables et migrations ;
- `checkpointFilesMatched: true`, `independentMediaDirectory: true`, `trustedSqlSha256Matched: true` ;
- `nativeImportClientVerified: true`, `sqlImportFormatVerified: true` ;
- `databaseConnected: false`, `imported: false`, `httpStarted: false`, `smtpStarted: false`, `workersStarted: false`, `capacityRebound: false`.

Cette préparation ne restaure rien et ne démarre aucun serveur. Le mode précontrôle peut être relu sans secret :

```bash
bash /srv/customer/jessiemessage-private/restore-primary-crm-046-verified.sh check
```

## Prochaine action personnelle : copie hors serveur

Dans PowerShell sur le PC, le bloc suivant copie uniquement la nouvelle archive dans Téléchargements et compare son empreinte attendue. Il réutilise une copie déjà présente sans l’écraser, puis vérifie aussi son empreinte. Le mot de passe éventuellement demandé est celui du compte SSH/SFTP existant ; il est saisi personnellement, jamais dans la conversation.

```powershell
& {
$jmCopie = Join-Path $env:USERPROFILE 'Downloads\JessieMessage-checkpoint-crm-20261017.tar.gz'
if (-not (Test-Path -LiteralPath $jmCopie)) {
    scp 'QxrM8Gh3hsN_jessiebk@57-118579.ssh.hosting-ik.com:/srv/customer/jessiemessage-private/checkpoint-primary-crm-046/checkpoint.tar.gz' $jmCopie
    if ($LASTEXITCODE -ne 0) { throw 'Copie interrompue : transmettre le message affiché.' }
}
if ((Get-FileHash -LiteralPath $jmCopie -Algorithm SHA256 -ErrorAction Stop).Hash.ToLowerInvariant() -ne 'd9444937c4f920f976ed8e5b4efacc487457aa5f94267eb735fc9b2b420ab8a9') {
    throw 'Empreinte différente : conserver le fichier et transmettre ce message.'
}
'COPIE_CRM30_OK'
}
```

Après réception de ce résultat, restent l’accès de la seule identité de maintenance à cette nouvelle base, la saisie personnelle masquée du mot de passe SQL et l’import natif vérifié. Le résultat final devra confirmer `application_checkpoint_restored_verified`, `imported: true`, `applicationSnapshotMatched: true`, `checkpointFilesMatched: true`, `sourceMutated: false` et `capacityRebound: false`. Ces résultats ne sont pas encore acquis. Les fiches restent désactivées jusqu’à ces validations et à leur activation distincte ; les diffusions restent séparées.
