# Demandes de données — procédure opérateur préparée en 0.41

**Contact unique : `contact@jessiemessage.com`.** Cette procédure réutilise [l’inventaire et l’export](private-data-export.md) et la [simulation non exécutable](data-deletion-rollback.md). Elle n’envoie aucun courrier, ne crée pas de suivi client dans Git et ne met en œuvre aucun effacement de compte. Le lieu privé du suivi, l’opérateur habilité et la conservation de ses preuves restent à compléter dans D08 du [lot 0.41](data-privacy-preparation.md).

## Réception, identité et suivi

Enregistrer la réception, le type de demande et une référence privée du compte. Confirmer son périmètre sans demander de justification personnelle. Établir l’identité de façon proportionnée : ne pas exiger systématiquement une pièce d’identité, ni réactiver un compte expiré pour permettre une demande. Ne jamais réclamer mot de passe, TOTP, code de secours, lien d’invitation ou jeton de récupération. Une demande faite avec une session valide peut contribuer à la vérification ; une simple adresse d’expéditeur ou le pseudonyme ne suffisent pas toujours pour remettre des échanges intimes.

La réponse intervient sans retard injustifié et normalement sous un mois ; une prolongation justifiée, jusqu’à deux mois supplémentaires selon la complexité/nombre de demandes, est notifiée avant la fin du premier mois. La première copie est en principe gratuite. Ne pas compter systématiquement « 30 jours » ni attendre une future version du logiciel pour répondre. Toute décision motivée, y compris une réponse partielle, doit être suivie.

Référence : [CNIL — répondre à une demande d’accès](https://www.cnil.fr/fr/repondre-une-demande-de-droit-dacces), consultée le 17 octobre 2026. L’identité, le délai et la remise sont à apprécier sur le cas réel ; la procédure ne conclut pas automatiquement à un refus ou à une extension.

Champs minimaux à conserver **hors dépôt et hors CI**, sans dupliquer la conversation :

| Champ privé | Contenu utile |
| --- | --- |
| Référence et réception | Identifiant de demande non public, date/heure, échéance à vérifier |
| Compte et portée | Référence interne protégée et catégories demandées ; aucun secret d’authentification |
| Vérification | Méthode, date et résultat ; limiter les copies de justificatifs et leur conservation |
| Traitement | Opérateur, opérations réellement réalisées, erreurs à reprendre, exceptions motivées |
| Réponse | Date, canal vérifié, périmètre remis/corrigé/effacé, limites restantes et suivi |
| Copies et fin de vie | Emplacement protégé des sorties, générations de sauvegarde concernées, traitement des fichiers partiels et échéance retenue |

Une feuille de suivi vide peut être créée dans l’espace privé choisi ; aucun registre réel ou nouvel outil de stockage n’est livré par ce document.

## Accès et copie : parcours avec l’outil existant

1. Confirmer le compte, la portée et l’habilitation de l’opérateur. Répertorier les données demandées dans les [29 catégories et copies externes](data-retention-register.md), y compris support, sauvegardes pertinentes et prestataires ; ne pas consulter d’autres comptes pour contourner une limite.
2. Pour une exécution réelle de l’outil, suivre intégralement les conditions existantes : arrêt vérifié de tous les producteurs, confirmation exacte base/client, nouveau répertoire privé protégé, clés uniquement depuis la configuration privée. `--offline` n’est pas une preuve d’arrêt. Ne pas improviser ces opérations sur le service actif depuis ce dossier préparatoire.
3. Exécuter `inventory`, puis `export` si une copie du contenu visible est demandée, selon les commandes documentées. La date d’accès peut être dépassée et le compte révoqué sans empêcher la lecture opérateur. Aucun droit de connexion n’est rétabli.
4. Vérifier succès, `COMPLETE.json`, fichiers, hashes et compteurs. Une erreur/budget dépassé ne produit pas un export complet ; relancer vers une nouvelle destination selon la procédure, garder le suivi du partiel. Un compteur plafonné à 10 000 reste une borne inférieure, pas un total exact.
5. Compléter la réponse au-delà de l’export technique : les notes/noms/libellés CRM, les métadonnées non exportées, les données de campagne concernant le demandeur, le support et les autres sources doivent être examinés s’ils existent et entrent dans la demande. CRM/diffusions désactivés ne prouve pas à lui seul l’absence de toute donnée conservée.
6. Préparer une copie intelligible des données concernées et les informations sur leur traitement. Protéger les tiers ; documenter les masquages au cas par cas. Une note « interne » n’est pas exclue par principe du droit d’accès. Ne pas remettre de clés, empreintes de jetons, codes, endpoints privés ou audiences d’autres clients pour rendre la réponse plus complète.
7. Faire vérifier le destinataire et convenir d’un canal protégé. L’export contient des textes/photos en clair : ne pas le placer dans une URL publique, un dépôt ou un artefact CI. Si un conteneur chiffré est retenu, transmettre son secret par un canal distinct et vérifier la remise. Consigner la fin de vie des copies opérateur selon la décision D08.

Le point 5 est une **revue manuelle à préparer**, pas une nouvelle fonction d’export CRM. L’exclusion de ces colonnes dans `server/data/export.mjs` protège son périmètre technique ; elle n’établit pas une exclusion juridique générale. La réponse peut aussi nécessiter des mesures de protection des tiers dans les messages/photos exportés eux-mêmes.

## Rectification, opposition, limitation et notifications

Examiner le besoin et les outils réellement disponibles. Aucun endpoint général de rectification ni registre de limitation n’est ajouté en 0.41. Ne pas promettre une correction effective sans l’avoir réalisée et vérifiée ; une opération SQL ad hoc ne remplace pas un parcours validé.

L’utilisateur peut gérer ses notifications par appareil avec les commandes existantes. Désactiver les notifications ou révoquer une session ne supprime pas le compte, les abonnements conservés ou l’historique. Une future opposition aux diffusions doit conserver l’accès aux conversations privées selon les règles existantes ; cette fonction demeure désactivée dans le runtime actuel. Pour tout droit conditionné au fondement du traitement, compléter D02/D03 avant d’annoncer ses modalités définitives.

## Demande d’effacement : traiter sans certifier une purge inexistante

1. Identifier précisément ce qui est demandé : message, photo de bibliothèque, clôture d’accès ou données du compte et copies. Répondre dans le délai applicable ; l’absence d’exécuteur est une limite de mise en œuvre, pas un motif automatique de rejet.
2. Pour le compte complet, produire seulement la simulation `plan` dans les conditions privées/offline documentées. Elle ne donne ni liste approuvée d’effacement, ni SQL destructif, ni autorisation d’exécution. Examiner ses 23 observations, références partagées, baux, comptages plafonnés, audiences et médias.
3. Fixer la portée D04–D06 et les éventuelles données conservées avec leur motif et durée. Répertorier les sauvegardes, clones, exports et courriers ; distinguer ce qui est maîtrisé par le service des copies déjà remises aux destinataires.
4. Si une interruption d’accès est demandée et réalisable par le parcours existant, la traiter séparément et consigner sa portée exacte. Ne jamais appeler « compte effacé » une simple suspension/révocation ou un statut `deleted` sans purge vérifiée.
5. Préparer le futur protocole durable et ses preuves avant toute suppression complète : neutralisation des producteurs/jobs, révocation ciblée, références et médias, libération après effacement durable, contrôle final et restauration sans réapparition. Aucun de ces cinq points ne constitue une commande autorisée de purge dans le présent lot.
6. La réponse finale distingue les actions vérifiées, les exceptions justifiées, les copies concernées et le travail restant. Ne jamais envoyer une confirmation d’effacement réussi fondée seulement sur `status: complete` du diagnostic.

## Remise en service après une restauration

Les demandes et révocations réalisées depuis la copie doivent être comparées à un suivi indépendant avant toute ouverture ou émission. Le [registre de conservation](data-retention-register.md) décrit la conception encore nécessaire ; aucun mécanisme de rejeu des effacements n’existe actuellement. Préserver les versions de mot de passe et sessions révoquées, les profils de sauvegarde recovery et la couverture limitée documentée. La réussite du checkpoint 0.36 ne prouve pas ce futur protocole.

## Critère de clôture d’un dossier réel

L’opérateur dispose d’une preuve du compte et du destinataire, d’une portée vérifiée, d’une réponse envoyée par le canal convenu et d’un suivi des copies/limites restantes. La réponse et son statut sont fondés sur les actions réalisées, pas sur le seul résultat de l’outil. Aucune donnée réelle ni preuve de remise n’est incluse dans cette préparation publique.
