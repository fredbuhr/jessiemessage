# 0.65 — sauvegarde des réglages privés et contrôle de restauration

> Interface historique 0.65 : les appels de récupération ci-dessous décrivent cette version. Le CLI courant exige désormais une preuve fraîche et une confirmation liée au plan ; voir [C2 — récupération 0.72](witness-recovery-072.md). Les preuves datées 0.65 restent inchangées.
**Étape 4/6, volet logiciel.** La capture gérée inclut désormais la préparation privée et les journaux chiffrés de fermeture. La restauration de ces fichiers conserve leur contexte d’origine et passe par une quarantaine bloquée au démarrage. Ce lot ne fournit pas la continuité indépendante du registre et n’active pas les fermetures réelles. La version 0.65 est activée le 19 octobre à 01:07 Europe/Paris (minute affichée), avec les fermetures réelles désactivées. Lire les preuves ci-dessous ; un contrôle CI seul ne constituerait pas ce déploiement.

## Capture cohérente

Le parent de sauvegarde transmet son dossier d’exploitation au processus de capture par `--operations-directory`. Cette option fermée exige le profil `photos-notify-recovery-crm-broadcast`. Les appels historiques sans cette option restent lisibles et gardent leurs formats.

Les reçus de checkpoint **9 (strict) et 10 (tables applicatives)** ajoutent `operations: {file, bytes, sha256}`. Les manifestes SQL restent **9/10**, les reçus historiques **7/8**, les trente migrations et les six clés existantes restent inchangés. Aucune dépendance ajoutée. Il faut distinguer version du manifeste et version du reçu.

`operations.enc.json` est une capsule AES-256-GCM, sous-clé HKDF dérivée de la clé CRM et namespace distinct. Son AAD lie la version/profil du reçu, sa date, l’empreinte du manifeste brut, celle du SQL Gzip et celle de l’inventaire des photos. Son contenu authentifié garde la base et l’empreinte physique d’origine et les octets exacts des fichiers :

- `privacy-preparation.json`, si une préparation existe ;
- `erasure-<empreinte opaque>.json`, y compris les intentions et reçus terminés.

Les jetons d’appariement PC, états de transfert, captures précédentes et mots de passe sont exclus de cette capsule. Les six configurations secrètes continuent d’utiliser leur coffre séparé existant. Il n’y a ni nouvelle clé ni export de clé privée GPG.

Chaque fichier source est privé, régulier, à lien unique, ouvert sans suivre les liens, borné et authentifié avec son format d’origine. Un journal sous une mauvaise clé/base/racine, un verrou de publication présent, un nom de journal invalide ou une quarantaine rendent la capture indisponible. Inventaires et octets sont comparés avant/après, puis de nouveau avant le succès. Le parent reste responsable de l’arrêt réel des producteurs ; cette comparaison n’est pas un verrou de maintenance.

La capsule entre dans la liste fermée du tar et la vérification intégrale de ses octets. Les anciens lecteurs ne doivent pas être utilisés pour certifier cette nouvelle couverture. Les lecteurs actuels refusent aussi un fichier de capsule présent qu’un reçu abaissé en version tenterait de cacher. L’import SQL et la reprise conservent exactement le périmètre opérationnel du précontrôle jusqu’au résultat final.

## Restauration de contrôle

`scripts/restore-private-operations.mjs` utilise les configurations existantes en lecture et n’ouvre aucune connexion SQL. Il exige une base et une racine de médias cibles indépendantes, un dossier de destination absent et un registre courant accessible. Il ne remplace ni la restauration native du SQL ni le contrôle des photos.

Premier appel, sans écriture :

```sh
node scripts/restore-private-operations.mjs check \
  --private-directory /chemin/configurations-privees \
  --operations-directory /chemin/exploitation-courante \
  --checkpoint-directory /chemin/exploitation-courante/capture-selectionnee \
  --destination-private-directory /chemin/quarantaine-absente \
  --database base_clone_isolee \
  --media-root /chemin/photos-clone-isole
```

L’appel retourne une empreinte `currentSha256` et des comptes agrégés. Le second reprend les mêmes paramètres, remplace `check` par `restore` et ajoute `--confirm-current-sha256 <empreinte obtenue>`. Cette confirmation porte sur les octets du registre courant observé ; **elle ne certifie pas leur fraîcheur indépendante**. Le dossier de destination doit encore être absent ; une reprise ne supprime et n’écrase jamais un dossier partiel.

Le registre courant doit contenir chaque reçu de la sauvegarde, à une révision au moins égale, avec le même début, une phase/date/cursor monotones et aucun conflit à révision égale. Les fermetures supplémentaires du registre courant sont conservées. Pour la préparation, la révision authentifiée la plus récente est conservée ; un conflit à révision égale bloque. Les fichiers sélectionnés sont copiés sans réécriture de leur chiffrement, noms ou rattachement.

Le marqueur `operational-restore.json` est durablement publié **avant** les fichiers récupérés. Il garde les empreintes de comparaison et les rattachements source/cible, sans identité client. Une annulation ou un résultat incertain laisse cette barrière en place. Le serveur configuré 0.65 refuse toute présence de ce marqueur, même si le registre est vide et les demandes de fermeture désactivées. La commande ne propose aucun moyen de le supprimer ou d’ouvrir les producteurs.

Le résultat reste `externalRegistryContinuityVerified:false`, `reconciliationRequired:true`, `sqlRestored:false`, `started:false`. Une base, machine ou racine différente exige encore une réconciliation contrôlée avec les reçus d’origine. La commande actuelle suppose que la source configurée et son registre courant sont encore accessibles ; elle n’est pas un protocole de reprise après perte totale de l’hébergement. Le plan en mémoire ne suffit pas à prouver qu’un ancien registre vide est le dernier registre.

## Fermeture reçue pendant une capture

Une intention peut être publiée après la première découverte, pendant le précontrôle ou le drainage HTTP. Avant toute reprise, le parent relit les intentions. S’il en reste une, ou si leur lecture échoue, il garde les producteurs arrêtés, termine en erreur et ne déclenche aucune tentative d’effacement implicite dans ce cycle. Le prochain démarrage doit utiliser le propriétaire de maintenance et ses préalables réels ; aucune barrière n’est contournée.

Le drapeau interne `accountClosures` est également admis par la liste fermée du vrai serveur configuré ; son chemin est exercé sans écoute avec des données fictives. Il reste absent de la commande de production. Aucune option HTTP ou variable d’environnement ne l’active.

## Vérifications et limites d’activation

Essais dédiés : capsule chiffrée peuplée/vide ; AAD SQL/manifeste/photos/date/profil ; altérations et mauvaises clés ; permissions/liens/verrous ; publication pendant capture ; reprise d’un reçu plus récent ; conflits et perte du registre ; préparation révisée ; quarantaine et interruption ; contrôle CLI sans écriture et confirmation périmée ; archives GNU tar réelles strictes/applicatives ; refus d’abaissement de version ; fermeture arrivée pendant précontrôle/drainage/échec de capture. Linux CI doit exercer les vrais descripteurs `/proc/self/fd`, sans adaptateur de chemins. MariaDB exerce le vrai serveur configuré avant écoute sur un marqueur, avec contrôle de non-mutation SQL.

Source gelée `f53d6982d0fd54e50fe7af43e1d08a5758553703`, arbre `51717124bf15df3845a97e4f675c8549d59715c2`, [PR #81](https://github.com/fredbuhr/jessiemessage/pull/81) fusionnée en `1dcb5fa3155e90c6b6bf2faa7f404fa01f14e876`. Cinq jobs source **39174491849**, PR **39174494568** et main **39174755468** réussis : **2 640 réussites générales / 2 668 tests / 28 wrappers SQL ignorés ; 405/405 sur chacune des MariaDB 10.11/11.4 ; 156/156 Chrome ; 1/1 HTTPS/MFA ; 494 sources et build conformes**. [Preuves structurées](verification-proofs/jm065-verification.json). En local contraint : build/syntaxe réussis ; suite générale **2 668 tests, 2 483 réussis, 185 ignorés, zéro échec**. Les sauts locaux ne sont pas présentés comme des preuves SQL, navigateur ou procfs.

Avant d’activer les fermetures :

1. Une continuité du registre attestée indépendamment du SQL et d’une vieille copie du dossier d’exploitation, avec traitement de sa perte. La capsule seule ne la fournit pas.
2. Un inventaire SQL privilégié réel et un propriétaire de maintenance excluant tous les écrivains. Le DML applicatif et des callbacks de test ne suffisent pas.
3. Le déchiffrement personnel de la capture courante sur le PC possédant déjà la clé, puis sa restauration native dans une base/racine réellement isolée. Les acquis de 0.46 restent acquis et ne remplacent pas ces preuves courantes.
4. Un protocole de réconciliation et de repli : après une fermeture réelle, ne jamais rouvrir une base restaurée avec 0.62 ou une version ignorant le registre. Ne pas supprimer un marqueur ni modifier un rattachement pour faire passer un démarrage.

Les demandes/effacements réels restent désactivés. Aucun compte réel supprimé, aucun message de test externe envoyé par ce lot.

## Mise en service du volet sauvegarde

Clone séparé `/srv/customer/jessiemessage-operator/operational-backup-065-f53d6982`, source/arbre figés et propres. Verrou de dépendances comparé à 0.62, seules versions racine neutralisées pour la comparaison ; modules existants repris, aucune installation. Sur Node 24.15.0 : **126/126 contrôles natifs ciblés, zéro saut**, incluant capsule, quarantaine, ancrage procfs, archive native et courses de capture.

Le premier ensemble élargi avait inclus les 32 fixtures de `private-checkpoint-verify.test.mjs`, qui imposent explicitement `pathMode:strict`. Toutes sont refusées à l’initialisation média sous `/srv` (02775, propriétaire root, groupe du processus), avec `MEDIA_UNAVAILABLE`, avant leur scénario ; ce lot de 158 contrôles était **126 réussites / 32 échecs** et n’est pas une preuve de succès. Ces 32 scénarios passent en CI sous leurs chemins stricts. Les huit fichiers adaptés au mode réel de l’hébergement ont ensuite été relancés sans modification du code : 126/126. La production conserve `linux-dirfd` et ses descripteurs validés ; aucune permission ni protection de chemin n’a été assouplie.

Préflight réel terminé le **18 octobre à 23:04:14.548649 UTC**, `passed`, `started:false`, `backupStarted:false`. Lanceur `/srv/customer/jessiemessage-private/start-primary-operational-backup-065-f53d6982.sh`, **849 octets**, 0700, SHA-256 `8ac14501e02220a50bf004cabb3c9fa2ca260f0d90d4bd98b5cc73b8fc1169c3`. Aucun drapeau de fermeture dans ce lanceur.

Run/Build 0.62 sauvegardés dans `manager-before-operational-backup-065.json` (0600), nouvelles commandes relues après rechargement ; build/redémarrage normal sans réinstallation, puis état Actif et modification **19 octobre 01:07 Europe/Paris**, à la minute affichée. Après le dernier message d’écoute observé : mesures **1792364908743 et 1792364968802**, intervalle **60 059 ms**, `current/OK`, aucun incident/échec, alertes correspondantes sans envoi en attente.

À **23:12:39.155839 UTC**, **149/149 contrôles HTTPS** réussis : 44 empreintes publiques exactes, deux origines, TLS vérifié, redirections non suivies, ressources privées et fichiers hors web protégés, mutations anonymes refusées. Le contrôle accepte l’absence de Content-Length autorisée par le serveur à transfert chunked, vérifie la valeur lorsqu’elle existe et les octets GET dans tous les cas. Les HEAD des API privées sont 405 selon leurs listes fermées ; la mutation de fermeture est `/api/admin/closures/clients/<id>`. Les deux premiers essais de harnais supposaient un Content-Length systématique puis des HEAD/une URL non conformes à ces routes ; ils ne sont pas comptés comme succès et n’ont provoqué aucune mutation.

Le repli immédiat reste 0.62, uniquement parce qu’aucun compte réel n’a été fermé : remettre les paramètres de `manager-before-operational-backup-065.json` et construire normalement, sans restaurer SQL. Son lanceur vérifié de 843 octets est conservé avec les configurations privées, la clé GPG et l’appariement PC. Ne jamais utiliser ce repli pour ouvrir une base restaurée après une fermeture réelle.

## Capture courante 0.65

Une capture supplémentaire a été demandée au parent géré par un horaire temporaire déjà échu. La configuration d’origine a été sauvegardée et les deux remplacements atomiques ont tenu le verrou commun aux captures avec les descripteurs privés vérifiés. Aucun lancement manuel `--offline` pendant l’activité, aucune modification de l’historique ni suppression de verrou. L’horaire exact **05:15 UTC** a ensuite été remis et ses octets/empreinte relus : `256b025cdf8f47046dc970ad6d603e864d5b98ad70cc04f129eed5228fff4b3c`.

Capture **`capture-1792365269393-ff5d9fa2282f06ec`**, du **18 octobre 23:14:29.393 à 23:14:35.602 UTC**. Le parent confirme `succeeded/OK`, `runtimeResumed:true`. Archive GPG **402 538 octets**, SHA-256 `46cd15488065ff03227cac34768d21f18d261acd43c8539652f76f5d6c10cd04`. Reçu applicatif **10**, quatre fichiers de médias, capsule opérationnelle authentifiée sous la clé CRM et rattachement source relu conforme. Aucune préparation personnelle ni aucun journal d’effacement n’existait alors : capsule explicitement vide, pas de preuve de continuité indépendante. Empreinte de la capsule : `32ab22974316ac67ec94e4e4457e9c324d3209bf39c9dbf16b387317f89cb78a`. Aucune clé privée GPG utilisée, exportée ou régénérée.

Après le **dernier redémarrage lié à cette capture**, mesures **1792365329099 et 1792365389156**, intervalle **60 057 ms**, `current/OK`, aucun incident/échec et aucune alerte en attente ; troisième mesure 1792365449203 également conforme. À **23:17:34.303 UTC**, source/arbre/version propres, trois archives cataloguées, horaire rétabli et santé/disponibilité **200** sur les deux origines.

La première attente de 90 secondes n’avait pas encore de nouveau reçu PC. Le dernier reçu observé à ce relevé est **1792364749973**, pour l’ancienne archive ; l’appariement est conservé. Le script Windows existant planifie un passage **toutes les quinze minutes** ; cette attente n’est pas une panne établie. La réception de la capture 0.65, son déchiffrement personnel et la restauration SQL native réelle restent des preuves séparées. Les fichiers privés `operational-065-managed-capture.json` et `operational-065-runtime-observation.json` gardent ces résultats sans contenu client.

À **23:22:05.819 UTC**, le **vrai CLI** de reprise passe son précontrôle sur cette capture 0.65 : trente tables/migrations, SQL Gzip **16873 octets**, SQL natif **79500 octets**, format d’import et client MariaDB vérifiés, empreinte SQL attendue conforme, couverture opérationnelle authentifiée. **Aucune connexion à la base cible prospective, aucun import ni démarrage** ; ce résultat ne remplace pas une restauration réelle. SQL Gzip SHA-256 `83c8f64a98f4f43d0598cd34d83f9d09042c6c82a83f3e4dd9092d1c21f7a4eb`, SQL natif `0359942fb4f00ec751f5a2a2267b28902514180dc746c4fc1c5258d9ee7b9668`. Le premier appel direct depuis un module stdin avait été refusé par le garde d’environnement (`--input-type=module`) ; le second appelle le fichier CLI normal, sans contourner ce garde.

L’outil Windows de vérification pour l’archive courante a été construit **en mémoire**, **22529 octets**, SHA-256 `fe4c7c9c90f2af95c799a4feb418126cdbed033d4f6ec5ee18b17d0b4f3bfb7a`. La fonction existante du bouton **Sauvegardes → Vérification ponctuelle sur le PC → Télécharger la vérification Windows** reste disponible, sans réinstallation du collecteur. La clé et sa phrase doivent rester sur le PC ; seul le résultat local `DECHIFFREMENT_VERIFIE` avec l’archive correspondante prouvera ce déchiffrement personnel.

[Preuves d’activation et de capture](activation-proofs/jm065-activation.json), [vue de l’hébergement actif](activation-proofs/jm065-activation-20261019.jpg).

À **23:23:24.936 UTC**, réception PC désormais confirmée : reçu **1792365660272 (23:21:00.272 UTC)**, identifiant `capture-1792365269393-ff5d9fa2282f06ec`, **402538 octets** et SHA-256 identiques au serveur. Le passage normal du collecteur a suffi ; aucun réappariement ni réinstallation. Santé/disponibilité restent 200 sur les deux origines, surveillance OK et aucune alerte en attente. Cette réception est acquise pour l’archive 0.65 ; elle ne prouve pas son déchiffrement personnel ni une continuité future du registre. Relevé privé final `operational-065-runtime-observation-r2.json`.

**Prochaine action personnelle limitée :** sur le PC habituel, **Sauvegardes → Vérification ponctuelle sur le PC → Télécharger la vérification Windows**, extraire le ZIP puis ouvrir `Verifier.cmd`. Choisir l’archive demandée et conserver la clé GPG existante dans son dossier. La phrase éventuelle se saisit uniquement dans la fenêtre GPG locale. Relever le résultat `DECHIFFREMENT_VERIFIE` pour cette archive ; aucune phrase, clé ou fichier déchiffré n’est à envoyer. Il reste ensuite une restauration native réellement isolée et les garanties de continuité/inventaire nécessaires avant de raccorder les fermetures. L’étape 4/6 reste donc ouverte ; les étapes 5/6 ne sont pas déclarées terminées.
