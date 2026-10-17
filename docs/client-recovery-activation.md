# Lot 0.39 — récupération client et sauvegardes compatibles

**Lot 0.39 activé le 17 octobre 2026 à 18:28 Europe/Paris ; parcours essayé accepté à 18:52:47.** Runtime `b651d44ed5909173008d896e7175ecb7a4c1b703`, arbre `87f2a0357a992076e9b28decf18cd0aee7ec4108`, schéma 30, profil `messaging-photos-notify-recovery`, déploiement `primary-transition`. [PR brouillon #54](https://github.com/fredbuhr/jessiemessage/pull/54). Le [plan initial](client-recovery-readiness.md) conserve les constats de départ. Ce document distingue le code livré, les preuves automatisées et la réception réelle.

**Acceptation propriétaire — 17 octobre 2026 à 18:52:47 Europe/Paris :** « test mot de passe ok, continue ». Le parcours de récupération essayé est accepté globalement. Ce retour ne précise ni la plateforme, ni un essai de réutilisation du lien, ni le Push après reset ou tous les appareils ; aucune répétition globale n’est demandée. Les vérifications détaillées restent des références pour un incident ciblé.

## Périmètre

Le nouveau profil privé `photos-notify-recovery` exige `--deployment primary-transition`. Il réutilise les cinq fichiers de configuration existants, la clé de mail et le transport SMTP. Le chargement des fichiers n’active rien : le lanceur choisit explicitement la récupération et le serveur exige cette même intention. Les anciens profils continuent à refuser une activation par variable d’environnement.

La récupération est proposée sur `https://jessiemessage.com` seulement. Recette conserve les connexions et notifications existantes, sans route de récupération ni capacité annoncée pour cette fonction. CRM et diffusions restent désactivés. Aucun changement de schéma, de droits SQL, de clé, de dépendance ou de DNS n’est prévu.

## Sauvegardes et formats

| Sélection | Manifeste | Reçu | Couverture |
| --- | --- | --- | --- |
| `photos-notify` historique | v3, `messaging-photos-notify` | v1 | Schéma strict historique |
| `photos-notify-application` historique | v4, `messaging-photos-notify-application` | v2 | Trente tables applicatives et médias |
| `photos-notify-recovery` | v5, `messaging-photos-notify-recovery` | v3 | Schéma strict, récupération comprise |
| `photos-notify-recovery-application` | v6, `messaging-photos-notify-recovery-application` | v4 | Trente tables applicatives et médias, récupération comprise |

Le snapshot applicatif reste en version 2. Les objets SQL exécutables restent exclus et leur inventaire non prouvé dans la couverture applicative. Le nouveau profil ne transforme pas cette couverture en sauvegarde complète de la base.

Le vérificateur limité authentifie les charges de récupération avec la clé de mail et leur finalité cryptographique distincte. Il vérifie le destinataire, le challenge, le condensat du jeton et celui de l’e-mail. Il conserve le contrôle des messages, photos et inscriptions Push, et refuse toute table CRM ou de diffusion peuplée. Aucun worker ou transport n’est créé par ces opérations.

Les outils de capture, de vérification du clone et d’import acceptent l’option explicite `--profile photos-notify-recovery`. Les commandes applicatives conservent leur suffixe `-application` ; elles transmettent le profil applicatif correspondant au vérificateur de sauvegarde. Sans cette option, les anciens formats et refus sont conservés. Le reçu et le manifeste doivent correspondre au profil choisi : aucun changement d’étiquette ni repli silencieux n’est accepté.

Le profil de sauvegarde avec récupération accepte une fonction active **ou désactivée**. Cette compatibilité reste nécessaire après désactivation dès lors que des demandes existent. Les lignes ne sont ni effacées ni ignorées pour faire réussir une vérification.

## Preuves de livraison

Les cinq [jobs CI de la révision exacte](https://github.com/fredbuhr/jessiemessage/actions/runs/39049293381) réussissent avant activation :

| Vérification | Résultat |
| --- | --- |
| Syntaxe, tests généraux, construction | 2 160 réussites, 27 wrappers SQL ignorés, 2 187 cas au total |
| MariaDB 10.11 | 376/376, aucun ignoré |
| MariaDB 11.4 | 376/376, aucun ignoré |
| Chrome applicatif | 73/73, aucun ignoré ; 14 nouveaux scénarios de récupération et leur groupe parent |
| Authentification Chrome/HTTPS/MariaDB | 1/1, aucun ignoré |

Localement, 2 044 tests passent et 143 intégrations sont ignorées faute de leur environnement ; syntaxe et construction passent. Le nouveau scénario SQL utilise de vraies lignes et charges chiffrées reset/Push, une copie SQL isolée, et la capture/vérification/restauration idempotente de son snapshot. Les scénarios de coexistence et de réinitialisation A avec le cookie B passent sur les deux versions MariaDB. Ces preuves synthétiques ne sont pas une nouvelle répétition de l’import natif hébergé avec le domaine reset peuplé.

Le checkout `/srv/customer/jessiemessage-operator/client-recovery-b651d44e` passe son préflight à **18:26:04.522524**, sans listener : profil attendu, schémas physiques et stockage conformes. Le lanceur privé exclusif `0700` `/srv/customer/jessiemessage-private/start-primary-recovery-b651d44e.sh`, créé à **18:27:09.606827**, porte le SHA-256 `9a6add8b9d2cb265bf2954ef79df5e53325d50b3c621c40b2bdd8e8273443a27`. Run/Build épinglent source et arbre propres. Le build/redémarrage Manager réussit à **18:28** ; les logs confirment le profil et le listener 3000.

À **18:29:21.098393**, **66/66 contrôles** passent : 62 HTTPS avec résolution normale et TLS vérifié, quatre Host loopback. Les **32 empreintes exactes** couvrent douze fichiers statiques sur chaque origine, quatre pages de reprise et les quatre fichiers de récupération sur l’apex. Les capacités primaires sont actives, les routes de récupération recette absentes, les mutations cross-origin refusées, les corps malformés refusés sans cookie, les sources privées fermées et `www` canonicalisé. Pairs observés : Node `185.125.27.89` pour apex/recette ; Apache `185.176.225.16` pour `www`.

Dans Chrome réel, `/access` affiche **Mot de passe oublié ?** ; son lien ouvre le formulaire `/recover`. Titre et libellés passent en anglais puis reviennent au français. Une capture anonyme est conservée. Aucun e-mail, mot de passe, compte connecté ni Push réel n’est utilisé pendant ces sondes ; elles ne certifient pas la réception personnelle ou le fonctionnement de chaque appareil.

## Effets sur les comptes

Activer la fonction ou demander un lien ne change aucun mot de passe ni aucune session. Le lien dure trente minutes et ne sert qu’une fois ; son ouverture seule ne le consomme pas. Le jeton disparaît de l’URL avant les requêtes applicatives et reste uniquement en mémoire pendant le formulaire.

La validation révoque les sessions du client ciblé et incrémente sa version d’identifiants, sans rétablir ni prolonger son accès. Les comptes administrateur et les autres clients sont préservés. La réponse ne renvoie plus d’effacement inconditionnel du cookie client : un autre client connecté dans ce navigateur conserve donc sa session. Le contrôle normal rejette et nettoie le cookie du compte révoqué lorsqu’il est présenté ensuite.

La confirmation du formulaire invite à se reconnecter sur ses appareils. Les anciennes inscriptions Push du client réinitialisé deviennent inéligibles ; après reconnexion, il faut les rattacher avec **Activer sur cet appareil**. L’administration n’est pas concernée par cette réinitialisation client.

Les messages de demande restent neutres quant à l’existence et à l’éligibilité du compte. Le formulaire reste français/anglais ; l’e-mail de récupération est encore français, désormais au tutoiement. Il ne contient jamais le mot de passe.

## Vérifications de référence et acceptation

- Vérifier les anciens formats et les nouveaux profils, les refus de déclassement et les charges altérées.
- Prouver sur les deux MariaDB de CI la capture et la vérification cryptographique d’un état contenant de vraies lignes de récupération, puis la restauration de sa copie SQL isolée. Cette preuve ne doit pas être présentée comme une nouvelle répétition de l’import natif hébergé.
- Exercer le formulaire réel dans Chrome : français/anglais, petits écrans, validation, succès, lien consommé/expiré, perte de réponse, nouvelle tentative explicite et absence de rejeu automatique.
- Vérifier le runtime réel avec les deux origines : récupération présente sur l’apex et absente sur recette, schéma physique et sessions existantes conservés.
- Attendre les cinq jobs CI de la révision exacte avant tout démarrage hébergé. Passer ensuite le préflight sans listener et les contrôles HTTPS de la révision épinglée.

Le retour propriétaire ci-dessus accepte le parcours essayé. Les scénarios de lien consommé, de coexistence des comptes et de Push restent des références ciblées si un incident apparaît ; ce retour ne détaille pas leur exécution réelle. Aucun mot de passe n’est demandé dans la discussion et aucune réinitialisation administrateur n’est requise.

Les quotas réseau existants restent inchangés : aucune confiance supplémentaire n’est accordée aux en-têtes de proxy. La conservation des challenges de récupération reste à définir ; aucune purge ou durée nouvelle n’est introduite.

## Repli

Le repli runtime direct utilise `4433309f` et son lanceur `/srv/customer/jessiemessage-private/start-primary-transition-language-4433309f.sh`, sans repli SQL ou DNS. Désactiver la récupération conserve le schéma et les nouvelles lignes. Ne pas restaurer les anciens mots de passe, ressusciter les sessions révoquées ou supprimer les demandes. Après création de données de récupération, conserver les outils de sauvegarde compatibles même si le runtime revient au profil sans récupération. Un redémarrage impose de recommencer les reprises d’appareil qui étaient en cours.

Référence de conception consultée le 17 octobre 2026 : [OWASP Forgot Password Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html), notamment réponse neutre, jeton à usage unique et limité dans le temps, absence de connexion automatique après modification et révocation des sessions concernées. Cette référence ne vaut pas certification complète du service.
