# Preuves locales synthétiques acquises

Ce dossier conserve un choix borné de journaux, résultats, probes et notes de développement. `../local-results.json` donne pour chaque pièce la taille et le SHA256 avant/après compression ; les gzip ont un mtime0 et aucun nom original dans leur header. La préparation de ce dossier n’a exécuté aucun test ni probe.

Les groupes proviennent de plusieurs états de développement et se recoupent. Les journaux d’échec de fixture sont conservés avec les résultats corrigés et leurs explications. Les comptes ne s’additionnent pas ; aucune omission native n’est un succès. L’historique backend32Mio est remplacé pour le transport courant par le groupe128Mio stream, sans rejouer les anciens groupes.

Les probes de ressources utilisent `process.resourceUsage().maxRSS`, en Kio, sur les seules sources synthétiques indiquées. Les JSON conservent les mesures originales ; ce ne sont ni des mesures d’hôte ni une borne de pire cas. Les probes d’instrumentation initialement en échec restent distingués des mesures obtenues. Les originaux75/96Mio, les binaires RAW et les recherches/paquets npm ne sont pas copiés.

Les refus de formats documentent des reproductions synthétiques historiques, avant correction native-first. Ils ne diagnostiquent pas le fichier client initial. Les expériences RAW correspondent à des étapes du codec et n’attestent pas le candidat final. Les scripts de mesure sont des sources de preuve, pas des opérations à relancer automatiquement ; leurs fixtures volumineuses ne sont pas incluses.

La contre-revue afterEOF porte sur le checkpoint592b826353b46f01f474ba8bf1aa01c66fee997c. Son module figé a le SHA2564275422b6fa971edcd5de26eef994d630b5072705a99e462127b66fc31ae5826, identique au fichier Git de ce pin. Le probe démontre un P2 d’annulation après réception du corps ; sa correction autorisée attend un nouveau résultat ciblé et une revue distincte. Les preuves initiales ne sont pas réécrites après correction.

Complément ultérieur : backend-abort-after-eof-final.log.gz conserve les2nouveaux cas verts du correctif ; server-stream-abort-fix-review.md en consigne la contre-revue RO, les empreintes et les limites. Le P2 est corrigé localement et reste à qualifier avec le candidat CI final. Le paragraphe et le probe précédents décrivent volontairement l’état historique avant ce correctif.

Le delta mobile ultérieur des callers est séparé dans ui-mobile-capability-final.md et son journal8/8 : capability absente/désactivée/404 donne un convertisseur strictementundefined, préservant la voie HEIC locale. Les anciens groupes ne sont pas relancés ni ajoutés à ce compte. npm-audit-final.json.gz conserve le résultat rapporté par root63dépendances/0avis npm, avec ses limites dans npm-audit-final-scope.md ; cela ne signifie pas qu’aucune vulnérabilité codec n’existe.

Le dernier groupe backend145/145, les groupes codecs8/8 et AVIF3/3, les preuves de l’ordre HEIC4/4 et du helper cible1/1, la contre-revue des bornes, le build810sources et le smoke6familles sont conservés séparément. Ils se recoupent et ne deviennent pas un total global. Les8/8 callers HEIC mobiles sont le même journal que le delta précédent, pas une seconde exécution. P03 dans la checklist correspond au défaut aprèsEOF de sévéritéP2 : corrigé par les2nouveaux cas et relu RO ; aucune qualification CI globale revendiquée.

extra-raw-final-probes.json.gz est le consolidé final propre :12MP sans miniature réussit,48MP sans miniature retourne MEDIA_UNAVAILABLE sous le mécanisme de heap512Mio,48MP avec JPEG embarqué réussit. Les anciens essais8MP/48MP non finaux restent marqués historiques dans le manifeste et n’attestent pas la voie finale. Les originaux synthétiques RAW d’environ96Mio ne sont pas inclus. codecs.json, écrit séparément par son auteur dans le dossier parent, complète cette portée.

CI finale, qualification main, navigateur physique, déploiement, hôte, compte/média/message réels et sauvegarde/restauration hébergée restent non revendiqués par ce dossier. Voir `../coverage.json` et `../development-checkpoint.json` pour la checklist et les limites.
