# Spec technique — Handoff Rework Detection

## Impact fichiers

| Fichier | Modification |
|---|---|
| `src/metrics/handoffRework.ts` | Nouveau fichier |
| `src/metrics/index.ts` | Import + push dans `ALL_METRICS` |
| `src/snapshots/compute.ts` | Branch `"reworkRatio" in result` dans `extractStats()` |

---

## 1. `src/metrics/handoffRework.ts`

### Types

```typescript
export type ReworkType = "qaToDev" | "poToQa" | "poDev";

export interface ReworkIssue {
  issueKey: string;
  reworkCount: number;
  reworkTypes: ReworkType[];
}

export interface HandoffReworkResult {
  count: number;
  reworkRatio: number;
  avgReworks: number;
  byReworkType: Record<ReworkType, number>;
  issues: ReworkIssue[];  // tickets avec rework uniquement
}
```

### Algorithme

```typescript
export const handoffReworkMetric: Metric<HandoffReworkResult> = {
  name: "handoff-rework",
  description:
    "Taux de rework entre rôles (qa→dev, po→qa, po→dev) sur tickets livrés. Qualité d'entrée par étape.",

  compute(db: Database.Database, config: MetricConfig): HandoffReworkResult {
    const roles = {
      dev: new Set(config.devStatuses ?? []),
      qa:  new Set(config.qaStatuses ?? []),
      po:  new Set(config.poStatuses ?? []),
    };

    // Ordre naturel : index plus petit = amont. Rework = transition vers index plus petit.
    const ROLE_ORDER: Record<string, number> = { dev: 0, qa: 1, po: 2 };

    const getRole = (status: string): string | null => {
      if (roles.dev.has(status)) return "dev";
      if (roles.qa.has(status))  return "qa";
      if (roles.po.has(status))  return "po";
      return null;
    };

    const reworkKey = (from: string, to: string): ReworkType | null => {
      if (from === "qa" && to === "dev") return "qaToDev";
      if (from === "po" && to === "qa")  return "poToQa";
      if (from === "po" && to === "dev") return "poDev";
      return null;
    };

    const rows = fetchDeliveredTransitions(db, config);
    const byIssue = groupByIssue(rows);

    const issuesWithRework: ReworkIssue[] = [];
    const byReworkType: Record<ReworkType, number> = { qaToDev: 0, poToQa: 0, poDev: 0 };
    let totalReworks = 0;

    for (const [key, transitions] of byIssue) {
      const reworks: ReworkType[] = [];
      let prevRole: string | null = null;

      for (const t of transitions) {
        const curRole = getRole(t.to_status);
        if (curRole !== null && curRole !== prevRole) {
          if (prevRole !== null) {
            const prevIdx = ROLE_ORDER[prevRole];
            const curIdx  = ROLE_ORDER[curRole];
            if (curIdx < prevIdx) {
              const k = reworkKey(prevRole, curRole);
              if (k) { reworks.push(k); byReworkType[k]++; }
            }
          }
          prevRole = curRole;
        } else if (curRole === null) {
          // statut hors rôle (todo, done, sans role) : reset prévision de rôle actif
          // mais on garde prevRole pour détecter les reworks via none (ex: dev → none → qa → dev)
          // Règle : on ne reset prevRole sur none, pour attraper dev→none→dev comme neutre.
          // prevRole conservé intentionnellement.
        }
      }

      totalReworks += reworks.length;
      if (reworks.length > 0) {
        issuesWithRework.push({ issueKey: key, reworkCount: reworks.length, reworkTypes: reworks });
      }
    }

    const count = byIssue.size;
    return {
      count,
      reworkRatio: count > 0 ? issuesWithRework.length / count : 0,
      avgReworks:  count > 0 ? totalReworks / count : 0,
      byReworkType,
      issues: issuesWithRework.sort((a, b) => b.reworkCount - a.reworkCount),
    };
  },
};
```

**Note sur `dev → none → dev`** : `prevRole` est conservé à travers les transitions `none`.
Un ticket qui passe par un statut sans rôle entre deux passages dev ne compte pas comme
rework (il n'y a jamais eu de transition vers un rôle amont). Seul `qa → [none]* → dev`
compte comme rework qaToDev car le dernier rôle non-null avant dev était qa.

---

## 2. `src/snapshots/compute.ts`

```typescript
} else if ("reworkRatio" in result) {
  const r = result as unknown as HandoffReworkResult;
  out.push({ snapshot_date: date, metric_name: metricName, bucket: "", stat: "count",       value: r.count });
  out.push({ snapshot_date: date, metric_name: metricName, bucket: "", stat: "reworkRatio", value: r.reworkRatio });
  out.push({ snapshot_date: date, metric_name: metricName, bucket: "", stat: "avgReworks",  value: r.avgReworks });
  out.push({ snapshot_date: date, metric_name: metricName, bucket: "qaToDev", stat: "count", value: r.byReworkType.qaToDev });
  out.push({ snapshot_date: date, metric_name: metricName, bucket: "poToQa",  stat: "count", value: r.byReworkType.poToQa });
  out.push({ snapshot_date: date, metric_name: metricName, bucket: "poDev",   stat: "count", value: r.byReworkType.poDev });
}
```

---

## Ordre d'implémentation

1. Tests TDD : 0 rework, 1 rework qa→dev, multiple reworks, rôle non configuré, dev→none→dev neutre
2. Implémenter `handoffRework.ts`
3. Enregistrer dans `index.ts`
4. Branch `extractStats` dans `compute.ts`
