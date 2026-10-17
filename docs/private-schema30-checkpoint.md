# Sauvegarde du schéma 30 et vérification du clone — étape 0.36

Ce lot prépare les commandes avant la bascule du domaine. Le service actif reste 0.33 `f2677249`, profil `messaging-photos-notify`, trente migrations et trente tables physiques. Le pont de session 0.35 reste préparé, sans activation. **Aucun nouveau checkpoint réel ni restauration réelle n’est encore attesté par ce document.**

## Diagnostic personnel confirmé et suite

La capture personnelle du 17 octobre à 14:24 confirme `databaseConnected: true`, `databaseMatched: true`, `scope: raw_underscore_pattern`, `privilegeProfile: shared_admin` et visibilité non prouvée. Le refus strict est donc expliqué. La suite est le [checkpoint limité aux données applicatives](application-table-checkpoint.md), avec formats et couverture distincts et sans nouvelle saisie de mot de passe. Les anciennes commandes ci-dessous sont conservées comme preuve du chemin strict ; elles ne doivent pas servir à contourner ce refus.

## Parcours personnel court

Après le refus du 17 octobre à 13:48 Europe/Paris, la première action est désormais un **diagnostic en lecture seule, sans arrêter l’application**. Le refus `PRIVATE_CHECKPOINT_INSPECTION` n’a produit aucune sauvegarde ; les anciens reçus de préparation ne prouvent pas la réussite de cette inspection. Le lanceur demande le mot de passe SQL du compte de migration ou d’inspection existant dans la console SSH personnelle. Il ne faut pas le saisir dans la conversation. Le compte applicatif garde ses droits actuels.

| Commande | Mot de passe | SQL | Fichiers créés | Interruption |
| --- | --- | --- | --- | --- |
| `check` | Aucun | Aucun accès | Aucun | Aucune |
| `diagnose` | Saisie masquée | Identité et catégories de droits ; inventaire uniquement si la visibilité stricte est prouvée | Aucun | Aucune |
| `inspect` | Saisie masquée | Identité, droits et métadonnées | Aucun | Aucune |
| `capture --offline` | Saisie masquée | Lectures et dump | Nouvelle destination privée exclusive | Tous les producteurs doivent être arrêtés |
| Vérification du clone : `check` | Aucun | Aucun accès | Aucun | Clone isolé, jamais démarré |
| Vérification du clone : `verify` | Saisie masquée | Dump du clone et transaction en lecture seule | Seulement une configuration native temporaire, supprimée après fermeture | Aucune sur le service repris |

L’inspection vérifie la véritable identité privilégiée avant de demander une pause. Le compte doit être distinct du runtime et présenter un droit direct `ALL PRIVILEGES` sur le nom exact de la base, avec les underscores échappés dans le `GRANT`. Le fait qu’il s’appelle « migrateur » ne suffit pas. Les droits globaux, rôles et motifs ne remplacent pas cette preuve. Le programme n’accorde aucun droit et ne change pas les comptes.

### Refus sur l’hébergement mutualisé et diagnostic

La [documentation officielle Infomaniak, FAQ 1981](https://www.infomaniak.com/fr/support/faq/1981/gerer-les-utilisateurs-et-bases-de-donnees-mysqlmariadb), consultée le 17 octobre 2026, distingue les treize droits des profils lecture/écriture/administration et réserve `TRIGGER`, `EVENT` et les droits sur les routines au Cloud. Le Manager confirme que le compte de maintenance dispose déjà des trois profils sur la base source. Cela rend très plausible un refus de notre exigence `ALL PRIVILEGES`, sans constituer une observation SQL de ses grants réels. Aucun droit ni mot de passe n’a été changé.

`diagnose` acquiert la connexion avec la même identité séparée et TLS, puis publie uniquement des catégories fermées : correspondance de la base, portée exacte ou motif avec underscores, profil de droits, visibilité des métadonnées et état de l’inventaire. Il ne publie ni le `SHOW GRANTS` brut, ni les comptes, noms de bases, chemins, secrets ou empreintes d’authentification. Les erreurs de connexion ou de fermeture SQL sont désormais distinguées par `PRIVATE_CHECKPOINT_CONNECTION` ; elles ne permettent pas à elles seules de distinguer mot de passe, réseau et TLS.

Un résultat `inspection_diagnosed` signifie que le diagnostic a abouti, **pas que la sauvegarde est autorisée**. Au niveau supérieur, `captureAllowed: false`, `checkpointSaved: false`, `started: false` et `migrationPerformed: false` restent explicites. `diagnosis.inspectionPolicySatisfied` porte seulement sur la politique de visibilité et d’absence d’objets exécutables ; il ne prouve ni les trente tables/migrations, ni une capture cohérente, ni l’arrêt des producteurs. Le mode `inspect` et le chemin `capture --offline` gardent leur contrôle strict existant.

Si le profil observé est `shared_admin`, ou si le nom est un `raw_underscore_pattern`, la visibilité complète reste `unproven`. Le diagnostic ne transforme pas un compteur potentiellement filtré à zéro en preuve d’absence : il ne lit pas les vues des triggers/événements/routines dans ce cas. Plusieurs bases explicitement accordées au compte de maintenance ne justifient pas de réutiliser le garde-fou de namespace du compte applicatif.

**Suite conditionnelle :** relever le résultat neutre du diagnostic, puis préparer une stratégie de sauvegarde adaptée au fournisseur (ou un export fournisseur dont la couverture peut être vérifiée). Tout profil reposant sur les capacités contractuelles de l’hébergeur devra annoncer cette hypothèse et un niveau de preuve distinct dans le manifeste et le reçu. Il ne doit pas réutiliser silencieusement la certification complète actuelle. La pause et la bascule de domaine restent suspendues à une sauvegarde cohérente et vérifiée.

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

Le diagnostic personnel est encadré par Bash :

```sh
bash scripts/capture-private-checkpoint.sh diagnose \
  --private-directory /srv/customer/jessiemessage-private \
  --private-path-mode linux-dirfd \
  --destination-private-directory /srv/customer/jessiemessage-private/checkpoint-schema30-before-domain \
  --inspection-user COMPTE_INSPECTION
```

Le résultat attendu est `inspection_diagnosed`, avec les catégories de droits et `checkpointSaved: false`, `captureAllowed: false`, `started: false`. Il ne certifie aucune sauvegarde. Le mode strict `inspect` ne pourra ensuite produire `inspection_verified` que si ses droits et les trente tables/migrations sont réellement vérifiés. Si la politique reste insatisfaite, ne pas arrêter l’application et ne pas élargir les droits du runtime pour contourner le refus.

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

## Diagnostic 0.36 préparé après le refus personnel

Révision du diagnostic **`673921d13ff3da4bbe6a8f863391996cb5f3da80`**, arbre **`862fe79b866e1ea3bb3745bf3d61dbcb8f11e712`**, [PR brouillon #48](https://github.com/fredbuhr/jessiemessage/pull/48). Les cinq jobs de la [CI exacte du push](https://github.com/fredbuhr/jessiemessage/actions/runs/39030768169) sont réussis : **1 997 tests généraux**, 27 wrappers SQL ignorés dans ce job seulement ; **369 tests sans saut par MariaDB 10.11 et 11.4**, vingt tests Chrome applicatifs et une authentification Chrome/HTTPS/MariaDB. Le nouveau test SQL utilise les vraies métadonnées du driver. Une seconde relecture ne trouve pas de défaut bloquant dans le diagnostic, le CLI et le lanceur.

Checkout séparé `/srv/customer/jessiemessage-operator/checkpoint-diagnostic-673921d1` installé et syntaxe validée, arbre suivi propre. À **14:01:07.156 Europe/Paris le 17 octobre 2026**, le précontrôle réel est `ready_for_input`, sans connexion SQL ni capture. Le nouveau lanceur privé `0700` est créé exclusivement et relu à **14:03:00.471** : `/srv/customer/jessiemessage-private/checkpoint-schema30-diagnostic-673921d1.sh`, SHA-256 `e1d0c32853bd324093c50a846331aeef1a844e3ea2fdcc0b01c7b789a3b6617d`. Il épingle révision, arbre et propreté des fichiers suivis ; il accepte uniquement le diagnostic sans argument et ne peut pas lancer une capture.

Depuis la [console SSH Node.js personnelle](https://manager.infomaniak.com/v3/hosting/1446368/hosting/812119/ssh-terminal/Node.js/terminal), sans arrêter l’application :

```sh
bash /srv/customer/jessiemessage-private/checkpoint-schema30-diagnostic-673921d1.sh
```

Saisir uniquement dans cette console le mot de passe SQL existant du compte `fb4hmr_jm_mig`, puis Entrée. La saisie est masquée. Renvoyer seulement la ligne JSON contenant `inspection_diagnosed`, ou le code neutre d’erreur. Aucune saisie personnelle n’a été faite par l’agent ; la classification SQL réelle reste à obtenir. Le lanceur précédent reste conservé comme historique.

À **14:03:21.403**, le préflight du runtime actif **0.33 `f2677249`** passe encore, santé et disponibilité répondent **200**, et `/app` sur l’apex conserve son **302** vers `https://recette.jessiemessage.com/app`. Aucun arrêt, nouveau checkpoint, import, migration, changement de domaine, de clé ou de droit SQL n’a été effectué. La prochaine décision technique dépend du diagnostic réel et doit déboucher sur une sauvegarde adaptée au fournisseur, puis sur sa copie indépendante et sa restauration isolée avant la bascule.

## État de validation initiale — conservé comme historique

**Préparation du code et de l’hébergement validée le 17 octobre 2026.** Révision `ba7aed7e107c566768436e5399a00b95df40d530`, arbre `9de0af2f5f278e7f7a626e02f7517c32319c52fd`, [PR brouillon #47](https://github.com/fredbuhr/jessiemessage/pull/47). Les cinq jobs de la [CI exacte](https://github.com/fredbuhr/jessiemessage/actions/runs/38991898070) passent : **1 981 tests généraux réussis**, 27 wrappers SQL ignorés seulement dans ce job ; **368 tests sans saut sur chacune des MariaDB 10.11 et 11.4** ; vingt tests Chrome applicatifs et une authentification Chrome/HTTPS/MariaDB. La capture synthétique CI emploie GNU tar avec le vrai FD hérité ; l’acquisition réelle de l’identité d’inspection avec profil hébergeur passe.

Checkout séparé `/srv/customer/jessiemessage-operator/checkpoint-ba7aed7e`, installation verrouillée et syntaxe vérifiées à **03:43:27.621 Europe/Paris**. À **03:43:42**, le contrôle réel annonce `ready_for_input`, `databaseConnected: false`, `checkpointSaved: false`. Le lanceur propriétaire `0700`, créé exclusivement et relu à **03:44:30.814**, est `/srv/customer/jessiemessage-private/checkpoint-schema30-ba7aed7e.sh` ; SHA-256 `ba30f91cf964bd054409a349b0afe2faa76fd2d3390c67fc5fba3a315631eab0`. Il épingle révision, arbre et propreté des fichiers suivis avant de demander le secret dans la console personnelle.

À **03:45:14.592**, les contrôles de préparation passent encore ; le préflight du service 0.33 est conforme, santé/disponibilité répondent 200 et l’entrée apex conserve son 302 vers recette. Aucun arrêt, capture réelle, nouveau checkpoint, import, migration, changement de clés, droit ou domaine n’a été effectué. L’inspection personnelle a été tentée à 13:48 Europe/Paris et a échoué avec `PRIVATE_CHECKPOINT_INSPECTION`. Le nouveau diagnostic précis est préparé pour identifier la cause SQL réelle ; aucune capture n’est attestée.

Le lanceur initial `checkpoint-schema30-ba7aed7e.sh inspect` est conservé comme historique. Après son refus personnel, utiliser uniquement le nouveau diagnostic ci-dessus ; ne pas relancer cette inspection à l’aveugle.

Les tests utilisent exclusivement des comptes, clés, SQL et photos fictifs. Ils couvrent les fichiers privés réels, la création et la lecture de Gzip/TAR, les altérations, les liens, les substitutions de répertoire, les refus de droits, les annulations et l’effacement des secrets en mémoire. La CI Linux doit exercer le véritable FD hérité vers GNU tar ; l’environnement local dont procfs est simulé emploie uniquement un adaptateur de fixture identifié. Ces essais de code et le précontrôle hébergé ne remplacent pas l’inspection, la capture, la copie indépendante et la restauration réelles.
