# Spec technique — Rapport adaptatif selon méthode d'estimation

## Impact fichiers

| Fichier | Modification |
|---|---|
| `src/report/generate.ts` | `ReportInput` + `estimationFlags()` + bandeau + masquage + labels dynamiques |
| `src/main.ts` | Passage `estimation` à `generateReport()` |

---

## 1. `src/report/generate.ts`

### `ReportInput` (autour de la ligne 397)

```typescript
export interface ReportInput {
  // ... champs existants ...
  estimation: import("./types").EstimationConfig;
}
```

### Flags de visibilité

```typescript
interface EstimationFlags {
  showWeighted: boolean;
  showNormalized: boolean;      // true uniquement pour "time" (disabled: true hors time, cf. 039b)
  showNormalizedNote: boolean;  // true pour "time" : message d'influence no-estimate
  showBySize: boolean;
  weightedUnit: "j-h" | "SP" | "pts";
  contextLabel: string;
}

function estimationFlags(est: import("./types").EstimationConfig): EstimationFlags {
  const m = est.method;
  // resolveThresholds() from metrics/types — import direct, pas depuis main
  const t = { xs: 1, s: 3, m: 8, l: 13, ...est.bucketThresholds };
  return {
    showWeighted:      m !== "t-shirt" && m !== "none",
    showNormalized:    m === "time",   // disabled: true retourné par les métriques hors time (039b)
    showNormalizedNote: m === "time",  // message influence no-estimate uniquement quand données présentes
    showBySize:        m !== "none",
    weightedUnit:      m === "story-points" ? "SP" : m === "numeric" ? "pts" : "j-h",
    contextLabel:
      m === "time"           ? "Estimation : temps (j-h)"
      : m === "story-points" ? `Estimation : story points (SP) — seuils XS<${t.xs} S<${t.s} M<${t.m} L<${t.l}`
      : m === "numeric"      ? "Estimation : champ custom (pts)"
      : m === "t-shirt"      ? "Estimation : taille de t-shirt"
      : "Estimation : aucune — métriques by-size désactivées",
  };
}
```

### Bandeau contexte (après le header d'équipe dans le template HTML)

```typescript
`<p class="estimation-context">${flags.contextLabel}</p>`
```

CSS : `.estimation-context { font-size: 0.85rem; color: #666; margin: 0 0 1rem; }`

### Message contextuel sur les normalisés

```typescript
const normalizedNote = flags.showNormalizedNote
  ? `<p class="normalized-note">Ratio basé sur les estimations.
     Un ratio médian élevé (&gt;1.5) indique que les estimations ne prédisent pas
     la capacité réelle — les métriques de flux (lead time, cycle time) sont plus fiables.</p>`
  : "";
```

Inséré sous le titre de chaque section normalized.

### Masquage conditionnel des sections (pattern uniforme)

```typescript
const hide = (show: boolean) => show ? "" : ' style="display:none"';

// Throughput pondéré (~ligne 803)
`<div class="chart-card"${hide(flags.showWeighted)}>
  <h3>Throughput pondéré (${flags.weightedUnit} estimés)${helpBtn("throughputWeighted")}</h3>
  <canvas id="throughputWeightedChart"></canvas>
</div>`

// Lead/Cycle normalisés (~lignes 880-881)
`<div class="chart-card"${hide(flags.showNormalized)}>
  <h3>Lead normalisé (réel / estimé)${helpBtn("leadTimeNormalized")}</h3>
  ${normalizedNote}
  <canvas id="leadNormalizedChart"></canvas>
</div>`

// By-size (~lignes 887-893)
`<div class="chart-card"${hide(flags.showBySize)}>..lead-time-by-size..</div>`
`<div class="chart-card"${hide(flags.showBySize)}>..cycle-time-by-size..</div>`
```

### Initialisation JS conditionnelle (évite les erreurs console)

```javascript
// Pattern pour toutes les initialisations des sections masquables
if (document.getElementById("throughputWeightedChart")) {
  lineChart("throughputWeightedChart", CHARTS.throughputWeighted, [...]);
}
if (document.getElementById("leadNormalizedChart")) {
  lineChart("leadNormalizedChart", CHARTS.leadTimeNormalized, [...]);
}
// idem cycleBySizeChart, leadBySizeChart, cycleNormalizedChart
```

### Labels bucket selectors dynamiques

`getBucketLabels(estimation)` (039b) est sérialisé en JSON dans le template embarqué :

```typescript
const bucketLabelsJson = JSON.stringify(getBucketLabels(input.estimation));
// Dans le JS embarqué :
`const BUCKET_LABELS = ${bucketLabelsJson};`
```

---

## 2. `src/main.ts`

Commandes `report` et `refresh` :

```typescript
generateReport({
  // ... champs existants ...
  estimation: app.metrics?.estimation ?? { method: "time" },
});
```

---

## Ordre d'implémentation

1. `main.ts` — passer `estimation` à `generateReport()`
2. `generate.ts` — `ReportInput` + `estimationFlags()`
3. `generate.ts` — bandeau contexte + message normalized
4. `generate.ts` — masquage conditionnel + vérifications JS canvas
5. `generate.ts` — labels bucket selectors dynamiques
