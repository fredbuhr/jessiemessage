# Lot 0.39 — récupération client et sauvegardes compatibles

**État : implémentation en cours de validation, non activée.** Le service hébergé reste au lot 0.38 `4433309f`. Le [plan de préparation](client-recovery-readiness.md) donne les prérequis et les limites de départ. Ce document distingue le code préparé, les preuves automatisées et la réception réelle.

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

## Effets sur les comptes

Activer la fonction ou demander un lien ne change aucun mot de passe ni aucune session. Le lien dure trente minutes et ne sert qu’une fois ; son ouverture seule ne le consomme pas. Le jeton disparaît de l’URL avant les requêtes applicatives et reste uniquement en mémoire pendant le formulaire.

La validation révoque les sessions du client ciblé et incrémente sa version d’identifiants, sans rétablir ni prolonger son accès. Les comptes administrateur et les autres clients sont préservés. La réponse ne renvoie plus d’effacement inconditionnel du cookie client : un autre client connecté dans ce navigateur conserve donc sa session. Le contrôle normal rejette et nettoie le cookie du compte révoqué lorsqu’il est présenté ensuite.

La confirmation du formulaire invite à se reconnecter sur ses appareils. Les anciennes inscriptions Push du client réinitialisé deviennent inéligibles ; après reconnexion, il faut les rattacher avec **Activer sur cet appareil**. L’administration n’est pas concernée par cette réinitialisation client.

Les messages de demande restent neutres quant à l’existence et à l’éligibilité du compte. Le formulaire reste français/anglais ; l’e-mail de récupération est encore français, désormais au tutoiement. Il ne contient jamais le mot de passe.

## Vérification et portes de livraison

- Vérifier les anciens formats et les nouveaux profils, les refus de déclassement et les charges altérées.
- Prouver sur les deux MariaDB de CI la capture et la vérification cryptographique d’un état contenant de vraies lignes de récupération, puis la restauration de sa copie SQL isolée. Cette preuve ne doit pas être présentée comme une nouvelle répétition de l’import natif hébergé.
- Exercer le formulaire réel dans Chrome : français/anglais, petits écrans, validation, succès, lien consommé/expiré, perte de réponse, nouvelle tentative explicite et absence de rejeu automatique.
- Vérifier le runtime réel avec les deux origines : récupération présente sur l’apex et absente sur recette, schéma physique et sessions existantes conservés.
- Attendre les cinq jobs CI de la révision exacte avant tout démarrage hébergé. Passer ensuite le préflight sans listener et les contrôles HTTPS de la révision épinglée.

La recette personnelle de bout en bout reste distincte : seul un client de test choisit lui-même son nouveau mot de passe, ouvre l’e-mail reçu depuis `contact@jessiemessage.com`, se reconnecte et rattache ses notifications. Aucun mot de passe n’est demandé dans la discussion et aucun compte administrateur n’est réinitialisé.

Les quotas réseau existants restent inchangés : aucune confiance supplémentaire n’est accordée aux en-têtes de proxy. La conservation des challenges de récupération reste à définir ; aucune purge ou durée nouvelle n’est introduite.

## Repli

Désactiver la récupération conserve le schéma et les nouvelles lignes. Ne pas restaurer les anciens mots de passe, ressusciter les sessions révoquées ou supprimer les demandes. Après création de données de récupération, conserver les outils de sauvegarde compatibles même si le runtime revient au profil sans récupération. Un redémarrage impose de recommencer les reprises d’appareil qui étaient en cours.

Référence de conception consultée le 17 octobre 2026 : [OWASP Forgot Password Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html), notamment réponse neutre, jeton à usage unique et limité dans le temps, absence de connexion automatique après modification et révocation des sessions concernées. Cette référence ne vaut pas certification complète du service.
