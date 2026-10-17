# JessieMessage — bilan avant ouverture privée

**Étape 0.50 — correction activée le 18 octobre 2026 à 01:21 Europe/Paris :** le [relevé d’activation](broadcast-activation-050.md) confirme la source `0a1cafd85c3d8699be1961075b18e80e36bcd041`, arbre `17db89aa165e23ca427d073f5a3fcc28387f5168`, après préflight hébergé réussi à 01:19:57. L’accord et le réglage invité sont retirés ; chacun reçoit un message ordinaire dans sa conversation privée. À **01:22:38.231618**, **69/69 contrôles HTTPS** et **seize empreintes exactes de ressources** passent sur les deux origines. Les [cinq jobs CI de la source exécutée](https://github.com/fredbuhr/jessiemessage/actions/runs/39078063012) passent, dont 383/383 par MariaDB et 101/101 Chrome. Schéma, clés, comptes et règles des sessions conservés. Limite : 100 destinataires par campagne ; aucun essai réel de campagne créé par l’agent.

**Bilan actualisé au 18 octobre 2026 à 00:48 Europe/Paris, périmètre privé autour de Jessie.** Le parcours personnel essayé des fiches est accepté à 00:31:47. Les [diffusions individuelles sont activées](broadcast-activation-049.md), source `d77f16fb`, arbre `5897917c`, après préflight et cinq jobs CI réussis, dont 383/383 par MariaDB. Build/redémarrage Manager à 00:47 ; 68/68 contrôles HTTPS et seize empreintes exactes passent à 00:48:20. Accord individuel et confirmation de campagne conservés, aucune campagne réelle de test créée par l’agent. Le coffre et la restauration native 0.46 restent acquis ; les nouveaux formats 9/10 couvrent les campagnes peuplées en CI. Premier essai personnel, sauvegardes récurrentes/copie indépendante et surveillance/alerte restent au bilan.

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
| Fiches privées : comportement du navigateur | Activées en 0.47 ; conflits explicites, brouillons conservés et 101 tests Chrome ; parcours personnel essayé accepté à 00:31:47 |

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
| 0.45–0.46 | Fiches privées, tags, groupes, notes et rappels | [Activées après restauration isolée vérifiée](crm-activation-047.md) ; parcours personnel essayé accepté à 00:31:47 |
| 0.48–0.50 | Envois groupés livrés individuellement | [0.49 activé](broadcast-activation-049.md) ; [0.50 retire l’accord invité et est activé](broadcast-activation-050.md). Aperçu, confirmation et reprise conservés ; premier essai personnel ciblé encore attendu |
| Entretien | Version stable et suivi des appareils | Consolider les PR empilées sans remplacer implicitement la révision servie ; compléter la matrice appareils au fil du pilote |

Les fiches et les diffusions enrichissent la version complète. Les conversations individuelles déjà actives peuvent servir à un pilote privé une fois les mesures d’exploitation ci-dessus organisées. Aucune démarche déclarative n’est ajoutée au plan de développement. Les décisions de conservation et d’effacement restent distinctes : aucune purge irréversible ni durée générale n’est activée par défaut.
