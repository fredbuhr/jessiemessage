# Admission photo et frontière du format de sauvegarde — 1 novembre 2026

État : code de la branche `fix/photo-acceptance`, base documentaire `127a4d57`, non fusionné, non publié et non déployé. Production 1.14.1 `c803c2c9` inchangée par cette mission. Aucun hôte, compte réel, donnée privée, SQL local, capture réelle, commit ou push exécuté.

## Correction livrée au parent

`server/media/shared-capacity.mjs:20` remplace le helper d’admission archive supprimé : verrou vidéo puis photo, somme des octets retenus, total configuré de l’autorité photo (10 Gio par défaut). Le profil vidéo isolé n’utilise son total que sans catalogue photo. Le budget live ne dépend plus des bornes 1 Gio/100 000 records ni de l’historique des allocations released.

`server/media/store.mjs:185` conserve validation de l’autorité, empreinte racine, owner_bytes et total_bytes persistés, réservations, compteurs et reprises/doublons. Seul le plafond photo par owner est retiré ; commentaire explicite à proximité du check. Le total configuré et le budget agrégé photo+vidéo restent effectifs. Aucun reset/purge/migration. `server/video/store.mjs:264` conserve admin-only, son total et son quota owner, puis applique le même budget agrégé configuré. Disque, réservations en vol et propriétaire transactionnel restent inchangés.

La note détaillée du lot live est `live-capacity-implementation.md` dans ce dossier.

## Sauvegarde manuelle : refus sans interruption pour un catalogue déjà hors format

Le format, ses lecteurs, ses limites et ses historiques restent identiques. Un élargissement à 10 Gio demanderait une qualification des nombreuses limites de lecture, chiffrement, copie, téléchargement, durée et espace temporaire ; il n’est pas inclus.

`server/backup/media-capacity.mjs:21` effectue un SELECT agrégé sans lock ni identifiant : octets des allocations non released, nombres de fichiers théoriques et records média historiques. Réponse uniquement `{withinFormat:boolean}` ; échec SQL/compteur/fermeture -> erreur générique. Les comptes sont des entiers sûrs. Une seule instruction donne un instantané SQL cohérent, sans lire les fichiers média. Le wrapper parent charge les six/sept fichiers privés existants en lecture, crée son pool, ferme le pool et efface ses copies de secrets.

`server/backup/manual-backup-service.mjs:20`, raccordé dans `server/index.mjs`, vérifie le format avant de créer une nouvelle intention durable. Le même requestId déjà accepté reste idempotent même si la capacité est devenue insuffisante ; une autre demande active conserve BUSY. HTTP 409 `backup_capacity_limit`, texte FR/EN explicite, archives antérieures toujours téléchargeables. Aucun nouveau code durable dans le fichier de demandes.

`server/backup/recurring-supervisor.mjs:172` refait la lecture comme dernier contrôle du preflight parent après les vérifications asynchrones de source/outils/recipient/espace et AVANT le contrôleur capable d’arrêter Node. Si une demande en attente devient trop grosse, elle échoue avec le code durable existant PREFLIGHT_FAILED et la messagerie continue. Aucun contrôle d’éligibilité backup ajouté au démarrage normal des fermetures.

Contre-revue indépendante de backup_capacity_review : scénario concret d’un upload franchissant 1 Gio pendant check-application trouvé dans le premier draft ; corrigé en déplaçant la lecture à la fin du preflight. Test synthétique de cette évolution ajouté et vert. Ne pas ajouter naïvement un throw dans le hook stopRuntime : le contrôleur considère déjà cet appel comme une tentative d’arrêt et force une reprise même si le runtime n’a pas été arrêté.

Limites explicites : ce probe indique l’éligibilité du catalogue média à cet instant, pas la santé de tous les fichiers ni les plafonds indépendants des autres tables/manifestes. Un upload finalisé après le probe ou pendant le drain peut encore dépasser la borne ; la capture garde ses contrôles exacts et son chemin de reprise. Une garantie atomique contre cette dernière course exigerait de geler l’admission pendant le probe/drain, hors correction minimale retenue ici. Aucun succès de sauvegarde hébergée revendiqué.

## Couverture exécutée

- Lot live délégué : `node --test tests/media-admission-budget.test.mjs tests/backup-media-admission.test.mjs` : 11/11, aucun échec/omission, unique passage.
- Groupe ciblé backup : `node --test tests/manual-backup-capacity.test.mjs tests/manual-backup-http.test.mjs tests/manual-backup-files.test.mjs tests/recurring-supervisor.test.mjs tests/manual-backups-ui.test.mjs` : 89 cas, 85 succès, 1 échec de fixture execArgv hérité du runner, 3 omissions natives explicites. Le helper garde execArgv strict par défaut ; seam interne ajouté et fixture corrigée avec `execArgv:[]`. Relance du seul cas défaillant : 1/1 succès.
- Après correction de la course de préparation, seuls les deux cas preflight affectés ont été exécutés : 2/2 succès (ordre final et dépassement pendant check-application sans stop/capture).
- Nouveaux cas seulement, `node --test --test-name-pattern='historical owner binding' tests/backup-snapshot.test.mjs tests/backup-recovery-store.test.mjs` : 2/2 succès. Snapshot exact, inventaire, progression recovery, fermeture/release/rebind avec owner_bytes82 et charge supérieure restent valides.
- Syntaxe du nouveau module, des fixtures SQL modifiées et `git diff --check` réussis. Aucune référence exécutable restante au helper d’admission archive supprimé.

Soit 99 cas exécutables distincts verts dans le domaine capacité/backup, avec 3 cas natifs omis explicitement ; deux cas preflight modifiés ont été requalifiés pour la correction de course. Les omissions ne sont pas des succès.

## Couverture écrite restant à qualifier en CI native

Nouveaux scénarios SQL : capacité live réelle 10 Gio, course photo/vidéo au total configuré, photos au-delà de l’ancien owner, owner vidéo toujours effectif, historique >50 000 allocations avec release sans double remboursement, frontière backup exactement 1 Gio puis +2048 octets admis live mais refusés par le probe sans mutation. Les trois fixtures stores/flow sont détaillées dans la note live.

`tests/local-closures.integration.test.mjs` utilise désormais ownerBytes82 pour ses photos synthétiques de580 octets et vérifie explicitement ce dépassement : fermeture, interruption après unlink, reprise et réouverture seront ainsi qualifiées avec le binding historique inférieur à la charge. `tests/manual-restore-operator.integration.test.mjs` raccorde le nouveau probe réel au seul transport loopback TLS synthétique déjà utilisé par ce test ; pas de relance locale.

## Contre-revue backend demandée en parallèle

RO du diff actuel http/image/image-worker/service : aucun bloqueur concret trouvé sur les tickets purpose séparés, rôle/token/compte/deadline, slot conservé jusqu’à sortie enfant et contexte final, conversion sans allocation/FS, limites32 Mio/2 Mio/64 MP, loaders natifs explicites et réponses binaires8slots/15s. Aucun test rejoué ; futurs codecs HEIC/AVIF/BMP exclus de cet avis.
