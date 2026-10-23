# Six évolutions — 1.9.0

Le [cahier fourni](specs/cahier-20261023.md) définit le périmètre. Les six fonctions sont codées ; la qualification finale reste en cours. L’application active reste **1.8.4 / SQL36**. [État et preuves](verification-proofs/experience190-progress.json), [reprise opérateur](REPRISE.md).

| Fonction | Résultat implémenté |
| --- | --- |
| Goûts et fantasmes | Rubrique facultative dans les deux profils, catalogue exact de 691 choix / 25 catégories / 934 alias, recherche FR/EN, catégories repliables, résumé, sauvegarde et effacement. Sélections chiffrées côté serveur ; consultation administrative liée à la conversation, en lecture seule. Conflit explicite sans écraser le brouillon. |
| Vidéo | Création réservée à l’administration dans l’interface, HTTP, service et stockage, y compris réutilisation d’un ancien identifiant. Photos clientes et lecture des anciennes vidéos conservées. |
| Galerie photo | Pagination de l’historique autorisé, ordre date du message puis identifiant, miniatures et filtre par mois dans le fuseau de l’interface, flèches, clavier et balayage, zoom natif et retour au message ancien. Une seule image originale ouverte ; fermeture sans saut de lecture. Année visible pour distinguer les anciens échanges. |
| Photos multiples | Dix fichiers au maximum, aperçus modifiables, traitement sériel, progression et identifiants stables. Reprise des seuls échecs ou accusés incertains, sans répéter les réussites ni la légende. Aucun nouveau stockage persistant de photos dans le navigateur. |
| À répondre | Une tâche réservée par conversation, filtre et actions rapides. Lecture indépendante du traitement ; réponse individuelle limitée à la borne vue. Diffusions et notifications n’effacent pas le suivi. Version et borne protègent les messages simultanés ; reprise historique déterminable. Invisible aux clients. |
| Compte | Mot de passe actuel, nouveau et confirmation, minimum partagé de huit caractères. Rotation atomique de l’appareil courant et révocation des anciennes sessions et liens de récupération client. Les clés des messages/médias et le comportement ordinaire des sessions persistent. Œil partagé dans les formulaires. |

## Compatibilité

Les migrations de base 1–33 et vidéo 34–36 restent identiques. Le profil explicite `--experience 1` ajoute 37 (préférences) et 38 (champs de suivi dans les tâches), soit **37 tables physiques et 38 migrations**. Il conserve le chiffrement et les composants existants. Les adaptations du cycle de vie servent uniquement cette couverture ; aucun nouveau service ou chantier de sauvegardes n’est ouvert.

Le repli technique **1.8.5** accepte SQL38 sans activer les fonctions190 et protège les tâches réservées des écritures génériques. Ses quatre tests de fonctions dormantes sont qualifiés sur sa source séparée ; les tests190 vérifient les fonctions actives et les mêmes interdictions d’écriture. Aucun retour vers SQL36 ni démarrage brut de184/172 sur38.

## Validation et livraison

Les preuves séparent tests locaux, Chrome synthétique, HTTPS avec vraie base SQL et MariaDB10.11/11.4. Elles ne constituent pas un essai sur téléphone physique ou sur l’hébergement. Aucun compte réel n’a servi aux essais. La fusion et les CI exactes précèdent publication, préparation, migration, CHECK, activation et enregistrement ; chaque étape doit avoir son reçu. Aucune activation190 n’est acquise à ce stade.
