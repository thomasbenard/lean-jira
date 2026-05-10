# Spec technique — Bottleneck analysis drill-down colonne

## Impact fichiers

| Fichier | Modification |
|---|---|
| `src/metrics/bottleneckAnalysis.ts` | Ajouter `dominantColumn` + `primaryColumn` au résultat |
| `src/report/generate.ts` | Afficher `primaryColumn` dans `buildBottleneckPanelHtml` |
| `tests/metrics/bottleneckAnalysis.test.ts` | 3-4 scénarios nouveaux |

---

## 1. `src/metrics/bottleneckAnalysis.ts`

### Nouveaux types (lignes ~17-36)

```typescript
export interface RoleBottleneckScore {
  score: number;
  rank: number;
  dominantSignal: BottleneckSignal;
  dominantColumn: string | null;   // ← nouveau
  signals: RoleSignals;
}

export interface BottleneckAnalysisResult {
  count: number;
  primaryBottleneck: RoleKey | null;
  primaryColumn: string | null;    // ← nouveau
  recommendation: string;
  byRole: Record<RoleKey, RoleBottleneckScore>;
}
```

### `emptyScore()` (ligne ~77)

```typescript
function emptyScore(): RoleBottleneckScore {
  return {
    score: 0, rank: 3, dominantSignal: "combined",
    dominantColumn: null,
    signals: { stageTimeMedianDays: 0, avgNetFlow: 0, reworkInboundRate: 0, ftrPenalty: 0 },
  };
}
```

### `emptyResult()` (ligne ~86)

```typescript
function emptyResult(): BottleneckAnalysisResult {
  return {
    count: 0, primaryBottleneck: null, primaryColumn: null, recommendation: "",
    byRole: { dev: emptyScore(), qa: emptyScore(), po: emptyScore() },
  };
}
```

### Boucle principale dans `compute()` (après `stageTimeDays` / avant `statsFromDays`)

Ajouter un accumulateur `columnDays: Map<string, number[]>` alimenté dans la même boucle
`for (const [, transitions] of byIssue)` qui calcule déjà `stageTimeDays` :

```typescript
const columnDays = new Map<string, number[]>();

for (const [, transitions] of byIssue) {
  const done_at = transitions[0].done_at;

  // ── calcul existant (stageTimeDays, rework, ftr) ──
  // ...

  // ── nouveau : temps par colonne individuelle ──
  for (let i = 0; i < transitions.length; i++) {
    const status = transitions[i].to_status;
    if (getRole(status) === null) { continue; }   // ignorer statuts hors-rôle
    const start = transitions[i].transitioned_at;
    const end = i + 1 < transitions.length
      ? transitions[i + 1].transitioned_at
      : done_at;
    if (end <= start) { continue; }
    const days = workingDaysBetween(start, end);
    let arr = columnDays.get(status);
    if (!arr) { arr = []; columnDays.set(status, arr); }
    arr.push(days);
  }
}
```

`workingDaysBetween` est déjà importé via `computeRoleDays` dans utils ; l'importer
explicitement en tête de fichier si pas encore présent.

### Calcul de `dominantColumn` par rôle (après `stageTimeMedian`)

```typescript
function dominantColumnForRole(
  statuses: string[],
  columnDays: Map<string, number[]>,
): string | null {
  let best: string | null = null;
  let bestMedian = -1;
  for (const status of statuses) {
    const days = columnDays.get(status);
    if (!days || days.length === 0) { continue; }
    const median = statsFromDays(days, false).medianDays;
    if (median > bestMedian || (median === bestMedian && best !== null && status < best)) {
      best = status;
      bestMedian = median;
    }
  }
  return best;
}
```

Appel dans `compute()` (après calcul des rangs, avant construction `byRole`) :

```typescript
const dominantColumns: Record<RoleKey, string | null> = {
  dev: dominantColumnForRole(roles.devStatuses, columnDays),
  qa:  dominantColumnForRole(roles.qaStatuses,  columnDays),
  po:  dominantColumnForRole(roles.poStatuses,  columnDays),
};
```

Ajouter `dominantColumn: dominantColumns[role]` dans la construction de chaque `RoleBottleneckScore`.

### Valeur `primaryColumn` dans le `return`

```typescript
const primaryColumn = primaryBottleneck !== null
  ? dominantColumns[primaryBottleneck]
  : null;

return { count, primaryBottleneck, primaryColumn, recommendation, byRole };
```

---

## 2. `src/report/generate.ts`

### `buildBottleneckPanelHtml` (ligne ~1630)

Remplacer la ligne du badge rôle primaire :

```typescript
// avant
`<span class="${badgeCls}">${escapeHtml(primary.toUpperCase())}</span> — ${escapeHtml(b.recommendation)}`

// après
const colLabel = b.primaryColumn ? ` (${escapeHtml(b.primaryColumn)})` : "";
`<span class="${badgeCls}">${escapeHtml(primary.toUpperCase())}${colLabel}</span> — ${escapeHtml(b.recommendation)}`
```

---

## 3. `tests/metrics/bottleneckAnalysis.test.ts`

### Scénarios à ajouter (dans `describe("bottleneckAnalysisMetric.compute")`)

```
it("dominantColumn identifie le statut le plus lent dans le rôle dev")
  Given: 1 issue avec 7j en "In Progress" + 1j en "Code Review" (les deux dans devStatuses)
  Then: byRole.dev.dominantColumn === "In Progress"

it("dominantColumn null si le rôle n'apparaît dans aucune transition")
  Given: ROLE_CONFIG avec poStatuses = ["Validation PO"] mais aucune transition vers ce statut
  Then: byRole.po.dominantColumn === null

it("primaryColumn = dominantColumn du rôle primaire")
  Given: issue avec dev bottleneck, dominantColumn dev = "In Progress"
  Then: result.primaryColumn === "In Progress"

it("tiebreak alphabétique si deux colonnes ont même médiane")
  Given: 2 colonnes dev avec médiane identique "Code Review" et "In Progress"
  Then: byRole.dev.dominantColumn === "Code Review"  (alphabétiquement avant "In Progress")
```

---

## Ordre d'implémentation

1. Mettre à jour types (`RoleBottleneckScore`, `BottleneckAnalysisResult`)
2. Mettre à jour `emptyScore` / `emptyResult`
3. Écrire tests red (4 scénarios)
4. Ajouter import `workingDaysBetween` si absent
5. Ajouter boucle `columnDays` dans la boucle issue existante
6. Écrire `dominantColumnForRole`
7. Câbler `dominantColumns` + `primaryColumn` dans `compute()`
8. Mettre à jour `buildBottleneckPanelHtml` dans `generate.ts`
9. Mettre à jour fixtures test `generate.test.ts` / `personalization.test.ts` (champs nouveaux)
