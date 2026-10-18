# 0.65 — sauvegarde des réglages privés et contrôle de restauration

**Étape 4/6, volet logiciel.** La capture gérée inclut désormais la préparation privée et les journaux chiffrés de fermeture. La restauration de ces fichiers conserve leur contexte d’origine et passe par une quarantaine bloquée au démarrage. Ce lot ne fournit pas la continuité indépendante du registre et n’active pas les fermetures réelles. La dernière activation documentée au début du lot reste 0.62 ; ne pas présenter un contrôle CI comme un déploiement.

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

Le résultat CI exact est consigné après gel de la source. En local contraint : build/syntaxe réussis ; suite générale **2 668 tests, 2 483 réussis, 185 ignorés, zéro échec**. Les sauts locaux ne sont pas présentés comme des preuves SQL, navigateur ou procfs.

Avant d’activer les fermetures :

1. Une continuité du registre attestée indépendamment du SQL et d’une vieille copie du dossier d’exploitation, avec traitement de sa perte. La capsule seule ne la fournit pas.
2. Un inventaire SQL privilégié réel et un propriétaire de maintenance excluant tous les écrivains. Le DML applicatif et des callbacks de test ne suffisent pas.
3. Le déchiffrement personnel de la capture courante sur le PC possédant déjà la clé, puis sa restauration native dans une base/racine réellement isolée. Les acquis de 0.46 restent acquis et ne remplacent pas ces preuves courantes.
4. Un protocole de réconciliation et de repli : après une fermeture réelle, ne jamais rouvrir une base restaurée avec 0.62 ou une version ignorant le registre. Ne pas supprimer un marqueur ni modifier un rattachement pour faire passer un démarrage.

Les demandes/effacements réels restent désactivés. Aucun compte réel supprimé, aucun message de test externe envoyé par ce lot.
