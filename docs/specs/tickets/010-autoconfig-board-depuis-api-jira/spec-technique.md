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

Inférence basée sur la **position** : première colonne → `todo`, dernière → `done`, intermédiaires → `active`.
`statusCategory` sert uniquement à générer des avertissements inline sur les colonnes intermédiaires suspectes.

Ajouter avant la définition de `program` (ligne 160) :

```typescript
interface InferredColumn extends BoardColumn {
  warning?: string;
}

function inferBoardColumns(
  boardConfig: JiraBoardConfig,
  statuses: JiraStatus[],
): InferredColumn[] {
  const cols = boardConfig.columnConfig.columns;
  const statusById = new Map(statuses.map((s) => [s.id, s]));
  let devStartAssigned = false;

  return cols.map((col, index) => {
    const names = col.statuses.map(
      (s) => statusById.get(s.id)?.name ?? `# ID:${s.id} non résolu`,
    );
    const categories = col.statuses.map(
      (s) => statusById.get(s.id)?.statusCategory.key ?? "indeterminate",
    );

    let type: ColumnType;
    let warning: string | undefined;

    if (index === 0) {
      type = "todo";
    } else if (index === cols.length - 1) {
      type = "done";
    } else {
      type = "active";
      // Colonne intermédiaire dont les statuts sont classés "done" par Jira → suspect
      if (categories.every((k) => k === "done")) {
        warning = `⚠ statuts classés "done" par Jira — vérifier si type: done est plus approprié`;
      }
    }

    const column: InferredColumn = { name: col.name, type, statuses: names };
    if (warning) column.warning = warning;

    if (type === "active" && !devStartAssigned) {
      column.devStart = true;
      devStartAssigned = true;
    }

    return column;
  });
}
```

### Rendu YAML avec commentaires inline

Le package `yaml` ne supporte pas les commentaires programmatiques. Les avertissements sont rendus comme des lignes de commentaire YAML insérées manuellement avant la clé `type:` de la colonne concernée, via une étape de post-processing sur la chaîne YAML finale.

Alternative plus simple : construire le YAML colonne par colonne avec un template string, ce qui permet d'injecter les commentaires librement. Préférer cette approche à la sérialisation `yaml.stringify` pour la commande `autoconfig` uniquement.

### Commande CLI

```typescript
program
  .command("autoconfig")
  .description("Génère board.columns depuis l'API Jira (types inférés par position)")
  .option("-c, --config <path>", "Chemin vers config.yaml", "./config.yaml")
  .option("--apply", "Écrase board.columns dans config.yaml (destructif)")
  .action(async (opts) => {
    const config = loadConfig(path.resolve(opts.config));
    const client = new JiraClient(config.jira);

    const [boardConfig, allStatuses] = await Promise.all([
      client.fetchBoardConfiguration(),
      client.fetchAllStatuses(),
    ]);

    const cols = boardConfig.columnConfig.columns;
    if (cols.length === 0) {
      console.error("⚠ Board vide — aucune colonne détectée.");
      process.exit(1);
    }
    if (cols.length === 1) {
      console.warn("⚠ Board à une seule colonne — configuration probablement incomplète.");
    }

    const columns = inferBoardColumns(boardConfig, allStatuses);
    const hasDevStart = columns.some((c) => c.devStart);
    if (!hasDevStart) {
      console.warn("⚠ Aucune colonne intermédiaire — positionner devStart: true manuellement.");
    }

    if (opts.apply) {
      console.warn(`⚠ --apply va écraser board.columns dans ${opts.config}. Attente 3s…`);
      await new Promise((r) => setTimeout(r, 3000));
      const raw = fs.readFileSync(path.resolve(opts.config), "utf-8");
      const parsed = yaml.parse(raw) as AppConfig;
      // Supprimer warning avant sérialisation (champ interne non présent dans BoardColumn)
      parsed.board = { ...parsed.board, columns: columns.map(({ warning: _w, ...c }) => c) };
      fs.writeFileSync(path.resolve(opts.config), yaml.stringify(parsed), "utf-8");
      console.log("✓ board.columns mis à jour dans", opts.config);
    } else {
      console.log(`# Board "${boardConfig.name}" — généré automatiquement depuis l'API Jira`);
      console.log("# Vérifier devStart: true — positionné sur la première colonne intermédiaire par défaut");
      console.log("# Les colonnes intermédiaires sont en type: active — changer en \"queue\" pour les colonnes d'attente");
      console.log("# Ajouter legacyDoneStatuses si des statuts historiques n'apparaissent plus dans l'API\n");
      console.log(renderBoardColumnsYaml(columns));
    }
  });
```

### Fonction `renderBoardColumnsYaml()`

Génère le YAML manuellement pour pouvoir injecter des commentaires inline :

```typescript
function renderBoardColumnsYaml(columns: InferredColumn[]): string {
  const lines: string[] = ["board:", "  columns:"];
  for (const col of columns) {
    lines.push(`    - name: "${col.name}"`);
    if (col.warning) {
      lines.push(`      type: ${col.type}   # ${col.warning}`);
    } else if (col.type === "active" && !col.devStart) {
      lines.push(`      type: ${col.type}   # changer en "queue" si temps d'attente`);
    } else {
      lines.push(`      type: ${col.type}`);
    }
    if (col.devStart) {
      lines.push(`      devStart: true   # première colonne intermédiaire — vérifier si correct`);
    }
    if (col.statuses.length === 0) {
      lines.push(`      statuses: []   # aucun statut associé`);
    } else {
      lines.push("      statuses:");
      for (const s of col.statuses) {
        lines.push(`        - "${s}"`);
      }
    }
    lines.push("");
  }
  return lines.join("\n");
}
```

Import à ajouter : `JiraClient` depuis `./jira/client`, `JiraBoardConfig`, `JiraStatus` depuis `./jira/types`.

---

## Ordre d'implémentation

1. `src/jira/types.ts` — ajouter `JiraBoardColumnRaw` et `JiraBoardConfig`
2. `src/jira/client.ts` — ajouter `fetchBoardConfiguration()` + import du type
3. `src/main.ts` — ajouter `inferBoardColumns()`, `renderBoardColumnsYaml()`, commande `autoconfig` + imports
4. Tests : `inferBoardColumns()` (position première/dernière/intermédiaire, warning catégorie done, devStart, board 1 colonne, board 2 colonnes, IDs non résolus)
