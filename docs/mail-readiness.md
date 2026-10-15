# Adresse du site et préparation des e-mails

**Lot de développement 0.10 — CI vérifiée.** L'adresse retenue pour tous les e-mails du site est **contact@jessiemessage.com** : contact/aide, expéditeur des messages de service, adresse de réponse et expéditeur d'enveloppe SMTP. La préparation du compte administrateur initial retient également cette adresse. Ce lot prépare les réglages et leur contrôle privé. Il ne crée aucune boîte, ne modifie aucun DNS, n'envoie aucun e-mail et ne déploie pas l'application.

## Une identité cohérente

`server/site.mjs` centralise l'adresse publique et le domaine `jessiemessage.com`. Sur une origine HTTPS canonique de ce domaine ou de ses sous-domaines, la configuration refuse tout autre expéditeur. Une valeur `JESSIEMESSAGE_SMTP_FROM` absente prend l'adresse officielle ; une valeur explicitement vide ou invalide est refusée. Le transport revérifie la règle, même si sa configuration a été construite directement. `Reply-To` et l'expéditeur d'enveloppe suivent toujours l'expéditeur validé. Les origines de test extérieures au domaine officiel peuvent utiliser un expéditeur fictif explicite.

L'adresse par défaut ne fournit aucun identifiant ni mot de passe et n'active pas la livraison. Le serveur SMTP, le port, l'utilisateur, le mot de passe et la clé privée de mail restent à configurer explicitement. Aucun formulaire public ou administrateur ne collecte ces secrets. Les liens Contact/Aide du site ouvrent l'adresse officielle dans le logiciel de messagerie de l'utilisateur ; ils ne déclenchent pas d'envoi automatique.

## Outil privé « Préparer le site »

Une fois l'authentification administrateur activée, `/admin/readiness` affiche l'adresse du site, l'état de configuration des fonctionnalités et les essais encore nécessaires. La page reste disponible avant l'activation des inscriptions. Sa page, ses modules et ses API sont protégés par la session administrateur et des réponses sans mise en cache. Un client ne peut pas les consulter avec son cookie client.

Si les mails sont configurés, le bouton **Vérifier la connexion e-mail** lance uniquement un contrôle de connexion/authentification. Il utilise un nouveau transport, distinct de celui des workers, avec une limite de réponse de vingt secondes et une demande de fermeture après chaque résultat. Aucun message, destinataire ou lien d'invitation n'est créé. Une session révoquée pendant le contrôle ne reçoit pas de preuve de réussite.

L'API impose Origin, CSRF, un objet JSON vide, dix contrôles par minute au total et trois par quinze minutes par administrateur. Un seul contrôle logique peut être actif par processus. Les réponses ne contiennent ni serveur SMTP, identifiant, mot de passe, clé, chemin privé, configuration MariaDB ni transcription SMTP. Le navigateur conserve le résultat seulement en mémoire, le retire lorsqu'il est masqué ou déconnecté, recharge la session au retour et exige un nouveau clic après une erreur CSRF.

Selon la [documentation Nodemailer](https://nodemailer.com/smtp#verifying-the-configuration), `verify()` contrôle la résolution DNS, la connexion TCP, TLS et l'authentification sans envoyer de message. Il ne confirme pas que le serveur acceptera un expéditeur donné. Une réussite affiche donc seulement la connexion chiffrée et l'authentification réussies ; la réception d'un e-mail reste à tester. Aucun résultat n'est enregistré comme autorisation de publication. L'authentification est forcée (`forceAuth`) : une absence d'annonce AUTH ne doit pas produire une réussite sans connexion au compte.

Le délai de vingt secondes borne la réponse du contrôle ; `close()` de Nodemailer ne coupe pas nécessairement une vérification réseau déjà engagée. Une opération native peut donc continuer après ce délai, avec la limite d'inactivité du socket de 45 secondes. Cette instance est dédiée au diagnostic et ne ferme pas le transport des files d'envoi. La limite d'un contrôle concerne les requêtes logiques de l'application, sans constituer une borne absolue des échanges réseau sous-jacents.

## Réglages Infomaniak à préparer

Paramètres vérifiés dans la [documentation officielle](https://www.infomaniak.com/fr/support/faq/2427/synchroniser-les-e-mails-sur-tous-vos-equipements), consultée le 15 octobre 2026 :

| Paramètre | Valeur à préparer |
| --- | --- |
| Serveur SMTP | `mail.infomaniak.com` |
| Port recommandé | `587`, STARTTLS obligatoire dans l'application |
| Alternative | `465`, TLS implicite |
| Identifiant | Adresse complète ; `contact@jessiemessage.com` si la boîte et son authentification sont confirmées |
| Mot de passe | Mot de passe IMAP/SMTP réservé à l'application, distinct du mot de passe Manager |
| Expéditeur / réponses / enveloppe | `contact@jessiemessage.com` |

L'existence d'un domaine ou d'un alias ne démontre pas que l'adresse possède une authentification SMTP. Dans **Manager → Service Mail**, sélectionner le service lié à `jessiemessage.com`, retrouver l'adresse puis vérifier ses réglages et ses appareils autorisés. Un mot de passe réservé au serveur peut être géré dans l'onglet **Appareils** ; le conserver uniquement dans la configuration privée du serveur. Voir le [guide officiel du Service Mail](https://www.infomaniak.com/fr/support/faq/2435/decouvrir-linterface-service-mail-infomaniak).

Ces réglages documentés ne confirment pas l'existence de la boîte, les options du compte, ses quotas ni l'autorisation du fournisseur pour l'usage prévu. Aucun compte Infomaniak n'a été consulté dans ce lot.

## Contrôles de domaine et réception encore nécessaires

Dans **Service Mail → Sécurité globale**, vérifier les états SPF, DKIM et DMARC : SPF autorise les serveurs émetteurs, DKIM signe les messages et DMARC définit la politique pour les messages non authentifiés. Si le DNS est géré ailleurs, récupérer les valeurs exactes fournies par le Manager, dont le sélecteur DKIM. Aucune valeur ni sélecteur ne doit être deviné. Le diagnostic Infomaniak dépend aussi du domaine et de son routage mail. Voir le [guide officiel SPF/DKIM/DMARC](https://www.infomaniak.com/fr/support/faq/2692/verifier-automatiquement-spf-dkim-dmarc).

La recette réelle doit ensuite être constatée sur un environnement HTTPS privé :

1. Confirmer la boîte, son authentification, les conditions d'usage et les quotas.
2. Vérifier les enregistrements réellement publiés et le diagnostic du fournisseur.
3. Lancer explicitement le contrôle de connexion depuis l'administrateur.
4. Tester séparément une vérification d'adresse et une récupération sur une boîte maîtrisée, contrôler la réception, les courriers indésirables et les en-têtes d'authentification.
5. Vérifier le fonctionnement des réponses vers l'adresse officielle et le parcours mobile ; confirmer qu'un lien consommé, expiré ou révoqué reste inutilisable.

Cette liste décrit les essais restants, pas des résultats acquis. Les contrôles de majorité, de sécurité, de conservation/sauvegarde et la recette de l'application sous HTTPS restent distincts. Les règles des files et des envois sont détaillées dans [verification-mail.md](verification-mail.md) et [client-recovery.md](client-recovery.md).

## Validation du lot

Les essais automatisés emploient des comptes fictifs et des transports injectés ; ils couvrent l'identité, l'absence d'envoi par la vérification, les erreurs neutres, les limites, la fermeture du transport et la révocation en cours de requête. Le nouveau groupe HTTP/MariaDB s'ajoute aux groupes exécutés séquentiellement ; les 22 migrations restent inchangées. La CI 0.10 détaillée ci-dessous réussit sur les deux versions MariaDB. La [CI 0.9 vérifiée](https://github.com/fredbuhr/jessiemessage/actions/runs/38655526255), antérieure à ces modifications, a réussi avec 461 tests généraux et 190 tests sur chaque version MariaDB ; ce résultat ne valide pas le nouveau lot.

Aucun SMTP réel, test de délivrabilité, changement DNS, déploiement, fusion ni recette visuelle/mobile n'est revendiqué.

## Résultat CI

Implémentation `7909458c922a696e51590186c78692b1fe317753`, [PR brouillon #9](https://github.com/fredbuhr/jessiemessage/pull/9) : [CI 38657493833](https://github.com/fredbuhr/jessiemessage/actions/runs/38657493833) réussie sous Node.js 24.21.0. Le job général compte 524 tests réussis et 15 groupes DB explicitement ignorés ; chaque version MariaDB 10.11 et 11.4 réussit ensuite 200 tests sans saut dans quinze groupes séquentiels. Le nouveau groupe de préparation compte 10 tests, dont la vérification des quotas SQL persistants et de la révocation en cours de contrôle. Syntaxe et build réussis. Ces résultats utilisent uniquement des transports injectés et ne valident pas la connexion ou la réception réelles.
