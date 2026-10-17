# JessieMessage — diagnostic de la restauration CRM 0.46

**Résultat à 23:41:52 Europe/Paris :** la nouvelle capture personnelle contient **`PRIVATE_CHECKPOINT_VERIFY_AUTHENTICATION`**. Le vérificateur classe ainsi le refus SQL natif 1045 lors de l’export du clone. L’identification SQL est donc refusée pour cette inspection, avant toute comparaison de données ; les trois droits sont déjà enregistrés. Le propriétaire doit utiliser le mot de passe SQL correct de `fb4hmr_jm_mig`, ou le redéfinir personnellement s’il ne le possède plus, puis relancer une seule inspection en lecture seule. L’agent n’obtient ni ne modifie ce secret. La restauration reste non confirmée.

## Résultat transmis à 23:32 le 17 octobre 2026

La capture du propriétaire contient `APPLICATION_CHECKPOINT_IMPORT_OPERATION: Application checkpoint restoration was not confirmed.` Elle est lisible depuis la pièce jointe locale malgré le message initial de fichier inaccessible. Elle ne constitue pas un reçu de restauration réussie.

Le code de l’importateur remplace par `OPERATION` les exceptions internes qui ne sont pas déjà des `ApplicationCheckpointImportError`. Cela inclut notamment une erreur de connexion SQL ou une erreur du vérificateur final. La ligne transmise ne permet pas d’attribuer l’échec au mot de passe, à TLS, au réseau ou à une phase après import. Aucun nouvel import n’est relancé.

## Observations sans nouvelle saisie privée

- La page du compte `fb4hmr_jm_mig`, rechargée après la capture, confirme **Lecture / Écriture / Administration** cochées sur la seule nouvelle ligne `fb4hmr_jm_crm30_20261017`. Les autres lignes observées conservent leurs cases précédentes. L’agent ne modifie aucun droit ni mot de passe.
- Le Manager affiche le clone à **0 octet**. Cette indication ne prouve pas que le schéma est vide ; le contrôle SQL reste nécessaire avant tout autre import.
- Le service Node.js est **Actif**, avec son Run/Build 0.42 et le profil `messaging-photos-notify-recovery`. Aucun arrêt ni déploiement supplémentaire n’est effectué.
- Le coffre personnel et la copie PC de l’archive, acceptés dans le [relevé du checkpoint](crm-checkpoint-046.md), restent acquis.

## Inspection de la copie sans import préparée

Le nouveau lanceur **`/srv/customer/jessiemessage-private/inspect-restore-primary-crm-046.sh`** est créé exclusivement, relu et contrôlé : propriétaire `0700`, **1 741 octets**, SHA-256 **`5dc664ab99e755381efb9891586757199564cac1b4ee4f1536640afdaa342b18`**.

Il épingle toujours la source opérateur `8f4162a4468b1e1548e1276f2d6e2a8033bbb213`, l’arbre `c6f17aaffba71c16e4e8ecd3e3b4c80abbe9bd3f`, la propreté du checkout, le profil `photos-notify-recovery-crm`, le checkpoint courant et l’identité exacte du clone. Il compare les empreintes archive/SQL avant sa préparation et utilise les modules déjà validés de cette source.

Le mode `check` appelle uniquement le précontrôle existant de l’importateur, avec l’empreinte SQL brute correcte. La syntaxe Bash et ce précontrôle passent à **23:37:10.017950 Europe/Paris** : `application_restore_precheck_passed`, `checkpointFilesMatched: true`, `trustedSqlSha256Matched: true`, `nativeImportClientVerified: true`, `sqlImportFormatVerified: true`, `databaseConnected: false`, `imported: false`, aucun HTTP/SMTP/worker ni réassociation de stockage.

Sans argument, le lanceur lit personnellement le mot de passe SQL une fois avec `read -r -s`, puis le transmet par entrée standard au seul `verify-private-checkpoint.mjs verify-application`. Il reprend les protections du [wrapper de vérification existant](../scripts/capture-private-checkpoint-verification.sh), en conservant la sélection applicative CRM. Le secret n’est ni argument, ni variable d’environnement exportée, ni fichier permanent, ni sortie du terminal.

Le vérificateur compare l’export du clone au SQL figé, puis contrôle schéma, données authentifiées, médias et snapshot applicatif. Il ne crée ni ne remplace de table et ne démarre aucun runtime. Les codes fermés distinguent notamment `PRIVATE_CHECKPOINT_VERIFY_AUTHENTICATION`, `ACCESS`, `DATABASE`, `DUMP`, `DUMP_MISMATCH`, ou le reçu `verified`. Un code `DUMP` seul ne prouve pas une cause précise. L’inspection personnelle de 23:41 échoue à l’identification (`AUTHENTICATION`) ; ni le contenu ni le vide SQL du clone ne sont encore confirmés. Ce résultat ne permet pas de réattribuer avec certitude la phase du premier échec à un mot de passe précis.

## Prochaine action personnelle : identité SQL puis inspection

Le mot de passe à utiliser est celui de l’utilisateur **SQL `fb4hmr_jm_mig`**, défini dans la section Bases de données / Utilisateurs. S’il est connu, le propriétaire peut relancer l’inspection ci-dessous en l’utilisant. Si ce mot de passe n’est plus disponible, il ouvre [la fiche exacte de ce compte](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/databases/dashboard/users/edit/fb4hmr_jm_mig), clique **Modifier le mot de passe** et réalise personnellement sa définition et son enregistrement. Les droits sont déjà conformes. Aucune nouvelle clé de chiffrement ni configuration applicative n’est demandée.

Dans la [console SSH Node.js Infomaniak](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/ssh-terminal/Node.js/terminal), exécuter :

```bash
bash /srv/customer/jessiemessage-private/inspect-restore-primary-crm-046.sh
```

Saisir personnellement le mot de passe SQL correct du compte `fb4hmr_jm_mig`, puis transmettre le message d’erreur complet ou la dernière ligne JSON. Le secret reste hors de la conversation. Une répétition avec les mêmes identifiants refusés n’apporterait pas de nouvelle preuve. L’ancien lanceur d’import reste en attente tant que l’état de la copie n’est pas établi. Une copie partiellement remplie ne sera pas réutilisée pour un import ; aucun effacement n’est autorisé par cette inspection. Les fiches restent désactivées.
