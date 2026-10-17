# Sauvegarde du schéma 30 et vérification du clone — étape 0.36

Ce lot prépare les commandes avant la bascule du domaine. Le service actif reste 0.33 `f2677249`, profil `messaging-photos-notify`, trente migrations et trente tables physiques. Le pont de session 0.35 reste préparé, sans activation. **Aucun nouveau checkpoint réel ni restauration réelle n’est encore attesté par ce document.**

## Parcours personnel court

La première action est une inspection en lecture seule, **sans arrêter l’application**. Le lanceur demande le mot de passe SQL du compte de migration ou d’inspection existant dans la console SSH personnelle. Il ne faut pas le saisir dans la conversation. Le compte applicatif garde ses droits actuels.

| Commande | Mot de passe | SQL | Fichiers créés | Interruption |
| --- | --- | --- | --- | --- |
| `check` | Aucun | Aucun accès | Aucun | Aucune |
| `inspect` | Saisie masquée | Identité, droits et métadonnées | Aucun | Aucune |
| `capture --offline` | Saisie masquée | Lectures et dump | Nouvelle destination privée exclusive | Tous les producteurs doivent être arrêtés |
| Vérification du clone : `check` | Aucun | Aucun accès | Aucun | Clone isolé, jamais démarré |
| Vérification du clone : `verify` | Saisie masquée | Dump du clone et transaction en lecture seule | Seulement une configuration native temporaire, supprimée après fermeture | Aucune sur le service repris |

L’inspection vérifie la véritable identité privilégiée avant de demander une pause. Le compte doit être distinct du runtime et présenter un droit direct `ALL PRIVILEGES` sur le nom exact de la base, avec les underscores échappés dans le `GRANT`. Le fait qu’il s’appelle « migrateur » ne suffit pas. Les droits globaux, rôles et motifs ne remplacent pas cette preuve. Le programme n’accorde aucun droit et ne change pas les comptes.

Le lot corrige une incompatibilité de l’ancien outil : le pool d’inspection recopiait le profil restrictif du runtime Infomaniak. Ce profil est désormais retiré **uniquement de la copie utilisée par le pool d’inspection**, dont les requêtes restent limitées aux métadonnées en lecture seule et dont le contrôle `ALL` exact reste obligatoire. L’environnement et le pool applicatifs restent inchangés.

## Commandes du code préparé

Après installation du checkout exact validé :

```sh
JESSIEMESSAGE_PRIVATE_PATH_MODE=linux-dirfd node scripts/private-checkpoint.mjs check \
  --private-directory /srv/customer/jessiemessage-private \
  --private-path-mode linux-dirfd \
  --destination-private-directory /srv/customer/jessiemessage-private/checkpoint-schema30-before-domain \
  --inspection-user COMPTE_INSPECTION
```

La saisie personnelle est encadrée par Bash :

```sh
bash scripts/capture-private-checkpoint.sh inspect \
  --private-directory /srv/customer/jessiemessage-private \
  --private-path-mode linux-dirfd \
  --destination-private-directory /srv/customer/jessiemessage-private/checkpoint-schema30-before-domain \
  --inspection-user COMPTE_INSPECTION
```

Le résultat attendu est `inspection_verified`, `checkpointSaved: false`, `started: false`. Il valide les droits et l’état du schéma à cet instant ; il ne constitue pas une capture. Si l’inspection échoue, ne pas arrêter l’application et ne pas élargir les droits du runtime pour contourner le refus.

Après cette inspection positive et arrêt de tous les serveurs, workers, tâches et outils d’écriture, remplacer `inspect` par `--offline` dans la même commande. Cette option est la déclaration de l’opérateur ; le programme ne prouve pas l’arrêt d’un producteur extérieur. Le service est repris avec son lanceur 0.33 après la capture, puis santé/disponibilité sont vérifiées. Aucun changement de lanceur ou de domaine n’est nécessaire pour sauvegarder.

## Contenu et contrôles de la capture

1. Charger la configuration existante de recette, sans fichier de secrets supplémentaire, et vérifier l’identité d’inspection avant toute création de destination.
2. Créer une destination exclusive `0700`, hors du dépôt et du stockage source ; ouvrir les répertoires par descripteurs et vérifier leurs identités. Aucun écrasement ni reprise silencieuse d’un répertoire incomplet.
3. Réutiliser `backup.mjs prepare --offline --profile photos-notify` : manifeste v3 signé, cinq témoins de clés métier et contrôle des vraies données MFA, e-mails, messages, photos et notifications. La clé VAPID reste dans le coffre séparé déjà confirmé ; elle n’est pas placée dans l’archive.
4. Produire un premier dump natif privé, copier chaque photo chiffrée dans un stockage physiquement distinct, puis produire un second dump et un second manifeste. Refuser toute divergence SQL, structurelle, cryptographique ou de fichiers.
5. Compresser le SQL, publier un reçu canonique et créer `checkpoint.tar.gz`. Le processus `tar` reçoit le répertoire épinglé par un FD hérité ; il n’ouvre pas lui-même le chemin de sortie. Sa sortie est bornée et écrite dans un fichier exclusif `0600`.
6. Relire le Gzip et chaque membre du TAR sans extraction : noms fermés, fichiers ordinaires, aucun lien ni extension de chemin, tailles, CRC et empreintes exactes du SQL compressé, du manifeste, du reçu et des photos. Revérifier ensuite les fichiers et la configuration source.

L’archive contient seulement `manifest.json`, `database.sql.gz`, `receipt.json` et `media/`. Les fichiers intermédiaires `database.sql` et `manifest-after.json` restent dans le nouveau répertoire privé, hors de l’archive. Un échec conserve les artefacts incomplets privés pour inspection ; aucune suppression automatique ne vise la source ou les anciennes sauvegardes.

Les limites sont fermées : SQL brut 64 Mio, SQL Gzip 16 Mio, au plus 100 000 fichiers photo et 1 Gio de photos chiffrées, archive et flux TAR au plus 2 Gio. Un dépassement échoue ; aucune certification partielle. Les archives et manifestes contiennent des données et métadonnées privées : ils ne doivent pas être publiés sur le site ou dans Git. Les secrets et leur coffre restent séparés.

Le reçu public de succès annonce `checkpoint_saved`, l’empreinte et la taille de l’archive, `archiveContentsVerified: true`, `archiveExtracted: false`, `independentCopyPending: true` et `sqlRestorePending: true`. La vérification des octets archivés ne remplace ni leur téléchargement indépendant ni l’import SQL isolé.

## Vérification de la copie restaurée

Télécharger l’archive et confirmer son empreinte depuis un autre appareil ou emplacement indépendant. Conserver le coffre v4 à six fichiers séparément. Importer le SQL dans une **nouvelle base vide explicitement confirmée**, sans accorder de droits au compte applicatif. Utiliser un répertoire média distinct, sans lien physique, lien symbolique ni imbrication dans le stockage source. Ne lancer aucun serveur, worker ou e-mail sur la copie.

La commande suivante compare le dump complet du clone au SQL figé, vérifie les trente tables et migrations, TLS et les droits exacts, puis authentifie les cinq domaines de données et les photos dans une transaction en lecture seule :

```sh
bash scripts/capture-private-checkpoint-verification.sh \
  --private-directory /srv/customer/jessiemessage-private \
  --private-path-mode linux-dirfd \
  --checkpoint-directory /CHEMIN_PRIVE_DE_LA_COPIE \
  --database NOM_COPIE \
  --confirm-database NOM_COPIE \
  --user COMPTE_INSPECTION_COPIE
```

Le précontrôle sans secret précède la saisie masquée. La copie, le SQL, le manifeste et les photos sont relus avant et après. La réussite annonce `verified`, les compteurs fermés, `checkpointFilesMatched: true` et `capacityRebound: false` ; rollback et fermeture SQL doivent réussir avant toute publication de succès.

Cette commande ne réalise pas l’import SQL et ne lance pas le réparateur de réservations ou la réassociation de capacité de `backup.mjs restore`. Cette opération reste distincte pour un futur redémarrage effectif sur un stockage déplacé. Le repli courant vers le code 0.33 conserve le stockage et le schéma 30 existants ; les anciens runtimes au schéma 28 demandent une restauration cohérente de leur propre checkpoint.

## État de validation

Les tests utilisent exclusivement des comptes, clés, SQL et photos fictifs. Ils couvrent les fichiers privés réels, la création et la lecture de Gzip/TAR, les altérations, les liens, les substitutions de répertoire, les refus de droits, les annulations et l’effacement des secrets en mémoire. La CI Linux doit exercer le véritable FD hérité vers GNU tar ; l’environnement local dont procfs est simulé emploie uniquement un adaptateur de fixture identifié. Les résultats CI exacts et le précontrôle hébergé sont à consigner après vérification.
