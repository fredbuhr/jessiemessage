# Capacité et dernière activité — correctif 1.8.2

**État : diagnostic natif ajouté, résultats MariaDB en attente de CI.** Cette fiche décrit A12 et ses limites ; elle ne certifie ni une vitesse du mutualisé, ni un nombre de clients simultanés. [REPRISE](REPRISE.md) reste la référence de production et le [plan](PLAN-IMPLEMENTATION.md) conserve les lots en cours. Aucun index, migration, plafond ou mécanisme de purge n’est modifié par cette mesure.

## Mesure bornée et résultat attendu

Le sous-test de [persistance CRM](../tests/crm-store.integration.test.mjs) réutilise son schéma jetable explicitement confirmé sur loopback, le compte runtime DML distinct et le nettoyage gardé. Il prépare **51 conversations d’un administrateur**, dont deux historiques de **1 000 et 10 000 messages/événements**, plus une conversation d’un autre administrateur. Ces contenus sont synthétiques ; aucun média physique n’est créé.

Il exerce les lectures réelles des stores chat/CRM et vérifie :

- dernière activité, séquences et compte des messages non lus exacts dans les deux historiques ; lecture limitée à un message ;
- page CRM de 50 contacts, puis dernière page d’un contact, sans doublon ni déplacement hors du propriétaire ;
- refus d’une fiche étrangère dans les deux sens et liste distincte de l’autre administrateur.

Le diagnostic structuré porte le type **`latest-activity-capacity-synthetic-metrics`**. Il enregistre la version MariaDB, quatre mesures de lecture, leur durée indicative et le nombre d’appels `query` observés. Ce compte comprend les requêtes d’autorisation du store, mais exclut la préparation de la fixture, la configuration interne du pool, les méthodes de transaction du pilote et les contrôles HTTP supplémentaires. Il ne représente donc pas le coût complet d’une navigation sur l’hébergement.

Les plans **`EXPLAIN` natifs** concernent les requêtes de résumé et de page CRM effectivement capturées pendant ces lectures, ainsi que le maximum de date isolé par conversation. Le diagnostic conserve `table`, `type`, `key`, `rows`, `Extra` et le type de sélection ; aucun paramètre, identifiant de session ou contenu n’est journalisé. `rows` est une estimation de l’optimiseur. Aucun plan précis ni seuil de millisecondes n’est imposé aux runners.

| Contrôle | État avant qualification native |
| --- | --- |
| Syntaxe sous Node 24.22.1 | Vérifiée localement ; ne qualifie pas l’exécution SQL. |
| MariaDB 10.11 | **En attente** ; aucun résultat natif local revendiqué. |
| MariaDB 11.4 | **En attente** ; aucun résultat natif local revendiqué. |
| Charge et concurrence du mutualisé | **Non mesurées** par ce diagnostic local synthétique. |

La suite est déjà incluse dans `npm run test:db`, exécuté séquentiellement dans la matrice MariaDB 10.11/11.4 existante. Sa fixture CRM utilise le plan normal SQL33 ; les tables et requêtes examinées sont aussi présentes dans le profil vidéo SQL36. Ce sous-test ne remplace pas les autres qualifications du runtime vidéo. Un test ignoré faute de base reste une omission, jamais un succès natif.

## Pourquoi mesurer le maximum de date

Les résumés chat et les pages CRM calculent `MAX(occurred_at)` dans `chat_events`. La migration immuable `0015_chat_events.sql` possède les index `(conversation_id, event_sequence)` et `(conversation_id, message_id)`, sans index `(conversation_id, occurred_at)`. Les maxima de séquence disposent de leur préfixe utile ; le maximum de date ne bénéficie pas de cet index adapté. **Aucune lenteur réelle n’est établie avant les mesures.** Les résultats serviront à décider si un correctif est utile ; ils ne déclenchent pas automatiquement un nouvel index ou une migration. Les autorisations et verrous ne doivent pas être affaiblis pour améliorer une durée.

## Polling et budgets actuels

Dans une conversation visible, le cycle attend trois secondes **après** la fin du travail : environ 20 lectures chat par minute au repos. Le rattrapage peut parcourir trois pages de 100 événements par cycle, puis reprendre après 300 ms ; les erreurs augmentent le délai jusqu’à 30 secondes. Le polling s’arrête lorsque l’onglet est masqué.

La liste de l’administrateur se rafraîchit toutes les 30 secondes. Avec CRM actif, ces lectures utilisent son namespace ; sans CRM, elles empruntent l’API chat, avec une page et éventuellement une sonde de fin. Les confirmations de session ajoutent des requêtes HTTP/SQL hors du compteur de lectures chat.

| Namespace de lecture | Budget par compte et par minute | Budget global par minute |
| --- | --- | --- |
| Chat client | 120, tous appareils confondus | 2 400, partagé avec les lectures chat admin |
| Chat admin | 480, tous appareils confondus | Même budget chat de 2 400 |
| CRM admin | 180 | 300, distinct du chat |
| Annonces | 120 | 300, distinct du chat |
| Tâches privées | 180 | 300, distinct du chat |

À 20 lectures chat/minute, le plafond global donne **120 clients visibles au maximum arithmétique avant toute autre lecture**. Les appareils admin, historiques, rattrapages et autres coûts réduisent cette marge ; ce nombre n’est pas une capacité garantie. Une audience de diffusion de 2 500 destinataires qualifiée ne prouve pas 2 500 conversations simultanément actives. Les tests de service vérifient déjà l’isolation des comptes/appareils et les budgets persistés ; ce diagnostic ne les duplique pas et ne relève aucun quota.

## Limites de fermeture conservées

L’effacement examine globalement jusqu’à **10 001 campagnes** et refuse `ERASURE_LIMIT` au-delà de **10 000**, même si certaines concernent d’autres clients. Des comptes de références sont également bornés à 10 000 ; leur troncature bloque l’effacement. Ce n’est pas un plafond de 10 000 messages par conversation. Les volumes hébergés n’ont pas été lus, et aucun seuil proche n’est affirmé.

Ces gardes restent intacts. Si l’usage retenu rend un seuil bloquant, une pagination préservant vérification d’intégrité et reprise devra être qualifiée séparément. Aucun historique, reçu ou campagne n’est supprimé pour contourner une limite. La sauvegarde hébergée reste reportée à la demande de l’utilisateur.
