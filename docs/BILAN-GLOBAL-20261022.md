# JessieMessage — bilan global du 22 octobre 2026

**JessieMessage fonctionne déjà en production pour la messagerie texte et photo et les outils de Jessie. La vidéo reste en développement ; plusieurs fonctions évoquées ne sont pas encore codées.** Le précédent décompte « huit résultats plus deux corrections possibles » concernait la fin du chantier vidéo et sa qualification. Il ne constituait pas un bilan de tout le projet.

Ce bilan rassemble l’existant, les manques et une proposition de suite en quatre résultats lisibles. Les subdivisions techniques servent à reprendre le travail après une interruption ; elles ne doivent pas devenir autant de livraisons ou de nouvelles décisions demandées à l’utilisateur.

## La référence réellement en service

La production est **1.7.1**, commit `c2d7b3b31c6d0955892829f808dc4135d7d8debf`, arbre `d4945207f25375abb5d89c3a23ae91b6e34ea115`, avec **Node 24.22.1 et schéma SQL 33**. L’identité provient du journal réel de démarrage, complété par les contrôles HTTP et le reçu final des métadonnées dans [REPRISE](REPRISE.md).

Le [contrôle public du 22 octobre](verification-proofs/jm171-global-public-health-20261022.json) confirme santé, disponibilité et accueil HTTP 200 ; il ne prouve ni la version active ni une session réelle.

La branche de développement `feat/video-messaging`, relevée avant ce bilan à `34da07ad4ac1b23b1b2f00396d39de8b8c004122`, prépare **1.8.0**. Son dernier code fonctionnel vidéo qualifié est `231315cc17fd992eb3d9b261ea1e4448b90fd1d3`, arbre `29c765ad216a2ad0ab140145e836caeb920dc482` : [CI 39698017769 réussie 5/5](https://github.com/fredbuhr/jessiemessage/actions/runs/39698017769), [preuve détaillée](verification-proofs/jm180-video-deletion-verification.json). Cette qualification ne signifie ni fusion produit, ni migration hébergée, ni activation vidéo.

## Ce qui est disponible et branché en production

« Disponible » signifie ici codé, branché dans la source identifiée en service et couvert par les preuves indiquées. Cela ne prétend pas que chaque parcours a été essayé sur chaque téléphone physique.

| Ensemble | Ce qui fonctionne dans le périmètre livré | Limites à connaître |
| --- | --- | --- |
| **Accès et connexions** | Invitations personnelles, inscription, vérification e-mail, approbation admin, suspension/révocation et récupération client. Mot de passe et second facteur admin. Sessions distinctes utilisables simultanément, **180 jours glissants** pour les deux rôles. | Une invitation ne certifie pas la majorité. Les personnes autorisées partagent l’identité applicative admin : leurs actions ne sont pas attribuées individuellement. Six à huit appareils physiques simultanés ne sont pas qualifiés. |
| **Conversation** | Texte, photos et légendes, historique paginé, bibliothèque personnelle, galerie privée de l’échange, suppression et reprise explicite d’un envoi incertain. Lecture privée : Jessie voit « Lu » côté client ; le client ne connaît pas la lecture de Jessie. | Texte : 4 096 caractères ; légende : 1 000. Photos JPEG/PNG/WebP, 10 Mio, préparation réduite ; HEIC et images animées non pris en charge. Brouillons conservés dans la page ouverte, sans sauvegarde persistante locale. |
| **Notifications et interface** | Notifications facultatives par appareil, contenu neutre, clic vers le message après authentification ; interface mobile/ordinateur, français/anglais et installation PWA. | Réception dépendante du navigateur, du système et du réseau. Un retour utilisateur historique positif couvre le parcours essayé, sans identifier toutes les plateformes. |
| **Profils et expressions** | Nom public, avatar privé partagé dans les échanges, remplacement/retrait et gestion des conflits. **268 emojis Unicode locaux**, recherche FR/EN et cinq carnations sur les choix compatibles. | Nom public limité à 64 caractères, distinct du surnom CRM. Le rendu Unicode dépend de l’appareil. Ce catalogue ne constitue pas un pack de stickers illustrés. |
| **CRM et organisation** | Fiches privées, surnoms, notes, tags, groupes, filtres et **recherche de clients** ; conflits conservant le brouillon. | Les groupes organisent les clients, sans salon collectif. La recherche ne porte pas sur le contenu des messages. L’ancienne date de suivi CRM ne produit pas d’alerte automatique. |
| **Diffusions et annonces** | Diffusions individuelles globales, filtrées ou manuelles au-delà de cent personnes, aperçu confirmé et suivi paginé. Annonce immédiate ou programmée, expiration et message privé facultatif. | 2 500 destinataires **synthétiques** qualifiés, sans mesure équivalente sur le mutualisé. Envois progressifs, sans délai garanti. Une annonce courante, fin obligatoire au plus tard sept jours après enregistrement. |
| **Outils quotidiens de Jessie** | Plusieurs tâches privées par client, échéances, report, terminer/réouvrir, vue commune et compteur. **Six réponses rapides fixes FR/EN**, insérées dans le brouillon avant envoi explicite. | Aucun rappel push lorsque l’application est fermée, aucune alerte au client. Les réponses rapides personnelles ne sont pas encore enregistrables. |
| **Exports et fermeture** | ZIP de conversation client/admin avec photos partagées facultatives. Fermeture définitive locale activée, confirmée par l’admin, journalisée et soumise aux contrôles d’arrêt des producteurs et d’effacement. | ZIP limité à 10 000 messages, 8 Mio de texte et 32 Mio d’archive ; notes, tags, groupes, tâches et photos non partagées exclus. La fermeture ne réécrit pas les sauvegardes ou téléchargements existants. |

Les preuves et parcours sont regroupés dans [PRODUCT](PRODUCT.md), le [guide quotidien](guide-jessie.md), les bilans [diffusions](broadcast-scale-140.md), [annonces](announcements-150.md), [tâches](tasks-reminders-160.md), [profils](profile-expressions-120.md), [emojis](emoji-inclusifs-130.md) et [exports](client-conversation-export-060.md). La [CI propre 1.7.1](verification-proofs/jm171-verification.json) est verte sur ses cinq contrôles ; ses 39 omissions générales restent des omissions.

## Ce qui manque réellement

**La vidéo n’est pas utilisable dans la conversation.** Catalogue, accès privé, exports et suppression/fermeture/capacité ont des qualifications backend sur branche. Inventaire, capture/restauration et compatibilité restent incomplets ; l’interface avec sélection, progression, lecteur, avance/recul et galerie reste absente, ainsi que la diffusion vidéo complète.

**IA assistée, paiements intégrés, cryptomonnaies, Lovense et rendez-vous partagés ne sont pas codés.** Une tâche privée avec une date n’est pas un rendez-vous partagé. Leur absence du code ne prouve pas que l’utilisateur les a abandonnés.

Messages audio, réactions, citation/réponse, édition et transfert de messages, recherche dans les messages, pack illustré, GIF et intégrations de stickers ne sont pas livrés. Ce sont des pistes à prioriser et préciser, pas des engagements déjà chiffrés. Les textes « Voix de Jessie » des anciennes livraisons désignent leur formulation, sans fonction audio.

## Ce qui reste incertain ou différé

Le [blocage Avast](pc-antivirus-20261020.md) peut interrompre les copies PC ; une fausse alerte n’est pas confirmée. Le kit possède aussi un **défaut connu de confirmation finale** pouvant annoncer une mise à jour malgré une installation partielle. Il faudra le corriger avant une nouvelle recette d’installation. L’utilisateur a demandé de différer ce chantier : aucun réappariement ni changement de clé n’est nécessaire pour poursuivre la messagerie.

L’interface de [choix des destinations](backup-destinations-055.md) existe déjà : dossier Windows, éventuellement synchronisé par un autre logiciel. Elle ne réalise pas une connexion directe aux API Drive/OneDrive/Dropbox. L’archivage **A08** possède avertissement et simulation, mais aucun exécuteur actif ni purge automatique.

Fermeture locale et restauration manuelle sous maintenance restent conditionnelles aux contrôles prévus ; elles n’attestent pas le fonctionnement actuel du PC. Récupération autonome après perte totale de l’hôte, témoin frais à chaque phase et inventaire SQL exhaustif ne font pas partie des garanties livrées ; ils ne deviennent pas des prérequis à la messagerie.

Trois points secondaires restent ouverts : Authenticator sur téléphone physique, correctif PHP réellement installé par le fournisseur, et ancien aperçu sur `accueil.jessiemessage.com`. Le principal et www ont le nouvel accueil. La redirection du sous-domaine a été refusée par le contrôle automatique pour autorisation explicite manquante ; elle n’est pas appliquée et ne doit pas être retentée implicitement.

## Proposition de suite : quatre résultats pour 1.8.0

| Résultat | Critère de fin | Travail indicatif |
| --- | --- | --- |
| **1. Vidéo complète** | Cycle de vie, capture/restauration, interface lisant une vraie vidéo décodable, galerie, export, suppression et diffusion cohérents. | 3 à 5 séquences |
| **2. Réponses rapides personnalisables** | Jessie peut créer, modifier et retrouver ses propres phrases, avec insertion au brouillon et envoi explicite. | 1 séquence |
| **3. Qualification globale et corrections utiles** | Parcours combinés de toutes les fonctions ; corrections UX/sécurité proportionnées ; performances mesurées sur cible isolée ; portabilité et repli éprouvés sur un parcours synthétique complet. | 1 à 2 séquences |
| **4. Livraison unique et contrôles** | Sources qualifiées, publication, repli compatible, préparation/migration/activation distinctement attestées, identité active et contrôles hébergés. | 1 séquence |

Cela représente **six à neuf séquences de travail comme ordre de grandeur**, sans garantie de durée ni de nombre de messages. Une seule livraison produit est visée. PC et archivage restent différés et non bloquants. Aucun pourcentage global d’achèvement n’est déduit du nombre de tests ou de jalons.

Le backlog proposé conserve ensuite, à arbitrer : **rappels de tâches hors application**, **IA assistée**, **paiements/crypto**, **Lovense**, **rendez-vous partagés**, puis **stickers, recherche et autres conforts de messagerie**. Chaque sujet exige encore un résultat attendu et une estimation propres, sans prestataire présumé. Le décompte de 1.8.0 ne promet pas de les réaliser tous.
