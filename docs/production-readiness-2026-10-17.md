# JessieMessage — bilan avant ouverture privée

**Bilan du 17 octobre 2026, périmètre privé autour de Jessie.** Référence hébergée : lot 0.42 `ed78b55e`, repris après la pause explicitement autorisée du checkpoint et recontrôlé à **23:06:14.062306 Europe/Paris** : 38 contrôles HTTPS et seize empreintes exactes conformes. Les lots 0.43 à 0.45 sont validés côté code. La clé CRM réelle est créée ; le coffre est copié sur le PC, son empreinte concorde et son déchiffrement personnel est confirmé à **22:48:05**. Le [checkpoint courant](crm-checkpoint-046.md) est capturé hors activité à **23:04**, avec trente tables applicatives et quatre fichiers photo chiffrés. La nouvelle base de restauration est créée vide ; le lanceur corrigé passe ses précontrôles à 23:12 sans connexion SQL ni import. La copie indépendante de l’archive et son empreinte sont confirmées à 23:21:20 ; sa restauration isolée reste à effectuer, aucune fiche n’est activée.

L’application est déjà hébergée à son adresse principale avec les accès sur invitation. Le passage à un usage privé régulier consiste à compléter son exploitation et ses fonctions restantes ; aucun changement d’hébergement ou ouverture publique de la messagerie n’est prévu.

## Déjà livré

| Élément | Preuve actuelle |
| --- | --- |
| Invitations, e-mail, admission manuelle, accès privé | Parcours réel accepté ; les comptes invités n’accèdent qu’à leurs échanges |
| Messages, historique, photos et bibliothèque | Fonctions déployées, parcours photos accepté |
| Notifications choisies par appareil | Réception réelle acceptée ; ouverture ciblée et reprise implémentées |
| Sessions administrateur/client durables | 180 jours renouvelables, sans coupure pour inactivité ; sessions séparées par appareil |
| Récupération du mot de passe invité | Déployée, parcours essayé accepté à 18:52:47 ; aucune répétition générale demandée |
| Domaine principal, FR/EN, aide et contact | Déployés ; 38 contrôles HTTPS et seize empreintes exactes au recontrôle de 22:15:18 |
| Sauvegarde et restauration applicatives de référence | Checkpoint schéma 30 et import isolé réellement vérifiés au lot 0.36 |
| Fiches privées : comportement du navigateur | Lot 0.43 validé : conflits explicites, brouillons conservés, reprise, 101 tests Chrome ; module encore désactivé |

## Avant d’élargir l’usage

| Priorité | Travail restant | Critère concret |
| --- | --- | --- |
| 1 | Organiser les sauvegardes récurrentes et leur copie indépendante | Fréquence, destination et résultat des copies connus ; checkpoint compatible avec les données courantes, clés conservées et procédure de reprise vérifiée |
| 2 | Valider la surveillance et une alerte de panne | Santé HTTP et disponibilité contrôlées depuis l’extérieur ; un échec et sa notification ont été réellement éprouvés, sans données de conversation dans l’alerte |
| 3 | Confirmer le fonctionnement simultané du foyer | Observation ciblée sur vos deux appareils administrateur habituels et quelques échanges invités ; connexion, retour dans l’application et ouverture d’une nouvelle notification |
| 4 | Vérifier le téléchargement du diagnostic dans une vraie session administrateur | Le fichier peut être enregistré depuis « État du service » ; la CI valide déjà sa projection et ses contrôles, mais l’opérateur n’a pas de session JessieMessage dans son navigateur |

La quatrième vérification concerne un outil d’exploitation et peut accompagner le pilote. Les retours déjà acceptés ne sont pas annulés par l’absence de relevé complet de tous les téléphones. Le checkpoint réel 0.36 ne prouve pas à lui seul une sauvegarde récurrente, ni une nouvelle restauration native après apparition de données de récupération. Les tests ne certifient pas tous les réseaux ou une capacité de milliers de comptes : élargir progressivement le pilote permet de mesurer l’usage réel.

## Fonctions de la version complète

| Ordre | Fonction | Suite |
| --- | --- | --- |
| 0.44–0.46 | Clé et coffre des fiches privées | [Clé créée, coffre primaire et copie PC vérifiés](crm-checkpoint-046.md), empreinte concordante et déchiffrement personnel confirmé à 22:48 ; anciens coffres conservés |
| 0.45–0.46 | Fiches privées, tags, groupes, notes et rappels | [Profil explicite et reprise à six clés validés](crm-runtime-backup.md), cinq jobs CI réussis et inspection applicative hébergée conforme ; checkpoint courant/restauration isolée et activation ciblée restent à réaliser |
| Ensuite | Envois groupés livrés individuellement | Préparer le profil, la prévisualisation des destinataires, les règles existantes d’accord/retrait, la détection des doublons et la reprise ; tester avant activation |
| Entretien | Version stable et suivi des appareils | Consolider les PR empilées sans remplacer implicitement la révision servie ; compléter la matrice appareils au fil du pilote |

Les fiches et les diffusions enrichissent la version complète. Les conversations individuelles déjà actives peuvent servir à un pilote privé une fois les mesures d’exploitation ci-dessus organisées. Aucune démarche déclarative n’est ajoutée au plan de développement. Les décisions de conservation et d’effacement restent distinctes : aucune purge irréversible ni durée générale n’est activée par défaut.
