# Spec technique — Rapport HTML personnalisable

## Impact fichiers

| Fichier | Modification |
|---|---|
| `src/main.ts` | Ajout interface `ReportPersonalization` + champ `report?:` dans `BoardFileConfig` |
| `src/report/generate.ts` | Nouveau type `ReportPersonalization` dans `RenderInput` ; lecture fichiers locaux dans `generateReport()` ; rendu conditionnel dans `renderHtml()` |

---

## 1. `src/main.ts` — Extension de `BoardFileConfig`

Ajouter l'interface et le champ dans `BoardFileConfig` (ligne ~123) :

```typescript
export interface ReportPersonalization {
  title?: string;
  logoUrl?: string;
  fontUrl?: string;
  customCssPath?: string;
  excludeTabs?: string[];
}

export interface BoardFileConfig {
  board: BoardConfig;
  metrics?: {
    cutoffDate?: string;
    bugIssueTypes?: string[];
    excludeIssueTypes?: string[];
    healthThresholds?: HealthThresholds;
  };
  report?: ReportPersonalization;  // ← ajout
}
```

Passer `config.report` à `generateReport()` dans l'action `report` (ligne ~456) :

```typescript
generateReport(
  db,
  config.jira.projectKey,
  config.jira.frontendUrl ?? config.jira.baseUrl,
  path.resolve(opts.output),
  metricConfig,
  config.metrics?.healthThresholds,
  config.report,                          // ← ajout
  path.dirname(path.resolve(opts.boardConfig)),  // ← base dir pour résolution chemins locaux
);
```

Exporter `ReportPersonalization` pour que `generate.ts` puisse l'importer si besoin (ou le
définir directement dans `generate.ts` et l'exporter depuis `main.ts`).

---

## 2. `src/report/generate.ts` — Lecture des ressources et rendu conditionnel

### 2a. Interface `RenderInput` — ajout champ `personalization`

```typescript
interface RenderInput {
  // ... champs existants ...
  personalization?: ResolvedPersonalization;
}

interface ResolvedPersonalization {
  title?: string;
  logoDataUri?: string;      // base64 ou URL distante résolue
  fontLinkHtml?: string;     // <link> complet prêt à injecter
  customCss?: string;        // contenu du fichier CSS lu
  excludedTabs: Set<string>; // onglets à masquer
}
```

### 2b. Signature `generateReport()` — deux paramètres ajoutés

```typescript
export function generateReport(
  db: Database.Database,
  projectKey: string,
  jiraBaseUrl: string,
  outputPath: string,
  config: MetricConfig,
  healthThresholds?: HealthThresholds,
  personalization?: ReportPersonalization,  // ← ajout
  boardDir?: string,                         // ← répertoire de board.yaml pour résolution
): void {
```

### 2c. Résolution des ressources locales dans `generateReport()`

Après le calcul des snapshots/charts existants, avant l'appel à `renderHtml()` :

```typescript
const resolvedPersonalization = resolvePersonalization(personalization, boardDir ?? process.cwd());
```

Nouvelle fonction privée `resolvePersonalization()` :

```typescript
const VALID_TABS = new Set(["delivery", "quality", "roles", "forecast", "advanced"]);
const LOGO_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

function resolvePersonalization(
  p: ReportPersonalization | undefined,
  boardDir: string,
): ResolvedPersonalization {
  if (!p) { return { excludedTabs: new Set() }; }

  // Logo
  let logoDataUri: string | undefined;
  if (p.logoUrl && !p.logoUrl.startsWith("data:")) {
    const isRemote = p.logoUrl.startsWith("http://") || p.logoUrl.startsWith("https://");
    if (isRemote) {
      logoDataUri = p.logoUrl;
    } else {
      const abs = path.resolve(boardDir, p.logoUrl);
      const ext = path.extname(abs).toLowerCase();
      const mime = LOGO_MIME[ext];
      if (!mime) {
        console.warn(`[report] Extension logo non reconnue : ${ext} — logo ignoré.`);
      } else if (!fs.existsSync(abs)) {
        throw new Error(`[report] logoUrl introuvable : ${abs}`);
      } else {
        const b64 = fs.readFileSync(abs).toString("base64");
        logoDataUri = `data:${mime};base64,${b64}`;
      }
    }
  } else if (p.logoUrl?.startsWith("data:")) {
    throw new Error(`[report] logoUrl ne peut pas commencer par "data:" — utiliser un chemin ou une URL http(s).`);
  }

  // CSS custom
  let customCss: string | undefined;
  if (p.customCssPath) {
    const abs = path.resolve(boardDir, p.customCssPath);
    if (!fs.existsSync(abs)) {
      throw new Error(`[report] customCssPath introuvable : ${abs}`);
    }
    customCss = fs.readFileSync(abs, "utf-8");
  }

  // Font
  const fontLinkHtml = p.fontUrl
    ? `<link href="${p.fontUrl}" rel="stylesheet">`
    : undefined;

  // Tabs
  const excludedTabs = new Set<string>();
  for (const t of p.excludeTabs ?? []) {
    if (VALID_TABS.has(t)) { excludedTabs.add(t); }
    else { console.warn(`[report] excludeTabs: onglet inconnu "${t}" ignoré.`); }
  }

  return { title: p.title, logoDataUri, fontLinkHtml, customCss, excludedTabs };
}
```

### 2d. `renderHtml()` — rendu conditionnel

**`<head>` — police et CSS custom :**

```typescript
// Remplacer le <link> Google Fonts fixe par :
${input.personalization?.fontLinkHtml ?? `<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;500;600&family=IBM+Plex+Sans:wght@300;400;500;600;700&display=swap" rel="stylesheet">`}

// Après </style>, injecter si CSS custom présent :
${input.personalization?.customCss ? `<style>\n${input.personalization.customCss}\n</style>` : ""}
```

**`<title>` et header :**

```typescript
<title>${escapeHtml(input.personalization?.title ?? `Rapport Lean — ${input.projectKey}`)}</title>

// Header (ligne ~722) — ajouter logo conditionnel :
<header class="bar">
  <span class="logo">
    ${input.personalization?.logoDataUri
      ? `<img src="${input.personalization.logoDataUri}" alt="logo" style="height:28px;vertical-align:middle;margin-right:.5rem;">`
      : ""}
    ${escapeHtml(input.personalization?.title ?? `${input.projectKey} // FLOW.OPS`)}
  </span>
  ...
</header>
```

**Onglets — rendu conditionnel :**

Extraire chaque panneau dans une variable helper ou conditionner inline :

```typescript
const show = (tab: string): boolean =>
  !input.personalization?.excludedTabs.has(tab);

// Dans la barre de navigation :
${show("delivery") ? `<button class="tab active" data-tab="delivery">Livraison</button>` : ""}
${show("quality")  ? `<button class="tab" data-tab="quality">Qualité &amp; bugs</button>` : ""}
...

// Les panneaux de contenu :
${show("delivery") ? `<div class="tab-panel active" id="tab-delivery">...</div>` : ""}
${show("quality")  ? `<div class="tab-panel" id="tab-quality">...</div>` : ""}
...
```

Attention : si l'onglet `delivery` est exclu, l'onglet `active` par défaut doit basculer sur
le premier onglet non-exclu. Ajouter un helper `firstVisibleTab()` qui retourne l'id du
premier onglet visible, et utiliser la classe `active` conditionnellement.

---

## Ordre d'implémentation

1. Ajouter `ReportPersonalization` dans `main.ts` + `BoardFileConfig.report?:`
2. Écrire `resolvePersonalization()` dans `generate.ts` (logique pure, testable)
3. Mettre à jour la signature de `generateReport()` + câblage dans `main.ts`
4. Modifier `RenderInput` + `renderHtml()` (police, CSS, titre, logo, onglets)
5. Écrire les tests (voir `tests/report/`)
6. Tester manuellement avec un `board.yaml` de test incluant les 5 clés
