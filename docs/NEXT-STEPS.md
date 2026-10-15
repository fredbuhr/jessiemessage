# JessieMessage — bilan et chemin vers le pilote

Document de travail public, mis à jour le 15 octobre 2026. Aucune donnée de client, photographie personnelle ni configuration de production.

## État de référence

Dépôt : [fredbuhr/jessiemessage](https://github.com/fredbuhr/jessiemessage). Domaine cible : `jessiemessage.com`. Adresse officielle retenue pour l'expédition, les réponses, le contact et la préparation du compte administrateur initial : **contact@jessiemessage.com**. Hébergement envisagé : site Node.js 24 et MariaDB dédiée chez Infomaniak ; capacités et configuration réelles à confirmer.

Branche courante : `feat/access-renewal-pagination`, construite sur `feat/server-availability`, puis `feat/private-ui-reliability`, puis `feat/targeted-broadcasts`, puis `feat/mail-readiness`, puis `feat/client-recovery`, puis `feat/private-crm` et `feat/private-media`. Les modifications restent empilées, sans fusion ni déploiement automatique : [#1 identité](https://github.com/fredbuhr/jessiemessage/pull/1), [#2 MariaDB](https://github.com/fredbuhr/jessiemessage/pull/2), [#3 authentification](https://github.com/fredbuhr/jessiemessage/pull/3), [#4 accès](https://github.com/fredbuhr/jessiemessage/pull/4), [#5 messagerie](https://github.com/fredbuhr/jessiemessage/pull/5), [#6 médias](https://github.com/fredbuhr/jessiemessage/pull/6). Le lot CRM est disponible dans la [PR brouillon #7](https://github.com/fredbuhr/jessiemessage/pull/7). Le lot récupération client est disponible dans la [PR brouillon #8](https://github.com/fredbuhr/jessiemessage/pull/8). La préparation e-mail est disponible dans la [PR brouillon #9](https://github.com/fredbuhr/jessiemessage/pull/9). Les diffusions individuelles sont disponibles dans la [PR brouillon #10](https://github.com/fredbuhr/jessiemessage/pull/10). Les corrections des interfaces privées sont disponibles dans la [PR brouillon #11](https://github.com/fredbuhr/jessiemessage/pull/11). La disponibilité et l’arrêt du serveur sont disponibles dans la [PR brouillon #12](https://github.com/fredbuhr/jessiemessage/pull/12).

Le renouvellement et la pagination des accès sont disponibles dans la [PR brouillon #13](https://github.com/fredbuhr/jessiemessage/pull/13).

L'identité Nuit approuvée conserve les fichiers exacts de la silhouette dorée sur bleu nuit. Les portraits personnels restent hors Git et des artefacts publics. Le prototype autonome 0.3.1 contient des données fictives ; il ne démontre pas le fonctionnement des comptes réels.

## Ce qui est implémenté

| Domaine | Comportement disponible dans le code | Limite avant utilisation réelle |
| --- | --- | --- |
| Accès administrateur | Mot de passe, MFA, codes de secours, sessions révocables, récupération privée | Initialisation du vrai compte et conservation des clés à organiser |
| Accès client | Invitation unique, inscription atomique, vérification e-mail en file chiffrée, approbation et expiration | SMTP réel et fournisseur de majorité à intégrer |
| Messagerie 1:1 | Persistance chiffrée, isolation par conversation, pagination, reprise sans doublon, lecture, suppression par auteur | Recette HTTPS, charge et appareils réels à vérifier |
| Photos privées | JPEG/PNG/WebP normalisés sans métadonnées, stockage chiffré, lectures autorisées, galerie et médiathèque propriétaire | Hébergement natif, ressources, sauvegarde et nettoyage des orphelins à valider |
| Outils clients 0.8 | Surnoms et notes privées, tags/groupes, dates de suivi, recherche et filtres ; conflits entre onglets | CI MariaDB vérifiée ; recette de l'interface à réaliser |
| Récupération client 0.9 | Lien e-mail unique de 30 minutes, changement atomique, anciens liens et sessions révoqués | CI vérifiée ; SMTP et recette HTTPS à valider |
| Identité e-mail et préparation 0.10 | Adresse contact unique, page administrateur et vérification SMTP sans envoi | CI vérifiée ; boîte, DNS et livraison réels non vérifiés |
| Diffusions individuelles 0.11 | Consentement client, sélection explicite, texte/photo, file durable, annulation et historique | CI vérifiée ; recette navigateur à réaliser |
| Fiabilité des interfaces 0.12 | Séparation compte/session, purge administration au masquage, récupération réessayable, activité récente et en cours des diffusions | CI vérifiée ; recette navigateur nécessaire |
| Disponibilité serveur 0.13 | Admission avant SQL/corps d’import, budgets de lecture, SMTP annulable, arrêt de tous les producteurs et drainage borné | CI vérifiée ; charge, proxy et hébergement réels à mesurer |
| Accès administrés 0.14 | Prolongation atomique des accès approuvés, conflits d’onglets, listes clients/invitations paginées au-delà de 500 entrées | CI MariaDB vérifiée ; recette navigateur et charge à réaliser |
| Présentation | Identité Nuit, icônes approuvées, aperçu autonome fictif | Contrôles navigateur, accessibilité et responsive réels à terminer |

Les outils clients restent réservés à l'administrateur affecté. Les notes sont chiffrées ; les listes CRM n'incluent ni notes ni adresse e-mail. Les dates de suivi ne déclenchent aucune notification. Les groupes sont des classements privés, pas des salons.

## Ce qui est vérifié, ce qui ne l'est pas

- Médias 0.7 : révision finale `189d742a7e6d93936f159d14c318d3a62d85c91f`, [CI 38651204840](https://github.com/fredbuhr/jessiemessage/actions/runs/38651204840) réussie : 320 tests généraux, 10 groupes DB ignorés dans le job sans base, puis 126 tests réels sans saut sur **chacune** des versions MariaDB 10.11 et 11.4. Sharp 0.35.5 est verrouillé ; aucune vulnérabilité npm signalée lors de ce lot.
- CRM 0.8 : 402 tests généraux réussis et 159 tests réels sans saut sur chacune des deux versions MariaDB ; détail et révision ci-dessous. Les 12 groupes DB sont explicitement ignorés uniquement dans le job général sans base.
- Les intégrations HTTP/SQL emploient exclusivement des fixtures synthétiques et des bases jetables, avec un compte d'exécution limité aux opérations DML.
- Aucune livraison SMTP réelle, preuve de majorité externe, migration de base Infomaniak, création de compte réel ou mise en production n'a été effectuée.
- Aucune nouvelle recette navigateur n'a été exécutée : aucun moteur installé ; un téléchargement antérieur a été refusé par le contrôle automatique d'autorisation. Les tests de modèle et de protocole ne remplacent pas les essais sur iPhone/Android.

## Risques et travail manquant

Le prototype autonome de diffusion et de Push reste fictif. Le serveur 0.11 fournit désormais une diffusion individuelle durable derrière un drapeau explicite ; les notifications Web Push restent à implémenter. Le parcours de mot de passe oublié est implémenté en 0.9, derrière un drapeau explicite ; sa validation SQL complète réussit sur les deux versions MariaDB. Les textes légaux, la rétention, les exports, les sauvegardes et leur restauration doivent être finalisés avec les informations réelles. La récupération/rotation des clés n'est pas automatisée. La file d'e-mails de récupération possède un nettoyage borné des anciens jobs ; les lignes de jetons expirés attendent encore une politique de purge. Les fichiers photo pouvant rester après un résultat SQL incertain sont conservés par prudence ; aucun nettoyage automatique n'est encore implémenté.

Les exigences d'accès des majeurs et les conditions d'hébergement doivent être résolues avant ouverture de contenus concernés. Une déclaration « 18+ » ne constitue pas une preuve. Aucun chemin actuel ne transforme cette déclaration en vérification.

## Périmètre du pilote

L'[ordre de livraison après l'audit](#ordre-de-livraison-après-laudit) ci-dessous constitue le plan courant. Ses charges sont des ordres de grandeur de travail à recalibrer après chaque lot ; les accès externes peuvent allonger le calendrier. On peut avancer le code sans attendre ces accès.

Pour publier rapidement, le pilote peut viser d'abord les conversations privées texte/photo et les fiches clients, avec un nombre limité de comptes. La diffusion et le Push peuvent arriver ensuite si le périmètre du pilote le permet. Les prérequis d'accès et la restauration restent nécessaires dans tous les cas.

Le déploiement sera préparé comme une opération explicite : sauvegarde, état des migrations, revue des paramètres, test de santé, parcours complet, possibilité de retour à la version précédente et observation. Aucun changement de ZTIKIX ni publication automatique depuis une branche de travail.

## Preuve finale du lot CRM

Implémentation `9e399e6dd5589d21597fb35b0a3fe6d2d2856ee0`, [PR brouillon #7](https://github.com/fredbuhr/jessiemessage/pull/7) : [CI 38653885864](https://github.com/fredbuhr/jessiemessage/actions/runs/38653885864) réussie sous Node.js 24.21.0. **402 tests généraux réussis**, 12 groupes DB explicitement ignorés dans ce job sans base ; **159 tests réels réussis sans saut sur chacune des versions MariaDB 10.11 et 11.4**. Douze groupes séquentiels : migrations 12, authentification 16, récupération administrateur 8, accès client 13, file e-mail 11, HTTP accès 9, persistance chat 19, HTTP chat 12, persistance médias 16, HTTP médias 10, persistance CRM 19 et HTTP CRM 14. Syntaxe et build réussis ; aucune nouvelle dépendance ou modification des icônes approuvées.

Les tests vérifient notamment l'autorisation SQL actuelle, les conflits entre onglets, les notes chiffrées, la suppression d'étiquette sans perte des notes et l'absence de CRM dans les réponses client. La revue des réponses tardives corrige aussi fermeture/réouverture de fiche, ordre des listes d'étiquettes et changement d'affectation. Aucune recette visuelle, SMTP réel ou mise en production. Voir [périmètre, configuration et limites du CRM](private-crm.md).

## Lot récupération client 0.9

Le formulaire « Mot de passe oublié ? » demande un lien sans révéler si un compte existe. Seuls les clients actifs ou en attente avec e-mail déjà vérifié peuvent recevoir un lien ; un accès expiré reste récupérable sans être renouvelé. Les comptes administrateur, suspendus, révoqués ou supprimés restent exclus. Un nouveau lien remplace le précédent sans déconnecter le client.

La validation explicite du nouveau mot de passe consomme le lien une seule fois, incrémente la version des identifiants et révoque toutes les anciennes sessions dans la même transaction. Elle ne crée aucune session et ne change ni l'e-mail ni les preuves de majorité/approbation ni la durée d'accès. Le jeton reste dans le fragment du lien puis en mémoire ; aucun paramètre URL de récupération n'est accepté par le serveur.

Deux migrations portent le schéma à 22. Les mails de récupération emploient la même configuration SMTP et la même clé de file, mais une finalité cryptographique et des tables distinctes de la vérification d'e-mail. Le transport partagé est fermé après les deux workers. La validation SMTP demeure au moins une fois : une révocation après la réservation d'un mail peut laisser partir un lien devenu inutilisable.

L’implémentation est vérifiée par la CI détaillée ci-dessous. Voir [configuration, comportement et limites de la récupération](client-recovery.md). Aucune livraison SMTP réelle, recette visuelle ou mise en production.

## Preuve du lot récupération client

Implémentation `56827b5054511cff9a4cede91a986507da6547aa`, [PR brouillon #8](https://github.com/fredbuhr/jessiemessage/pull/8) : [CI 38655526255](https://github.com/fredbuhr/jessiemessage/actions/runs/38655526255) réussie sous Node.js 24.21.0. **461 tests généraux réussis**, 14 groupes DB explicitement ignorés dans ce job sans base ; **190 tests réels sans saut sur chacune des versions MariaDB 10.11 et 11.4**. Les quatorze groupes sont séquentiels : migrations 12, authentification 16, récupération administrateur 8, accès client 13, file e-mail 11, HTTP accès 9, persistance chat 19, HTTP chat 12, persistance médias 16, HTTP médias 10, persistance CRM 19, HTTP CRM 14, persistance récupération et file dédiée 19, HTTP récupération 12.

Syntaxe et build réussis ; aucune nouvelle dépendance ni modification des icônes approuvées. Les tests de récupération couvrent de vrais appels HTTP et changements scrypt, le refus de l'ancien mot de passe, les courses de consommation, le remplacement/expiration des liens, la révocation des sessions et l'invariance des droits d'accès. Les envois utilisent un transport injecté. SMTP réel, majorité externe et recette HTTPS/appareils restent les prochaines validations du pilote ; aucune fusion ni mise en production effectuée.

## Identité e-mail et préparation du site 0.10

`contact@jessiemessage.com` devient l'adresse du site pour les liens de contact, l'expéditeur visible, l'enveloppe SMTP et les réponses. Les origines officielles et leurs sous-domaines refusent un autre expéditeur. Ce défaut ne suffit pas à activer les e-mails : serveur, port, identifiant, mot de passe et clé de file restent explicitement configurés en privé. Les tests hors domaine officiel peuvent conserver leurs adresses synthétiques.

La page administrateur « Préparer le site » présente les fonctionnalités activées et les validations restantes, sans afficher identifiants, clés, serveur SMTP ou détails MariaDB. Son bouton teste seulement DNS/TCP/TLS et l'authentification SMTP via une connexion dédiée ; aucun e-mail n'est envoyé et aucune réception n'est certifiée. Session MFA actuelle, Origin, CSRF, quotas persistants et contrôle de concurrence protègent cette action. Une session révoquée pendant le contrôle ne reçoit pas de résultat de réussite.

Les réglages publics Infomaniak sont documentés : `mail.infomaniak.com`, port 587 avec STARTTLS recommandé, et identifiant `contact@jessiemessage.com` si cette adresse correspond à une boîte authentifiable. Le mot de passe SMTP doit être créé dans le Manager et placé dans les variables privées ; aucun secret n'est demandé dans l'interface de diagnostic. SPF/DKIM/DMARC doivent être vérifiés dans le Service Mail avec les valeurs réellement fournies, sans inventer de sélecteur DKIM.

Les 22 migrations restent identiques. Un quinzième groupe HTTP/MariaDB couvre le diagnostic avec un transport simulé. CI du lot réussie ; aucun SMTP réel contacté, e-mail envoyé, changement DNS, recette visuelle ou déploiement. Voir [configuration et limites](mail-readiness.md).

## Preuve du lot identité e-mail et préparation

Implémentation `7909458c922a696e51590186c78692b1fe317753`, [PR brouillon #9](https://github.com/fredbuhr/jessiemessage/pull/9) : [CI 38657493833](https://github.com/fredbuhr/jessiemessage/actions/runs/38657493833) réussie sous Node.js 24.21.0. **524 tests généraux réussis**, 15 groupes DB explicitement ignorés dans le job sans base ; **200 tests réels sans saut sur chacune des versions MariaDB 10.11 et 11.4**. Quinze groupes séquentiels : migrations 12, authentification 16, récupération administrateur 8, accès client 13, file e-mail 11, HTTP accès 9, persistance chat 19, HTTP chat 12, persistance médias 16, HTTP médias 10, persistance CRM 19, HTTP CRM 14, persistance récupération et file 19, HTTP récupération 12, HTTP préparation 10.

Syntaxe et build réussis ; 22 migrations, dépendances et icônes inchangées. Les tests couvrent l'adresse officielle, les en-têtes SMTP, le contrôle sans envoi, les droits actuels, les quotas SQL, les erreurs, la concurrence et la révocation pendant le contrôle. La revue corrige aussi le changement de connexion depuis un autre onglet avant affichage du résultat. Aucun SMTP réel ni déploiement ; [configuration et validations restantes](mail-readiness.md).

## Diffusions individuelles 0.11

Le client choisit explicitement de recevoir les diffusions ; le défaut est désactivé. Jess sélectionne au plus 100 conversations depuis les contacts CRM, prépare un texte ou une photo existante et confirme une audience explicite. L’aperçu signale les accès inactifs, les refus de diffusion et les répétitions de photo. La confirmation n’inscrit aucun groupe dans la conversation du client.

Une campagne validée continue après fermeture de la page et déconnexion. Son annulation conserve les messages déjà inscrits et empêche les suivants. Le worker recontrôle consentement, accès, affectation, MFA de l’administrateur et photo actuelle. Les identifiants sont durables ; message, événement et état du destinataire sont validés dans une même transaction pour la reprise sans doublon. La modification MFA ou révocation de Jess arrête le reste de l’approbation.

Trois migrations portent le schéma à 25 ; dix-huit groupes SQL s’exécutent successivement. Aucun nouveau paquet ni changement de l’identité approuvée. Aucune migration réelle, diffusion à un client, livraison SMTP ou mise en production. Voir [configuration, garanties et limites](targeted-broadcasts.md). La preuve CI est détaillée ci-dessous.

## Preuve du lot diffusions individuelles

Implémentation `7df07be6c6ffd100ab1a29e9114b8315b08ec8c8`, [PR brouillon #10](https://github.com/fredbuhr/jessiemessage/pull/10) : [CI 38659783930](https://github.com/fredbuhr/jessiemessage/actions/runs/38659783930) réussie sous Node.js 24.21.0. **624 tests généraux réussis**, 18 groupes DB explicitement ignorés dans le job sans base ; **243 tests réels réussis sans saut sur chacune des versions MariaDB 10.11 et 11.4**. Les dix-huit groupes sont séquentiels : migrations 12, authentification 16, récupération administrateur 8, accès client 13, file e-mail 11, HTTP accès 9, persistance chat 19, HTTP chat 12, persistance médias 16, HTTP médias 10, persistance CRM 19, HTTP CRM 14, persistance récupération/file 19, HTTP récupération 12, HTTP préparation 10, autorisation des diffusions/chat 13, persistance des diffusions 17 et HTTP diffusion 13.

Les essais vérifient notamment le retrait du consentement entre réservation et envoi, l'annulation partielle, les accès expirés/révoqués, le changement de MFA, la réservation concurrente, le rollback après insertion du message et de l'événement, les identifiants conservés après interruption et les photos déjà partagées avec message supprimé. Les 28 tests de modèle et de cycle de vie de l'interface couvrent aussi les filtres, les réponses tardives et les confirmations incertaines. Syntaxe et build réussis ; dépendances et icônes approuvées inchangées. Aucune recette visuelle, livraison SMTP réelle, migration de production ni mise en ligne.

## Audit du 15 octobre et corrections 0.12

L'audit de `c3baf922` a relancé syntaxe, build et 624 tests généraux, vérifié les 243 tests SQL par MariaDB de cette révision et exécuté des reproductions synthétiques supplémentaires. Aucun contournement serveur interclients n'a été mis en évidence dans les cas examinés ; un défaut de séparation des données déjà chargées dans le navigateur est confirmé. Aucun navigateur, hébergement ou compte réel n'a été validé. npm ne signalait aucune vulnérabilité connue des dépendances installées au moment du contrôle ; cela ne certifie pas l'absence de bugs.

| Priorité | Constat reproduit | État |
| --- | --- | --- |
| P1 | Le chat acceptait une nouvelle identité sans purger l'ancien compte | Corrigé en 0.12, tests de changement d'identité/session et réponses tardives |
| P2 | L'administration acceptait des réponses privées après masquage | Corrigé en 0.12, purge, annulation, preuves et opérations bornées |
| P2 | Une panne de disponibilité figeait la récupération comme désactivée | Corrigé en 0.12, nouvelle vérification GET explicite ou au retour visible |
| P2 | Les diffusions n'actualisaient que la première page et pouvaient mélanger des sessions | Corrigé en 0.12, vue récente/active et contrôles d'identité |
| P2 | Trois imports incomplets peuvent monopoliser les places avant quota | Corrigé en 0.13 : une place par compte, quotas avant corps et tickets à usage unique |
| P2 | Lectures de session/chat/galerie sans budget d'entrée adapté | Corrigé en 0.13 : admission avant session SQL et budgets persistants des lectures ; charge/proxy à mesurer |
| P2 | Le délai du diagnostic SMTP ne ferme pas toujours sa connexion réelle | Corrigé en 0.13 : sockets possédés et fermés, tests TLS/STARTTLS locaux |
| P2 | L'arrêt des e-mails continue de réserver le reste du lot et n'a pas de délai global | Corrigé en 0.13 : arrêt des producteurs immédiat, restitution avant émission, grâce 5 s et budget total 15 s |

L'audit avait aussi confirmé l'absence de renouvellement d'accès et de pagination au-delà des 500 clients/invitations récents : ces deux points sont traités dans le [lot 0.14](access-renewal-pagination.md). La revue finale a reproduit puis corrigé une heure d'autorisation périmée après attente des quotas sur des opérations médias, chat, CRM et diffusions ; la connexion TOTP, l'émission du lien de récupération et la préparation du site ont reçu le même contrôle temporel. Des régressions suspendent le quota et font franchir l'échéance sans compte réel. La gestion administrative reste globale comme auparavant ; les conversations conservent leur affectation privée. Le manifeste relance encore la page d'attente neutre. Quotas de stockage, réconciliation des orphelins, rétention, export/suppression, sauvegarde/restauration cohérente, supervision et retour arrière compatible avec le schéma ne sont pas achevés. La déclaration 18+ ne remplit pas la preuve de majorité : un nouveau client réel reste en attente tant que le processus externe n'est pas intégré.

Le code mort identifié est limité : `constantTimeText` est utilisé seulement par ses tests et `public/icon.svg` est une archive non servie. Les fichiers `design` restent utilisés par le build ; ils ne sont pas morts. Conversions de dates, réponses 429 et vérifications de schéma sont dupliquées ; les extractions devront conserver les contrôles métier et les finalités cryptographiques. Les documents produit, authentification et première direction visuelle ont été remis en cohérence ou marqués historiques dans ce lot.

### Ordre de livraison après l'audit

| Lot | Résultat et critère de sortie | Charge indicative, hors attente externe |
| --- | --- | --- |
| 0.12 — parcours privés | Corrections ci-dessus, tests régressifs et CI exacte ; comportement navigateur encore à valider | Lot de code terminé et CI vérifiée |
| 0.13 — disponibilité et arrêt | Admission avant corps d'import, quotas, SMTP annulable, aucun nouvel appel de réservation après arrêt, drainage borné | Lot de code terminé et CI vérifiée |
| 0.14 — renouvellement et listes | Accès déjà approuvés prolongés sans doublon, pagination complète, état privé borné | Lot de code terminé et CI vérifiée |
| Majorité externe | Choix du processus et du prestataire, intégration et validation des preuves avant ouverture des comptes réels | À chiffrer après choix du prestataire |
| Exploitation | Plafonds de stockage, réconciliation prudente, rétention/export/suppression, restauration DB/médias/clés et retour arrière éprouvé | 2–3 jours |
| Préproduction HTTPS | Hébergement isolé, proxy validé, SMTP officiel et réception contrôlée | 1–2 jours après accès |
| Interface et appareils | Entrée de l'app installée, cohérence des visuels, FR/EN, clavier, accessibilité et parcours complet | 2–3 jours |
| Publication | Charge représentative, restauration, aucun P1 ouvert et revue/fusion ordonnée | Environ 1 jour |

Ces charges ne sont pas des dates de publication. Corrections, exploitation et préparation des intégrations peuvent progresser en parallèle ; disponibilité des accès et choix du processus de majorité peuvent déterminer le calendrier. Push, GIF et segments automatiques restent des lots distincts. Voir les [garanties et limites du correctif 0.12](private-ui-reliability.md), du [lot de disponibilité 0.13](server-availability.md) et des [accès administrés 0.14](access-renewal-pagination.md).

### Prochain lot de code : capacité et inventaire des médias

Le travail peut avancer avec des données synthétiques sans accès à l'hébergement réel. Les valeurs finales des quotas, la politique de rétention et les sauvegardes seront fixées avant exploitation.

| Étape | Résultat vérifiable |
| --- | --- |
| 1 — Réserver la capacité | Plafonds configurables par compte et globaux, marge disque, réservation persistante avant l'écriture des deux variantes chiffrées et déduplication atomique ; reprise cohérente des médias préexistants |
| 2 — Inventorier sans supprimer | Commande par lots, simulation par défaut, rapport privé des fichiers attendus, manquants, inconnus, temporaires et supprimés en base mais encore présents sur disque |
| 3 — Nettoyer avec preuve | Reprise après interruption et suppression limitée aux objets durablement libérés ; traitement des inconnus après arrêt effectif des imports et workers, contrôle de la base et sauvegarde |

Un échec HTTP, un délai écoulé ou une absence SQL observée pendant un import ne prouvent pas qu'un fichier est orphelin : un commit peut avoir réussi sans accusé. Une suppression physique échouée doit continuer à compter dans la capacité. Les références de diffusion doivent aussi être conservées. Les tests devront couvrir les imports concurrents, la déduplication, les interruptions avant/après commit, les suppressions échouées et les scans bornés sans suivi de liens. Les index des listes administratives seront mesurés et ajoutés avec une migration revue avant une forte volumétrie.

## Preuve du lot de fiabilité 0.12

Implémentation `0cf3b0faf9d95f49c6dc3ad963f05f08b0cb2fd9`, [PR brouillon #11](https://github.com/fredbuhr/jessiemessage/pull/11) : [CI 38663130943](https://github.com/fredbuhr/jessiemessage/actions/runs/38663130943) réussie sous Node.js 24.21.0. **711 tests généraux réussis**, 18 groupes DB explicitement ignorés dans le job sans base ; **245 tests réels réussis sans saut sur chacune des versions MariaDB 10.11 et 11.4**. Les dix-huit groupes restent séquentiels : migrations 12, authentification 16, récupération administrateur 8, accès client 13, file e-mail 11, HTTP accès 9, persistance chat 19, HTTP chat 12, persistance médias 16, HTTP médias 10, persistance CRM 19, HTTP CRM 14, persistance récupération/file 19, HTTP récupération 12, HTTP préparation 10, autorisation des diffusions/chat 13, persistance des diffusions 18 et HTTP diffusion 14. Syntaxe et build réussis. Aucun changement de migration, dépendance, clé ou icône ; aucune fusion ou mise en production. Les tests VM des contrôleurs n'apportent pas de recette navigateur ou appareils.

## Preuve du lot de disponibilité 0.13

Implémentation `0c1707e66ea47c41d15dc74f29cc0278fecd50bd`, [PR brouillon #12](https://github.com/fredbuhr/jessiemessage/pull/12) : [CI 38666057828](https://github.com/fredbuhr/jessiemessage/actions/runs/38666057828) réussie sous Node.js 24.21.0. **794 tests généraux réussis**, 18 groupes DB explicitement ignorés dans le job sans base ; **249 tests réels réussis sans saut sur chacune des versions MariaDB 10.11 et 11.4**. Les dix-huit groupes restent séquentiels : migrations 12, authentification 16, récupération administrateur 8, accès client 13, file e-mail 13, HTTP accès 9, persistance chat 19, HTTP chat 12, persistance médias 16, HTTP médias 10, persistance CRM 19, HTTP CRM 14, persistance récupération/file 21, HTTP récupération 12, HTTP préparation 10, autorisation des diffusions/chat 13, persistance des diffusions 18 et HTTP diffusion 14. Syntaxe et build réussis. Les nouveaux tests SMTP/TLS sont réels mais exclusivement locaux et synthétiques ; ils ne valident pas la réception externe. Aucun changement de migration, dépendance, clé d’application ou icône ; aucune fusion, recette navigateur ou mise en production.

## Preuve du lot des accès administrés 0.14

Implémentation `57e779b80492280d650971c9e2bf71042ee9f2bd`, [PR brouillon #13](https://github.com/fredbuhr/jessiemessage/pull/13) : [CI 38694142246](https://github.com/fredbuhr/jessiemessage/actions/runs/38694142246) réussie sous Node.js 24.21.0. **863 tests généraux réussis**, 18 groupes SQL explicitement ignorés dans le job sans base ; **260 tests réels réussis sans saut sur chacune des versions MariaDB 10.11 et 11.4**. Les dix-huit groupes restent séquentiels : migrations 12, authentification 16, récupération administrateur 8, accès client 20, file e-mail 13, HTTP accès 13, persistance chat 19, HTTP chat 12, persistance médias 16, HTTP médias 10, persistance CRM 19, HTTP CRM 14, persistance récupération/file 21, HTTP récupération 12, HTTP préparation 10, autorisation des diffusions/chat 13, persistance des diffusions 18 et HTTP diffusion 14. Syntaxe et build réussis. Aucun changement de migration, dépendance, clé ou icône ; aucune fusion ou mise en production. Les contrôleurs VM ne constituent pas une recette navigateur, appareils ou charge. La majorité externe, le SMTP réel et l'exploitation restent à préparer.
