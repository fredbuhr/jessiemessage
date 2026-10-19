# JessieMessage : solutions adaptées au mutualisé

**Recherche et réorientation du 19 octobre 2026, étape 4/6.** L'utilisateur veut terminer une messagerie privée avec son hébergement actuel. Le besoin a été alourdi par des garanties de récupération autonome qui ne sont pas indispensables à ce produit. La proposition de VPS est retirée ; aucun nouvel abonnement n'est nécessaire à la solution recommandée.

## Conclusion

Conserver le mutualisé, le runtime Node/MariaDB, les fonctions de messagerie, la sauvegarde applicative chiffrée et le copieur PC déjà fonctionnels. Prévoir une restauration manuelle en maintenance, avec contrôle des comptes fermés avant réouverture. Simplifier l'administration et découpler l'observateur indépendant du fonctionnement quotidien.

Cette conclusion est un choix de portée appuyé sur le code et les essais existants, pas l'affirmation que la composition simplifiée est déjà déployée. Le service reste en 0.72.0, en observation, avec les fermetures désactivées. Le [plan S1–S3](PLAN-IMPLEMENTATION.md) décrit les adaptations restantes.

## Ce que les vérifications établissent déjà

- Un import applicatif réel a réussi sur le mutualisé le 19 octobre : trente tables/migrations, six clés et quatre fichiers photo chiffrés concordantes ; seconde vérification sans réimport. La cible D1 reste isolée et bloquée, sans réouverture ni changement d'identité de cible acquis.
- Le profil `application-tables` existe et annonce honnêtement `completeDatabase:false` et les objets exécutables exclus. Le moteur local d'effacement utilise les transactions, un verrou et les contrôles du schéma ; il n'exige pas lui-même les privilèges d'inspection exhaustive exigés par le précédent protocole.
- Le superviseur possède un mode `start` sans observateur. Le serveur configuré garde sa barrière locale même fermetures désactivées : il refuse une intention non terminée ou un compte réapparu, et accepte un journal terminé dont les comptes sont absents. Réutiliser ce contrôle ; le traitement local reprenable reste à composer avant d'activer les fermetures.
- Le diagnostic D2 reste vrai pour l'ancien contrat : métadonnées globales refusées et scheduler `OFF`, qualification stricte non acquise. Cela ne démontre pas que la messagerie ou une restauration applicative manuelle sont impossibles.

## Solution recommandée

| Besoin | Solution sur l'hébergement actuel |
|---|---|
| Conversations, invitations, photos, diffusion | Conserver le runtime et les protections existants ; terminer les parcours utilisateur. |
| Sauvegarde exploitable de l'application | Conserver la capture cohérente chiffrée quotidienne et sa copie PC automatique. |
| Secours fourni avec l'hébergement | Vérifier les éléments réellement couverts puis utiliser les sauvegardes Infomaniak en complément. |
| Fermeture d'un compte | Effacement local journalisé et reprenable, registre minimal exportable, contrôle avant réouverture. |
| Panne nécessitant une restauration | Intervention opérateur en maintenance, import isolé, vérification des photos/clés et des comptes fermés, réouverture explicite. |
| Exploitation | Même hébergement et mêmes outils utiles, sans serveur supplémentaire ni confirmation PC à chaque phase. |

Le site quotidien fonctionne sans présence continue du PC. Les copies externes reprennent quand celui-ci est disponible. La page d'administration doit expliquer simplement l'état de ces copies et où retrouver le dossier, sans présenter le protocole de reprise comme une tâche quotidienne.

## Ce qu'offre Infomaniak et ce qu'il reste à vérifier

Les guides officiels annoncent la restauration des fichiers et bases sur les hébergements mutualisés. Le guide de restauration intégrale indique une sauvegarde quotidienne et les sept dernières disponibles dans le Manager. Il précise aussi que fichiers et bases ne sont pas sauvegardés simultanément : ce secours ne remplace donc pas, à lui seul, la capture cohérente de l'application.

La couverture effective des dossiers privés Node, configurations et clés de JessieMessage n'a pas été vérifiée dans le catalogue de sauvegarde du compte. Ne pas affirmer qu'ils sont tous couverts ; conserver la sauvegarde applicative jusqu'à preuve contraire.

La documentation réserve triggers, procédures, routines et fonctions aux serveurs Cloud. Les migrations de JessieMessage n'en ont pas besoin. Le nouveau périmètre fait confiance à l'administration de l'hébergeur ; il ne prouve pas l'absence de tous objets exécutables invisibles. Les contrôles des tables et noms de triggers du schéma propre restent utiles.

Sources officielles consultées le 19 octobre 2026 :

- [Sauvegarder et/ou restaurer des données, dont les hébergements mutualisés](https://www.infomaniak.com/fr/support/faq/250/sauvegarder-etou-restaurer-des-donnees).
- [Restaurer un hébergement : sept sauvegardes, maintenance et non-simultanéité](https://www.infomaniak.com/fr/support/faq/2217/restaurer-un-hebergement-entierement-et-automatiquement), mise à jour du 5 octobre 2026.
- [Fonctions SQL disponibles et restrictions du mutualisé](https://www.infomaniak.com/en/support/faq/821/use-views-triggers-stored-procedures-and-routines).

## Limites assumées et garde-fous conservés

Une restauration demande une intervention et une interruption. Les messages postérieurs à l'archive choisie peuvent être perdus ; après perte complète de l'hôte, la date de la dernière copie externe compte. Un PC éteint plusieurs jours exclut une promesse automatique de perte maximale de vingt-quatre heures.

Les anciennes archives peuvent contenir des comptes supprimés depuis. Un registre minimal des fermetures doit donc être conservé et exporté pendant que ces archives restent restaurables. Si son état récent manque, les comptes restaurés restent bloqués jusqu'à vérification opérateur ou réinvitation sans republication de l'historique incertain. Ce périmètre n'offre pas de garantie autonome contre la perte simultanée de toutes ces informations.

Conserver maintenance réelle, transactions, reprise des intentions, intégrité des relations/photos, révocation des sessions et contrôle avant réouverture. Ne jamais remplacer les preuves manquantes de l'ancien mécanisme par `verified:true`, effacer le marqueur D1 ou réinitialiser le PC pour débloquer la nouvelle portée.

Cette recherche n'a modifié ni la production, ni SQL, ni les clés, ni les copies PC ; aucun serveur n'a été commandé. Les changements présents sont documentaires.
