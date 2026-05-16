# Primitives communes

[← Index](../metrics-formulas.md)

## Durée en jours ouvrés

Toutes les durées sont en **jours ouvrés** (lundi–vendredi). Les weekends sont exclus.

```
calDays   = (endMs − startMs) / 86 400 000
wholeDays = floor(calDays)
frac      = calDays − wholeDays

fullWeeks       = floor(wholeDays / 7)
rem             = wholeDays % 7
extraWorking    = count of weekdays in [startDow, startDow+rem)
partialDow      = (startDow + wholeDays) % 7
fracWorking     = frac  si partialDow ∉ {0=dim, 6=sam}, sinon 0

workingDays = fullWeeks × 5 + extraWorking + fracWorking
```

Implémenté dans `workingDaysBetween(from, to)` (`src/metrics/utils.ts`). Retourne **0** si `endMs ≤ startMs` (pas d'erreur jetée — `done_at == todo_at` produit donc 0).

> **Limitation connue** : `startDow = new Date(from).getDay()` utilise la **timezone locale du process** (UTC sur CI, locale sur poste dev). Pour des transitions proches de minuit, deux machines peuvent calculer un nombre de jours ouvrés différent. À fixer en `getUTCDay()` pour aligner sur `isoWeek` (qui force déjà UTC).

Les issues avec `durée < 0` sont silencieusement ignorées (données corrompues) via le filtre amont `if (done_at < todo_at) continue;` (idem `started_at`) côté lead/cycle.

> **Fenêtres de snapshots** (`cutoffDate ± 30j/7j`) : restent en jours calendaires — elles bornent la sélection d'issues, pas une durée.

## Conversion estimation

```
estimation (jours) = original_estimate_seconds / 28 800
```

28 800 s = 8 h = 1 jour-personne Atlassian par défaut.

## Filtre outliers (Tukey upper fence)

Appliqué côté droit uniquement (les durées sont ≥ 0, pas de queue gauche).

```
sorted   = valeurs triées croissant
Q1       = percentile(sorted, 25)
Q3       = percentile(sorted, 75)
IQR      = Q3 − Q1
upper    = Q3 + 1.5 × IQR

valeurs_retenues = sorted.filter(v => v <= upper)
```

Actif par défaut (`excludeOutliers = true`). Désactivé avec `--include-outliers`.
Ignoré si `n < 4` (pas assez de données pour estimer les quartiles).

> **Référence** : Tukey, J. W. (1977). *Exploratory Data Analysis*. Addison-Wesley, §2C. Voir aussi [Outlier — Tukey's fences (Wikipedia)](https://en.wikipedia.org/wiki/Outlier#Tukey's_fences).

## Statistiques de synthèse (`DurationStats`)

Calculées sur les valeurs retenues après filtre outliers :

```
count           = nombre de valeurs retenues
excludedOutliers= nombre de valeurs rejetées par Tukey
avgDays         = somme / count
medianDays      = percentile(sorted, 50)
p85Days         = percentile(sorted, 85)
p95Days         = percentile(sorted, 95)
```

Calcul de percentile (interpolation nearest-rank) :
```
index = ceil(p / 100 × n) − 1  (clampé à [0, n−1])
```

## Date de livraison (`done_at`)

Toutes les métriques de durée et de débit utilisent **la date de la 1ère transition vers un statut team-done** comme borne de fin (et non plus le champ Jira `resolutiondate`).

**Source de vérité** : union (`statuses.category_key='done'`) ∪ (`config.jira.doneStatuses`).
- Première composante : table `statuses` populée par `sync` depuis `/rest/api/2/status` — Atlassian-standard, immune aux renommages.
- Deuxième composante : fallback pour les statuts historiques renommés absents de l'API courante (ex: `To Be Validated`, `Delivred`, `DELIVERED`, `Ready for release` sur KECK).

**Helper SQL** (`buildDeliveredCte` dans `src/metrics/utils.ts`) :
```sql
WITH delivered AS (
  SELECT issue_key, MIN(transitioned_at) AS done_at
  FROM transitions
  WHERE to_status IN (?, ?, …)        -- doneStatuses
  GROUP BY issue_key
)
```

**Stripping** : au runtime, `buildMetricConfig` retire de `inProgressStatuses` / `activeStatuses` / `queueStatuses` tout statut présent dans `doneSet`. Un statut "done" du Jira ne peut donc jamais polluer les métriques de WIP/flow, même s'il figure dans une liste in-progress du config.

**Édge case (aller-retour)** : si une issue est passée plusieurs fois en done (réouvertures), seul le **premier** passage est retenu (`MIN`).

**Bulk close** : un bulk close vers un statut done (ex: migration workflow) crée un `done_at` égal à la date du bulk. Pour neutraliser, fixer `cutoffDate` après cette date.
