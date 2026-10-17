# Étape 0.50 — messages individuels sans accord de diffusion

La demande du propriétaire du 18 octobre 2026 à 00:57:59 Europe/Paris remplace la règle d’accord séparé décrite dans les lots historiques. L’application reste privée autour de Jessie.

## Comportement livré par cette correction

- Le destinataire n’a aucun accord de diffusion à donner. Le bloc, la case, le module client et les routes de préférence/session de diffusion sont retirés de son parcours.
- Un accès actif et une conversation disponible suffisent. L’aperçu, la confirmation, la prise du travail en file et l’insertion finale ne consultent plus `broadcast_preferences`.
- Chaque destinataire reçoit un message ordinaire dans sa conversation privée avec Jessie. Le titre de campagne, son identifiant, le nombre et l’identité des autres destinataires ne sont jamais ajoutés au message reçu. Aucune affirmation selon laquelle il serait le seul destinataire n’est générée.
- Jessie conserve l’outil de sélection CRM, l’aperçu, la confirmation explicite et le suivi privés. Annulation, déduplication, droits d’accès, propriété des photos et avertissement de renvoi d’une photo restent actifs.

Les anciennes valeurs de `broadcast_preferences`, y compris les valeurs désactivées, deviennent historiques et ne bloquent plus les nouveaux envois ou les destinataires encore en attente. Les destinataires déjà terminés avec l’ancien motif `opted_out` ne sont pas remis en file automatiquement. L’historique peut encore afficher ce motif pour lire les campagnes antérieures.

## Compatibilité et limites

Aucune migration : schéma 30, six fichiers de configuration, clés, comptes, MFA et sessions conservés. La table historique reste incluse dans les sauvegardes et les procédures de suppression/export existantes. Les formats de sauvegarde de campagnes 9/10 et reçus 7/8 restent nécessaires après toute donnée de diffusion.

La limite actuelle reste **100 destinataires par campagne**, dix campagnes actives par administrateur et 30 messages par minute par administrateur (300 globalement). Une audience de 1 000 destinataires dans une seule campagne n’est pas annoncée comme prise en charge : le format chiffré actuel est borné à 32 000 caractères. Son extension demande un lot distinct cohérent avec le stockage et la restauration.

## Validation et activation

Les tests SQL couvrent l’absence de préférence, une ancienne préférence désactivée avant l’aperçu et avant la prise en file, puis une préférence modifiée après la prise en file. Les tests HTTP couvrent le retrait des routes et la réception de messages individuels sans métadonnées de campagne. Révocation, expiration, annulation, reprise sans doublons et isolation des conversations restent vérifiées.

La correction est publiée dans la [PR #62](https://github.com/fredbuhr/jessiemessage/pull/62), source `0a1cafd85c3d8699be1961075b18e80e36bcd041`, arbre `17db89aa165e23ca427d073f5a3fcc28387f5168`. Les [cinq jobs de CI de cette source exacte](https://github.com/fredbuhr/jessiemessage/actions/runs/39078063012) passent :

| Vérification | Résultat |
| --- | --- |
| Général, vérifications de syntaxe et build | 2 295 tests, 2 268 réussis, 27 wrappers SQL ignorés, aucun échec ; build réussi |
| MariaDB 11.4 | 383/383 réussis, aucun ignoré |
| MariaDB 10.11 | 383/383 réussis, aucun ignoré |
| Chrome, clavier et cycle de vie | 101/101 réussis |
| Authentification Chrome HTTPS avec MariaDB | 1/1 réussi |

Le préflight hébergé réussit le **18 octobre à 01:19:57.163475 Europe/Paris**, sans démarrage d’un second serveur. Le Manager enregistre les commandes figées, effectue le Build et redémarre la version corrigée à **01:21**. L’état final est **Node.js Actif**, le Build est réussi et le reçu de démarrage conserve le profil complet.

À **01:22:38.231618**, **69/69 contrôles HTTPS** et **seize empreintes exactes de ressources** passent sur l’origine principale et la recette conservée. Les anciennes routes/module client ne sont plus servis en lecture ; les pages/modules/API d’administration restent protégés. Le [relevé d’activation](broadcast-activation-050.md) conserve les commandes, les catégories de contrôles et la preuve visuelle. La [procédure précise](deploy-broadcast-individual-050.md) décrit la préparation exécutée et le repli.

La coupure initiale `environment_offline` est résolue. La version 0.49 `d77f16fb` devient le repli logiciel, avec son ancien accord invité. Aucun essai réel de campagne n’est créé par l’agent ; aucune acceptation personnelle de réception n’est déduite des tests synthétiques ou des GET sans session.
