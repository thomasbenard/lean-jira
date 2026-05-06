# Spec technique — scope-change-rate : détection description uniquement

## Impact fichiers

| Fichier | Modification |
|---|---|
| `src/metrics/scopeChange.ts` | Supprimer `storyPoints`/`sprintChange` des interfaces et de la boucle de détection |
| `src/report/generate.ts` | Simplifier `IssueRow` et la colonne "Type" |
| `tests/metrics/scopeChange.test.ts` | Supprimer Règle 2 (Story Points) et Règle 4 (Sprint change), adapter Règle 1 |
| `tests/report/generate.test.ts` | Adapter les assertions sur la colonne Type si présentes |

---

## 1. `src/metrics/scopeChange.ts`

### Interfaces — retirer `storyPoints` et `sprintChange`

```typescript
export interface ScopeChangedIssueDetail {
  key: string;
  description: boolean;
  // storyPoints et sprintChange supprimés
}

export interface SprintScopeStats {
  totalIssues: number;
  changedIssues: number;
  changeRatio: number;
  byChangeType: {
    description: number;
    // storyPoints et sprintChange supprimés
  };
  issueDetails: ScopeChangedIssueDetail[];
}
```

### Constantes — supprimer `FIELD_STORY_POINTS`, conserver `FIELD_SPRINT`

```typescript
// Supprimer :
const FIELD_STORY_POINTS = "Story Points";
// Garder (utilisé par findFirstSprint) :
const FIELD_SPRINT = "Sprint";
```

### `emptySprintStats` — simplifier `byChangeType`

```typescript
function emptySprintStats(): SprintScopeStats {
  return {
    totalIssues: 0,
    changedIssues: 0,
    changeRatio: 0,
    byChangeType: { description: 0 },
    issueDetails: [],
  };
}
```

### Boucle de détection — supprimer branches Story Points et Sprint

```typescript
const types = { description: false };

for (const c of changes) {
  if (c.changed_at <= firstSprintStart) { continue; }
  if (WATCHED_TEXT_FIELDS.has(c.field_name)) {
    if (c.from_value !== null && similarityRatio(c.from_value, c.to_value ?? "") < SIMILARITY_THRESHOLD) {
      types.description = true;
    }
  }
}

if (types.description) {
  changedIssues++;
  changedIssueKeys.push(issueKey);
  bySprint[firstSprintName].changedIssues++;
  bySprint[firstSprintName].byChangeType.description++;
  bySprint[firstSprintName].issueDetails.push({ key: issueKey, ...types });
}
```

---

## 2. `src/report/generate.ts`

Ligne ~1795 — simplifier `IssueRow` et le calcul de `types` :

```typescript
type IssueRow = { sprint: string; description: boolean };
// ...
const types = row?.description ? "Description" : "—";
```

---

## 3. `tests/metrics/scopeChange.test.ts`

- **Supprimer** le bloc `describe("Règle 2 — Story Points", ...)` (~30 lignes)
- **Supprimer** le bloc `describe("Règle 4 — Sprint change", ...)` (~35 lignes)
- Dans les `beforeEach` des Règles 1/3, les `seedFieldChanges` avec `Sprint` restent nécessaires (attribution sprint). Pas de changement.
- Dans les tests Agrégation : retirer l'assertion `bySprint["Sprint 42"].byChangeType.storyPoints`

---

## Ordre d'implémentation

1. Modifier les interfaces dans `scopeChange.ts` (Red : les tests Règle 2 et 4 passeront toujours — les écrire en rouge d'abord si TDD strict, sinon les supprimer directement)
2. Simplifier `emptySprintStats` et la boucle de détection
3. Mettre à jour `generate.ts`
4. Supprimer / adapter les tests concernés
5. `npx vitest run` → vert
