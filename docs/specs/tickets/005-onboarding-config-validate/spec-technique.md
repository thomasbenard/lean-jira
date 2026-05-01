# Spec technique — Onboarding : config example + validate-config

## Impact fichiers

| Fichier | Modification |
|---|---|
| `config.example.yaml` | Nouveau fichier à la racine |
| `src/db/store.ts` | Ajouter `getAllStatuses()` |
| `src/main.ts` | Types `ValidationEntry/Section/Result`, fonction `validateStatusConfig()`, commande `validate-config` |
| `package.json` | Nouveau script `validate` |

---

## 1. `config.example.yaml`

Voir le fichier à la racine du projet.

---

## 2. `src/db/store.ts` — `getAllStatuses()`

```typescript
export function getAllStatuses(db: Database.Database): Array<{ name: string; categoryKey: string }> {
  return db.prepare("SELECT name, category_key AS categoryKey FROM statuses ORDER BY name").all() as Array<{ name: string; categoryKey: string }>;
}
```

---

## 3. `src/main.ts` — logique de validation + commande CLI

### Types exportés

```typescript
export interface ValidationEntry { name: string; found: boolean; isLegacy: boolean; }
export interface ValidationSection { label: string; entries: ValidationEntry[]; }
export interface ValidationResult { sections: ValidationSection[]; missingCount: number; }
```

### `validateStatusConfig()` — pure, exportée, testable

```typescript
export function validateStatusConfig(
  sections: Array<{ label: string; statuses: string[] }>,
  dbStatuses: Array<{ name: string; categoryKey: string }>,
): ValidationResult
```

Parcourt chaque section. Si `statuses.length === 0` : skip. Statut absent dans `doneStatuses` : `isLegacy = true`, non comptabilisé dans `missingCount`. Statut absent ailleurs : `missingCount++`.

### Commande `validate-config`

```typescript
program
  .command("validate-config")
  .option("-c, --config <path>", "Chemin vers config.yaml", "./config.yaml")
  .action((opts) => {
    const config = loadConfig(path.resolve(opts.config));
    const db = openDb(config.db.path);
    const dbStatuses = getAllStatuses(db);
    if (dbStatuses.length === 0) { console.error("Base vide. Lancer `npm run sync` d'abord."); process.exit(1); }

    // Les sections sont dérivées de board.columns via deriveStatusConfig() — pas d'accès à config.jira.todoStatuses
    const derived = deriveStatusConfig(config.board);
    const sections = [
      { label: "todoStatuses",       statuses: derived.todoStatuses },
      { label: "devStartStatuses",   statuses: derived.devStartStatuses },
      { label: "inProgressStatuses", statuses: derived.inProgressStatuses },
      { label: "doneStatuses",       statuses: derived.doneStatuses },
      { label: "activeStatuses",     statuses: derived.activeStatuses },
      { label: "queueStatuses",      statuses: derived.queueStatuses },
    ];
    const result = validateStatusConfig(sections, dbStatuses);
    // ... affichage + process.exit(1) si missingCount > 0
  });
```

`activeStatuses` et `queueStatuses` sont vides si aucune colonne `type: active` ou `type: queue` dans `board.columns` — automatiquement skippées.

### `package.json` — script `validate`

```json
{ "validate": "ts-node src/main.ts validate-config" }
```

---

## Ordre d'implémentation

1. Créer `config.example.yaml` à la racine
2. Ajouter `getAllStatuses` dans `src/db/store.ts`
3. Ajouter types + `validateStatusConfig` + commande dans `src/main.ts`
4. Ajouter le script `validate` dans `package.json`
