# Spec technique — Throughput pondéré adapté à la méthode d'estimation

## Impact fichiers

| Fichier | Modification |
|---|---|
| `src/metrics/throughputWeighted.ts` | SQL conditionnel + champs `unit` + `disabled` |
| `src/main.ts` | Affichage CLI adapté à `unit` et `disabled` |
| `board.example.yaml` | Documentation section `metrics.estimation` complète |

---

## 1. `src/metrics/throughputWeighted.ts`

### Dérivation du champ et de l'unité

```typescript
type WeightedConfig =
  | { disabled: true }
  | { disabled: false; col: "original_estimate_seconds" | "story_points"; unit: "j-h" | "SP" | "pts" };

function resolveWeightedConfig(
  method: EstimationMethod,
): WeightedConfig {
  if (method === "t-shirt" || method === "none") return { disabled: true };
  if (method === "time")          return { disabled: false, col: "original_estimate_seconds", unit: "j-h" };
  if (method === "story-points")  return { disabled: false, col: "story_points", unit: "SP" };
  /* "numeric" */                 return { disabled: false, col: "story_points", unit: "pts" };
}
```

### Interface (lignes 5-15)

```typescript
export interface ThroughputWeightedByWeek {
  week: string;
  estimatedDays: number;      // j-h pour "time", valeur brute pour SP/pts
  estimatedCount: number;
  unestimatedCount: number;
}

export interface ThroughputWeightedSummary {
  byWeek: ThroughputWeightedByWeek[];
  avgPerWeek: number;
  unit: "j-h" | "SP" | "pts";
  disabled: boolean;
}
```

### `compute()` — logique conditionnelle

```typescript
compute(db, config): ThroughputWeightedSummary {
  const wcfg = resolveWeightedConfig(config.estimation.method);

  if (wcfg.disabled) {
    return { byWeek: [], avgPerWeek: 0, unit: "j-h", disabled: true };
  }

  const { col, unit } = wcfg;
  const isNull = `(i.${col} IS NULL OR i.${col} <= 0)`;
  const isPos  = `(i.${col} > 0)`;

  const delivered = buildDeliveredCte(config.doneStatuses);
  const { cutoffSql, cutoffArgs, endSql, endArgs } = buildWindowFragment(config.cutoffDate, config.windowEndDate);
  const { bugSql, bugArgs } = buildBugExclusionFragment(config.bugIssueTypes);
  const { excludeSql, excludeArgs } = buildExcludeIssueTypesFragment(config.excludeIssueTypes);

  const rows = db.prepare(`
    WITH ${delivered.cte}
    SELECT
      strftime('%Y-W%W', substr(d.done_at, 1, 10)) AS week,
      SUM(CASE WHEN ${isPos} THEN i.${col} ELSE 0 END) AS total_value,
      SUM(CASE WHEN ${isPos} THEN 1 ELSE 0 END)        AS estimated_count,
      SUM(CASE WHEN ${isNull} THEN 1 ELSE 0 END)        AS unestimated_count
    FROM delivered d
    JOIN issues i ON i.key = d.issue_key
    WHERE 1=1 ${excludeSql} ${bugSql} ${cutoffSql} ${endSql}
    GROUP BY week
    ORDER BY week ASC
  `).all(...delivered.args, ...excludeArgs, ...bugArgs, ...cutoffArgs, ...endArgs) as {
    week: string; total_value: number; estimated_count: number; unestimated_count: number;
  }[];

  const divisor = col === "original_estimate_seconds" ? SECONDS_PER_DAY : 1;
  const byWeek = rows.map((r) => ({
    week: r.week,
    estimatedDays: r.total_value / divisor,
    estimatedCount: r.estimated_count,
    unestimatedCount: r.unestimated_count,
  }));

  const total = byWeek.reduce((s, w) => s + w.estimatedDays, 0);
  return {
    byWeek,
    avgPerWeek: byWeek.length > 0 ? total / byWeek.length : 0,
    unit,
    disabled: false,
  };
}
```

---

## 2. `src/main.ts`

Affichage CLI (autour de la ligne 688) :

```typescript
} else if ("byWeek" in d && metric.name === "throughput-weighted") {
  const tw = d as ThroughputWeightedSummary;
  if (tw.disabled) {
    console.log(`  throughput-weighted : désactivé (méthode : ${config.estimation.method})`);
  } else {
    const unit = tw.unit;
    console.log(`  Moy/semaine : ${tw.avgPerWeek.toFixed(1)} ${unit}/semaine`);
    tw.byWeek.slice(-8).forEach((w) => {
      console.log(`  ${w.week} : ${w.estimatedDays.toFixed(1)} ${unit} (${w.estimatedCount} estimées, ${w.unestimatedCount} non estimées)`);
    });
  }
}
```

---

## 3. `board.example.yaml`

Ajouter après `bugIssueTypes` :

```yaml
  # Méthode d'estimation de l'équipe.
  # Détermine les métriques by-size et throughput-weighted.
  # Pas de weightField — dérivé automatiquement depuis method.
  #
  # --- Time estimate (défaut) ---
  # estimation:
  #   method: "time"
  #   bucketThresholds: { xs: 0.5, s: 1, m: 3, l: 5 }   # jours ouvrés
  #
  # --- Story points (champ Atlassian standard customfield_10016) ---
  # estimation:
  #   method: "story-points"
  #   bucketThresholds: { xs: 1, s: 3, m: 8, l: 13 }
  #
  # --- Complexity / Fibonacci / champ numérique custom ---
  # estimation:
  #   method: "numeric"
  #   jiraField: "customfield_10099"    # obligatoire
  #   bucketThresholds: { xs: 2, s: 5, m: 10, l: 20 }    # obligatoire
  #
  # --- Taille de t-shirt (valeurs XS/S/M/L/XL) ---
  # estimation:
  #   method: "t-shirt"
  #   jiraField: "customfield_10200"    # obligatoire
  #   # throughput-weighted désactivé automatiquement
  #
  # --- No estimate ---
  # estimation:
  #   method: "none"
  #   # by-size et throughput-weighted désactivés automatiquement
```

---

## Ordre d'implémentation

1. `throughputWeighted.ts` — `resolveWeightedConfig()` + interface + `compute()`
2. `main.ts` — affichage CLI adapté
3. `board.example.yaml` — documentation
