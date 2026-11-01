# Portée de l’audit npm final

Root rapporte `npm audit --omit=dev --json`, exit0. Le JSON conservé npm-audit-final.json déclare63dépendances au total et0avis de vulnérabilité connu dans la base npm consultée. Cette conservation ne relance pas la commande.

Root rapporte également la comparaison du lock avec1.14.1 : aucun record nonracine existant modifié ; seuls trois nouveaux records @imagemagick/magick-wasm0.0.45, @phenomen/libavif-wasm1.4.203 et heic-to1.6.7. Cette note attribue la vérification à root et ne revendique pas une nouvelle exécution indépendante.

L’absence d’avis npm n’est pas une preuve d’absence universelle de vulnérabilité du code natif/WASM ou de ses codecs transitifs. Elle ne remplace ni les décodeurs épinglés, ni leurs gardes de ressources, ni la qualification fonctionnelle et native du candidat final. Aucun hôte, compte ni contenu réel examiné.

SHA256 du JSON conservé :974580651a30ccbb60ee33d30aabe1fdb1df0f7157ad2c7f133e2ac21ac52087.
