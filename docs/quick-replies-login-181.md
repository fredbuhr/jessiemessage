# Correctifs 1.8.1 — réponses rapides et accès aux sauvegardes

**En développement, pas encore déployé.** La production reste la 1.8.0, identifiée dans [REPRISE](REPRISE.md). Ce correctif regroupe les deux retours utilisateur du 22 octobre ; il ne change ni SQL36, ni Node 24.22.1, ni les configurations privées.

## Comportement attendu

- Les six phrases proposées et les réponses ajoutées apparaissent dans une seule liste de réponses rapides, filtrée par langue. Les réponses ajoutées conservent leurs commandes de modification et de suppression ; choisir une phrase l’insère dans le brouillon sans l’envoyer.
- L’adresse exacte `/admin/login/` redirige automatiquement vers `/admin/login` pour GET et HEAD, avec ses paramètres. Les autres chemins et les API gardent leurs règles. Cette correction concerne les requêtes qui atteignent l’application ; le contrôle après déploiement reste nécessaire si une page est produite par le frontal Infomaniak.

L’utilisateur confirme que l’enregistrement d’une réponse fonctionne. La vidéo est déjà validée par son retour précédent. La sauvegarde reste non testée : les nouvelles captures montrent encore une page Infomaniak sur l’adresse de connexion avec une barre finale, avant l’accès à l’écran de sauvegarde. La cause de cette page fournisseur n’est pas établie.

## Qualification et livraison

Les contrôles ciblés puis la CI complète de la PR et du commit fusionné doivent qualifier la même source avant publication et déploiement. Le correctif utilise le bundle vidéo existant et ne demande aucune migration, initialisation, nouvelle clé, suppression ou manipulation du PC.

Contrôles locaux sous Node 24.22.1 : connexion/navigation 26/26 ; cycle de vie 81/81 ; accessibilité 21/21 ; internationalisation 14/14 ; phrases fixes 4/4. Le premier passage du cycle de vie a révélé un sélecteur absent de sa fixture VM ; la fixture corrigée et le nouveau cas de focus passent, l’échec initial reste conservé. La syntaxe de 704 sources et le build passent. Les scénarios Chrome ont été adaptés, sans exécution locale faute de binaire ; la qualification native et globale reste à obtenir en CI.

Le déploiement sera réalisé depuis le terminal personnel de l’utilisateur, avec les liens et commandes exacts fournis dans le chat. Le navigateur cloud n’est pas utilisé. La création, la fin et le téléchargement d’une sauvegarde restent le contrôle fonctionnel hébergé à effectuer ; les preuves et commandes historiques ne sont pas rejouées.
