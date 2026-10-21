# Tâches et rappels privés — Évolution 5

**Développement en cours, non qualifié et non déployé.** La production reste la 1.5.0 close ; [REPRISE](REPRISE.md) conserve son identité et ses preuves.

## Résultat attendu

Jessie peut garder plusieurs tâches privées pour un même client : photo ou vidéo à préparer, demande particulière, show privé ou autre chose à ne pas oublier. Une tâche contient un texte libre et une échéance facultative, affichée dans l’heure locale de l’appareil. Elle peut être modifiée, reportée, terminée puis rouverte.

Une page **Mes tâches** rassemble les tâches à faire, celles arrivées à échéance et celles terminées. La fiche client ouvre cette même vue filtrée sur le client. Le menu de la messagerie donne accès aux tâches avec un compteur discret des échéances à traiter, sans ajouter de barre à la discussion.

Les rappels de ce lot sont visibles dans l’application et sont actualisés à son retour au premier plan. Ils n’émettent pas de notification push lorsque l’application est fermée. Aucun message ni rappel n’est envoyé au client. L’ancienne date de suivi des fiches CRM reste conservée séparément.

## Intégration et critères de fin

Une table additive `crm_tasks`, migration 0033, conserve les tâches liées à l’administrateur et à la conversation. Leur texte est chiffré avec un domaine propre à partir de la clé CRM existante. Aucun nouveau fournisseur, worker, secret ou paquet n’est ajouté. Les versions, l’identité stable de création et l’empreinte de demande évitent les doublons après une réponse perdue et les écrasements entre deux appareils.

La qualification couvre l’isolation des comptes, la conservation du brouillon lors d’un conflit, le report et la réouverture, les échéances, la navigation mobile et clavier, FR/EN, le chiffrement, la sauvegarde et la fermeture définitive des comptes. Les essais utilisent des données synthétiques et des cibles isolées.

La livraison prévoit une référence **1.5.1 compatible avec le schéma 33**, création de tâches désactivée, puis la **1.6.0** qui l’active. Les publications et leurs CI propres doivent être vérifiées avant toute consigne d’activation. Les références 1.5.0/1.4.1 sont préservées historiquement ; leur usage après migration ne doit pas être présumé compatible.
