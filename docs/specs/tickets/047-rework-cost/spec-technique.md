# Spec technique — Rework Cost

## Impact fichiers

| Fichier | Modification |
|---|---|
| `src/metrics/reworkCost.ts` | Nouveau fichier — implémente `Metric<ReworkCostResult>` |
| `src/metrics/index.ts` | Import + push dans `ALL_METRICS` |
| `src/snapshots/compute.ts` | Import type + branche `extractStats` sur `totalReworkDays` |

---

## 1. `src/metrics/reworkCost.ts`

### Types

```typescript
export interface ReworkCostByWeek {
  week: string;           // ISO week "2025-W22"
  reworkDays: number;
  reworkedIssues: number;
}

export interface ReworkCostBySprint {
  sprintId: number;
  sprintName: string;
  reworkDays: number;
  reworkedIssues: number;
}

export interface ReworkCostResult {
  count: number;
  reworkedCount: number;
  reworkRatio: number;
  totalReworkDays: number;
  avgReworkDaysPerReworkedTicket: number;
  reworkCostRatio: number;
  byWeek: ReworkCostByWeek[];
  bySprint: ReworkCostBySprint[];
}
```

### Algorithme de détection des blocs rework

Réutilise `fetchDeliveredTransitions(db, config)` + `groupByIssue()` (même appel que `handoffRework` et `firstTimeRight`). Pour chaque issue :

```typescript
type RoleKey = "dev" | "qa" | "po";

interface RoleBlock {
  role: RoleKey;
  startAt: string;
  endAt: string;
  isRework: boolean;
}

function extractReworkBlocks(
  transitions: TransitionRow[],
  done_at: string,
  roles: Record<RoleKey, Set<string>>,
): RoleBlock[] {
  const blocks: RoleBlock[] = [];
  const passCount: Record<RoleKey, number> = { dev: 0, qa: 0, po: 0 };
  let currentRole: RoleKey | null = null;
  let currentBlockStart: string | null = null;
  let currentIsRework = false;

  const getRole = (status: string): RoleKey | null => {
    if (roles.dev.has(status)) return "dev";
    if (roles.qa.has(status)) return "qa";
    if (roles.po.has(status)) return "po";
    return null;
  };

  for (const t of transitions) {
    const role = getRole(t.to_status);
    if (role !== currentRole) {
      // Fermer le bloc courant
      if (currentRole !== null && currentBlockStart !== null) {
        blocks.push({ role: currentRole, startAt: currentBlockStart, endAt: t.transitioned_at, isRework: currentIsRework });
      }
      // Ouvrir le nouveau bloc
      if (role !== null) {
        passCount[role]++;
        currentIsRework = passCount[role] > 1;
        currentRole = role;
        currentBlockStart = t.transitioned_at;
      } else {
        // Statut sans rôle (todoStatuses, queue sans rôle, etc.) : réinitialiser
        currentRole = null;
        currentBlockStart = null;
        currentIsRework = false;
      }
    }
  }
  // Fermer le dernier bloc sur done_at
  if (currentRole !== null && currentBlockStart !== null) {
    blocks.push({ role: currentRole, startAt: currentBlockStart, endAt: done_at, isRework: currentIsRework });
  }
  return blocks;
}
```

**Différence clé vs `handoffRework`** : ici, un statut sans rôle (`getRole = null`) remet `currentRole` à `null`, comme dans `firstTimeRight`. Cela permet de détecter `DEV → Code Review (no-role) → DEV` comme 2 passes distinctes. `handoffRework` préserve `prevRole` au travers des gaps pour détecter les transitions inter-rôles — objectif différent.

### Distribution hebdomadaire

Réutiliser `distributeAcrossWeeks` de `src/metrics/devTimeAllocation.ts` (même signature, même logique cap-5j). Si la fonction n'est pas exportée, la dupliquer dans `reworkCost.ts` avec un commentaire renvoyant vers l'original.

```typescript
// Pour chaque bloc rework d'un ticket :
const days = workingDaysBetween(block.startAt, block.endAt);
if (days <= 0) continue;
for (const [week, alloc] of distributeAcrossWeeks(block.startAt, block.endAt, days)) {
  const entry = byWeekMap.get(week) ?? { reworkDays: 0, issues: new Set<string>() };
  entry.reworkDays += alloc;
  entry.issues.add(issueKey);
  byWeekMap.set(week, entry);
}
```

### Attribution sprint

```typescript
// Chargé une fois avant la boucle issues :
const sprintRows = db.prepare(
  "SELECT id, name, start_date, end_date FROM sprints WHERE start_date IS NOT NULL AND end_date IS NOT NULL"
).all() as { id: number; name: string; start_date: string; end_date: string }[];

// Pour chaque bloc rework :
const matchingSprint = sprintRows.find(
  (s) => block.endAt >= s.start_date && block.endAt <= s.end_date
);
if (matchingSprint) {
  const entry = bySprintMap.get(matchingSprint.id) ?? { sprintId: matchingSprint.id, sprintName: matchingSprint.name, reworkDays: 0, reworkedIssues: new Set<string>() };
  entry.reworkDays += workingDaysBetween(block.startAt, block.endAt);
  entry.reworkedIssues.add(issueKey);
  bySprintMap.set(matchingSprint.id, entry);
}
```

### Calcul `reworkCostRatio`

```typescript
// totalCycleTimeDays = somme des workingDaysBetween(started_at, done_at) pour les tickets reworkés uniquement
// Les started_at / done_at viennent de TransitionRow (fetchDeliveredTransitions les inclut)
const reworkCostRatio = totalCycleTimeDays > 0 ? totalReworkDays / totalCycleTimeDays : 0;
```

---

## 2. `src/metrics/index.ts`

```typescript
import { reworkCostMetric } from "./reworkCost";
// ...
export const ALL_METRICS: Metric<unknown>[] = [
  // ...métriques existantes...
  reworkCostMetric,
];
```

Insérer après `firstTimeRightMetric` (cohérence thématique).

---

## 3. `src/snapshots/compute.ts`

### Import

```typescript
import { type ReworkCostResult } from "../metrics/reworkCost";
```

### Branche `extractStats`

Ajouter **avant** la branche `byWeek` générique (ordre important : discriminateurs spécifiques avant les génériques) :

```typescript
} else if ("totalReworkDays" in result) {
  const r = result as unknown as ReworkCostResult;
  out.push({ snapshot_date: date, metric_name: metricName, bucket: "", stat: "count", value: r.count });
  out.push({ snapshot_date: date, metric_name: metricName, bucket: "", stat: "reworkedCount", value: r.reworkedCount });
  out.push({ snapshot_date: date, metric_name: metricName, bucket: "", stat: "reworkRatio", value: r.reworkRatio });
  out.push({ snapshot_date: date, metric_name: metricName, bucket: "", stat: "totalReworkDays", value: r.totalReworkDays });
  out.push({ snapshot_date: date, metric_name: metricName, bucket: "", stat: "avgReworkDays", value: r.avgReworkDaysPerReworkedTicket });
  out.push({ snapshot_date: date, metric_name: metricName, bucket: "", stat: "reworkCostRatio", value: r.reworkCostRatio });
}
```

### Fenêtre snapshot

`rework-cost` utilise la fenêtre 30 jours glissants (comme `handoff-rework` et `first-time-right`). Aucun ajout à `WEEKLY_METRICS` ni `CUMULATIVE_METRICS` requis — comportement par défaut.

---

## Ordre d'implémentation

1. Écrire `src/metrics/reworkCost.ts` : types + `extractReworkBlocks()` + `reworkCostMetric.compute()` (sans vue sprint dans un premier temps)
2. Enregistrer dans `src/metrics/index.ts`
3. Vérifier `npm run metrics -- -m rework-cost` sur données réelles
4. Ajouter vue sprint dans `compute()` (jointure `sprints`)
5. Ajouter branche `extractStats` dans `src/snapshots/compute.ts`
6. Vérifier `npm run snapshots && npm run metrics -- -m rework-cost --json`
