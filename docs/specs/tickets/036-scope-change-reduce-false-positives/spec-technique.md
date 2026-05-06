# Spec technique — scope-change-rate : réduire les faux positifs

## Impact fichiers

| Fichier | Modification |
|---|---|
| `src/metrics/scopeChange.ts` | `normalizeText` étendu ; boucle de détection remplacée par first-vs-last par champ ; pure-addition guard ; grace period |
| `src/metrics/types.ts` | Ajouter `scopeChangeGracePeriodHours?: number` à `MetricConfig` |
| `src/main.ts` | Câbler `metrics.scopeChangeGracePeriodHours` → `MetricConfig` |
| `tests/metrics/scopeChange.test.ts` | Nouveaux scénarios par règle |

---

## 1. `src/metrics/scopeChange.ts`

### `normalizeText` — étendre les strips

```typescript
export function normalizeText(s: string): string {
  return s
    .replace(/\{[^}]*\}/g, " ")                    // macros Jira : {panel:title=Foo}, {color:#f00}
    .replace(/![^!\s][^!]*!/g, " ")                 // images : !img.png!, !img.png|thumbnail!
    .replace(/\[([^\]|]+)\|[^\]]+\]/g, "$1")        // liens : [texte|URL] → texte
    .toLowerCase()
    .replace(/[*_#>`~\[\]()]/g, " ")
    .replace(/`{1,3}/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
```

### `similarityRatio` — pure-addition guard

Ajouter après calcul du levenshtein, avant le `return` :

```typescript
export function similarityRatio(from: string, to: string): number {
  const a = normalizeText(from);
  const b = normalizeText(to);
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) { return 1; }
  const dist = levenshtein(a, b);
  // Addition pure : seules des insertions, aucune substitution ni suppression.
  // Enrichissement sans réécriture → pas de dérive de périmètre.
  if (b.length > a.length && dist === b.length - a.length) { return 1; }
  return 1 - dist / maxLen;
}
```

### Boucle de détection — first vs last par champ + grace period

Remplacer la boucle actuelle (lignes 165-175) :

```typescript
// Calcul du cutoff grace period (en ms depuis epoch)
const gracePeriodHours = config.scopeChangeGracePeriodHours ?? 0;
const graceCutoff = gracePeriodHours > 0
  ? new Date(new Date(firstSprintStart).getTime() + gracePeriodHours * 3_600_000).toISOString()
  : firstSprintStart;

// first vs last par champ surveillé
type FieldState = { first: string; last: string };
const fieldStates = new Map<string, FieldState>();

for (const c of changes) {
  if (c.changed_at <= graceCutoff) { continue; }
  if (!WATCHED_TEXT_FIELDS.has(c.field_name) || c.from_value === null) { continue; }
  if (!fieldStates.has(c.field_name)) {
    fieldStates.set(c.field_name, { first: c.from_value, last: c.to_value ?? "" });
  } else {
    fieldStates.get(c.field_name)!.last = c.to_value ?? "";
  }
}

const descriptionChanged = [...fieldStates.values()].some(
  ({ first, last }) => similarityRatio(first, last) < SIMILARITY_THRESHOLD,
);
```

Supprimer la variable `descriptionChanged = false` et la boucle `for` existante.

---

## 2. `src/metrics/types.ts`

```typescript
export interface MetricConfig {
  // ... champs existants ...
  // Heures de grace après début de sprint avant de considérer un changement comme post-sprint.
  // Couvre le nettoyage de description en sprint planning. Défaut 0 (désactivé).
  scopeChangeGracePeriodHours?: number;
}
```

---

## 3. `src/main.ts`

Localiser `buildMetricConfig` (ou la fonction équivalente qui construit `MetricConfig` depuis `board.yaml`). Ajouter :

```typescript
scopeChangeGracePeriodHours: boardConfig.metrics?.scopeChangeGracePeriodHours,
```

Même pattern que `cutoffDate`, `excludeIssueTypes`, etc.

---

## 4. `tests/metrics/scopeChange.test.ts`

Nouveaux blocs `describe` à ajouter (un par règle) :

- **Règle 6 — First vs last** : issue avec 3 modifications consécutives chacune < seuil mais delta cumulé > seuil → détectée. Issue avec 3 modifications dont le delta cumulé reste < seuil → non détectée.
- **Règle 7 — Grace period** : changement dans les 24h post-sprint-start → ignoré. Changement à 25h → évalué.
- **Règle 8 — Macros Jira** : changement de `{panel:title=Foo}texte{panel}` → `{panel:title=Bar}texte{panel}` → `similarityRatio = 1.0` → non détecté.
- **Règle 9 — Addition pure** : `from = "ABC"`, `to = "ABCDEF"` → `similarityRatio = 1.0`. `from = "ABCDEF"`, `to = "ABC"` (suppression) → similarityRatio calculé normalement.

Tests `normalizeText` unitaires à ajouter dans le bloc existant (ou nouveau `describe("normalizeText")`).

---

## Ordre d'implémentation

1. TDD `normalizeText` — écrire tests unitaires macro/image/lien → rouge → étendre la fonction → vert
2. TDD `similarityRatio` — addition pure → rouge → guard dans `similarityRatio` → vert
3. TDD Règle 6 (first vs last) — scénario accumulation → rouge → restructurer la boucle → vert
4. TDD Règle 7 (grace period) — → rouge → câbler `graceCutoff` → vert
5. Ajouter `scopeChangeGracePeriodHours` dans `types.ts` + câblage `main.ts`
6. `npx vitest run` → vert complet
