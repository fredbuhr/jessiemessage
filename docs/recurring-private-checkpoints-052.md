# Étape 0.52 — capture récurrente cohérente et archive chiffrée

État au **18 octobre 2026 à 02:10:34 Europe/Paris** : implémentation validée et opérateur préparé sur l’hébergement, **récurrence non activée**. La révision opérateur est `9665d54cc6abb236b04eecc9d92540d7e1c5d035`, arbre `67a0757f77cced10d07f25936b71a30fd6539075`. La révision applicative hébergée reste **0.50 `0a1cafd85c3d8699be1961075b18e80e36bcd041`**, arbre `17db89aa165e23ca427d073f5a3fcc28387f5168`. L’application n’a pas été arrêtée. Aucune nouvelle clé de récupération réelle ni sauvegarde applicative réelle n’a été créée. Les reçus 0.46 restent acquis.

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

## Installation et activation à terminer après l’export public

Le checkout séparé `/srv/customer/jessiemessage-operator/recurring-checkpoints-9665d54c` est installé, détaché sur la révision opérateur ci-dessus, arbre vérifié et Git propre. Les dépendances verrouillées ont été installées par `npm ci --ignore-scripts` et `npm run check` passe. Le runtime 0.50 reste dans son checkout actuel. Le répertoire de gestion `/srv/customer/jessiemessage-private/recurring-backup-052` est préparé en mode `0700` ; les futurs configuration et export public doivent être en `0600`. Ces deux fichiers sont encore absents.

Le fichier `recurring-backup.json` suit exactement ce schéma :

```json
{"version":1,"recipientSha256":"SHA256_HEXADECIMAL_PUBLIC_64_CARACTERES","hourUtc":5,"minuteUtc":15,"enabled":true}
```

Le lanceur privé `/srv/customer/jessiemessage-private/start-primary-backups-checked-9665d54c.sh` est préparé : propriétaire vérifié, mode `0700`, lien unique, **851 octets**, SHA-256 `8e162dab6fd444f685d06bcfc3ceb559ac64ab691aa42fb7cd4343f21db0b0c8`. Syntaxe Bash vérifiée ; **jamais exécuté**. Il épingle les sources opérateur et runtime. Le Run Manager reste le Run direct 0.50.

Après réception et inspection de la seule clé publique : installer son export exact et le hash transmis, exécuter `start-recurring-private-messaging.mjs check` sans arrêt ni capture, puis activer ce lanceur via le Build/Run Manager normal. Observer la première capture chiffrée et la reprise, contrôler le reçu et HTTPS, puis vérifier le déchiffrement réel sur le PC. Conserver le Run direct 0.50 pour un repli sans restauration SQL. Ne jamais lancer `capture-application --offline` pendant que l’application tourne.

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

La mise en production de la récurrence nécessite encore l’export public réel, un préflight réussi, l’activation et la première capture contrôlée. La copie hors hébergement automatique et son alerte de fraîcheur restent dans 0.53. Aucune acceptation historique n’est à refaire pour cette préparation.

Sources techniques : [planification Infomaniak](https://www.infomaniak.com/fr/support/faq/2161/programmer-des-taches-sur-hebergement-web), [GPG public-key et recipient-file](https://www.gnupg.org/documentation/manuals/gnupg26/gpg.1.html), [statuts machine GnuPG](https://github.com/gpg/gnupg/blob/master/doc/DETAILS) et [négociation du format](https://github.com/gpg/gnupg/blob/master/g10/encrypt.c).
