# JessieMessage — principes KISS

L’interface sert une conversation privée et les tâches de Jessie. La lisibilité, les actions compréhensibles et la conservation du travail en cours passent avant les effets visuels. L’[identité approuvée](IDENTITE-VALIDEE.md) et [Nuit V2](NUIT-V2.md) fixent la direction visuelle.

Le [périmètre produit](PRODUCT.md) décrit les fonctions. **[REPRISE](REPRISE.md)** est l’unique entrée pour l’état livré, les preuves et la prochaine action ; les anciens bilans ne sont pas une feuille de route courante.

## Interface

- Une conversation claire côté client ; les outils administrateur restent dans leur espace.
- Texte, photos, vidéos et états d’envoi lisibles sur mobile et ordinateur. Le nom du destinataire reste visible avant l’envoi.
- Fiches, notes, tags et rappels dans une vue secondaire. Les groupes internes ne deviennent pas des salons clients.
- Confirmation explicite des destinataires pour une diffusion et de la portée d’une fermeture définitive.
- Brouillons conservés dans la page et conflits signalés. Ne pas promettre leur synchronisation entre appareils ou leur survie à une fermeture d’onglet.
- Notifications facultatives par appareil, sans aperçu intime. Expliquer la prochaine action utile sans accumuler installation, autorisations et consentements.
- Sauvegardes : création à la demande, état, date, taille et téléchargement chiffré depuis l’administration, sans PC requis ; vocabulaire adapté à l’action. Un fichier téléchargé ne devient pas une promesse de restauration.
- Aucun compteur de fans, fausse présence en ligne ou mécanisme public de découverte.

## Développement et exploitation

Réutiliser le parcours existant le plus simple qui atteint le résultat demandé. Choisir un objectif borné, corriger le défaut avec une régression utile, puis livrer son état exact. Une petite duplication ne justifie pas à elle seule une nouvelle abstraction.

Le mutualisé, la sauvegarde manuelle admin et la restauration manuelle en maintenance forment le périmètre choisi, sans infrastructure ni budget ajoutés. Les anciennes copies PC restent préservées ; le parcours courant ne dépend pas du PC. Les limites de récupération du [produit](PRODUCT.md) restent explicites. Ne pas simplifier un refus en retirant un garde, un journal, un ancrage de dossier, une quarantaine ou un état PC. Les preuves historiques restent conservées.

Les tests utilisent des comptes, médias et cibles isolés synthétiques. Distinguer code, CI, déploiement, observation réelle et omission ; un aperçu ou une réponse perdue ne prouve pas une activation.

## Atelier d’interface

[design/preview.html](../design/preview.html) est un aperçu autonome à ouvrir localement ; le build fournit aussi un fichier téléchargeable. Il utilise des comptes fictifs, une bascule client/admin de démonstration et un état en mémoire, perdu au rechargement. Il n’authentifie personne et n’active ni MariaDB, ni Web Push, ni SMTP. Le serveur ne dessert pas ce dossier : ne pas déployer l’atelier comme application.

Le bouton Photo lit une image locale pour l’aperçu. Les portraits personnels ne doivent pas entrer dans le dépôt ni ses artefacts publics. L’atelier ne remplace pas les essais du vrai serveur, des autorisations et des appareils.

## Historique

La [première direction du 14 octobre 2026, conservée avant cet entretien](https://github.com/fredbuhr/jessiemessage/blob/bbd733d85b49b892d78c7cd90509ced04a990939/docs/DESIGN-KISS.md) contient les choix visuels initiaux et les observations de cette maquette. L’[ancien journal d’implémentation](NEXT-STEPS.md) est historique ; ses prochaines étapes ne remplacent pas REPRISE.
