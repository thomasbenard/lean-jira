# Chart Registry Refactor — Design Spec

**Date:** 2026-05-15  
**Ticket:** feature/ticket-050-store-abstraction (opportunistic refactor)  
**Status:** Approved

---

## Problem

`src/report/generate.ts` currently owns three unrelated concerns:

1. **Data collection** — a hardcoded `charts` object with 20+ `buildSeries` / `buildRoleSeries` calls, one per chart.
2. **Visual mapping** — implicit knowledge of which metric → which chart type, which series, which colors.
3. **Template injection** — passing the collected data to Handlebars.

The template (`report.hbs`) mirrors this with ~30 hardcoded IIFE/chart calls, one per chart.

The result: adding or changing a chart requires edits in at least two files with no single source of truth.

---

## Goal

Extract "which metric is displayed in which chart" into a **static TypeScript registry** (`ChartDef[]`). The registry drives both:

- **Server-side data collection** — `generate.ts` iterates `CHART_DEFS` instead of maintaining a hardcoded list of `buildSeries` calls.
- **Client-side rendering** — the template JS iterates the same registry (injected as JSON) instead of ~30 individual chart calls.

---

## New File: `src/report/chartDefs.ts`

### Types

```typescript
export type TabId = "delivery" | "quality" | "roles" | "forecast" | "advanced";

export type DataMode =
  | { mode: "stats";      metricName: string; bucket: string; stats: string[] }
  | { mode: "roleSeries"; metricName: string; roles: string[]; stat: string  };

export interface SeriesDef {
  key:   string;   // matches series key in ChartSeries.series
  label: string;   // resolved i18n text (or static label)
  color: string;   // CSS color or CSS variable
}

export type ChartType =
  | { type: "line"; trendLine?: boolean }
  | { type: "bar";  stacked?: boolean   }
  | { type: "custom"; rendererId: string };

export interface ChartDef {
  id:        string;       // DOM canvas element id
  key:       string;       // key in CHARTS object (server-injected data)
  tab:       TabId;        // which report tab this chart belongs to
  titleKey:  string;       // i18n key — resolved server-side before JSON injection
  helpKey?:  string;       // key for help tooltip; also drives CANVAS_KEY in initZoom
  data:      DataMode | null;  // null = live computed data (histogram, aging scatter)
  chart:     ChartType;
  series?:   SeriesDef[];  // for line/bar charts; absent for custom
  showWhen?: string;       // EstimationFlags key e.g. "showWeighted"; chart hidden if flag false
  sprintKey?: string;      // present = chart has Weeks/Sprint toggle
}
```

### Registry

`CHART_DEFS: ChartDef[]` — one entry per chart canvas in the report. Covers all tabs. Entries with `data: null` (histogram, aging scatter) have server-side data injected via separate existing globals (`HISTOGRAM`, `AGING`); the registry still declares their `id`, `tab`, `chart`, and `rendererId`.

### `serializeChartDefs(defs, t)`

Server-side function called in `buildTemplateContext`. Resolves each `titleKey` to the translated string via `t()` and returns `JSON.stringify(resolvedDefs)`. The resolved JSON is injected into the template as `{{{chartDefsJson}}}` (triple-stache, no HTML escaping).

---

## Changes to `src/report/generate.ts`

### Remove

The hardcoded `charts` object (~20+ `buildSeries` / `buildRoleSeries` calls).

### Add: `buildAllChartData(byMetric, defs)`

```typescript
function buildAllChartData(
  byMetric: Map<string, SnapshotRow[]>,
  defs: ChartDef[],
): Record<string, ChartSeries> {
  const result: Record<string, ChartSeries> = {};
  for (const def of defs) {
    if (!def.data) continue;
    const rows = byMetric.get(def.data.metricName) ?? [];
    result[def.key] = def.data.mode === "roleSeries"
      ? buildRoleSeries(rows, def.data.roles, def.data.stat)
      : buildSeries(rows, def.data.bucket, def.data.stats);
  }
  return result;
}
```

### Update: `buildTemplateContext`

Add `chartDefsJson: serializeChartDefs(CHART_DEFS, t)` to the returned context.

### Update: `TemplateContext` interface

Add `chartDefsJson: string`.

### Out of scope

`buildRenderedTabs()` (HTML `<canvas>` generation) is **not changed** — it reads from existing config, not `CHART_DEFS`. The canvas ids in `CHART_DEFS` must match those emitted by `buildRenderedTabs`.

---

## Changes to `src/report/templates/report.hbs`

### Replace ~30 hardcoded chart calls with a dispatcher loop

```javascript
var CHART_DEFS = {{{chartDefsJson}}};

var CUSTOM_RENDERERS = {
  devTimeAllocation: renderDevTimeAllocation,
  bugBacklog:        renderBugBacklog,
  cycleHistogram:    renderHistogram,
  agingScatter:      renderAging,
  // add others here as needed
};

function renderStandardChart(def, data) {
  if (!data || data.dates.length === 0) return;
  var existing = Chart.getChart(def.id);
  if (existing) existing.destroy();
  var datasets = def.series.map(function(s) {
    var values = data.series[s.key] || [];
    return def.chart.type === "bar"
      ? { label: s.label, data: values, backgroundColor: s.color + "88",
          borderColor: s.color, borderWidth: 1 }
      : { label: s.label, data: values, borderColor: s.color,
          backgroundColor: s.color + "22", tension: 0.2, pointRadius: 2 };
  });
  if (def.chart.trendLine) {
    var trend = buildTrendDataset(computeMovingAvg(datasets[0].data));
    if (trend) datasets.push(trend);
  }
  new Chart(document.getElementById(def.id), {
    type: def.chart.type, data: { labels: data.dates, datasets: datasets }, options: baseOpts,
  });
}

CHART_DEFS.forEach(function(def) {
  if (def.showWhen && !estimationFlags[def.showWhen]) return;
  var useSprint = false;
  function getData() {
    return (useSprint && def.sprintKey && hasSprintCharts)
      ? SPRINT_CHARTS[def.sprintKey]
      : CHARTS[def.key];
  }
  function render() {
    var data = getData();
    if (def.chart.type === "custom") {
      var fn = CUSTOM_RENDERERS[def.chart.rendererId];
      if (fn) fn(def, data);
    } else {
      renderStandardChart(def, data);
    }
  }
  render();
  if (def.sprintKey && hasSprintCharts) {
    var btn = document.getElementById(def.id + "-toggle");
    if (btn) btn.addEventListener("click", function() { useSprint = !useSprint; render(); });
  }
});
```

### Replace hardcoded CANVAS_KEY in `initZoom`

```javascript
var CANVAS_KEY = {};
CHART_DEFS.forEach(function(def) { CANVAS_KEY[def.id] = def.helpKey || ""; });
```

### Custom renderer signature

All custom renderers adopt a uniform signature:

```javascript
function renderXxx(def, data) { /* data may be null for histogram/aging */ }
```

Renderers that use live globals (`HISTOGRAM`, `AGING`) ignore the `data` parameter.

---

## Weeks/Sprint Toggle

Charts with a `sprintKey` field have their Weeks/Sprint toggle wired by the dispatcher loop. The sprint data pipeline (`buildSprintSeries`, `sprintChartsJson`) is **unchanged**. At runtime, when `useSprint` is true and `hasSprintCharts` is true, `getData()` returns `SPRINT_CHARTS[def.sprintKey]` instead of `CHARTS[def.key]`. The toggle button id convention (`def.id + "-toggle"`) must match what `buildRenderedTabs` emits.

---

## `context.schema.json`

Add field:

```json
"chartDefsJson": {
  "type": "string",
  "description": "JSON array of ChartDef objects with i18n keys resolved. Injected via triple-stache."
}
```

---

## Breaking Changes

**Custom templates (`report.templatePath`)** must be updated to:

1. Declare `var CHART_DEFS = {{{chartDefsJson}}};` near the top of the inline script.
2. Replace hardcoded chart instantiation calls with the dispatcher loop above.
3. Register any custom renderers in `CUSTOM_RENDERERS`.

Use `npm run report -- --export-template <dir>` to export the updated default template as a starting point.

---

## Files Touched

| File | Change |
|---|---|
| `src/report/chartDefs.ts` | **New** — `ChartDef` types + `CHART_DEFS` registry + `serializeChartDefs` |
| `src/report/generate.ts` | Remove hardcoded `charts` object; add `buildAllChartData`; update `buildTemplateContext`; update `TemplateContext` |
| `src/report/templates/report.hbs` | Replace ~30 chart calls with dispatcher loop; replace hardcoded `CANVAS_KEY` |
| `src/report/templates/context.schema.json` | Add `chartDefsJson` field |

**Not touched:** `src/snapshots/compute.ts`, `src/metrics/`, `src/db/store.ts`, `buildRenderedTabs`.
