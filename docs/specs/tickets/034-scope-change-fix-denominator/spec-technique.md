# Spec technique — Corriger le dénominateur de scope-change-rate

## Impact fichiers

| Fichier | Modification |
|---|---|
| `src/db/schema.sql` | Nouvelle table `issue_sprints` + index |
| `src/db/store.ts` | `replaceAllIssueSprints(db, items)` exportée |
| `src/jira/types.ts` | `StoredIssueSprint` interface |
| `src/sync.ts` | Extraction + stockage des sprints par issue via `customfield_10020` |
| `src/metrics/scopeChange.ts` | Dénominateur depuis `issue_sprints`, numérateur inchangé |
| `tests/metrics/scopeChange.test.ts` | Scénarios couvrant le nouveau dénominateur |

---

## 1. `src/db/schema.sql`

Ajouter après la table `issue_field_changes` :

```sql
CREATE TABLE IF NOT EXISTS issue_sprints (
  issue_key  TEXT NOT NULL,
  sprint_id  INTEGER NOT NULL,
  PRIMARY KEY (issue_key, sprint_id),
  FOREIGN KEY (issue_key) REFERENCES issues(key),
  FOREIGN KEY (sprint_id) REFERENCES sprints(id)
);

CREATE INDEX IF NOT EXISTS idx_issue_sprints_sprint ON issue_sprints(sprint_id);
```

`CREATE TABLE IF NOT EXISTS` est compatible avec les bases existantes — aucune migration conditionnelle nécessaire dans `openDb()`.

---

## 2. `src/jira/types.ts`

```typescript
export interface StoredIssueSprint {
  issueKey: string;
  sprintId: number;
}
```

---

## 3. `src/db/store.ts`

Nouvelle fonction, pattern identique à `replaceAllFieldChanges` :

```typescript
export function replaceAllIssueSprints(
  db: Database.Database,
  allItems: { key: string; sprintIds: number[] }[],
): void {
  const del = db.prepare("DELETE FROM issue_sprints WHERE issue_key = ?");
  const ins = db.prepare(
    "INSERT OR IGNORE INTO issue_sprints (issue_key, sprint_id) VALUES (?, ?)",
  );

  db.transaction(() => {
    for (const { key, sprintIds } of allItems) {
      del.run(key);
      for (const id of sprintIds) { ins.run(key, id); }
    }
  })();
}
```

`INSERT OR IGNORE` défend contre les doublons si `customfield_10020` en retourne.

---

## 4. `src/sync.ts`

Dans la boucle d'extraction (lignes 60-64 actuelles), ajouter l'extraction des sprints :

```typescript
const allIssueSprints: { key: string; sprintIds: number[] }[] = [];

for (const issue of rawIssues) {
  issues.push(mapIssue(issue, activeSprintIds));
  allTransitions.push({ key: issue.key, transitions: extractTransitions(issue) });
  allFieldChanges.push({ key: issue.key, changes: extractFieldChanges(issue) });
  allIssueSprints.push({
    key: issue.key,
    sprintIds: (issue.fields.customfield_10020 ?? []).map((s) => s.id),
  });
}

// ...
replaceAllIssueSprints(db, allIssueSprints);
```

`customfield_10020` est déjà typé `JiraSprint[] | null` — pas de changement de type nécessaire.

---

## 5. `src/metrics/scopeChange.ts`

### Nouvelle structure de `compute()`

Remplacer le calcul de `totalIssues` / `bySprint[...].totalIssues` par une requête sur `issue_sprints` :

```typescript
// Étape 1 : effectifs réels par sprint depuis issue_sprints
const totalsRows = db.prepare(`
  SELECT s.name AS sprint_name, COUNT(DISTINCT isp.issue_key) AS cnt
  FROM issue_sprints isp
  JOIN issues i ON i.key = isp.issue_key
  JOIN sprints s ON s.id = isp.sprint_id
  WHERE s.start_date IS NOT NULL
  ${excludeClause}
  GROUP BY s.name
`).all(...excluded) as { sprint_name: string; cnt: number }[];

for (const row of totalsRows) {
  if (!bySprint[row.sprint_name]) { bySprint[row.sprint_name] = emptySprintStats(); }
  bySprint[row.sprint_name].totalIssues = row.cnt;
  totalIssues += row.cnt;
}

// Étape 2 : changedIssues depuis issue_field_changes (logique inchangée)
// ...
// Lors du push changedIssues : vérifier que bySprint[firstSprintName] existe
// (l'issue peut avoir été exclue du dénominateur si sprint hors issue_sprints)
if (bySprint[firstSprintName]) {
  bySprint[firstSprintName].changedIssues++;
  // ... byChangeType, issueDetails ...
}
```

### `findFirstSprint` — changement de source

`findFirstSprint` reste utilisée pour identifier le sprint d'attribution d'un `changedIssue`. Elle lit `issue_field_changes` pour trouver le premier Sprint field change. Pas de modification de signature.

### Fallback base vide

Si `issue_sprints` est vide (base pre-034 non re-synchée), `totalsRows` est vide → `bySprint` vide → `compute()` retourne `{ totalIssues: 0, changedIssues: 0, changeRatio: 0, bySprint: {}, changedIssueKeys: [] }`. Rapport silencieux (section scope-change affiche "Aucune dérive").

---

## Ordre d'implémentation

1. `schema.sql` — ajouter `issue_sprints` (test : `PRAGMA table_info`)
2. `types.ts` — `StoredIssueSprint`
3. `store.ts` — `replaceAllIssueSprints` + tests unitaires
4. `sync.ts` — extraction + appel `replaceAllIssueSprints` + tests
5. `scopeChange.ts` — nouveau dénominateur + tests (y compris test `totalIssues` correct avec issues créées directement dans sprint)
