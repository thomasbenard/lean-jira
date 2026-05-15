# Spec fonctionnelle — Fenêtre rolling snapshot configurable

## Contexte

La fenêtre glissante utilisée pour calculer les métriques de durée (cycle time, lead time,
flow efficiency, etc.) dans les snapshots hebdomadaires est actuellement fixée à 30 jours
calendar dans le code (`ROLLING_WINDOW_DAYS = 30`, `snapshots/compute.ts:16`). Cette valeur
est arbitraire et inadaptée à des équipes avec un débit très différent : une équipe qui livre
2 tickets/semaine a besoin de 60-90j pour obtenir une médiane stable ; une équipe qui livre
15/semaine peut se contenter de 14j pour une courbe plus réactive.

## Comportement attendu

### Configuration

`board.yaml` accepte une nouvelle clé optionnelle sous `metrics` :

```yaml
metrics:
  snapshotWindowDays: 30   # défaut si absent
```

- Type : entier strictement positif
- Défaut : `30` (comportement actuel inchangé)
- Validation au démarrage : valeur ≤ 0 → erreur + `process.exit(1)`

### Métriques affectées

Toutes les métriques qui ne sont pas dans `WEEKLY_METRICS` (7j fixes) ni dans
`CUMULATIVE_METRICS` (fenêtre depuis `cutoffDate`) :
- `lead-time`, `cycle-time`, `bug-cycle-time`
- `lead-time-normalized`, `cycle-time-normalized`
- `flow-efficiency`
- `stage-time-breakdown`, `stage-throughput-gap`, `bottleneck-analysis`

Les métriques hebdomadaires (throughput, handoff-rework, etc.) et cumulatives (by-size,
aging-wip, rework-cost) ne sont **pas** affectées.

### Re-backfill automatique

Au lancement de `npm run snapshots` : si `snapshotWindowDays` courant ≠ valeur stockée dans
`app_config` (clé `snapshot_window_days`), afficher un avertissement et recalculer tous les
snapshots depuis `cutoffDate` (comportement déjà porté par `backfillSnapshots` qui fait un
`DELETE FROM metric_snapshots` puis reinsère).

Format du warning (même style que `sync.estimationMethodChanged`) :
> `⚠ snapshotWindowDays a changé (30 → 14). Recalcul intégral des snapshots.`

Après recalcul : persister la nouvelle valeur dans `app_config`.

## Cas limites

- Valeur absente → défaut `30`, aucun recalcul si `app_config` stocke déjà `30`
- Valeur ≤ 0 → erreur explicite, exit 1 avant tout calcul
- Valeur > 365 → warning (fenêtre très large, peut inclure données très anciennes) mais
  pas d'erreur bloquante
- Première exécution (aucune valeur en `app_config`) → pas de warning, comportement normal,
  valeur persistée après backfill

## Ce qui ne change pas

- Les métriques hebdomadaires (`WEEKLY_METRICS`) gardent leur fenêtre de 7j, non configurable.
- Les métriques cumulatives (`CUMULATIVE_METRICS`) restent depuis `cutoffDate`, non configurable.
- Le calcul du WIP historique (point-in-time, pas de fenêtre) est inchangé.
- Le mode Sprints du rapport n'est pas affecté (calcul par sprint, pas par snapshot).
- L'API publique de `backfillSnapshots` reçoit `MetricConfig` ; le paramètre transite par là.
