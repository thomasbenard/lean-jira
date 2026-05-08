# Spec technique — i18n infrastructure + traduction messages CLI

## Impact fichiers

| Fichier | Modification |
|---|---|
| `src/i18n/index.ts` | Nouveau — `LocaleShape`, `initLocale()`, `t()` |
| `src/i18n/en.ts` | Nouveau — locale anglaise (clés CLI uniquement) |
| `src/i18n/fr.ts` | Nouveau — locale française (clés CLI uniquement) |
| `src/main.ts` | `--lang` sur 7 commandes + `initLocale` + toutes les strings CLI via `t()` |
| `src/sync.ts` | Toutes les strings `console.log/warn` via `t()` |

---

## 1. `src/i18n/index.ts`

```typescript
export type LocaleCode = "en" | "fr";

// Toutes les clés CLI — 041b ajoutera les clés rapport dans cette interface.
export interface LocaleShape {
  "sync.start": string;
  "sync.statusesFetched": string;
  "sync.sprintsFetched": string;
  "sync.incrementalFrom": string;
  "sync.firstSync": string;
  "sync.issuesFetching": string;
  "sync.issuesFetched": string;
  "sync.done": string;
  "board.missing": string;
  "board.runAutoconfig": string;
  "fakeMode.missingFrozenNow": string;
  "snapshots.done": string;
  "report.done": string;
  "validateConfig.empty": string;
  "validateConfig.ok": string;
  "validateConfig.missing": string;
  "validateConfig.available": string;
  "validateConfig.errors": string;
  "autoconfig.emptyBoard": string;
  "autoconfig.singleColumn": string;
  "autoconfig.applying": string;
  "autoconfig.applied": string;
  "autoconfig.wip.stripped": string;
  "listMetrics.header": string;
  "locale.unknown": string;
}

import { en } from "./en";
import { fr } from "./fr";

const LOCALES: Record<LocaleCode, LocaleShape> = { en, fr };

let current: LocaleShape = en;

export function initLocale(code: string): void {
  if (code === "en" || code === "fr") {
    current = LOCALES[code];
  } else {
    console.warn(en["locale.unknown"].replace("{{code}}", code));
    current = en;
  }
}

export function t(key: keyof LocaleShape, vars?: Record<string, string | number>): string {
  let str = current[key];
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      str = str.replace(`{{${k}}}`, String(v));
    }
  }
  return str;
}
```

---

## 2. `src/i18n/en.ts` (extrait représentatif)

```typescript
import type { LocaleShape } from "./index";

export const en: LocaleShape = {
  "sync.start":            "Syncing project {{projectKey}}...",
  "sync.statusesFetched":  "  {{count}} statuses fetched ({{doneCount}} in 'done' category)",
  "sync.sprintsFetched":   "  {{count}} sprints fetched ({{activeCount}} active)",
  "sync.incrementalFrom":  "  Incremental sync from {{date}}",
  "sync.firstSync":        "  First sync — full fetch",
  "sync.issuesFetching":   "\r  {{fetched}}/{{total}} issues fetched",
  "sync.issuesFetched":    "\n  {{count}} issues fetched from Jira",
  "sync.done":             "Sync complete. {{count}} issues stored.",
  "board.missing":         "board.yaml not found: {{path}}",
  "board.runAutoconfig":   "Run first: npm run autoconfig -- --apply",
  "fakeMode.missingFrozenNow": "Error: jira.frozenNow is required in fake mode.",
  "snapshots.done":        "Snapshots computed: {{count}} weekly dates.",
  "report.done":           "Report generated: {{path}}",
  "validateConfig.empty":  "Empty database. Run `npm run sync` first.",
  "validateConfig.ok":     "\n✓ Config valid.",
  "validateConfig.missing": "  ✗ {{name}}  ← not found in database",
  "validateConfig.available": "\nStatuses available in database:",
  "validateConfig.errors": "\n{{count}} missing status(es). Check board.yaml.",
  "autoconfig.emptyBoard": "⚠ Empty board — no columns detected.",
  "autoconfig.singleColumn": "⚠ Single-column board — configuration probably incomplete.",
  "autoconfig.applying":   "⚠ --apply will create/overwrite {{path}}. Waiting 3s…",
  "autoconfig.applied":    "✓ board.yaml created/updated: {{path}}",
  "autoconfig.wip.stripped": "  ⚠ {{count}} config status(es) classified 'done' by Jira → excluded from WIP/flow: {{names}}",
  "listMetrics.header":    "Available metrics:",
  "locale.unknown":        "Unknown locale \"{{code}}\", falling back to \"en\"",
};
```

`src/i18n/fr.ts` suit la même structure avec les chaînes françaises actuelles.

---

## 3. `src/main.ts` — ajout `--lang` + `initLocale`

Chaque interface `*Opts` gagne un champ `lang: string` :

```typescript
interface SyncOpts { config: string; lang: string; }
```

Chaque commande gagne l'option (avant `.action()`):

```typescript
.option("--lang <code>", "UI language: en|fr (default: en)", "en")
```

Première ligne de chaque `.action()` :

```typescript
.action(async (opts: SyncOpts) => {
  initLocale(opts.lang);
  // ...
})
```

Toutes les chaînes françaises remplacées — exemple :

```typescript
// Avant
console.log(`Snapshots recalculés : ${count} dates hebdomadaires.`);
// Après
console.log(t("snapshots.done", { count }));
```

---

## 4. `src/sync.ts` — strings via `t()`

`sync()` reçoit un paramètre optionnel `lang: LocaleCode = "en"` **ou** appelle directement
`t()` (l'état de locale est global, initialisé par `main.ts` avant l'appel). Aucun changement
de signature nécessaire — `initLocale` est appelé avant `sync()` dans chaque commande.

```typescript
// Avant
console.log(`Sync projet ${config.jira.projectKey}...`);
// Après
console.log(t("sync.start", { projectKey: config.jira.projectKey }));
```

---

## Ordre d'implémentation

1. Créer `src/i18n/index.ts` avec `LocaleShape` (clés vides `""`) + `initLocale` + `t()`
2. Créer `src/i18n/en.ts` et `src/i18n/fr.ts` — copier les strings actuelles en fr, écrire les
   traductions en anglais
3. Patcher `src/sync.ts` (6 strings — rapide à valider)
4. Patcher `src/main.ts` : ajouter `--lang` sur les 7 commandes + remplacer toutes les strings
5. Écrire les tests
