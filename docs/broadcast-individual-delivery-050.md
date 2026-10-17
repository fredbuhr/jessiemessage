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

La publication de cette correction et sa CI sont en cours. Au début du lot, la version active demeure `d77f16fbddbee4bad90f0230ad344d148823aac5`, arbre `5897917c0e7810e16ab51e600e2cf1c6eff02f47`, décrite dans [l’activation 0.49](broadcast-activation-049.md). Cette note ne constitue pas une preuve de déploiement de la correction. Aucun message réel de test n’est envoyé par l’agent.
