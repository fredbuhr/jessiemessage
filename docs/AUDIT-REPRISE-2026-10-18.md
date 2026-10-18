# Audit de reprise JessieMessage — 18 octobre 2026

## Conclusion et périmètre

Le travail de la discussion « travail en cours » est récupérable depuis GitHub. La source complète est `dc02ec6` sur `feat/recurring-private-checkpoints` ; elle contient les étapes applicatives jusqu'à 0.50, la surveillance 0.51, le superviseur 0.52 et leurs preuves. La branche de reprise préserve cet historique. Le Manager et le terminal SSH existants sont accessibles ; le service n'a pas été redémarré pendant l'audit.

L'audit couvre la reconstruction Git, les versions hébergées, les frontières HTTP et de confidentialité, les sauvegardes, la cohérence documentaire, les dépendances et les suites automatisées disponibles. Ce rapport ne constitue pas un test d'intrusion ni une certification de toutes les interfaces sur les appareils du foyer.

## Constats prioritaires

| Priorité | Constat | Action / état |
| --- | --- | --- |
| P0 reprise | `main` ne contient pas l'application complète : 591 fichiers et près de 90 000 lignes la séparent de la pile applicative | Branche isolée créée depuis la dernière source complète ; point d'entrée `docs/REPRISE.md` ajouté. Aucun déploiement depuis `main` |
| P1 qualité | `npm run check` énumérait manuellement les fichiers et omettait onze modules/opérateurs récents, notamment le superviseur et le chiffrement 0.52 | Remplacé par la découverte de tous les `.js`, `.mjs` et scripts shell dans les répertoires de source et de tests, sans suivre de liens |
| P0 exploitation | Journal de sauvegarde présent, mais aucun contrôle exploitable de son ancienneté ou de la dernière tentative en échec | Contrôle en lecture seule 0.53 ajouté, seuil 26 heures, tentatives bloquées/incomplètes et codes processus distincts |
| P0 exploitation | Copie indépendante récurrente, vérification PC de l'archive 0.52 et réception d'alertes non prouvées | Restent ouvertes ; aucun succès déduit de la seule présence du journal |
| P1 reprise | `ARCHITECTURE.md` décrivait encore 0.33 ; `SECURITY.md` décrivait 0.40 avec fiches/diffusions désactivées | En-têtes courants corrigés et renvoi à la source de reprise ; historique conservé et identifié |
| P1 clôture | Notice/confidentialité, décisions de conservation et effacement complet encore en brouillon | Conserver explicitement ces limites dans le plan courant ; aucune purge déclenchée |

## État en ligne observé

Le 18 octobre à **00:48:02.364 UTC**, le terminal SSH relit les deux sources actives :

| Composant | Commit | Arbre | Propreté Git |
| --- | --- | --- | --- |
| Application 0.50 | `0a1cafd85c3d8699be1961075b18e80e36bcd041` | `17db89aa165e23ca427d073f5a3fcc28387f5168` | Propre |
| Superviseur 0.52 | `9665d54cc6abb236b04eecc9d92540d7e1c5d035` | `67a0757f77cced10d07f25936b71a30fd6539075` | Propre |

Sur les deux origines, `/api/health` répond 200 `ok` et `/api/ready` répond 200 `ready`, avec `no-store` et sans cookie. `/admin/broadcasts` répond 401 sans session. Les anciennes routes invitées de diffusion, le module de préférence retiré, `/server/index.mjs` et `/.env` répondent 404, avec `no-store`. Le passage à **00:52:37.742 UTC** effectue 38 lectures et confirme **seize empreintes exactes** de ressources publiques. À **00:53:39.500 UTC**, huit lectures ciblées de `/api/admin/crm/contacts`, `/capabilities`, `/labels` et `/admin/broadcasts` sur les deux origines confirment 401, `no-store` et aucun cookie ouvrant une session. Les éventuels `Set-Cookie` ne font qu’expirer le cookie administrateur avec `Max-Age=0`, `Secure` et `HttpOnly`, conformément aux gestionnaires examinés. Aucun défaut d’autorisation n’est relevé dans ces vérifications anonymes. Les routes authentifiées et la réception réelle des messages gardent leurs preuves et limites distinctes.

À **00:47:06.582 UTC**, le lecteur natif privé retrouve deux enregistrements du premier checkpoint : dernier succès `1792283296649`, `succeeded / finished / OK / runtimeResumed: true`. La planification est activée pour 05:15 UTC. Le Manager indique Node.js actif et le Build du 18 octobre à 02:27 Europe/Paris. Le premier passage quotidien n'est pas encore observé. La copie et le déchiffrement personnels de cette archive restent ouverts.

La tentative HTTPS depuis le bac à sable local expire ; elle est identifiée comme une limite d'accès locale. Les réponses HTTPS ci-dessus proviennent du contrôle réel effectué depuis l'hébergement, avec validation TLS normale.

## Code et données

Les frontières examinées conservent l'authentification par rôle, le contrôle de session, Origin/CSRF, l'autorisation par conversation et les transactions pour la livraison. L'aperçu et l'insertion finale des diffusions contrôlent l'accès courant et la propriété sans lire l'ancienne préférence comme condition d'envoi. Les messages destinataires n'exposent pas la campagne ou l'audience. Le service worker ne met en cache ni messages ni photos et ne prend en charge que les notifications.

Le schéma conserve trente migrations. Les anciennes préférences de diffusion restent un historique compatible avec les sauvegardes, pas un code à supprimer avec sa migration. Les clés et configurations restent hors du dépôt. L'inventaire des fichiers suivis ne contient pas de clé `.asc`, `.pem`, `.key`, d'archive `.gpg` ou de fichier `.env` réel ; des scripts de gestion de secrets et migrations SQL de structure sont présents normalement.

Les nouvelles captures restent au profil `photos-notify-recovery-crm-broadcast-application`, manifeste 10 / reçu 8, six clés, trente tables et photos. La couverture n'est pas une sauvegarde complète de tous les objets SQL exécutables (`completeDatabase: false`). Le journal, le reçu de chiffrement, la copie indépendante, le déchiffrement et une restauration sont des preuves distinctes.

## Validation et limites

- Baseline locale sur la source récupérée : **2 429 tests, 2 258 réussis, zéro échec, 171 ignorés**. Les tests système exigeant procfs et les intégrations SQL ne sont pas disponibles dans ce bac à sable ; ils ne sont pas comptés comme réussis.
- CI historique relue via l'API GitHub : run **39081600837**, source exacte opérateur `9665d54`, statut `completed`, conclusion `success`. Le détail historique documente cinq jobs, 383 tests sur chacune des deux versions MariaDB, 101 Chrome et une authentification HTTPS. Cette preuve historique n'est pas présentée comme un nouveau passage sur la branche de reprise.
- `npm audit --omit=dev --json` : zéro vulnérabilité connue signalée. Ce résultat ne prouve pas l'absence de défaut applicatif.
- Après modifications : **2 440 tests locaux, 2 268 réussis, zéro échec, 172 ignorés** ; dix nouveaux scénarios de fraîcheur passent, le onzième exige procfs et reste réservé à la CI Linux. **420 fichiers** passent le contrôle de syntaxe ; le build réussit. La [CI distante de la source `5c64a9d6`](https://github.com/fredbuhr/jessiemessage/actions/runs/39084535494) passe ses cinq jobs : **2 413 réussites / 27 wrappers SQL ignorés** dans la suite générale, **383/383** sur chaque MariaDB 10.11 et 11.4, **101/101 Chrome**, **1/1 authentification HTTPS** ; zéro échec. Le nouveau test natif privé passe également en CI Linux. Les commits documentaires suivants conservent cette source de code.
- Essai réel du contrôle 0.53 à **00:55:23.605 UTC** dans un checkout séparé : **11/11 tests**, aucun ignoré, journal `current / OK`, puis HTTPS `healthy`. Voir le [reçu hébergé](activation-proofs/jm053-freshness-check.json). L’outil est disponible à la demande ; aucune alerte ou copie automatique n’est activée par cet essai.
- Surveillance externe : la liste des runs de `main` relue pendant la reprise contient le seul passage `push` 39079931320 ; aucun événement `schedule` n’est encore observé. La régularité des sondes et la réception des alertes restent non prouvées.

## Plan de poursuite

1. Livrer et valider la reprise, le contrôle de fraîcheur et le contrôle de syntaxe complet ; conserver les dossiers applicatifs actifs.
2. Terminer 0.52 : copie/déchiffrement PC ciblés et observation du premier déclenchement quotidien.
3. Terminer 0.53 : destination indépendante réellement choisie, transfert automatique chiffré, reçu d'empreinte, vérification courante et alertes panne/rétablissement reçues.
4. Clore 0.54 : source stable complète, CI de cette source, déploiement et repli documentés ; ne pas remplacer `main` par une supposition sur la pile de PR.
5. Finaliser les décisions de confidentialité/conservation et l'effacement contrôlé ; compléter seulement les observations personnelles encore manquantes (diffusion ciblée et administration simultanée).
