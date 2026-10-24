# Invitations par code — 1.11.0

Le client rejoint l’adresse commune `https://jessiemessage.com` depuis un emplacement autorisé, choisit **J’ai un code d’invitation**, puis saisit le code personnel reçu en message privé. Après validation du code, il retrouve l’inscription habituelle : pseudonyme, e-mail, mot de passe, déclaration de majorité, confirmation de l’e-mail puis approbation manuelle de Jessie.

## Utilisation par Jessie

1. Vérifier manuellement le paiement dans Stripchat.
2. Dans **Invitations et clients**, choisir le format **Code**, la validité de l’invitation et la durée d’accès.
3. Créer l’invitation puis copier le code affiché. Le transmettre uniquement au client concerné en message privé.
4. Après son inscription et sa confirmation d’e-mail, approuver son compte selon le parcours existant.

Le code n’est révélé qu’à sa création. La liste des invitations permet de suivre son état et de le révoquer avant utilisation ; elle ne permet pas de relire le code. La validité de l’invitation et la durée d’accès sont distinctes : la seconde commence à l’approbation du compte. L’application ne vérifie pas les paiements et ne communique pas avec Stripchat.

## Contrat et protections

- Code aléatoire de 20 caractères Crockford, soit 100 bits, affiché en cinq groupes de quatre. La casse, les espaces et les tirets de séparation sont normalisés ; les caractères étrangers au format sont refusés.
- Même invitation en base, même consommation atomique à l’inscription, mêmes bornes d’expiration, révocation et vérification de l’administrateur émetteur. L’inspection du code ne le consomme pas.
- Empreinte de recherche séparée de celle des anciens jetons. Aucun code brut en base, dans les listes, les URL, les journaux applicatifs ou le stockage navigateur. Le code nécessaire à l’inscription reste uniquement dans la mémoire de la page.
- Les limites de tentatives existantes s’appliquent aussi au nouveau format. Un code inconnu, expiré, révoqué ou utilisé reçoit le même refus public.
- `POST /api/admin/invitations` accepte `format: "code"` ou `"link"`. Sans ce champ, le comportement historique par lien reste inchangé. Une création par code renvoie `code` à la place de `url`.
- L’inspection et l’inscription conservent les champs `token` et `invitationToken`. Seules ces entrées acceptent les codes ; les sessions, cookies, jetons d’e-mail et de récupération gardent leurs formats existants.
- Les liens déjà émis restent utilisables. Aucune migration, nouvelle dépendance, configuration de paiement ou nouveau service.

## État de livraison

Développement en cours. La production reste **1.10.1** selon [REPRISE](REPRISE.md). Les vérifications et les références exactes de qualification seront consignées avant publication ; les tests synthétiques ne constituent pas une recette sur compte ou appareil réel.
