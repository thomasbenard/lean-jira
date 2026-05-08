# Spec technique — Modèle de données estimation brute

## Impact fichiers

| Fichier | Modification |
|---|---|
| `src/db/schema.sql` | +2 colonnes sur `issues` + table `app_config` |
| `src/db/store.ts` | Migration `migrate()` + `upsertIssues` étendu |
| `src/jira/types.ts` | Index signature `[key: string]: unknown` sur `JiraIssue.fields` + `StoredIssue` étendu |
| `src/sync.ts` | `SyncConfig` étendu + `extractEstimation()` + `mapIssue()` mis à jour |
| `src/metrics/types.ts` | Types `EstimationConfig`, `EstimationMethod`, `resolveEstimationField()` |
| `src/main.ts` | Re-export types + `BoardFileConfig.metrics.estimation` + validation toutes commandes |

---

## 1. `src/db/schema.sql`

```sql
CREATE TABLE IF NOT EXISTS issues (
  key                       TEXT PRIMARY KEY,
  summary                   TEXT,
  issue_type                TEXT,
  created_at                TEXT,
  resolved_at               TEXT,
  current_status            TEXT,
  assignee                  TEXT,
  priority                  TEXT,
  current_sprint_id         INTEGER,
  original_estimate_seconds INTEGER,
  story_points              REAL,    -- ajout 039a : story-points et numeric
  size_label                TEXT     -- ajout 039a : t-shirt
);

-- table de configuration applicative (risque 2 : détection changement méthode)
CREATE TABLE IF NOT EXISTS app_config (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

---

## 2. `src/db/store.ts`

Dans `migrate()` (après ligne 26) :

```typescript
if (!cols.some((c) => c.name === "story_points")) {
  db.exec("ALTER TABLE issues ADD COLUMN story_points REAL");
}
if (!cols.some((c) => c.name === "size_label")) {
  db.exec("ALTER TABLE issues ADD COLUMN size_label TEXT");
}
```

`upsertIssues` : ajouter `story_points` et `size_label` dans INSERT et `ON CONFLICT DO UPDATE SET`.

---

## 3. `src/jira/types.ts`

Index signature sur `JiraIssue.fields` pour accès dynamique aux custom fields :

```typescript
fields: {
  summary: string;
  issuetype: { name: string };
  status: { name: string };
  created: string;
  resolutiondate: string | null;
  assignee: { displayName: string } | null;
  priority: { name: string } | null;
  customfield_10020?: JiraSprint[] | null;
  timeoriginalestimate?: number | null;
  customfield_10016?: number | null;   // story points (standard Atlassian)
  [key: string]: unknown;              // custom fields dynamiques (numeric, t-shirt)
};
```

`StoredIssue` :

```typescript
export interface StoredIssue {
  key: string;
  summary: string;
  issueType: string;
  createdAt: string;
  resolvedAt: string | null;
  currentStatus: string;
  assignee: string | null;
  priority: string | null;
  currentSprintId: number | null;
  originalEstimateSeconds: number | null;
  storyPoints: number | null;    // story-points + numeric → même colonne
  sizeLabel: string | null;      // t-shirt
}
```

---

## 4. `src/metrics/types.ts` — types EstimationConfig

> **Risque 1 (anti-circulaire)** : les types d'estimation vivent dans `src/metrics/types.ts`, **pas dans `main.ts`**. `metrics/utils.ts` importe depuis `./types` — aucune dépendance vers `main.ts`. `main.ts` re-exporte pour la surface publique CLI.

Ajouter avant `MetricConfig` dans `src/metrics/types.ts` :

```typescript
export type EstimationMethod = "time" | "story-points" | "numeric" | "t-shirt" | "none";

export interface EstimationBucketThresholds {
  xs: number;
  s: number;
  m: number;
  l: number;
  // xl implicite : >= l
}

export interface EstimationConfig {
  method: EstimationMethod;
  jiraField?: string;                        // implicite pour time/story-points
  bucketThresholds?: EstimationBucketThresholds;
  // Pas de weightField : dérivé automatiquement depuis method (voir 039c)
}

export function resolveEstimationField(cfg: EstimationConfig): string | null {
  if (cfg.jiraField) return cfg.jiraField;
  if (cfg.method === "time") return "timeoriginalestimate";
  if (cfg.method === "story-points") return "customfield_10016";
  return null;
}
```

`src/main.ts` — re-export uniquement, plus de définition locale :

```typescript
export type { EstimationConfig, EstimationMethod, EstimationBucketThresholds } from "./metrics/types";
import type { EstimationConfig } from "./metrics/types";
import { resolveEstimationField } from "./metrics/types";
```

`BoardFileConfig.metrics` dans `main.ts` (ligne 131) :

```typescript
metrics?: {
  cutoffDate?: string;
  bugIssueTypes?: string[];
  excludeIssueTypes?: string[];
  healthThresholds?: HealthThresholds;
  scopeChangeGracePeriodHours?: number;
  estimation?: EstimationConfig;
};
```

Validation au démarrage — **toutes** les commandes qui chargent `BoardFileConfig` (`sync`, `metrics`, `snapshots`, `report`, `refresh`) — pas seulement sync et refresh :

```typescript
function validateEstimationConfig(cfg: EstimationConfig | undefined): void {
  if (!cfg) return;
  const field = resolveEstimationField(cfg);
  if ((cfg.method === "t-shirt" || cfg.method === "numeric") && !field) {
    console.error(`Erreur : metrics.estimation.method="${cfg.method}" requiert metrics.estimation.jiraField`);
    process.exit(1);
  }
}
```

---

## 5. `src/sync.ts`

> **Risque 2 (sync incrémental)** : si la méthode change (`time` → `story-points`), les issues non-modifiées ne sont jamais re-fetchées → `story_points` reste NULL sur tout l'historique. Solution : détecter le changement et forcer un full-resync automatique.

`SyncConfig` étendu :

```typescript
interface SyncConfig {
  jira: { /* inchangé */ };
  db: { path: string };
  estimation?: EstimationConfig;
}
```

**Détection changement de méthode** — au début de `sync()`, avant `getLastSyncDate()` :

```typescript
const currentMethod = config.estimation?.method ?? "time";
const storedMethod = (db.prepare(
  "SELECT value FROM app_config WHERE key = 'estimation_method'"
).get() as { value: string } | undefined)?.value ?? "time";

let lastSyncDate = getLastSyncDate(db, config.jira.projectKey);

if (storedMethod !== currentMethod && lastSyncDate !== null) {
  console.warn(
    `  ⚠ Méthode d'estimation changée (${storedMethod} → ${currentMethod})` +
    ` — sync complet forcé pour remplir story_points/size_label sur l'historique`
  );
  lastSyncDate = null;  // force full resync
}
```

**Persistance** — après `logSync()` en fin de `sync()` :

```typescript
db.prepare("INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)")
  .run("estimation_method", currentMethod);
```

Nouvelle fonction pure :

```typescript
const VALID_SIZE_LABELS = new Set(["XS", "S", "M", "L", "XL"]);

function extractEstimation(
  fields: JiraIssue["fields"],
  cfg: EstimationConfig | undefined,
): { storyPoints: number | null; sizeLabel: string | null } {
  if (!cfg || cfg.method === "time" || cfg.method === "none") {
    return { storyPoints: null, sizeLabel: null };
  }

  const fieldName = resolveEstimationField(cfg)!;
  const raw = fields[fieldName];

  if (cfg.method === "story-points" || cfg.method === "numeric") {
    const v = typeof raw === "number" ? raw : null;
    return { storyPoints: v != null && v > 0 ? v : null, sizeLabel: null };
  }

  if (cfg.method === "t-shirt") {
    const str = typeof raw === "string" ? raw
      : (raw as { value?: string } | null)?.value ?? null;
    const label = str?.toUpperCase().trim() ?? null;
    if (label && !VALID_SIZE_LABELS.has(label)) {
      console.warn(`  ⚠ size_label non reconnu : "${str}" — issue sans bucket taille`);
    }
    return { storyPoints: null, sizeLabel: VALID_SIZE_LABELS.has(label ?? "") ? label : null };
  }

  return { storyPoints: null, sizeLabel: null };
}
```

`mapIssue()` étendu (passe `estimationCfg` + retourne les nouveaux champs) :

```typescript
function mapIssue(
  issue: JiraIssue,
  activeSprintIds: Set<number>,
  estimationCfg?: EstimationConfig,
): StoredIssue {
  const { storyPoints, sizeLabel } = extractEstimation(issue.fields, estimationCfg);
  return {
    // ... champs existants ...
    storyPoints,
    sizeLabel,
  };
}
```

---

## Ordre d'implémentation

1. `metrics/types.ts` — types EstimationConfig + resolveEstimationField()
2. `schema.sql` — colonnes story_points, size_label + table app_config
3. `store.ts` — migration + upsert
4. `jira/types.ts` — index signature + StoredIssue
5. `main.ts` — re-export + BoardFileConfig + validateEstimationConfig() sur toutes commandes
6. `sync.ts` — SyncConfig + détection changement méthode + extractEstimation() + mapIssue()
