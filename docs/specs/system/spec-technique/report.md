# Rapport HTML (`report/generate.ts`)

[← Index](../spec-technique.md)

`generateReport(db, projectKey, jiraBaseUrl, outputPath, config, healthThresholds?, squadName?, personalization?, boardDir?)` lit `metric_snapshots` et produit un fichier HTML autonome (Chart.js via CDN, CSS inline).

## Signaux de santé (`healthThresholds`)

Paramètre optionnel de type `HealthThresholds` (exporté depuis `generate.ts`). Si absent → aucun signal. Structure :

```typescript
interface ThresholdPair { warn: number; crit: number; }
interface HealthThresholds {
  leadTimeMedianDays?: ThresholdPair;
  cycleTimeMedianDays?: ThresholdPair;
  throughputWeekly?: ThresholdPair;
  wipCount?: ThresholdPair;
  bugCycleTimeMedianDays?: ThresholdPair;
  bugRatio?: ThresholdPair;
}
```

Helpers d'évaluation (exportés, fonctions pures) :
- `evalLowerBetter(value, t)` : vert si `value <= t.warn`, orange si `<= t.crit`, rouge sinon. `null` ou `t` absent → `"none"`.
- `evalHigherBetter(value, t)` : vert si `value >= t.warn`, orange si `>= t.crit`, rouge sinon. Utilisé pour `throughputWeekly`.

Rendu : `<span class="health-dot health-{green|orange|red}">●</span>` inséré avant la valeur dans la card KPI. Champ `metrics.healthThresholds` dans `board.yaml` → passé par `main.ts` à `generateReport()`.

## Personnalisation du rapport (`report:` dans `board.yaml`)

Section optionnelle `report:` dans `BoardFileConfig` (interface `ReportPersonalization` exportée depuis `generate.ts`). Résolue par `resolvePersonalization(p, boardDir)` avant le rendu :

- `title` : remplace `"Rapport Lean — {projectKey}"` dans `<title>` et l'en-tête
- `logoUrl` : chemin local (résolu depuis `boardDir`, embarqué en base64 `data:mime;base64,...`) ou URL http(s) directe ; extensions : `.png`, `.jpg`, `.jpeg`, `.svg`, `.webp` ; fichier absent → throw ; extension inconnue → warn + ignore
- `fontUrl` : remplace le `<link>` IBM Plex (police Chart.js non affectée)
- `customCssPath` : chemin local, contenu injecté dans un second `<style>` après le bloc défaut ; fichier absent → throw
- `excludeTabs` : onglets valides `delivery`, `quality`, `roles`, `forecast`, `advanced` ; valeur inconnue → warn + ignore ; `scope` hors système d'exclusion

---

## Snapshots historiques (`snapshots/compute.ts`)

`backfillSnapshots` :
1. Génère toutes les fins de semaine (dimanche) depuis `cutoffDate` jusqu'à aujourd'hui.
2. Pour chaque date, calcule chaque métrique avec `windowEndDate = date`.
3. Efface et réinsère l'intégralité de `metric_snapshots` dans une transaction atomique.

Fenêtres de calcul par type de métrique et shapes de résultat reconnues par `extractStats` : voir [`metrics-formulas.md`](../metrics-formulas.md) § Snapshots.
