# Spec technique — dev-time-allocation : WIP et ratio pondéré

## Impact fichiers

| Fichier | Modification |
|---|---|
| `src/metrics/devTimeAllocation.ts` | Ajouter requête WIP, fusionner avec livrées, corriger `avgBugRatio` |
| `src/snapshots/compute.ts` | Aucun changement de code — `r.avgBugRatio` corrigé en amont |

---

## 1. `src/metrics/devTimeAllocation.ts`

### Détermination de `today`

```typescript
const today = config.windowEndDate ?? new Date().toISOString().slice(0, 10);
```

Utilisé comme borne fictive `done_at` pour le WIP et comme filtre de la requête WIP.

### Requête WIP (nouvelle)

Issues qui ont une transition `devStartStatuses` ET `todoStatuses`, mais **aucune** transition `doneStatuses` avant `today`.

```typescript
const donePh = placeholders(config.doneStatuses);

const wipRows = db.prepare(`
  SELECT t.issue_key,
         MIN(t.transitioned_at) AS started_at,
         i.issue_type
  FROM transitions t
  JOIN issues i ON i.key = t.issue_key
  WHERE t.to_status IN (${devStartPh})
    ${excludeSql}
    AND substr(t.transitioned_at, 1, 10) <= ?
    AND EXISTS (
      SELECT 1 FROM transitions t2
      WHERE t2.issue_key = t.issue_key
        AND t2.to_status IN (${todoPh})
    )
    AND NOT EXISTS (
      SELECT 1 FROM transitions td
      WHERE td.issue_key = t.issue_key
        AND td.to_status IN (${donePh})
        AND substr(td.transitioned_at, 1, 10) <= ?
    )
  GROUP BY t.issue_key, i.issue_type
`).all(
  ...config.devStartStatuses,
  ...excludeArgs,
  today,
  ...config.todoStatuses,
  ...config.doneStatuses,
  today,
) as { issue_key: string; started_at: string; issue_type: string }[];
```

### Traitement unifié dans `byWeekMap`

Après la boucle existante sur `rows` (issues livrées), ajouter une boucle sur `wipRows` :

```typescript
for (const r of wipRows) {
  const days = workingDaysBetween(r.started_at, today);
  if (days <= 0) continue;
  const isBug = bugTypes.has(r.issue_type);
  for (const [week, alloc] of distributeAcrossWeeks(r.started_at, today, days)) {
    let entry = byWeekMap.get(week);
    if (!entry) {
      entry = { featureDays: 0, bugDays: 0 };
      byWeekMap.set(week, entry);
    }
    if (isBug) entry.bugDays += alloc;
    else entry.featureDays += alloc;
  }
}
```

### Correction de `avgBugRatio`

Remplacer :
```typescript
return { byWeek, avgBugRatio: avg(byWeek.map((w) => w.bugRatio)) };
```

Par :
```typescript
const totalBugDays = byWeek.reduce((s, w) => s + w.bugDays, 0);
const totalDays = byWeek.reduce((s, w) => s + w.featureDays + w.bugDays, 0);
return { byWeek, avgBugRatio: totalDays > 0 ? totalBugDays / totalDays : 0 };
```

La fonction `avg` n'est plus utilisée dans ce fichier — vérifier si l'import peut être retiré.

---

## 2. `src/snapshots/compute.ts`

Aucune modification requise. Ligne 153 :

```typescript
out.push({ ..., stat: "bugRatio", value: r.avgBugRatio });
```

`r.avgBugRatio` sera désormais la moyenne pondérée correcte. Les totaux `featureDays` / `bugDays` aux lignes 149-152 sont déjà calculés depuis `byWeek` (incluront donc le WIP après la correction).

---

## Ordre d'implémentation

1. **Tests rouge** : scénarios couvrant WIP visible dans `byWeek`, ratio pondéré, snapshot historique avec `windowEndDate`
2. **Détermination de `today`** dans `compute()` (`windowEndDate ?? new Date()...`)
3. **Requête WIP** + boucle de distribution dans `byWeekMap`
4. **Correction `avgBugRatio`** (moyenne pondérée)
5. **Retirer import `avg`** si devenu inutilisé
6. Tests verts → /simplify
