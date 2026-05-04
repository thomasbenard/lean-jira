# Ticket 023 — Stage Throughput Gap

## User story

En tant que lead technique pilotant la capacité de l'équipe, je veux voir combien de tickets
entrent et sortent de chaque étape (dev/qa/po) par semaine, afin de détecter l'accumulation
d'inventaire entre rôles avant qu'elle ne se traduit en spike de lead time.

## Solution retenue

Nouvelle métrique `stage-throughput-gap`. Pour chaque issue dont les transitions couvrent
la période analysée, reconstruire la séquence des rôles successifs (dev/qa/po/none) à partir
des transitions ordonnées. Compter les entrées et sorties dans chaque rôle par semaine ISO.
Une "entrée" = transition vers un statut roleX depuis un statut non-roleX. Une "sortie" =
transition depuis un statut roleX vers un statut non-roleX. Fenêtre glissante 30j (snapshot)
ou complète (CLI). Sortie : `{ byWeek: [{week, devIn, devOut, devNet, qaIn, qaOut, qaNet,
poIn, poOut, poNet}], avgNetByRole: {dev, qa, po} }`.

## Estimation

**Bucket** : M

**Justification** : 1 nouveau fichier avec traitement en mémoire des transitions (pattern
nouveau, plus complexe que WIP), 2 fichiers modifiés (`index.ts`, `compute.ts`). 6–8
scénarios test (entrée simple, sortie, rework, semaine vide, rôle non configuré).

## Statut

**à faire**
