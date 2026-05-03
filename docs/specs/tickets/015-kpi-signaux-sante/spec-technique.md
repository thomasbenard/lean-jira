# Spec technique — KPIs : signaux de santé statiques

## Impact fichiers

| Fichier | Modification |
|---|---|
| `src/main.ts` | Étendre `AppConfig.metrics` + passer `healthThresholds` à `generateReport()` |
| `src/report/generate.ts` | Nouveaux types + helpers eval + CSS + rendu KPI cards |
| `config.example.yaml` | Section `metrics.healthThresholds` avec defaults commentés |
| `config.yaml` | Idem (config de l'utilisateur) |

---

## 1. `src/main.ts`

### Extension de `AppConfig` (ligne ~109)

```typescript
interface AppConfig {
  // ...
  metrics?: {
    cutoffDate?: string;
    bugIssueTypes?: string[];
    healthThresholds?: HealthThresholds;  // nouveau
  };
  db: { path: string };
}
```

Importer `HealthThresholds` depuis `./report/generate` (ou définir dans un fichier partagé —
préférer l'import depuis `generate.ts` pour garder le concern UI groupé).

### Appel à `generateReport()` (ligne ~354)

```typescript
generateReport(
  db,
  config.jira.projectKey,
  config.jira.baseUrl,
  path.resolve(opts.output),
  metricConfig,
  config.metrics?.healthThresholds,  // nouveau paramètre
);
```

---

## 2. `src/report/generate.ts`

### Nouveaux types (en tête du fichier, après les imports)

```typescript
export interface ThresholdPair {
  warn: number;
  crit: number;
}

export interface HealthThresholds {
  leadTimeMedianDays?: ThresholdPair;
  cycleTimeMedianDays?: ThresholdPair;
  throughputWeekly?: ThresholdPair;
  wipCount?: ThresholdPair;
  bugCycleTimeMedianDays?: ThresholdPair;
  bugRatio?: ThresholdPair;
}

type HealthSignal = "green" | "orange" | "red" | "none";
```

### Helpers d'évaluation (fonctions pures exportées pour tests)

```typescript
export function evalLowerBetter(value: number | null, t: ThresholdPair | undefined): HealthSignal {
  if (value === null || t === undefined) return "none";
  if (value <= t.warn) return "green";
  if (value <= t.crit) return "orange";
  return "red";
}

export function evalHigherBetter(value: number | null, t: ThresholdPair | undefined): HealthSignal {
  if (value === null || t === undefined) return "none";
  if (value >= t.warn) return "green";
  if (value >= t.crit) return "orange";
  return "red";
}
```

### Signature de `generateReport()`

```typescript
export function generateReport(
  db: Database.Database,
  projectKey: string,
  jiraBaseUrl: string,
  outputPath: string,
  config: MetricConfig,
  healthThresholds?: HealthThresholds,  // nouveau
): void {
```

### Extension de `RenderInput`

```typescript
interface RenderInput {
  // ... champs existants ...
  healthThresholds?: HealthThresholds;  // nouveau
}
```

Passer `healthThresholds` dans l'objet `renderHtml({ ..., healthThresholds })`.

### CSS à ajouter dans le bloc `<style>`

```css
.health-dot { margin-right: 0.3rem; font-size: 0.75rem; }
.health-green  { color: #10b981; }
.health-orange { color: #f59e0b; }
.health-red    { color: #ef4444; }
```

### Helper de rendu dans `renderHtml()`

```typescript
const dot = (signal: HealthSignal) =>
  signal === "none" ? "" : `<span class="health-dot health-${signal}">●</span>`;

const ht = input.healthThresholds;
const signals = {
  leadTime:    dot(evalLowerBetter(input.kpis.leadTimeMedian,     ht?.leadTimeMedianDays)),
  cycleTime:   dot(evalLowerBetter(input.kpis.cycleTimeMedian,    ht?.cycleTimeMedianDays)),
  throughput:  dot(evalHigherBetter(input.kpis.throughputCount,   ht?.throughputWeekly)),
  wip:         dot(evalLowerBetter(input.kpis.wipCount,           ht?.wipCount)),
  bugCycle:    dot(evalLowerBetter(input.kpis.bugCycleTimeMedian, ht?.bugCycleTimeMedianDays)),
  bugRatio:    dot(evalLowerBetter(input.kpis.devTimeAvgBugRatio, ht?.bugRatio)),
};
```

### Rendu card KPI (exemple lead time)

```html
<div class="kpi">
  <span class="label">Lead time médian${helpBtn("leadTime")}</span>
  <span class="value">${signals.leadTime}${fmt(input.kpis.leadTimeMedian)}</span>
</div>
```

Appliquer le même pattern aux 5 autres KPIs concernés.

---

## 3. `config.example.yaml` et `config.yaml`

Ajouter sous `metrics:` :

```yaml
metrics:
  # ...
  # Seuils des signaux de santé sur les KPIs du rapport.
  # Absents = aucun signal affiché. Toutes les clés sont optionnelles.
  # Durées en jours ouvrés. bugRatio = ratio 0-1 (0.20 = 20%).
  # throughputWeekly : directionnel "plus haut = mieux" (orange si < warn, rouge si < crit).
  healthThresholds:
    leadTimeMedianDays:     { warn: 5,    crit: 10   }
    cycleTimeMedianDays:    { warn: 3,    crit: 7    }
    throughputWeekly:       { warn: 3,    crit: 1    }
    wipCount:               { warn: 5,    crit: 8    }
    bugCycleTimeMedianDays: { warn: 3,    crit: 7    }
    bugRatio:               { warn: 0.20, crit: 0.40 }
```

---

## Ordre d'implémentation

1. Écrire tests TDD dans `tests/report/healthSignals.test.ts` — couvrir `evalLowerBetter` + `evalHigherBetter`
2. Implémenter `evalLowerBetter` / `evalHigherBetter` + types dans `generate.ts`
3. Étendre `generateReport()` signature + `RenderInput`
4. Ajouter CSS `.health-dot` dans le bloc `<style>`
5. Câbler `signals` et insérer `dot` dans les 6 cards KPI du template HTML
6. Étendre `AppConfig` dans `main.ts` + passer `healthThresholds` à `generateReport()`
7. Mettre à jour `config.example.yaml` et `config.yaml`
8. Vérifier visuellement `npm run report`
