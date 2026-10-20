# Compatibilité des profils — 1.1.1

Préparation du repli pour l’évolution « Profil et expressions » 1.2.0. La production reste la 1.1.0 identifiée dans [REPRISE](REPRISE.md) ; cette préparation n’est ni une migration hébergée ni un déploiement.

La migration additive 0031 ajoute uniquement `user_profiles` : référence au compte, référence facultative à un média privé existant, version et dates. Les trente migrations historiques restent immuables. Aucun compte, message, média ou reçu existant n’est réécrit par cette création de table. Aucun éditeur de profil ni sélecteur d’emojis n’est ajouté à cette livraison de compatibilité.

Les inventaires stricts sont portés à 31 migrations, 30 tables applicatives plus le registre et 42 clés étrangères. L’export personnel inclut uniquement le profil propre du client ; la fermeture définitive supprime ce profil avant ses médias. Les lectures de preuves de couverture 30 restent distinctes de la couverture 31 ; les nouvelles captures et restaurations courantes exigent 31. Les artefacts D1, le PC, les clés et l’incident antivirus restent préservés.

Cette référence doit être validée et publiée avant toute migration hébergée. Après la migration 0031, le tag 1.1.0 refuserait une base plus récente que son code ; la 1.1.1 fournit donc un repli qui accepte ce schéma, sans ouvrir les nouvelles fonctions du profil. Aucun retour SQL destructif n’est prévu.

Validation du candidat, publication et commandes épinglées restent à consigner après observation. La qualification utilisera les suites habituelles avec données synthétiques ; aucun envoi ni effacement sur un client réel n’est nécessaire.
