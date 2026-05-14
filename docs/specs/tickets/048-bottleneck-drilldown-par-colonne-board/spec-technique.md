# Spec technique — Bottleneck drill-down par colonne board

## Impact fichiers

| Fichier | Modification |
|---|---|
| `src/metrics/types.ts` | Ajouter `statusToColumnName?: Record<string, string>` dans `MetricConfig` |
| `src/main.ts` | Construire et injecter `statusToColumnName` dans `buildMetricConfig()` |
| `src/metrics/bottleneckAnalysis.ts` | Renommer `ColumnStat.status` → `ColumnStat.column`, grouper `columnDays` par colonne |
| `src/report/generate.ts` | Utiliser `c.column` dans `buildColumnDrilldownHtml()` |
| `tests/metrics/bottleneckAnalysis.test.ts` | Passer `statusToColumnName` dans les fixtures, vérifier `byColumn[].column` |

---

## 1. `src/metrics/types.ts` — nouveau champ `MetricConfig`

```typescript
export interface MetricConfig {
  // … champs existants …
  estimation: EstimationConfig;
  // Mapping statut Jira → nom de colonne board.yaml.
  // Construit par buildMetricConfig() depuis board.columns.
  // Absent si board.yaml ne définit pas de colonnes (cas tests unitaires sans board).
  statusToColumnName?: Record<string, string>;
}
```

---

## 2. `src/main.ts` — `buildMetricConfig()` (ligne 194)

Ajouter la construction du mapping juste avant le `return` :

```typescript
// Construit le mapping statut → nom de colonne pour bottleneck drill-down
const statusToColumnName: Record<string, string> = {};
for (const col of app.board.columns) {
  const allStatuses = [...col.statuses, ...(col.legacyStatuses ?? [])];
  for (const s of allStatuses) {
    statusToColumnName[s] = col.name;
  }
}

return {
  // … champs existants …
  statusToColumnName,
};
```

---

## 3. `src/metrics/bottleneckAnalysis.ts`

### 3a. Interface `ColumnStat` (ligne 33)

```typescript
export interface ColumnStat {
  column: string;   // nom de colonne board.yaml (était: status = statut Jira)
  role: RoleKey;
  medianDays: number;
  count: number;
}
```

### 3b. `compute()` — accumulation `columnDays` (ligne 238 environ)

Remplacer la clé `t.to_status` par le nom de colonne :

```typescript
if (cur !== null) {
  const start = t.transitioned_at;
  const end = i + 1 < transitions.length ? transitions[i + 1].transitioned_at : done_at;
  if (end > start) {
    const days = workingDaysBetween(start, end);
    const colName = config.statusToColumnName?.[t.to_status] ?? t.to_status;
    let arr = columnDays.get(colName);
    if (!arr) { arr = []; columnDays.set(colName, arr); }
    arr.push(days);
  }
}
```

### 3c. `compute()` — construction `byColumn` (lignes 296–311)

Itérer sur les colonnes board **par rôle** en dédupliquant :

```typescript
const roleStatuses: { role: RoleKey; statuses: string[] }[] = [
  { role: "dev", statuses: roles.devStatuses },
  { role: "qa",  statuses: roles.qaStatuses  },
  { role: "po",  statuses: roles.poStatuses  },
];
const byColumn: ColumnStat[] = [];
for (const { role, statuses } of roleStatuses) {
  // Collecter les noms de colonnes distincts pour ce rôle (ordre de première occurrence)
  const seen = new Set<string>();
  const colNames: string[] = [];
  for (const s of statuses) {
    const name = config.statusToColumnName?.[s] ?? s;
    if (!seen.has(name)) { seen.add(name); colNames.push(name); }
  }
  const cols: ColumnStat[] = [];
  for (const colName of colNames) {
    const days = columnDays.get(colName);
    if (!days || days.length === 0) { continue; }
    cols.push({ column: colName, role, medianDays: statsFromDays(days, false).medianDays, count: days.length });
  }
  cols.sort((a, b) => b.medianDays - a.medianDays || a.column.localeCompare(b.column));
  byColumn.push(...cols);
}
```

### 3d. `dominantColumn` (lignes 313–318)

```typescript
const dominantColumns: Record<RoleKey, string | null> = { dev: null, qa: null, po: null };
for (const c of byColumn) {
  if (dominantColumns[c.role] !== null) { continue; }
  dominantColumns[c.role] = c.column;   // était: c.status
}
```

---

## 4. `src/report/generate.ts` — `buildColumnDrilldownHtml()` (ligne 657 environ)

```typescript
const rows = b.byColumn.map((c) => {
  const pct = maxMedian > 0 ? Math.max(1, Math.round((c.medianDays / maxMedian) * 100)) : 1;
  const color = ROLE_CSS_COLOR[c.role];
  return `<div class="bn-row">
      <span class="bn-label">${escapeHtml(c.column)} <span class="bn-rank">${escapeHtml(c.role.toUpperCase())}</span></span>
      …
    </div>`;
});
```

Seul changement : `c.status` → `c.column`.

---

## Ordre d'implémentation

1. `src/metrics/types.ts` — ajouter `statusToColumnName` dans `MetricConfig`
2. `src/main.ts` — construire et injecter le mapping dans `buildMetricConfig()`
3. `src/metrics/bottleneckAnalysis.ts` — renommer `ColumnStat.status`, grouper par colonne
4. `src/report/generate.ts` — `c.status` → `c.column`
5. `tests/metrics/bottleneckAnalysis.test.ts` — passer `statusToColumnName` dans les fixtures,
   assertions sur `byColumn[].column` et `dominantColumn`
