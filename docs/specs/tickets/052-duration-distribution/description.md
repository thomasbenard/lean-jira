# Ticket 052 — Distribution PDF + CDF lead-time / cycle-time

## User story

En tant que lead technique (et coach Lean), je veux visualiser la **distribution complète** des lead-time et cycle-time (PDF + CDF) avec **superposition par bucket de taille**, afin de répondre directement à des questions de pilotage type « quelle est la proba qu'un L soit livré sous 5 jours ouvrés ? » et d'identifier la **durée modale** par taille — informations que les médianes et P85 dans le rapport actuel masquent.

## Solution retenue

Nouvelle métrique `duration-distribution` (live, **non snapshottée**) qui produit, pour `cycle-time` et `lead-time` :

- **PDF discrète** : histogramme binné (largeur de bin auto, même algo que `buildHistogram` existant).
- **PDF lissée** : KDE gaussienne avec bandwidth via règle de Silverman.
- **CDF empirique** : fonction cumulative monotone croissante normalisée à 1.

Trois vues exposées : **global** (toute population livrée depuis `cutoffDate`) + **par bucket de taille** (XS/S/M/L/XL via `bucketize`, BUG et UNESTIMATED exclus de la décomposition mais inclus dans le global).

Côté report : **2 nouveaux charts** (`cycleDistribution`, `leadDistribution`) dans l'onglet `advanced`, rendu custom avec :
- bars (PDF histogramme) + line (KDE) sur axe Y gauche,
- line (CDF) sur axe Y droit (0–100 %),
- sélecteur de bucket (réutilise `initBucketSelector`) pour superposer ou comparer.

La métrique est calculée live dans `generate.ts` (comme `forecast`, `aging-wip`, `bottleneck-analysis`) : ne pas snapshotter — la distribution complète n'est utile qu'au temps présent et son shape ne rentre dans aucune branche `extractStats` existante.

## Estimation

**Bucket** : M

**Justification** : nouvelle métrique avec algo isolé (KDE Silverman + CDF) ~5 fichiers (`durationDistribution.ts`, registre, `generate.ts` injection, `chartDefs.ts` × 2 entrées, renderer hbs, i18n). Pattern réutilisé pour bins (`buildHistogram`) et selector (`initBucketSelector`). Tests : ~6 scénarios (PDF empty, KDE monotone, CDF strictement croissante, bucket filtering, bandwidth dégénéré n=1). Pas de migration DB. Pas snapshotté → pas de branche `extractStats` à ajouter.

## Statut

**à faire**
