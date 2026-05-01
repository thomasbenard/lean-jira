# Spec technique — Autoconfiguration du board depuis l'API Jira

## Impact fichiers

| Fichier | Modification |
|---|---|
| `src/jira/types.ts` | Ajout interfaces `JiraBoardConfig`, `JiraBoardColumnRaw` |
| `src/jira/client.ts` | Ajout méthode `fetchBoardConfiguration(): Promise<JiraBoardConfig>` |
| `src/main.ts` | Ajout commande `autoconfig`, fonction `inferBoardColumns()` |

---

## 1. `src/jira/types.ts` — Nouveaux types

Ajouter après `JiraSprint` (ligne 32) :

```typescript
export interface JiraBoardColumnRaw {
  name: string;
  statuses: Array<{ id: string; self: string }>;
}

export interface JiraBoardConfig {
  id: number;
  name: string;
  columnConfig: {
    columns: JiraBoardColumnRaw[];
  };
}
```

L'endpoint `/rest/agile/1.0/board/{boardId}/configuration` retourne les status IDs uniquement (pas les noms). Le cross-reference avec `JiraStatus[]` (qui contient déjà `id`, `name`, `statusCategory`) est fait côté `main.ts`.

---

## 2. `src/jira/client.ts` — `fetchBoardConfiguration()`

Ajouter après `fetchAllSprints()` (ligne 80) :

```typescript
async fetchBoardConfiguration(): Promise<JiraBoardConfig> {
  const response = await this.http.get(
    `/rest/agile/1.0/board/${this.boardId}/configuration`,
  );
  return response.data as JiraBoardConfig;
}
```

Import à ajouter dans l'en-tête : `JiraBoardConfig` depuis `./types`.

---

## 3. `src/main.ts` — Commande `autoconfig`

### Fonction `inferBoardColumns()`

Ajouter avant la définition de `program` (ligne 160) :

```typescript
function inferBoardColumns(
  boardConfig: JiraBoardConfig,
  statuses: JiraStatus[],
): BoardColumn[] {
  const statusById = new Map(statuses.map((s) => [s.id, s]));
  let devStartAssigned = false;

  return boardConfig.columnConfig.columns.map((col) => {
    const resolved = col.statuses.map((s) => statusById.get(s.id));
    const names = col.statuses.map((s) => statusById.get(s.id)?.name ?? `# ID:${s.id} non résolu`);
    const categories = resolved.map((s) => s?.statusCategory.key ?? "indeterminate");

    let type: ColumnType;
    if (categories.every((k) => k === "done")) {
      type = "done";
    } else if (categories.every((k) => k === "new")) {
      type = "todo";
    } else {
      type = "active";
    }

    const column: BoardColumn = { name: col.name, type, statuses: names };

    if (type === "active" && !devStartAssigned) {
      column.devStart = true;
      devStartAssigned = true;
    }

    return column;
  });
}
```

Types à importer : `JiraBoardConfig`, `JiraStatus` depuis `./jira/types`.

### Commande CLI

```typescript
program
  .command("autoconfig")
  .description("Génère board.columns depuis l'API Jira (statuts et types inférés automatiquement)")
  .option("-c, --config <path>", "Chemin vers config.yaml", "./config.yaml")
  .option("--apply", "Écrase board.columns dans config.yaml (destructif)")
  .action(async (opts) => {
    const config = loadConfig(path.resolve(opts.config));
    const client = new JiraClient(config.jira);

    const [boardConfig, allStatuses] = await Promise.all([
      client.fetchBoardConfiguration(),
      client.fetchAllStatuses(),
    ]);

    if (boardConfig.columnConfig.columns.length === 0) {
      console.warn("⚠ Board vide — aucune colonne détectée.");
      process.exit(1);
    }

    const columns = inferBoardColumns(boardConfig, allStatuses);
    const hasDevStart = columns.some((c) => c.devStart);
    if (!hasDevStart) {
      console.warn("⚠ Aucune colonne active détectée — positionner devStart: true manuellement.");
    }

    const boardSection = yaml.stringify({ board: { columns } });

    if (opts.apply) {
      console.warn(`⚠ --apply va écraser board.columns dans ${opts.config}. Attente 3s…`);
      await new Promise((r) => setTimeout(r, 3000));
      const raw = fs.readFileSync(path.resolve(opts.config), "utf-8");
      const parsed = yaml.parse(raw) as AppConfig;
      parsed.board = { ...parsed.board, columns };
      fs.writeFileSync(path.resolve(opts.config), yaml.stringify(parsed), "utf-8");
      console.log("✓ board.columns mis à jour dans", opts.config);
    } else {
      console.log(`# Board "${boardConfig.name}" — généré automatiquement depuis l'API Jira`);
      console.log("# Vérifier devStart: true — positionné sur la première colonne active par défaut");
      console.log("# Ajouter legacyDoneStatuses si des statuts historiques n'apparaissent plus dans l'API\n");
      console.log(boardSection);
    }
  });
```

Import à ajouter : `JiraClient` depuis `./jira/client`.

---

## Ordre d'implémentation

1. `src/jira/types.ts` — ajouter `JiraBoardColumnRaw` et `JiraBoardConfig`
2. `src/jira/client.ts` — ajouter `fetchBoardConfiguration()` + import du type
3. `src/main.ts` — ajouter `inferBoardColumns()` + commande `autoconfig` + imports
4. Tests : `inferBoardColumns()` (inférence types, colonnes mixtes, aucune active, IDs non résolus, devStart placement)
