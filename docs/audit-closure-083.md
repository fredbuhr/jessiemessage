# Clôture du plan correctif — JessieMessage 0.83

**20 octobre 2026 — les cinq lots du plan sont terminés, avec trois réserves ouvertes : A01, installation personnelle A07 et exécuteur A08.** Le service 0.83 est en ligne et vérifié sur le mutualisé existant. Cette clôture ne déclare pas tous les constats entièrement résolus.

Le code exécuté reste `682864cec3b8d0eb1c8a6dd92c4b9bd9dfc097b1`, arbre `5eb0c133625b734c8aa92ce3f3642e281a51f380`. Le lot 5 consolide les preuves et les états courants ; aucun changement applicatif, dépendance, migration, Build ou infrastructure supplémentaire. [Pins et repli 0.82](REPRISE.md), [preuves structurées de clôture](verification-proofs/jm083-closure.json).

## Contrôles consolidés

La [CI du dernier code déployé](https://github.com/fredbuhr/jessiemessage/actions/runs/39412009288) est terminée avec **cinq jobs réussis** : 3 094 tests généraux réussis et 35 wrappers SQL ignorés ; 466/466 sur chacune des MariaDB 10.11 et 11.4, Chrome 163/163, HTTPS/SQL 2/2 ; syntaxe 568 fichiers et aperçu construit. Les suites se recouvrent, leurs nombres ne sont pas additionnés. Aucune suite déjà verte n’a été relancée pour ce lot documentaire.

| Parcours | Preuve exécutée sur ce code | Portée |
| --- | --- | --- |
| Connexion et sessions | [Recette d’authentification](../tests/rehearsal/authentication.rehearsal.mjs) | Chrome, vrai HTTPS/MariaDB, mot de passe/TOTP, récupération, expiration, révocation et refus de rejeu. |
| Texte, photo et deux sessions client | [Recette messagerie](../tests/rehearsal/messaging.rehearsal.mjs) | Trois contextes Chrome ; envoi/réponse, vrai JPEG normalisé, stocké et décodé ; déconnexion d’une seule session. |
| Notification vers le message exact | Même recette, [interface](../tests/browser/chat-accessibility.browser.mjs) et [magasin SQL](../tests/notifications-store.integration.test.mjs) | Référence créée en SQL, ouverture de la photo exacte, y compris après reconnexion. Aucun Push fournisseur ou clic d’alerte système observé. |
| Export client et depuis fiche CRM | [Flux chat](../tests/chat-flow.integration.test.mjs), [flux CRM](../tests/crm-flow.integration.test.mjs) | Vrais endpoints HTTP/SQL et ZIP inspecté ; notes et étiquettes CRM privées exclues de la conversation exportée. |
| Photos exportées et export opérateur | [Flux média](../tests/media-flow.integration.test.mjs), [flux données](../tests/data-flow.integration.test.mjs) | Vrais lecteurs/chiffrement/JPEG par appel direct ; CLI privé, fichiers, empreintes, permissions et absence de mutation contrôlés. |
| Boutons et gardes d’export | [Chrome FR/EN, mobile/bureau](../tests/browser/chat-accessibility.browser.mjs) | API synthétiques et téléchargement intercepté. Aucun scénario unique Chrome→HTTPS→SQL d’export ni téléchargement sur PC personnel revendiqué. |

Ces validations sont réalisées sur données synthétiques, sans compte réel ni envoi réel. Les appareils physiques, l’arrière-plan système/PWA et le BFCache ne sont pas qualifiés par ces contextes Chrome. Les producteurs sortants sont coupés dans la recette HTTPS avant écoute.

## État par constat

| Constat | État à la clôture | Preuve et limite restante |
| --- | --- | --- |
| A01 — Node | **Ouvert, dépendance hébergeur** | Binaire fourni encore **24.15.0** ; Manager propose la branche majeure 24, sans sélection du correctif. Les [correctifs de sécurité 24.18.1](https://nodejs.org/en/blog/release/v24.18.1) sont postérieurs. Exploitabilité dans cette composition non démontrée ; dette de sécurité conservée. |
| A02 — budgets de connexion | Corrigé et vérifié | [Lot 1](audit-corrections-080.md) : refus réseau sans débit global conservé, transaction et cardinalité bornées. |
| A03 — diffusion après échéance | Corrigé et vérifié | Lot 1 : heure fraîche après verrous et médias, rollback final ; attente SQL native qualifiée. |
| A04 — liens expirés pendant une attente | Corrigé et vérifié | Lot 1 : récupération, invitation et email ; générations, révocation et usage unique conservés. |
| A05 — volume média sauvegardable | Corrigé sous limites conservées | [Lot 2](audit-corrections-081.md) : admission à 1 Gio chiffré/50 000 objets ; plafonds SQL, métadonnées et délais restent distincts. |
| A06 — reprise des médias restaurés | Corrigé et vérifié | [Lot 3](audit-corrections-082.md) : copie des absents après contrôle complet ; fichiers tronqués/divergents refusés et préservés. |
| A07 — progression du copieur Windows | **Code et kit livrés ; installation personnelle non observée** | Lot 2 : PowerShell 5.1 qualifié, archive récente prioritaire. Un reçu de copie ne renseigne pas la version du script installé. |
| A08 — capacité d’historique | **Avertissement et dry-run livrés ; exécuteur actif différé** | Lot 2 : intervention dès 1 500 reçus ou 3 072 entrées ; refus stricts à 2 000/4 096. Aucune rotation ou purge active livrée. |
| A09 — arrêt forcé masqué | Corrigé et vérifié | Lot 3 : vrais enfants synthétiques, SIGTERM/SIGKILL, échec propagé et nettoyage poursuivi. |
| A10 — schéma parent FK | Corrigé et vérifié | Lot 3 : sept validateurs, parents homonymes d’une autre base refusés dans les cas natifs. |
| A11 — HSTS | Corrigé et vérifié | Lot 1 et [lot 4](audit-corrections-083.md) : en-tête unique, portée hôte seul, `max-age=31536000`. |
| C01 — cookie Strict supprimé | Confirmé, corrigé et vérifié | Lot 4 : neuf modules ; Chrome/HTTPS/SQL, deux rôles, même cookie conservé, session active et réouverture sans connexion. |
| C02 — réponse obsolète de Sauvegardes | Boucle confirmée corrigée ; autre course non reproduite | Lot 4 : fetch/Abort natifs et visibilité contrôlée dans une même tâche. Ancien `finally` libérant une nouvelle action non reproduit en tâches séparées ; aucun onglet physique/BFCache qualifié. |

Les preuves détaillées des [lots 1](verification-proofs/jm080-verification.json), [2](verification-proofs/jm081-verification.json), [3](verification-proofs/jm082-verification.json) et [4](verification-proofs/jm083-verification.json) restent datées et conservées.

## État courant et suite minimale

Relevé en lecture seule du **20 octobre à 13:47:30 Europe/Paris** : source/arbre/propreté et lanceur concordants ; dix empreintes sensibles et l’identité de la destination PC préservées ; moniteur **OK**, santé/disponibilité **200** sur les deux origines, JSON attendu, `no-store`, sans cookie et HSTS unique. Les refus privés et le comportement des cookies restent qualifiés par les 28 contrôles du lot 4.

Le catalogue contient **cinq archives**, l’historique **dix reçus et 23 entrées**. Dernière capture quotidienne du 20 octobre à 05:15 UTC réussie et runtime repris ; son reçu PC correspond à l’archive récente par identifiant, taille et empreinte. Cela atteste le reçu du copieur ; aucun nouveau déchiffrement ou restauration n’en est déduit. Le déchiffrement accepté du 19 octobre reste acquis dans sa portée.

- **A07, seule action personnelle restante :** sur le PC déjà raccordé, Administration → Sauvegardes → **Mettre à jour le PC** ; extraire le ZIP et ouvrir **Mettre-a-jour.cmd**, après une copie en cours. Conserver clés, dossier et autorisation ; aucun nouveau raccordement ni activation du témoin.
- **A01 :** qualifier puis appliquer une version corrective Node 24 lorsqu’elle est effectivement proposée sur cet hébergement. Le contrôle du Manager et du binaire courant ne permet pas de déclarer cette mise à jour acquise. `npm audit` ne couvre pas les composants intégrés à Node.
- **A08 :** l’avertissement doit déclencher l’intervention avant saturation ; le relevé actuel est loin des seuils, sans délai restant garanti. L’exécuteur d’archivage actif reste un travail différé, selon la [procédure et les limites](backup-capacity-and-history-081.md).

Le plan correctif est clos avec ces réserves. Les limites de récupération manuelle, de surveillance et de plateformes restent dans REPRISE : pas de récupération autonome après perte totale, de preuve SQL exhaustive ou de perte maximale garantie de 24 heures. PC, autorité et D1 préservés ; aucun compte réel effacé, mail réel envoyé ou réimport de production pour valider. Le prochain travail doit partir de l’une des réserves précises ou d’une demande produit, sans rouvrir les lots terminés.
