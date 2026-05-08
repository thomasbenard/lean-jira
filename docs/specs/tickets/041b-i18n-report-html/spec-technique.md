# Spec technique — Traduction rapport HTML

## Impact fichiers

| Fichier | Modification |
|---|---|
| `src/i18n/en.ts` | Ajout espace de noms `report.*` (~200 clés) |
| `src/i18n/fr.ts` | Idem — chaînes françaises actuelles |
| `src/i18n/index.ts` | `LocaleShape` étendue avec clés `report.*` |
| `src/report/generate.ts` | `HELP_TEXTS` → locale ; `RenderInput` + `labels` ; `generateReport` accepte `lang` |
| `src/main.ts` | `generateReport(…, lang)` dans `report` et `refresh` ; `BoardFileConfig` + `report?.lang` |

---

## 1. Extension de `LocaleShape` (src/i18n/index.ts)

Les clés `report.*` sont ajoutées à l'interface existante. Exemples représentatifs :

```typescript
export interface LocaleShape {
  // ... clés CLI de 041a

  // Help texts
  "report.help.leadTime.title": string;
  "report.help.leadTime.body": string;
  "report.help.cycleTime.title": string;
  "report.help.cycleTime.body": string;
  // ... 16 autres entrées HELP_TEXTS

  // Titres de sections et onglets
  "report.tab.delivery": string;
  "report.tab.quality": string;
  "report.tab.capacity": string;
  "report.tab.roles": string;
  "report.tab.advanced": string;

  // Labels KPI et charts
  "report.kpi.leadTimeMedian": string;
  "report.kpi.cycleTimeMedian": string;
  "report.kpi.throughput": string;
  "report.kpi.wip": string;
  "report.chart.median": string;
  "report.chart.p85": string;
  "report.chart.deliveredIssues": string;

  // Aging WIP
  "report.aging.colIssue": string;
  "report.aging.colStatus": string;
  "report.aging.colAge": string;
  "report.aging.riskOk": string;
  "report.aging.riskWatch": string;
  "report.aging.riskAtRisk": string;
  "report.aging.riskCritical": string;

  // Bannières et messages
  "report.stale.warning": string;
  "report.noData": string;
  "report.noSnapshots": string;
}
```

---

## 2. `ReportLabels` et `buildReportLabels()`

```typescript
// src/report/generate.ts
import { type LocaleCode, type LocaleShape } from "../i18n/index";
import { en } from "../i18n/en";
import { fr } from "../i18n/fr";

export type ReportLabels = Pick<LocaleShape,
  | "report.help.leadTime.title" | "report.help.leadTime.body"
  // ... toutes les clés report.*
>;

function buildReportLabels(lang: LocaleCode): ReportLabels {
  const locale = lang === "fr" ? fr : en;
  return locale as unknown as ReportLabels;
}
```

`renderHtml()` reçoit `labels` dans son objet input :

```typescript
interface RenderInput {
  // ... champs existants (projectKey, squadName, kpis, charts, etc.)
  labels: ReportLabels;
}
```

---

## 3. `generateReport()` — signature étendue

```typescript
export function generateReport(
  db: Database.Database,
  projectKey: string,
  jiraBaseUrl: string,
  outputPath: string,
  config: MetricConfig,
  healthThresholds?: HealthThresholds,
  squadName?: string,
  lang: LocaleCode = "en",
): void {
  const labels = buildReportLabels(lang);
  // ...
  const html = renderHtml({ ..., labels });
  // ...
}
```

---

## 4. `BoardFileConfig` — champ `report?.lang`

```typescript
// src/main.ts
export interface BoardFileConfig {
  board: BoardConfig;
  metrics?: { /* ... */ };
  report?: {
    lang?: string;
  };
}
```

Résolution de la langue dans les commandes `report` et `refresh` :

```typescript
.action((opts: ReportOpts) => {
  const config = loadConfigs(...);
  const lang = (opts.lang !== "en" ? opts.lang : config.report?.lang ?? "en") as LocaleCode;
  initLocale(lang);
  generateReport(..., lang);
})
```

---

## 5. `HELP_TEXTS` → labels

`HELP_TEXTS` (constante ligne 65) est supprimée. `helpBtn()` et tous les accès `HELP_TEXTS[key]`
dans `renderHtml` sont remplacés par `labels["report.help.<key>.title"]` et
`labels["report.help.<key>.body"]`.

---

## Ordre d'implémentation

1. Étendre `LocaleShape` avec toutes les clés `report.*` (compilateur détecte immédiatement
   les manques dans `en.ts` et `fr.ts`)
2. Remplir `en.ts` — traduire les 18 HELP_TEXTS + tous les labels HTML en anglais
3. Remplir `fr.ts` — copier les chaînes actuelles de `generate.ts`
4. Ajouter `buildReportLabels()` + `ReportLabels` dans `generate.ts`
5. Étendre `RenderInput` avec `labels` + passer partout dans `renderHtml`
6. Remplacer `HELP_TEXTS` et toutes les chaînes françaises hardcodées
7. Étendre `generateReport()` signature + `BoardFileConfig`
8. Patcher `main.ts` — résolution de langue dans `report` et `refresh`
9. Tests
