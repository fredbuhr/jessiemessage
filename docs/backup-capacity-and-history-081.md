# Capacité des copies et préparation de l’archivage — lot 2

Ce document décrit les limites conservées et le dry-run synthétique du lot 2. La version effectivement livrée et ses preuves restent dans [REPRISE](REPRISE.md). Il ne constitue ni une commande de rotation, ni une autorisation d’effacer des archives, des reçus ou le registre des fermetures.

## A05 : cohérence de l’admission média

L’admission des nouvelles allocations média applique un plafond de **1 Gio de charge chiffrée réservée** et **50 000 objets non libérés**, indépendamment du quota SQL/configuré existant. Une allocation couvre les deux variantes et leurs deux enveloppes : `full_bytes + thumbnail_bytes + 80` octets. Deux fichiers par objet donnent au plus 100 000 fichiers. Les constantes partagées par l’admission et les validateurs de capture/reçu sont dans [backup-limits.mjs](../server/media/backup-limits.mjs).

Ce plafond d’admission ne réécrit pas le singleton de capacité SQL, les configurations, les clés ou les bindings de captures existants. Il ne supprime aucune donnée déjà présente. Les fichiers physiques inattendus, divergents ou surnuméraires restent des motifs de refus à examiner, jamais des candidats à un nettoyage automatique. Un ancien état au-dessus du plafond ne doit pas être déclaré sauvegardable par cette seule règle d’admission.

| Étape | Limite conservée | Contrôle |
| --- | --- | --- |
| Inventaire média chiffré | 1 073 741 824 octets ; 100 000 fichiers ; fichier ≤10 Mio +128 octets | [checkpoint-files](../server/backup/checkpoint-files.mjs), [reçu](../server/backup/checkpoint-receipt.mjs) |
| Snapshot SQL | 100 000 lignes cumulées ; objets + assets ≤100 000 | [snapshot](../server/backup/snapshot.mjs) |
| SQL extrait / comprimé | 64 Mio / 16 Mio | [capture](../scripts/private-checkpoint.mjs), [import](../scripts/import-application-checkpoint.mjs) |
| Manifeste | 64 Mio ; 2 millions de nœuds JSON ; profondeur 64 | [manifest](../server/backup/manifest.mjs) |
| Reçu / capsule opérationnelle | 32 Mio / 64 Mio | [checkpoint-receipt](../server/backup/checkpoint-receipt.mjs), [operational-checkpoint](../server/backup/operational-checkpoint.mjs) |
| Archive tar décomprimée et `.tar.gz` | 2 Gio chacune | [checkpoint-archive](../server/backup/checkpoint-archive.mjs), [capture](../scripts/private-checkpoint.mjs) |
| GPG | source ≤ 2 Gio ; sortie ≤ 2 Gio + 4 Mio ; compression GPG désactivée | [checkpoint-encryption](../server/backup/checkpoint-encryption.mjs) |
| Catalogue, copie et vérification PC | 2 Gio + 4 Mio | [copy-catalog](../server/backup/copy-catalog.mjs), [verification-kit](../server/backup/verification-kit.mjs), scripts Windows existants |

Sous ces limites, la somme maximale des contenus tar est de **1 200 Mio** : 1 024 Mio de médias, 64 de manifeste, 32 de reçu, 16 de SQL comprimé et 64 de capsule. En ajoutant un en-tête de 512 octets et au plus 511 octets de padding pour chacun des 100 004 membres, le répertoire média et un bloc terminal GNU tar complet, le total reste sous **1 298 Mio**. Une réserve supplémentaire de 1 Mio couvre l’expansion gzip de cette entrée bornée ; la marge restante sous 2 Gio est supérieure à 700 Mio. Le contrôle de taille effectif du producteur, du vérificateur et de GPG reste présent.

Cette preuve est **conditionnée aux autres plafonds du tableau**. Elle corrige le désaccord d’admission média en octets/fichiers ; elle ne garantit pas une croissance illimitée de la base ou des conversations. Deux lignes média par photo, les messages, les tombstones, les journaux SQL et les autres tables partagent notamment le plafond de 100 000 lignes du snapshot. Aucun plafond SQL global d’admission ni nouveau mécanisme de rotation des conversations n’est ajouté. Les délais restent aussi distincts : tar 120 secondes, GPG 180 secondes, enfant de capture 300 secondes, transfert HTTP 600 secondes et vérification PC 600 secondes ; un réseau ou disque lent peut encore produire un refus explicite.

Les régressions [checkpoint-receipt](../tests/checkpoint-receipt.test.mjs) contrôlent le reçu à 1 Gio exact et à un octet de plus. [backup-volume-budget](../tests/backup-volume-budget.test.mjs) calcule le budget et le soumet au vrai validateur de métadonnées PC, sans créer une archive géante. Les tests tar/GPG/copie existants restent les preuves de leurs formats et refus ; ce calcul ne mesure pas leur débit au plafond sur le PC du propriétaire.

## A08 : avertir avant les limites d’historique

Le lecteur conserve ses refus stricts : **2 000 reçus** et **4 096 entrées totales** du dossier opérations. Toutes les entrées comptent dans ce second plafond, y compris dossiers de captures, configurations, journaux de fermeture et états auxiliaires. Une tentative normale produit deux reçus, `running` puis `succeeded` ou `failed` ; un historique normal plein représente donc environ 1 000 tentatives, moins en cas de publications supplémentaires ou incomplètes.

L’avertissement `HISTORY_CAPACITY_LOW` commence à **1 500 reçus ou 3 072 entrées**, soit 75 % de chaque plafond. Il reste alors 500 reçus, environ 250 tentatives normales, ou 1 024 places de dossier ; ce ne sont pas des délais garantis. Il ne suspend ni les copies ni les captures et ne masque pas un échec prioritaire. L’administration dispose d’un texte FR/EN ; le moniteur et le circuit d’alerte existants portent le même code, avec leurs confirmations et limites de livraison habituelles.

L’inventaire distant relu par l’opérateur le **20 octobre 2026 à 01:17:14.374869Z** comptait 20 entrées, 8 reçus et 4 dossiers de capture. Ces comptes sont datés, sans saturation urgente observée. Ils ne dispensent pas du futur avertissement et ne prouvent pas le nombre de copies indépendantes effectivement conservées.

Si les entrées sont surtout des journaux de fermeture ou des états auxiliaires, déplacer des captures ne suffira pas à réduire ce volume. L’avertissement doit alors déclencher une intervention de capacité distincte ; il ne permet jamais de retirer ces journaux pour faire passer le compteur. Le présent lot ne résout pas une croissance illimitée du registre.

## Préparation d’une rotation manuelle : portée qualifiée

**La sélection, la copie synthétique et les invariants de conservation sont qualifiés ; l’exécution d’un archivage actif reste à implémenter/qualifier. A08 n’est donc pas entièrement clos par l’avertissement.** Il n’existe dans ce lot aucune commande qui retire de l’historique actif, aucune purge et aucune rotation automatique. Ne pas improviser des déplacements sur le service courant à partir de cette liste.

La future intervention opérateur doit respecter ces étapes :

1. Faire un inventaire privé daté des captures, reçus, statuts et empreintes. Sélectionner seulement des tentatives terminées et comprises. Une capture réussie et ses reçus `running`/terminal constituent un ensemble ; garder en actif au moins la capture récente vérifiée nécessaire aux copies courantes. Les tentatives incomplètes ou ambiguës restent hors sélection tant que leur état n’est pas expliqué.
2. Vérifier les destinations concernées et leurs copies indépendantes. Un déplacement hors du dossier actif retire l’archive du catalogue HTTP courant ; un PC qui ne l’a pas reçue ne pourra plus la demander à cet emplacement. Conserver l’archive sur un support privé accessible à la restauration manuelle, avec ses reçus et son inventaire. Une simple présence de fichier ne vaut pas reçu de copie vérifiée.
3. Préparer une maintenance réelle : drainage du parent et des producteurs, absence de capture ou transfert en cours, exclusion du verrou récurrent. Le démarrage courant ne doit pas être remplacé par un second parent. Le protocole d’arrêt/reprise et le plan de repli devront être qualifiés avant toute intervention réelle.
4. Copier la sélection dans un dossier privé distinct, hors du dossier opérations actif, en conservant 0700 pour les dossiers et 0600 pour les fichiers, sans lien symbolique ni lien dur. Comparer inventaire, tailles et empreintes avant d’envisager le moindre retrait de l’actif. Une copie partielle ou divergente ne permet pas de poursuivre.
5. **Conserver intégralement le registre actif des fermetures**, demandes en cours et reçus `completed` compris, ainsi que la préparation de confidentialité et les états de configuration/copie/alerte. Aucun `erasure-*.json`, clé, binding, marqueur, fichier d’autorité ou état PC n’appartient à la sélection d’archivage de captures. Un manque de place ne justifie pas leur suppression.
6. Pour toute archive restant restaurable, où qu’elle soit conservée, utiliser à la restauration un registre complet sélectionné par l’opérateur et **à jour jusqu’au moment de la restauration**, y compris les fermetures survenues après l’archivage. La capsule embarquée dans une vieille capture ne connaît pas ces fermetures futures. Une copie figée du registre à la date d’archivage ne suffit donc pas. Tant que l’inventaire des copies restaurables est incomplet, aucune purge de ce registre n’est prévue en V1.
7. Le futur exécuteur devra qualifier interruption/reprise de la copie, conservation des ensembles, publication du nouvel historique actif, relecture du catalogue et de la fraîcheur, disponibilité de la capture récente, puis reprise du parent. La baisse du compteur n’est pas, à elle seule, une preuve de restauration possible. Les commandes destructives et cette transition active restent différées ; elles ne sont pas simulées comme déjà livrées.

Le test [backup-history-retention](../tests/backup-history-retention.test.mjs) utilise de vrais fichiers privés et les lecteurs de reçus/capsules existants. Il choisit une vieille capture et ses deux reçus, les copie dans une archive synthétique, vérifie les empreintes et l’absence de changement des sources/historique/registre, puis ajoute une nouvelle fermeture. Le plan de restauration des capsules ancienne et récente conserve alors tous les reçus avec le registre courant. Le même test montre qu’une vieille capsule seule ne peut connaître une fermeture future. Aucun SQL n’est importé, aucun historique actif n’est retiré et aucun compte réel n’est effacé ; cette preuve porte sur ces invariants, pas sur un exécuteur de rotation ni une restauration SQL complète.

La V1 conserve sa limite : après perte simultanée de l’hôte et de fermetures non copiées, l’opérateur ne dispose pas d’une preuve autonome de complétude du registre. Le dry-run n’ajoute pas cette garantie abandonnée et ne réactive aucun ancien témoin.
