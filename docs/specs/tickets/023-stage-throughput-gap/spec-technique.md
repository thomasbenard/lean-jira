# Spec technique — Stage Throughput Gap

## Impact fichiers

| Fichier | Modification |
|---|---|
| `src/metrics/stageThroughputGap.ts` | Nouveau fichier |
| `src/metrics/index.ts` | Import + push dans `ALL_METRICS` |
| `src/snapshots/compute.ts` | Branch `"avgNetByRole" in result` dans `extractStats()` |

---

## 1. `src/metrics/stageThroughputGap.ts`

### Types exportés

```typescript
export interface StageWeekRow {
  week: string;
  devIn: number; devOut: number; devNet: number;
  qaIn: number;  qaOut: number;  qaNet: number;
  poIn: number;  poOut: number;  poNet: number;
}

export interface StageThroughputGapResult {
  byWeek: StageWeekRow[];
  avgNetByRole: { dev: number; qa: number; po: number };
}
```

### Algorithme

```typescript
export const stageThroughputGapMetric: Metric<StageThroughputGapResult> = {
  name: "stage-throughput-gap",
  description:
    "Entrées/sorties par rôle par semaine. Net positif persistant = bottleneck. Prédictif.",

  compute(db: Database.Database, config: MetricConfig): StageThroughputGapResult {
    const roles = {
      dev: new Set(config.devStatuses ?? []),
      qa:  new Set(config.qaStatuses ?? []),
      po:  new Set(config.poStatuses ?? []),
    };

    const allEmpty = [roles.dev, roles.qa, roles.po].every((s) => s.size === 0);
    if (allEmpty) {
      console.warn("  ⚠ stage-throughput-gap : aucun rôle configuré dans board.yaml");
      return { byWeek: [], avgNetByRole: { dev: 0, qa: 0, po: 0 } };
    }

    const { excludeSql, excludeArgs } = buildExcludeIssueTypesFragment(config.excludeIssueTypes);
    const cutoffSql = config.cutoffDate ? "AND t.transitioned_at >= ?" : "";
    const cutoffArgs = config.cutoffDate ? [config.cutoffDate] : [];
    const endSql = config.windowEndDate ? "AND t.transitioned_at <= ?" : "";
    const endArgs = config.windowEndDate ? [config.windowEndDate] : [];

    // Toutes transitions de la période, ordonnées par issue + date
    const rows = db.prepare(`
      SELECT t.issue_key, t.to_status, t.transitioned_at
      FROM transitions t
      JOIN issues i ON i.key = t.issue_key
      WHERE 1=1 ${excludeSql} ${cutoffSql} ${endSql}
      ORDER BY t.issue_key ASC, t.transitioned_at ASC, t.id ASC
    `).all(...excludeArgs, ...cutoffArgs, ...endArgs) as {
      issue_key: string; to_status: string; transitioned_at: string;
    }[];

    // Grouper par issue
    const byIssue = new Map<string, { to_status: string; transitioned_at: string }[]>();
    for (const r of rows) {
      let list = byIssue.get(r.issue_key);
      if (!list) { list = []; byIssue.set(r.issue_key, list); }
      list.push({ to_status: r.to_status, transitioned_at: r.transitioned_at });
    }

    type RoleKey = "dev" | "qa" | "po";
    const weekMap = new Map<string, Record<`${RoleKey}In` | `${RoleKey}Out`, number>>();

    const getWeekEntry = (week: string) => {
      let e = weekMap.get(week);
      if (!e) {
        e = { devIn: 0, devOut: 0, qaIn: 0, qaOut: 0, poIn: 0, poOut: 0 };
        weekMap.set(week, e);
      }
      return e;
    };

    const getRole = (status: string): RoleKey | null => {
      if (roles.dev.has(status)) return "dev";
      if (roles.qa.has(status))  return "qa";
      if (roles.po.has(status))  return "po";
      return null;
    };

    for (const transitions of byIssue.values()) {
      let prevRole: RoleKey | null = null;
      for (const t of transitions) {
        const curRole = getRole(t.to_status);
        if (curRole !== prevRole) {
          const week = isoWeek(t.transitioned_at);
          if (prevRole !== null) {
            // sortie de prevRole
            getWeekEntry(week)[`${prevRole}Out`]++;
          }
          if (curRole !== null) {
            // entrée dans curRole
            getWeekEntry(week)[`${curRole}In`]++;
          }
          prevRole = curRole;
        }
      }
    }

    const byWeek: StageWeekRow[] = Array.from(weekMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([week, e]) => ({
        week,
        devIn: e.devIn, devOut: e.devOut, devNet: e.devIn - e.devOut,
        qaIn:  e.qaIn,  qaOut:  e.qaOut,  qaNet:  e.qaIn  - e.qaOut,
        poIn:  e.poIn,  poOut:  e.poOut,  poNet:  e.poIn  - e.poOut,
      }));

    const n = byWeek.length;
    const avgNetByRole = n === 0
      ? { dev: 0, qa: 0, po: 0 }
      : {
          dev: byWeek.reduce((s, w) => s + w.devNet, 0) / n,
          qa:  byWeek.reduce((s, w) => s + w.qaNet,  0) / n,
          po:  byWeek.reduce((s, w) => s + w.poNet,  0) / n,
        };

    return { byWeek, avgNetByRole };
  },
};
```

`isoWeek()` : réutiliser la fonction identique de `devTimeAllocation.ts` (déplacer en export
dans `utils.ts` ou dupliquer localement selon arbitrage du développeur).

---

## 2. `src/snapshots/compute.ts` — `extractStats()`

```typescript
} else if ("avgNetByRole" in result) {
  const r = result as unknown as StageThroughputGapResult;
  for (const role of ["dev", "qa", "po"] as const) {
    const netKey = `${role}Net` as const;
    const inKey  = `${role}In`  as const;
    const outKey = `${role}Out` as const;
    const totalIn  = r.byWeek.reduce((s, w) => s + w[inKey],  0);
    const totalOut = r.byWeek.reduce((s, w) => s + w[outKey], 0);
    out.push({ snapshot_date: date, metric_name: metricName, bucket: role, stat: "in",     value: totalIn });
    out.push({ snapshot_date: date, metric_name: metricName, bucket: role, stat: "out",    value: totalOut });
    out.push({ snapshot_date: date, metric_name: metricName, bucket: role, stat: "avgNet", value: r.avgNetByRole[role] });
  }
}
```

`stage-throughput-gap` utilise la fenêtre 30-day rolling (dans `WEEKLY_METRICS` non — dans
`ROLLING_WINDOW_DAYS` oui). Pas de `CUMULATIVE_METRICS`. Comportement par défaut de
`computeSnapshot` — aucune configuration supplémentaire nécessaire.

---

## Ordre d'implémentation

1. Tests TDD pour `stageThroughputGapMetric.compute()` — cas entrée, sortie, rework, rôle vide
2. Implémenter `stageThroughputGap.ts`
3. Enregistrer dans `index.ts`
4. Branch `extractStats` dans `compute.ts`
