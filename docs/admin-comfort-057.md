# Administration plus simple — 0.57

**Activée le 18 octobre 2026 à 19:57 Europe/Paris**, source `53246777`, arbre `9b517b6c`. [PR #73 fusionnée](https://github.com/fredbuhr/jessiemessage/pull/73). Le [dossier de reprise](REPRISE.md) et les [preuves structurées](activation-proofs/jm057-activation.json) donnent les commandes et le repli exacts.

## Connexion

Une navigation depuis un autre site peut arriver sans le cookie `SameSite=Strict` existant. Les refus précédents des pages privées effaçaient ce cookie ou affichaient un refus JSON. Le nouveau passage par le document public `/admin/login` permet une preuve de session depuis la même origine, puis rejoint la page demandée. Une session encore valide est conservée : aucun nouveau jeton et aucune saisie supplémentaire.

Le passage concerne uniquement GET/HEAD de documents HTML, les cinq pages administrateur connues et leurs handlers effectivement activés. Le principal et la recette utilisent leurs propres handlers ; les sauvegardes ne deviennent pas disponibles en recette. Les API gardent leurs refus. Une session présentée mais expirée ou révoquée reste refusée. Les paramètres de retour sont limités à quatre chemins exacts ; ni URL extérieure, ni doublon, ni chemin libre. Les références de notifications existantes sont conservées.

Cookies Strict, Secure, HttpOnly et préfixe `__Host-` conservés. Mot de passe, MFA, origine, CSRF, révocations et 180 jours glissants inchangés. Un refus 403 d’une capacité de conversation affiche une reprise au lieu de présenter l’administrateur comme déconnecté ; une authentification refusée 401 ferme toujours l’accès.

## Usage quotidien

L’accueil donne directement accès aux conversations, invitations/clients, sauvegardes et état du service. Les sauvegardes montrent d’abord la dernière copie, puis les destinations. Le raccordement et les réglages d’une destination existante sont repliés. Les détails techniques, le contrôle ponctuel de déchiffrement et l’aide au changement d’appareil restent accessibles séparément.

L’état « dernière sauvegarde copiée » exige une destination active et raccordée, ainsi que l’identifiant, la taille et le SHA-256 exacts de la dernière archive. Il atteste une réception passée, pas un déchiffrement. La copie automatique exige toujours un PC allumé, connecté et une session Windows ouverte. Le déchiffrement personnel reste à constater ; aucun résultat n’est inventé.

Aucun kit à réinstaller, aucune nouvelle clé, aucun changement de données ou de schéma. Le collecteur PC et le vérificateur Windows 0.56 restent identiques. Le dossier se change avec le raccourci déjà installé sur le Bureau.

## Vérification et activation

Contrôles HTTP de la navigation, des origines, des routes désactivées et des refus API. Régression Chrome dédiée avec deux sites HTTPS locaux : cookie Strict réellement absent au premier GET, preuve depuis la même origine et conservation du même jeton ; retour profond et refus des retours extérieurs/doublons. Écran des copies couvert au clavier, en français/anglais et sur trois largeurs ; une taille de reçu différente ne doit pas confirmer la copie.

CI [source](https://github.com/fredbuhr/jessiemessage/actions/runs/39151369335), [PR](https://github.com/fredbuhr/jessiemessage/actions/runs/39151389889) et [main](https://github.com/fredbuhr/jessiemessage/actions/runs/39151664880) : cinq jobs réussis chacune. Source exacte : 2 488 réussites, 27 wrappers SQL ignorés sur 2 515 cas ; 383/383 sur chacune des deux versions MariaDB ; 112/112 Chrome ; authentification HTTPS/MFA ; syntaxe et build conformes. Sur l’hébergement, 95/95 sans saut puis préflight réussi sans démarrage ni capture.

Le cycle Manager, sans réinstallation, a été lancé à 17:57:51.679 UTC ; état Actif et modification 19:57 Europe/Paris. Mesures après le dernier démarrage à 17:58:08.886 et 17:59:08.929 UTC : current / OK, aucun incident ni alerte en attente. À 17:59:58.923900 UTC, 44/44 contrôles HTTPS et 18 empreintes exactes, sans désactiver TLS ni suivre les redirections. [Preuve visuelle](activation-proofs/jm057-activation-20261018.jpg).

Dernier reçu PC observé à 17:56:29.005 UTC, avant cette activation : il confirme la copie courante, sans revendiquer un nouveau passage du PC après le redémarrage. À 18:01:01.951179 UTC, source propre, version 0.57.0, même journal et dernier succès ; état d’alerte vide. Un premier relevé supposait le fichier d’alerte toujours présent ; le lecteur applicatif valide aussi son absence comme état vide. Seule cette lecture diagnostique a été corrigée, aucun contrôle HTTPS répété.

Le repli immédiat est le runtime 0.56 `2faf32ce`, arbre `8bc8029e0b93166ee33ded9cdb6ab65647fb5b40`. Run/Build ont été sauvegardés avant changement dans `/srv/customer/jessiemessage-private/manager-before-admin-comfort-057.json`, 0600. Aucune capture hors ligne, restauration SQL, migration, nouvelle clé, révocation de session ou alerte de test dans ce lot.
