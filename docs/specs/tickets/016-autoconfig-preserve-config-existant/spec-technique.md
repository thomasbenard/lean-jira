# Spec technique — autoconfig : préservation du config existant

## Impact fichiers

| Fichier | Modification |
|---|---|
| `src/main.ts` | Nouvelle fonction exportée `mergeColumns()` ; mise à jour de la commande `autoconfig` |
| `tests/main/autoconfig.test.ts` | Nouveaux scénarios pour `mergeColumns()` |

---

## 1. `src/main.ts` — `mergeColumns()`

Ajouter après `enrichWithLegacyStatuses()` (ligne ~293) :

```typescript
export function mergeColumns(
  existing: BoardColumn[],
  inferred: InferredColumn[],
): InferredColumn[] {
  const existingByName = new Map(existing.map((c) => [c.name, c]));
  const inferredNames = new Set(inferred.map((c) => c.name));

  const merged: InferredColumn[] = inferred.map((col) => {
    const prev = existingByName.get(col.name);
    if (!prev) return col;
    return {
      ...col,
      type: prev.type,
      devStart: prev.devStart,
      legacyStatuses: prev.legacyStatuses,
    };
  });

  for (const col of existing) {
    if (!inferredNames.has(col.name)) {
      console.warn(`⚠ Colonne absente du board Jira : "${col.name}" — supprimée du board ou renommée ?`);
      merged.push({ ...col });
    }
  }

  return merged;
}
```

**Règles** :
- Match par `name` exact (sensible à la casse, cohérent avec Jira).
- `statuses` de la colonne matchée = ceux de `inferred` (liste courante API), pas ceux de `existing`.
- `type`, `devStart`, `legacyStatuses` = ceux de `existing` (préservés).
- Colonnes absentes de l'API → conservées à la fin du tableau, warning stderr.

---

## 2. `src/main.ts` — commande `autoconfig`

Remplacer l'appel à `inferBoardColumns()` (ligne ~433) par une détection du mode :

```typescript
const hasExistingColumns = (config.board?.columns?.length ?? 0) > 0;

const columns = hasExistingColumns
  ? mergeColumns(config.board.columns, inferBoardColumns(boardConfig, allStatuses))
  : inferBoardColumns(boardConfig, allStatuses);

// Warning pour nouvelles colonnes (absentes de config existante)
if (hasExistingColumns) {
  const existingNames = new Set(config.board.columns.map((c: BoardColumn) => c.name));
  for (const col of columns) {
    if (!existingNames.has(col.name)) {
      console.warn(`⚠ Nouvelle colonne détectée : "${col.name}" — vérifier type et devStart`);
    }
  }
}
```

Fusion `legacyDoneStatuses` dans le bloc `--apply` — remplacer la ligne actuelle (ligne ~460) :

```typescript
// Avant :
legacyDoneStatuses: legacyDoneStatuses.length > 0 ? legacyDoneStatuses : parsed.board.legacyDoneStatuses,

// Après :
legacyDoneStatuses: [
  ...(parsed.board.legacyDoneStatuses ?? []),
  ...legacyDoneStatuses.filter((s) => !(parsed.board.legacyDoneStatuses ?? []).includes(s)),
].filter((_, i, arr) => arr.indexOf(_) === i) || undefined,
```

Simplification : utiliser `Set` pour la déduplication :

```typescript
const existingLegacyDone = parsed.board.legacyDoneStatuses ?? [];
const mergedLegacyDone = [...new Set([...existingLegacyDone, ...legacyDoneStatuses])];
parsed.board = {
  ...parsed.board,
  columns: columns.map(({ warning: _w, ...c }) => c),
  ...(mergedLegacyDone.length > 0 && { legacyDoneStatuses: mergedLegacyDone }),
};
```

---

## Ordre d'implémentation

1. `mergeColumns()` dans `src/main.ts` — TDD red/green
2. Tests `mergeColumns()` dans `tests/main/autoconfig.test.ts`
3. Intégration dans la commande `autoconfig` (détection `hasExistingColumns`, fusion `legacyDoneStatuses`)
4. Tests intégration commande (warning nouvelle colonne, warning colonne absente)
