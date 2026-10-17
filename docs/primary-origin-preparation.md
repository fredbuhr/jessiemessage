# Préparation de l’origine principale — étape 0.34

**Suite :** le [lot 0.35](device-origin-transition.md) ajoute la reprise des sessions et un lancement explicite des deux origines sur ce candidat, validé en CI et par son préflight hébergé sur `a0b17ce0` à 03:18:59 Europe/Paris. La préparation 0.34 ci-dessous reste inchangée ; le domaine et le runtime actif ne sont pas encore basculés.

**Préparation hébergée terminée le 17 octobre 2026 à 02:35:37 Europe/Paris.** Révision `4a3558518eeb12f3436e1a2339bc7a8d5a7d89bd`, arbre `21ef093f0c9fbc783f3ce14a401c625019b54aed`, [PR #45](https://github.com/fredbuhr/jessiemessage/pull/45). Les cinq jobs de la [CI exacte](https://github.com/fredbuhr/jessiemessage/actions/runs/38986917156) passent : 1 876 tests généraux réussis, 26 wrappers SQL explicitement ignorés dans ce job ; 362 tests sans saut sur chacune des MariaDB 10.11 et 11.4 ; dix tests Chrome applicatifs et un test Chrome/HTTPS/MariaDB. Les treize nouveaux cas du candidat, dont les parcours réels sur fichiers Linux, passent. Syntaxe et installation verrouillée passent aussi sur l’hébergement.

Le nouveau candidat est dans `/srv/customer/jessiemessage-private/primary-origin-candidate-4a355851`, préparé depuis le checkout distinct `/srv/customer/jessiemessage-operator/primary-origin-4a355851`. Le CLI renvoie `candidate_prepared`, cinq fichiers, clés conservées, aucun démarrage ni migration. À **02:36:32.752**, le préflight du runtime existant passe encore ; santé/disponibilité répondent 200 et l’entrée principale conserve son 302 vers la recette. Le runtime actif reste `f2677249`. Ce lot ne vaut pas bascule du domaine.


L’adresse finale reste `https://jessiemessage.com`. Ce lot prépare un candidat de configuration distinct, sans déplacer l’application actuelle. Le runtime 0.33 reste actif sur `recette.jessiemessage.com`, avec les sessions, installations et abonnements existants.

## Contrat du candidat

Le nouveau CLI `scripts/prepare-primary-origin.mjs` lit les cinq fichiers runtime existants au travers d’un répertoire privé ancré. Il vérifie leur cohérence, les six domaines de clés indépendants et leurs formats avant de créer la destination. Il copie la configuration de base inchangée et remplace uniquement `origin` dans les quatre fichiers d’authentification, messagerie, médias et notifications.

Les mots de passe, clés MFA/mail/messages/photos/notifications/VAPID, paramètres SQL/SMTP, chemin des photos et quotas sont conservés. Il n’y a ni génération de clé, connexion SQL/SMTP/Push, migration, écriture de données métier, démarrage d’application ou modification du routage. Cette copie de configuration n’est pas une sauvegarde SQL/photos.

Le profil `primary` doit être choisi explicitement. Il accepte seulement l’origine HTTPS exacte `https://jessiemessage.com`, sans port, barre finale, chemin, paramètres ou `www`. Tous les lecteurs, validateurs et lanceurs existants conservent leur profil de sous-domaine par défaut. Un candidat apex n’est donc pas encore démarrable par le lanceur actuel. Les contrôles TLS, privilèges, schéma et autorisation ne sont pas assouplis.

Le parent de destination doit déjà être un répertoire privé appartenant à l’opérateur, de mode 700 et hors checkout/racine publique. La destination doit être nouvelle : fichier, dossier ou lien existant sont refusés. Le nouveau dossier est de mode 700 et chaque fichier de mode 600, sans lien multiple. La source et sa relecture restent inchangées ; le candidat est relu avec le profil primaire et chaque valeur comparée avant tout succès. Les identités des répertoires sont contrôlées pendant les opérations. Un échec laisse éventuellement une copie partielle privée à examiner ; il ne supprime ni ne remplace de dossier pour tenter de récupérer automatiquement.

## Commande opérateur

Depuis un checkout de la révision vérifiée, avec Node.js 24 et ses dépendances verrouillées :

```sh
JESSIEMESSAGE_PRIVATE_PATH_MODE=linux-dirfd node scripts/prepare-primary-origin.mjs prepare \
  --source-private-directory /srv/customer/jessiemessage-private \
  --destination-private-directory /srv/customer/jessiemessage-private/primary-origin-candidate-REVISION \
  --private-path-mode linux-dirfd \
  --origin-profile primary
```

Remplacer `REVISION` par la révision courte vérifiée et conserver une nouvelle destination à chaque tentative. Aucun secret ne figure dans la commande ou la sortie. Ne pas exécuter avec des variables applicatives héritées, options Node ou contournements de confiance TLS : le même garde de processus privé les refuse.

Succès fermé attendu :

```json
{"status":"candidate_prepared","originProfile":"primary","filesSaved":5,"keysPreserved":true,"started":false,"migrationPerformed":false,"launchApproved":false}
```

Ne pas afficher, télécharger ou commettre les fichiers de ce candidat. Ils contiennent les mêmes secrets que le runtime source. Le coffre chiffré existant et sa copie indépendante restent à conserver. Une commande échouée ne vaut jamais validation ; ne pas réutiliser ou vider automatiquement sa destination.

## Diagnostic et recette mobile

`isPreproductionOrigin` devient la règle commune aux fichiers privés, au diagnostic et à son CLI. Il ferme l’écart qui permettait au seul diagnostic de considérer un port personnalisé ou un nom DNS non valide comme acceptable. L’apex demeure refusé par ces parcours de recette.

La recette Chrome du chat ajoute les largeurs 320, 360 et 390 px, les deux rôles et FR/EN avec le bouton Notifications réellement visible. Elle vérifie présence, visibilité, absence de recouvrement et cibles de 44 px. Aucun changement de CSS n’est justifié par le seul soupçon d’absence de retour à la ligne : `i18n.css` l’applique déjà.

## Conditions avant bascule

1. Éprouver la transition des sessions sans effacement des sessions source : pont à ticket ponctuel lié au navigateur et à la session, ou coexistence explicitement contrôlée. Une simple redirection ne transporte pas les cookies `__Host-`.
2. Préparer l’inscription des notifications sur l’origine finale. La permission du navigateur et l’installation PWA ne peuvent pas être déplacées silencieusement par une modification DNS.
3. Produire un checkpoint cohérent SQL/photos/secrets au schéma 30, sa copie indépendante et une restauration isolée vérifiée. Conserver un repli de code compatible avec ce schéma.
4. Ajouter un lanceur et un préflight explicites pour l’origine principale, tout en vérifiant les mêmes contraintes de configuration, stockage et SQL. Tester le rejet des mauvais Host/Origin et les anciens liens.
5. Vérifier les domaines/certificats/quota Node et le plan Web, puis affecter le domaine avec repli documenté. Préserver MX, SPF, DKIM et DMARC ; l’adresse `contact@jessiemessage.com` reste identique.
6. Accepter sur appareils : accès simultanés, invitation/e-mail, textes/photos, retour réseau, nouvelle notification vers le bon message et relance depuis l’icône.

Le [bilan d’audit](AUDIT-2026-10-17.md) et le [plan d’adresse](public-entry-transition.md) donnent les autres éléments restant à livrer. Un résultat `candidate_prepared` ne certifie ni le déploiement, ni la transition des appareils, ni l’ouverture publique.
