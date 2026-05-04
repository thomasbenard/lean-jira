# Spec technique — WIP par rôle

## Impact fichiers

| Fichier | Modification |
|---|---|
| `src/metrics/wipPerRole.ts` | Nouveau fichier |
| `src/metrics/index.ts` | Import + push dans `ALL_METRICS` |
| `src/snapshots/compute.ts` | `computeHistoricWipPerRole()` + branch snapshot |

---

## 1. `src/metrics/wipPerRole.ts`

```typescript
import type Database from "better-sqlite3";
import { type Metric, type MetricConfig } from "./types";
import { buildExcludeIssueTypesFragment } from "./utils";

export interface WipRoleSlice {
  count: number;
  issueKeys: string[];
}

export interface WipPerRoleResult {
  byRole: {
    dev: WipRoleSlice;
    qa: WipRoleSlice;
    po: WipRoleSlice;
  };
}

export const wipPerRoleMetric: Metric<WipPerRoleResult> = {
  name: "wip-per-role",
  description:
    "WIP actuel ventilé par rôle (dev/qa/po). Détecte la saturation par étape du process.",

  compute(db: Database.Database, config: MetricConfig): WipPerRoleResult {
    const roles = {
      dev: config.devStatuses ?? [],
      qa: config.qaStatuses ?? [],
      po: config.poStatuses ?? [],
    };

    const allEmpty = Object.values(roles).every((r) => r.length === 0);
    if (allEmpty) {
      console.warn("  ⚠ wip-per-role : aucun rôle configuré dans board.yaml — ajouter role: dev|qa|po sur les colonnes");
      return emptyResult();
    }

    const { excludeSql, excludeArgs } = buildExcludeIssueTypesFragment(config.excludeIssueTypes);

    const byRole: WipPerRoleResult["byRole"] = { dev: empty(), qa: empty(), po: empty() };

    for (const role of ["dev", "qa", "po"] as const) {
      const statuses = roles[role];
      if (statuses.length === 0) {continue;}
      const ph = statuses.map(() => "?").join(",");
      const rows = db.prepare(`
        SELECT key FROM issues
        WHERE current_status IN (${ph}) ${excludeSql}
      `).all(...statuses, ...excludeArgs) as { key: string }[];
      byRole[role] = { count: rows.length, issueKeys: rows.map((r) => r.key) };
    }

    return { byRole };
  },
};

function empty(): WipRoleSlice { return { count: 0, issueKeys: [] }; }
function emptyResult(): WipPerRoleResult {
  return { byRole: { dev: empty(), qa: empty(), po: empty() } };
}
```

---

## 2. `src/metrics/index.ts`

```typescript
import { wipPerRoleMetric } from "./wipPerRole";
// push dans ALL_METRICS après wipMetric
```

---

## 3. `src/snapshots/compute.ts`

### `computeHistoricWipPerRole()` — reconstruit WIP par rôle à une date D

Calquée sur `computeHistoricWip()` (ligne 184) mais filtrée par statuts de rôle :

```typescript
function computeHistoricWipPerRole(
  db: Database.Database,
  date: string,
  config: MetricConfig,
): { dev: number; qa: number; po: number } {
  const roles = { dev: config.devStatuses ?? [], qa: config.qaStatuses ?? [], po: config.poStatuses ?? [] };
  const result = { dev: 0, qa: 0, po: 0 };

  for (const role of ["dev", "qa", "po"] as const) {
    const statuses = roles[role];
    if (statuses.length === 0) {continue;}
    const ph = statuses.map(() => "?").join(",");
    const row = db.prepare(`
      WITH last_status AS (
        SELECT issue_key, to_status, MAX(transitioned_at) AS last_at
        FROM transitions
        WHERE substr(transitioned_at, 1, 10) <= ?
        GROUP BY issue_key
      )
      SELECT COUNT(*) AS c
      FROM last_status l
      JOIN issues i ON i.key = l.issue_key
      WHERE l.to_status IN (${ph})
        AND (i.resolved_at IS NULL OR substr(i.resolved_at, 1, 10) > ?)
    `).get(date, ...statuses, date) as { c: number };
    result[role] = row.c;
  }
  return result;
}
```

### Branch dans `computeSnapshot()`

Dans la boucle `for (const metric of ALL_METRICS)`, avant le bloc générique, ajouter :

```typescript
if (metric.name === "wip-per-role") {
  const counts = computeHistoricWipPerRole(db, date, baseConfig);
  for (const role of ["dev", "qa", "po"] as const) {
    rows.push({ snapshot_date: date, metric_name: "wip-per-role", bucket: role, stat: "count", value: counts[role] });
  }
  continue;
}
```

Note : `wip-per-role` court-circuite `extractStats` comme `wip` le fait déjà (ligne 71–75 de
`compute.ts`), car le résultat live contient `issueKeys` non sérialisable en snapshot.

---

## Ordre d'implémentation

1. `wipPerRole.ts` + tests TDD
2. `index.ts` — enregistrement
3. `compute.ts` — `computeHistoricWipPerRole` + branch snapshot
