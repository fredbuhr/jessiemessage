# Repli applicatif 1.8.5 — candidat SQL38

État du 23 octobre 2026 : **codé et testé localement, qualification native séparée en attente**. Aucun déploiement, tag, source Git final ou repli de production acquis par ce paquet.

Base applicative : main904ab4301bbda71e047d5b3b5dad41d45149c1cf, arbre268ac40ea40b21de8b027e5f6171070834a7618f, interface et fonctionnalités1.8.4. Version du candidat : **1.8.5**, Node prévuv24.22.1, dépendances verrouillées inchangées. L’application active reste1.8.4/SQL36 selon la reprise historique.

Le paramètre existant `--experience 1` sélectionne ici **uniquement le schéma SQL38** :37 tables physiques,38 migrations et adaptations des lecteurs/captures/clôtures existants. Aucun handler de préférences, de changement de mot de passe ou de suivi « À répondre » n’est installé. Les préférences sont conservées chiffrées ; leurs helpers ne servent qu’aux contrôles de schéma et de données existants. Les fichiers du catalogue et du modèle sont des dépendances internes de ce décodeur, sans nouvelle route statique ou interface.

Les tâches réservées `reply_kind='reply'` sont exclues des listes, accès directs et résumés génériques ; toute tentative de sauvegarde est refusée sous le verrou existant avant déchiffrement ou idempotence. Les tâches ordinaires restent modifiables. Aucune écriture de messages1.8.5 ne modifie leur watermark ou preuve : au retour1.9.0, certains statuts « À répondre » peuvent donc rester conservateurs. Les nouvelles sélections et les anciens messages/médias sont préservés.

L’envoi de vidéo par un client reste interdit dans l’interface et les couches HTTP/service/stockage. Les photos clientes, les vidéos historiques et les envois administrateurs conservent leurs formats, limites et racines. Aucun nouveau formulaire de compte, galerie, envoi multiple, nouvelle infrastructure ou flux de sauvegarde n’est introduit.

La couche opérationnelle SQL38 est reprise du candidat1.9.0 existant : chargeurs exacts, assertions des stores, préflight, parent et enfant, snapshots et manifestes, checkpoints capture/import/vérification/reprise et graphe d’effacement. Les plans et formats historiques33/36 restent inchangés. Les nouvelles données SQL38 ne sont ni supprimées ni converties au démarrage du repli. Les mots de passe et sessions créés1.9.0 emploient les formats existants et ne nécessitent aucune conversion ni révocation à la bascule.

Contrôles locaux sous Nodev24.19.0 : ciblage274tests,267 réussis,7 ignorés,0 échec ; puis suite générale3993tests,3752 réussis,241 ignorés,0 échec (40,6s). Les omissions SQL/procfs/Chrome ne sont pas une qualification native. Les tests historiques d’envoi vidéo de chat utilisent maintenant un administrateur, par adaptation minimale des seuls scénarios concernés ; la lecture et le refus client restent couverts. Le test réel `tasks-compat185.integration.test.mjs` est ajouté à `test:db`, et le rehearsal dédiéSQL38 est ajouté à `test:auth-browser`. Leur exécution native doit qualifier le commit185 exact sur PR puis main, avec les cinq jobs du workflow original, avant de déclarer ce repli disponible. Les contrôles réalisés seront complétés par le responsable de qualification.

Le futur receipt185 devra distinguer38 migrations/37 tables et indiquer `preferencesEnabled:false`, `replyTrackingEnabled:false`. Si le champ `experienceEnabled:true` est conservé par l’opérateur, il désigne exclusivement le profil de schéma. Pins source/arbre/tag, empreintes du lanceur/CHECK et reçu de staging restent à produire après qualification ; aucun chemin hébergé n’est créé par ce paquet.

Les anciens replis1.7.2/1.8.4 ne sont pas utilisables surSQL38. Cette1.8.5 constitue un artefact distinct à qualifier. Les opérations et preuves historiques ne sont pas réécrites par sa préparation.
