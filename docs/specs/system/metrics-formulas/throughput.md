# Métriques de débit (throughput)

[← Index](../metrics-formulas.md)

## `throughput`

**Définition** : nombre d'issues livrées (team-done) par semaine.

**Périmètre** : toutes issues avec un `done_at` dans `[cutoffDate, windowEndDate]`. `excludeIssueTypes` appliqué.

**Format semaine** : `strftime('%Y-W%W', done_at)` SQLite — semaines débutant le **lundi**, premier lundi de l'année = `W01`. Légère divergence vs ISO 8601 strict (`%W` produit `W00` pour les jours du début janvier qui précèdent le premier lundi). Suffisant pour tendance hebdo, ne pas joindre avec une autre source ISO sans normalisation.

**Algorithme** :
```sql
WITH delivered AS (...)
SELECT strftime('%Y-W%W', substr(d.done_at, 1, 10)) AS week, COUNT(*) AS count
FROM delivered d
JOIN issues i ON i.key = d.issue_key
WHERE 1=1  excludeSql  cutoffSql  endSql
GROUP BY week

avgPerWeek = total_issues / nombre_de_semaines_avec_livraisons
```

> **Choix implicite — `avgPerWeek` biaisé vers le haut** : `rows.length` ne compte que les semaines avec ≥ 1 livraison. Une semaine à zéro n'est pas représentée et n'entre pas au dénominateur. Conséquence : un projet avec beaucoup de semaines creuses surestime sa moyenne. Pour comparer à un débit "lissé sur la fenêtre complète", recalculer `total / nombreDeSemainesEntreCutoffEtMaintenant`.

Mesure la livraison réelle vers un statut team-done, et non plus la pose du champ `resolutiondate`. Cohérent avec lead/cycle. Pour neutraliser les bulk closes (transitions massives vers Done lors d'une migration), conserver un `cutoffDate` postérieur à l'événement.

**Sortie** : liste `{week, count}` + `avgPerWeek`.

---

## `throughput-weighted`

**Définition** : somme des unités estimées livrées par semaine. Compense le biais du throughput brut (beaucoup de petits tickets = débit apparent élevé).

**Disabled si méthode incompatible** : retourne `{ disabled: true, byWeek: [], avgPerWeek: 0, unit: "j-h" }` si `metrics.estimation.method ∈ {t-shirt, none}`.

**Mapping méthode → colonne / unité** :

| `estimation.method` | Colonne SQL                  | Unité  |
|---------------------|------------------------------|--------|
| `time`              | `original_estimate_seconds`  | `j-h`  |
| `story-points`      | `story_points`               | `SP`   |
| `numeric`           | `story_points` (réutilisée)  | `pts`  |
| `t-shirt` / `none`  | —                            | disabled |

> Pour `numeric`, la valeur est stockée dans la colonne `story_points` du sync (pas de colonne dédiée). Seule l'unité diffère.

**Périmètre** : issues livrées (team-done), **hors bugs** (via `buildBugExclusionFragment`), `excludeIssueTypes` appliqué, dans `[cutoffDate, windowEndDate]`.

**Algorithme** :
```
Pour chaque semaine :
  estimatedDays    = SUM(col WHERE col > 0) / divisor
                     (divisor = 28 800 pour time, 1 sinon)
  estimatedCount   = COUNT(issues avec col > 0)
  unestimatedCount = COUNT(issues avec col IS NULL OR col <= 0)

avgPerWeek = total_estimatedDays / rows.length
```

Les issues non estimées sont comptées séparément (`unestimatedCount`) mais **n'entrent pas** dans `estimatedDays`. Même biais `avgPerWeek` que `throughput` (semaines vides absentes du dénominateur).

**Sortie** : `{ byWeek: [{week, estimatedDays, estimatedCount, unestimatedCount}], avgPerWeek, unit, disabled }`.

---

## `bug-throughput`

**Définition** : bugs livrés par semaine. Indicateur de charge incidents.

**Périmètre** : issues `issue_type IN bugIssueTypes`, livrées (team-done), dans `[cutoffDate, windowEndDate]`.

**Court-circuit** : si `bugIssueTypes` est vide → renvoie `{ byWeek: [], avgPerWeek: 0 }`.

**Filtres** : **`excludeIssueTypes` n'est pas appliqué** (divergence vs `throughput`). Sans incidence en pratique sauf si un même type apparaît dans les deux listes.

**Algorithme** : identique à `throughput` (groupage par semaine `%Y-W%W` de `done_at`), avec filtre `i.issue_type IN bugIssueTypes`. Même biais `avgPerWeek` (semaines vides absentes).

**Sortie** : liste `{week, count}` + `avgPerWeek`.

---

## `dev-time-allocation`

**Définition** : somme des cycle times (livrés + WIP en cours) par semaine, splitée en jours features (`featureDays`) et jours bugs (`bugDays`). `bugRatio = bugDays / (featureDays + bugDays)`, 0 si aucun jour.

**Périmètre** : issues ayant transité par `devStartStatuses` (filtre EXISTS via JOIN delivered + `to_status IN devStartStatuses`), livrées **ou** WIP en cours. **Pas d'exigence TODO** (cohérent avec `cycle-time`). `excludeIssueTypes` appliqué aux deux populations.

**Format semaine** : `isoWeek()` côté JS — **vrai ISO 8601** (semaine commence le lundi, première semaine = celle contenant le 4 janvier). **Diverge du format `%Y-W%W` SQLite** utilisé par `throughput` / `bug-throughput`. Ne pas joindre les deux séries directement sur la clé `week`.

**Algorithme** :
1. **Issues livrées** : pour chaque issue avec `done_at` dans la fenêtre, `days = workingDaysBetween(devStart, done_at)` distribué via `distributeAcrossWeeks`.
2. **Issues WIP** : `done_at` fictif = `today` (= `windowEndDate ?? date du jour`). Sélectionnées par `NOT EXISTS (transition done <= today)`. Issues démarrées avant `cutoffDate` incluses si encore en cours. `days = workingDaysBetween(devStart, today)` distribué de même.
3. Attribution : `issue_type IN bugIssueTypes` → `bugDays`, sinon → `featureDays`.
4. `avgBugRatio` = moyenne **pondérée par volume** : `totalBugDays / (totalBugDays + totalFeatureDays)`. Une semaine avec beaucoup de jours pèse plus qu'une semaine creuse — divergence vs `mean(weekly bugRatio)`.

**Skip silencieux** : `if (workingDaysBetween(...) <= 0)` retourne sans alloc (évite division ; couvre `done_at == started_at`).

> **Choix arbitraire — distribution uniforme 5j/semaine** : `distributeAcrossWeeks` répartit les jours ouvrés en partant du **lundi de la semaine du `started_at`** (rewind via `dow - 1`), puis alloue **5 jours par semaine pleine** (`Math.min(5, remaining)`) jusqu'à la semaine de `done_at` qui reçoit le reliquat. Conséquences :
> - Une issue débutée vendredi 1j ouvré → contribue 1j à la semaine du vendredi (alloc = `min(5, 1) = 1`, OK).
> - Une issue de 12 jours ouvrés sur 3 semaines → 5 + 5 + 2.
> - **Pas pondéré par jours ouvrés réels par semaine** (jours fériés, début/fin de semaine partiels du `devStart` non modélisés).
> - **Le rewind au lundi est cosmétique** : la première semaine reçoit `min(5, totalDays)` jours, indépendamment du jour de la semaine où `devStart` tombe.

**Snapshot** : fenêtre 7 jours (comme les métriques de débit). Stocke `featureDays` (total), `bugDays` (total), `bugRatio` (`avgBugRatio`).

**Sortie** : `{byWeek: [{week, featureDays, bugDays, bugRatio}], avgBugRatio}`.

---

## `bug-backlog`

**Définition** : pour une date de fin de fenêtre D et une fenêtre `[startDate, endDate]` (7 jours en mode snapshot) :

- `openCount` : bugs dont le dernier statut connu avant D n'est pas dans `doneStatuses`.
- `created` : bugs avec `created_at ∈ [startDate, endDate]`.
- `closed` : bugs dont la **première** transition vers un statut done a `transitioned_at ∈ [startDate, endDate]`.
- `netFlow = closed − created`.

**Règle d'état "ouvert"** : le dernier statut avant D est déterminé par une sous-requête corrélée sur `MAX(transitioned_at)` par issue. Si aucune transition n'existe avant D, le bug est ouvert. Si la dernière transition mène à un statut done, le bug est fermé — même s'il a été fermé puis rouvert après D.

> **Convention `netFlow`** : `closed − created` → **positif = backlog se vide**, négatif = backlog grossit. Convention atypique (la convention « inflow » serait `created − closed`). Lecture : `netFlow > 0` = bonne semaine.

> **Réouvertures** : `closed` compte la **première** transition vers un statut done. Conséquence : un bug fermé hors fenêtre (avant `startDate`), puis rouvert puis re-fermé dans la fenêtre, **n'apparaît pas** dans `closed` (le premier done est antérieur). Idem si fermeture multiples — seule la première compte une fois.

**Cas limites** : `bugIssueTypes` vide → `{ openCount: 0, netFlow: 0, created: 0, closed: 0 }`. `doneStatuses` vide → tous les bugs créés avant D comptent comme ouverts (`closed = 0` par défaut).

**Snapshot** : fenêtre 7 jours (`WEEKLY_METRICS`). Stocke `openCount`, `netFlow`, `created`, `closed` (bucket `""`).

**Sortie** : `{ openCount, netFlow, created, closed }`.
