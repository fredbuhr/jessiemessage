# JessieMessage — reprise de développement (14 octobre 2026)

> **Document de travail public : aucune donnée de client, aucun secret et aucune photographie personnelle.**
> Les décisions métier, la conformité applicable et les images privées doivent être gérées hors du dépôt public.

## Source de vérité

- Dépôt : `fredbuhr/jessiemessage` (public).
- Branche de travail : `feat/fondations-pwa`.
- Pull request brouillon : [#1](https://github.com/fredbuhr/jessiemessage/pull/1).
- Domaine cible : `jessiemessage.com`.
- Hébergement cible : Infomaniak mutualisé ; site Node.js 24 déjà créé, séparé de ZTIKIX.
- Branche `main` : ne pas fusionner sans tests et validation ; aucun déploiement automatique.

## Direction graphique approuvée

Le propriétaire a validé **JessieMessage — Nuit**, en mode sombre, mobile-first, avec surfaces prune, touches bordeaux et champagne, texte ivoire, accents raffinés, aucune surcharge ni imitation littérale de WhatsApp/Messenger.

Le nom affiché dans l'en-tête est **Jessie** et le service/domaine reste **JessieMessage**. L'icône approuvée est **la silhouette dorée originale sur fond bleu nuit, à deux formes fluides et espace négatif**. Ne jamais la remplacer par les silhouettes alternatives générées ensuite ; ne pas la redessiner. Les assets exacts seront remis par le propriétaire.

Une archive de mise à jour **`JessieMessage-Integration-Identite.zip`** a été préparée et testée localement *après* le commit GitHub `54ee1cdbea0398ae2a50c321d47fae59da30c3b1`. Elle contient les fichiers à copier à la racine du dépôt depuis `fichiers-a-deposer/`, dont des icônes binaires. Le contenu de cette archive a été intégré dans la livraison **0.3.1** sur cette branche ; les icônes ont été vérifiées par SHA-256 et conservées octet pour octet. Elle ne contient pas de portraits personnels, ni de données clients.

## État du développement

La branche comprend actuellement :
- Serveur Node.js 24 *minimal* qui sert uniquement une page d'accueil neutre et `/api/health`.
- Prototype HTML autonome pour accueil, conversation client et tableau de bord admin.
- Gestion **fictive** des tags, groupes privés, invitations, accès, messages, médias, diffusions ciblées et prévention des doublons.
- FR/EN, thème sombre responsive et tests GitHub Actions.
- Premier lot serveur livré dans la [PR brouillon nº 2](https://github.com/fredbuhr/jessiemessage/pull/2) : schéma MariaDB versionné et outil de migration explicite (voir `docs/DATABASE.md`). Le serveur HTTP ne connecte pas encore de base. Aucun système d'identité et de permissions de production, aucun échange réel, aucun Web Push.

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

Après revue du schéma : authentification administrateur et MFA, sessions sûres et révocables avec anti-CSRF/anti-abus, puis invitations à usage unique et vérification d’e-mail. Les tables seules ne fournissent aucune de ces protections. Développer avec comptes synthétiques et tester l’isolation avant connexion de la vraie UI. Aucune migration ni configuration de la base Infomaniak n’a été effectuée.

## Résultats vérifiés de la reprise Work

- Identité intégrée, [PR nº 1](https://github.com/fredbuhr/jessiemessage/pull/1), commit `2c818adbf7047d39d3bb301f8db502672dafa39b` : [CI 38628983228](https://github.com/fredbuhr/jessiemessage/actions/runs/38628983228) réussie sous Node.js 24.21.0, 47 tests ; les 10 PNG/ICO approuvés restent identiques. Le recadrage involontaire de l’avatar de secours a été corrigé.
- Premier lot serveur, [PR nº 2](https://github.com/fredbuhr/jessiemessage/pull/2), commit de code `812d9b00d9c58cfcada8ad002d313e8a267f8528` : [CI 38630438051](https://github.com/fredbuhr/jessiemessage/actions/runs/38630438051) réussie sous Node.js 24.21.0. Contrôle général : 63 tests réussis, 1 groupe d’intégration explicitement sauté dans ce job sans DB ; les jobs MariaDB séparés réussissent chacun leurs 12 tests, sans saut, sur 10.11 et 11.4.
- [Aperçu autonome issu de cette CI](https://github.com/fredbuhr/jessiemessage/actions/runs/38630438051/artifacts/11924969489) : décompresser puis ouvrir `JessieMessage.html`. Données fictives, aucun portrait personnel. L’export public et le build local ont la même source.
- Nouveaux tests visuels non exécutés : aucun moteur navigateur installé ; leur téléchargement a été refusé par le contrôle automatique d’autorisation. Les anciens contrôles Chromium du paquet ne sont pas de nouveaux essais Work. Les parcours mobile/desktop et les essais physiques iPhone/Android restent à vérifier.
- Les deux PR restent en brouillon ; aucune fusion, configuration Infomaniak, migration de vraie base ou mise en production n’a été effectuée. La présence des tables de sessions et d’invitations ne signifie pas que l’authentification ou leurs API existent.
