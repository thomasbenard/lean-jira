# Formules et algorithmes des métriques

## Primitives communes

### Durée en jours ouvrés

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

Implémenté dans `workingDaysBetween(from, to)` (`src/metrics/utils.ts`).

Les issues avec `durée < 0` sont silencieusement ignorées (données corrompues).

> **Fenêtres de snapshots** (`cutoffDate ± 30j/7j`) : restent en jours calendaires — elles bornent la sélection d'issues, pas une durée.

### Conversion estimation

```
estimation (jours) = original_estimate_seconds / 28 800
```

28 800 s = 8 h = 1 jour-personne Atlassian par défaut.

### Filtre outliers (Tukey upper fence)

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

### Statistiques de synthèse (`DurationStats`)

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

### Date de livraison (`done_at`)

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

---

## Métriques de durée

### `lead-time`

**Définition** : délai total entre l'engagement de l'équipe (entrée en TODO) et la livraison team-done.

**Périmètre** : issues livrées ayant transité par **les deux** `todoStatuses` ET `devStartStatuses` (même population que `cycle-time` — garantit `lead ≥ cycle` pour chaque issue).

**Algorithme** :
```
Pour chaque issue :
  todo_at = MIN(transitioned_at) WHERE to_status IN todoStatuses
  done_at = MIN(transitioned_at) WHERE to_status IN doneStatuses

  lead_time = done_at − todo_at  (en jours ouvrés)
```

Si une issue a transité plusieurs fois dans un statut TODO (retour arrière), seul le **premier** passage est retenu (`MIN`). Idem pour `done_at`.

**Sortie** : `DurationStats` + liste détaillée des issues.

---

### `lead-time-by-size`

Même algorithme que `lead-time`, avec segmentation par bucket de taille avant calcul des stats.

**Bucketisation** (dépend de `metrics.estimation.method`) :
```
Si issue_type IN bugIssueTypes → BUG

method = "none"    → UNESTIMATED (toutes les issues)

method = "t-shirt" → sizeLabel (issues.size_label) converti en SizeBucket, ou UNESTIMATED si absent

method = "story-points" | "numeric" :
  Si story_points IS NULL ou <= 0 → UNESTIMATED
  Sinon applyThresholds(story_points, resolveThresholds(estimation))

method = "time" (défaut) :
  Si original_estimate_seconds IS NULL ou <= 0 → UNESTIMATED
  Sinon applyThresholds(original_estimate_seconds / 28 800, resolveThresholds(estimation))
```

`resolveThresholds` : fusionne seuils par défaut (`time` → {xs:0.5,s:1,m:3,l:5}j ; `story-points` → {xs:1,s:3,m:8,l:13}SP) avec `bucketThresholds` optionnel du config. `numeric` requiert `bucketThresholds` explicite.

**Sortie** : `DurationStats` par bucket (`XS | S | M | L | XL | BUG | UNESTIMATED`).

---

### `lead-time-normalized`

**Définition** : ratio lead time réel / estimation. Mesure la dérive côté demandeur.

**Périmètre** : issues livrées ayant transité par `todoStatuses` ET `devStartStatuses` (même population que `lead-time`), estimées (`original_estimate_seconds > 0`), **hors bugs**.

**Algorithme** :
```
Pour chaque issue éligible :
  lead_days     = done_at − todo_at
  estimate_days = original_estimate_seconds / 28 800
  ratio         = lead_days / estimate_days
```

**Interprétation** :
- `ratio = 1` → livré en exactement le temps estimé
- `ratio = 2` → 2× plus long que prévu
- `ratio < 1` → livré plus vite que prévu

**Sortie** : `DurationStats` (les valeurs sont des ratios, pas des jours). `unit = "ratio (lead réel / estimé)"`.

---

### `cycle-time`

**Définition** : durée du dev actif (premier passage en développement → 1ère transition team-done).

**Périmètre** : issues livrées ayant transité par **les deux** `devStartStatuses` ET `todoStatuses` (même population que `lead-time` — garantit `lead ≥ cycle` pour chaque issue).

**Algorithme** :
```
Pour chaque issue :
  started_at = MIN(transitioned_at) WHERE to_status IN devStartStatuses
  done_at    = MIN(transitioned_at) WHERE to_status IN doneStatuses

  cycle_time = done_at − started_at  (en jours ouvrés)
```

Exclut :
- l'attente backlog et le design (couvert par lead-time)
- la queue post-dev (validation PO, mise en prod) — sort du périmètre équipe car le statut team-done est atteint plus tôt.

**Sortie** : `DurationStats` + liste détaillée des issues.

---

### `cycle-time-by-size`

Même algorithme que `cycle-time`, avec segmentation par bucket de taille.

Bucketisation identique à `lead-time-by-size`.

**Sortie** : `DurationStats` par bucket.

---

### `cycle-time-normalized`

**Définition** : ratio cycle time réel / estimation. Mesure la dérive sur la phase dev seule.

**Périmètre** : issues livrées ayant transité par `todoStatuses` ET `devStartStatuses` (même population que `cycle-time`), estimées (`original_estimate_seconds > 0`), **hors bugs**.

**Algorithme** :
```
Pour chaque issue éligible :
  cycle_days    = done_at − started_at
  estimate_days = original_estimate_seconds / 28 800
  ratio         = cycle_days / estimate_days
```

**Interprétation** : si `médiane > 1`, l'équipe sous-estime systématiquement la phase dev.

**Sortie** : `DurationStats` (ratios). `unit = "ratio (cycle réel / estimé)"`.

---

### `bug-cycle-time`

**Définition** : cycle time restreint aux issues de type bug. Mesure la réactivité aux incidents.

**Périmètre** : issues de type `IN bugIssueTypes`, livrées, après `cutoffDate`.

**Algorithme** : identique à `cycle-time` (`done_at − started_at`), avec filtre `issue_type IN bugIssueTypes` et **sans** le filtre EXISTS sur TODO (les bugs sautent souvent l'étape backlog).

**Sortie** : `DurationStats`. `unit = "j"`.

---

## Métriques de débit (throughput)

### `throughput`

**Définition** : nombre d'issues livrées (team-done) par semaine calendaire.

**Périmètre** : toutes issues avec un `done_at` après `cutoffDate`.

**Algorithme** :
```sql
WITH delivered AS (...)
SELECT strftime('%Y-W%W', substr(d.done_at, 1, 10)) AS week, COUNT(*) AS count
FROM delivered d
WHERE d.done_at >= cutoffDate
GROUP BY week

avgPerWeek = total_issues / nombre_de_semaines
```

Mesure la livraison réelle vers un statut team-done, et non plus la pose du champ `resolutiondate`. Cohérent avec lead/cycle. Pour neutraliser les bulk closes (transitions massives vers Done lors d'une migration), conserver un `cutoffDate` postérieur à l'événement.

**Sortie** : liste `{week, count}` + `avgPerWeek`.

---

### `throughput-weighted`

**Définition** : somme des jours-personnes estimés livrés par semaine. Compense le biais du throughput brut (beaucoup de petits tickets = débit apparent élevé).

**Périmètre** : issues livrées (team-done), **hors bugs**, après `cutoffDate`.

**Algorithme** :
```
Pour chaque semaine :
  estimatedDays    = SUM(original_estimate_seconds) / 28 800
                     (uniquement si original_estimate_seconds > 0)
  estimatedCount   = COUNT(issues avec estimation > 0)
  unestimatedCount = COUNT(issues sans estimation)

avgPerWeek = total_estimatedDays / nombre_de_semaines
```

Les issues non estimées sont comptées séparément (`unestimatedCount`) mais **n'entrent pas** dans `estimatedDays`.

**Sortie** : liste `{week, estimatedDays, estimatedCount, unestimatedCount}` + `avgPerWeek`.

---

### `bug-throughput`

**Définition** : bugs livrés par semaine. Indicateur de charge incidents.

**Périmètre** : issues `issue_type IN bugIssueTypes`, livrées (team-done), après `cutoffDate`.

**Algorithme** : identique à `throughput` (groupage par semaine de `done_at`), avec filtre sur le type.

**Sortie** : liste `{week, count}` + `avgPerWeek`.

---

### `dev-time-allocation`

**Définition** : somme des cycle times (livrés + WIP en cours) par semaine, splitée en jours features (`featureDays`) et jours bugs (`bugDays`). `bugRatio = bugDays / (featureDays + bugDays)`, 0 si aucun jour.

**Périmètre** : issues ayant à la fois une transition `todoStatuses` ET une transition `devStartStatuses`, qu'elles soient livrées ou en cours. `excludeIssueTypes` appliqué aux deux populations.

**Algorithme** :
1. **Issues livrées** : pour chaque issue avec `done_at` dans la fenêtre, `days = workingDaysBetween(devStart, done_at)` distribué sur les semaines ISO entre devStart et done_at (`distributeAcrossWeeks`).
2. **Issues WIP** : pour chaque issue sans `done_at` avant `today` (`windowEndDate ?? date du jour`), `days = workingDaysBetween(devStart, today)` distribué de même. Issues démarrées avant `cutoffDate` incluses si encore en cours.
3. Attribution : `issue_type IN bugIssueTypes` → `bugDays`, sinon → `featureDays`.
4. `avgBugRatio` = moyenne **pondérée par volume** : `totalBugDays / (totalBugDays + totalFeatureDays)`.

**Snapshot** : fenêtre 7 jours (comme les métriques de débit). Stocke `featureDays` (total), `bugDays` (total), `bugRatio` (`avgBugRatio`).

**Sortie** : `{byWeek: [{week, featureDays, bugDays, bugRatio}], avgBugRatio}`.

---

---

### `bug-backlog`

**Définition** : pour une date de fin de fenêtre D et une fenêtre `[startDate, endDate]` (7 jours en mode snapshot) :

- `openCount` : bugs dont le dernier statut connu avant D n'est pas dans `doneStatuses`.
- `created` : bugs avec `created_at ∈ [startDate, endDate]`.
- `closed` : bugs dont la **première** transition vers un statut done a `transitioned_at ∈ [startDate, endDate]`.
- `netFlow = closed − created`.

**Règle d'état "ouvert"** : le dernier statut avant D est déterminé par une sous-requête corrélée sur `MAX(transitioned_at)` par issue. Si aucune transition n'existe avant D, le bug est ouvert. Si la dernière transition mène à un statut done, le bug est fermé — même s'il a été fermé puis rouvert après D.

**Cas limites** : `bugIssueTypes` vide → `{ openCount: 0, netFlow: 0, created: 0, closed: 0 }`. `doneStatuses` vide → tous les bugs créés avant D comptent comme ouverts.

**Snapshot** : fenêtre 7 jours (`WEEKLY_METRICS`). Stocke `openCount`, `netFlow`, `created`, `closed` (bucket `""`).

**Sortie** : `{ openCount, netFlow, created, closed }`.

---

### `stage-time-breakdown`

**Population** : identique à `cycle-time` — issues livrées ayant une transition `todoStatuses` ET une transition `devStartStatuses`. Filtres `cutoffDate`, `windowEndDate`, `excludeIssueTypes` appliqués.

**Calcul par issue** : `computeRoleDays(transitions, done_at, roles)` — jours ouvrés passés dans les statuts `role: dev` / `role: qa` / `role: po`. Passes multiples (rework) cumulées. Statuts hors rôle ignorés.

**Agrégation** : `statsFromDays(arr, false)` par rôle (pas de second filtrage outliers — déjà filtré sur `cycleDays` au niveau issue via Tukey upper fence).

**avgShareByRole** :
```
avgShareByRole[r] = mean( issue.roleDays[r] / (devDays + qaDays + poDays) )
                   sur les issues où devDays + qaDays + poDays > 0
```
Issues où la somme role-days = 0 exclues du calcul (évite division par zéro).

**Cas aucun rôle configuré** : retourne `{ count: 0, byRole: {...zeros}, avgShareByRole: {0,0,0} }` + warning console.

**Snapshot** : fenêtre 30 jours rolling (`ROLLING_WINDOW_DAYS`). Stocke `count` (bucket `""`), et pour chaque rôle avec `s.count > 0` : `median`, `p85`, `avgShare` (bucket `"dev"` / `"qa"` / `"po"`).

**Sortie** : `{ count, excludedOutliers, byRole: {dev, qa, po}: DurationStats, avgShareByRole: {dev, qa, po}: number }`.

---

### `stage-throughput-gap`

**Définition** : entrées et sorties de chaque rôle par semaine ISO. Détecte l'accumulation d'inventaire inter-rôles avant que le lead time ne dérive.

**Population** : toutes les issues ayant des transitions sur la période (pas limitées à la population cycle-time).

**Algorithme** :
```
Pour chaque issue, reconstructing la séquence de rôles ordonnée par transitioned_at :
  currentRole = rôle du to_status (ou "none" si hors rôle configuré)
  Pour chaque transition t :
    Si rôle(t.to_status) ≠ rôle(t.from_status) :
      Si rôle(t.to_status) = R → entrée[R][week(t.transitioned_at)] += 1
      Si rôle(t.from_status) = R → sortie[R][week(t.transitioned_at)] += 1

devNet = devIn − devOut  (idem qa, po)
avgNetByRole[R] = mean(devNet sur toutes les semaines non vides)
```

**Snapshot** : fenêtre 30 jours rolling. Stocke par rôle `avgNet` (bucket `"dev"` / `"qa"` / `"po"`).

**Sortie** : `{ byWeek: StageWeekRow[], avgNetByRole: {dev, qa, po} }`.

---

### `handoff-rework`

**Définition** : proportion de tickets retournant en arrière entre rôles (qa→dev, po→qa, po→dev). Mesure le coût du rework et la qualité d'entrée par étape.

**Population** : identique à `cycle-time` — `fetchDeliveredTransitions` + `groupByIssue`.

**Algorithme** :
```
Pour chaque issue, séquence de rôles ordonnée par transitioned_at :
  Un "rework" = transition de rôle vers un rôle antérieur dans l'ordre naturel dev < qa < po
  (passage par "none" transparent : qa → none → dev = 1 rework qaToDev)

reworkRatio = count(issues avec ≥ 1 rework) / count(total issues)
avgReworks   = sum(reworks par issue) / count(total issues)
byReworkType = { qaToDev, poToQa, poDev } — décompte occurrences
```

**Snapshot** : fenêtre 30 jours rolling. Stocke `reworkRatio`, `avgReworks`, et les 3 types de rework.

**Sortie** : `{ count, reworkRatio, avgReworks, byReworkType: {qaToDev, poToQa, poDev}, issues: ReworkIssue[] }`.

---

### `first-time-right`

**Définition** : % de tickets traversant chaque rôle en un seul passage continu (sans retour). KPI lisible complément de `handoff-rework`.

**Population** : identique à `cycle-time`.

**Algorithme** :
```
Pour chaque issue et chaque rôle R :
  passages[R] = nombre de segments contigus dans R
                (chaque interruption — sortie puis retour — = passage supplémentaire)

  eligible[R] = issues ayant ≥ 1 passage dans R
  firstTimeRight[R] = eligible[R] où passages[R] = 1
  ftrRate[R] = firstTimeRight[R] / eligible[R]  (0 si eligible=0)
  avgPasses[R] = mean(passages[R]) sur eligible[R]
```

**Snapshot** : fenêtre 30 jours rolling. Stocke par rôle : `eligible`, `firstTimeRight`, `ftrRate`, `avgPasses` (bucket `"dev"` / `"qa"` / `"po"`).

**Sortie** : `{ count, ftrByRole: {dev, qa, po}: {eligible, firstTimeRight, ftrRate, avgPasses} }`.

---

### `scope-change-rate`

**Définition** : % d'issues dont la description, l'estimation (Story Points) ou l'affectation de sprint a changé après leur entrée en sprint. Mesure la dérive de périmètre.

**Population** : toutes les issues ayant au moins un changement de champ `Sprint` dans `issue_field_changes`.

**Attribution au sprint** : premier sprint dont le `start_date` est le plus ancien parmi tous les `to_value` Sprint de l'issue (correspondance par inclusion de nom : `to_value.includes(sprintName)`).

**Algorithme** :
```
Pour chaque issue :
  firstSprintStart = min(start_date) des sprints mentionnés dans les changements Sprint

  changedDescription = ∃ changement (description|summary) après firstSprintStart
                       tel que similarityRatio(from, to) < 0.85

  changedStoryPoints = ∃ changement Story Points après firstSprintStart
                       avec from_value ≠ null

  changedSprint      = ∃ changement Sprint après firstSprintStart
                       avec from_value ≠ null

  issue changed = changedDescription ∨ changedStoryPoints ∨ changedSprint

changeRatio = changedIssues / totalIssues
```

**Similarité textuelle** ([distance de Levenshtein](https://en.wikipedia.org/wiki/Levenshtein_distance) normalisée) :
```
similarityRatio(a, b) = 1 − levenshtein(normalize(a), normalize(b)) / max(|a|, |b|)
normalize : lowercase, strip Markdown symbols, collapse whitespace
```

**Snapshot** : **skip** — sortie `bySprint` non mappable au format `(snapshot_date, bucket, stat)`.

**Sortie** : `{ totalIssues, changedIssues, changeRatio, bySprint: Record<sprintName, SprintScopeStats>, changedIssueKeys }`.

`SprintScopeStats` : `{ totalIssues, changedIssues, changeRatio, byChangeType: {description, storyPoints, sprintChange}, issueDetails: [{key, description, storyPoints, sprintChange}] }`. `issueDetails` permet au rapport de mapper chaque issue modifiée à son sprint réel et d'afficher ses types de changement.

---

### `bottleneck-analysis`

**Définition** : score composite 0–1 par rôle (dev / qa / po) synthétisant 4 signaux indépendants. Identifie le stage prioritaire à améliorer selon la Theory of Constraints.

**Population** :
- Signaux 1, 3, 4 (stageTime, reworkInbound, ftrPenalty) : population cycle-time livrée (`fetchDeliveredTransitions`), même fenêtre que les autres métriques rôle-aware.
- Signal 2 (avgNetFlow) : **toutes les transitions** dans la fenêtre (WIP inclus) — mesure l'accumulation en cours, pas seulement le livré.

**Signaux** :

| Signal | Formule | Interprétation |
|--------|---------|----------------|
| `stageTimeMedianDays` | médiane des jours passés dans le rôle (via `computeRoleDays`) | temps de passage unitaire |
| `avgNetFlow` | moyenne hebdomadaire de (entrées − sorties) dans le rôle | accumulation : net > 0 = embouteillage |
| `reworkInboundRate` | % issues avec au moins un retour arrière **vers** ce rôle | pression qualité entrante |
| `ftrPenalty` | 1 − ftrRate = % issues passant le rôle en ≥ 2 passages | rejet interne du rôle |

**Normalisation** : ranking dense normalisé 0–1 (`rankNormalize`). Ex-æquo → même rang. Normalise sur le nombre de valeurs distinctes, pas sur le nombre d'éléments.

```
uniqueSorted = distinct(values).sort()
n = |uniqueSorted|
rank(v) = indexOf(v, uniqueSorted) / (n − 1)   si n > 1
          0                                      si n = 1 (toutes égales)
```

**Score composite** :
```
score(role) = (rankStageTime + rankNetFlow + rankRework + rankFtr) / 4
```

**Signal dominant** : signal avec le rang le plus élevé. Si l'écart entre le 1er et le 2e rang < 0.1 → `combined`. En cas d'égalité exacte, priorité TOC : `accumulation > stage_time > rework > ftr`.

**po hardcodé à reworkInboundRate = 0** : po est le stage final de la chaîne — aucun flux aval ne lui retourne des tickets.

**Snapshot** : stocke par rôle `score` et `rank` (bucket `"dev"` / `"qa"` / `"po"`), plus `count` (bucket `""`).

**Sortie** : `{ count, primaryBottleneck: RoleKey | null, recommendation: string, byRole: {dev, qa, po}: {score, rank, dominantSignal, signals} }`.

---

## WIP (Work In Progress)

> **Loi de Little** ([Little, 1961](https://doi.org/10.1287/opre.9.3.383)) : dans un système stable, `WIP = throughput × cycle_time`. Inversement, `cycle_time = WIP / throughput`. Les trois métriques `wip`, `throughput` et `cycle-time` ne sont pas indépendantes — réduire le WIP réduit mécaniquement le cycle time sans modifier le throughput.

### `wip` — snapshot courant

**Définition** : issues simultanément en cours dans le sprint actif au moment de l'exécution.

**Algorithme** :
```
sprint_actif = SELECT id, name FROM sprints WHERE state = 'active'
               ORDER BY start_date DESC LIMIT 1

wip = SELECT key FROM issues
      WHERE current_sprint_id = sprint_actif.id
        AND current_status IN inProgressStatuses    -- ! déjà filtré contre done-category
```

Retourne 0 si aucun sprint actif.

**Note importante** : `inProgressStatuses` est filtré au runtime par `buildMetricConfig` contre l'union des statuts done (DB + config). Sur KECK : `À valider` (statusCategory='done') et `To Be Validated` (legacy renommé) sont automatiquement retirés du WIP.

**Sortie** : `{currentWip, sprintName, issueKeys[]}`.

---

### WIP historique (snapshots uniquement)

Utilisé par `backfillSnapshots` pour reconstituer le WIP à une date passée D.

**Problème** : les sprints historiques ne sont pas tracés dans `issues.current_sprint_id` (seul le sprint actif courant est stocké). Le WIP historique est donc calculé **sans scoping sprint**.

**Algorithme** :
```
Pour chaque issue :
  last_status_before_D = to_status WHERE transitioned_at <= D, MAX(transitioned_at)

wip_at_D = COUNT(issues) WHERE
  last_status_before_D IN inProgressStatuses    -- déjà filtré contre done-category
  AND (resolved_at IS NULL OR resolved_at > D)  -- garde-fou résolution Jira
```

SQL : voir `computeHistoricWip` dans `src/snapshots/compute.ts`. `inProgressStatuses` reçu est déjà strippé du done-set par `buildMetricConfig`.

---

### `wip-per-role`

**Définition** : nombre d'issues dont `current_status` appartient aux statuts du rôle (dev/qa/po), à l'instant T. Sans scoping sprint.

**Algorithme** :
```
Pour chaque rôle R ∈ {dev, qa, po} configuré :
  wipRole[R] = SELECT key FROM issues WHERE current_status IN roleStatuses[R]
```

**Cas aucun rôle configuré** : retourne `{ byRole: {dev: {count:0,issueKeys:[]}, ...} }`.

**Snapshot** : `computeHistoricWipPerRole` reconstruit le statut à la date D via `last_status_before_D` (même logique que WIP historique). Stocke `count` par bucket rôle (`"dev"` / `"qa"` / `"po"`).

**Sortie** : `{ byRole: {dev: WipRoleSlice, qa: WipRoleSlice, po: WipRoleSlice} }` où `WipRoleSlice = {count, issueKeys[]}`.

---

## Métriques de flux

### `flow-efficiency`

**Définition** : ratio temps actif / (temps actif + temps queue) sur la phase cycle-time. Mesure la santé du workflow indépendamment de la charge. Typique 5–15 % en flux non optimisé ([Modig & Åhlström, 2012 — *This is Lean*](https://thisislean.com) ; [Reinertsen, 2009 — *The Principles of Product Development Flow*, §6](https://books.google.com/books?id=1HlPPgAACAAJ)).

**Périmètre** : même population que `cycle-time` (issues livrées passées par TODO + dev start).

**Algorithme** :
```
Pour chaque issue :
  Pour chaque intervalle [trans[i].at, trans[i+1].at OU done_at] :
    status = trans[i].to_status
    days   = workingDaysBetween(start, end)
    Si status ∈ activeStatuses : actif += days
    Sinon si status ∈ queueStatuses : queue += days
    Sinon : ignoré (TODO retour, hors flux mesuré)

  flow_efficiency_issue = actif / (actif + queue)

Filtre outliers Tukey sur totalDays (actif + queue) si excludeOutliers.

Agrégat (pondéré durée) = SUM(actif) / SUM(actif + queue)
Médiane (par issue)     = percentile(flow_efficiency_issue, 50)
P15 (pire 15 %)         = percentile(flow_efficiency_issue, 15)
```

**Pourquoi l'agrégat plutôt que la moyenne des ratios** : la moyenne sur-pondère les petits tickets dont une heure de queue suffit à dominer le ratio. L'agrégat reflète la part globale de temps actif vs. attente.

**Sortie** :
```
{
  count, excludedOutliers,
  aggregateFlowEfficiency, medianFlowEfficiency, p15FlowEfficiency,
  totalActiveDays, totalQueueDays,
  issues: [...],
  unit: "ratio (actif / total)"
}
```

---

### `aging-wip`

**Définition** : pour chaque ticket actuellement en cours, âge depuis le 1er passage en dev, comparé aux percentiles cycle-time historiques. Détecte les tickets en train de rater leur SLE (*Service Level Expectation*, [Kanban Guide 2020](https://kanbanguides.org/english/)) — actionnable au stand-up.

**Périmètre** : issues actuellement en in-progress (filtre runtime contre done-category), peu importe le sprint. Pas de scoping sprint.

**Algorithme** :
```
asOf = windowEndDate ?? maintenant

Pour chaque issue dont :
  last_status_before_asOf ∈ inProgressStatuses
  ET (resolved_at IS NULL OR resolved_at > asOf)
  ET 1er passage en devStart existant ≤ asOf :
    age = workingDaysBetween(first_dev_at, asOf)

Percentiles historiques = cycle-time des issues avec done_at ≤ asOf,
                          même filtre population que cycle-time.

Classification :
  age ≤ P50  → ok
  age ≤ P85  → watch
  age ≤ P95  → at-risk
  age > P95  → critical
```

**Sortie** :
```
{
  asOf, count,
  percentiles: { p50, p85, p95 },
  riskCounts: { ok, watch, atRisk, critical },
  issues: [{ issueKey, summary, status, startedAt, ageDays, riskLevel }, ...]
}
```

---

### `forecast` — Monte Carlo

**Définition** : forecast probabiliste de livraison sur horizons 1/2/4/8 semaines. Simule 10 000 scénarios par horizon en tirant avec remise dans les 12 dernières semaines de throughput ([Vacanti, 2015 — *Actionable Agile Metrics for Predictability*](https://www.actionableagile.com)).

**Périmètre** : 12 semaines de throughput précédant `windowEndDate` (ou maintenant). **Pas de filtre `cutoffDate`** : `LIMIT 12` borne déjà l'historique, pour éviter qu'un snapshot historique avec cutoff étroit (30j glissants) ne réduise le pool à 4 semaines.

**Algorithme** :
```
samples = 12 dernières semaines de throughput, en ordre chronologique

Pour chaque horizon H ∈ {1, 2, 4, 8} :
  Pour s = 1..10 000 simulations :
    total = somme de H tirages aléatoires (avec remise) dans samples
  totals = trier les 10 000 sommes croissant

  Sortie pour H :
    p15 = percentile(totals, 15)   ← engagement à 85 % de confiance
    p50 = percentile(totals, 50)   ← livraison médiane attendue
    p85 = percentile(totals, 85)
    p95 = percentile(totals, 95)
```

**Convention engagement** : `p15` correspond à « 85 % des simulations livrent au moins ce nombre » → c'est le chiffre à promettre quand on veut être fiable.

**Non déterministe en mode réel** : `random()` injectable retourne `Math.random()`. **Mode fake** : `random()` = PRNG Mulberry32 seedé par `frozenNow` — sortie déterministe. Skip dans `backfillSnapshots` (computé live à chaque `npm run report`).

**Sortie** :
```
{
  recentWeeks: number[],  // pool d'échantillonnage
  weeksUsed,
  byHorizon: [{ weeks, p15, p50, p85, p95 }, ...],
  simulations: 10000,
  unit: "issues"
}
```

---

## Snapshots — fenêtres de calcul

`backfillSnapshots` calcule toutes les métriques pour chaque dimanche depuis `cutoffDate` jusqu'à aujourd'hui.

Pour chaque date D :

| Type de métrique | Fenêtre appliquée |
|---|---|
| Durée (lead, cycle, normalized, bug-cycle, flow-efficiency) | `cutoffDate = D − 30j`, `windowEndDate = D` |
| **By-size (lead-time-by-size, cycle-time-by-size) + aging-wip** | `cutoffDate = config.cutoffDate` (global), `windowEndDate = D` — cumulative depuis l'origine |
| Débit (throughput, bug-throughput, throughput-weighted, bug-backlog) | `cutoffDate = D − 7j`, `windowEndDate = D` |
| WIP (`wip`, `wip-per-role`) | Algorithme historique ci-dessus, pas de fenêtre glissante |
| Rework / qualité (`handoff-rework`, `first-time-right`) | `cutoffDate = D − 30j`, `windowEndDate = D` |
| Flux rôles (`stage-throughput-gap`) | `cutoffDate = D − 30j`, `windowEndDate = D` |
| `forecast` | **Skip** — Monte Carlo non déterministe, computé live en report |
| `scope-change-rate` | **Skip** — shape `bySprint` non mappable au format `(snapshot_date, bucket, stat)` |

**Stats extraites et stockées** par snapshot (résolution dans `extractStats`, `src/snapshots/compute.ts`) :

| Type de résultat (clé identifiante) | Stats stockées |
|---|---|
| `buckets` (Record<SizeBucket, DurationStats>) | `count`, `median`, `p85`, `p95` par bucket non-vide |
| `aggregateFlowEfficiency` (flow-efficiency) | `count`, `aggregate`, `median`, `activeDays`, `queueDays` |
| `riskCounts` (aging-wip) | `count`, `ok`, `watch`, `atRisk`, `critical`, `p50`, `p85`, `p95` |
| `avgDays` (DurationStats) | `count`, `median`, `p85` |
| `byWeek` sans estimation | `count` (total semaine) |
| `byWeek` avec estimation | `count`, `estimatedDays` |
| `openCount` (bug-backlog) | `openCount`, `netFlow`, `created`, `closed` |
| WIP global | `count` (bucket `""`) |
| WIP par rôle (`computeHistoricWipPerRole`) | `count` par bucket rôle (`"dev"` / `"qa"` / `"po"`) |
| `avgShareByRole` (stage-time-breakdown) | `median`, `p85`, `avgShare` par bucket rôle non-vide ; discriminateur prioritaire sur `byRole` |
| `byRole` (wip-per-role-like) | `count` par bucket rôle ; ne déclenche que si `avgShareByRole` absent |
| `avgNetByRole` (stage-throughput-gap) | `in`, `out`, `avgNet` par bucket rôle |
| `reworkRatio` (handoff-rework) | `reworkRatio`, `avgReworks`, `count` par bucket rework type (`qaToDev`/`poToQa`/`poDev`) |
| `ftrByRole` (first-time-right) | `eligible`, `ftrRate`, `avgPasses` par bucket rôle éligible |

Tout résultat ne correspondant à aucune de ces formes est silencieusement ignoré. Pour ajouter une métrique snapshottable avec une nouvelle forme, ajouter une branche dans `extractStats`.

Le rapport HTML lit `metric_snapshots` pour les tendances ; il appelle `agingWipMetric.compute(...)`, `forecastMetric.compute(...)` et `cycleTimeMetric.compute(...)` en direct pour la vue "état actuel" + scatter aging + histogramme + table forecast.
