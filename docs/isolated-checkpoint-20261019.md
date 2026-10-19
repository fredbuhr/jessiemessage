# Restauration applicative isolée du 19 octobre 2026 — D1

**Étape 4/6 ; D1 vérifié le 19 octobre à 21:08 Europe/Paris.** La capture applicative du jour a réellement été importée dans une nouvelle base isolée, puis vérifiée une seconde fois sans réimport. La copie reste en quarantaine. Le service source reste en **0.72.0**, observation, `closuresEnabled:false` ; aucune bascule, nouvelle capture ou manipulation personnelle du PC. [Preuves structurées](verification-proofs/jm-d19-isolated-restore.json).

## Cible et couverture vérifiées

Nouvelle base **`fb4hmr_jm_restore_20261019`**, sans site lié, avec le seul nouvel opérateur **`fb4hmr_jm_d19`**. Aucun droit du runtime ou du compte de migration ajouté, aucun mot de passe source changé. Le Manager affichait zéro octet ; la connexion native a ensuite prouvé l’identité, TLS et le vide SQL à **18:54:07.950 UTC**. `SHOW DATABASES` n’exposait ni la source ni les autres bases clientes. Cette frontière de namespace est une observation datée ; les grants mutualisés à underscores non échappés ne deviennent pas une qualification d’inventaire complet.

| Élément | Résultat |
| --- | --- |
| Données SQL | 30 tables physiques / 30 migrations ; dump et snapshot signé concordants |
| Données chiffrées | Vérification avec les six clés existantes ; aucune clé ajoutée à l’archive |
| Photos | Quatre fichiers chiffrés copiés physiquement et vérifiés ; racine indépendante du stockage actif |
| Capsule opérationnelle | Capsule v1 authentifiée, couverte par le reçu opérationnel v10 ; enveloppes et rattachement source conservés |
| Portée | `application-tables`, `completeDatabase:false` ; objets exécutables exclus, inventaire non prouvé |
| Cible ouverte | Aucun HTTP, SMTP, worker ou producteur ; `capacityRebound:false` |

L’inspection applicative source en lecture seule a aussi confirmé trente tables/migrations, sans capture ni migration. La capture choisie reste celle de **07:15 Europe/Paris le 19 octobre**, `capture-1792386945745-204e0e8e073b6131`, profil `messaging-photos-notify-recovery-crm-broadcast-application`, manifeste et reçu opérationnel v10. Elle représente son instant de capture ; elle ne prétend pas contenir les écritures du service survenues ensuite.

## Résultats réels

- **18:53:47.965 UTC :** copie exclusive et vérifiée sous `restore-d19-checkpoint`, dossiers 0700 et fichiers 0600, sans liens. TAR 402 002 octets, GPG 402 552, SQL Gzip 16 888, SQL brut 79 500. Empreintes dans les preuves ; GPG identique à l’archive personnellement déchiffrée au lot B. Aucun nouveau déchiffrement demandé.
- **18:54:08.255 UTC :** précontrôle natif réussi : format SQL fermé, manifeste signé, SQL, médias et capsule vérifiés ; aucune connexion cible d’import à ce stade.
- **19:04:10.518 UTC :** vrai CLI C2 → Unix → parent hébergé → PC existant, nouveaux défis authentifiés, puis `operational_quarantine_restored` sous `restore-d19-quarantine`. Révision 1, zéro reçu terminé/en attente, zéro fichier de registre ; `reconciliationRequired:true`, `sqlRestored:false`, `started:false`. Ce parcours ne teste pas une fermeture réelle : aucune n’est activée.
- **19:06:41.387–19:06:43.382 UTC :** import MariaDB natif du SQL authentifié dans la nouvelle base vide, `application_checkpoint_restored_verified`, `action:imported_empty_clone`. Trente tables/migrations, snapshot et fichiers concordants ; aucune mutation source par cet import.
- **19:06:45.264 UTC :** seconde exécution de reprise, après inspection du clone complet : `application_checkpoint_existing_clone_verified`, `action:verified_existing_clone`, `imported:false`, `importedThisRun:false`. Dump, données chiffrées, snapshot et fichiers revérifiés sans import.
- **19:06:45.382 UTC :** le garde de quarantaine refuse avec `OPERATIONS_RECONCILIATION_REQUIRED`. Marqueur conservé ; commit/arbre source, configurations et autorité originales relus inchangés.
- **19:08:09 UTC :** HTTPS source santé/disponibilité **200 / ok / ready** ; aucun serveur cible démarré.

La continuité fraîche acquise pour la copie opérationnelle reste une preuve séparée de la vérification SQL : celle-ci conserve `externalRegistryContinuityVerified:false`, `operationalRestorationPending:true`. Elle n’autorise aucune ouverture de cible.

## Reprise sans répéter l’import

Les CLI utilisés sont ceux de la **0.72.0**, source `94fb7882cf74eb5f2ec165e67833ac2e7cdf13f3`, arbre `c6d304e49209a1194d91c0992096e59ff3685b6e`, propres et inchangés. Les recettes datées [initiale](operator-recipes/isolated-checkpoint-20261019.mjs) et [révision 2](operator-recipes/isolated-checkpoint-20261019-r2.mjs) assemblent ces outils ; elles ne sont pas un lanceur du service. Syntaxe et revue indépendante vérifiées, puis parcours réellement exercé sur l’hébergement. Aucun changement du runtime applicatif ne justifie de le redéployer pour cet essai.

Le premier précontrôle PC avait réussi à 18:54:46.393 UTC, mais la première publication n’avait pas abouti. Le dossier cible était absent après l’arrêt. Le premier helper avait écarté le code texte du CLI : **la cause initiale reste inconnue**, aucune preuve ne permet de l’attribuer à son délai global. La révision 2 conserve les diagnostics fermés et les durées, refuse un précédent CLI encore actif ou une destination existante, et a permis une seule reprise réussie. Les résultats précédents sont conservés ; aucun contrat, permission, appariement ou témoin n’a été réinitialisé. Le plafond externe de reprise est 720 secondes ; les limites de fraîcheur et du protocole restent inchangées.

La configuration opérateur cible et ses reçus restent privés sous `restore-d19-operator` (0700 / 0600) ; le secret généré par le Manager a été transféré masqué, jamais mis dans les arguments, Git ou les preuves publiques. Les sorties `d19-*.json` et le checkpoint existant `jm0702-existing-pc-update.json`, section `developmentD`, font foi. Ne pas relancer une opération pour découvrir son résultat. L’outil de reprise vérifie une copie complète, refuse une copie partielle et ne nettoie jamais automatiquement celle-ci.

## Limites encore ouvertes

**D1 est acquis ; C/D ne sont pas clos.** Le lecteur privilégié d’inventaire SQL reste non qualifié. Le diagnostic `shared_admin / raw_underscore_pattern` et des compteurs filtrés à zéro ne prouvent pas l’absence de triggers, routines ou événements. La [FAQ officielle Infomaniak 821](https://www.infomaniak.com/en/support/faq/821/use-views-triggers-stored-procedures-and-routines), revérifiée le 19 octobre, décrit l’offre mais ne constitue pas l’inventaire de cette base. Aucun garde strict n’est assoupli.

Le protocole final source → cible manque encore : traitement des fermetures plus récentes, états interrompus, continuité d’identité à la réouverture et autorisation explicite de lever la quarantaine. Les reçus gardent leur rattachement source ; ne pas les réécrire ou effacer le marqueur pour ouvrir la copie. La perte totale de l’identité physique source reste distincte. `recette.jessiemessage.com` partage le runtime et la base source, ce n’est pas cette cible.

Prochaine action : définir puis implémenter et éprouver ce protocole de réconciliation cible, avec refus strict tant que l’inventaire requis n’est pas qualifié. Conserver le clone vérifié et la quarantaine. Aucun nouvel import D1, appariement, clé, test de mail ou contrôle personnel GPG à refaire.


## D2 — diagnostic des droits, 20:33:06.807 UTC

Le relevé privé `d19-d2-sql-capabilities.json` confirme MariaDB 10.11, le même profil `shared_admin / raw_underscore_pattern`, TLS et les trente tables applicatives. Les lectures directes de `mysql.proc` et `mysql.event` sont refusées. Le planificateur est `OFF`, pas `DISABLED` ; les workers d'événements déjà démarrés ne sont pas arrêtés par `Event_scheduler::stop()`. Un garde limité à `OFF` ne constitue donc pas une exclusion complète. Les treize droits ne couvrent ni `EVENT`, ni les droits de routines nécessaires. Les sources primaires sont référencées dans les [preuves D19](verification-proofs/jm-d19-isolated-restore.json).

**Diagnostic terminé, qualification non acquise.** Le parseur strict reste inchangé. Il n'y a eu ni requête SQL d'écriture, ni changement de grant, nouveau test de fermeture, rebind ou réimport D1. Aucun serveur MariaDB, outil d'initialisation ni moteur Docker/Podman installé n'est disponible sur l'hébergement pour une cible locale ; installer un autre serveur et modifier les transports opérateur ne qualifierait d'ailleurs pas D1. Le Netcup antérieur est arrêté, confirmation utilisateur acquise.

## Proposition de capacité SQL administrable — à décider

Le configurateur du compte Infomaniak a été consulté sans commande. Proposition `JessieMessage-SQL-proposition` : **VPS Lite Linux, 1 CPU, 2 Go RAM, 20 Go disque, Debian 12**, affiché **3,00 € HT/mois**. La préparation s'arrête au choix de clé SSH ; aucune clé n'est créée/importée/sélectionnée, aucun achat n'est effectué. Le montant final, les taxes et la durée ne sont pas encore validés en caisse. Un plafond de **50 € TTC/an** peut être proposé pour l'option annuelle minimale ; ce budget n'est pas accepté à ce stade.

L'offre [VPS Lite](https://www.infomaniak.com/fr/hebergement/vps-lite) fournit un accès root et est **non managée** : administration, mises à jour, sauvegardes et supervision doivent être opérées. Le prix annuel public correspond à douze mois payés en une fois. Les snapshots et le SLA de disponibilité ne sont pas inclus dans Lite. Le dimensionnement minimal proposé vise d'abord un SQL isolé pour cette petite base, pas une promesse de capacité de production sans mesure.

Après accord sur une capacité concrète : installer une série MariaDB qualifiée, isoler les comptes runtime/migration/inspection avec grants littéraux échappés, vérifier TLS et le pare-feu, puis restaurer vers une nouvelle cible gardée en quarantaine. Conserver le site, les médias et les mails sur l'hébergement existant pendant cette recette. Les contrôles C4/C5 doivent être recalculés pour la nouvelle cible ; D1 reste conservé. Aucune bascule de données ou autorité avant qualification, répétition contrôlée sur la nouvelle cible et succession explicite excluant l'ancien propriétaire. L'opérateur resterait sur l'hébergement actuel pour utiliser ses clés et ses médias locaux ; seule sa connexion SQL viserait le nouveau serveur via TLS. Aucune recette de bascule nouvelle n'est encore livrée par ce diagnostic.

**Reprise :** lire ce résultat et la décision de budget avant toute action. Sans capacité modifiée, ne pas répéter les sondes SQL, modifier la signification des zéros filtrés ou réimporter D1. Les autres lots indépendants peuvent continuer, sans activation des fermetures.
