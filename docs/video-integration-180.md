# Intégration vidéo G2 — développement 1.8.0

**État : G2 codé et qualifié sur branche, non livré.** Source `cecd60ced91d7eaf79025f06233833dad52ddef0`, arbre `a2d639166576d24aaa233f333a13f3959f5ddd53`, [CI 39721685571 réussie 5/5](https://github.com/fredbuhr/jessiemessage/actions/runs/39721685571) ; [preuve complète](verification-proofs/jm180-video-integration-verification.json). Ce document décrit le candidat sur branche ; il n’autorise aucune migration, activation ou commande sur le service hébergé. La production reste 1.7.1 / Node 24.22.1 / SQL33, selon [REPRISE](REPRISE.md). Le [plan courant](PLAN-IMPLEMENTATION.md) conserve G3 puis G4.

## Profils et configuration explicites

Le profil runtime est `photos-notify-recovery-crm-broadcast-video`. Les commandes `start-local-closures` et `check-local-closures` le sélectionnent explicitement avec `--profile`. Le profil de capture/import est le même ; son manifeste applicatif porte `messaging-photos-notify-recovery-crm-broadcast-video-application`. Le CLI de contrôle/récupération `scripts/backup.mjs` sélectionne `--profile photos-notify-recovery-crm-broadcast-video-application`.

Le candidat ajoute `runtime-video.json` aux six fichiers privés existants. C’est un fichier de configuration protégé, régulier **0600**, dans un dossier **0700**, pas une archive chiffrée supplémentaire. Les lecteurs de l’ancien bundle restent fermés à leurs six fichiers/champs ; `loadRuntimeVideoEnvironment` et `copyRuntimeVideoEnvironment` sélectionnent explicitement les sept configurations.

| Champ fermé de `runtime-video.json` | Contrat |
| --- | --- |
| `format` | `jessiemessage-runtime-video` |
| `version` | Nombre `1` |
| `origin` | Origine principale attendue par les autres configurations |
| `videoKey` | Nouvelle clé indépendante, 32 octets encodés en base64url canonique ; aucune valeur de clé dans ce document |
| `videoRoot` | Racine vidéo absolue privée, distincte physiquement et sans imbrication avec les photos |
| `ownerBytes`, `totalBytes`, `minimumFreeBytes` | Plafonds et réserve disque, chaînes décimales validées par le lecteur |

Le chargeur produit les champs `JESSIEMESSAGE_VIDEO_KEY`, `JESSIEMESSAGE_VIDEO_ROOT`, `JESSIEMESSAGE_VIDEO_OWNER_BYTES`, `JESSIEMESSAGE_VIDEO_TOTAL_BYTES` et `JESSIEMESSAGE_VIDEO_MINIMUM_FREE_BYTES`. Le démarrage vérifie schéma, capacité déjà initialisée et racines ; il n’exécute ni migration ni initialisation implicite.

## Formats et continuité

Le plan normal conserve **33 migrations et 33 tables physiques**. Le candidat vidéo a **36 migrations, 35 tables applicatives plus le ledger, soit 36 tables physiques**. Sa sélection utilise le plan candidat et l’inspection applicative vidéo distincts ; les contrôles SQL33 ne sont pas élargis silencieusement.

La capture vidéo utilise le manifeste **11**, un snapshot **3**, un reçu **11 sans capsule opérationnelle / 12 avec capsule** et deux inventaires chiffrés indépendants, `media/` et `video/`. Les sept clés sont vérifiées. La capsule opérationnelle **v2** lie le SQL, le manifeste et les deux inventaires ; sa liaison courante contient la base et les deux empreintes de racines.

Les anciens reçus de fermeture **v1** sont authentifiés dans leur liaison photo historique explicite ; les reçus **v2** dans leur liaison vidéo. La version d’enveloppe choisit exactement son contexte, sans essai successif des clés. Les noms et octets originaux restent conservés. Un reçu v1 terminé reste consultable et idempotent ; son compte doit rester absent. Un reçu v1 encore en cours **bloque l’activation vidéo** : le terminer dans son ancien périmètre SQL33 avant migration, sans convertir son curseur en curseur vidéo. Deux reçus de scopes différents pour un même compte constituent également un blocage du parent local.

Une archive ancienne SQL33 se restaure avec son profil et ses six clés dans une cible SQL33 distincte. Elle n’est pas promue implicitement vers SQL36 ; une capsule vidéo ne peut pas être relue ou publiée comme une capsule photo v1. Les anciens parcours de témoin/PC restent dans leur contrat historique ; aucune continuité externe supplémentaire n’est revendiquée.

## Séquence de restauration isolée

Le [parcours opérateur manuel](manual-restore-operator-078.md) reste la base. Pour une capture vidéo, `job.json` conserve les mêmes champs fermés avec **`version:2`**, deux bundles privés de sept fichiers et les empreintes exactes revues. La cible utilise une nouvelle base vide et les chemins dérivés `target/media`, `target/video`, `target/operations`, `target/progress`, `target/quarantine`. Les configurations cible reprennent les sept mêmes clés et sélectionnent cette nouvelle base et ces deux nouvelles racines. Ni la source ni une ancienne cible ne sont réutilisées.

1. Arrêter réellement les producteurs et captures par leur propriétaire habituel ; conserver maintenance et exclusion pendant toute la récupération. Choisir le registre récent complet, authentifier les reçus mixtes et épingler son empreinte. La complétude et la fraîcheur locales restent une responsabilité opérateur.
2. Exécuter `manual-restore.mjs check`, puis `restore` selon le guide, sur le job v2. Le parcours contrôle la base vide, importe le SQL36 authentifié et copie/reprend les deux racines sans remplacer un fichier déjà présent. Il conserve son état durable et la quarantaine bloquante.
3. Si la capture contient des réservations ou nettoyages incomplets, le moteur refuse explicitement avec `MANUAL_RESTORE_CAPACITY_PREPARATION_REQUIRED`. Il **ne lance pas lui-même** un réparateur. Garder le job, l’état `imported`, le marqueur et tous les fichiers. Sous la même exclusion, utiliser la récupération existante `scripts/backup.mjs`, avec l’environnement construit par `loadRuntimeVideoEnvironment` depuis les seules configurations **cible** :

   ```js
   await backupMain([
     "restore", "--offline", "--manifest", manifestPath,
     "--profile", "photos-notify-recovery-crm-broadcast-video-application",
   ], targetEnvironment, { signal });
   ```

   `backupMain` est l’export `main` de `scripts/backup.mjs` ; `manifestPath` désigne le manifeste de la capture choisie. Cette récupération vérifie snapshot, identités et fichiers ; ferme les seuls candidats authentifiés, constate l’absence physique avant remboursement, puis réattache séparément les capacités photo et vidéo. Elle conserve le marqueur manuel et ne démarre aucun service. Une configuration source substituée ou un fichier divergent reste refusé. Il ne faut ni effacer un marqueur ni réinitialiser la progression pour contourner un refus.
4. Reprendre le même `manual-restore.mjs restore`. Depuis `imported`, il ne réimporte plus le SQL. Il réconcilie les fermetures récentes depuis une nouvelle intention v2 liée à la cible, efface les photos et vidéos concernées, préserve les contenus des autres propriétaires, révoque les sessions et vérifie l’absence. Les reçus source restent originaux en quarantaine. La cible reste arrêtée ; conserver le `planSha256` retourné.
5. La commande `open` du même guide exige ce plan exact et refait les contrôles sous verrou. Seul son propre marqueur est levé lors de cette publication explicite. Le parent restauré démarre avec le profil vidéo ; les demandes de sauvegarde manuelle restent fermées jusqu’à la publication réussie. Un arrêt incertain ou une dérive bloque la réouverture.

Le sous-parcours sans candidats incomplets passe directement de l’import à la réconciliation. Cette procédure n’ajoute ni sauvegarde automatique ni copie/archivage PC. Elle ne prouve pas une restauration réelle de production.

## Sources et vérifications

Les contrats sont dans `server/config/runtime-video*.mjs`, `server/backup/{profiles,manifest,snapshot,checkpoint-receipt,operational-checkpoint,registry-snapshot,manual-operator-context,manual-restore,local-closure-parent}.mjs`, `server/data/{erasure-journal,closure-service}.mjs` et les CLI de capture/import/reprise/restauration.

Les tests `video-registry-snapshot`, `video-closure-service`, `video-local-closure-parent`, `reconciliation-progress`, `operational-checkpoint`, `manual-operator-context` et `manual-restore-operator` couvrent notamment les anciens scopes, refus de downgrade, racines, sept clés, progression et gate de publication. Le scénario `tests/video-backup-flow.integration.test.mjs` et ses helpers `tests/fixtures/video-backup-{flow,manual-restore}.mjs` qualifient sur bases jetables capture native SQL/tar, reprise des deux racines, récupération des réservations et restauration d’un SQL antérieur à une vraie fermeture photo/vidéo, avec conservation des contenus partagés. Les producteurs IPC de ce dernier scénario sont synthétiques mais réellement démarrés et drainés ; ils ne sont pas présentés comme un essai hébergé.

`tests/rehearsal/video.rehearsal.mjs` vérifie le parcours navigateur avec comptes synthétiques, SQL36 local et H264 décodable : chargement et lecture native pour les deux rôles, déplacement dans la vidéo, Range, reprise idempotente, galerie et révocation. L’autorité principale est remappée uniquement dans ce Chrome vers le proxy TLS loopback ; une attestation aléatoire précède la saisie des identifiants et la règle DNS n’a pas de repli public. Les tests navigateur de diffusion vérifient également le chargement, son annulation et la reprise explicite d’une campagne incertaine.

Les résultats natifs CI restent distincts des omissions procfs/SQL locales. Les wrappers des essais SQL natifs adaptent uniquement le transport à leurs bases loopback ; les captures SQL/tar et le stockage chiffré sont réels. Les wrappers opérateur d’import/reprise vidéo sont couverts par les tests ciblés de profil ; ils n’ont pas été exécutés de bout en bout dans le scénario natif, qui exerce les vraies fonctions d’import, de copie et de récupération. Les producteurs IPC du scénario de restauration sont synthétiques, réellement démarrés et drainés ; le rehearsal HTTPS utilise séparément l’application configurée et ses comptes synthétiques. **G2 est qualifié sur sa source exacte ; la qualification globale et la livraison relèvent respectivement de G3 et G4.** Aucun téléphone physique, débit réel du mutualisé, migration/activation hébergée, livraison ou garantie de continuité externe n’est déduit de ces essais.
