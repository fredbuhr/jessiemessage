# Sauvegarde et restauration sur clone — 0.16

Ce lot fournit une préparation de sauvegarde, une vérification cryptographique et une réparation des réservations connues sur une **base et un répertoire copiés et isolés**. Il ne lance ni serveur, ni worker, ni transport SMTP. Il ne crée pas de dump SQL ou d'archive et ne touche jamais automatiquement à une sauvegarde distante. **contact@jessiemessage.com** reste l'adresse du site. Les 27 migrations, les dépendances, les clés et les visuels approuvés restent inchangés.

## Pourquoi un clone

Un producteur ancien peut être suspendu entre sa réservation SQL et son écriture de fichier. Un délai d'attente ou un nouveau verrou ne prouve pas qu'il ne reprendra jamais. La réparation impose donc une autre base, un autre chemin canonique non imbriqué et une autre identité physique du répertoire. Un simple renommage, lien symbolique, lien physique ou alias du même répertoire ne convient pas. L'identité physique est contrôlée séparément du chemin pour refuser aussi un montage du même répertoire sous un autre chemin.

Le manifeste contient des empreintes HMAC distinctes du nom de base, du chemin et de l'identité physique, sans exposer ces valeurs en clair dans le rapport. Le nom de base est lu par `SELECT DATABASE()`. L'ancienne association du stockage reste dans la copie SQL jusqu'à la fin : le serveur ordinaire refuse de démarrer sur le nouveau répertoire tant que la restauration n'a pas réussi.

`--offline` est une déclaration de l'opérateur. Le programme ne peut pas prouver l'arrêt de processus sur un autre hôte. Tous les serveurs, tâches planifiées, workers et outils d'écriture doivent rester arrêtés pendant la préparation, la copie et la vérification. Une copie cohérente nécessite aussi cet arrêt ; deux lectures identiques ne prouvent pas à elles seules l'absence d'un producteur externe.

## Préparer un ensemble cohérent

1. Arrêter les producteurs et confirmer l'état des migrations. Utiliser les identifiants d'exécution DML distincts des identifiants de migration. Fournir aussi `JESSIEMESSAGE_BACKUP_SCHEMA_USER` et `JESSIEMESSAGE_BACKUP_SCHEMA_PASSWORD` pour un compte d'inspection distinct, avec un droit direct `ALL PRIVILEGES` sur le nom exact de chaque base inspectée : les `_` du nom doivent être échappés dans le `GRANT`. Les droits globaux, rôles implicites et motifs de noms de base ne constituent pas cette preuve. Ce pool séparé n'exécute que des lectures de métadonnées ; il ne modifie ni données ni droits. Aucun privilège supplémentaire n'est donné au compte applicatif par la commande.
2. Dans l'environnement privé de la source, fournir les cinq clés distinctes MFA, e-mail, message/diffusion, média et CRM. La commande utilise les configurations existantes avec leurs fonctionnalités explicitement activées, sans démarrer ces fonctionnalités.
3. Placer le manifeste dans un répertoire privé `0700`, hors du répertoire média. Le fichier est créé exclusivement, en `0600`, sans écrasement, lien ni exposition du chemin dans le rapport.

```sh
npm run backup -- prepare --offline --manifest /chemin/prive/sauvegarde/manifest.json
```

La préparation refuse les déclencheurs, événements et routines non applicatifs et les clés étrangères visant une autre base. Elle vérifie le schéma, tous les enregistrements applicatifs, les compteurs du journal et les fichiers actifs. Elle refuse les fichiers inconnus, temporaires, dangereux, manquants pour un actif ou de taille incorrecte. Les fichiers connus réservés ou en attente de suppression peuvent manquer. Les fichiers d'un objet déjà libéré doivent être absents.

Le manifeste signé contient un condensat du schéma et des données SQL, les métadonnées du journal et cinq témoins chiffrés créés **avant la copie**. Ces témoins permettent de détecter une mauvaise clé après restauration même lorsqu'un domaine ne contient encore aucune donnée. La vérification contrôle aussi les véritables données existantes : MFA, deux finalités de file e-mail, messages et empreintes, notes et révisions CRM, diffusions et audience, authentification GCM des deux variantes de chaque photo active et condensat de l'image complète. Aucun texte, jeton, e-mail ou fichier déchiffré n'est écrit dans les rapports.

4. Tant que la source reste arrêtée, effectuer le dump cohérent complet avec l'outillage de l'hébergeur et copier le répertoire chiffré en préservant les fichiers privés. Conserver l'historique `schema_migrations` avec les données. Copier les fichiers, ne pas les lier. Conserver séparément les cinq clés, le manifeste et les informations de configuration nécessaires, dans des emplacements privés à accès contrôlé. Les fichiers chiffrés et le manifeste ne remplacent pas les clés.
5. Importer vers un autre nom de base explicitement confirmé et copier les médias dans un nouveau répertoire privé `0700`, fichiers `0600`. Conserver la source et les sauvegardes. Configurer l'environnement de la commande pour cette copie ; ne pas encore démarrer le serveur.

## Vérifier puis réparer la copie

```sh
npm run backup -- verify --offline --manifest /chemin/prive/sauvegarde/manifest.json
npm run backup -- restore --offline --manifest /chemin/prive/sauvegarde/manifest.json
```

`verify` ne modifie ni SQL ni les médias. Une réussite prouve les contrôles de cette copie au moment du parcours, pas la disponibilité d'un futur hébergement. Elle autorise les progressions d'une réparation déjà interrompue, mais refuse toute autre divergence par rapport au manifeste.

`restore` ne cible que les objets marqués `reserved` ou `cleanup_pending` dans le manifeste signé. Les photos actives, même sans message ou liées à une campagne en attente, restent conservées. Pour chaque candidat :

1. Une transaction verrouille le compteur global, vérifie l'identité et les métadonnées et clôture la réservation en `cleanup_pending`.
2. Après confirmation SQL positive, le stockage supprime ses deux variantes connues et synchronise le répertoire.
3. Une transaction libère l'objet et soustrait exactement une fois sa taille du compteur.

Un résultat SQL incertain arrête le parcours. Une suppression partielle conserve la charge ; une nouvelle tentative avec **le même manifeste** reprend les étapes idempotentes. Le journal signé constitue le plan durable ; les transitions autorisées sont limitées aux candidats initiaux. Un objet déjà libéré exige l'absence de ses fichiers. Aucun délai ne déclenche une libération et aucun fichier inconnu n'est supprimé.

Après réparation, de nouveaux contrôles SQL, structurels et cryptographiques doivent réussir. La réassociation finale change seulement l'empreinte du répertoire dans la même transaction que ses derniers contrôles de compteur. Les plafonds restent identiques. Après une confirmation incertaine de cette dernière transaction, relancer la même commande hors ligne : elle contrôle l'état existant sans soustraire de nouveau la capacité. Une fois le serveur repris et de nouvelles données écrites, l'ancien manifeste ne correspond plus au nouvel état.

## Validation et limites

Les tests emploient des clés aléatoires, des comptes fictifs et deux bases explicitement jetables. Ils couvrent la copie SQL/médias, les contrôles des clés, les refus de divergence et la reprise après panne. La CI valide MariaDB 10.11 et 11.4 avec les mêmes droits DML que l'application. La preuve exacte de la révision est ajoutée après son exécution.

La copie et l'exercice de restauration sur l'hébergeur réel restent à organiser et mesurer : durée, espace disponible, droits, sauvegardes externalisées, chiffrement de l'archive, conservation et restauration des secrets. Les limites par défaut sont de 100 000 lignes SQL et 100 000 entrées de stockage ; une limite atteinte échoue sans certification partielle. Le manifeste privé peut contenir des identifiants et métadonnées : il ne doit entrer ni dans Git, ni dans les logs publics, ni dans l'aperçu téléchargeable.

La réparation du répertoire d'origine, l'effacement automatique des fichiers inconnus, la rotation des clés et le changement des plafonds sont hors de ce lot. Les chaînes de texte déchiffrées passent temporairement en mémoire Node.js ; l'effacement des buffers ne garantit pas l'effacement immédiat de toutes les copies gérées par le moteur JavaScript. Aucun dump, compte, fichier ou hébergement de production n'a été utilisé. SMTP réel, majorité externe, rétention/export et recette HTTPS/appareils restent dans le [plan de publication](NEXT-STEPS.md).
