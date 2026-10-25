# Correctif1.11.3 — quitter un lien de confirmation déjà utilisé

Signalement du25octobre après livraison1112 : nouvelle invitation, nouvel e-mail et nouveau compte ; l’utilisateur déclare confirmation de l’e-mail et approbation admin effectuées. La capture montre encore la vue « Vérifier mon e-mail » et son refus générique. Aucun identifiant, compte, message, journal privé ou secret réel n’a été utilisé pour les essais.

## Diagnostic borné

Un lien de confirmation ne s’utilise qu’une fois. Le backend refuse déjà correctement un token consommé, révoqué ou expiré ; l’approbation admin exige déjà un e-mail vérifié. Ces gardes restent inchangés. L’état SQL du compte réel n’a pas été inspecté et la cause exacte de la consommation du lien réel n’est pas déduite de la capture.

Le défaut d’interface est reproduit sur1112 : après refus401, le token reste sélectionné, la connexion est masquée et aucun bouton ne quitte la vérification. Un retour mobile après réponse perdue produit le même besoin de sortie. L’écran peut aussi reprendre une autre session client existante avant que le compte associé au lien ait été choisi.

Le contournement immédiat communiqué est d’ouvrir `https://jessiemessage.com/access` sans fragment dans un nouvel onglet, puis d’utiliser les identifiants du compte créé. Aucun nouveau compte ou envoi d’e-mail réel n’est déclenché par l’agent.

## Correction regroupée

- Un refus400/401 du lien revient à la connexion avec un message adapté, un focus sur l’e-mail et la demande de nouvel e-mail disponible.
- Le bouton « Aller à la connexion » permet de quitter un résultat incertain sans rejouer le token.
- Après confirmation, la connexion utilise les identifiants du compte et la preuve fraîche du propriétaire. Une session préexistante d’un autre client n’est pas adoptée par le parcours de vérification ; retour mobile et événement online gardent ce choix explicite.
- Une panne503 reste réessayable et ne déclare pas le lien invalide. Aucun login, renvoi d’e-mail ou validation admin automatique.
- Français/anglais et espacement du nouveau bouton ; aucun changement backend, SQL, dépendances ou autres modules métier.

## Qualification

Sept scénarios nouveaux ont d’abord reproduit le défaut avant correction,0réussi/7échecs attendus ; preuve synthétique conservée. Après correction et ajout des bornes400/401 :102tests ciblés réussis,0échec/omission, dont9 nouveaux cas de vérification/connexion. Syntaxe du dépôt contrôlée séparément. [Couverture](verification-proofs/jm1113/coverage.json).

**Qualification et publication acquises :** [PR140](https://github.com/fredbuhr/jessiemessage/pull/140) fusionnée ; source `89571636d6fde97b28b5e8aec9257801c1b71f8b`, arbre `e16a22043ea00908afa37cad64e5f9b421f4e5ae`. [PR40231447183](verification-proofs/jm1113/pr-native.json) puis [main40232421442](verification-proofs/jm1113/main-native.json)5/5 chacune, tentative1 : général4081réussis/0échec/52omissions explicites, Chrome280/280, HTTPS14/14, MariaDB608/608 chacune sans omission. Les52omissions sont50scénarios SQL réservés aux suites natives et2branches conditionnelles sans procfs, jamais des succès. Quatre [captures FR/EN320/1280 inspectées](verification-proofs/jm1113/visual-review.json), même arbre complet que main. Les tests Chrome utilisent les vrais contrôleurs/handlers HTTPS avec service synthétique ; les gardes backend restent couvertes par les suites SQL/HTTPS. Aucune connexion réelle du compte signalé n’en est déduite.

[Tag/release v1.11.3](https://github.com/fredbuhr/jessiemessage/releases/tag/v1.11.3), release423658747, publiée et latest après [workflow40233214193](verification-proofs/jm1113/publication-native.json)2/2 et33tests opérateur natifs. Opérateur `fead96f4c8bde918dde5c72a1860fe298f47abe3`, préparateur SHA256 `8267f0b8169cc3857503afe16506b471b879a732d458e799b7b17a12363b1916`. Aucun déploiement hébergé effectué par ce workflow.

Production confirmée1112, sourceaf352607…, Node24.22.1 et checkpoint `3f1ae16dbadcee48643cbd2c0435b3eb5d36870cf72aa26cd080b5a0ac2f400f` conservés jusqu’à activation corrective. La version corrective1113 est publiée ; sa [préparation/CHECK](operations-release1113.md) reste à exécuter avant activation, avec SQL38 et le lock inchangés hors version racine. Les limites physiques et historiques de [REPRISE](REPRISE.md) restent explicites.
