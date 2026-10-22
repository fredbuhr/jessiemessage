# Travailler et livrer JessieMessage

Lire d’abord le début de `docs/REPRISE.md` jusqu’au jalon de développement courant, puis `docs/PLAN-IMPLEMENTATION.md`. Consulter ensuite seulement les rubriques et preuves nécessaires à l’étape. REPRISE est l’unique référence de l’état actuellement déployé : version, commit/arbre, commandes, preuves et repli. Les bilans datés décrivent leur propre étape et ne donnent pas les commandes courantes.

Pour changer de discussion, la [passation du 21 octobre 2026](docs/PASSATION-20261021-160.md) fournit le contexte et les références vérifiées à cette date ; si elle vieillit, REPRISE reste prioritaire.

## Avant de poursuivre

- Relever branche, commit, arbre et modifications locales. Vérifier le statut réel de la PR et la CI du commit concerné ; une réponse perdue ne prouve ni échec ni succès.
- Avant de relancer une opération distante interrompue, lire son résultat durable : PR/merge, run CI, paramètres persistés, processus, journal ou reçu. Reprendre depuis cet état, sans répéter une mutation pour découvrir son résultat.
- Après une interruption du tour, vérifier aussi l’état des sous-tâches déléguées. Une tâche `interrupted` ne reprend pas avec un simple message : inspecter ses fichiers et résultats déjà obtenus, puis lui donner une tâche de reprise explicite. Ne pas attendre un travail resté suspendu ni relancer ses contrôles déjà réussis.
- Distinguer **codé**, **fusionné**, **publié**, **déployé**, **vérifié** et **en attente du PC**. Un état absent, ancien ou un test ignoré n’est pas un succès.
- Conserver les choix acquis : Jessie en France, conversations jusqu’à fermeture définitive, priorité au cœur de la messagerie. Ne pas relancer audit général, questionnaire, test mail ou parcours PC à chaque reprise.

## Périmètre et simplicité

- Appliquer KISS : réutiliser le parcours existant le plus simple répondant au besoin, limiter le lot au résultat utile, éviter abstractions, infrastructure, budget ou garanties non demandés.
- Garder l’unique service Node sur le mutualisé existant. Utiliser le Node officiel privé épinglé et les commandes de REPRISE ; laisser le binaire système fournisseur intact. Pour une mise à jour, qualifier distribution officielle, version/hash, lanceur et CI ensemble.
- Appliquer le périmètre décidé le 22 octobre : abandonner IA, paiements carte/crypto, stickers/GIF, vocaux, réponse citée, édition, transfert de messages et épingles. Ne pas les maintenir comme évolutions différées. Lovense, rendez-vous partagés, recherche de messages, réactions et rappels privés push restent à préciser, non ouverts ; leur abandon ne se déduit pas de cette liste. Les réponses personnelles sont intégrées depuis 1.8.0 ; la liste commune 1.8.1 fonctionne selon le retour utilisateur, sans attestation séparée de tous les sous-cas.
- Depuis 1.8.0, l’application remplace les sauvegardes et l’archivage automatiques par une sauvegarde simple à la demande depuis l’administration, sans dépendance au PC ni nouveau service. Le code est qualifié et déployé ; création, fin et téléchargement d’une sauvegarde restent non vérifiés. L’utilisateur a reporté ce test à un autre jour : aucun diagnostic, nouvel essai, rappel ou surveillance automatique n’est à lancer sans sa demande de reprise. Préserver archives, clés, autorités, reçus et fermetures locales avec leurs gardes ; ne pas simuler un scheduler arrêté ni retirer une protection pour obtenir un contrôle vert. PC/Avast reste hors du parcours retenu, sans nouvelle manipulation PC demandée. Ne pas développer d’exécuteur d’archivage automatique.
- Le PHP du site secondaire relève d’Infomaniak et reste hors périmètre. Le 22 octobre, l’utilisateur autorise explicitement la redirection 308 de `accueil.jessiemessage.com` vers `https://jessiemessage.com`, avec chemins et paramètres conservés. Cette opération de routage Apache est distincte du refus historique et reste à appliquer/vérifier selon `docs/public-domains-20261022.md` ; ne modifier ni PHP, ni DNS/SSL, ni service Node, ni origine `recette` pour cette correction. Conserver `recette` pour les anciens appareils/PWA/Push ; le service Node 239143 dessert aussi le principal.
- La récupération autonome après perte totale de l’hôte, le témoin frais à chaque phase, la succession et l’inventaire SQL exhaustif ne sont pas des prérequis V1. Ne pas rouvrir ces chantiers pour bloquer la livraison ni leur attribuer des garanties équivalentes.
- Un changement de portée ne modifie pas les preuves historiques. Ne pas transformer un refus en succès par retrait d’un garde, faux état de scheduler, effacement de marqueur, réinitialisation d’autorité ou suppression de quarantaine. Préserver C1–C5 et les états identifiés dans REPRISE.

## Versions et livraison

- `package.json` est la source de la version applicative ; garder les deux valeurs racine de `package-lock.json` identiques. Node, schéma SQL et versions de formats restent distincts.
- Après la référence `1.0.0`, une correction compatible incrémente le correctif et une nouvelle fonction compatible le mineur. Une rupture de compatibilité incrémente le majeur. Les numéros ne dépendent pas des discussions ou du nombre de commits.
- Une livraison publiée possède un tag immuable `vX.Y.Z` et une release sur le même commit validé. Déployer ce commit exact ; ne marquer « en production » qu’après vérification réelle. Ne pas déplacer les tags ni réétiqueter les livraisons historiques.
- `main` peut avancer après livraison, notamment pour documenter les preuves. La référence de production reste le tag et le commit effectivement exécuté, consignés dans REPRISE. Un numéro attendu en configuration ne prouve pas le code actif.
- Préserver les évolutions dans leurs branches ; ne pas intégrer un travail fonctionnel à une simple harmonisation de version. Employer « Évolution 1 — Lecture privée » pour distinguer ce travail des anciens lots correctifs.

## États et données à préserver

- La genèse et la permission du témoin existent déjà. Ne jamais rejouer `plan-witness`, `prepare-witness` ou `prepare-witness-enrollment` sur le service courant.
- Ne pas réapparier le PC, exporter/régénérer sa clé privée, supprimer DPAPI, ses marqueurs ou son dossier `temoin`. Après une initialisation incertaine, inspecter PC et serveur avant toute action.
- Conserver clés, fichiers d’autorité, états D1, reçus, journaux, quarantaines et captures déjà identifiés dans REPRISE. Le secours Infomaniak ne garantit pas une capture simultanée fichiers/base.
- `recette.jessiemessage.com` partage le runtime et la base du principal : ce n’est pas une cible isolée pour restaurer, effacer ou tester une campagne de masse. Les essais restent synthétiques, sur cibles réellement isolées, distinctes de D1 préservé.
- Aucun secret, contenu client, média privé, dump SQL ou journal de production dans Git. Les qualifications utilisent des données synthétiques ; une omission reste explicitement non vérifiée.

## Un résultat terminé à la fois

- Définir un objectif borné et son critère de fin. Terminer code, vérifications adaptées, CI requise, fusion et livraison du même résultat avant d’ouvrir une autre évolution.
- Découper une évolution étendue en étapes de développement sur sa branche, avec un critère vérifiable par étape. Ces jalons ne sont ni des livraisons, ni des activations. Viser des séquences de travail de 10 à 20 minutes ; si une étape déborde, enregistrer son état puis la subdiviser. Ce repère d’organisation n’est pas un délai d’expiration ChatGPT et n’impose aucun arrêt ou nouvelle permission utilisateur.
- Avant une attente longue, publier le commit de travail et consigner le jalon : branche, commit/arbre effectivement poussés, PR éventuelle, contrôles réellement exécutés, limites et prochaine action unique. Un commit local seul n’est pas une reprise durable. Une étape incomplète reste explicitement incomplète.
- Relire le diff et exécuter les contrôles ciblés avant d’ouvrir une PR de qualification. Une CI native nécessaire à une étape peut justifier une PR plus tôt ; ne pas pousser une nouvelle révision pendant sa CI sans correction concrète. La CI complète qualifie la PR puis chaque SHA fusionné sur main à qualifier ; ne pas ajouter une CI push identique sur la branche. Réserver `[skip ci]` aux preuves documentaires, jamais au changement de workflow ou au code à qualifier.
- Ne pas relancer des suites déjà vertes sur le même code sans changement, échec ou préoccupation nouvelle. Compléter les parcours réellement non couverts ; ne pas compter un test ignoré comme une qualification native.
- Enregistrer après chaque opération distante commit/arbre, liens PR/CI, état observé, heure, prochaine action exacte et limites. Remplacer l’état courant de REPRISE sans empiler d’anciens présents ; le plan ne contient que les étapes restantes et leurs critères.
- À chaque étape, indiquer ce qui est fait et ce qui reste pour le résultat en cours, avec les contrôles réellement exécutés. Une modification de plan ne vaut ni implémentation, ni désactivation en service.
- Limiter les lectures aux extraits utiles et les sorties d’outils aux champs de preuve ; conserver les journaux volumineux dans un fichier. Une sortie tronquée ne valide ni un contenu ni une mutation. Vérifier les préconditions avant toute écriture multiple, inspecter le diff après erreur, et séparer chaque action opérateur de son reçu avant de poursuivre.
- Annoncer l’étape réellement en cours. Ne pas prétendre empêcher ou diagnostiquer une coupure ChatGPT sans trace correspondante ; organiser une reprise sans répétition ni état ambigu.
- Préférence utilisateur explicite du 22 octobre : ne pas utiliser le navigateur cloud. Fournir toujours dans le chat les liens directs et les instructions précises à exécuter dans son propre navigateur ; demander le résultat utile après chaque action dépendante, jamais un secret. Ne pas proposer de prise en main cloud.
- Donner les consignes opérateur clic par clic, avec les liens directs vérifiés des pages concernées, le nom affiché du site et les champs/boutons exacts. Utiliser les accès Manager consignés dans REPRISE ; ne pas confondre le site PHP `accueil.jessiemessage.com` avec l’application Node.js encore nommée `recette.jessiemessage.com`, qui dessert aussi le domaine public principal.
- Les autorisations utilisateur persistantes couvrent les opérations nécessaires au projet dans leur périmètre. Ne pas redemander une permission générale déjà acquise ; respecter les préconditions techniques et les actions personnelles nécessaires. Un rejet d’approbation automatique n’est pas contourné. Le développement n’autorise aucun envoi ni effacement de compte réel de test.
