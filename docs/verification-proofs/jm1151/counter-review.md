# Contre-revue du parcours d’accès1.15.1

Relecture indépendante du diff depuis main04b98b24, avant qualification native. Données synthétiques uniquement, aucune modification des comptes ou de l’hôte.

Une course supplémentaire a été reproduite : un GET de session déclenché par `online` puis un POST d’inscription ; le GET401 arrive pendant le POST, appelle `signedOut` et invalide le202 ultérieur. Résultat initial : formulaire d’inscription visible, statut vide, un POST. Correction : l’époque de soumission est capturée au début de la lecture ; succès et refus d’une lecture antérieure ne modifient plus l’état de la nouvelle soumission. Le `finally` libère toujours la lecture de sa propre époque. Les nouveaux tests couvrent200 et401 et une lecture ultérieure, sans POST supplémentaire.

La même reproduction indépendante après correction obtient le message « compte créé », formulaire fermé et un seul POST. Un autre essai loginA puis preuve finale de sessionB en attente montre l’identitéB et aucun e-mailA réaffiché dans le renvoi.

Autres gardes relus : normaliseur borné et digest des anciens secrets, génération100bits inchangée, travail commun/quotas du renvoi, contrôle du mot de passe et de la génération sous verrou avant écriture, aucun compte activé ou session créée au renvoi, première confirmation unique et frères révoqués, anciennes fenêtres compatibles, effacement des champs privés au masquage, route ESM/CSP/no-store cohérentes. Aucun autre blocage identifié dans ce périmètre.

Limites : concurrence MariaDB réelle et Chrome natif en attente au moment de cette revue. Temps des réponses publiques non garantis parfaitement identiques ; cause exacte du client, Safari, téléphone physique et SMTP réel non attestés. Les résultats natifs finaux sont conservés séparément.
