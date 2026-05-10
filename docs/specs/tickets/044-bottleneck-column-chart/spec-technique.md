# Spec technique — Bottleneck column chart

## Impact fichiers

| Fichier | Modification |
|---|---|
| `src/metrics/bottleneckAnalysis.ts` | Ajouter interface `ColumnStat`, champ `byColumn` dans `BottleneckAnalysisResult`, alimentation depuis `columnDays` en fin de `compute()` |
| `src/report/generate.ts` | Ajouter `buildColumnDrilldownHtml()`, l'injecter après `buildBottleneckPanelHtml()` dans l'onglet Rôles, mettre à jour `RenderInput.bottleneck` si nécessaire |
| `tests/metrics/bottleneckAnalysis.test.ts` | Tests sur `byColumn` (contenu, tri, cas vide) |
| `tests/report/generate.test.ts` | Mettre à jour fixture `bottleneck` + tests de rendu |
| `tests/report/personalization.test.ts` | Mettre à jour fixture `bottleneck` |
| `tests/e2e/__snapshots__/fake-pipeline.test.ts.snap` | Mise à jour snapshot golden |

---

## 1. `src/metrics/bottleneckAnalysis.ts`

### Nouvelle interface

```typescript
export interface ColumnStat {
  status: string;
  role: RoleKey;
  medianDays: number;
  count: number;
}
```

### Ajout dans `BottleneckAnalysisResult`

```typescript
export interface BottleneckAnalysisResult {
  count: number;
  primaryBottleneck: RoleKey | null;
  primaryColumn: string | null;
  recommendation: string;
  byRole: Record<RoleKey, RoleBottleneckScore>;
  byColumn: ColumnStat[];   // ← nouveau
}
```

### Mise à jour `emptyResult()`

```typescript
function emptyResult(): BottleneckAnalysisResult {
  return {
    count: 0,
    primaryBottleneck: null,
    primaryColumn: null,
    recommendation: "",
    byRole: { dev: emptyScore(), qa: emptyScore(), po: emptyScore() },
    byColumn: [],   // ← nouveau
  };
}
```

### Alimentation dans `compute()` — après le calcul de `dominantColumns`

```typescript
const roleStatuses: { role: RoleKey; statuses: string[] }[] = [
  { role: "dev", statuses: roles.devStatuses },
  { role: "qa",  statuses: roles.qaStatuses  },
  { role: "po",  statuses: roles.poStatuses  },
];

const byColumn: ColumnStat[] = [];
for (const { role, statuses } of roleStatuses) {
  const cols: ColumnStat[] = [];
  for (const status of statuses) {
    const days = columnDays.get(status);
    if (!days || days.length === 0) {continue;}
    cols.push({
      status,
      role,
      medianDays: statsFromDays(days, false).medianDays,
      count: days.length,
    });
  }
  cols.sort((a, b) => b.medianDays - a.medianDays || a.status.localeCompare(b.status));
  byColumn.push(...cols);
}
```

### Retour

```typescript
return { count, primaryBottleneck, primaryColumn, recommendation, byRole, byColumn };
```

---

## 2. `src/report/generate.ts`

### Nouvelle fonction `buildColumnDrilldownHtml()`

À placer juste après `buildBottleneckPanelHtml()` :

```typescript
function buildColumnDrilldownHtml(b: BottleneckAnalysisResult): string {
  if (b.byColumn.length === 0) {return "";}
  const maxMedian = Math.max(...b.byColumn.map((c) => c.medianDays));
  const ROLE_COLOR: Record<RoleKey, string> = {
    dev: "var(--violet)",
    qa:  "var(--green)",
    po:  "var(--orange)",
  };
  const rows = b.byColumn.map((c) => {
    const pct = maxMedian > 0 ? Math.max(1, Math.round((c.medianDays / maxMedian) * 100)) : 1;
    const color = ROLE_COLOR[c.role];
    return `<div class="bn-row">
        <span class="bn-label">${escapeHtml(c.status)} <span class="bn-rank">${escapeHtml(c.role.toUpperCase())}</span></span>
        <div class="bn-bar-bg"><div class="bn-bar-fill" style="width:${pct}%;background:${color}"></div></div>
        <span class="bn-pct mono">${c.medianDays.toFixed(1)}j <span class="bn-rank">(${c.count})</span></span>
      </div>`;
  }).join("");
  return `<div class="chart-card wide">
    <h3>Drill-down par colonne${helpBtn("bottleneckAnalysis")}</h3>
    <div class="bn-bars">${rows}</div>
  </div>`;
}
```

### Injection dans l'onglet Rôles

Dans le template HTML de `renderHtml()`, après `${buildBottleneckPanelHtml(input.bottleneck)}` :

```typescript
${buildBottleneckPanelHtml(input.bottleneck)}
${buildColumnDrilldownHtml(input.bottleneck)}
<div class="panel-grid">
```

---

## Ordre d'implémentation

1. Ajouter `ColumnStat` + `byColumn` dans `bottleneckAnalysis.ts` (interface + emptyResult + compute)
2. Tests métriques : `byColumn` contenu, tri, cas vide, rôle non configuré
3. `buildColumnDrilldownHtml()` dans `generate.ts` + injection template
4. Tests report : fixture mise à jour + rendu HTML
5. Snapshot golden mis à jour (`npx vitest run tests/e2e -u`)
