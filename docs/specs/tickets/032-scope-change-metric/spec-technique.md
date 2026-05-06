# Spec technique — Métrique scope-change-rate

## Impact fichiers

| Fichier | Modification |
|---|---|
| `src/metrics/scopeChange.ts` | Nouveau fichier — métrique complète |
| `src/metrics/index.ts` | Ajout de `scopeChangeMetric` dans `ALL_METRICS` |
| `src/snapshots/compute.ts` | Skip explicite (calcul live dans rapport) |

---

## 1. `src/metrics/scopeChange.ts` — métrique complète

### Types exportés

```typescript
export interface SprintScopeStats {
  totalIssues: number;
  changedIssues: number;
  changeRatio: number;
  byChangeType: {
    description: number;
    storyPoints: number;
    sprintChange: number;
  };
}

export interface ScopeChangeResult {
  totalIssues: number;
  changedIssues: number;
  changeRatio: number;
  bySprint: Record<string, SprintScopeStats>;
  changedIssueKeys: string[];
}
```

### Constantes

```typescript
const SIMILARITY_THRESHOLD = 0.85;
const WATCHED_TEXT_FIELDS = new Set(["description", "summary"]);
```

### Algorithme de diff — `normalizeText` et `similarityRatio`

```typescript
function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[*_#>`~\[\]()]/g, " ")   // marqueurs Markdown
    .replace(/`{1,3}/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Levenshtein distance iterative (O(m*n) time, O(n) space)
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const curr = [i];
    for (let j = 1; j <= n; j++) {
      curr[j] = a[i - 1] === b[j - 1]
        ? prev[j - 1]
        : 1 + Math.min(prev[j - 1], prev[j], curr[j - 1]);
    }
    prev = curr;
  }
  return prev[n];
}

function similarityRatio(from: string, to: string): number {
  const a = normalizeText(from);
  const b = normalizeText(to);
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) { return 1; }
  return 1 - levenshtein(a, b) / maxLen;
}
```

### Requête SQL principale

```typescript
const rows = db.prepare(`
  SELECT
    fc.issue_key,
    fc.field_name,
    fc.from_value,
    fc.to_value,
    fc.changed_at,
    s.name        AS sprint_name,
    s.start_date  AS sprint_start
  FROM issue_field_changes fc
  JOIN (
    -- Premier sprint de chaque issue (engagement)
    SELECT
      fc2.issue_key,
      MIN(s2.start_date) AS first_sprint_start
    FROM issue_field_changes fc2
    JOIN sprints s2 ON (
      fc2.to_value LIKE '%' || s2.name || '%'
      AND fc2.field_name = 'Sprint'
    )
    WHERE s2.start_date IS NOT NULL
    GROUP BY fc2.issue_key
  ) first_sprint ON fc.issue_key = first_sprint.issue_key
  JOIN sprints s ON (
    fc.to_value LIKE '%' || s.name || '%'
    AND fc.field_name = 'Sprint'
  )
  WHERE fc.changed_at > first_sprint.first_sprint_start
    AND fc.field_name != 'Sprint'
  UNION ALL
  -- Sprint changes (reprogrammations)
  SELECT
    fc.issue_key,
    fc.field_name,
    fc.from_value,
    fc.to_value,
    fc.changed_at,
    s.name        AS sprint_name,
    s.start_date  AS sprint_start
  FROM issue_field_changes fc
  JOIN sprints s ON (
    fc.to_value LIKE '%' || s.name || '%'
    AND fc.field_name = 'Sprint'
  )
  WHERE fc.from_value IS NOT NULL
    AND fc.field_name = 'Sprint'
`).all() as FieldChangeRow[];
```

> **Note** : le join `LIKE '%' || s.name || '%'` est nécessaire car `to_value` de Sprint dans le changelog Jira contient une représentation textuelle incluant le nom du sprint (ex: `"KECK Sprint 42, KECK Sprint 43"`), pas un ID numérique propre. Si la base est grande, ce LIKE peut être lent — acceptable pour une CLI (pas un endpoint temps-réel).

### Méthode `compute`

```typescript
export const scopeChangeMetric: Metric<ScopeChangeResult> = {
  name: "scope-change-rate",
  description: "Taux d'issues dont la description ou l'estimation a changé après entrée en sprint. Mesure la dérive de périmètre.",

  compute(db: Database.Database, _config: MetricConfig): ScopeChangeResult {
    // 1. Récupérer toutes les issues ayant eu un sprint
    const sprintedIssues = new Set<string>(
      (db.prepare(`
        SELECT DISTINCT issue_key FROM issue_field_changes WHERE field_name = 'Sprint'
      `).all() as { issue_key: string }[]).map((r) => r.issue_key)
    );

    // 2. Récupérer les changements post-sprint-start via la requête ci-dessus
    // 3. Classifier chaque changement
    // 4. Agréger par sprint et globalement
    // ...
  }
};
```

La logique de classification dans la boucle :
- `field_name` in `WATCHED_TEXT_FIELDS` + `from_value` non-null : appliquer `similarityRatio` → si < `SIMILARITY_THRESHOLD` → significatif
- `field_name === "Story Points"` + `from_value` non-null : toujours significatif
- `field_name === "Sprint"` + `from_value` non-null : toujours significatif (type `sprintChange`)

---

## 2. `src/metrics/index.ts` — enregistrement

```typescript
import { scopeChangeMetric } from "./scopeChange";
// ...
export const ALL_METRICS: Metric<unknown>[] = [
  // ... métriques existantes ...
  scopeChangeMetric,
];
```

---

## 3. `src/snapshots/compute.ts` — skip explicite

Dans `computeSnapshot`, ajouter un skip par nom comme pour `forecast` :

```typescript
if (metric.name === "scope-change-rate") { continue; }
```

Raison : sortie `bySprint` ne s'insère pas dans le format `(snapshot_date, bucket, stat)` weekly. Calculé live dans le rapport (ticket 033).

---

## Ordre d'implémentation

1. Types `SprintScopeStats` + `ScopeChangeResult` dans `scopeChange.ts`
2. `normalizeText` + `levenshtein` + `similarityRatio` — tester unitairement en premier (cœur du filtre trivial)
3. Requête SQL : valider manuellement sur la base locale avec des cas connus
4. `compute()` complet
5. Enregistrement dans `index.ts`
6. Skip dans `compute.ts`
7. Tests : diff triviale (espace/typo), diff significative (paragraphe supprimé), story points, sprint change, issue sans sprint
