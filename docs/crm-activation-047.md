# JessieMessage — activation des fiches privées, étape 0.47

**État ultérieur :** les fiches sont acceptées personnellement à 00:31:47 ; l’[activation des diffusions 0.49](broadcast-activation-049.md) à 00:47 conserve ce module, les clés et les sessions. Le relevé ci-dessous garde les preuves de 0.47.

**Livré le 18 octobre 2026 à 00:15 Europe/Paris.** Le profil `messaging-photos-notify-recovery-crm` est actif sur l’origine principale et l’origine recette conservée. Les fiches privées, surnoms, notes chiffrées, tags, groupes et dates de suivi sont activés pour l’administrateur. Les diffusions restent désactivées. La réception d’une notification de rappel n’est pas ajoutée : la date de suivi est privée et affichée dans l’espace administrateur.

## Prérequis 0.46 effectivement levé

À **00:13:21 le 18 octobre**, le propriétaire fournit la capture du reçu réel de la nouvelle reprise unique. La pièce jointe locale est lisible malgré son message initial d’accès impossible. Les caractères visibles près de la saisie ne sont pas interprétés comme le mot de passe utilisé. Le reçu confirme :

```json
{
  "status": "application_checkpoint_restored_verified",
  "version": 6,
  "profile": "messaging-photos-notify-recovery-crm-application",
  "tables": 30,
  "migrations": 30,
  "sqlSha256": "95a8b201a7aeaa7317578c5e2f35468246b7976add2f776f5607499a959453dd",
  "checkpointFilesMatched": true,
  "independentMediaDirectory": true,
  "databaseConnected": true,
  "applicationSnapshotMatched": true,
  "imported": true,
  "sourceMutated": false,
  "capacityRebound": false,
  "httpStarted": false,
  "smtpStarted": false,
  "workersStarted": false,
  "action": "imported_empty_clone",
  "importedThisRun": true
}
```

L’import dans `fb4hmr_jm_crm30_20261017` et sa vérification SQL/snapshot/photos sont donc acceptés. L’archive indépendante et le coffre personnel avaient déjà été acceptés ; aucune nouvelle copie, phrase ou saisie SQL n’est demandée. Le périmètre reste limité aux trente tables applicatives et aux photos chiffrées du checkpoint ; objets SQL exécutables exclus/non prouvés, aucune réassociation du stockage. Références : [checkpoint courant](crm-checkpoint-046.md), [diagnostic et reprise](crm-checkpoint-046-incident.md).

## Source, contrôles et lanceur

Source exécutée **`edf696ec4874563aeaaa84b8986f18d146757c53`**, arbre **`3daa88c3b180fe1494245ea390807f800f783ae1`**, checkout **`/srv/customer/jessiemessage-operator/crm-checkpoint-resume-edf696ec`**. Le checkout est épinglé, propre et dispose des dépendances verrouillées installées sans scripts. Les commits documentaires ultérieurs ne remplacent pas cette référence servie.

Les [cinq jobs CI exacts](https://github.com/fredbuhr/jessiemessage/actions/runs/39073403629) réussissent : 2 258 réussites générales et 27 wrappers SQL ignorés ; 379/379 par MariaDB 10.11 et 11.4 ; 101/101 Chrome applicatifs ; 1/1 authentification HTTPS/MariaDB ; syntaxe, build et aperçu conformes. Les scénarios couvrent les conflits entre deux éditeurs du même compte et les deux origines ; ils ne prouvent pas encore les appareils personnels. Le [relevé de collaboration](crm-collaboration.md) décrit cette limite.

À **00:14:21.396776**, le nouveau lanceur propriétaire est créé exclusivement, relu et contrôlé :

| Élément | Valeur |
| --- | --- |
| Chemin | `/srv/customer/jessiemessage-private/start-primary-crm-checked-edf696ec.sh` |
| Mode / taille | `0700`, 771 octets |
| SHA-256 | `1264c585361131e1fa1a9dd6d2519a35024c430fc9946eebaac32d24bc9ec6d5` |
| Configuration conservée | `/srv/customer/jessiemessage-private/primary-origin-candidate-4a355851` |
| Déploiement / port / Node | `primary-transition`, 3000, 24.15.0 |

Le lanceur exige HEAD/arbre/Git propre, enlève `NODE_OPTIONS`/`NODE_PATH` et charge explicitement le profil CRM via les fichiers privés ancrés. Son mode `check` réussit avant activation : `checks_passed`, profil `messaging-photos-notify-recovery-crm`, `started: false`. Il vérifie les droits, les schémas physiques et le stockage sans listener, SMTP ou worker. Aucune clé ni configuration privée n’est remplacée ; aucune migration n’est exécutée.

## Activation dans le Manager

Le propriétaire a autorisé la poursuite des opérations nécessaires au projet. Après validation de la sauvegarde/restauration et du préflight, le Run et le Build sont remplacés dans le Manager, qui confirme « Le site a été mis à jour ». Node reste à 24 et le port à 3000. Aucun paramètre DNS, domaine, session ou notification n’est modifié.

Run :

```bash
bash /srv/customer/jessiemessage-private/start-primary-crm-checked-edf696ec.sh
```

Build :

```bash
cd /srv/customer/jessiemessage-operator/crm-checkpoint-resume-edf696ec && test "$(git rev-parse HEAD)" = edf696ec4874563aeaaa84b8986f18d146757c53 && test "$(git rev-parse HEAD^{tree})" = 3daa88c3b180fe1494245ea390807f800f783ae1 && test -z "$(git status --porcelain)" && npm run check
```

Le build est lancé sans supprimer les dépendances déjà vérifiées ; le Manager prévoit le redémarrage automatique après succès. À **00:15**, la console confirme `JessieMessage listening on port 3000` et le reçu `started` du profil CRM avec `deployment: primary-transition`. Le Manager affiche ensuite **Node.js Actif**, un build terminé sans erreur et « Dernière modification le 18/10/2026 à 00:15 ».

## Contrôles après redémarrage

À **00:16:25.255438**, **56/56 contrôles HTTPS** et **seize comparaisons exactes de ressources** réussissent avec la validation TLS normale sur les deux origines. Le checkout de référence est encore épinglé et propre.

- Santé et disponibilité : `ok` et `ready`, HTTP 200 sur les deux adresses.
- Accueil, aide, traductions et horloge de session : ressources attendues et empreintes identiques au code servi.
- Douze contrôles CRM : API capacités/contacts/étiquettes et trois fichiers du module refusés anonymement avec HTTP 401 et `Cache-Control: no-store`.
- Diagnostic administrateur également protégé ; fichier privé `runtime-crm.json` et brouillon d’information non servis.
- Routes et module de diffusion toujours absents ; récupération disponible sur l’origine principale seulement.

Ces sondes sont des GET anonymes, sans cookie, compte réel, POST, note, e-mail ou Push. L’opérateur n’a pas de session administrateur JessieMessage dans ce navigateur. Une réponse 401 prouve la protection anonyme, et non le rendu ou une sauvegarde authentifiée. La recette CI et le préflight ne remplacent pas une observation personnelle.

## Observation personnelle ciblée

Depuis les deux appareils administrateur habituels, actualiser l’application après avoir enregistré tout brouillon utile. Ouvrir une conversation, puis **Fiche** : vérifier surnom, notes, tags/groupes et rappel privé. Enregistrer une petite note sur un appareil, puis rafraîchir la fiche sur l’autre et vérifier la concordance. Pour vérifier un conflit, ouvrir la même version sur les deux appareils, enregistrer sur le premier puis essayer sur le second : le second brouillon doit rester visible avec le choix explicite de recharger ou de conserver sa version. À **00:31:47 Europe/Paris le 18 octobre**, le propriétaire répond « C’est bon ça fonctionne » au parcours proposé. Ce retour accepte globalement le fonctionnement essayé de la fiche partagée. Aucun test de conflit, inventaire de plateformes ni couverture de tous les appareils n’est déduit ; aucune répétition globale n’est demandée. Aucun reset administrateur ni répétition générale des photos, notifications ou récupération n’est demandé.

## Repli et suite

Le repli direct est le Run 0.42 conservé :

```bash
bash /srv/customer/jessiemessage-private/start-primary-operations-checked-ed78b55e.sh
```

Son Build reste celui du checkout `operations-report-ed78b55e`, source `ed78b55e99480ce07967b4c54c7e2de13e46951e`, arbre `5bdb9e75989ca30ad800053ed783dd6ed3edfd70`, avec les gardes Git et `npm run check` déjà conservés dans le [relevé 0.42](operations-diagnostic.md). Le repli passe par le Manager et une relance contrôlée, jamais par un second serveur SSH. Il désactive les fiches tout en conservant leurs tables et leur clé ; aucun ancien état de sessions, mots de passe ou SQL n’est restauré. Après création de notes réelles, conserver les outils CRM pour toute sauvegarde/restauration, y compris si le runtime revient à 0.42.

Étape 0.47 acceptée : activation, contrôles opérateur et parcours personnel essayé validés à 00:31:47. Suite : préparation distincte des envois groupés ; sauvegardes récurrentes avec copie indépendante et surveillance/alerte restent au bilan d’exploitation.
