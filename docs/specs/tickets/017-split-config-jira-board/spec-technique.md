# Spec technique — Split config : séparation credentials Jira / config board

## Impact fichiers

| Fichier | Modification |
|---|---|
| `src/main.ts` | Split `AppConfig`, remplacement `loadConfig`, flag `-b` sur 4 commandes, `autoconfig --apply` écrit `board.yaml` |
| `config.example.yaml` | Suppression sections `board` et `metrics` |
| `board.example.yaml` | Nouveau fichier — template board+metrics (sections board+metrics de l'ancien `config.example.yaml`) |
| `.gitignore` | Ajout `board.yaml.bak` |
| `tests/main/config.test.ts` | Nouveaux scénarios pour `loadConfigs` |

---

## 1. `src/main.ts` — Split de `AppConfig` (ligne 100–114)

Remplacer l'interface unique par deux interfaces + un type fusionné :

```typescript
// Fichier config.yaml (gitignored, secrets)
interface JiraFileConfig {
  jira: {
    baseUrl: string;
    email: string;
    apiToken: string;
    projectKey: string;
    boardId: number;
  };
  db: { path: string };
}

// Fichier board.yaml (commitable, config board + métriques)
interface BoardFileConfig {
  board: BoardConfig;
  metrics?: {
    cutoffDate?: string;
    bugIssueTypes?: string[];
  };
}

type AppConfig = JiraFileConfig & BoardFileConfig;
```

---

## 2. `src/main.ts` — Remplacement de `loadConfig` (ligne 116–119)

Supprimer `loadConfig`. Ajouter trois fonctions :

```typescript
function loadJiraConfig(configPath: string): JiraFileConfig {
  return yaml.parse(fs.readFileSync(configPath, "utf-8")) as JiraFileConfig;
}

function loadBoardConfig(boardPath: string): BoardFileConfig {
  if (!fs.existsSync(boardPath)) {
    console.error(`board.yaml introuvable : ${boardPath}`);
    console.error(`Lancer d'abord : npm run autoconfig -- --apply`);
    process.exit(1);
  }
  return yaml.parse(fs.readFileSync(boardPath, "utf-8")) as BoardFileConfig;
}

function loadConfigs(configPath: string, boardPath: string): AppConfig {
  return { ...loadJiraConfig(configPath), ...loadBoardConfig(boardPath) };
}
```

---

## 3. `src/main.ts` — Mise à jour des commandes

### `sync` (ligne 293–299)

Retirer la dépendance à `board.yaml`. Utiliser `loadJiraConfig` seul :

```typescript
program
  .command("sync")
  .option("-c, --config <path>", "Chemin vers config.yaml", "./config.yaml")
  .action(async (opts) => {
    const config = loadJiraConfig(path.resolve(opts.config));
    await sync(config);
  });
```

`SyncConfig` dans `src/sync.ts` (ligne 5–14) est déjà restreint à `jira` + `db` — aucun
changement requis dans ce fichier.

### `metrics`, `snapshots`, `report`, `validate-config`

Ajouter le flag `-b` et remplacer `loadConfig` par `loadConfigs` dans chaque commande.
Exemple pour `metrics` (ligne 302–322) :

```typescript
program
  .command("metrics")
  .option("-c, --config <path>", "Chemin vers config.yaml", "./config.yaml")
  .option("-b, --board-config <path>", "Chemin vers board.yaml", "./board.yaml")
  // ... autres options inchangées ...
  .action((opts) => {
    const config = loadConfigs(path.resolve(opts.config), path.resolve(opts.boardConfig));
    // ... reste identique ...
  });
```

Même pattern pour `snapshots` (ligne 324–334), `report` (ligne 336–347), `validate-config`
(ligne 349–399).

### `autoconfig` (ligne 401–459)

Ajouter le flag `-b`. Modifier `--apply` pour écrire dans `board.yaml` :

```typescript
program
  .command("autoconfig")
  .option("-c, --config <path>", "Chemin vers config.yaml", "./config.yaml")
  .option("-b, --board-config <path>", "Chemin vers board.yaml", "./board.yaml")
  .option("--apply", "Écrase board.yaml (destructif)")
  .action(async (opts) => {
    const config = loadJiraConfig(path.resolve(opts.config));
    // ... fetchBoardConfiguration, inferBoardColumns, enrichWithLegacyStatuses
    //     identiques à aujourd'hui ...

    if (opts.apply) {
      const boardPath = path.resolve(opts.boardConfig);
      console.warn(`⚠ --apply va créer/écraser ${opts.boardConfig}. Attente 3s…`);
      await new Promise((r) => setTimeout(r, 3000));

      if (fs.existsSync(boardPath)) {
        fs.copyFileSync(boardPath, boardPath + ".bak");
      }

      const newBoard: BoardFileConfig = {
        board: {
          columns: columns.map(({ warning: _w, ...c }) => c),
          ...(result.unresolvable.length > 0 && { legacyDoneStatuses: [] }),
        },
        metrics: { bugIssueTypes: ["Bug"] },
      };
      fs.writeFileSync(boardPath, yaml.stringify(newBoard), "utf-8");
      console.log("✓ board.yaml créé :", opts.boardConfig);
    } else {
      // dry-run : stdout identique à aujourd'hui
    }
  });
```

Note : la ligne `const config = loadConfig(path.resolve(opts.config))` (actuelle, ligne 407)
devient `loadJiraConfig`. Les `config.board` et `config.metrics` n'étant pas utilisés dans
`autoconfig` sans `--apply`, aucune autre adaptation n'est requise dans cette commande.

---

## 4. `config.example.yaml`

Supprimer les sections `board` et `metrics`. Garder uniquement :

```yaml
jira:
  # Pour Atlassian Cloud avec custom domain...
  baseUrl: "https://jira.your-company.com"
  email: "your.email@company.com"
  apiToken: "YOUR_API_TOKEN"
  projectKey: "YOUR_PROJECT_KEY"
  boardId: 1

db:
  path: "./lean-jira.db"
```

---

## 5. `board.example.yaml` (nouveau)

Déplacer les sections `board` et `metrics` de l'ancien `config.example.yaml` vers ce nouveau
fichier. Conserver tous les commentaires explicatifs.

---

## 6. `.gitignore`

Ajouter sous `config.yaml.bak` :
```
board.yaml.bak
```

---

## Ordre d'implémentation

1. Tests `loadConfigs` — red (fichier manquant, merge correct, board absent → exit 1)
2. `JiraFileConfig` / `BoardFileConfig` / `loadJiraConfig` / `loadBoardConfig` / `loadConfigs`
3. Mise à jour commande `sync` (utilise `loadJiraConfig`)
4. Mise à jour commandes `metrics`, `snapshots`, `report`, `validate-config` (flag `-b` + `loadConfigs`)
5. Mise à jour commande `autoconfig --apply` (écrit `board.yaml`)
6. Mise à jour `config.example.yaml`, création `board.example.yaml`, `.gitignore`

## Relation ticket 016

Ticket 016 (`mergeColumns`, preserve config existant) cible la commande `autoconfig --apply`.
Après ce ticket, la ligne `const config = loadConfig(...)` dans 016's spec-technique devient
`loadJiraConfig(...)`, et `parsed.board.columns` / `parsed.board.legacyDoneStatuses` se lisent
depuis un `BoardFileConfig` chargé via `loadBoardConfig(boardPath)`. Le reste de la logique
016 est inchangé.
