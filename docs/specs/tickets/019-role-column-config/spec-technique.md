# Spec technique — Role column config

## Impact fichiers

| Fichier | Modification |
|---|---|
| `src/main.ts` | Ajouter `RoleType`, étendre `BoardColumn`, `DerivedStatusConfig`, `deriveStatusConfig()`, `mergeColumns()` |
| `board.example.yaml` | Documenter la propriété `role` avec exemples commentés |

---

## 1. `src/main.ts` — Types et interfaces

### Nouveau type exporté (ligne 16, avant `ColumnType`)

```typescript
export type RoleType = "dev" | "qa" | "po";
```

### Extension de `BoardColumn` (ligne 18–24)

```typescript
export interface BoardColumn {
  name: string;
  type: ColumnType;
  devStart?: boolean;
  role?: RoleType;          // ← ajout
  statuses: string[];
  legacyStatuses?: string[];
}
```

### Extension de `DerivedStatusConfig` (ligne 31–38)

```typescript
interface DerivedStatusConfig {
  todoStatuses: string[];
  devStartStatuses: string[];
  inProgressStatuses: string[];
  activeStatuses: string[];
  queueStatuses: string[];
  doneStatuses: string[];
  devStatuses: string[];    // ← ajout
  qaStatuses: string[];     // ← ajout
  poStatuses: string[];     // ← ajout
}
```

---

## 2. `src/main.ts` — `deriveStatusConfig()` (ligne 40–57)

Ajouter le calcul des groupes role-based après les groupes existants :

```typescript
export function deriveStatusConfig(board: BoardConfig): DerivedStatusConfig {
  const effectiveStatuses = (c: BoardColumn): string[] => [...c.statuses, ...(c.legacyStatuses ?? [])];
  const byType = (type: ColumnType): string[] =>
    board.columns.filter((c) => c.type === type).flatMap(effectiveStatuses);
  const byRole = (role: RoleType): string[] =>
    board.columns.filter((c) => c.role === role).flatMap(effectiveStatuses);
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
    devStatuses: unique(byRole("dev")),
    qaStatuses: unique(byRole("qa")),
    poStatuses: unique(byRole("po")),
  };
}
```

---

## 3. `src/main.ts` — `mergeColumns()` (ligne 338–369)

Ajouter `role: prev.role` dans le spread qui préserve les champs manuels :

```typescript
return {
  ...col,
  type: prev.type,
  devStart: prev.devStart,
  role: prev.role,          // ← ajout
  legacyStatuses: prev.legacyStatuses,
  queueKeyword: undefined,
};
```

---

## 4. `board.example.yaml`

Ajouter `role:` en exemple commenté sur les colonnes intermédiaires, après `devStart` :

```yaml
- name: "Développement"
  type: active
  devStart: true
  # role: dev   # optionnel — qui travaille dans cette colonne (dev | qa | po)
  statuses:
    - "In Progress"

- name: "Review"
  type: queue
  # role: qa   # optionnel
  statuses:
    - "In Review"
```

---

## Ordre d'implémentation

1. Ajouter `RoleType` et étendre `BoardColumn` — compilation immédiatement vérifiable
2. Étendre `DerivedStatusConfig` et `deriveStatusConfig()` — TypeScript force la complétude du type retourné
3. Mettre à jour `mergeColumns()` — préserver `role` lors d'`autoconfig --apply`
4. Mettre à jour `board.example.yaml`
5. Écrire les tests TDD pour `deriveStatusConfig` (colonnes avec/sans role, groupes vides, colonne `done` avec role) et `mergeColumns` (role préservé)

## Notes

`renderBoardColumnsYaml()` n'est pas modifiée : `autoconfig` n'émet pas `role` (ajout
manuel uniquement). Si besoin futur, émettre `role` quand présent sur la colonne source.

`MetricConfig` dans `src/metrics/types.ts` n'est pas modifié dans ce ticket. Les tickets
021–025 ajouteront `devStatuses / qaStatuses / poStatuses` à `MetricConfig` selon leurs
besoins, et `buildMetricConfig()` dans `main.ts` les transmettra depuis `DerivedStatusConfig`.
