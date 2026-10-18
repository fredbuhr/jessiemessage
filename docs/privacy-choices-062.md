# Choix confirmés et présentation simplifiée — 0.62

Le 18 octobre 2026, le propriétaire confirme : « aucune structure, uniquement Jessie en France », espace privé, et conservation de la conversation jusqu’à la fermeture définitive du compte. Ces réponses sont acquises ; elles ne doivent plus être demandées à chaque reprise. Elles ne constituent pas une conclusion sur une exemption juridique liée à l’usage privé.

## Comportement livré

L’administration affiche directement Jessie — France, le contact existant et le critère de conservation. Le dossier détaillé est facultatif et replié à l’ouverture. L’aide publique existante reprend ces faits en français et en anglais. Déconnexion, expiration ou suspension de l’accès ne signifient pas fermeture définitive ; les suppressions volontaires de messages et photos restent possibles.

Les choix confirmés sont définis dans `server/privacy/choices.mjs`, séparément des notes modifiables. Une préparation nouvelle préremplit D01 et D04. Une préparation déjà enregistrée conserve intégralement son texte et sa révision ; elle n’est ni migrée ni remplacée. Les réponses de l’API exposent les choix indépendamment du brouillon et n’autorisent pas leur modification par un POST de préparation. Le stockage chiffré, ses clés et son format sont inchangés.

Le brouillon complet reste privé et incomplet. Les indicateurs `publication: draft_only` et `retention: not_enabled` concernent cette préparation, et ne nient pas le critère de conversation désormais confirmé. L’aide indique que la suppression du compte n’est pas disponible directement dans l’application. L’administration indique explicitement que l’effacement complet reste à terminer ; `permanentClosure: not_implemented` est conservé dans la politique.

## Limites et suite

Ce lot complète les faits connus de l’itération 1 sur 6 ; il ne clôt pas les conditions et traitements encore à préciser pour une notice définitive. Aucune suppression réelle, migration SQL, expiration générale ou nouvelle durée de sauvegarde n’est déclenchée. Les fichiers téléchargés et sauvegardes restent des copies distinctes. Les autres décisions seront traitées avec les fonctions correspondantes, sans rouvrir Jessie/France ni la conservation des conversations.

La suite du plan reste : moteur d’effacement complet, interface simple et application des règles, preuve actuelle de déchiffrement/restauration, surveillance externe indépendante, puis recette/consolidation. Les mails de test reçus sont acquis et ne sont pas renvoyés. Les sessions longues, la copie automatique sur PC et les fonctions déjà acceptées restent des acquis de reprise.

## Vérifications prévues

Tests de conservation des brouillons existants, choix isolés et non mutables via l’API, informations publiques exactes, protections HTTP et traductions. Chrome exerce FR/EN à 320/375/1280 px, le dossier initialement replié, le clavier, l’enregistrement, les conflits et la purge du DOM privé. Le déploiement doit être rattaché à une source figée, à sa CI, aux tests natifs, au préflight, aux empreintes HTTPS et aux premières observations de supervision après redémarrage. La préparation locale ne constitue pas une activation.
