# Administration plus simple — 0.57

Préparation du 18 octobre 2026. Le runtime actif reste 0.56 jusqu’au relevé d’activation.

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

Les résultats et références d’activation seront consignés après la CI et le cycle normal du Manager. Le repli immédiat prévu est le runtime 0.56 `2faf32ce`, arbre `8bc8029e0b93166ee33ded9cdb6ab65647fb5b40`, avec son lanceur existant. Aucune capture hors ligne ni restauration n’est nécessaire pour ce changement de code.
