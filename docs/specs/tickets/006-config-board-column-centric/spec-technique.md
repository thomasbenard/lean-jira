# Spec technique — Config board centré sur les colonnes

## Impact fichiers

| Fichier | Modification |
|---|---|
| `config.yaml` | Remplacement des 5 listes plates par `board.columns` + `board.legacyDoneStatuses` |
| `src/main.ts` | Nouveau type `BoardColumn` + `BoardConfig`, mise à jour `AppConfig`, nouvelle fonction `deriveStatusConfig()`, mise à jour `buildMetricConfig` |
| `tests/config/deriveStatusConfig.test.ts` | Nouveau fichier — tests unitaires de `deriveStatusConfig` |

---

## 1. Nouveaux types dans `src/main.ts`

```typescript
type ColumnType = "todo" | "active" | "queue" | "done";

interface BoardColumn {
  name: string;
  type: ColumnType;
  devStart?: boolean;
  statuses: string[];
}

interface BoardConfig {
  columns: BoardColumn[];
  legacyDoneStatuses?: string[];
}
```

`AppConfig.jira` perd les cinq listes plates. `AppConfig` gagne `board: BoardConfig` :

```typescript
interface AppConfig {
  jira: {
    baseUrl: string;
    email: string;
    apiToken: string;
    projectKey: string;
    boardId: number;
    // supprimé: todoStatuses, devStartStatuses, inProgressStatuses,
    //           doneStatuses, activeStatuses, queueStatuses
  };
  board: BoardConfig;
  metrics?: {
    cutoffDate?: string;
    bugIssueTypes?: string[];
  };
  db: { path: string };
}
```

---

## 2. Fonction `deriveStatusConfig()` dans `src/main.ts`

Extraite avant `buildMetricConfig`, exportée pour les tests :

```typescript
interface DerivedStatusConfig {
  todoStatuses: string[];
  devStartStatuses: string[];
  inProgressStatuses: string[];
  activeStatuses: string[];
  queueStatuses: string[];
  doneStatuses: string[];
}

export function deriveStatusConfig(board: BoardConfig): DerivedStatusConfig {
  const byType = (type: ColumnType): string[] =>
    board.columns
      .filter((c) => c.type === type)
      .flatMap((c) => c.statuses);

  const unique = (arr: string[]): string[] => [...new Set(arr)];

  return {
    todoStatuses:       unique(byType("todo")),
    devStartStatuses:   unique(board.columns.filter((c) => c.devStart).flatMap((c) => c.statuses)),
    inProgressStatuses: unique([...byType("active"), ...byType("queue")]),
    activeStatuses:     unique(byType("active")),
    queueStatuses:      unique(byType("queue")),
    doneStatuses:       unique([...byType("done"), ...(board.legacyDoneStatuses ?? [])]),
  };
}
```

---

## 3. Mise à jour de `buildMetricConfig()` dans `src/main.ts`

Remplace les accès directs `app.jira.*` par la sortie de `deriveStatusConfig` :

```typescript
function buildMetricConfig(db: Database.Database, app: AppConfig, opts: { excludeOutliers?: boolean } = {}): MetricConfig {
  const derived = deriveStatusConfig(app.board);
  const doneSet = new Set([...getDoneStatusNames(db), ...derived.doneStatuses]);
  const filter = (list: string[]): string[] => list.filter((s) => !doneSet.has(s));

  const stripped = {
    inProgress: filter(derived.inProgressStatuses),
    active:     filter(derived.activeStatuses),
    queue:      filter(derived.queueStatuses),
  };

  // warning log inchangé (même logique, source = derived au lieu de app.jira)
  // ...

  return {
    todoStatuses:        derived.todoStatuses,
    devStartStatuses:    derived.devStartStatuses,
    inProgressStatuses:  stripped.inProgress,
    doneStatuses:        [...doneSet],
    activeStatuses:      stripped.active,
    queueStatuses:       stripped.queue,
    cutoffDate:          app.metrics?.cutoffDate,
    excludeOutliers:     opts.excludeOutliers !== false,
    bugIssueTypes:       app.metrics?.bugIssueTypes ?? ["Bug"],
  };
}
```

---

## 4. Réécriture de `config.yaml`

Structure cible (extrait) :

```yaml
jira:
  baseUrl: "..."
  email: "..."
  apiToken: "..."
  projectKey: "SWNGF"
  boardId: 1129

board:
  columns:
    - name: "À faire"
      type: todo
      statuses:
        - "Prêt à faire"
        - "Ready to do"
        - "A réaliser"

    - name: "Développement"
      type: active
      devStart: true
      statuses:
        - "Développement en cours"
        - "Dev in progress"
        - "En cours"
        - "Design in progress"
        - "En attente"

    - name: "Review"
      type: queue
      statuses:
        - "À revoir"
        - "To be reviewed"
        - "Révisé"
        - "Reviewed"

    - name: "QA"
      type: active
      statuses:
        - "Prêt pour les tests QA"
        - "Ready for QA"
        - "QA in progress"
        - "EN VERIFICATION"

    - name: "Validation"
      type: queue
      statuses:
        - "En validation"
        - "Validation PO"
        - "Prêt pour la mise en production"

    - name: "Done"
      type: done
      statuses:
        - "Terminé(e)"
        - "Terminée"
        - "Done"
        - "Réalisée"
        - "Cloturée"
        - "Livré"
        - "Ready for release"

  legacyDoneStatuses:
    - "Delivred"
    - "DELIVERED"
    - "To Be Validated"

metrics:
  cutoffDate: "2025-11-01"
  bugIssueTypes:
    - "Bug"

db:
  path: "./lean-jira.db"
```

> **Note** : `"To Be Validated"` reste dans `legacyDoneStatuses` uniquement (statut historique
> renommé). Le retirer de la colonne Validation élimine l'ambiguïté actuelle où il apparaissait
> à la fois dans `queueStatuses` et `doneStatuses`.

---

## 5. Fichier test `tests/config/deriveStatusConfig.test.ts`

Pattern vitest identique aux autres tests (voir `tests/metrics/leadTime.test.ts`).
Scénarios à couvrir :

1. Dérivation nominale — config complète → toutes les listes correctement peuplées
2. Colonne `devStart: true` type `active` → statuts dans `devStartStatuses` ET `inProgressStatuses`
3. `legacyDoneStatuses` absent → `doneStatuses` = seuls statuts colonne done
4. Deux colonnes `devStart: true` → union sans doublon
5. Statut dans colonne done présent aussi dans `legacyDoneStatuses` → dédupliqué
6. Aucune colonne `type: queue` → `queueStatuses` = `[]`, `inProgressStatuses` = seulement active

---

## Ordre d'implémentation

1. Écrire `tests/config/deriveStatusConfig.test.ts` (rouge)
2. Ajouter types `BoardColumn`, `BoardConfig`, `DerivedStatusConfig` dans `src/main.ts`
3. Implémenter `deriveStatusConfig()` → tests verts
4. Mettre à jour `AppConfig` (supprimer les 5 champs `jira.*`)
5. Mettre à jour `buildMetricConfig()` pour utiliser `deriveStatusConfig`
6. Réécrire `config.yaml`
7. Smoke test : `npm run metrics` passe sans erreur
