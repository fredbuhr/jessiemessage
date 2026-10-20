# Administration quotidienne — état du service 0.84

**Interface codée et relue, 44 tests ciblés réussis ; qualification Chrome/CI et déploiement en attente. Le service courant reste 0.83.** L’utilisateur a demandé le 20 octobre à 14:29 Europe/Paris de différer le problème antivirus et d’avancer sur l’application. Aucune action sur son PC n’est nécessaire pour ce lot.

L’écran `/admin/readiness` affichait en permanence « Préparer le site », « Avant l’ouverture » et une réception d’e-mail « restant à tester ». Ces textes décrivaient une liste statique : la page ne possède aucun registre des essais humains déjà réalisés. Ils entretenaient donc une liste de travail apparente, même après des essais acceptés.

L’écran devient **État du service** : mesures du serveur en premier, accès direct à la messagerie, compteurs et diagnostic dans **Détails techniques** fermé au chargement. Les fonctions configurées et l’adresse d’envoi restent visibles. **Contrôles ponctuels**, fermé par défaut et accessible au clavier, propose les essais utiles après un changement ou un problème ; les essais réussis ne sont plus présentés comme systématiquement à refaire.

Le bouton e-mail reste facultatif. Son résultat indique la connexion chiffrée et l’authentification, avec une date propre à la session, sans envoi d’e-mail ni nouvelle affirmation de réception. Les gardes de session, CSRF, réponse obsolète et effacement privé sont conservées ; le nettoyage referme aussi les détails techniques. Aucun état d’acceptation humaine, changement d’API, schéma, dépendance ou infrastructure ajouté. Le [guide quotidien](guide-jessie.md) suit ce parcours et renvoie à REPRISE pour la version déployée.

Validation locale : **44/44 tests readiness-i18n/modèle**, sans omission ni échec ; syntaxe **568 fichiers**, aperçu construit. Deux revues indépendantes de l’interface, des traductions et de la portée SMTP sans blocage. La matrice Chrome existante est adaptée en FR/EN à 320, 375 et 1 280 pixels : ordre et titres, deux volets fermés, ouverture clavier, diagnostic, absence de débordement et d’appel SMTP automatique. Elle reste à exécuter en CI ; aucun navigateur local exécuté.

Les [preuves structurées](verification-proofs/jm084-verification.json) distinguent code, tests locaux, CI, déploiement et limites. A01 Node fourni et A08 archivage restent distincts. L’incident PC A07 est conservé et différé à la demande de l’utilisateur ; il n’est ni résolu ni un préalable au développement courant. Les fichiers PC, clés, autorité et D1 restent préservés.
