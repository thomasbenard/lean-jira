# Spec technique — bug-backlog

## Impact fichiers

| Fichier | Modification |
|---|---|
| `src/metrics/bugBacklog.ts` | Nouveau — implémente `Metric<BugBacklogResult>` |
| `src/metrics/index.ts` | Import + push `bugBacklogMetric` dans `ALL_METRICS` |
| `src/snapshots/compute.ts` | Ajouter `"bug-backlog"` à `WEEKLY_METRICS` + branche `extractStats` |
| `src/report/generate.ts` | Nouveau graphe « Bug Backlog » |

---

## 1. `src/metrics/bugBacklog.ts`

```typescript
import Database from "better-sqlite3";
import { Metric, MetricConfig } from "./types";
import { placeholders } from "./utils";

export interface BugBacklogResult {
  openCount: number;
  netFlow: number;
  created: number;
  closed: number;
}

export const bugBacklogMetric: Metric<BugBacklogResult> = {
  name: "bug-backlog",
  description: "Bugs ouverts (point-in-time) et flux net hebdo. Détecte si le backlog grossit.",

  compute(db: Database.Database, config: MetricConfig): BugBacklogResult {
    if (config.bugIssueTypes.length === 0) {
      return { openCount: 0, netFlow: 0, created: 0, closed: 0 };
    }

    const endDate = config.windowEndDate ?? new Date().toISOString().slice(0, 10);
    const startDate = config.cutoffDate ?? endDate;
    const bugPh = placeholders(config.bugIssueTypes);
    const donePh = placeholders(config.doneStatuses);

    // openCount : bugs dont le dernier statut avant endDate n'est pas done
    const openRow = db.prepare(`
      WITH last_status AS (
        SELECT
          issue_key,
          to_status,
          MAX(transitioned_at) AS last_at
        FROM transitions
        WHERE substr(transitioned_at, 1, 10) <= ?
        GROUP BY issue_key
      )
      SELECT COUNT(*) AS c
      FROM issues i
      LEFT JOIN last_status ls ON ls.issue_key = i.key
      WHERE i.issue_type IN (${bugPh})
        AND substr(i.created_at, 1, 10) <= ?
        AND (ls.to_status IS NULL OR ls.to_status NOT IN (${donePh}))
    `).get(endDate, ...config.bugIssueTypes, endDate, ...config.doneStatuses) as { c: number };

    // created : bugs créés dans la fenêtre
    const createdRow = db.prepare(`
      SELECT COUNT(*) AS c FROM issues
      WHERE issue_type IN (${bugPh})
        AND substr(created_at, 1, 10) BETWEEN ? AND ?
    `).get(...config.bugIssueTypes, startDate, endDate) as { c: number };

    // closed : bugs dont la 1ère transition done tombe dans la fenêtre
    const closedRow = db.prepare(`
      WITH first_done AS (
        SELECT issue_key, MIN(transitioned_at) AS done_at
        FROM transitions
        WHERE to_status IN (${donePh})
        GROUP BY issue_key
      )
      SELECT COUNT(*) AS c
      FROM first_done fd
      JOIN issues i ON i.key = fd.issue_key
      WHERE i.issue_type IN (${bugPh})
        AND substr(fd.done_at, 1, 10) BETWEEN ? AND ?
    `).get(...config.doneStatuses, ...config.bugIssueTypes, startDate, endDate) as { c: number };

    const created = createdRow.c;
    const closed = closedRow.c;

    return {
      openCount: openRow.c,
      netFlow: closed - created,
      created,
      closed,
    };
  },
};
```

---

## 2. `src/metrics/index.ts`

Ligne 17, après l'import de `devTimeAllocationMetric` :

```typescript
import { bugBacklogMetric } from "./bugBacklog";
```

Ligne 35, dans `ALL_METRICS` après `devTimeAllocationMetric` :

```typescript
  bugBacklogMetric,
```

---

## 3. `src/snapshots/compute.ts`

### WEEKLY_METRICS (ligne 9)

```typescript
const WEEKLY_METRICS = new Set([
  "throughput", "throughput-weighted", "bug-throughput", "dev-time-allocation", "bug-backlog",
]);
```

### `extractStats` — nouvelle branche (après le bloc `"avgBugRatio"`, avant le bloc `"byWeek"`)

```typescript
} else if ("openCount" in result) {
  const r = result as unknown as BugBacklogResult;
  out.push({ snapshot_date: date, metric_name: metricName, bucket: "", stat: "openCount", value: r.openCount });
  out.push({ snapshot_date: date, metric_name: metricName, bucket: "", stat: "netFlow",   value: r.netFlow });
  out.push({ snapshot_date: date, metric_name: metricName, bucket: "", stat: "created",   value: r.created });
  out.push({ snapshot_date: date, metric_name: metricName, bucket: "", stat: "closed",    value: r.closed });
```

Ajouter l'import en tête du fichier :

```typescript
import { BugBacklogResult } from "../metrics/bugBacklog";
```

---

## 4. `src/report/generate.ts`

Suivre le pattern des graphes `byWeek` existants (throughput). Lire les snapshots filtrés sur
`metric_name = 'bug-backlog'`, puis construire deux datasets Chart.js :

```typescript
// datasets pour le graphe bug-backlog
const bugBacklogRows = snapshots.filter(r => r.metric_name === "bug-backlog");
const weeks = [...new Set(bugBacklogRows.map(r => r.snapshot_date))].sort();
const openCounts = weeks.map(w =>
  bugBacklogRows.find(r => r.snapshot_date === w && r.stat === "openCount")?.value ?? null
);
const netFlows = weeks.map(w =>
  bugBacklogRows.find(r => r.snapshot_date === w && r.stat === "netFlow")?.value ?? null
);
```

Chart.js config : `type: "bar"` pour netFlow (couleur dynamique : vert si ≥ 0, rouge si < 0),
`type: "line"` pour openCount sur axe Y secondaire (`yAxisID: "y2"`).

---

## Ordre d'implémentation

1. Écrire les tests (TDD) dans `tests/metrics/bugBacklog.test.ts`
2. Implémenter `src/metrics/bugBacklog.ts`
3. Enregistrer dans `src/metrics/index.ts`
4. Ajouter à `WEEKLY_METRICS` et `extractStats` dans `src/snapshots/compute.ts`
5. Implémenter le graphe dans `src/report/generate.ts`
6. Vérifier `npm run snapshots && npm run report`
