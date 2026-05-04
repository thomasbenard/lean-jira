# Spec technique — First-Time-Right Rate

## Impact fichiers

| Fichier | Modification |
|---|---|
| `src/metrics/firstTimeRight.ts` | Nouveau fichier |
| `src/metrics/index.ts` | Import + push dans `ALL_METRICS` |
| `src/snapshots/compute.ts` | Branch `"ftrByRole" in result` dans `extractStats()` |

---

## 1. `src/metrics/firstTimeRight.ts`

### Types

```typescript
export interface FtrRoleStats {
  eligible: number;     // tickets ayant ≥ 1 passage dans ce rôle
  firstTimeRight: number; // tickets avec exactement 1 passage
  ftrRate: number;      // firstTimeRight / eligible (NaN si eligible=0)
  avgPasses: number;    // moyenne de passages par ticket éligible
}

export interface FirstTimeRightResult {
  count: number;        // tickets analysés (population cycle-time)
  ftrByRole: {
    dev: FtrRoleStats;
    qa:  FtrRoleStats;
    po:  FtrRoleStats;
  };
}
```

### Algorithme

```typescript
export const firstTimeRightMetric: Metric<FirstTimeRightResult> = {
  name: "first-time-right",
  description:
    "% tickets traversant chaque rôle en un seul passage. FTR QA = qualité d'entrée dev.",

  compute(db: Database.Database, config: MetricConfig): FirstTimeRightResult {
    const roles = {
      dev: new Set(config.devStatuses ?? []),
      qa:  new Set(config.qaStatuses ?? []),
      po:  new Set(config.poStatuses ?? []),
    };

    const getRole = (status: string): "dev" | "qa" | "po" | null => {
      if (roles.dev.has(status)) return "dev";
      if (roles.qa.has(status))  return "qa";
      if (roles.po.has(status))  return "po";
      return null;
    };

    const rows = fetchDeliveredTransitions(db, config);
    const byIssue = groupByIssue(rows);

    // Accumulateurs : passages par rôle par ticket
    type RoleKey = "dev" | "qa" | "po";
    const acc: Record<RoleKey, { eligible: number; ftr: number; totalPasses: number }> = {
      dev: { eligible: 0, ftr: 0, totalPasses: 0 },
      qa:  { eligible: 0, ftr: 0, totalPasses: 0 },
      po:  { eligible: 0, ftr: 0, totalPasses: 0 },
    };

    for (const transitions of byIssue.values()) {
      // Compter les passages par rôle : segment = run contiguë du même rôle
      const passes: Record<RoleKey, number> = { dev: 0, qa: 0, po: 0 };
      let prevRole: RoleKey | null = null;

      for (const t of transitions) {
        const cur = getRole(t.to_status);
        if (cur !== null && cur !== prevRole) {
          passes[cur]++;
          prevRole = cur;
        } else if (cur === null) {
          prevRole = null; // reset : coupure réelle entre deux blocs du même rôle
        }
      }

      for (const role of ["dev", "qa", "po"] as RoleKey[]) {
        if (passes[role] > 0) {
          acc[role].eligible++;
          acc[role].totalPasses += passes[role];
          if (passes[role] === 1) acc[role].ftr++;
        }
      }
    }

    const toStats = (a: typeof acc[RoleKey]): FtrRoleStats => ({
      eligible:       a.eligible,
      firstTimeRight: a.ftr,
      ftrRate:        a.eligible > 0 ? a.ftr / a.eligible : 0,
      avgPasses:      a.eligible > 0 ? a.totalPasses / a.eligible : 0,
    });

    return {
      count: byIssue.size,
      ftrByRole: { dev: toStats(acc.dev), qa: toStats(acc.qa), po: toStats(acc.po) },
    };
  },
};
```

**Note clé** : `prevRole = null` sur statut `none` — un passage par un statut sans rôle
entre deux blocs du même rôle les coupe en deux passages distincts. Cohérent avec la
définition fonctionnelle (coupure réelle = ticket revenu en todo, puis repris).

---

## 2. `src/snapshots/compute.ts`

```typescript
} else if ("ftrByRole" in result) {
  const r = result as unknown as FirstTimeRightResult;
  out.push({ snapshot_date: date, metric_name: metricName, bucket: "", stat: "count", value: r.count });
  for (const role of ["dev", "qa", "po"] as const) {
    const s = r.ftrByRole[role];
    if (s.eligible === 0) {continue;}
    out.push({ snapshot_date: date, metric_name: metricName, bucket: role, stat: "ftrRate",    value: s.ftrRate });
    out.push({ snapshot_date: date, metric_name: metricName, bucket: role, stat: "avgPasses",  value: s.avgPasses });
    out.push({ snapshot_date: date, metric_name: metricName, bucket: role, stat: "eligible",   value: s.eligible });
  }
}
```

---

## Ordre d'implémentation

1. Tests TDD : ticket 1 passage dev, 2 passages qa, rôle vide, statut none entre deux blocs
2. Implémenter `firstTimeRight.ts`
3. Enregistrer dans `index.ts`
4. Branch `extractStats` dans `compute.ts`
