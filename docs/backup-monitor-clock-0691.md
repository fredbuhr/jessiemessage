# Horodatage du moniteur — 0.69.1

Le contrôle de production du lot 0.69 a montré un `ALERT_INPUT` intermittent malgré une sauvegarde courante. Le moniteur validait une lecture à un premier instant, puis publiait le résultat à un second instant. Une seule milliseconde entre les deux rendait l’âge publié incompatible avec `checkedAt`, et le travailleur d’alertes refusait correctement cette observation.

Le moniteur calcule désormais l’âge avec l’horodatage effectivement publié. Les contrôles du travailleur ne changent pas. Le test de régression fait avancer l’horloge à chaque lecture et soumet le résultat au véritable travailleur ; il échoue avant la correction puis passe sans écriture de file d’alertes ni appel SMTP. Les erreurs d’horloge, les observations futures et les délais continuent à bloquer.

Aucune configuration, archive, destination du PC ou donnée applicative n’est modifiée. Ce correctif du parent est compatible avec le runtime applicatif 0.65, épinglé séparément. La préparation initiale 0.69, sa validation et toute activation restent distinctes ; voir `REPRISE.md` pour l’état réellement observé.
