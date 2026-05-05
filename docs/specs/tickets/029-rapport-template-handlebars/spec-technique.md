# Spec technique — Template Handlebars pour override HTML complet

## Impact fichiers

| Fichier | Modification |
|---|---|
| `package.json` | Ajout dépendance `handlebars` (production) |
| `src/main.ts` | Ajout `templatePath?` dans `ReportPersonalization` ; ajout option `--export-template <dir>` sur commande `report` |
| `src/report/generate.ts` | Extraction `buildTemplateContext()` ; rendu conditionnel Handlebars vs TS interne |
| `src/report/templates/report.hbs` | Nouveau — template Handlebars par défaut (~1200 lignes) |
| `src/report/templates/context.schema.json` | Nouveau — JSON Schema documentant le contexte |

---

## 1. `package.json` — ajout dépendance

```json
"dependencies": {
  "handlebars": "^4.7.8",
  ...
}
```

Types `@types/handlebars` inutiles — Handlebars 4.x inclut ses propres déclarations TS.

---

## 2. `src/main.ts` — extension de `ReportPersonalization` + option CLI

Ajouter `templatePath?` dans l'interface `ReportPersonalization` (définie dans `main.ts`
au ticket 028) :

```typescript
export interface ReportPersonalization {
  title?: string;
  logoUrl?: string;
  fontUrl?: string;
  customCssPath?: string;
  excludeTabs?: string[];
  templatePath?: string;  // ← ajout 029 — chemin vers .hbs custom
}
```

Ajouter uniquement `--export-template` sur la commande `report` (pas de `--template` — le
chemin est dans `board.yaml`) :

```typescript
program
  .command("report")
  ...
  .option("--export-template <dir>", "Exporte le template Handlebars par défaut dans <dir> et quitte")
  .action((opts: ReportOpts) => {
    // Gestion --export-template : action one-shot, pas besoin de DB ni config
    if (opts.exportTemplate) {
      exportDefaultTemplate(path.resolve(opts.exportTemplate));
      return;
    }
    const config = loadConfigs(...);
    const boardDir = path.dirname(path.resolve(opts.boardConfig));
    ...
    generateReport(
      db, projectKey, jiraBaseUrl, outputPath, metricConfig,
      config.metrics?.healthThresholds,
      config.report,
      boardDir,
    );
  });
```

Interface `ReportOpts` étendue :

```typescript
interface ReportOpts {
  config: string;
  boardConfig: string;
  output: string;
  exportTemplate?: string;  // ← ajout ; --template supprimé
}
```

---

## 3. `src/report/generate.ts` — Refactor en deux parties

### 3a. Interface `TemplateContext`

```typescript
export interface TemplateContext {
  // Metadata
  projectKey: string;
  title: string;
  generatedAt: string;
  lastSnapshotDate: string;
  isSyncStale: boolean;
  lastSyncAt: string | null;

  // Fragments HTML pré-calculés (rapide à utiliser dans le template)
  staleBannerHtml: string;
  top3Html: string;
  kpiGridHtml: string;
  headerLogoHtml: string;
  fontLinkHtml: string;
  customStyleHtml: string;
  tabs: Array<{ id: string; label: string; html: string; active: boolean }>;

  // Données brutes (pour sections custom)
  kpis: Record<string, number | null>;
  chartDataJson: string;          // JSON.stringify des charts pour <script>
  agingWip: AgingWipSummary;
  forecast: ForecastSummary;
  cycleStats: { median: number; p85: number; p95: number; avg: number; count: number };
}
```

### 3b. Extraction `buildTemplateContext()`

```typescript
function buildTemplateContext(
  input: RenderInput,
  renderedTabs: Array<{ id: string; label: string; html: string }>,
  chartDataJson: string,
): TemplateContext {
  const p = input.personalization;
  const show = (tab: string): boolean => !p?.excludedTabs.has(tab);
  const firstActive = renderedTabs.find((t) => show(t.id))?.id ?? "";
  return {
    projectKey: input.projectKey,
    title: p?.title ?? `Rapport Lean — ${input.projectKey}`,
    generatedAt: input.generatedAt,
    lastSnapshotDate: input.lastSnapshotDate,
    isSyncStale: input.isSyncStale,
    lastSyncAt: input.lastSyncAt,
    staleBannerHtml: staleBannerHtml(input.isSyncStale, input.lastSyncAt),
    top3Html: buildTop3Actions(input.agingWip, input.jiraBaseUrl),
    kpiGridHtml: buildKpiGridHtml(input),
    headerLogoHtml: p?.logoDataUri
      ? `<img src="${p.logoDataUri}" alt="logo" style="height:28px;vertical-align:middle;margin-right:.5rem;">`
      : "",
    fontLinkHtml: p?.fontLinkHtml ?? DEFAULT_FONT_LINK,
    customStyleHtml: p?.customCss ? `<style>\n${p.customCss}\n</style>` : "",
    tabs: renderedTabs
      .filter((t) => show(t.id))
      .map((t, i) => ({ ...t, active: t.id === firstActive })),
    kpis: input.kpis,
    chartDataJson,
    agingWip: input.agingWip,
    forecast: input.forecast,
    cycleStats: input.cycleStats,
  };
}
```

### 3c. Rendu conditionnel dans `generateReport()`

```typescript
export function generateReport(
  db: Database.Database,
  projectKey: string,
  jiraBaseUrl: string,
  outputPath: string,
  config: MetricConfig,
  healthThresholds?: HealthThresholds,
  personalization?: ReportPersonalization,
  boardDir?: string,
  // templatePath résolu depuis personalization.templatePath dans le corps de la fonction
): void {
  // ... calculs existants ...

  const resolvedTemplatePath = personalization?.templatePath
    ? path.resolve(boardDir ?? process.cwd(), personalization.templatePath)
    : undefined;

  const html = resolvedTemplatePath
    ? renderWithHandlebars(renderInput, resolvedTemplatePath)
    : renderHtml(renderInput);  // rendu TS interne (028)

  fs.writeFileSync(outputPath, html);
}
```

### 3d. `renderWithHandlebars()` et helpers

```typescript
import Handlebars from "handlebars";

function registerHelpers(): void {
  Handlebars.registerHelper("escapeHtml", (s: string) => escapeHtml(String(s ?? "")));
  Handlebars.registerHelper("json", (v: unknown) => JSON.stringify(v));
  Handlebars.registerHelper("fmt_float", (v: number, d: number) =>
    v == null ? "—" : v.toFixed(d ?? 1));
  Handlebars.registerHelper("if_includes", function(
    this: unknown, arr: string[], val: string, options: Handlebars.HelperOptions,
  ) {
    return arr?.includes(val) ? options.fn(this) : options.inverse(this);
  });
}

function renderWithHandlebars(input: RenderInput, templatePath: string): string {
  registerHelpers();
  const src = fs.readFileSync(templatePath, "utf-8");
  let compiled: HandlebarsTemplateDelegate;
  try {
    compiled = Handlebars.compile(src, { strict: false });
  } catch (e) {
    throw new Error(`[report] Erreur de compilation du template Handlebars : ${(e as Error).message}`);
  }
  const context = buildTemplateContext(input, buildRenderedTabs(input), buildChartDataJson(input));
  return compiled(context);
}
```

### 3e. `exportDefaultTemplate()`

```typescript
function exportDefaultTemplate(dir: string): void {
  if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); }
  const target = path.join(dir, "report.hbs");
  if (fs.existsSync(target)) {
    throw new Error(`[export-template] ${target} existe déjà. Supprimer manuellement avant d'exporter.`);
  }
  // Le template est embarqué dans le build (voir ci-dessous)
  const templateSrc = path.join(__dirname, "templates", "report.hbs");
  fs.copyFileSync(templateSrc, target);
  const schemaSrc = path.join(__dirname, "templates", "context.schema.json");
  fs.copyFileSync(schemaSrc, path.join(dir, "context.schema.json"));
  console.log(`Template exporté dans ${dir}/`);
  console.log(`  report.hbs          ← template principal (Handlebars)`);
  console.log(`  context.schema.json ← documentation des variables disponibles`);
}
```

**Embarquer le template dans le build** : ajouter une section `tsconfig.json` pour copier
`src/report/templates/` dans `dist/report/templates/` lors du build
(`cp -r src/report/templates dist/report/templates` dans le script `build` de `package.json`).

---

## 4. `src/report/templates/report.hbs` — Structure du template

Le template reproduit fidèlement le HTML produit par `renderHtml()`. Structure générale :

```handlebars
<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<title>{{escapeHtml title}}</title>
{{{fontLinkHtml}}}
<script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
<style>
  /* ... CSS défaut identique à renderHtml() ... */
</style>
{{{customStyleHtml}}}
</head>
<body>
<header class="bar">
  <span class="logo">{{{headerLogoHtml}}}{{escapeHtml title}}</span>
  ...
</header>
<main>
{{{staleBannerHtml}}}
{{{top3Html}}}
<section class="kpi-section">
  <div class="kpi-grid">{{{kpiGridHtml}}}</div>
</section>

{{#if tabs}}
<div class="tabs" id="tabs">
  {{#each tabs}}
  <button class="tab{{#if active}} active{{/if}}" data-tab="{{id}}">{{label}}</button>
  {{/each}}
</div>
{{#each tabs}}
<div class="tab-panel{{#if active}} active{{/if}}" id="tab-{{id}}">
  {{{html}}}
</div>
{{/each}}
{{/if}}
</main>

<script>
/* Chart.js defaults */
const _CHART_DATA = {{{chartDataJson}}};
/* ... JS identique à renderHtml() ... */
</script>
</body>
</html>
```

Note : les fragments HTML pré-calculés (`top3Html`, `kpiGridHtml`, `tabs[].html`) sont injectés
via triple-accolades `{{{...}}}` (HTML non échappé). L'utilisateur qui veut modifier la
structure interne d'un onglet doit restructurer le `TemplateContext` ou utiliser `chartDataJson`
directement — documenté dans `context.schema.json`.

---

## Ordre d'implémentation

1. Ajouter `handlebars` dans `package.json` + `npm install`
2. Extraire `buildRenderedTabs()` et `buildKpiGridHtml()` de `renderHtml()` dans `generate.ts`
3. Écrire `buildTemplateContext()` + `buildChartDataJson()` (fonctions pures testables)
4. Générer `report.hbs` en exécutant `renderHtml()` une fois, puis convertir le HTML produit en template Handlebars (sed / remplacement manuel des interpolations TS)
5. Écrire `registerHelpers()` + `renderWithHandlebars()`
6. Écrire `exportDefaultTemplate()` + câblage dans `main.ts`
7. Vérifier `build` script copie `templates/` dans `dist/`
8. Tests + validation manuelle (`npm run report -- --template ./export/report.hbs` doit produire un rapport identique à `npm run report`)
