# Spec technique — Rapport : liens Jira cliquables

## Impact fichiers

| Fichier | Modification |
|---|---|
| `src/report/generate.ts` | Ajout `jiraBaseUrl` dans `RenderInput` + helper `issueLink()` + mise à jour `agingTableRows` |
| `src/main.ts` | Passer `config.jira.baseUrl` à `generateReport` |

---

## 1. `src/main.ts` — propagation de `baseUrl`

La commande `report` appelle déjà `generateReport`. Ajouter `baseUrl` en paramètre :

```typescript
// Avant
generateReport(db, config.jira.projectKey, path.resolve(opts.output), metricConfig);

// Après
generateReport(db, config.jira.projectKey, config.jira.baseUrl, path.resolve(opts.output), metricConfig);
```

---

## 2. `src/report/generate.ts`

### Signature de `generateReport`

```typescript
export function generateReport(
  db: Database.Database,
  projectKey: string,
  jiraBaseUrl: string,        // nouveau paramètre
  outputPath: string,
  config: MetricConfig,
): void {
```

### Interface `RenderInput`

```typescript
interface RenderInput {
  // ... champs existants ...
  jiraBaseUrl: string;        // nouveau champ
}
```

Passer `jiraBaseUrl` dans l'objet `renderHtml({ ..., jiraBaseUrl })`.

### Helpers `issueLink` et `agingRowsHtml` au niveau module

Implémentés top-level (et non en closure) pour permettre des tests unitaires directs sans passer par `renderHtml` (qui exige une `RenderInput` complète + accès DB).

```typescript
// exporté pour test unitaire (cas trim slash + échappement HTML).
export function issueLink(key: string, jiraBaseUrl: string): string {
  if (!key) return "";
  const base = jiraBaseUrl.replace(/\/$/, "");
  return `<a href="${escapeHtml(base)}/browse/${escapeHtml(key)}" target="_blank" rel="noopener">${escapeHtml(key)}</a>`;
}

const RISK_CLASS: Record<AgingRisk, string> = {
  ok: "risk-ok",
  watch: "risk-watch",
  "at-risk": "risk-at-risk",
  critical: "risk-critical",
};

// exporté pour test unitaire (vérifier la cellule Issue rend un <a> cliquable).
export function agingRowsHtml(data: AgingWipSummary, jiraBaseUrl: string): string {
  if (data.issues.length === 0) {
    return `<tr><td colspan="4">Aucun item en cours.</td></tr>`;
  }
  return data.issues
    .slice(0, 15)
    .map(
      (i) =>
        `<tr><td>${issueLink(i.issueKey, jiraBaseUrl)}</td><td>${escapeHtml(i.status)}</td><td>${i.ageDays.toFixed(1)}j</td><td class="${RISK_CLASS[i.riskLevel]}">${escapeHtml(i.riskLevel)}</td></tr>`,
    )
    .join("");
}
```

`renderHtml` appelle directement `agingRowsHtml(input.agingWip, input.jiraBaseUrl)` — pas de lambda intermédiaire.

---

## Ordre d'implémentation

1. Modifier la signature de `generateReport` dans `generate.ts` + ajouter `jiraBaseUrl` à `RenderInput`
2. Ajouter le helper `issueLink` dans `renderHtml`
3. Remplacer `escapeHtml(i.issueKey)` par `issueLink(i.issueKey)` dans `agingTableRows`
4. Mettre à jour l'appel dans `main.ts`
