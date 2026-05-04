# Spec technique — Time-in-status infra

## Impact fichiers

| Fichier | Modification |
|---|---|
| `src/metrics/types.ts` | Ajouter `devStatuses?`, `qaStatuses?`, `poStatuses?` à `MetricConfig` |
| `src/main.ts` | Propager les groupes role de `DerivedStatusConfig` dans `buildMetricConfig()` |
| `src/metrics/utils.ts` | Ajouter `TransitionRow`, `RoleStatuses`, `fetchDeliveredTransitions()`, `groupByIssue()`, `computeRoleDays()` |

---

## 1. `src/metrics/types.ts` — Extension de `MetricConfig`

```typescript
export interface MetricConfig {
  todoStatuses: string[];
  devStartStatuses: string[];
  inProgressStatuses: string[];
  doneStatuses: string[];
  activeStatuses?: string[];
  queueStatuses?: string[];
  devStatuses?: string[];   // ← ajout : colonnes role: dev
  qaStatuses?: string[];    // ← ajout : colonnes role: qa
  poStatuses?: string[];    // ← ajout : colonnes role: po
  cutoffDate?: string;
  windowEndDate?: string;
  excludeOutliers?: boolean;
  bugIssueTypes: string[];
  excludeIssueTypes: string[];
}
```

---

## 2. `src/main.ts` — `buildMetricConfig()` (ligne 145)

Ajouter les trois groupes role dans le retour, en lisant `derived` (retour de
`deriveStatusConfig` qui expose `devStatuses/qaStatuses/poStatuses` après ticket 019) :

```typescript
return {
  todoStatuses: derived.todoStatuses,
  devStartStatuses: derived.devStartStatuses,
  inProgressStatuses: stripped.inProgress,
  doneStatuses: [...doneSet],
  activeStatuses: stripped.active,
  queueStatuses: stripped.queue,
  devStatuses: derived.devStatuses,   // ← ajout
  qaStatuses: derived.qaStatuses,     // ← ajout
  poStatuses: derived.poStatuses,     // ← ajout
  cutoffDate: app.metrics?.cutoffDate,
  excludeOutliers: opts.excludeOutliers !== false,
  bugIssueTypes: app.metrics?.bugIssueTypes ?? ["Bug"],
  excludeIssueTypes: app.metrics?.excludeIssueTypes ?? [],
};
```

---

## 3. `src/metrics/utils.ts` — Nouveaux exports

### Type `TransitionRow`

```typescript
export interface TransitionRow {
  key: string;
  done_at: string;
  started_at: string;
  to_status: string;
  transitioned_at: string;
}
```

### Type `RoleStatuses`

```typescript
export interface RoleStatuses {
  devStatuses: string[];
  qaStatuses: string[];
  poStatuses: string[];
}
```

### `fetchDeliveredTransitions(db, config)`

Calquée sur la requête de `flowEfficiency.ts` (lignes 48–73) — même population, mêmes
filtres, même ORDER BY. Factorisation de ce pattern répété :

```typescript
export function fetchDeliveredTransitions(
  db: Database.Database,
  config: MetricConfig,
): TransitionRow[] {
  const todoPh = placeholders(config.todoStatuses);
  const devStartPh = placeholders(config.devStartStatuses);
  const delivered = buildDeliveredCte(config.doneStatuses);
  const { cutoffSql, cutoffArgs, endSql, endArgs } = buildWindowFragment(
    config.cutoffDate, config.windowEndDate,
  );
  const { excludeSql, excludeArgs } = buildExcludeIssueTypesFragment(
    config.excludeIssueTypes,
  );

  return db.prepare(`
    WITH ${delivered.cte},
    eligible AS (
      SELECT i.key, d.done_at, MIN(t.transitioned_at) AS started_at
      FROM transitions t
      JOIN issues i ON i.key = t.issue_key
      JOIN delivered d ON d.issue_key = t.issue_key
      WHERE t.to_status IN (${devStartPh})
        ${excludeSql} ${cutoffSql} ${endSql}
        AND EXISTS (
          SELECT 1 FROM transitions t2
          WHERE t2.issue_key = t.issue_key
            AND t2.to_status IN (${todoPh})
        )
      GROUP BY i.key, d.done_at
    )
    SELECT e.key, e.done_at, e.started_at, tr.to_status, tr.transitioned_at
    FROM eligible e
    JOIN transitions tr ON tr.issue_key = e.key
      AND tr.transitioned_at >= e.started_at
      AND tr.transitioned_at <= e.done_at
    ORDER BY e.key ASC, tr.transitioned_at ASC, tr.id ASC
  `).all(
    ...delivered.args,
    ...config.devStartStatuses,
    ...excludeArgs,
    ...cutoffArgs,
    ...endArgs,
    ...config.todoStatuses,
  ) as TransitionRow[];
}
```

### `groupByIssue(rows)`

```typescript
export function groupByIssue(rows: TransitionRow[]): Map<string, TransitionRow[]> {
  const map = new Map<string, TransitionRow[]>();
  for (const row of rows) {
    let list = map.get(row.key);
    if (!list) {
      list = [];
      map.set(row.key, list);
    }
    list.push(row);
  }
  return map;
}
```

### `computeRoleDays(transitions, done_at, roles)`

```typescript
export function computeRoleDays(
  transitions: TransitionRow[],
  done_at: string,
  roles: RoleStatuses,
): { devDays: number; qaDays: number; poDays: number } {
  let devDays = 0;
  let qaDays = 0;
  let poDays = 0;

  for (let i = 0; i < transitions.length; i++) {
    const start = transitions[i].transitioned_at;
    const end = i + 1 < transitions.length
      ? transitions[i + 1].transitioned_at
      : done_at;
    if (new Date(end).getTime() <= new Date(start).getTime()) {continue;}
    const days = workingDaysBetween(start, end);
    const status = transitions[i].to_status;
    if (roles.devStatuses.includes(status)) {devDays += days;}
    else if (roles.qaStatuses.includes(status)) {qaDays += days;}
    else if (roles.poStatuses.includes(status)) {poDays += days;}
  }

  return { devDays, qaDays, poDays };
}
```

---

## Ordre d'implémentation

1. Étendre `MetricConfig` dans `src/metrics/types.ts` (TypeScript force la complétude dans `buildMetricConfig`)
2. Propager les groupes dans `buildMetricConfig()` dans `src/main.ts`
3. Ajouter `TransitionRow`, `RoleStatuses`, `fetchDeliveredTransitions()`, `groupByIssue()`, `computeRoleDays()` dans `src/metrics/utils.ts`
4. Écrire les tests TDD pour les trois fonctions utilitaires

## Notes

`fetchDeliveredTransitions` factorisant le cœur de `flowEfficiency.ts`, une refactorisation
de `flowEfficiency.ts` pour consommer ce nouvel utilitaire est envisageable mais hors scope
de ce ticket (pas de changement de comportement observable → optionnel).
