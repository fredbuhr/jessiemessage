# Lot 0.42 — diagnostic privé de l’état du service

**État : source `ed78b55e` validée en CI et préflight hébergé, activation bloquée avant enregistrement.** Base : préparation 0.41 `37e06678`, qui présente l’espace privé Jessie sans usage commercial ni source extérieure attribués aux invitations. Le runtime hébergé reste celui de 0.40, `5ea9c40a`, profil recovery, schéma 30. La revue automatique refuse l’activation faute d’autorisation explicite de modifier le site dans la passation ; aucune autre voie n’est utilisée pour la contourner.

## Résultat

Sur la page existante **État du service** (`/admin/readiness`), le bouton **Télécharger le diagnostic** prépare `JessieMessage-diagnostic.txt`, dans la langue FR/EN choisie. Le fichier permet de transmettre un état précis sans devoir photographier tout l’écran.

Le clic vérifie la session, récupère le dernier résumé disponible puis vérifie à nouveau la même connexion avant de préparer le fichier. Masquage, déconnexion, changement de compte/CSRF, erreur réseau ou réponse tardive empêchent le téléchargement de l’ancien état. Aucune vérification SMTP ou livraison n’est rejouée.

Le contenu passe par `parseOperations()` : états de la base et des traitements, dates UTC, compteurs bornés et mention « au moins » pour les mesures plafonnées. Le titre, les libellés et les limites sont traduits ; les identifiants, coordonnées, messages, photos, abonnements, secrets et erreurs brutes ne sont pas exportés. Un champ supplémentaire du fournisseur n’est pas copié. Le lien temporaire contient uniquement le texte projeté, puis est retiré ; aucun contenu n’est ajouté à `localStorage` ou `sessionStorage`.

Le rapport est un instantané, avec ses dates de mesure et de génération. Il ne certifie pas la réception des messages, le stockage ou une sauvegarde. Le bouton lit le résumé existant : aucune nouvelle route, permission, sonde externe, migration ou dépendance. Le signal SQL reste échantillonné en arrière-plan ; le clic ne force pas un nouvel échantillon SQL.

## Défaut corrigé : quatre traitements

Le serveur et les libellés acceptaient déjà `verification`, `recovery`, `broadcasts` et `notifications`, mais `parseOperations()` refusait toute liste dépassant trois entrées. Une configuration avec les quatre traitements rendait donc le résumé inutilisable dans l’interface. La limite suit désormais les quatre noms autorisés ; les doublons, noms arbitraires et cinquième entrée restent refusés. La correction n’active aucun module.

## Validation

Les régressions couvrent les quatre traitements, l’exclusion des champs bruts, les dates et bornes, les textes FR/EN, une lecture fraîche avant export, la session remplacée, la page masquée, les clics simultanés et le refus d’utiliser un ancien instantané après une erreur. Le scénario Chrome utilise les vrais HTML/styles/scripts sur une boucle locale et des métadonnées fictives aux largeurs 320, 375 et 1 280 px, avec activation clavier. Le navigateur intercepte le lien préparé pour examiner le fichier ; ce scénario ne certifie pas son enregistrement sur tous les systèmes réels.

Localement sous Node.js 24.19.0, les 44 tests ciblés de modèle et de contrôleur passent, puis la suite générale compte 2 063 réussites et 143 intégrations ignorées sur 2 206 cas, sans échec. Syntaxe, construction et vérification du diff passent. Chrome n’est pas installé localement ; le nouveau scénario est destiné au job Chrome de CI, sans succès local prétendu. Les résultats exacts de publication sont consignés dans la PR du lot.

La [supervision existante](operations-readiness.md) reste la source des mesures. Le suivi externe, la conservation et l’effacement restent des travaux séparés ; CRM et diffusions restent désactivés. Aucun compte réel, e-mail, Push, configuration ou serveur hébergé n’est utilisé par les tests.

## Candidat hébergé et repli

Le 17 octobre 2026, le checkout neuf `/srv/customer/jessiemessage-operator/operations-report-ed78b55e` est cloné et vérifié : source exacte `ed78b55e99480ce07967b4c54c7e2de13e46951e`, arbre `5bdb9e75989ca30ad800053ed783dd6ed3edfd70`, suivi propre, dépendances verrouillées et syntaxe conformes sous Node.js 24.15.0. Le préflight réel renvoie `checks_passed`, profil `messaging-photos-notify-recovery`, déploiement `primary-transition`, `started: false`, `smtpDeliveryTested: false`, `launchApproved: false`. Il ne démarre ni listener ni worker.

Le lanceur préparé `/srv/customer/jessiemessage-private/start-primary-operations-checked-ed78b55e.sh` est créé exclusivement en `0700`, relu octet pour octet et vérifié avec `bash -n`. Son SHA-256 est `343a71c5976c2a27f0061bb6419115a3e2d5ac8c8ed6b8f924add3a765a9cc86`. Ses sept lignes épinglent source, arbre et propreté, nettoient les options Node héritées et reprennent la configuration recovery existante. Aucun secret n’est écrit dans le lanceur ni publié. Une copie préparatoire de même contenu reste inutilisée ; le chemin `-checked-` est celui retenu pour la future activation.

L’enregistrement Run/Build est refusé par la revue automatique avant soumission. Le formulaire est quitté avec **Annuler**. Le Manager affiche ensuite le build courant 0.40, dernier changement à **19:16 Europe/Paris**, Node actif et les trois domaines conservés. Aucun redémarrage n’est exécuté.

À **20:52:32.110794 Europe/Paris** (`18:52:32.110794+00:00`), dix-huit contrôles HTTPS anonymes sur apex/recette passent, dont huit comparaisons d’empreintes exactes de l’aide avec le checkout **0.40**. Santé/disponibilité, refus du résumé administrateur anonyme, absence d’accès au brouillon documentaire et récupération primaire seulement sont conformes. Ces sondes ne prouvent pas une session authentifiée et n’émettent ni e-mail ni Push.

Après une autorisation d’activation, les commandes préparées sont :

```sh
bash /srv/customer/jessiemessage-private/start-primary-operations-checked-ed78b55e.sh
```

```sh
cd /srv/customer/jessiemessage-operator/operations-report-ed78b55e && test "$(git rev-parse HEAD)" = ed78b55e99480ce07967b4c54c7e2de13e46951e && test "$(git rev-parse HEAD^{tree})" = 5bdb9e75989ca30ad800053ed783dd6ed3edfd70 && test -z "$(git status --porcelain)" && npm run check
```

Ne pas lancer `start` dans le terminal en parallèle du service actif. La future opération doit utiliser le Manager, puis vérifier les fichiers servis et le parcours privé du diagnostic. Le repli immédiat est le runtime **0.40 `5ea9c40a`**, avec ses commandes conservées dans [le lot aide/contact](help-contact.md), sans repli SQL, changement de clé, DNS ou règle de session. Les outils de sauvegarde recovery restent nécessaires.

Les cinq jobs du [run push exact 39059447030](https://github.com/fredbuhr/jessiemessage/actions/runs/39059447030) et le [run PR 39059449149](https://github.com/fredbuhr/jessiemessage/actions/runs/39059449149) réussissent. Les 94 tests Chrome comprennent les six cas FR/EN × trois largeurs et leur groupe parent supplémentaires. [PR brouillon #57](https://github.com/fredbuhr/jessiemessage/pull/57). Tout commit documentaire ultérieur demeure distinct de la source applicative épinglée ; il ne doit pas remplacer implicitement le candidat préparé.

Les journaux du run push exact comptent 2 179 réussites et 27 wrappers SQL ignorés sur 2 206 cas généraux, 376/376 sur chacune des MariaDB 10.11 et 11.4, 94/94 Chrome applicatifs et 1/1 authentification Chrome/HTTPS/MariaDB ; aucun échec.
