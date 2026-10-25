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

La qualification native Chrome FR/EN à320/1280, les suites complètes PR/main et les captures restent à obtenir sur le SHA exact avant publication. Les tests Chrome du parcours utilisent les vrais contrôleurs et handlers HTTPS, avec service synthétique ; les contrats de vérification et d’approbation réels restent couverts par les suites SQL/HTTPS dédiées. Aucun navigateur cloud ni essai sur compte réel par l’agent.

Production confirmée1112, sourceaf352607…, Node24.22.1 et checkpoint `3f1ae16dbadcee48643cbd2c0435b3eb5d36870cf72aa26cd080b5a0ac2f400f` conservés jusqu’à activation corrective. Une seule version corrective1113 sera préparée après qualification, avec SQL38 et le lock inchangés hors version racine. Les limites physiques et historiques de [REPRISE](REPRISE.md) restent explicites.
