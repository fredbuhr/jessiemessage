# Capacité et inventaire privés des médias — 0.15

Ce lot ajoute des plafonds de stockage, une réservation SQL avant l'écriture des fichiers et un inventaire local sans suppression. Il conserve **contact@jessiemessage.com**, les dépendances, les cinq clés d'application et les visuels approuvés. Les migrations `0026` et `0027` ajoutent uniquement des tables ; elles ne sont jamais exécutées au démarrage du serveur. Aucune base réelle ni configuration d'hébergement n'a été modifiée.

## Ce qui est compté

Les deux variantes normalisées sont comptées avec leurs enveloppes chiffrées : **taille complète + taille miniature + 80 octets**. Ce calcul mesure la longueur des fichiers, pas les blocs physiques, les métadonnées du système de fichiers ou les sauvegardes.

| Paramètre | Valeur par défaut | Rôle |
| --- | --- | --- |
| `JESSIEMESSAGE_MEDIA_ACCOUNT_BYTES` | 1 073 741 824, soit 1 Gio | Plafond par propriétaire |
| `JESSIEMESSAGE_MEDIA_TOTAL_BYTES` | 10 737 418 240, soit 10 Gio | Plafond partagé |
| `JESSIEMESSAGE_MEDIA_MIN_FREE_BYTES` | 536 870 912, soit 512 Mio | Marge disponible avant une écriture |

Ces valeurs sont des réglages de développement configurables, à confirmer avec l'hébergement avant exploitation. Les variables acceptent des entiers décimaux canoniques en octets ; un plafond de compte supérieur au plafond global est refusé. La marge peut valoir zéro, notamment dans les fixtures synthétiques.

Les plafonds et l'empreinte privée du répertoire sont enregistrés dans MariaDB. L'empreinte dépend du chemin canonique, de l'identité du répertoire et de la clé média, sans exposer le chemin ou la clé dans les réponses. Un autre processus avec des plafonds ou un répertoire différents ne peut pas poursuivre silencieusement avec les mêmes compteurs. Modifier ces valeurs ou restaurer vers un nouveau répertoire exige une procédure de reprise explicite ; le lot ne fournit pas de réassociation automatique.

## Réservation, écriture et suppression

| État du journal | Capacité retenue | Suite autorisée |
| --- | --- | --- |
| `reserved` | Oui | Enregistrement après l'écriture ; aucune expiration automatique |
| `registered` | Oui | Média enregistré, réutilisable selon ses autorisations |
| `cleanup_pending` | Oui | Proposition dédupliquée devenue inutile ou média explicitement supprimé |
| `released` | Non | Historique conservé après suppression physique durable et acquittement SQL |

La transaction revalide le propriétaire courant, verrouille l'état global puis vérifie les deux plafonds. L'acquittement positif de la réservation précède tout `put`. Les lectures de compteurs sont des lectures SQL courantes ; les réservations concurrentes ne peuvent pas dépenser deux fois la même capacité.

Si un même contenu actif appartient déjà au compte, il est retourné sans nouvelle réservation ni écriture. Si deux processus proposent simultanément le même contenu, la proposition inutilisée passe à `cleanup_pending` dans la transaction de déduplication. Ses octets restent comptés jusqu'à la suppression de ses propres fichiers, puis à la libération SQL idempotente. L'identifiant et la clé du média canonique doivent différer de ceux de la proposition avant tout nettoyage.

L'enregistrement des métadonnées et la transition vers `registered` sont atomiques. Un acquittement perdu ne permet ni de supprimer les fichiers ni de libérer la capacité. Une erreur d'écriture, un refus après réservation ou une réponse incertaine peut donc conserver une réservation, même sans fichier complet. Ce surcomptage est volontaire : ni un délai écoulé ni une absence observée ne prouvent qu'une écriture ne peut plus aboutir.

La suppression explicite d'un média marque ses métadonnées et son journal dans la même transaction. Les deux variantes sont ensuite effacées et le répertoire synchronisé avant la libération SQL. Un effacement partiel ou échoué conserve toute la charge. Une nouvelle demande explicite peut terminer cette suppression ; un acquittement de libération perdu ne rembourse pas deux fois. Les lignes historiques restent présentes pour les références de messages et de campagnes.

Avant chaque écriture, `statfs` mesure les octets disponibles pour le compte système, sans compter les réserves du système. Le contrôle inclut la marge et toutes les propositions en attente ; il peut donc être conservateur lorsque certains fichiers sont déjà sur disque. Il ne garantit pas l'espace physique contre les écritures d'autres services ou l'épuisement des blocs et inodes.

Un plafond ou une marge insuffisante donne `507 storage_limit`, sans détail sur les autres comptes. Une capacité non initialisée ou incohérente reste indisponible. Aucune mutation n'est rejouée automatiquement.

## Inventorier et initialiser

Les commandes utilisent la configuration privée habituelle et le compte SQL d'exécution DML. Aucun secret ni chemin privé n'est transmis dans les arguments ou le rapport.

```sh
npm run media:storage -- inspect
```

Cette commande effectue uniquement des lectures : pages SQL de 100 lignes, inspection des fichiers attendus et parcours séquentiel du répertoire. Les objets et entrées sont plafonnés à 100 000 par inspection, les anomalies détaillées à 100 ; une limite ou une interruption rend le résultat explicitement incomplet et fait échouer la commande. Le rapport contient des compteurs et, pour les objets connus, des identifiants opaques. Il n'inclut ni photos, e-mails, textes, noms de fichiers inconnus, clés ou chemins absolus.

Les liens symboliques, liens physiques, fichiers non réguliers, permissions incorrectes, répertoire remplacé et variations observées sont refusés. L'inspection lit au plus les 24 octets d'en-tête d'une enveloppe. Le rapport annonce **`integrity: "structure_only"`** : une altération du ciphertext ou du tag GCM, ou une mauvaise clé lors du premier import historique, peut rester structurellement plausible. Ce contrôle ne remplace pas une lecture cryptographique autorisée ni une restauration vérifiée.

L'inventaire rapproche tous les médias connus, même jamais envoyés et même utilisés par une campagne future. Une photo sans message vivant n'est pas automatiquement un orphelin. Les propositions réservées, fichiers temporaires, objets inconnus et anomalies sont signalés, sans suppression. Deux passages SQL et le rapprochement des fichiers recherchent les dérives observables ; le parcours vivant ne constitue pas un instantané garanti.

Avant le premier démarrage avec les médias activés : appliquer séparément les 27 migrations, préparer le répertoire privé et arrêter **toutes** les instances HTTP et les workers. Puis :

```sh
npm run media:storage -- initialize --offline
```

`--offline` est l'engagement de l'opérateur que ces producteurs sont arrêtés ; la commande ne peut pas certifier l'arrêt de machines externes. Elle exige un inventaire complet sans fichier inconnu, temporaire ou dangereux, sans enveloppe structurellement invalide et sans média actif manquant. Elle importe tous les médias historiques, y compris les métadonnées supprimées dont l'effacement physique passé n'est pas prouvé. Des fichiers déjà absents pour ces seules métadonnées supprimées n'interdisent pas l'import ; leur capacité reste comptée par prudence.

L'import est transactionnel, par lots de 100 et limité à 100 000 médias historiques. Les dates historiques conservent leurs six décimales ; une création ou suppression située dans le futur refuse l'import sans laisser d'état ou de journal partiel. Un usage ancien dépassant les plafonds est compté fidèlement ; les nouveaux imports restent bloqués tant que l'usage ne permet pas de réservation. Le serveur refuse d'activer les médias avec un état absent ou un lien répertoire/plafonds incompatible. Aucune initialisation automatique n'est effectuée au démarrage.

## Validation et travail restant

Implémentation `8a03e5f14625a6c36844be313344f0bb2773314e`, [PR brouillon #14](https://github.com/fredbuhr/jessiemessage/pull/14), empilée sur #13 : [CI 38697899510](https://github.com/fredbuhr/jessiemessage/actions/runs/38697899510) réussie sous Node.js 24.21.0. **912 tests généraux réussis**, 18 groupes SQL ignorés uniquement sans base dans le job général ; **273 tests réels réussis sans saut sur chacune des versions MariaDB 10.11 et 11.4**, en dix-huit groupes séquentiels. Syntaxe et build réussis. Les fixtures couvrent notamment les réservations concurrentes, les plafonds par compte et globaux, la déduplication, les acquittements SQL perdus, les suppressions échouées, la dérive de schéma, l'import historique paginé, les scans incomplets et les entrées dangereuses.

Le lot ne recycle pas les réservations incertaines et n'efface pas les objets inconnus. Leur réparation demande un arrêt effectif des producteurs, une preuve durable de clôture et une procédure de reprise encore à implémenter. La réassociation après changement de répertoire ou de plafonds, les sauvegardes DB/médias/clés, la restauration cryptographique, la rétention et l'effacement des sauvegardes restent des travaux d'exploitation. Majorité externe, SMTP réel, hébergement et recette HTTPS/appareils restent dans le [plan de publication](NEXT-STEPS.md).
