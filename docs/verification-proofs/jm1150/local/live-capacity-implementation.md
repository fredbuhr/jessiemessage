# Capacité live — lot photos 1.15.0

Implémentation autorisée par le parent le 1 novembre 2026, sur les fichiers stockage et fixtures assignés. Aucun accès hôte, compte, donnée réelle, SQL local ou opération Git.

## Contrat

- `server/media/shared-capacity.mjs:20` verrouille vidéo puis photo dans le profil vidéo, somme les octets actuellement retenus et prend le total de l’autorité photo. Le catalogue vidéo seul peut utiliser son propre total uniquement en absence complète de catalogue photo. État absent ou malformé : refus.
- `server/media/store.mjs:185` conserve le binding historique owner_bytes, total_bytes et empreinte root ; retire les plafonds photo par propriétaire, 1 Gio d’archive, objets retenus et historique à vie. Les nouvelles réservations restent bornées par le total configuré et la somme photo+vidéo. Reprises et doublons déjà chargés restent possibles à capacité pleine.
- `server/video/store.mjs:264` conserve le plafond vidéo par propriétaire et son binding ; remplace l’admission archive par le même budget global courant. Contrôle admin-only inchangé.
- `server/media/backup-admission.mjs` supprimé, sans import restant dans server/tests/scripts. Les limites de format de sauvegarde restent dans backup-limits et le préflight manuel du parent. Aucune purge, remise à zéro, migration ou modification du module capacity-store.

## Couverture écrite

- `tests/media-admission-budget.test.mjs` : photos au-delà de 1 Gio et de l’historique, ancien owner dépassé, frontière exacte 10 Gio, rejet avant écriture, reprise et doublon au plafond.
- `tests/backup-media-admission.test.mjs` : total partagé, ordre des verrous, 11 vidéos de 100 Mio sous 10 Gio, profil photo seul, fallback vidéo isolé, états invalides et historiques surdimensionnés.
- `tests/media-store.integration.test.mjs:623` : propriétaire photo dépassable, concurrence au vrai plafond 10 Gio sans fichiers géants, historique >50 000 allocations, release unique et absence de double remboursement.
- `tests/backup-media-admission.integration.test.mjs` : photo/vidéo en course au total configuré 1 Gio, 11 vidéos admises sous 10 Gio, quota vidéo propriétaire conservé, historique surdimensionné préservé ; sauvegarde manuelle éligible à exactement 1 Gio puis refus explicite au-delà sans mutation des compteurs.
- `tests/media-flow.integration.test.mjs:674` : HTTP photo au-delà de l’ancien owner admis et compté, HTTP au vrai total refusé sans put ; capabilities préparation mises à jour selon le nouveau contrat backend.

## Contrôles exécutés

Un seul passage ciblé après modification du code : `node --test tests/media-admission-budget.test.mjs tests/backup-media-admission.test.mjs` : 11/11, 0 échec, 0 omission (~143 ms). Aucun replay du même code vert.

`node --check` réussi pour shared-capacity, media/store, video/store et les trois fichiers d’intégration modifiés ; nouvelle vérification syntaxe du seul media-flow après son delta capabilities. Recherche de références exécutables à l’ancien helper : aucune. Relecture des fixtures et expressions d’admission achevée sans bloqueur établi.

SQL MariaDB, HTTP intégration et état hébergé non exécutés localement ; qualification native attendue en CI. Les nouvelles fixtures SQL décrivent une preuve à obtenir, pas un résultat acquis.
