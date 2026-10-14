# JessieMessage — reprise de développement (14 octobre 2026)

> **Document de travail public : aucune donnée de client, aucun secret et aucune photographie personnelle.**
> Les décisions métier, la conformité applicable et les images privées doivent être gérées hors du dépôt public.

## Source de vérité

- Dépôt : `fredbuhr/jessiemessage` (public).
- Branche de travail actuelle : `feat/private-messaging`, empilée sur `feat/invitations-client-access`, puis `feat/admin-auth`, puis `feat/schema-mariadb` et `feat/fondations-pwa`.
- Pull requests brouillons : [#1 — identité](https://github.com/fredbuhr/jessiemessage/pull/1), [#2 — MariaDB](https://github.com/fredbuhr/jessiemessage/pull/2), [#3 — authentification administrateur](https://github.com/fredbuhr/jessiemessage/pull/3), [#4 — invitations et accès client](https://github.com/fredbuhr/jessiemessage/pull/4), [#5 — messagerie privée](https://github.com/fredbuhr/jessiemessage/pull/5).
- Domaine cible : `jessiemessage.com`.
- Hébergement cible : Infomaniak mutualisé ; site Node.js 24 déclaré créé dans la passation, séparé de ZTIKIX. Configuration réelle à vérifier ; aucun déploiement de ce lot.
- Branche `main` : ne pas fusionner sans tests et validation ; aucun déploiement automatique.

## Direction graphique approuvée

Le propriétaire a validé **JessieMessage — Nuit**, en mode sombre, mobile-first, avec surfaces prune, touches bordeaux et champagne, texte ivoire, accents raffinés, aucune surcharge ni imitation littérale de WhatsApp/Messenger.

Le nom affiché dans l'en-tête est **Jessie** et le service/domaine reste **JessieMessage**. L'icône approuvée est **la silhouette dorée originale sur fond bleu nuit, à deux formes fluides et espace négatif**. Ne jamais la remplacer par les silhouettes alternatives générées ensuite ; ne pas la redessiner. Les assets exacts seront remis par le propriétaire.

Une archive de mise à jour **`JessieMessage-Integration-Identite.zip`** a été préparée et testée localement *après* le commit GitHub `54ee1cdbea0398ae2a50c321d47fae59da30c3b1`. Elle contient les fichiers à copier à la racine du dépôt depuis `fichiers-a-deposer/`, dont des icônes binaires. Le contenu de cette archive a été intégré dans la livraison **0.3.1** sur cette branche ; les icônes ont été vérifiées par SHA-256 et conservées octet pour octet. Elle ne contient pas de portraits personnels, ni de données clients.

## État du développement

La branche comprend actuellement :
- Serveur Node.js 24 : page d'accueil neutre et `/api/health` par défaut ; authentification administrateur activable uniquement par configuration privée explicite.
- Prototype HTML autonome pour accueil, conversation client et tableau de bord admin.
- Gestion **fictive** des tags, groupes privés, invitations, accès, messages, médias, diffusions ciblées et prévention des doublons.
- FR/EN, thème sombre responsive et tests GitHub Actions.
- Schéma MariaDB dédié et migrations explicites, avec tables MFA, codes de secours, état des sessions et compteurs anti-abus. Connexion administrateur avec mot de passe + MFA, sessions révocables, écran d'accès et initialisation privée du premier compte : voir [authentification](auth-admin.md). Les invitations, inscriptions, vérification mail, sessions clients restreintes et récupération administrateur sont implémentés sur la branche d'accès. La messagerie texte persistante est implémentée en 0.6, avec chiffrement au repos, isolation SQL, pagination, lecture et suppression par auteur. SMTP réel, majorité externe, médias et Web Push restent à compléter.

La version graphique finale est intégrée : 47 tests exécutés avec succès sous Node.js 24.19.0. Les résultats CI et contrôles navigateur doivent être lus sur la livraison concernée, sans reprendre les anciens bilans comme nouvelle preuve.

## À faire d'abord

1. **Terminé (0.3.1)** — Obtenir auprès du propriétaire l'archive `JessieMessage-Integration-Identite.zip` si elle n'est pas accessible dans la nouvelle conversation.
2. **Terminé (0.3.1)** — Examiner le contenu et les instructions `LIRE-EN-PREMIER.txt` et `BASE-COMMIT.txt`, vérifier les SHA256 et les modifications sur la branche existante.
3. **Terminé (0.3.1)** — Intégrer les assets **approuvés** avec les fichiers de design, les favicons et le manifeste PWA ; ne pas publier de portraits, secrets ou messages privés.
4. Exécuter les tests Node et les vérifications mobile/desktop ; vérifier en particulier l'icône exacte, les écrans 320–1440 px, le favicon, le manifeste PWA et le responsive.
5. Mettre à jour la PR #1, sans fusion ni déploiement automatique. Présenter le résultat concret, pas un nouveau cycle de propositions de design.

## Construction de la véritable application — par lots testables

1. Concevoir une architecture minimale adaptée à l'hébergement Infomaniak : Node 24, MariaDB dédiée, stockage privé et migrations versionnées.
2. Identité/accès : compte admin protégé avec MFA, invitations aléatoires à usage unique, expiration/révocation, preuve de possession d'e-mail, sessions révocables et protection anti-abus.
3. Messagerie 1:1 : isolation stricte des conversations, messages persistants, pagination, accusés adaptés, gestion des erreurs et suppression.
4. Médias : accès autorisé côté serveur, vérification/réencodage et retrait des métadonnées, galerie, digest SHA-256 et historique par destinataire.
5. Mini-CRM : tags, groupes administrateur invisibles aux utilisateurs, notes, rappels, accès limités en durée.
6. Diffusion : segmentation, exclusion des comptes suspendus/expirés, préférences de communication, envois individuels, contrôle des doublons et journal durable.
7. PWA : mode installable, notifications Web Push opt-in et discrètes, prise en compte des particularités iPhone/Android.
8. Pages légales et sécurité : mentions légales, confidentialité, CGU, signalement, traitement RGPD, rétention, export, sauvegardes chiffrées et tests de restauration.
9. Vérifier préalablement les obligations d'accès des majeurs applicables, les conditions d'Infomaniak et les conditions des canaux d'acquisition. Une case « 18+ » n'est **pas une vérification de majorité**. Aucune mise en service de médias explicites tant que les obligations ne sont pas respectées.
10. Tester sur vrais appareils, effectuer une revue de sécurité et des essais de charge ; seulement ensuite organiser un déploiement contrôlé.

## Principes de travail

- **KISS** : client = une conversation et accès discret à la galerie/paramètres ; administration = Messages, Médiathèque, Diffusion, Accès.
- Mobile-first, mais excellent rendu ordinateur ; simple, confortable, lisible et discret.
- Ne jamais déployer une démo client/admin sans contrôle d'accès réel.
- Développer et tester avec des données fictives, ne rien enregistrer d'intime dans GitHub ou CI.
- Préférer interface graphique GitHub + Infomaniak ; réduire SSH/console au strict nécessaire.
- Livrer du code et des PR vérifiées, en sollicitant le propriétaire uniquement pour les décisions nécessaires ou les permissions d'accès.

## Prochain lot serveur

Le lot d'accès implémente les invitations à usage unique, inscriptions, preuve de possession d'e-mail et sessions clients restreintes, ainsi qu'une récupération administrateur privée. Le lot 0.6 construit la messagerie 1:1 persistante en utilisant le garde d'accès actif. Le prochain lot prépare le stockage privé et la distribution autorisée des médias. Avant le pilote : brancher et valider SMTP, contrôle de majorité, récupération du mot de passe client et recette HTTPS sur appareils réels. Aucun compte réel, aucune migration ni configuration de la base Infomaniak n'a été effectué.

## Résultats vérifiés de la reprise Work

- Identité intégrée, [PR nº 1](https://github.com/fredbuhr/jessiemessage/pull/1), commit `2c818adbf7047d39d3bb301f8db502672dafa39b` : [CI 38628983228](https://github.com/fredbuhr/jessiemessage/actions/runs/38628983228) réussie sous Node.js 24.21.0, 47 tests ; les 10 PNG/ICO approuvés restent identiques. Le recadrage involontaire de l’avatar de secours a été corrigé.
- Premier lot serveur, [PR nº 2](https://github.com/fredbuhr/jessiemessage/pull/2), commit de code `812d9b00d9c58cfcada8ad002d313e8a267f8528` : [CI 38630438051](https://github.com/fredbuhr/jessiemessage/actions/runs/38630438051) réussie sous Node.js 24.21.0. Contrôle général : 63 tests réussis, 1 groupe d’intégration explicitement sauté dans ce job sans DB ; les jobs MariaDB séparés réussissent chacun leurs 12 tests, sans saut, sur 10.11 et 11.4.
- [Aperçu autonome issu de cette CI](https://github.com/fredbuhr/jessiemessage/actions/runs/38630438051/artifacts/11924969489) : décompresser puis ouvrir `JessieMessage.html`. Données fictives, aucun portrait personnel. L’export public et le build local ont la même source.
- Nouveaux tests visuels non exécutés : aucun moteur navigateur installé ; leur téléchargement a été refusé par le contrôle automatique d’autorisation. Les anciens contrôles Chromium du paquet ne sont pas de nouveaux essais Work. Les parcours mobile/desktop et les essais physiques iPhone/Android restent à vérifier.
- Authentification administrateur 0.4, [PR nº 3](https://github.com/fredbuhr/jessiemessage/pull/3), commit de code `7cf16c5a1e6659b5492c637e888d0bcd091bfec0` : [CI 38639207749](https://github.com/fredbuhr/jessiemessage/actions/runs/38639207749) réussie sous Node.js 24.21.0. Contrôle général : 118 tests réussis, 2 groupes DB explicitement sautés dans ce job ; chaque version MariaDB réussit ensuite 12 tests de migrations et 14 tests d'authentification, sans saut. Le parcours HTTP connecté à MariaDB valide connexion, session, anti-CSRF, déconnexion et refus du rejeu MFA. Audit npm du 14 octobre : aucune vulnérabilité signalée.
- Invitations et accès client 0.5, [PR nº 4](https://github.com/fredbuhr/jessiemessage/pull/4), commit de code `8f657e3b5d03ea9c77ccbc4c4d533ae6ca99c6f8` : [CI 38644134261](https://github.com/fredbuhr/jessiemessage/actions/runs/38644134261) réussie sous Node.js 24.21.0. Contrôle général : 173 tests réussis, 6 groupes DB explicitement sautés dans ce job ; chaque version MariaDB réussit ensuite 69 tests, sans saut, dans six groupes séquentiels : migrations 12, authentification 16, récupération administrateur 8, accès client 13, file d'e-mail 11, parcours HTTP complet 9. Tous les mails passent par des transports injectés ; aucune livraison SMTP réelle. Audit npm : aucune vulnérabilité signalée.
- Les cinq PR restent en brouillon ; aucune fusion, configuration Infomaniak, migration de vraie base ou mise en production n'a été effectuée. Le parcours d'accès et ses validations sont testés avec fixtures. Les vrais clients restent en attente tant que le contrôle de majorité externe n'est pas intégré ; sa preuve n'est simulée que dans les fixtures synthétiques. Livraison SMTP réelle, recette HTTPS et essais sur appareils restent à effectuer.

## Lot messagerie 0.6 et chemin vers le pilote

La messagerie texte comprend les échanges persistants, reprise d'envoi sans doublon, historique paginé, accusés de lecture et suppression du contenu par son auteur. La synchronisation passe par un journal de changements limité à la conversation, consulté seulement quand la page est visible. L'interface réelle conserve Nuit et ne remplace aucun portrait par un grand logo. Les portraits et galeries attendent leur service privé.

Ordre de livraison restant, avec critères concrets :

1. **Médias privés** : stockage hors accès public, autorisation de chaque lecture, limites/reconnaissance de format, réencodage sans métadonnées, galerie et suppression ; tests d'isolation et de nettoyage avant utilisation réelle.
2. **Outils administrateur** : tags/groupes/notes privés, puis diffusion individuelle avec préférences, exclusion des accès expirés et idempotence durable. Reprendre les contrôles du prototype sans exposer le CRM au client.
3. **PWA et finition** : installation, Push discret volontaire, traductions, essais clavier et appareils iPhone/Android sous HTTPS. Les vérifications HTTP et de modèle ne remplacent pas ces essais.
4. **Préparation du pilote en parallèle** : SMTP réel, fournisseur de majorité, récupération client, rétention/export, sauvegarde/restauration et rotation des clés. Finaliser les textes juridiques et les conditions d'hébergement avec les informations réelles.
5. **Publication contrôlée** : revue des PR empilées, recette d'un parcours complet sur environnement privé, migration explicite de la base dédiée sauvegardée, déploiement limité puis observation. Aucun déploiement automatique depuis une branche de travail.

Le calendrier du pilote dépend des accès hébergeur, SMTP et fournisseur de majorité. La réalisation des lots de code peut avancer avec des fixtures pendant ces intégrations ; cela ne débloque pas les vrais comptes.

## Résultat vérifié du lot messagerie

Messagerie privée 0.6, [PR nº 5](https://github.com/fredbuhr/jessiemessage/pull/5), révision testée `96730e37018f270d25c3e79e53b7f43e3f2ef13e` (implémentation `108a7009af30754eb4700b9aef85ccdb2be1e94e`) : [CI 38648349063](https://github.com/fredbuhr/jessiemessage/actions/runs/38648349063) réussie sous Node.js 24.21.0. Contrôle général : **238 tests réussis**, 8 groupes DB explicitement ignorés dans le job sans base. Chaque version MariaDB **10.11 et 11.4** réussit ensuite **100 tests**, sans saut, dans huit groupes séquentiels : migrations 12, authentification 16, récupération administrateur 8, accès client 13, file d'e-mail 11, parcours HTTP d'accès 9, persistance messagerie 19, parcours HTTP messagerie 12. Syntaxe et build réussis ; aucune dépendance ajoutée ni icône modifiée.

Les essais couvrent de vrais échanges HTTP connectés à MariaDB, mais aucune recette visuelle navigateur, aucune livraison SMTP réelle et aucun compte de production. Le code reste derrière un drapeau explicite et les prérequis d'accès ; aucune fusion ou mise en production. Voir [périmètre et limites de la messagerie](private-messaging.md).
