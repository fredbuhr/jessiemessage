# Checkpoint des données applicatives — étape 0.36

Le diagnostic personnel du 17 octobre 2026 à 14:24 Europe/Paris confirme une connexion réussie à la bonne base, `scope: raw_underscore_pattern`, `privilegeProfile: shared_admin`, avec visibilité des objets exécutables non prouvée. Ce résultat explique le refus de l’inspection complète. Aucun mot de passe supplémentaire ni élargissement des droits applicatifs n’est nécessaire pour la voie décrite ici.

## Couverture et limites

Ce profil sauvegarde les **trente tables physiques attendues par les trente migrations**, leur définition et toutes leurs lignes, ainsi que les fichiers photo chiffrés. Il comprend les sessions, invitations, messages, réservations de stockage, abonnements et files de notifications. Les cinq domaines chiffrés sont authentifiés avec les clés privées existantes ; le coffre de secrets et la clé VAPID restent sauvegardés séparément.

Les triggers, événements et routines SQL sont **exclus**. Leur inventaire reste **non prouvé**. Ce n’est pas une sauvegarde intégrale de tous les objets SQL éventuellement invisibles. Cette limite est inscrite dans la couverture fermée du snapshot v2, signée dans le manifeste **v4** au profil `messaging-photos-notify-application`, et reprise dans le reçu **v2**. Les anciens profils refusent ces snapshots. Changer le profil, la version ou la couverture invalide l’authentification ; le mode de récupération refuse aussi les mélanges de snapshots stricts et applicatifs.

Le profil utilise le compte runtime existant dans une seconde façade de lecture des métadonnées, avec son contrôle de privilèges et de namespace conservé à chaque acquisition. Il ne copie pas les privilèges du compte de maintenance et ne demande aucun secret sur stdin. Les trente noms de tables exacts sont passés au client natif après le nom de base ; les listes arbitraires sont refusées. TLS, fichiers temporaires privés et nettoyage sont conservés.

## Commandes

Les trois commandes suivantes prennent uniquement ces trois paramètres :

```sh
env -u NODE_OPTIONS -u NODE_PATH JESSIEMESSAGE_PRIVATE_PATH_MODE=linux-dirfd \
  node scripts/private-checkpoint.mjs check-application \
  --private-directory /srv/customer/jessiemessage-private \
  --private-path-mode linux-dirfd \
  --destination-private-directory /srv/customer/jessiemessage-private/checkpoint-schema30-application-before-domain
```

| Commande | Effet | État attendu |
| --- | --- | --- |
| `check-application` | Configuration, outils et destination, sans connexion SQL ni fichier | `application_precheck_passed` |
| `inspect-application` | Identité runtime, trente tables InnoDB et registre des migrations, sans capture | `application_inspection_verified` |
| `capture-application --offline` | Deux dumps limités, deux manifestes, copie et vérification des photos, reçu et archive | `application_checkpoint_saved` |

Les deux premières commandes fonctionnent pendant que l’application reste en service. La troisième exige une pause réelle de **tous** les serveurs, workers, tâches et outils susceptibles d’écrire. Le programme ne prouve pas lui-même l’arrêt d’un producteur extérieur. `--offline` ne doit jamais être employé pendant leur fonctionnement.

Une destination nouvelle et privée est créée exclusivement ; elle ne doit pas être reprise après un échec. Les archives sont privées, hors du site et du dépôt. Un échec conserve les artefacts incomplets pour diagnostic sans supprimer la source ni les anciennes sauvegardes.

## Vérification et reprise

La cohérence repose sur la pause des producteurs, deux dumps identiques encadrant la copie, deux snapshots identiques, l’authentification des cinq domaines et le contrôle de chaque fichier. Gzip et TAR sont relus entièrement, sans extraction : noms, types, tailles, CRC et empreintes. Le manifeste brut est lié au reçu. La réussite conserve `completeDatabase: false` dans la couverture, `independentCopyPending: true`, `sqlRestorePending: true` et `capacityRebound: false`.

Reprendre ensuite le runtime **0.33 `f2677249`**, avec son lanceur existant, et vérifier préflight, santé, disponibilité et routage. Aucun changement de code actif, de clés, de droits SQL ou de domaine n’est requis pour ce checkpoint.

La copie indépendante de l’archive et l’import des trente tables dans une **nouvelle base isolée** restent des opérations distinctes. Le contrôle `verify-private-checkpoint.mjs check-application|verify-application` exige le reçu v2, le manifeste v4 et leur couverture authentifiée identique. Il vérifie le dump du clone avant et après les contrôles en lecture seule, les trente tables et migrations, TLS, les données chiffrées et les médias. Après rollback et fermeture de cette connexion, il appelle aussi le vérificateur de snapshot applicatif sur une copie éphémère de configuration du clone : les empreintes de structure et de toutes les lignes sont comparées au snapshot signé. Aucun mot de passe n’est conservé et la configuration source reste intacte. Le succès exige `applicationSnapshotMatched: true`. Il ne démarre aucun serveur, transport ni worker et ne réassocie pas le stockage. Le mot de passe du compte de copie reste saisi masqué dans la console personnelle ; ne jamais le transmettre dans la conversation.

Ce contrôle établit la correspondance des tables restaurées et des fichiers au checkpoint applicatif. Il ne certifie pas les objets SQL exclus. La bascule du domaine attend toujours une sauvegarde cohérente, sa copie indépendante et une restauration isolée vérifiée.

## Validation du lot

Les tests ciblés couvrent les formats signés distincts, les rétrogradations, les listes natives exactes, les identifiants runtime gardés, l’absence de saisie, les refus avant dump et les couvertures concordantes. La suite SQL ajoute une comparaison avec le snapshot strict, un trigger volontairement exclu du seul profil applicatif, et une vérification/restauration du clone sans mutation de la source. La capture réelle et les résultats CI/hébergés seront consignés après leur exécution.


## Capture réelle du 17 octobre 2026

Révision capturée **`9db08f96783226d29bf6bf9d2d719679c3bb920f`**, arbre **`7593542efdfa91b4ba233fecf83a6190ab5f07d4`**, [PR brouillon #49](https://github.com/fredbuhr/jessiemessage/pull/49). Les cinq jobs de la [CI exacte](https://github.com/fredbuhr/jessiemessage/actions/runs/39033378512) réussissent : **2 028 tests généraux**, 27 wrappers SQL ignorés dans ce seul job ; **370 tests sans saut par MariaDB 10.11 et 11.4**, vingt Chrome applicatifs et une authentification Chrome/HTTPS/MariaDB. Le premier essai CI avait exposé un helper de test réclamant une campagne supprimée par la fixture photos précédente ; seule cette attente a été corrigée, les contrôles de capacité/photos/messages/source étant explicitement conservés.

Checkout séparé `/srv/customer/jessiemessage-operator/application-checkpoint-9db08f96` installé, syntaxe et inspection réelle conformes à **14:40:05.212 Europe/Paris**. Le Manager confirme l’absence de tâche planifiée et le maintien du Run/Build 0.33 avant l’opération. Le processus Node a été arrêté dans le Manager et son état `Arrêté` confirmé. Le frontend de maintenance renvoie un 301 vers la même URL `/api/health/` (et non systématiquement un 503) ; les essais de garde précédents se sont arrêtés avant la création d’une destination. Le processus du service n’étant pas visible dans le namespace SSH même avant arrêt, aucun `pgrep` à zéro n’est présenté comme preuve d’arrêt. La preuve opérateur est l’état arrêté du Manager et la disparition de l’API réelle, avec aucun autre producteur connu.

Capture effective de **14:46:14.008 à 14:46:16.769**, sortie `application_checkpoint_saved`, code retour zéro. Destination privée : `/srv/customer/jessiemessage-private/checkpoint-schema30-application-before-domain`.

| Élément | Résultat |
| --- | --- |
| Tables / migrations | 30 / 30 |
| Fichiers photo chiffrés | 4 fichiers, 380 528 octets |
| SQL Gzip | 15 666 octets ; SHA-256 `26133cb319bd087540ec232d204e43c98c1d887ceb1d80f1722997640f4626cd` |
| Archive `checkpoint.tar.gz` | 400 149 octets |
| SHA-256 de l’archive | `481407b64cf2d0ea997098d4a7c6100a30ef235d5b7f46ed076cd310093c943e` |
| Octets de l’archive | Vérifiés intégralement ; aucune extraction annoncée |
| Copie indépendante / import réel | Copie PC confirmée par le propriétaire à 15:06 ; import réel encore à réaliser |
| Réassociation du stockage | Non effectuée |

Le **même Run 0.33** est relancé immédiatement après le résultat de capture ; le Manager indique `Actif`, écoute sur 3000 et profil `messaging-photos-notify`. À **14:47:06.537**, préflight conforme, santé/disponibilité HTTP 200, routage apex `/app` toujours 302 vers recette. Aucun domaine, clé, droit SQL ni schéma n’a été changé ; seuls la pause/reprise et les nouveaux fichiers privés du checkpoint ont eu lieu.

Le complément de vérification du snapshot signé du clone est validé sur **`123531df99d24f915bdd24a00f3fec77695cc63f`**, arbre `3c2a5658184836ac415982543b6666006faa1d1d`. Ses cinq [jobs CI exacts](https://github.com/fredbuhr/jessiemessage/actions/runs/39034174776) passent : **2 031 tests généraux**, 370 par MariaDB sans saut, vingt Chrome applicatifs et une authentification intégrée. Checkout séparé `/srv/customer/jessiemessage-operator/application-restore-123531df`, installation et syntaxe vérifiées. À **14:55:38.770**, `check-application` sur le vrai checkpoint annonce `checkpointFilesMatched: true`, média indépendant, trente tables/migrations, SQL brut **76 621 octets**, SHA-256 `246a75fdca87b02405e548092a21da1882330f1b9fa17e5aca619eb2b4502e4a`, **`databaseConnected: false`**. La base proposée `fb4hmr_jm_checkpoint30_20261017` reste à créer puis importer ; ce précontrôle ne prouve pas son existence ou sa restauration.

Le contrôle du snapshot signé après import doit annoncer `applicationSnapshotMatched: true` avant validation de la copie. Il ne modifie ni l’archive figée ni le runtime actif. La bascule du domaine n’est pas encore effectuée.


## Copie personnelle indépendante

L’accès SSH/SFTP Node.js existant est confirmé dans le [Manager normal](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/ftp-ssh) : serveur `57-118579.ssh.hosting-ik.com`, port `22`, compte de sauvegarde `QxrM8Gh3hsN_jessiebk`. Aucun compte, mot de passe ou droit d’accès n’a été changé. Le Web FTP montré par le Manager concerne l’environnement Apache/PHP ; il ne remplace pas cet accès Node.js.

Avec le même client de transfert que pour le coffre, télécharger le fichier distant :

```text
/srv/customer/jessiemessage-private/checkpoint-schema30-application-before-domain/checkpoint.tar.gz
```

Ou, avec le [client OpenSSH Windows](https://learn.microsoft.com/fr-fr/windows-server/administration/openssh/openssh-overview), exécuter ce bloc dans **PowerShell sur le PC**, pas dans la console Infomaniak :

```powershell
& {
  $jmCheckpointFile = Join-Path ([Environment]::GetFolderPath('Desktop')) 'JessieMessage-schema30-20261017-1446.tar.gz'
  scp 'QxrM8Gh3hsN_jessiebk@57-118579.ssh.hosting-ik.com:/srv/customer/jessiemessage-private/checkpoint-schema30-application-before-domain/checkpoint.tar.gz' $jmCheckpointFile
  if ($LASTEXITCODE -eq 0 -and (Get-FileHash -LiteralPath $jmCheckpointFile -Algorithm SHA256).Hash -eq '481407b64cf2d0ea997098d4a7c6100a30ef235d5b7f46ed076cd310093c943e') { 'COPIE_SCHEMA30_OK' } else { 'COPIE_NON_CONFIRMEE' }
}
```

Le secret éventuellement demandé est celui de l’accès SSH/SFTP existant, pas celui de la base SQL ; sa saisie ne s’affiche pas. Le garder dans la fenêtre personnelle. Le propriétaire confirme **`COPIE_SCHEMA30_OK` le 17 octobre à 15:06 Europe/Paris** : le téléchargement indépendant et son empreinte sont désormais attestés par son exécution personnelle du bloc ci-dessus. Le prochain lot prépare une base isolée neuve et un import au SQL exact, puis la vérification contre le snapshot signé, avant toute activation du domaine principal.

À **14:57:14.751 Europe/Paris**, l’archive est relue : taille et SHA-256 identiques au résultat de capture ; le reçu et sa liaison au manifeste restent conformes. La disponibilité répond encore HTTP 200. Les marqueurs `independentCopyPending` et `sqlRestorePending` restent vrais jusqu’aux validations personnelles et à l’import effectif.

Après cette confirmation, la nouvelle base **`fb4hmr_jm_checkpoint30_20261017`** est créée dans le Manager, sans aucun utilisateur ni permission associés. L’inventaire affiche cinq bases, la nouvelle à **0 octet**, les quatre précédentes conservées. Aucun droit SQL n’est accordé par l’agent. À **15:09:53 Europe/Paris**, le service actif répond encore HTTP 200 ; le client natif disponible est MariaDB **10.11.14**. L’existence vide observée dans le Manager ne remplace pas le contrôle SQL avant import.

## Import natif et vérification dans la base isolée

Le lanceur `scripts/capture-application-checkpoint-restore.sh` regroupe un précontrôle sans SQL, une seule saisie masquée du mot de passe opérateur, l’import natif et la vérification complète `verify-application`. Le programme dédié `scripts/import-application-checkpoint.mjs` exige les six paramètres du vérificateur et un **`--sql-sha256` fourni indépendamment du reçu**. Pour ce checkpoint, le lanceur personnel doit épingler `246a75fdca87b02405e548092a21da1882330f1b9fa17e5aca619eb2b4502e4a`. Ce contrôle porte sur les octets SQL décompressés avant toute saisie de secret ou connexion : modifier ensemble un Gzip et son reçu ne permet pas d’importer d’autres octets.

Le format fermé du dump est contrôlé : trente créations de tables attendues, noms non qualifiés, insertions littérales et seuls réglages de session du dump. Les changements de base, cibles externes, routines et commandes du client sont refusés. Le mode SQL d’import reste fixé au littéral du dump. La connexion doit confirmer TLS, le nom exact de la nouvelle base et l’absence de toute table ou vue. Une base partiellement remplie par un échec n’est jamais effacée ni réutilisée automatiquement.

Le client natif `/usr/bin/mariadb` reçoit le SQL validé sur son entrée standard, la seule base cible sur sa ligne de commande, TLS avec validation du certificat, `--sandbox`, `--local-infile=0` et `--skip-reconnect`. Le mot de passe reste dans une configuration privée temporaire `0600`, contrôlée puis supprimée ; il n’est ni dans les arguments, ni dans l’environnement, ni dans les résultats. Un échec ou une annulation ne produit aucun reçu de réussite. Après l’import seulement, le vérificateur compare le dump natif du clone au SQL figé et contrôle les données chiffrées, médias et snapshot signé. Le statut final exige **`application_checkpoint_restored_verified`**, **`imported: true`** et **`applicationSnapshotMatched: true`**. Aucun serveur, e-mail, worker ou réassociation du stockage n’est lancé.

L’intervention personnelle restante se fait sur la [page vérifiée du compte opérateur existant](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/databases/dashboard/users/edit/fb4hmr_jm_mig). Sur la seule ligne **`fb4hmr_jm_checkpoint30_20261017`**, accorder **Lecture**, **Écriture** et **Administration**, puis valider. Les lignes source et anciennes copies restent telles quelles, et le compte applicatif n’accède pas à la copie. Cet accès permet au compte de maintenance d’importer la nouvelle base ; le mot de passe existant ne change pas. La saisie du secret se fait ensuite dans la console SSH personnelle, jamais dans la conversation. L’agent ne soumet pas ce changement de permissions.

L’import réel et son résultat restent à attester après cette intervention ; ni la création vide du Manager, ni les tests synthétiques, ni le précontrôle sans SQL ne sont présentés comme une restauration réussie.
