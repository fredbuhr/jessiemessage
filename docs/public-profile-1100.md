# Profil public de Jessie et retour au brouillon —1.10.0

Demande du23octobre2026. Production conservée1.9.0 jusqu’à activation qualifiée. Schéma38 et catalogue691/25/934 inchangés.

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

À ce jalon : code sur branche, tests locaux sousNode24.19.0 distincts de la qualification native24.22.1 ; Chrome local absent, couverture navigateur à exécuter en CI. Aucune publication ou activation1100 n’est encore acquise.
