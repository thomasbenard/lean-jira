# Ticket 043 — Bottleneck analysis : drill-down colonne

## User story

En tant que lead technique, je veux que le bottleneck analysis identifie non seulement le rôle
bloquant (dev/qa/po) mais aussi la colonne spécifique (statut) la plus lente au sein de ce rôle,
afin de savoir précisément où intervenir (ex : "In Progress" vs "Code Review" tous deux dans dev).

## Solution retenue

Ajouter un calcul de temps médian par statut individuel, en parallèle du calcul de temps par rôle
déjà existant. Pour chaque rôle, la colonne dont le médian est le plus élevé devient la
`dominantColumn`. Le résultat expose `primaryColumn` (colonne la plus lente dans le rôle primaire)
et enrichit chaque `RoleBottleneckScore` d'un champ `dominantColumn`. Le rapport affiche cette
colonne sous la recommandation dans le panel diagnostic.

Pas de snapshot : la cardinalité des colonnes varie d'un board à l'autre, ce qui rendrait
l'extraction en `metric_snapshots` non générique.

## Estimation

**Bucket** : S

**Justification** : 2 fichiers touchés (`bottleneckAnalysis.ts` + `generate.ts`). Pattern
existant réutilisé (`computeRoleDays` pour la logique de timing). ~4 scénarios de test.
Aucune migration DB. Changement de surface mineure (champs additionnels dans le résultat).

## Statut

**à faire**
