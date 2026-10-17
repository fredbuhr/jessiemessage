# Lot 0.43 — fiches privées et administration partagée

**État : préparation testée localement, CI Chrome/SQL à confirmer.** Base : `d18bb02ce201d5c8ebf485ac3f4d3005ebc7b268`, compte rendu de la livraison 0.42. Le runtime hébergé reste `ed78b55e`, profil `messaging-photos-notify-recovery`, schéma 30 ; les fiches privées et les diffusions restent désactivées.

Le même compte administrateur est utilisé sur plusieurs appareils par les personnes autorisées à gérer l’espace Jessie. Les fiches disposent déjà de versions côté SQL : deux sauvegardes partant de la même version ne doivent pas s’écraser silencieusement. Le navigateur conserve le brouillon en cas de conflit et propose de recharger la fiche enregistrée ou de sauvegarder explicitement sa propre version. Une nouvelle modification concurrente reste susceptible de provoquer un autre conflit ; aucun verrou global ni fusion automatique de notes n’est ajouté.

## Défauts reproduits et corrections

Une réponse réussie était rejetée si elle appartenait à un ancien cycle de l’interface, mais une requête rejetée échappait à ce contrôle. Une erreur 401/403 tardive pouvait donc atteindre le gestionnaire de session après une reprise et une autre erreur pouvait remplacer le message d’une action courante. Les succès et échecs utilisent désormais le même contrôle avant et après la requête. Une erreur de connexion du cycle courant est toujours transmise au contrôleur parent.

La finalisation d’une ancienne création ou modification d’étiquette remettait toujours les boutons en état actif. Après masquage/reprise, elle pouvait ainsi déverrouiller une nouvelle action encore en cours. Chaque opération conserve son cycle de départ ; seule une finalisation de ce cycle peut libérer son verrou ou modifier son retour. Le rafraîchissement après conflit vérifie aussi ce cycle après ses attentes intermédiaires.

Une lecture d’étiquettes dépassée s’arrête avant de demander sa page suivante. Une ancienne ouverture du gestionnaire ne remplace pas le statut d’une nouvelle ouverture. Le contrôleur retiré à la déconnexion est définitivement fermé : sa reprise ou un ancien formulaire détaché ne peut pas lancer de nouvelle requête. Enfin, l’échec du rafraîchissement des étiquettes après un filtre devenu introuvable est traité sans rejeter la tâche de boîte de réception sans gestionnaire.

Ces changements concernent le contrôleur des fiches. Ils ne modifient ni l’autorisation des routes, ni les transactions SQL versionnées, ni les règles des sessions, ni les messages/photos. Une requête de mutation déjà reçue par le serveur peut avoir été appliquée avant le masquage ; ignorer son retour ne l’annule pas. À la réouverture, la lecture et le contrôle de version restent la référence.

## Validation

Les premiers tests de régression, exécutés avant correction, reproduisent les erreurs tardives et le déverrouillage intempestif. Après correction, les **30 cas modèle/contrôleur** passent, dont les retours 401/403/409/503 obsolètes, le maintien de l’erreur 401 actuelle, une ancienne création/renommage, le rafraîchissement après conflit, la pagination dépassée et la fermeture définitive.

Localement sous **Node.js 24.19.0**, `npm test` compte **2 077 réussites et 143 intégrations ignorées sur 2 220 cas, zéro échec**. `npm run build`, incluant la syntaxe, et le contrôle du diff passent. Aucune intégration ignorée n’est présentée comme exécutée. Chrome n’est pas disponible localement ; la nouvelle recette appartient au job Chrome de la CI.

Le scénario `tests/browser/crm-collaboration.browser.mjs` charge le vrai module des fiches, ses styles et ses traductions sur une boucle locale. Deux navigateurs représentent le même administrateur et modifient la même fiche synthétique : la première sauvegarde réussit, la seconde conserve son brouillon et montre les notes enregistrées ; seuls un rechargement ou un écrasement explicite permettent la suite. Les quatre cas FR/EN × 375/1 280 px vérifient aussi le texte littéral, l’absence de débordement du dialogue et le retour clavier après Échap. Deux autres cas FR/EN simulent le masquage/reprise avec une ancienne création rejetée et une nouvelle création en attente.

Ce serveur de recette simule les réponses et la concurrence pour éprouver le navigateur. Il ne prouve pas une session réelle, une transaction MariaDB, le parent `chat.js` complet ou tous les appareils du foyer. Les groupes SQL et HTTP CRM existants conservent leurs contrôles d’affectation, d’isolation, de chiffrement et de sauvegarde atomique ; leurs résultats exacts sont à consigner avec la CI. Aucun compte, note ou média réel n’est utilisé et aucune notification, campagne ou livraison e-mail n’est déclenchée.

## Activation suivante

Le [module existant](private-crm.md) exige une clé CRM distincte et les tables déjà présentes au schéma 30. Les lanceurs privés actuels n’offrent pas de profil CRM : ils doivent être étendus de façon explicite avec validation des fichiers, assertions physiques des tables et compatibilité de sauvegarde/restauration avant activation. Cette préparation ne fabrique ni nouvelle clé ni faux reçu de sauvegarde et ne change pas le service en ligne.

Le prochain lot porte sur cette configuration privée et sa sauvegarde, puis sur une activation et une recette ciblées des fiches. Les diffusions restent un lot séparé. Les parcours de récupération, photos et notifications déjà acceptés ne sont pas redemandés ; aucune démarche déclarative n’est ajoutée au périmètre privé Jessie.
