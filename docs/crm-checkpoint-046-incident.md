# JessieMessage — diagnostic et reprise du checkpoint CRM 0.46

**Incident clos à 00:13:21 Europe/Paris le 18 octobre 2026 :** le propriétaire fournit le reçu réel `application_checkpoint_restored_verified`. La reprise unique a importé la copie vide puis vérifié les trente tables/migrations, le snapshot applicatif et les fichiers, avec source non modifiée. L’accès de maintenance fonctionne pour cette opération ; aucune cause antérieure non observée n’est déduite. Coffre et copie PC déjà acceptés. L’[activation CRM 0.47](crm-activation-047.md) prend désormais le relais.

## Diagnostic physique

La capture personnelle de **23:32:28 le 17 octobre** contient `APPLICATION_CHECKPOINT_IMPORT_OPERATION`. Ce code général ne situe pas le premier échec : connexion, import ou vérification finale. Les captures de **23:41:52** et **23:50:13** contiennent `PRIVATE_CHECKPOINT_VERIFY_AUTHENTICATION`, catégorie fermée du refus SQL natif 1045, avant comparaison des données. Les pièces jointes sont lisibles localement malgré leur message initial d’accès impossible. Les caractères visibles dans un champ masqué ou retouché ne sont pas considérés comme le secret réellement utilisé.

Les trois droits **Lecture / Écriture / Administration** de `fb4hmr_jm_mig` sur `fb4hmr_jm_crm30_20261017` sont enregistrés et observés. Le Manager affiche 0 octet, ce qui ne prouve pas le vide SQL. Les autres droits sont conservés ; aucun compte n’est recréé.

À **23:54:01.168452 le 17 octobre**, une sonde séparée utilise la configuration ancrée et son compte runtime distinct `fb4hmr_jm_app`, sans afficher les valeurs privées :

- Hôte, port et adresse résolue correspondent au Manager ; base source et identité runtime correspondent également.
- `SELECT 1` réussit par le pilote Node sous TLS strict.
- `SELECT 1` réussit par le client MariaDB natif sous TLS strict, avec le formateur de fichier d’options de l’exportateur. Aucun export de données SQL.
- Le parseur natif `my_print_defaults`, appelé par le même formateur, restitue exactement **9 mots de passe synthétiques sur 9** : espaces, guillemets, barres obliques inverses, caractères spéciaux, accents et emoji. Les fichiers temporaires propriétaires `0600` sont nettoyés par le helper existant.
- Aucune mutation de la source ou du clone, aucun import, aucune collecte du mot de passe de maintenance.

Cela écarte un défaut général du point de connexion, de TLS ou de l’échappement dans ce chemin testé. Cela ne prouve ni le mot de passe personnel ni la cause exacte d’un refus propre à l’identité de maintenance. Références primaires du parseur : [fichiers d’options MariaDB](https://mariadb.com/docs/server/server-management/install-and-upgrade-mariadb/configuring-mariadb/configuring-mariadb-with-option-files), [my_print_defaults](https://mariadb.com/docs/server/clients-and-utilities/administrative-tools/my_print_defaults).

## Reprise en une saisie

Source **`edf696ec4874563aeaaa84b8986f18d146757c53`**, arbre **`3daa88c3b180fe1494245ea390807f800f783ae1`** : [coordinateur fermé](../scripts/resume-application-checkpoint.mjs), [wrapper masqué](../scripts/capture-application-checkpoint-resume.sh), [18 tests](../tests/resume-application-checkpoint.test.mjs). Les importateur et vérificateur existants conservent leurs contrôles.

Le précontrôle valide checkpoint, clés, hash SQL brut, client natif et format SQL avant la saisie. Le secret est lu une fois, masqué, transmis par entrée standard. Une connexion TLS de maintenance inspecte uniquement l’identité du clone, TLS et les métadonnées des tables.

| État SQL observé | Action | Reçu attendu |
| --- | --- | --- |
| Aucune table | Import natif, puis vérification complète SQL/snapshot/photos | `application_checkpoint_restored_verified`, `action: "imported_empty_clone"`, `importedThisRun: true` |
| Trente tables applicatives attendues, InnoDB | Vérification complète en lecture seule ; aucun import | `application_checkpoint_existing_clone_verified`, `action: "verified_existing_clone"`, `importedThisRun: false` |
| Copie partielle, autre table, vue ou autre moteur | Refus conservant la copie | `APPLICATION_CHECKPOINT_RESUME_PARTIAL_CLONE`, `phase: "inspection"` |

Les erreurs portent une catégorie fermée et une phase explicite, par exemple `APPLICATION_CHECKPOINT_RESUME_AUTHENTICATION`, `phase: "connection"`. Aucun message brut du pilote. Profil, versions, hash et champs de succès sont contrôlés avant émission du reçu. Base source et compte runtime sont refusés comme cibles. Aucun HTTP, SMTP, worker, migration, effacement ou réassociation du stockage. Couverture limitée aux trente tables applicatives et photos ; objets SQL exécutables exclus/non prouvés.

## Validation et installation

- Suite ciblée **65/65**, dont les 18 nouveaux scénarios ; syntaxe conforme.
- Suite générale locale : **2 285 cas, 2 130 réussites, 155 intégrations ignorées, aucun échec**.
- [Cinq jobs CI de la source exacte](https://github.com/fredbuhr/jessiemessage/actions/runs/39073403629) réussis : **2 258 réussites générales, 27 wrappers SQL ignorés**, build/aperçu conformes ; **379/379** sur MariaDB 10.11 et 11.4 chacun ; **101/101** Chrome ; **1/1** authentification HTTPS/MariaDB. Workflow PR `39073406805` également réussi.
- Checkout séparé **`/srv/customer/jessiemessage-operator/crm-checkpoint-resume-edf696ec`** prêt le **18 octobre à 00:04:58.242673** : source/arbre épinglés, Git propre, dépendances verrouillées sans scripts, syntaxe conforme sous Node 24.15.0. Runtime actif conservé.

Lanceur **`/srv/customer/jessiemessage-private/resume-primary-crm-046.sh`** créé exclusivement et relu : propriétaire `0700`, **1 114 octets**, SHA-256 **`47ce94b29e4c0ebb136d07f3094de8b707e7477e040978109fdc42298d423bc6`**. Il épingle source/arbre/propreté, checkpoint, clone, compte de maintenance, profil CRM et hash SQL brut correct.

Sa syntaxe et son mode `check` passent à **00:05:20.413110 le 18 octobre** : `application_restore_precheck_passed`, reçu v6, trente tables/migrations, profil applicatif CRM, `resumeSupported: true`, fichiers/hash/client natif/format conformes, `databaseConnected: false`, `imported: false`. Aucun mot de passe utilisé pour ce contrôle ; aucun mode reprise exécuté par l’agent.

Les anciens lanceurs d’import et d’inspection restent historiques. Le coffre et la copie PC acceptés dans le [relevé du checkpoint](crm-checkpoint-046.md) ne sont pas à refaire.

## Clôture personnelle

La capture reçue à 00:13:21 confirme `action: "imported_empty_clone"`, `importedThisRun: true`, `applicationSnapshotMatched: true`, `checkpointFilesMatched: true`, `sourceMutated: false` et `capacityRebound: false`. La commande de reprise a abouti ; aucune nouvelle saisie, inspection ou modification de mot de passe n’est demandée. Le [relevé d’activation](crm-activation-047.md) conserve les champs du reçu et la suite hébergée.
