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

### `similarityRatio` — dénominateur original

Remplacer la fonction entière :

```typescript
export function similarityRatio(from: string, to: string): number {
  const a = normalizeText(from);
  const b = normalizeText(to);
  if (a.length === 0) {return b.length === 0 ? 1 : 0;}
  // Dénominateur = longueur du texte original : mesure la dérive relative à l'état de référence.
  // Un ajout de N% donne sim = 1-N% ; détecté si N > ~15% (seuil 0.85).
  return Math.max(0, 1 - levenshtein(a, b) / a.length);
}
```

Supprimer le `pure-addition guard` (`if (b.length > a.length && dist === b.length - a.length)`).
Supprimer la variable `maxLen`.

### Pré-calcul `firstDevStartByIssue` — avant la boucle principale

Ajouter après la construction de `byIssue` :

```typescript
const devStartPlaceholders = config.devStartStatuses.map(() => "?").join(",");
const devStartRows = db.prepare(`
  SELECT issue_key, MIN(transitioned_at) AS first_dev_start
  FROM transitions
  WHERE to_status IN (${devStartPlaceholders})
  GROUP BY issue_key
`).all(...config.devStartStatuses) as { issue_key: string; first_dev_start: string }[];
const firstDevStartByIssue = new Map(devStartRows.map(r => [r.issue_key, r.first_dev_start]));
```

### Boucle de détection — first vs last par champ + grace period depuis devStart

Remplacer la boucle actuelle :

```typescript
for (const [issueKey, changes] of byIssue) {
  const { firstSprintName } = findFirstSprint(changes, sprintStartByName);
  if (!firstSprintName || !bySprint[firstSprintName]) { continue; }

  const firstDevStart = firstDevStartByIssue.get(issueKey);
  if (!firstDevStart) { continue; } // jamais démarré → skip détection

  const graceCutoff = gracePeriodMs > 0
    ? new Date(Date.parse(firstDevStart) + gracePeriodMs).toISOString()
    : firstDevStart;

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

  let descriptionChanged = false;
  for (const { first, last } of fieldStates.values()) {
    if (similarityRatio(first, last) < SIMILARITY_THRESHOLD) {
      descriptionChanged = true;
      break;
    }
  }
  // ... suite inchangée
}
```

**Suppression** : `firstSprintStart` n'est plus utilisé comme borne de détection. `findFirstSprint` retourne uniquement `firstSprintName`.

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
