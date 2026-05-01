# Spec technique — `legacyStatuses` par colonne

## Impact fichiers

| Fichier | Modification |
|---|---|
| `src/main.ts` | `BoardColumn` +1 champ, `deriveStatusConfig` helper `effectiveStatuses`, `validateStatusConfig` +1 param, commande `validate-config` passe `legacyNames` |
| `tests/main/validateConfig.test.ts` | +2 scénarios (legacy non-done reconnu ; legacy présent en DB = `found: true`) |
| `tests/config/deriveStatusConfig.test.ts` | +1 scénario (`legacyStatuses` inclus dans listes dérivées) |

---

## 1. `src/main.ts` — `BoardColumn`

Ajouter `legacyStatuses` (ligne 16, après `statuses: string[]`) :

```typescript
export interface BoardColumn {
  name: string;
  type: ColumnType;
  devStart?: boolean;
  statuses: string[];
  legacyStatuses?: string[];
}
```

---

## 2. `src/main.ts` — `deriveStatusConfig`

Introduire un helper local `effectiveStatuses` qui fusionne `statuses` et `legacyStatuses` pour une colonne, puis l'utiliser partout à la place de `c.statuses` :

```typescript
export function deriveStatusConfig(board: BoardConfig): DerivedStatusConfig {
  const effectiveStatuses = (c: BoardColumn): string[] => [
    ...c.statuses,
    ...(c.legacyStatuses ?? []),
  ];
  const byType = (type: ColumnType): string[] =>
    board.columns.filter((c) => c.type === type).flatMap(effectiveStatuses);
  const unique = (arr: string[]): string[] => [...new Set(arr)];

  const active = byType("active");
  const queue = byType("queue");

  return {
    todoStatuses: unique(byType("todo")),
    devStartStatuses: unique(board.columns.filter((c) => c.devStart).flatMap(effectiveStatuses)),
    inProgressStatuses: unique([...active, ...queue]),
    activeStatuses: unique(active),
    queueStatuses: unique(queue),
    doneStatuses: unique([...byType("done"), ...(board.legacyDoneStatuses ?? [])]),
  };
}
```

---

## 3. `src/main.ts` — `validateStatusConfig`

Ajouter un troisième paramètre optionnel `legacyNames` :

```typescript
export function validateStatusConfig(
  sections: Array<{ label: string; statuses: string[] }>,
  dbStatuses: Array<{ name: string; categoryKey: string }>,
  legacyNames?: Set<string>,
): ValidationResult {
  const dbNames = new Set(dbStatuses.map((s) => s.name));
  let missingCount = 0;
  const resultSections: ValidationSection[] = [];

  for (const { label, statuses } of sections) {
    if (statuses.length === 0) continue;
    const entries: ValidationEntry[] = statuses.map((name) => {
      const found = dbNames.has(name);
      const isLegacy = !found && (label === LEGACY_SECTION_LABEL || (legacyNames?.has(name) ?? false));
      if (!found && !isLegacy) missingCount++;
      return { name, found, isLegacy };
    });
    resultSections.push({ label, entries });
  }

  return { sections: resultSections, missingCount };
}
```

Le paramètre est optionnel → aucune régression sur les appels existants (tests, autres usages).

---

## 4. `src/main.ts` — commande `validate-config`

Construire `legacyNames` depuis `config.board.columns` et le passer à `validateStatusConfig` (ligne 248) :

```typescript
const legacyNames = new Set(
  config.board.columns.flatMap((c) => c.legacyStatuses ?? []),
);
const result = validateStatusConfig(sections, dbStatuses, legacyNames);
```

---

## Ordre d'implémentation

1. Modifier `BoardColumn` dans `src/main.ts`
2. Modifier `deriveStatusConfig` dans `src/main.ts`
3. Modifier `validateStatusConfig` dans `src/main.ts`
4. Modifier commande `validate-config` dans `src/main.ts`
5. Tests `validateConfig.test.ts` (+2 scénarios)
6. Tests `deriveStatusConfig.test.ts` (+1 scénario)
7. Mettre à jour `config.yaml` : déplacer noms anglais de `statuses` vers `legacyStatuses` dans chaque colonne
