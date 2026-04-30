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

### Helper `issueLink` dans `renderHtml`

```typescript
function renderHtml(input: RenderInput): string {
  const base = input.jiraBaseUrl.replace(/\/$/, "");  // trim trailing slash

  const issueLink = (key: string): string =>
    key
      ? `<a href="${escapeHtml(base)}/browse/${escapeHtml(key)}" target="_blank" rel="noopener">${escapeHtml(key)}</a>`
      : escapeHtml(key);

  // ... reste de la fonction ...
}
```

### Mise à jour de `agingTableRows`

```typescript
// Avant (ligne ~282)
`<tr><td>${escapeHtml(i.issueKey)}</td>...`

// Après
`<tr><td>${issueLink(i.issueKey)}</td>...`
```

`issueLink` est défini dans la closure de `renderHtml`, donc accessible directement.

---

## Ordre d'implémentation

1. Modifier la signature de `generateReport` dans `generate.ts` + ajouter `jiraBaseUrl` à `RenderInput`
2. Ajouter le helper `issueLink` dans `renderHtml`
3. Remplacer `escapeHtml(i.issueKey)` par `issueLink(i.issueKey)` dans `agingTableRows`
4. Mettre à jour l'appel dans `main.ts`
