# Spec fonctionnelle — WIP par rôle

## Contexte

La métrique `wip` donne le WIP total du sprint actif. Elle ne distingue pas les tickets
bloqués en attente QA de ceux en dev actif ou en validation PO. Sur un board multi-rôles,
cette ventilation permet de détecter la saturation par rôle en temps réel.

## Comportement attendu

### Population

Toutes les issues dont `current_status` est dans les statuts d'un rôle donné. Pas de filtre
sprint, pas de `cutoffDate` (point-in-time). Filtre `excludeIssueTypes` appliqué.

### Sortie

Par rôle configuré : nombre d'issues + liste des clés.

```
=== WIP-PER-ROLE ===
  dev  : 5  [KECK-12, KECK-34, KECK-47, KECK-51, KECK-63]
  qa   : 3  [KECK-28, KECK-39, KECK-44]
  po   : 2  [KECK-21, KECK-55]
```

### Cas : aucun rôle configuré

Si tous les groupes role sont vides → retourne `{byRole: {dev: {count:0,...}, ...}}` + avertissement :
`⚠ wip-per-role : aucun rôle configuré dans board.yaml`.

### Snapshot

`computeHistoricWipPerRole()` dans `compute.ts` reconstruit le WIP par rôle à une date
donnée depuis la table `transitions` (même logique que `computeHistoricWip` existant, filtré
par rôle au lieu de `inProgressStatuses`). Stats stockées : `{ bucket: role, stat: "count" }`.

## Cas limites

- Issue `current_status` dans statuts à la fois `role: dev` et sans role → impossible par
  construction (un statut appartient à une seule colonne)
- Rôle QA non configuré → `qaStatuses = []` → count QA = 0
- Issue en statut `type: done, role: po` (cas KECK) → compte dans WIP PO car `current_status`
  est un statut PO ; à noter ce comportement dans le CLI

## Ce qui ne change pas

- Métrique `wip` existante (sprint-scoped) inchangée
- `inProgressStatuses` et leur calcul inchangés
