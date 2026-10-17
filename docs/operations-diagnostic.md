# Lot 0.42 — diagnostic privé de l’état du service

**État : implémenté sur une branche isolée, sans activation hébergée.** Base : préparation 0.41 `37e06678`, qui présente l’espace privé Jessie sans usage commercial ni source extérieure attribués aux invitations. Le runtime hébergé documenté reste celui de 0.40, `5ea9c40a`, profil recovery, schéma 30.

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
