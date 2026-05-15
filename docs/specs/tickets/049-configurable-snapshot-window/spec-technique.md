# Spec technique — Fenêtre rolling snapshot configurable

## Impact fichiers

| Fichier | Modification |
|---|---|
| `src/main.ts` | Ajouter `snapshotWindowDays?: number` dans `BoardFileConfig.metrics`; validation; propagation dans `buildMetricConfig` → `MetricConfig`; détection changement dans commande `snapshots` |
| `src/metrics/types.ts` | Ajouter `snapshotWindowDays?: number` dans `MetricConfig` |
| `src/db/store.ts` | Ajouter `getStoredSnapshotWindowDays` + `persistSnapshotWindowDays` (clone de `getStoredEstimationMethod`/`persistEstimationMethod`) |
| `src/snapshots/compute.ts` | Remplacer `ROLLING_WINDOW_DAYS` par `baseConfig.snapshotWindowDays ?? 30` à la ligne 99 |

---

## 1. `src/metrics/types.ts` — ajout dans `MetricConfig`

```typescript
// après windowEndDate (l. 46)
// Fenêtre glissante en jours calendaires pour les snapshots de métriques de durée.
// Remplace ROLLING_WINDOW_DAYS dans snapshots/compute.ts. Ignoré par les métriques
// hebdomadaires (WEEKLY_METRICS) et cumulatives (CUMULATIVE_METRICS).
snapshotWindowDays?: number;
```

---

## 2. `src/main.ts` — `BoardFileConfig` + validation + `buildMetricConfig`

### BoardFileConfig (l. 133)

```typescript
metrics?: {
  cutoffDate?: string;
  bugIssueTypes?: string[];
  excludeIssueTypes?: string[];
  healthThresholds?: HealthThresholds;
  scopeChangeGracePeriodHours?: number;
  estimation?: EstimationConfig;
  snapshotWindowDays?: number;   // ← nouveau
};
```

### Validation dans `loadBoardConfig` (après `validateEstimationConfig`, l. 182)

```typescript
const windowDays = cfg.metrics?.snapshotWindowDays;
if (windowDays !== undefined && windowDays <= 0) {
  console.error(`snapshotWindowDays doit être un entier > 0 (reçu : ${windowDays})`);
  process.exit(1);
}
if (windowDays !== undefined && windowDays > 365) {
  console.warn(`⚠ snapshotWindowDays=${windowDays} : fenêtre très large, les données anciennes seront incluses.`);
}
```

### `buildMetricConfig` (l. 194) — propagation

```typescript
// dans le return (après estimation)
snapshotWindowDays: app.metrics?.snapshotWindowDays,
```

### Commande `snapshots` (l. 576) — détection changement

```typescript
.action((opts: SnapshotsOpts) => {
  initLocale(opts.lang);
  const config = loadConfigs(path.resolve(opts.config), path.resolve(opts.boardConfig));
  bootstrapFakeMode(config.jira);
  const db = openDb(config.db.path);
  const metricConfig = buildMetricConfig(db, config);

  const currentWindow = metricConfig.snapshotWindowDays ?? 30;
  const storedWindow = getStoredSnapshotWindowDays(db);
  if (storedWindow !== currentWindow) {
    console.warn(`⚠ snapshotWindowDays a changé (${storedWindow} → ${currentWindow}). Recalcul intégral des snapshots.`);
  }

  const count = backfillSnapshots(db, metricConfig);
  persistSnapshotWindowDays(db, currentWindow);
  console.log(t("snapshots.done", { count }));
});
```

Note : `backfillSnapshots` fait déjà `DELETE FROM metric_snapshots` en tête de transaction —
pas besoin de purge explicite supplémentaire.

---

## 3. `src/db/store.ts` — stockage dans `app_config`

```typescript
// après persistEstimationMethod (l. 181)

export function getStoredSnapshotWindowDays(db: Database.Database): number {
  const row = db.prepare("SELECT value FROM app_config WHERE key = 'snapshot_window_days'").get() as { value: string } | undefined;
  return row ? Number(row.value) : 30;
}

export function persistSnapshotWindowDays(db: Database.Database, days: number): void {
  db.prepare("INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)").run("snapshot_window_days", String(days));
}
```

---

## 4. `src/snapshots/compute.ts` — utilisation du paramètre

### Ligne 16 — supprimer la constante ou la garder comme fallback

```typescript
// Avant :
const ROLLING_WINDOW_DAYS = 30;

// Après : retirer ou commenter ; la valeur vient de baseConfig
```

### Ligne 99 — utilisation

```typescript
// Avant :
const windowDays = isWeekly ? WEEK_DAYS : ROLLING_WINDOW_DAYS;

// Après :
const rollingWindow = baseConfig.snapshotWindowDays ?? 30;
const windowDays = isWeekly ? WEEK_DAYS : rollingWindow;
```

---

## Ordre d'implémentation

1. `src/metrics/types.ts` : ajouter `snapshotWindowDays?` dans `MetricConfig` ← aucune dépendance
2. `src/db/store.ts` : ajouter `getStoredSnapshotWindowDays` + `persistSnapshotWindowDays`
3. `src/main.ts` : `BoardFileConfig` + validation + `buildMetricConfig` + commande `snapshots`
4. `src/snapshots/compute.ts` : remplacer `ROLLING_WINDOW_DAYS` par `baseConfig.snapshotWindowDays ?? 30`
5. `board.example.yaml` : documenter `snapshotWindowDays` en commentaire avec valeur par défaut
