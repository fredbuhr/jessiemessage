# Réconciliation après les interruptions du 19 octobre 2026

Périmètre : retrouver l'état durable, corriger les consignes dangereuses et le suivi, puis préparer la suite. Les coupures de ChatGPT ne prouvent pas l'annulation des opérations distantes. Leur cause réseau/interne reste inconnue.

## État réellement retrouvé

- `main` au début : `a18d6afd32d6a9f138e78b60273eb1ee9ba5cf81`. La PR documentaire #89 était déjà fusionnée à 13:43:13 UTC ; elle ne devait pas être rejouée.
- Hébergement relu par le Manager et SSH : 0.70.0, source `61878b174b239c8d009fedd9714701214dadbfbe`, arbre `1efa835b44a6baeaa06b7e7e5ccf4351ece3e58c`, checkout propre et lanceur permanent inchangé.
- Genèse, origine d'inscription et état d'inscription ont les mêmes empreintes que lors de l'activation 0.70. Permission `ready`, aucune nouvelle initialisation, preuve externe personnelle absente et fermetures désactivées.
- Contrôle authentifié `check-witness-observer` réussi en lecture seule : `observe_only`, `started:false`, `externalWitnessConfirmed:false`, `closuresEnabled:false`.
- Quatre archives, horaire 05:15 UTC conservé, reçu PC de l'archive courante concordant et surveillance interne `OK`.
- Sonde HTTPS depuis l'hébergement saine à `1792420084903` : health et readiness réussis. La sonde de cet espace scratch a expiré ; cette différence de chemin n'a pas été interprétée comme une panne du service. Le moniteur GitHub indépendant avait également réussi.

[Relevé non sensible](activation-proofs/interruptions-20261019-baseline.json). Les contrôles effectués ne constituent pas un déchiffrement ou une restauration personnelle.

## Écarts trouvés et corrections

| Écart établi | Risque de reprise | Correction |
|---|---|---|
| 66 PR brouillon ouvertes dont toutes les têtes sont déjà ancêtres de main | Retraiter des fonctions livrées, relire des descriptions périmées ou refusionner une ancienne pile | 66 clôtures après relecture fraîche des têtes/bases et contrôle d'ascendance ; états fermés relus, aucune branche supprimée |
| Le fichier de reprise empilait plusieurs anciens états formulés au présent | Confondre le runtime actif avec 0.65 ou rejouer une préparation déjà réalisée | État courant unique et court ; ancien fichier conservé intégralement au même niveau dans [l'historique](REPRISE-HISTORIQUE-20261019.md) ; entrées documentaires orientées vers REPRISE |
| Le script Windows suggérait de raccorder de nouveau après toute erreur réseau | Remplacer la capacité du PC épinglée au contrat alors qu'un simple réessai suffisait | Consigne de réessai conservant le raccordement ; instructions du kit préservant configuration et marqueurs, y compris avant la fin d'activation du témoin |
| Les exemples CLI omettaient `JESSIEMESSAGE_PRIVATE_PATH_MODE=linux-dirfd` | Refus `RECURRING_SUPERVISOR_ENVIRONMENT` pouvant être pris pour un état perdu | Exemples corrigés ; refus reproduit sans mutation puis contrôle strict réussi |
| La réponse finale ChatGPT manquait malgré des opérations achevées | État « inconnu » interprété à tort comme un échec | [Consignes persistantes](../AGENTS.md), checkpoint après opération distante et [plan borné](PLAN-IMPLEMENTATION.md) |

[Preuves des 66 clôtures](verification-proofs/interruptions-20261019-pr-cleanup.json). Aucune preuve de corruption ou de double consommation provoquée par les coupures n'a été trouvée dans ce périmètre. Aucun réappariement, nouvelle clé, import SQL, message réel ou effacement de compte n'a été réalisé pour cet audit.

## Vérifications et limites

La suite ciblée inscription/HTTP/observateur/maintenance/superviseur a réussi : **103 tests, zéro échec**, avec deux contrôles natifs ignorés faute de procfs dans cet environnement. Les **deux tests de composition des kits** ont également réussi. Les scénarios existants couvrent réponse perdue, publication partielle, tentative répétée, état manquant et reprise interrompue ; ils n'ont pas été remplacés par des assertions de texte.

Le correctif porte la version **0.70.1**. Sa publication, sa CI et son activation doivent être suivies séparément dans [REPRISE](REPRISE.md). Ce relevé décrit la **base 0.70.0 avant correction**, pas une preuve de déploiement 0.70.1.

`main` n'impose pas actuellement de protection de branche. Ne pas en déduire que les contrôles sont facultatifs : avant fusion, vérifier les jobs applicables du SHA exact et refuser un résultat incomplet ou un SHA déplacé. Aucun droit administrateur ni nouveau mécanisme de publication n'a été ajouté.

La preuve Windows personnelle, l'aller-retour indépendant, le déchiffrement courant, la restauration isolée, la barrière de récupération et l'activation des fermetures restent des critères distincts du [plan](PLAN-IMPLEMENTATION.md).
