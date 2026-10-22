# JessieMessage — bilan global du 22 octobre 2026

**JessieMessage fonctionne en production pour la messagerie texte et photo et les outils de Jessie. G1 sauvegarde manuelle admin et G2 vidéo complète sont qualifiés sur la branche 1.8.0, non livrés. Il reste G3, réponses personnelles et qualification globale, puis G4, livraison unique et contrôles.** Le périmètre simplifié et les abandons du 22 octobre restent conservés.

Ce bilan distingue ce qui est livré, les acquis sur branche et les deux lots restants. Les subdivisions techniques servent à reprendre le travail après une interruption ; elles ne deviennent pas autant de livraisons ou de nouvelles décisions demandées à l’utilisateur.

## La référence réellement en service

La production est **1.7.1**, commit `c2d7b3b31c6d0955892829f808dc4135d7d8debf`, arbre `d4945207f25375abb5d89c3a23ae91b6e34ea115`, avec **Node 24.22.1 et schéma SQL 33**. L’identité provient du journal réel de démarrage, complété par les contrôles HTTP et le reçu final des métadonnées dans [REPRISE](REPRISE.md).

Le [contrôle public du 22 octobre](verification-proofs/jm171-global-public-health-20261022.json) confirme santé, disponibilité et accueil HTTP 200 ; il ne prouve ni la version active ni une session réelle.

La branche de développement `feat/video-messaging` prépare **1.8.0**. G2 est qualifié sur la source `cecd60ced91d7eaf79025f06233833dad52ddef0`, arbre `a2d639166576d24aaa233f333a13f3959f5ddd53` : [CI 39721685571 réussie 5/5](https://github.com/fredbuhr/jessiemessage/actions/runs/39721685571), [preuve détaillée](verification-proofs/jm180-video-integration-verification.json). Cette qualification ne signifie ni fusion produit, ni migration hébergée, ni activation vidéo.

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

## Acquis sur branche et travail restant

**G2 vidéo complète est qualifié sur branche, non livré.** Le candidat couvre sélection, chargement, lecture native et déplacement dans la vidéo, galerie, diffusions, ZIP et sauvegarde/restauration à deux racines, avec compatibilité des anciens formats et fermetures. Les essais utilisent des comptes, médias et bases synthétiques isolés ; ils ne prouvent aucune activation hébergée, utilisation sur téléphone physique ou mesure du débit du mutualisé. Le [guide G2](video-integration-180.md) précise le périmètre et les limites des essais.

**La sauvegarde simple à la demande via l’administration n’est pas encore livrée.** La production 1.7.1 conserve ses mécanismes automatiques existants ; leur remplacement effectif est le premier résultat codé et qualifié sur la branche, [CI 5/5](https://github.com/fredbuhr/jessiemessage/actions/runs/39706108306), en attente de livraison. Les réponses rapides personnelles restent à développer : les six phrases actuelles sont fixes.

**Abandonnés par décision du 22 octobre :** IA, paiements carte et crypto, stickers/GIF, vocaux, réponse citée, édition, transfert de messages et épingles. Ils sortent du backlog ; leur absence ne devient plus une évolution différée. Les textes « Voix de Jessie » des anciennes livraisons décrivent leur formulation, sans fonction audio.

**À préciser, non ouverts :** Lovense, rendez-vous partagés, recherche dans les messages/notes, réactions et rappels privés push. Ils ne sont pas abandonnés par inférence et n’ajoutent ni prestataire, ni service, ni développement simultané. Une tâche privée datée ne constitue pas un rendez-vous partagé.

## Exploitation : ce qui change et ce qui reste constaté

**L’automatisation des sauvegardes et de l’archivage est abandonnée dans le périmètre cible.** G1 la remplace par une sauvegarde à la demande depuis l’administration, sans PC requis. L’archivage **A08** possède avertissement et simulation historiques, sans exécuteur actif ni purge automatique ; aucun exécuteur automatique n’est désormais à construire. Rien n’a encore été désactivé ou modifié en production par cette décision documentaire.

Le [blocage Avast](pc-antivirus-20261020.md) peut toujours interrompre les copies PC existantes ; une fausse alerte n’est pas confirmée. Le défaut connu de confirmation finale du kit reste non résolu. Le [choix des destinations](backup-destinations-055.md) concerne un dossier Windows, éventuellement synchronisé par un autre logiciel, sans API cloud directe. Le nouveau parcours manuel ne relance pas ce chantier PC et ne demande ni réappariement ni changement de clé. Les anciennes copies, clés, autorités, journaux et états restent préservés.

Fermeture locale et restauration manuelle sous maintenance conservent leurs gardes et doivent rester cohérentes après le remplacement de l’automatisation. Elles n’attestent pas le fonctionnement présent du PC. Récupération autonome après perte totale de l’hôte, témoin frais à chaque phase et inventaire SQL exhaustif ne font pas partie des garanties livrées ; ils ne deviennent pas des prérequis à la messagerie.

Authenticator sur téléphone physique reste non vérifié. PHP du site secondaire relève d’Infomaniak et sort des actions du projet. L’ancien aperçu de `accueil.jessiemessage.com` reste constaté ; le principal et www ont le nouvel accueil. La redirection du sous-domaine a été refusée par le contrôle automatique pour autorisation explicite manquante ; elle n’est pas appliquée et n’est pas reprise dans ce chantier.

## Suite retenue : deux lots restants

G1 sauvegarde manuelle admin et G2 vidéo complète sont qualifiés sur branche et attendent leur livraison. La production conserve son code 1.7.1 et ses automatismes jusqu’à G4.

| Résultat | Critère de fin |
| --- | --- |
| **G3 — Réponses personnelles et qualification globale** | Jessie crée/modifie/retrouve ses phrases avec envoi explicite ; parcours combinés, corrections utiles, sécurité, performances et transfert/restauration/repli qualifiés sur des cibles isolées. |
| **G4 — Livraison unique et contrôles** | Sources qualifiées, publication, repli compatible, préparation/migration/activation distinctement attestées ; identité active et comportements réellement vérifiés, dont remplacement des automatismes. |

Le [plan détaillé](PLAN-IMPLEMENTATION.md) contient les critères ; [REPRISE](REPRISE.md) garde les sources et preuves courantes. À chaque étape, annoncer **fait** et **restant**. La prochaine action est G3 ; il reste G3 et G4. Aucun nombre supplémentaire de séquences ni pourcentage global n’est étayé.
