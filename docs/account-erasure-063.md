# Moteur de fermeture définitive — 0.63

Étape **2/6**, après les choix acquis de 0.62 : Jessie en France, espace privé sans structure ; conversations conservées jusqu’à la fermeture définitive du compte. Le moteur vise la base active et les fichiers appartenant au compte invité. Il ne prétend pas supprimer les sauvegardes, téléchargements ou notifications déjà affichées.

## Portée de cette livraison

La bibliothèque est implémentée et éprouvée sur des comptes fictifs dans les deux MariaDB de CI. Elle n’est reliée à aucune route HTTP, tâche périodique ou commande de suppression de production. Aucun compte réel n’est fermé. Le runtime 0.62 reste la référence active jusqu’à l’intégration du parcours de l’étape 3.

`createAccountErasure` impose un adaptateur `withQuiescedProducers` qui doit exclure et drainer tous les producteurs pendant l’opération : accès/mutations, uploads, transports SMTP/Push, campagnes et captures. Aucun adaptateur de production permissif, booléen « offline » ou repli sans maintenance n’est fourni. Le verrou consultatif MariaDB sérialise seulement les effaceurs ; il ne neutralise pas les workers existants. L’exclusion réelle et son maintien seront raccordés et vérifiés avec le parcours graphique avant une activation.

## Protocole et interruption

1. Vérifier l’identité de la base, le schéma à 30 migrations/29 tables, les 40 contraintes étrangères RESTRICT et leur activation, la cible de rôle client, les rattachements et l’empreinte du stockage.
2. Écrire une intention chiffrée durable hors SQL, avant tout effacement. Une mauvaise clé ne peut pas masquer un journal existant.
3. Dans une transaction : retirer sessions, challenges et files, invitations consommées, conversation/messages/événements/reçus, profil et appartenances CRM. La ligne du compte est rendue inactive et minimisée ; le journal média et sa charge restent présents. Toute incohérence annule la transaction.
4. Par passes de 1 à 100 objets : effacer durablement les variantes complète et miniature, puis libérer la charge SQL une seule fois. Les objets réservés, déjà retirés ou `released` sont aussi parcourus ; leur journal conserve la clé nécessaire à une reprise. Une suppression incertaine ne libère pas la capacité. Un curseur n’est avancé qu’après accusés positifs.
5. Contrôler l’absence de dépendances, retirer les métadonnées médias libérées et le compte, vérifier le résultat puis conserver un reçu minimal chiffré. Une reprise après COMMIT ou renommage appliqué mais non acquitté relit l’état durable. Aucune répétition automatique à l’intérieur d’une passe en échec.

Le journal utilise les protections communes : répertoire privé ancré Linux, fichier 0600, JSON canonique borné, verrou court, révision optimiste, fsync et remplacement atomique. AES-256-GCM, sous-clé HKDF distincte dérivée de la clé CRM existante ; AAD liée au compte, à la base, à la racine média et à la révision. Aucun nouveau secret persistant ni migration SQL. Le nom opaque est indépendant de la clé de chiffrement. Phases et curseur sont monotones ; un reçu terminé n’est pas remis à zéro.

Une lecture de récupération paginée retrouve les identifiants à partir des journaux chiffrés, même si la ligne SQL a déjà disparu avant l’accusé final. Elle utilise le même répertoire ancré, vérifie que le nom correspond à l’identité déchiffrée et ne crée aucun index nominatif en clair. Le raccordement du superviseur pourra donc reprendre les travaux sans dépendre de l’onglet d’administration resté ouvert.

## Données partagées

Les photos appartenant à Jessie et réutilisées dans d’autres échanges restent dans sa bibliothèque. Les liens de la conversation fermée sont retirés ; les autres échanges et fichiers sont conservés. Une photo appartenant au client mais liée à une autre conversation ou campagne est une incohérence bloquante, pas une autorisation d’effacer des données étrangères.

Les audiences chiffrées des campagnes sont vérifiées contre leurs destinataires SQL et leur empreinte, avec la **clé de messages/diffusions** existante. Le destinataire fermé est retiré, l’audience restante rechiffrée et son empreinte recalculée dans la même transaction. Les compteurs restent dérivés des lignes. Une campagne sans destinataire est retirée. Les lignes des autres destinataires et les identifiants de livraison restent identiques ; une ancienne requête de création avec l’audience originale entre en conflit plutôt que de la recréer silencieusement.

Les libellés CRM communs, états MFA administrateur, compteurs anti-abus globaux et historique de migrations sont conservés. Une invitation consommée est retirée entièrement ; son jeton n’est pas rouvert en dissociant consommateur et date. Les envois déjà émis ne sont pas rappelés par la suppression de leurs jobs.

## Sauvegardes et limites d’activation

Le résultat qualifie explicitement `active_database_and_client_owned_media`, `backupCopies: separate_not_erased` et `externalCopies: not_checked`. Le reçu ne contient ni e-mail, pseudonyme, message, photo ou destination Push : seulement identifiant opaque de compte, liaison technique, dates, phase et curseur. Il doit rester indépendant d’un retour à une ancienne base.

Un compte réapparu sous un reçu terminé déclenche `ERASURE_RESTORE_REPLAY_REQUIRED`, sans prétendre à un effacement courant. Le rejeu contrôlé des fermetures sur une restauration, les changements de racine et la conservation de ces reçus restent à intégrer avant réouverture d’une copie restaurée. Le moteur seul ne constitue pas ce protocole de restauration.

La vérification des métadonnées n’est pas une preuve d’absence de producteurs externes ou d’objets SQL invisibles à un compte DML. L’adaptateur de maintenance et le périmètre exact des privilèges devront être contrôlés avant activation réelle. Les vérifications synthétiques ne remplacent pas cette condition.

## Vérification

Tests ciblés : chiffrement et relecture sur disque, refus de mauvaise clé/tag/révision, liens et permissions, écritures concurrentes, perte d’accusé de renommage, phases monotones, pertes d’accusé SQL avant toute action suivante, erreur physique sans libération, reprise bornée, mauvaise racine et refus des cibles administrateur. Le cas Linux CI exerce le vrai ancrage procfs.

Les intégrations MariaDB emploient uniquement une base loopback explicitement nommée `jessiemessage_test…`, des secrets fictifs et un répertoire média indépendant. Elles suppriment effectivement le graphe fictif et les fichiers chiffrés, comparent le pair avant/après, vérifient les campagnes partagées et simulent les accusés COMMIT/GET_LOCK perdus. Aucun listener, transport ou worker n’est lancé. Les résultats observés sont consignés ci-dessous.


## Livraison vérifiée

Source `71de968ebe5a036ffdd76325844b68c148069648`, arbre `e0ff079995cc8ee33f0b33085f298c7d262c0bef`, [PR #79](https://github.com/fredbuhr/jessiemessage/pull/79), merge `8b5a2f5b7f405aec473861d0b5f1706dca3165c2`, repère `release/0.63.0`. Les CI [source 39169092096](https://github.com/fredbuhr/jessiemessage/actions/runs/39169092096), [PR 39169094740](https://github.com/fredbuhr/jessiemessage/actions/runs/39169094740) et [main 39169308502](https://github.com/fredbuhr/jessiemessage/actions/runs/39169308502) réussissent leurs cinq jobs chacune : **2 592 réussites générales et 28 wrappers SQL ignorés sur 2 620 cas**, zéro échec ; **402/402** sur chaque MariaDB 10.11 et 11.4, dont quinze cas liés à ce moteur, sans saut ; **144/144 Chrome**, authentification HTTPS/MFA, syntaxe de **480 sources** et build réussis. Le journal réel ancré procfs et sa découverte sont exercés en CI Linux.

Localement, **25/27 contrôles ciblés** passent ; les deux cas procfs/CI indisponibles dans scratch sont explicitement ignorés et passent en CI. La validation générale de référence est la CI Linux de la source figée. L’ensemble validé n’ajoute ni dépendance, migration, clé persistante, endpoint ou worker. Aucun compte réel n’est effacé, aucun message ni e-mail réel envoyé. Les [preuves structurées](verification-proofs/jm063-verification.json) qualifient cette livraison comme **non activée**, et le [point de reprise](REPRISE.md) conserve le runtime 0.62 et son repli 0.61.
