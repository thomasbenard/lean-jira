# Spec fonctionnelle — Stage Throughput Gap

## Contexte

Si dev livre 10 tickets/semaine vers QA mais QA n'en absorbe que 6, l'inventaire QA grossit
de 4/semaine — signal prédictif d'un spike de lead time à venir. Aucune métrique existante
ne mesure ce déséquilibre de flux entre rôles. `throughput` mesure les livraisons finales,
pas le débit inter-étapes.

## Comportement attendu

### Définitions

- **Entrée dans rôle R** : transition d'un ticket depuis un statut non-R vers un statut R
  (première transition R après une période non-R, ou depuis le début de l'historique)
- **Sortie de rôle R** : transition depuis un statut R vers un statut non-R
- **Net flow** = entrées − sorties (positif = accumulation, négatif = déstockage)

Pour chaque ticket, la séquence de rôles est construite en passant sur les transitions
ordonnées : chaque changement de rôle constitue une entrée/sortie. Les transitions au sein
du même rôle (ex: deux statuts dev consécutifs) ne comptent pas.

### Population

Toutes les issues ayant au moins une transition dans la période, non filtrées par livraison
(contrairement à `stage-time-breakdown`). Inclut WIP en cours. Filtre `excludeIssueTypes`.
Pas de filtre `cutoffDate` pour les entrées/sorties (on veut le flux réel de la période).

### Fenêtre d'analyse

CLI (`npm run metrics`) : toutes les transitions depuis `cutoffDate`. Snapshot : fenêtre
30-day rolling (standard métriques duration). La semaine ISO de la transition détermine le
bucket.

### Sortie CLI

```
=== STAGE-THROUGHPUT-GAP ===
  Semaine    devIn  devOut  devNet  qaIn  qaOut  qaNet  poIn  poOut  poNet
  2025-W10     8      7      +1      7     5      +2     5     6      -1
  2025-W11     6      8      -2      8     7      +1     6     5      +1
  ...
  Moy net :   dev=+0.5  qa=+1.0  po=-0.2
```

Net positif QA persistant = bottleneck QA. Net négatif persistant = rôle qui déstocke
(potentiellement sous-alimenté).

## Cas limites

- Ticket entre dans dev et reste (pas de sortie dans la période) → 1 entrée, 0 sortie dev
- Ticket rework (dev → qa → dev) → 2 entrées dev, 1 sortie dev, 1 entrée qa, 1 sortie qa
- Rôle non configuré → In/Out/Net = 0 pour ce rôle, colonne affichée à zéro
- Semaine sans transition → absente du `byWeek` (pas de ligne vide)
- Transition vers statut `done` depuis rôle po → 1 sortie po (livraison compte comme sortie)

## Ce qui ne change pas

- `throughput` et `bug-throughput` (livraisons finales) inchangés
- `wip-per-role` (point-in-time) inchangé — les deux métriques sont complémentaires
