# Spec technique — Inférence active/queue par mots-clés sur nom de colonne

## Impact fichiers

| Fichier | Modification |
|---|---|
| `src/main.ts` | Ajout `QUEUE_KEYWORDS` + `matchesQueueKeyword()` ; modification `inferBoardColumns()` et `renderBoardColumnsYaml()` |

---

## 1. `src/main.ts` — Modifications

### Constante et helper

Ajouter avant `inferBoardColumns()` (introduite par le ticket 010) :

```typescript
const QUEUE_KEYWORDS = [
  "review", "validation", "valider", "attente",
  "wait", "waiting", "approval", "approuver", "staging", "qa",
];

function matchesQueueKeyword(name: string): string | undefined {
  const lower = name.toLowerCase();
  return QUEUE_KEYWORDS.find((kw) => lower.includes(kw));
}
```

### `InferredColumn` — champ supplémentaire

Étendre l'interface `InferredColumn` (ticket 010) avec le mot-clé déclencheur :

```typescript
interface InferredColumn extends BoardColumn {
  warning?: string;
  queueKeyword?: string;  // mot-clé ayant déclenché l'inférence queue
}
```

### `inferBoardColumns()` — branche intermédiaire modifiée

Remplacer la branche `else` (type `active` par défaut) de la version ticket 010 :

```typescript
// Avant (ticket 010) :
} else {
  type = "active";
  if (categories.every((k) => k === "done")) {
    warning = `⚠ statuts classés "done" par Jira — vérifier si type: done est plus approprié`;
  }
}

// Après (ticket 011) :
} else {
  const matchedKeyword = matchesQueueKeyword(col.name);
  if (matchedKeyword) {
    type = "queue";
    column.queueKeyword = matchedKeyword;
  } else {
    type = "active";
  }
  if (categories.every((k) => k === "done")) {
    warning = `⚠ statuts classés "done" par Jira — vérifier si type: done est plus approprié`;
  }
}
```

Note : `devStart: true` est assigné uniquement si `type === "active"` (inchangé). Si la première colonne intermédiaire est inférée `queue`, `devStart` passe sur la prochaine colonne `active`.

### `renderBoardColumnsYaml()` — commentaire inline pour queue inféré

Remplacer la logique de rendu de la clé `type:` :

```typescript
// Avant (ticket 010) :
if (col.warning) {
  lines.push(`      type: ${col.type}   # ${col.warning}`);
} else if (col.type === "active" && !col.devStart) {
  lines.push(`      type: ${col.type}   # changer en "queue" si temps d'attente`);
} else {
  lines.push(`      type: ${col.type}`);
}

// Après (ticket 011) :
if (col.warning) {
  lines.push(`      type: ${col.type}   # ${col.warning}`);
} else if (col.queueKeyword) {
  lines.push(`      type: ${col.type}   # inféré depuis le mot-clé "${col.queueKeyword}" — vérifier`);
} else if (col.type === "active" && !col.devStart) {
  lines.push(`      type: ${col.type}   # changer en "queue" si temps d'attente`);
} else {
  lines.push(`      type: ${col.type}`);
}
```

---

## Ordre d'implémentation

1. `src/main.ts` — ajouter `QUEUE_KEYWORDS` et `matchesQueueKeyword()`
2. `src/main.ts` — étendre `InferredColumn` avec `queueKeyword?`
3. `src/main.ts` — modifier la branche intermédiaire de `inferBoardColumns()`
4. `src/main.ts` — modifier `renderBoardColumnsYaml()` pour le commentaire inline
5. Tests : `matchesQueueKeyword()` (match exact, partiel, insensible casse, pas de match, vide) + `inferBoardColumns()` (queue inféré, devStart sur colonne active suivante, toutes colonnes queue)
