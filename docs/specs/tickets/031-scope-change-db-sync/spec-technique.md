# Spec technique — Infra DB + sync changements de champs

## Impact fichiers

| Fichier | Modification |
|---|---|
| `src/db/schema.sql` | Nouvelle table `issue_field_changes` + index |
| `src/db/store.ts` | Nouvelle fonction `replaceAllFieldChanges` + migration colonne |
| `src/jira/types.ts` | Nouveau type `FieldChange` |
| `src/sync.ts` | Nouvelle fonction `extractFieldChanges`, appel depuis `sync()` |

---

## 1. `src/db/schema.sql` — nouvelle table

Ajouter après la table `transitions` :

```sql
CREATE TABLE IF NOT EXISTS issue_field_changes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_key   TEXT NOT NULL,
  field_name  TEXT NOT NULL,
  from_value  TEXT,
  to_value    TEXT,
  changed_at  TEXT NOT NULL,
  FOREIGN KEY (issue_key) REFERENCES issues(key)
);

CREATE INDEX IF NOT EXISTS idx_field_changes_issue_key ON issue_field_changes(issue_key);
CREATE INDEX IF NOT EXISTS idx_field_changes_field ON issue_field_changes(field_name);
CREATE INDEX IF NOT EXISTS idx_field_changes_at ON issue_field_changes(changed_at);
```

Pas de migration via `PRAGMA table_info` nécessaire : `CREATE TABLE IF NOT EXISTS` crée la table sur les bases existantes sans erreur.

---

## 2. `src/jira/types.ts` — nouveau type

```typescript
export interface FieldChange {
  issueKey: string;
  fieldName: string;
  fromValue: string | null;
  toValue: string | null;
  changedAt: string;
}
```

---

## 3. `src/db/store.ts` — nouvelle fonction

Pattern identique à `replaceAllTransitions` (lignes 71-87) :

```typescript
export function replaceAllFieldChanges(
  db: Database.Database,
  allChanges: { key: string; changes: FieldChange[] }[],
): void {
  const del = db.prepare("DELETE FROM issue_field_changes WHERE issue_key = ?");
  const ins = db.prepare(`
    INSERT INTO issue_field_changes (issue_key, field_name, from_value, to_value, changed_at)
    VALUES (@issueKey, @fieldName, @fromValue, @toValue, @changedAt)
  `);

  db.transaction(() => {
    for (const { key, changes } of allChanges) {
      del.run(key);
      for (const c of changes) { ins.run(c); }
    }
  })();
}
```

Importer `FieldChange` depuis `"../jira/types"`.

---

## 4. `src/sync.ts` — extraction et appel

### Champs surveillés (constante locale)

```typescript
const WATCHED_FIELDS = new Set(["description", "summary", "Story Points", "Sprint"]);
```

### Nouvelle fonction `extractFieldChanges`

```typescript
function extractFieldChanges(issue: JiraIssue): FieldChange[] {
  if (!issue.changelog?.histories) { return []; }

  const changes: FieldChange[] = [];
  for (const history of issue.changelog.histories) {
    for (const item of history.items) {
      if (WATCHED_FIELDS.has(item.field)) {
        changes.push({
          issueKey: issue.key,
          fieldName: item.field,
          fromValue: item.fromString ?? null,
          toValue: item.toString ?? null,
          changedAt: history.created,
        });
      }
    }
  }
  return changes;
}
```

### Appel dans `sync()`

Après la construction de `allTransitions` (ligne 58-61), ajouter :

```typescript
const allFieldChanges: { key: string; changes: FieldChange[] }[] = rawIssues.map((issue) => ({
  key: issue.key,
  changes: extractFieldChanges(issue),
}));
```

Après `replaceAllTransitions(db, allTransitions)` (ligne 64) :

```typescript
replaceAllFieldChanges(db, allFieldChanges);
```

Importer `replaceAllFieldChanges` depuis `"./db/store"` et `FieldChange` depuis `"./jira/types"`.

---

## Ordre d'implémentation

1. Ajouter type `FieldChange` dans `src/jira/types.ts`
2. Ajouter table + index dans `src/db/schema.sql`
3. Implémenter `replaceAllFieldChanges` dans `src/db/store.ts`
4. Implémenter `extractFieldChanges` + appel dans `src/sync.ts`
5. Tests : vérifier que `extractFieldChanges` extrait description/summary/Story Points/Sprint et ignore status/assignee ; vérifier que `replaceAllFieldChanges` recouvre correctement
