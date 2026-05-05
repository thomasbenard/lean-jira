# Spec technique — Rapport Cockpit

## Impact fichiers

| Fichier | Modification |
|---|---|
| `src/report/generate.ts` | Refonte complète du contenu de `renderHtml()` (CSS + structure HTML + scripts inline). Ajout d'une fonction `computeKpiCells()` exportable pour les tests. Suppression du toggle theme. |
| `tests/report/generate.test.ts` | Ajustement de 3-5 assertions HTML : `staleBannerHtml` (intégré au cockpit), `agingRowsHtml` (déplacée dans tab Forecast), nouveaux tests pour verdict + top-3. |
| `report-a.html` | Supprimé après livraison (artefact prototype, plus utile). `report-b.html` et `report-c.html` aussi supprimés. |

Aucun changement dans : `src/main.ts`, `src/snapshots/compute.ts`, `src/metrics/*`, schéma DB, `package.json`.

---

## 1. `src/report/generate.ts` — refonte de `renderHtml`

### 1.1 Calcul du verdict global et des deltas (côté serveur)

Avant le `return` HTML, calculer les deltas 4 sem et le statut verdict pour ne pas dupliquer la logique en JS inline. Ajouter une fonction privée :

```ts
type Direction = "lower" | "higher";

interface KpiCell {
  key: string;                 // "lead", "cycle", ...
  label: string;
  value: number | null;
  unit: string;                // "j" | "%" | "iss" | ""
  signal: HealthSignal;
  spark: number[];             // 12 derniers points
  delta4w: number | null;      // pourcentage signé ; null si historique < 5 sem
  direction: Direction;
  helpKey?: string;            // clé HELP_TEXTS si tooltip applicable
}

function buildKpiCells(
  charts: RenderInput["charts"],
  agingWip: AgingWipSummary,
  signals: { leadTime: HealthSignal; cycleTime: HealthSignal; throughput: HealthSignal; wip: HealthSignal; bugCycle: HealthSignal; bugRatio: HealthSignal },
): KpiCell[]
```

Helpers locaux :

```ts
const last = (a: number[]): number | null => a.length === 0 ? null : a[a.length - 1];
const avgN = (a: number[], n: number): number | null => {
  if (a.length < n) return null;
  const s = a.slice(-n);
  return s.reduce((x, y) => x + y, 0) / s.length;
};
const pct4w = (curr: number | null, ref: number | null): number | null =>
  curr === null || ref === null || ref === 0 ? null : ((curr - ref) / ref) * 100;
```

Note : la sparkline reçoit déjà `series.slice(-12)`. Pour `pct4w`, calculer la référence avec `avgN(series.slice(0, -1), 4)` (les 4 sem précédant la semaine courante).

### 1.2 Calcul du verdict

```ts
type VerdictStatus = "alert" | "watch" | "ok";

function computeVerdict(cells: KpiCell[]): { status: VerdictStatus; phrase: string } {
  const reds = cells.filter(c => c.signal === "red");
  const oranges = cells.filter(c => c.signal === "orange");
  const status: VerdictStatus = reds.length > 0 ? "alert" : oranges.length > 0 ? "watch" : "ok";
  // phrase : énumère 2-3 reds avec leur valeur, fallback sur oranges si aucun red
  // ...
}
```

La phrase est formatée en HTML brut (avec `<strong>`) — donc échapper systématiquement les valeurs via `escapeHtml`.

### 1.3 Top-3 actions

```ts
function buildTop3Actions(agingWip: AgingWipSummary, jiraBaseUrl: string): string {
  const critical = agingWip.issues.filter(i => i.riskLevel === "critical").sort((a, b) => b.ageDays - a.ageDays);
  const atRisk = agingWip.issues.filter(i => i.riskLevel === "at-risk").sort((a, b) => b.ageDays - a.ageDays);
  const top = [...critical, ...atRisk].slice(0, 3);
  if (top.length === 0) {
    return `<div class="action ok"><div class="action-num">// 01</div><div class="action-title">✓ Aucun ticket en zone critique</div></div>`;
  }
  // map vers <div class="action crit"> avec issueLink + status + age
}
```

`issueLink(issueKey, jiraBaseUrl)` existe déjà — réutiliser.

### 1.4 Structure HTML retournée

Le template literal `return ` `<!DOCTYPE html>...` ` est refondu. Charpente :

```
<!DOCTYPE html>
<html lang="fr">
<head>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;500;600&family=IBM+Plex+Sans:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
  <style>${COCKPIT_CSS}</style>
</head>
<body>
  <header class="bar">${headerBar}</header>
  <main>
    ${staleBannerHtml(...)}
    <div class="verdict ${statusClass}">${verdictBlock}</div>
    <section class="actions">${top3ActionsBlock}</section>
    <section class="kpi-section"><div class="kpi-grid">${kpiCellsHtml}</div></section>
    <div class="tabs">${tabButtons}</div>
    <div class="tab-panel active" id="tab-delivery">...</div>
    <div class="tab-panel" id="tab-quality">...</div>
    <div class="tab-panel" id="tab-roles">...</div>
    <div class="tab-panel" id="tab-forecast">...</div>
    <div class="tab-panel" id="tab-advanced">...</div>
  </main>
  <script>${INLINE_SCRIPTS}</script>
</body>
</html>
```

Le CSS `COCKPIT_CSS` reprend ~100% de celui de `report-a.html` (variables CSS, grid pattern, classes `.kpi-grid`, `.kpi-cell`, `.tabs`, `.tab-panel`, `.action`, `.verdict`, `.role`).

### 1.5 Conservation du `?` (tooltips d'aide)

Helper `helpBtn(key)` ligne 431 → conserver tel quel. Réutiliser à 3 endroits :

- À côté du libellé de chaque KPI dont `helpKey` est défini.
- À côté du titre H3 de chaque `.chart-card`.
- À côté du label de section sur les sous-titres "Aging WIP", "Forecast", "Distribution cycle time".

Le CSS `.help-wrap`, `.help-btn`, `.help-popover` doit être adapté à la palette sombre :

```css
.help-btn { background: var(--panel-2); color: var(--text-dim); }
.help-wrap:hover .help-btn { background: var(--cyan); color: var(--bg); }
.help-popover {
  background: #0c0d12; color: var(--text);
  border: 1px solid var(--line-2);
  /* reste identique : position, transition, z-index */
}
```

### 1.6 Conservation du zoom modal

L'IIFE `initZoom` (ligne 1189) attache un bouton `.zoom-btn` sur chaque `.chart-card` et gère l'ouverture du modal. Conserver **sans modification** la logique JS et la structure HTML générée. Adapter uniquement le CSS pour la palette sombre :

```css
.zoom-btn { background: var(--panel-2); color: var(--text-dim); border: 1px solid var(--line); opacity: 0.6; }
.zoom-btn:hover { background: var(--cyan); color: var(--bg); border-color: var(--cyan); opacity: 1; }
.chart-modal { background: var(--panel); border: 1px solid var(--line-2); }
.chart-modal-header, .chart-modal-title { color: var(--text); }
.chart-modal-close { background: var(--panel-2); color: var(--text-dim); border: 1px solid var(--line); }
.chart-modal-close:hover { background: var(--red); color: #fff; border-color: var(--red); }
.chart-modal-desc { color: var(--text-dim); border-bottom-color: var(--line); }
```

`HELP_BODIES` et `CANVAS_KEY` à l'intérieur de `initZoom` sont **réutilisés tels quels** (déjà un mapping complet `canvasId → HELP_TEXTS.key`).

### 1.7 Conservation des tooltips Chart.js

Toutes les options Chart.js continuent d'utiliser `plugins: { legend: ..., tooltip: ... }` par défaut. Adapter uniquement le style des tooltips au thème sombre via `Chart.defaults.color` et un theme global :

```js
Chart.defaults.color = "#7a8194";
Chart.defaults.borderColor = "#1f2330";
Chart.defaults.font.family = "'IBM Plex Mono', ui-monospace, monospace";
Chart.defaults.font.size = 11;
Chart.defaults.plugins.tooltip = {
  ...Chart.defaults.plugins.tooltip,
  backgroundColor: "#0c0d12",
  titleColor: "#fff",
  bodyColor: "#d7dbe6",
  borderColor: "#2a2f40",
  borderWidth: 1,
  padding: 8,
  titleFont: { family: "'IBM Plex Mono'" },
};
```

Les charts dual-axis (allocation features/bugs, bug backlog) gardent `interaction: { mode: "index", intersect: false }` pour aligner les valeurs sur la même date au survol.

### 1.8 Sparklines KPI

Nouveau bloc JS dans le script inline. Une fonction `sparkline(canvas, values, color)` rend un mini-line chart sans axes :

```js
function sparkline(canvas, values, color) {
  if (!canvas || !values || values.length === 0) return;
  new Chart(canvas, {
    type: "line",
    data: { labels: values.map((_, i) => i), datasets: [{
      data: values, borderColor: color, backgroundColor: color + "22",
      borderWidth: 1.5, pointRadius: 0, fill: true, tension: 0.35,
    }] },
    options: {
      responsive: false, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: { x: { display: false }, y: { display: false } },
    },
  });
}
```

Note : `responsive: false` évite la course de redimensionnement sur les sparklines hors écran (tabs cachés). Les sparklines sont rendues dans le DOM mais cachées par `.tab-panel:not(.active) { display: none }` pour les tabs ; sur la grille KPI elles sont toujours visibles donc OK.

### 1.9 Tabs

Code JS minimal (delegation event sur le conteneur `.tabs`) :

```js
document.getElementById("tabs").addEventListener("click", e => {
  const btn = e.target.closest(".tab");
  if (!btn) return;
  const id = btn.dataset.tab;
  document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t === btn));
  document.querySelectorAll(".tab-panel").forEach(p => p.classList.toggle("active", p.id === "tab-" + id));
});
```

Tous les charts sont rendus à l'init (le `display: none` du tab caché ne pose pas de problème ; Chart.js redimensionne au prochain `resize` event que le navigateur déclenche au passage `display: block`).

### 1.10 Suppression du toggle theme

Supprimer :
- Le `<script>` ligne 455-457 (early class addition).
- Le bloc `.theme-btn` dans le CSS (ligne 94).
- L'IIFE `themeToggle` (ligne 705-714).
- Toutes les variables CSS de la racine `:root` claire (devenu inutile, les valeurs sombres sont les seules).
- Les conditions `_isDark ? ... : ...` (toujours sombre).

Ne pas casser la lecture de `localStorage` ailleurs (rien d'autre ne lit `lean-theme`).

---

## 2. `tests/report/generate.test.ts` — ajustements

### 2.1 Tests à conserver tels quels

- `issueLink` (4 tests) — helper pur, indépendant du HTML.
- `buildBucketSeries` (5 tests) — helper pur.
- `syncMetaLabel` (3 tests) — helper texte pur.
- `staleBannerHtml` (4 tests) — sortie HTML inchangée.
- `evalLowerBetter` / `evalHigherBetter` (cf. `healthSignals.test.ts`) — fonctions pures inchangées.

### 2.2 Tests à ajuster

- `agingRowsHtml` (~5 tests) : la table des aging issues passe du flux principal au tab `Forecast & aging`. Si les tests vérifient la structure `<tr><td>...`, ils restent verts. Si un test cherche un sélecteur parent (`.aging-wrap`), l'adapter.

### 2.3 Tests à ajouter

```ts
describe("buildKpiCells", () => {
  it("calcule delta 4 sem comme pct(curr, avg(history.slice(0,-1).slice(-4)))", () => {
    // history = [10, 10, 10, 10, 12] → avgN slice(0,-1).slice(-4) = 10 → delta = +20%
  });
  it("retourne delta=null si historique < 5 points", () => { ... });
  it("propage signal santé depuis evalLowerBetter/evalHigherBetter", () => { ... });
});

describe("computeVerdict", () => {
  it("status alert si ≥1 cell red", () => { ... });
  it("status watch si aucun red mais ≥1 orange", () => { ... });
  it("status ok si tous green/none", () => { ... });
  it("phrase liste les 2-3 cells red avec leur valeur formatée", () => { ... });
});

describe("buildTop3Actions", () => {
  it("retourne les 3 critical les plus anciens triés par ageDays desc", () => { ... });
  it("complète avec at-risk si moins de 3 critical", () => { ... });
  it("retourne carte verte unique si aucun critical/at-risk", () => { ... });
  it("génère un lien Jira via issueLink pour chaque carte", () => { ... });
});

describe("renderHtml — fonctionnalités conservées", () => {
  it("contient au moins un .help-btn pour les KPIs avec helpKey", () => { ... });
  it("contient le mapping CANVAS_KEY pour le zoom modal", () => { ... });
  it("ne référence plus localStorage.lean-theme ni la classe html.dark", () => { ... });
});
```

---

## 3. Suppression des fichiers prototype

Une fois le ticket livré, supprimer :

- `report-a.html` (référence visuelle, plus utile)
- `report-b.html` (variante non retenue)
- `report-c.html` (variante non retenue)

Ces fichiers sont déjà ignorés par le `.gitignore` ? Non, ils sont actuellement non trackés (`?? report-a.html` dans `git status`). Donc simple `rm`.

---

## Ordre d'implémentation

1. **Tests rouges** : écrire les tests `buildKpiCells`, `computeVerdict`, `buildTop3Actions` avant l'implémentation (TDD).
2. **Helpers serveur** : implémenter `buildKpiCells`, `computeVerdict`, `buildTop3Actions` jusqu'à tests verts.
3. **CSS Cockpit** : extraire `COCKPIT_CSS` depuis `report-a.html`, l'injecter dans `renderHtml`. Adapter les classes `.help-*`, `.zoom-btn`, `.chart-modal-*` à la palette sombre.
4. **Structure HTML** : remplacer le contenu du template literal de `renderHtml` (header bar, verdict, actions, kpi-grid, tabs avec 5 panels). Réintégrer `staleBannerHtml`. Garder `helpBtn(key)` à tous les emplacements existants + nouveaux KPIs.
5. **Scripts inline** : refondre la section `<script>...</script>` :
   - Conserver `CHARTS`, `HISTOGRAM`, `CYCLE_STATS`, `AGING`, `LEAD_BY_SIZE`, `CYCLE_BY_SIZE` data injections.
   - Conserver `lineChart`, `computeMovingAvg`, `buildTrendDataset`, `initBucketSelector`, `renderHistogram`, `renderAging`, `renderBugBacklog`, `renderDevTimeAllocation`, `renderStageTimeByRole`, `renderStageTimeShare`, `renderStageThroughputGap`, `renderReworkByType`, `renderWipPerRole`, `renderFtrByRole`, `renderReworkRatio`.
   - Ajouter `sparkline()` + boucle qui rend les 8 sparklines KPI.
   - Ajouter le delegation listener tabs.
   - Adapter les couleurs Chart.js (`Chart.defaults.color/borderColor/font`).
   - **Conserver l'IIFE `initZoom` telle quelle** — c'est le point critique.
   - Supprimer l'IIFE `themeToggle`.
6. **Tests assertions HTML** : ajuster `agingRowsHtml`, ajouter assertions « pas de localStorage.lean-theme », « contient `.kpi-grid`, `.tabs`, `.tab-panel` ».
7. **Run manuel** : `npm run report` → ouvrir `report.html` dans Chrome. Vérifier :
   - Verdict en haut affiche le statut correct.
   - Top-3 actions liste les 3 critical les plus anciens avec liens cliquables.
   - 8 KPIs avec sparklines visibles, deltas affichés.
   - Click sur chaque tab → panel correspondant visible.
   - Survol `?` → popover apparaît.
   - Click `⤢` → modal s'ouvre, chart re-rendu, click hors modal ou Escape ferme.
   - Survol courbes → tooltip Chart.js avec date + valeurs.
8. **Cleanup** : `rm report-a.html report-b.html report-c.html`.
9. **Run final** : `npx tsc -p tsconfig.test.json` (typecheck tests), `npm test`, `npm run report` une dernière fois.
