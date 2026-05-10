# Spec technique — Autoconfig détection de la méthode d'estimation

## Impact fichiers

| Fichier | Modification |
|---|---|
| `src/jira/types.ts` | Ajout champ `estimation?` dans `JiraBoardConfig` |
| `src/main.ts` | `inferEstimationConfig()` exportée + intégration dans action `autoconfig` |
| `src/jira/fixtures/boardConfig.json` | Ajout champ `estimation` pour mode fake |

---

## 1. `src/jira/types.ts`

Étendre `JiraBoardConfig` (ligne 57) :

```typescript
export interface JiraBoardConfig {
  id: number;
  name: string;
  columnConfig: {
    columns: JiraBoardColumnRaw[];
  };
  estimation?: {
    type: "none" | "issueCount" | "field";
    field?: {
      fieldId: string;
      displayName: string;
    };
  };
}
```

---

## 2. `src/main.ts`

### Nouvelle fonction `inferEstimationConfig()`

À ajouter avec les autres fonctions exportées (autour de la ligne 233, aux côtés de `inferBoardColumns`) :

```typescript
export function inferEstimationConfig(
  boardConfig: JiraBoardConfig,
): import("./metrics/types").EstimationConfig {
  const est = boardConfig.estimation;
  if (!est) return { method: "time" };
  if (est.type === "none" || est.type === "issueCount") return { method: "none" };
  if (est.type === "field" && est.field) {
    const { fieldId } = est.field;
    if (fieldId === "timeoriginalestimate") return { method: "time" };
    if (fieldId === "customfield_10016")    return { method: "story-points" };
    return { method: "numeric", jiraField: fieldId };
  }
  return { method: "time" };
}
```

### Intégration dans l'action `autoconfig` (~ligne 561)

Après la résolution des colonnes (ligne ~596), ajouter :

```typescript
const detectedEstimation = inferEstimationConfig(boardConfig);

// Warning si champ custom non-standard (peut être t-shirt)
if (detectedEstimation.method === "numeric" && boardConfig.estimation?.field) {
  const { fieldId, displayName } = boardConfig.estimation.field;
  warnings.push(
    `⚠ Champ d'estimation détecté : "${fieldId}" (${displayName}).\n` +
    `  Si les valeurs sont catégorielles (XS/S/M/L/XL), changer method: t-shirt dans board.yaml.`,
  );
}
```

### En mode `--apply` (~ligne 621)

Remplacer la construction de `newBoard.metrics` :

```typescript
// Avant
metrics: existingBoard?.metrics ?? { bugIssueTypes: ["Bug"] },

// Après
metrics: {
  ...(existingBoard?.metrics ?? { bugIssueTypes: ["Bug"] }),
  // Préserver estimation existante si l'utilisateur a déjà configuré manuellement
  estimation: existingBoard?.metrics?.estimation ?? detectedEstimation,
},
```

### En mode dry-run (~ligne 635)

Après `renderBoardColumnsYaml(columns)`, ajouter le bloc metrics :

```typescript
const estimationYaml = yaml.stringify({ metrics: { estimation: detectedEstimation } }).trimEnd();
console.log(`\n${estimationYaml}`);
```

---

## 3. `src/jira/fixtures/boardConfig.json`

Ajouter le champ `estimation` (exemple story-points pour la fixture fake) :

```json
{
  "id": 1,
  "name": "DEMO Board",
  "columnConfig": { "columns": [ ... ] },
  "estimation": {
    "type": "field",
    "field": {
      "fieldId": "customfield_10016",
      "displayName": "Story Points"
    }
  }
}
```

---

## Ordre d'implémentation

1. `src/jira/types.ts` — étendre `JiraBoardConfig` avec `estimation?`
2. Tests : `inferEstimationConfig()` — écrire les tests (TDD) avant la fonction
3. `src/main.ts` — implémenter `inferEstimationConfig()` jusqu'au vert
4. `src/main.ts` — intégrer dans l'action `autoconfig` (dry-run + `--apply`)
5. `src/jira/fixtures/boardConfig.json` — ajouter `estimation` pour mode fake
