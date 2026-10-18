# JessieMessage — intégration de l’icône validée (0.3.1)

Base du travail : branche `feat/fondations-pwa`, commit `54ee1cdbea0398ae2a50c321d47fae59da30c3b1`.
Cette livraison est un ensemble de fichiers à appliquer ; aucun commit ni déploiement n’a été effectué dans cette session.

## Choix conservés

Le symbole approuvé est repris depuis les PNG fournis par le propriétaire. Aucun redessin, aucune génération d’image, aucune modification de silhouette, de couleurs ou de proportions. Les PNG 16, 32, 48, 64, 128, 192 et 512 px et le favicon ICO sont des copies octet pour octet du pack validé. Les empreintes SHA-256 sont consignées dans `public/brand/asset-manifest.json`.

La charte Nuit, ses couleurs, les photos locales et ses fonctions de démonstration sont conservées. L’en-tête utilise l’icône et le mot **Jessie** en texte HTML, ivoire, sans relief, ombre, dorure ou effet d’image. Aucun fichier de police n’est distribué ; les polices système disponibles servent au rendu. Le nom technique et le domaine restent JessieMessage / jessiemessage.com.

## Emplacements et formats

- En-tête : PNG 128 px, affiché en 44 px sur ordinateur et 40 px sur mobile. Pas de recadrage CSS du symbole ni de filtre de couleur.
- Avatar de secours sans portrait : PNG 64 px.
- Emblème de secours sans photographie : PNG 192 px.
- Onglets : favicon ICO multitailles et PNG 32/48 px.
- Apple touch : PNG opaque 180 px, obtenu uniquement en compositant l’icône 180 approuvée sur un fond bleu nuit.
- Manifeste : PNG 192 et 512 avec `purpose: any` ; PNG 512 dédié à `purpose: maskable`.
- Icône maskable : l’icône approuvée 512 est réduite uniformément à 420 px puis centrée sur un canevas bleu nuit opaque. Pas de nouvelle forme ; les seules adaptations sont l’échelle et la marge. L’emblème doré tient dans la zone centrale de rayon 40 %.

Les recommandations de préparation utilisées sont celles de web.dev sur les icônes maskable (https://web.dev/articles/maskable-icon) et de Chrome Developers sur apple-touch-icon (https://developer.chrome.com/docs/lighthouse/pwa/apple-touch-icon). Préparer ces fichiers ne rend pas à lui seul la messagerie opérationnelle ou installable sur tous les appareils.

## Aperçu et confidentialité

Le build produit `artifacts/JessieMessage.html`, autonome et sans réseau. Il embarque seulement les icônes approuvées, dont il vérifie les empreintes. Les portraits restent exclus du dépôt public et de l’export public. Une copie locale destinée au propriétaire peut contenir le portrait déjà présent dans sa maquette privée.

La maquette conserve la bascule client/admin de démonstration. Ce n’est pas une authentification. Ni données persistantes, ni compte réel, ni push, ni e-mail, ni invitation utilisable en production. La déclaration 18+ n’est pas une preuve de majorité. Les références de marque ne sont jamais ajoutées à une médiathèque privée de client.

## Serveur

Le serveur ne dessert que les nouvelles routes d’icônes explicitement autorisées. L’ancien `/icon.svg` n’est plus référencé ni servi ; le fichier historique peut rester dans le dépôt sans être accessible. Les dossiers `design` et `artifacts`, le registre des empreintes et tous les chemins privés restent interdits. La page publique demeure une page d’attente, pas la maquette de messagerie.

## Vérifications de cette livraison

- 46 tests Node locaux : 36 tests précédents + 10 tests de marque. Tous réussis sous Node.js 22.16.0 dans l’environnement de travail. La cible du projet reste Node.js 24 ; la CI GitHub devra s’exécuter après application des fichiers.
- 42 combinaisons de vue et de largeur dans Chromium automatisé : 320, 375, 390, 430, 768, 1024 et 1440 px. Pas de débordement horizontal observé ni d’image cassée.
- Saisie de message, échappement HTML, émojis, changement de langue et conservation de l’icône après réaffichage vérifiés.
- Aucun appel HTTP externe ni erreur JavaScript dans les parcours testés.
- HTML injecté dans Chromium : la navigation `file://` est bloquée par la politique du navigateur de test. Le fichier reste autonome mais son ouverture directe sur les appareils du propriétaire doit être essayée.
- Aucune installation sur iPhone/Android physique, aucun essai de notification et aucun audit de sécurité n’est revendiqué.

## Intégration Work — 14 octobre 2026

Les 23 fichiers du paquet ont été intégrés depuis la base annoncée. Le commit suivant de la branche ne changeait que `docs/NEXT-STEPS.md`, conservé. Les 10 fichiers PNG/ICO du registre restent identiques octet pour octet. Une correction distingue l’avatar de secours de la photographie afin de supprimer le zoom et le recadrage du symbole ; le cadrage des portraits reste inchangé.

47 tests réussis sous Node.js 24.19.0, contrôle de syntaxe et construction autonome réussis. Aucun portrait personnel ni donnée réelle n’a été importé. Les 42 contrôles Chromium ci-dessus sont ceux de la préparation initiale du paquet, pas de nouveaux essais. Aucun navigateur exécutable n’est installé dans l’environnement Work ; l’installation des navigateurs a été refusée par le contrôle automatique d’autorisation. Les nouveaux essais visuels, Android/iPhone physiques et l’installation PWA restent à réaliser.
