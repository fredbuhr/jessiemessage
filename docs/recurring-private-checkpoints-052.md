# Étape 0.52 — capture récurrente cohérente et archive chiffrée

**Mise à jour du 18 octobre en journée :** le [premier déclenchement quotidien](activation-proofs/jm052-first-scheduled-20261018.json) est maintenant vérifié à 05:15:33–05:15:39 UTC, empreintes relues. Le [superviseur 0.53](periodic-backup-monitor-053.md) conserve cette capture et ajoute la surveillance minute. Les relevés datés de la nuit ci-dessous conservent leur portée historique ; copie et déchiffrement PC restent non confirmés.

État au **18 octobre 2026 à 02:29:40 Europe/Paris** : **superviseur récurrent activé, première capture réelle chiffrée et reprise vérifiées**. La révision opérateur est `9665d54cc6abb236b04eecc9d92540d7e1c5d035`, arbre `67a0757f77cced10d07f25936b71a30fd6539075`. La révision applicative hébergée reste **0.50 `0a1cafd85c3d8699be1961075b18e80e36bcd041`**, arbre `17db89aa165e23ca427d073f5a3fcc28387f5168`. Seul l’export public réel créé sur le PC est installé ; aucune clé privée de récupération n’a été reçue. La copie et le déchiffrement PC de cette archive réelle restent à confirmer. Les reçus 0.46 restent acquis.

## Fonctionnement préparé

Le planificateur Web de l’hébergement appelle des URL ; la capture privée ne doit pas être exposée par un endpoint. Le nouveau parent Node reste piloté par le Run Infomaniak et lance le runtime existant dans un enfant IPC. Une horloge native suffit, sans paquet cron ni compte API supplémentaire. Il conserve les arguments du profil primaire avec récupération, fiches et diffusions.

Avant une capture, le parent vérifie la source Git attendue, le fichier public de récupération épinglé, GPG, les outils du checkpoint, la destination privée et une réserve de **8 Gio**. L’absence ou l’invalidité de configuration de sauvegarde laisse l’application fonctionner ; aucun arrêt n’est permis avant un journal initial durable.

Le parent attend ensuite l’arrêt gracieux réel de l’enfant : **code 0, aucun signal**. Un arrêt forcé ou ambigu interdit la capture. Le checkpoint existant effectue les deux exports/manifeste autour de la copie des photos. Profil : `photos-notify-recovery-crm-broadcast-application`, **manifeste 10 / reçu 8**, trente tables applicatives, six clés ; objets SQL exécutables exclus/non prouvés. Le programme de capture est lui aussi lié au parent par IPC pour s’annuler si celui-ci disparaît.

L’archive complète `checkpoint.tar.gz` est chiffrée vers `checkpoint.tar.gz.gpg` par GPG public-key AES-256 authentifié standard. Le format suit les capacités annoncées par la clé publique : MDC sur le GPG 2.2.40 de l’hébergement, ou AEAD OCB sur un GPG récent et une clé compatible. Le reçu indique précisément `protection: "mdc"` ou `protection: "ocb-aead"` ; aucun mode sans authentification ni autre chiffre n’est accepté. Le serveur n’utilise que `recipient-public.asc`, dont le SHA-256 exact est épinglé ; aucun import dans un trousseau serveur. Une clé secrète, une clé multiple, expirée/révoquée ou un export différent sont refusés. Source et chiffré sont relus et hachés, sorties exclusives, taille et durée bornées. Le reçu `encryption-receipt.json` distingue `encrypted: true`, `decryptionVerified: false`, `independentCopyPending: true`.

La reprise de l’application a lieu même après erreur de capture/chiffrement. Elle exige à nouveau la source attendue, un reçu IPC de démarrage et une vraie disponibilité HTTP locale. Un arrêt global du Manager ne redémarre pas l’enfant. Si le parent disparaît, ses enfants s’annulent/drainent ; une panne applicative imprévue fait échouer le parent pour rendre le contrôle au Manager.

## Fréquence et journal

Une première tentative a lieu au démarrage du superviseur configuré et activé. Ensuite, la cible est **05:15 UTC chaque jour** (07:15 en heure d’été française, 06:15 en hiver). Le parent réévalue la configuration et l’échéance toutes les minutes. Une tentative déjà journalisée ne se répète pas avant l’échéance suivante, même après redémarrage ; une panne de préflight ne coupe pas le service et peut être contrôlée de nouveau.

Le verrou exclusif empêche deux captures. Un verrou abandonné ou un journal partiel après crash bloque les captures suivantes, avec un code fixe ; aucun fichier ancien n’est supprimé automatiquement. Les reçus sont append-only, synchronisés et relus. L’historique est borné à 2 000 rapports ; son entretien devra suivre une politique explicite. Les répertoires `capture-<horodatage>-<aléa>` conservent les fichiers clairs privés et les fichiers chiffrés ; une erreur peut laisser une sortie partielle sans reçu de réussite.

La planification dépend de ce parent actif. Le contrôle d’ancienneté, l’alerte réellement reçue, la détection de l’absence du parent/moniteur et la copie indépendante automatique restent dans **0.53**. Le signal public `/api/ready` ne certifie pas encore ces sauvegardes. Une capture planifiée impose une courte indisponibilité ; la durée réelle doit être relevée lors de la première capture contrôlée.

## Clé de récupération sur le PC

Le [script Windows](../scripts/JessieMessage-recuperation-052.ps1) est autonome et conserve les coffres existants. Il réutilise GPG déjà installé, crée une clé dédiée RSA 3072 de chiffrement dans un nouveau trousseau local, demande la phrase secrète personnellement, exporte la clé publique et une copie privée locale sans écraser de fichier existant. Il importe cette copie privée dans un autre trousseau de preuve puis chiffre/déchiffre des octets synthétiques et compare leur empreinte. Une préférence PowerShell locale protège les lectures GPG des avertissements stderr bénins de Windows PowerShell 5.1 ; un code GPG non nul reste un échec.

1. Télécharger `JessieMessage-recuperation-052.ps1` dans **Téléchargements**.
2. Ouvrir PowerShell et lancer :

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\Downloads\JessieMessage-recuperation-052.ps1"
```

3. Quand GPG le demande, choisir une phrase longue et unique. La conserver personnellement.
4. Après `CLE_PUBLIQUE_052_PRETE` et `VERIFICATION_CLE_052_OK`, joindre uniquement **`JessieMessage-cle-publique-052.asc`**, présent dans Téléchargements, et la ligne SHA-256 publique affichée.

Le dossier `JessieMessage-recuperation-052`, le fichier `NE-PAS-PARTAGER-cle-privee.asc` et la phrase restent personnels. Conserver une copie de récupération hors de ce PC. Aucun de ces éléments privés n’est requis dans la discussion ou sur l’hébergement. Ce nouveau contrôle ne refait pas le coffre 0.46.

## Installation et activation réalisées

Le checkout séparé `/srv/customer/jessiemessage-operator/recurring-checkpoints-9665d54c` est installé, détaché sur la révision opérateur ci-dessus, arbre vérifié et Git propre. Les dépendances verrouillées ont été installées par `npm ci --ignore-scripts` et `npm run check` passe. Le runtime 0.50 reste dans son checkout actuel. Le répertoire de gestion `/srv/customer/jessiemessage-private/recurring-backup-052` est en mode `0700`. La configuration et le seul export public ont été installés en `0600`, sans écrasement et après contrôle d’empreinte.

La capture PC jointe montre `CLE_PUBLIQUE_052_PRETE` et `VERIFICATION_CLE_052_OK`. L’export de 1 363 octets a pour SHA-256 `c759ad91a49a951adee26f51699380723515c71e4477d267c741508513f20270` et empreinte OpenPGP `B4E5570BF03A5B048B6AF394D49C2329ABD5FEE2`. Ces deux empreintes concordent avec la capture du PC et l’inspection native GPG de l’hébergement. Le préflight réel passe à **02:26:10.860 Europe/Paris**, sans arrêt ni capture.

Le fichier `recurring-backup.json` suit exactement ce schéma :

```json
{"version":1,"recipientSha256":"SHA256_HEXADECIMAL_PUBLIC_64_CARACTERES","hourUtc":5,"minuteUtc":15,"enabled":true}
```

Le lanceur privé `/srv/customer/jessiemessage-private/start-primary-backups-checked-9665d54c.sh` est vérifié : propriétaire, mode `0700`, lien unique, **851 octets**, SHA-256 `8e162dab6fd444f685d06bcfc3ceb559ac64ab691aa42fb7cd4343f21db0b0c8`. Il épingle les sources opérateur et runtime. Le Manager exécute désormais `bash /srv/customer/jessiemessage-private/start-primary-backups-checked-9665d54c.sh`. Son Build vérifie la source opérateur avant `npm run check` ; le Build normal lancé à 02:27 réussit puis redémarre l’application automatiquement, sans réinstaller les dépendances.

Les anciennes commandes Manager sont conservées en privé dans `recurring-backup-052/manager-before-activation-052.json`. Pour un repli de code, remettre ces commandes par le Manager et son cycle normal ; aucune restauration SQL n’est nécessaire. Ne jamais lancer `capture-application --offline` pendant que l’application tourne.

## Première capture réelle

Le journal indique **02:28:10.807 → 02:28:16.649 Europe/Paris**, soit **5 842 ms pour l’opération entière** ; cette durée n’est pas une mesure séparée d’indisponibilité HTTP. État final : `succeeded`, `phase: finished`, `code: OK`, `runtimeResumed: true`, `lastSuccessAt: 1792283296649`. Le verrou est absent. Le reçu applicatif v8 et sa liaison au manifeste v10 sont relus par le validateur natif : profil `messaging-photos-notify-recovery-crm-broadcast-application`, trente tables et migrations, photos chiffrées. Les objets SQL exécutables restent exclus/non prouvés ; `completeDatabase: false`.

Répertoire privé de cette capture :

```text
/srv/customer/jessiemessage-private/recurring-backup-052/capture-1792283290807-da0b3c1143fa53a3
```

| Fichier | Octets | SHA-256 relu |
| --- | ---: | --- |
| `checkpoint.tar.gz` | 402 250 | `623c43013bf4c2a6f613bbea878b1fcfc89884d17e7920c1d86bfbd28ab2e6c8` |
| `checkpoint.tar.gz.gpg` | 402 802 | `edbe5326c951826622542fb4ced4b684d0da770a4da507b569beb9d4bed8b8e2` |

Le reçu de chiffrement confirme AES-256/MDC et le destinataire exact. À **02:29:40.533 Europe/Paris**, HTTPS primaire répond `health: ok`, `ready: ready`, sans cookie ni redirection. Le Manager montre l’application active et le Build réussi. Voir le [reçu d’activation](activation-proofs/jm052-activation.json) et la [preuve visuelle](activation-proofs/jm052-activation-20261018.jpg).

Le premier passage est celui du démarrage. La prochaine cible est **05:15 UTC le 18 octobre**, puis chaque jour ; le premier déclenchement calendaire n’est pas encore observé. `realArchiveDecryptionVerified: false` et `independentCopyPending: true` restent honnêtement ouverts jusqu’au retour PC ci-dessous. Aucun fichier clair n’est publié ni transféré par l’agent.

## Copie et déchiffrement personnels de l’archive réelle

Sur le PC, ouvrir **PowerShell** et coller ce bloc. Il réutilise le compte SSH/SFTP existant et le trousseau de récupération déjà créé, ne remplace aucun fichier existant et ne restaure aucune base. Saisir personnellement le mot de passe SSH/SFTP éventuellement demandé, puis la phrase secrète GPG ; aucun secret ne doit être envoyé dans la discussion.

```powershell
& {
    $ErrorActionPreference = 'Stop'
    $jmDownloads = Join-Path $env:USERPROFILE 'Downloads'
    $jmChiffre = Join-Path $jmDownloads 'JessieMessage-sauvegarde-052-20261018.tar.gz.gpg'
    $jmClair = Join-Path $jmDownloads 'JessieMessage-sauvegarde-052-20261018.tar.gz'
    if (-not (Test-Path -LiteralPath $jmChiffre)) {
        scp 'QxrM8Gh3hsN_jessiebk@57-118579.ssh.hosting-ik.com:/srv/customer/jessiemessage-private/recurring-backup-052/capture-1792283290807-da0b3c1143fa53a3/checkpoint.tar.gz.gpg' $jmChiffre
        if ($LASTEXITCODE -ne 0) { throw 'Copie interrompue.' }
    }
    if ((Get-FileHash -LiteralPath $jmChiffre -Algorithm SHA256).Hash.ToLowerInvariant() -ne 'edbe5326c951826622542fb4ced4b684d0da770a4da507b569beb9d4bed8b8e2') {
        throw 'Empreinte du fichier chiffre differente. Conserver le fichier et transmettre ce message.'
    }
    if (-not (Test-Path -LiteralPath $jmClair)) {
        gpg --no-options --homedir (Join-Path $jmDownloads 'JessieMessage-recuperation-052') --output $jmClair --decrypt $jmChiffre
        if ($LASTEXITCODE -ne 0) { throw 'Dechiffrement non confirme.' }
    }
    if ((Get-FileHash -LiteralPath $jmClair -Algorithm SHA256).Hash.ToLowerInvariant() -ne '623c43013bf4c2a6f613bbea878b1fcfc89884d17e7920c1d86bfbd28ab2e6c8') {
        throw 'Empreinte apres dechiffrement differente. Conserver le fichier et transmettre ce message.'
    }
    'SAUVEGARDE_052_OK'
}
```

Renvoyer uniquement `SAUVEGARDE_052_OK` ou le message d’échec. Garder les fichiers sur le PC ; ne pas joindre l’archive, le dossier de récupération ou la clé privée. Ce contrôle porte sur la nouvelle archive complète chiffrée ; le coffre 0.46 accepté n’est pas refait. Une concordance des deux empreintes attestera copie et déchiffrement, sans prétendre à un nouvel import SQL natif.

## Vérifications

Les tests couvrent l’ordre journal/arrêt/capture/chiffrement/reprise, erreurs, annulation, concurrence, horloges, permissions, liens, dérive des fichiers, verrou, journal partiel, limites, processus IPC, arrêt forcé, orphelins et lecture locale de disponibilité. Le vrai aller-retour GPG utilise une clé synthétique dans la CI Linux. Le workflow Windows vérifie la syntaxe PowerShell 5.1 et la distinction entre avertissement natif et échec, sans créer de clé réelle.

Les [cinq jobs CI de la source opérateur](https://github.com/fredbuhr/jessiemessage/actions/runs/39081600837) passent :

| Contrôle | Résultat |
| --- | --- |
| Syntaxe, suite générale, build et aperçu | 2 429 tests : 2 402 réussis, 27 wrappers SQL ignorés, zéro échec ; build et aperçu réussis |
| MariaDB 10.11 | 383/383, zéro ignoré |
| MariaDB 11.4 | 383/383, zéro ignoré |
| Chrome : clavier et conversations | 101/101 |
| Authentification Chrome HTTPS avec MariaDB | 1/1 |
| [Windows PowerShell 5.1](https://github.com/fredbuhr/jessiemessage/actions/runs/39081600849) | Analyse du vrai script et distinction avertissement natif/échec réussies ; aucune clé réelle créée |

Le vrai aller-retour synthétique GPG passe dans la CI moderne avec OCB authentifié, ainsi que sur le **GPG 2.2.40 de l’hébergement avec MDC**. Le contrôle distingue strictement ces deux formats authentifiés. Les tests d’échec couvrent également le journal initial indisponible sans arrêt de l’application, les racines qui se recouvrent et deux démarrages concurrents du parent.

À **02:10:34 Europe/Paris**, le contrôle préparatoire réel refuse l’activation avant tout arrêt (`RECURRING_FILES_IO`, fichiers public/configuration absents). GPG, tar, les descripteurs privés et la réserve de 8 Gio sont disponibles. Les réponses HTTPS anonymes de `jessiemessage.com` donnent `health: ok` et `readiness: ready`. Le [reçu de préparation](activation-proofs/jm052-preparation.json) et sa [capture dans le Manager](activation-proofs/jm052-preparation-20261018.jpg) distinguent ces faits d’une activation ou d’une sauvegarde réelle, toutes deux encore absentes.

La préparation de 02:10 est conservée comme preuve historique ; l’activation réelle de 02:28 décrite ci-dessus la complète. Restent le déchiffrement et la copie PC de cette nouvelle archive, puis l’observation du premier déclenchement calendaire. La copie hors hébergement automatique et son alerte de fraîcheur restent dans 0.53. Aucune acceptation historique n’est à refaire.

Sources techniques : [planification Infomaniak](https://www.infomaniak.com/fr/support/faq/2161/programmer-des-taches-sur-hebergement-web), [GPG public-key et recipient-file](https://www.gnupg.org/documentation/manuals/gnupg26/gpg.1.html), [statuts machine GnuPG](https://github.com/gpg/gnupg/blob/master/doc/DETAILS) et [négociation du format](https://github.com/gpg/gnupg/blob/master/g10/encrypt.c).
