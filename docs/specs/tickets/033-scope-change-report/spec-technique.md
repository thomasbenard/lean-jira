# Spec technique — Rapport : graphe scope change + alerte

## Impact fichiers

| Fichier | Modification |
|---|---|
| `src/report/generate.ts` | Nouvelle section scope change : bannière alerte + graphe + tableau |
| `src/snapshots/compute.ts` | Skip déjà ajouté par ticket 032 — vérifier uniquement |

---

## 1. `src/report/generate.ts`

### Import

```typescript
import { scopeChangeMetric, type ScopeChangeResult } from "../metrics/scopeChange";
```

### Dégradation gracieuse — détection table absente

```typescript
function isScopeChangeAvailable(db: Database.Database): boolean {
  const cols = db.prepare("PRAGMA table_info(issue_field_changes)").all() as { name: string }[];
  return cols.length > 0;
}
```

### Calcul live dans `generateReport()`

```typescript
let scopeData: ScopeChangeResult | null = null;
if (isScopeChangeAvailable(db)) {
  scopeData = scopeChangeMetric.compute(db, config);
}
```

### Bannière d'alerte

Calculée depuis `scopeData.bySprint` : identifier les sprints actif/précédent via les sprints en base :

```typescript
function buildScopeAlertBanner(db: Database.Database, scopeData: ScopeChangeResult): string {
  if (scopeData.changedIssues === 0) { return ""; }

  const activeSprint = db.prepare(
    "SELECT name FROM sprints WHERE state = 'active' ORDER BY start_date DESC LIMIT 1"
  ).get() as { name: string } | undefined;

  const prevSprint = db.prepare(
    "SELECT name FROM sprints WHERE state = 'closed' ORDER BY end_date DESC LIMIT 1"
  ).get() as { name: string } | undefined;

  const sprintsToCheck = [activeSprint?.name, prevSprint?.name].filter(Boolean) as string[];
  const alertSprints = sprintsToCheck.filter(
    (name) => (scopeData.bySprint[name]?.changedIssues ?? 0) > 0
  );

  if (alertSprints.length === 0) { return ""; }

  const count = alertSprints.reduce((s, n) => s + (scopeData.bySprint[n]?.changedIssues ?? 0), 0);
  const sprintLabel = alertSprints.join(", ");
  return `
    <div class="alert-banner alert-orange">
      ⚠️ Dérive de périmètre détectée — <strong>${count} issue(s)</strong> modifiée(s) après entrée en sprint
      <span class="alert-detail">(sprint : ${escapeHtml(sprintLabel)})</span>
    </div>`;
}
```

Injecter le résultat de `buildScopeAlertBanner` avant la première section KPI dans le HTML template.

### Help text

```typescript
scopeChange: {
  title: "Dérive de périmètre par sprint",
  body:
    "Issues dont la description, l'estimation ou l'assignation de sprint a changé significativement après le début du sprint. " +
    "Seuil de détection : similarité texte < 85% (Levenshtein normalisé). " +
    "Tout changement de story points post-sprint est comptabilisé. " +
    "Une dérive élevée corrèle avec des sprints ratés et un cycle time long.",
},
```

### Graphe Chart.js — structure des données

```typescript
function buildScopeChangeChart(scopeData: ScopeChangeResult): string {
  const sprintNames = Object.keys(scopeData.bySprint).sort((a, b) => {
    // Tri par numéro de sprint si présent dans le nom (ex: "Sprint 42" < "Sprint 43")
    const numA = parseInt(a.match(/\d+/)?.[0] ?? "0", 10);
    const numB = parseInt(b.match(/\d+/)?.[0] ?? "0", 10);
    return numA - numB;
  });

  const descCounts = sprintNames.map((n) => scopeData.bySprint[n].byChangeType.description);
  const spCounts   = sprintNames.map((n) => scopeData.bySprint[n].byChangeType.storyPoints);
  const reprogCounts = sprintNames.map((n) => scopeData.bySprint[n].byChangeType.sprintChange);
  const ratios     = sprintNames.map((n) => Math.round(scopeData.bySprint[n].changeRatio * 100));

  return `/* Chart.js config avec datasets stacked bar + line sur yAxisID:'y2' */`;
}
```

Chart.js config :
```json
{
  "type": "bar",
  "data": {
    "labels": ["Sprint N", "..."],
    "datasets": [
      { "label": "Description", "data": [...], "backgroundColor": "#3b5bdb", "stack": "scope" },
      { "label": "Story Points", "data": [...], "backgroundColor": "#f08c00", "stack": "scope" },
      { "label": "Reprogrammé",  "data": [...], "backgroundColor": "#c92a2a", "stack": "scope" },
      { "label": "Taux (%)", "data": [...], "type": "line", "yAxisID": "y2", "borderColor": "#868e96" }
    ]
  },
  "options": {
    "scales": {
      "y":  { "stacked": true, "title": { "display": true, "text": "Nb issues" } },
      "y2": { "position": "right", "title": { "display": true, "text": "Taux (%)" }, "max": 100 }
    }
  }
}
```

### Tableau des issues modifiées

```html
<table class="scope-issues-table">
  <thead><tr><th>Clé</th><th>Sprint</th><th>Changements</th><th>Résumé</th></tr></thead>
  <tbody>
    <!-- une ligne par changedIssueKey, résumé depuis issues table -->
  </tbody>
</table>
```

Requête pour les résumés :
```typescript
const summaries = db.prepare(
  `SELECT key, summary FROM issues WHERE key IN (${placeholders(keys)})`
).all(...keys) as { key: string; summary: string }[];
```

---

## Ordre d'implémentation

1. `isScopeChangeAvailable()` + test dégradation gracieuse
2. `buildScopeAlertBanner()` + injection dans template HTML
3. Help text dans `HELP_TEXTS`
4. `buildScopeChangeChart()` — données + config Chart.js
5. Tableau issues modifiées
6. Intégration dans `generateReport()` (après section WIP ou fin de rapport)
7. Tests : rapport sans table (skip), rapport avec 0 changement (no banner), rapport avec changements (banner + chart)
