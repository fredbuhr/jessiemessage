# Profil public de Jessie et retour au brouillon — 1.10.0

Demande du 23 octobre 2026. Production conservée 1.9.0 jusqu’à activation qualifiée. Schéma 38 et catalogue 691/25/934 inchangés.

## Comportement

- `/jessie` présente le nom, une courte présentation et les préférences explicitement publiées, en français/anglais et sans connexion. Un lien est accessible dans Options de la messagerie. La page non publiée présente un état indisponible.
- Dans Mon profil admin, « Mon profil public » permet de publier la sélection affichée, mettre à jour cette copie, voir la page ou la retirer. Un clic explicite est nécessaire. Modifier les préférences privées ultérieurement ne change pas la page publiée. Aucune préférence de client ni avatar privé n’est exposé.
- Les goûts/fantasmes et le profil sont suspendus lors du passage dans une autre fenêtre/application, puis restaurés après revalidation du même compte. Recherche, catégories ouvertes et choix en cours sont conservés dans la mémoire de l’onglet. Un enregistrement interrompu reste incertain et n’est jamais répété automatiquement.
- Fermer explicitement le profil, quitter/recharger la page, se déconnecter ou changer de propriétaire efface ce brouillon en mémoire. La fermeture définitive d’un onglet n’offre pas de récupération.

## Données et compatibilité

Le fichier privé borné `jessie-public-profile.json` contient uniquement la copie destinée à publication. Permissions0600, écriture atomique, verrou court, version optimiste et réautorisation admin avant commit réutilisent le stockage JSON existant. Le fichier absent signifie masqué ; aucune écriture n’a lieu au démarrage. Aucun schéma SQL, enveloppe privée, format de sauvegarde ou clé n’est modifié.

Cette copie publique reste hors du manifeste des sauvegardes historiques ; elle peut être republiée depuis le profil. Le repli190 préserve ce fichier sans le servir. Les migrations et données privées restent inchangées. Aucun envoi ni essai destructif sur compte réel.

## Qualification

Tests ciblés et tests navigateur synthétiques prévus : publication/retrait, CAS entre appareils, CSRF/client refusé, DTO public borné, révocation avant écriture, échappement du texte, FR/EN, petits/grands écrans, masquage/reprise du même compte, changement de session, chargement et enregistrement interrompus sans répétition automatique.

PR135 fusionnée sur `51b0cf22e3adbad7ed26653e96706ba707aaf839`, arbre `190024a2f30258554e4a18ff6ae18e2be08c8d7b`. CI PR39990302080 et main39991790308 chacune 5/5 sousNode 24.22.1 : Chrome 256/256, HTTPS 12/12, MariaDB 598/598 chacune, général 4 026 réussis et52 omissions sur 4 078. Les 12 rendus synthétiques main sont relus ; les écarts avec PR concernent des barres natives ou arrière-plans floutés. Les premières erreurs de fixtures sont conservées. La [publication39993020232](https://github.com/fredbuhr/jessiemessage/actions/runs/39993020232) est réussie 2/2, opérateurs 42/42, release/latest 422111737 sur la source exacte. Aucune préparation, CHECK ou activation hébergée 1100 acquise ; [prochaine action](operations-release1100.md).
