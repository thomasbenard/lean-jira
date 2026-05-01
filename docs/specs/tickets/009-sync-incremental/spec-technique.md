# Spec technique — Sync incrémental

## Impact fichiers

| Fichier | Modification |
|---|---|
| `src/db/store.ts` | Ajouter `getLastSyncDate()` |
| `src/jira/client.ts` | Ajouter param optionnel `updatedSince` à `fetchAllIssues()` |
| `src/sync.ts` | Lire la date, la passer au client |

---

## 1. `src/db/store.ts` — `getLastSyncDate()`

Nouvelle fonction exportée. Lit l'entrée la plus récente de `sync_log` pour le projet donné.

```typescript
export function getLastSyncDate(db: Database.Database, projectKey: string): string | null {
  const row = db.prepare(
    "SELECT synced_at FROM sync_log WHERE project_key = ? ORDER BY synced_at DESC LIMIT 1"
  ).get(projectKey) as { synced_at: string } | undefined;
  return row?.synced_at ?? null;
}
```

Retourne `null` si aucun sync précédent (premier sync).

---

## 2. `src/jira/client.ts` — param `updatedSince` dans `fetchAllIssues()`

Ajouter un paramètre optionnel `updatedSince?: string` (ISO datetime). Si fourni, injecter un filtre JQL dans la requête vers l'endpoint agile board. L'endpoint `/rest/agile/1.0/board/{boardId}/issue` accepte un paramètre `jql` qui est ANDé avec le filtre du board.

Conversion ISO → format JQL Jira (`"YYYY-MM-DD HH:MM"`) :

```typescript
async fetchAllIssues(
  onProgress?: (fetched: number, total: number) => void,
  updatedSince?: string,
): Promise<JiraIssue[]> {
  const issues: JiraIssue[] = [];
  const pageSize = 100;
  let startAt = 0;
  let total = 0;

  // Jira JQL attend le format "YYYY-MM-DD HH:MM" (pas de secondes, pas de 'T')
  const jqlDate = updatedSince ? updatedSince.slice(0, 16).replace("T", " ") : null;

  do {
    const params: Record<string, unknown> = {
      startAt,
      maxResults: pageSize,
      expand: "changelog",
      fields: "summary,issuetype,status,created,resolutiondate,assignee,priority,customfield_10020,timeoriginalestimate",
    };
    if (jqlDate) {
      params.jql = `updated >= "${jqlDate}"`;
    }

    const response = await this.http.get(`/rest/agile/1.0/board/${this.boardId}/issue`, { params });
    // ... reste identique
  } while (startAt < total);

  return issues;
}
```

---

## 3. `src/sync.ts` — lecture de la date et passage au client

Lire `getLastSyncDate` **avant** `logSync` (qui créerait une nouvelle entrée et fausserait la valeur). Ajouter l'import.

```typescript
import { openDb, upsertIssues, upsertSprints, upsertStatuses, replaceAllTransitions, logSync, getLastSyncDate } from "./db/store";

export async function sync(config: SyncConfig): Promise<void> {
  const db = openDb(config.db.path);
  const client = new JiraClient(config.jira);

  console.log(`Sync projet ${config.jira.projectKey}...`);

  // ... fetchAllStatuses, fetchAllSprints (inchangés) ...

  const lastSyncDate = getLastSyncDate(db, config.jira.projectKey);
  if (lastSyncDate) {
    console.log(`  Sync incrémental depuis ${lastSyncDate}`);
  } else {
    console.log(`  Premier sync — récupération complète`);
  }

  const rawIssues = await client.fetchAllIssues((fetched, total) => {
    process.stdout.write(`\r  ${fetched}/${total} issues récupérées`);
  }, lastSyncDate ?? undefined);

  // ... upsertIssues, replaceAllTransitions, logSync (inchangés) ...
}
```

---

## Ordre d'implémentation

1. Ajouter `getLastSyncDate` dans `src/db/store.ts` + tests
2. Modifier `fetchAllIssues` dans `src/jira/client.ts` + tests
3. Câbler dans `src/sync.ts` + test d'intégration
