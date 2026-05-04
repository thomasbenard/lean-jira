# Spec fonctionnelle — Stage Time Breakdown

## Contexte

Les métriques `lead-time` et `cycle-time` donnent le temps total par ticket, mais ne révèlent
pas où ce temps est consommé dans le process. Sur un board multi-rôles (dev → qa → po), savoir
que la médiane QA = 5j et la médiane PO = 4j est actionnable pour le découpage de sprints et
le sizing des équipes. Aucune métrique existante ne fournit cette ventilation.

## Comportement attendu

### Population

Identique à `cycle-time` : tickets livrés ayant une transition `devStartStatuses` ET une
transition `todoStatuses`. Filtres `cutoffDate`, `windowEndDate`, `excludeIssueTypes`
appliqués. Outliers supprimés via Tukey upper fence sur le cycle time total.

### Calcul par ticket

Pour chaque ticket retenu, `computeRoleDays()` (ticket 020) calcule :
- `devDays` — jours ouvrés passés dans des statuts `role: dev`
- `qaDays` — jours ouvrés passés dans des statuts `role: qa`
- `poDays` — jours ouvrés passés dans des statuts `role: po`

Les passes multiples dans un rôle (ex: rework dev → qa → dev) sont cumulées. Les statuts
hors des trois rôles (statuts todo, done, ou colonnes sans role) sont ignorés.

### Agrégation

Par rôle, `statsFromDays()` produit `DurationStats` (count, avgDays, medianDays, p85Days,
p95Days, excludedOutliers).

`avgShareByRole` = part moyenne du cycle time observable (devDays + qaDays + poDays) passée
dans chaque rôle. Tickets où la somme role-days = 0 sont exclus du calcul de share (évite
la division par zéro).

### Sortie CLI (`npm run metrics`)

```
=== STAGE-TIME-BREAKDOWN ===
  Issues : 42

  Rôle   Médiane   P85    Moy    Part moy
  dev    4.2 j     8.1 j  5.0 j  45 %
  qa     2.8 j     6.4 j  3.3 j  35 %
  po     1.5 j     4.2 j  1.9 j  20 %
```

### Cas : aucun rôle configuré

Si `config.devStatuses`, `config.qaStatuses` et `config.poStatuses` sont tous vides (aucune
colonne avec `role:` dans `board.yaml`), la métrique retourne `{count: 0, byRole: {...vide}, avgShareByRole: {...zéro}}` et affiche un avertissement :
`⚠ stage-time-breakdown : aucun rôle configuré dans board.yaml — ajouter role: dev|qa|po sur les colonnes`.

## Cas limites

- Ticket où `devDays + qaDays + poDays = 0` (jamais passé dans une colonne rôle) → inclus dans `count` de chaque rôle avec 0j, exclu du calcul `avgShareByRole`
- Rôle QA non configuré → `qaStatuses = []` → `qaDays = 0` pour tous → DurationStats QA : `count=0`, `medianDays=0`
- Ticket avec rework (dev → qa → dev) → `devDays` = somme des deux passages
- Ticket passe dans une colonne `type: done, role: po` (cas KECK "À valider") → `poDays` inclut ce temps, cohérent avec le design du ticket 019

## Ce qui ne change pas

- Population et filtres des métriques `cycle-time`, `lead-time` inchangés
- `flowEfficiency.ts` inchangé
- `MetricConfig` : pas de nouveaux champs (dépend de ticket 020)
