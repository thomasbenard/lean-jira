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

Implémenté dans `workingDaysBetween(from, to)` (`src/metrics/utils.ts`). Retourne **0** si `endMs ≤ startMs` (pas d'erreur jetée — `done_at == todo_at` produit donc 0).

> **Limitation connue** : `startDow = new Date(from).getDay()` utilise la **timezone locale du process** (UTC sur CI, locale sur poste dev). Pour des transitions proches de minuit, deux machines peuvent calculer un nombre de jours ouvrés différent. À fixer en `getUTCDay()` pour aligner sur `isoWeek` (qui force déjà UTC).

Les issues avec `durée < 0` sont silencieusement ignorées (données corrompues) via le filtre amont `if (done_at < todo_at) continue;` (idem `started_at`) côté lead/cycle.

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

**Périmètre** : issues livrées (`done_at` non null) ayant transité par **les deux** `todoStatuses` ET `devStartStatuses` (EXISTS sur les deux). **Sous-ensemble strict** de la population `cycle-time` (qui n'exige pas TODO). Pour toute issue présente dans lead, `lead ≥ cycle` est garanti car `todo_at ≤ started_at`.

**Algorithme** :
```
Pour chaque issue :
  todo_at = MIN(transitioned_at) WHERE to_status IN todoStatuses
  done_at = MIN(transitioned_at) WHERE to_status IN doneStatuses

  lead_time = done_at − todo_at  (en jours ouvrés)
```

Si une issue a transité plusieurs fois dans un statut TODO (retour arrière), seul le **premier** passage est retenu (`MIN`). Idem pour `done_at`.

**Filtres** : `excludeIssueTypes`, `cutoffDate`, `windowEndDate` appliqués via `buildExcludeIssueTypesFragment` / `buildWindowFragment`. `cutoffDate` et `windowEndDate` bornent **`done_at`** (pas `todo_at`) — une issue dont `todo_at < cutoffDate` mais `done_at ∈ [cutoffDate, windowEndDate]` est incluse, la durée mesurée peut donc largement dépasser la longueur de la fenêtre.

**Skip silencieux** : si `done_at < todo_at` (anomalie — typiquement transitions désordonnées ou bulk close mal formé), l'issue est ignorée sans warning.

**Sortie** : `DurationStats` + liste détaillée des issues.

---

### `lead-time-by-size`

Même algorithme que `lead-time` (population stricte : TODO ET devStart EXISTS), avec segmentation par bucket de taille avant calcul des stats.

**Périmètre** : identique à `lead-time`. Les bugs **sont inclus** dans la population mais routés vers le bucket `BUG` (pas vers XS/S/M/L/XL). Contraste avec `lead-time-normalized` qui les exclut totalement.

**Filtres** : `excludeIssueTypes`, `cutoffDate`, `windowEndDate` appliqués comme pour `lead-time` (cutoff borne `done_at`).

**Skip silencieux** : `if (workingDaysBetween(todo_at, done_at) < 0)` (inatteignable car la primitive retourne 0, cf. § "Durée en jours ouvrés").

**Outliers** : `excludeOutliers` appliqué **par bucket indépendamment** (un outlier dans `XS` n'affecte pas `L`). Le compteur `excludedOutliers` est par bucket.

**Persistance snapshots** : seuls `count / median / p85 / p95` sont persistés par bucket dans `metric_snapshots` (cf. § Snapshots, branche `buckets`). `excludedOutliers` reste visible dans la sortie JSON live mais n'est **pas** historisé — pas de série temporelle des rejets Tukey par bucket. Vaut aussi pour `cycle-time-by-size`.

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

**Bornes** (cf. `applyThresholds` dans `utils.ts`) : inclusives à gauche, exclusives à droite. `XS = [0, xs)`, `S = [xs, s)`, `M = [s, m)`, `L = [m, l)`, `XL = [l, +∞)`. Une issue à exactement `t.xs` tombe en `S`, pas en `XS`.

> **Limitation t-shirt** : `bucketize` cast `issue.sizeLabel as SizeBucket` sans validation runtime. Un label hors enum (`"Large"`, `"M "` avec espace) produit un bucket invalide qui contamine `DurationStats` (clé inattendue) sans warning. Restreindre aux 5 valeurs `XS/S/M/L/XL` côté Jira ou ajouter `if (!BUCKET_ORDER.includes(label)) return "UNESTIMATED";`.

**Sortie** : `DurationStats` par bucket (`XS | S | M | L | XL | BUG | UNESTIMATED`).

---

### `lead-time-normalized`

**Définition** : ratio lead time réel / estimation. Mesure la dérive côté demandeur.

**Disabled si méthode ≠ time** : si `metrics.estimation.method !== "time"` la métrique retourne immédiatement `{ count: 0, ..., disabled: true }`. Seule la méthode `time` (`original_estimate_seconds`) est supportée — les méthodes `story-points`, `numeric`, `t-shirt`, `none` désactivent la métrique.

**Périmètre** : issues livrées ayant transité par `todoStatuses` ET `devStartStatuses` (même population que `lead-time`), estimées (`original_estimate_seconds > 0` — exclut NULL et 0), **hors bugs** (via `buildBugExclusionFragment`).

**Filtres** : `excludeIssueTypes`, `cutoffDate`, `windowEndDate` appliqués (cutoff borne `done_at`).

**Algorithme** :
```
Pour chaque issue éligible :
  lead_days     = done_at − todo_at  (jours ouvrés)
  estimate_days = original_estimate_seconds / 28 800
  ratio         = lead_days / estimate_days
```

Pas de division par zéro possible (filtré par `original_estimate_seconds > 0` en SQL).

**Skip silencieux** : `if (lead_days < 0)` (inatteignable, cf. primitive).

**Outliers** : `excludeOutliers` appliqué sur les ratios via Tukey upper fence (mêmes règles que les durées).

**Interprétation** :
- `ratio = 1` → livré en exactement le temps estimé
- `ratio = 2` → 2× plus long que prévu
- `ratio < 1` → livré plus vite que prévu

**Sortie** : `DurationStats` (les valeurs sont des ratios, pas des jours). `unit = "ratio (lead réel / estimé)"`.

---

### `cycle-time`

**Définition** : durée du dev actif (premier passage en développement → 1ère transition team-done).

**Périmètre** : issues livrées (`done_at` non null) ayant transité par `devStartStatuses` (EXISTS via JOIN delivered + filtre `to_status IN devStartStatuses`). **Pas d'exigence TODO** — le filtre `EXISTS todoStatuses` a été retiré (cf. CLAUDE.md invariant : ~1% des issues sautent TODO sur le board cible, contrainte coûteuse pour bénéfice négligeable). Donc `population(cycle-time) ⊇ population(lead-time)`.

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

**Filtres** : `excludeIssueTypes`, `cutoffDate`, `windowEndDate` appliqués. `cutoffDate` et `windowEndDate` bornent **`done_at`** (pas `started_at`) — même règle que lead-time, voir mise en garde ci-dessus.

**Skip silencieux** : si `done_at < started_at` → issue ignorée sans warning.

**Sortie** : `DurationStats` + liste détaillée des issues.

---

### `cycle-time-by-size`

Même algorithme que `cycle-time` (population : devStart EXISTS, **pas de TODO requirement**), avec segmentation par bucket de taille. Donc `population(cycle-time-by-size) ⊇ population(lead-time-by-size)`.

**Périmètre** : identique à `cycle-time`. Bugs **inclus** dans la population mais routés vers le bucket `BUG`.

**Filtres** : `excludeIssueTypes`, `cutoffDate`, `windowEndDate` (cutoff borne `done_at`).

**Skip silencieux** : `if (workingDaysBetween(started_at, done_at) < 0)` (inatteignable).

**Outliers** : appliqués **par bucket indépendamment** (idem `lead-time-by-size`).

**Bucketisation** identique à `lead-time-by-size`.

**Sortie** : `DurationStats` par bucket (`XS | S | M | L | XL | BUG | UNESTIMATED`).

---

### `cycle-time-normalized`

**Définition** : ratio cycle time réel / estimation. Mesure la dérive sur la phase dev seule.

**Disabled si méthode ≠ time** : retourne `{ disabled: true }` si `metrics.estimation.method !== "time"`.

**Périmètre** : issues livrées ayant transité par `devStartStatuses` (**même population que `cycle-time` — pas d'exigence TODO**), estimées (`original_estimate_seconds > 0`), **hors bugs** (via `buildBugExclusionFragment`).

**Filtres** : `excludeIssueTypes`, `cutoffDate`, `windowEndDate` (cutoff borne `done_at`).

**Algorithme** :
```
Pour chaque issue éligible :
  cycle_days    = done_at − started_at  (jours ouvrés)
  estimate_days = original_estimate_seconds / 28 800
  ratio         = cycle_days / estimate_days
```

**Skip silencieux** : `if (cycle_days < 0)` (inatteignable).

**Outliers** : `excludeOutliers` sur ratios (Tukey upper fence).

**Interprétation** : si `médiane > 1`, l'équipe sous-estime systématiquement la phase dev.

**Sortie** : `DurationStats` (ratios). `unit = "ratio (cycle réel / estimé)"`.

---

### `bug-cycle-time`

**Définition** : cycle time restreint aux issues de type bug. Mesure la réactivité aux incidents.

**Périmètre** : issues de type `IN bugIssueTypes`, livrées (devStart EXISTS via JOIN delivered + filtre `to_status IN devStartStatuses`), après `cutoffDate`. **Pas d'exigence TODO** (idem `cycle-time`).

**Court-circuit** : si `bugIssueTypes` est vide → renvoie immédiatement des stats vides (`count: 0`).

**Filtres** : `cutoffDate`, `windowEndDate` (cutoff borne `done_at`). **`excludeIssueTypes` n'est pas appliqué** — divergence vs `cycle-time`. Sans incidence en pratique tant qu'aucun type n'apparaît dans les deux listes (un type ne peut être à la fois bug et exclu).

**Algorithme** : identique à `cycle-time` (`done_at − started_at`), avec filtre `issue_type IN bugIssueTypes`.

**Skip silencieux** : `if (workingDaysBetween(started_at, done_at) >= 0)` push (équivalent à filtrer les négatifs ; inatteignable).

**Outliers** : `excludeOutliers` standard.

**Sortie** : `DurationStats`. `unit = "j"`.

---

## Métriques de débit (throughput)

### `throughput`

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

### `throughput-weighted`

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

### `bug-throughput`

**Définition** : bugs livrés par semaine. Indicateur de charge incidents.

**Périmètre** : issues `issue_type IN bugIssueTypes`, livrées (team-done), dans `[cutoffDate, windowEndDate]`.

**Court-circuit** : si `bugIssueTypes` est vide → renvoie `{ byWeek: [], avgPerWeek: 0 }`.

**Filtres** : **`excludeIssueTypes` n'est pas appliqué** (divergence vs `throughput`). Sans incidence en pratique sauf si un même type apparaît dans les deux listes.

**Algorithme** : identique à `throughput` (groupage par semaine `%Y-W%W` de `done_at`), avec filtre `i.issue_type IN bugIssueTypes`. Même biais `avgPerWeek` (semaines vides absentes).

**Sortie** : liste `{week, count}` + `avgPerWeek`.

---

### `dev-time-allocation`

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

---

### `bug-backlog`

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

---

### `stage-time-breakdown`

**Population** : identique à `cycle-time` — issues livrées ayant une transition `devStartStatuses` (filtre `todoStatuses` retiré, voir invariant CLAUDE.md). Filtres `cutoffDate`, `windowEndDate`, `excludeIssueTypes` appliqués via `fetchDeliveredTransitions`.

**Calcul par issue** : `computeRoleDays(transitions, done_at, roles)` — jours ouvrés passés dans les statuts `role: dev` / `role: qa` / `role: po`. Passes multiples (rework) cumulées. Statuts hors rôle ignorés (la somme `devDays + qaDays + poDays` peut donc être strictement inférieure à `cycleDays` si des statuts orphelins existent dans le workflow). Si un statut figure dans plusieurs listes de rôles (board.yaml mal formé), résolution `else-if` dans `computeRoleDays` → priorité `dev > qa > po`.

**Outliers** : filtre Tukey sur `cycleDays` au niveau issue (pas par rôle), seulement si `excludeOutliers !== false` ET `rawIssues.length >= 4`. Une issue exceptionnellement longue (toutes étapes confondues) est exclue ; les médianes/p85 par rôle sont calculées sans ces issues. Pas de second filtrage par rôle (`statsFromDays(arr, false)`).

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

**Définition** : entrées et sorties de chaque rôle par semaine ISO 8601 (`isoWeek()`, lundi-dimanche). Détecte l'accumulation d'inventaire inter-rôles avant que le lead time ne dérive.

**Population** : toutes les issues ayant des transitions sur la période (pas limitées à la population cycle-time, WIP inclus). Filtres `cutoffDate`, `windowEndDate`, `excludeIssueTypes` appliqués sur `transitioned_at` (pas sur `done_at`).

**Algorithme** :
```
Pour chaque issue, transitions ordonnées par transitioned_at :
  prevRole = null     -- pas de rôle observé avant la 1re transition
  Pour chaque transition t :
    curRole = rôle(t.to_status)  -- "dev"/"qa"/"po" ou null si hors rôle
    Si curRole ≠ prevRole :
      week = isoWeek(t.transitioned_at)
      Si prevRole ≠ null : weekMap[week][prevRole+"Out"] += 1
      Si curRole ≠ null  : weekMap[week][curRole+"In"]  += 1
      prevRole = curRole

devNet = devIn − devOut  (idem qa, po)
avgNetByRole[R] = sum(devNet) / nb_semaines_observées   -- mean sur weekMap.size
```

**Choix implicite — premier passage en rôle = `In` sans `Out`** : à l'arrivée de la 1re transition vers un rôle, `prevRole=null`, donc on incrémente `In` sans contrepartie `Out`. Cohérent (l'issue entre dans le système), mais introduit un biais positif sur `devNet` au démarrage de chaque issue.

**Choix implicite — transitions hors rôle transparentes** : `dev → none → qa` produit `devOut` à la 1re et `qaIn` à la 2e (deux entrées de semaine distinctes possibles). Cohérent par construction (chaque rôle voit l'issue partir et arriver une fois), mais l'issue peut être comptée dans plusieurs `Out`/`In` au fil du temps si elle oscille.

**Choix implicite — `avgNetByRole` biaisé sur semaines vides** : dénominateur = nombre de semaines avec ≥ 1 transition observée (`weekMap.size`), pas le nombre de semaines calendaires de la fenêtre. Une équipe inactive 4 semaines sur 8 sera moyennée sur 4, pas 8.

**Snapshot** : fenêtre 30 jours rolling. Stocke par rôle `avgNet` (bucket `"dev"` / `"qa"` / `"po"`).

**Sortie** : `{ byWeek: StageWeekRow[], avgNetByRole: {dev, qa, po} }`.

---

### `handoff-rework`

**Définition** : proportion de tickets retournant en arrière entre rôles (qa→dev, po→qa, po→dev). Mesure le coût du rework et la qualité d'entrée par étape.

**Population** : identique à `cycle-time` — `fetchDeliveredTransitions` + `groupByIssue` (filtre `devStartStatuses`, `cutoffDate`, `windowEndDate`, `excludeIssueTypes`).

**Algorithme** :
```
Pour chaque issue, séquence de rôles ordonnée par transitioned_at :
  prevRole conservé à travers les statuts hors-rôle (none transparent)
  Un "rework" = transition vers un rôle d'index plus petit (dev=0 < qa=1 < po=2)
  Ex : qa → none → dev = 1 rework qaToDev (le saut par none ne réinitialise pas prevRole)

reworkRatio = count(issues avec ≥ 1 rework) / count(total issues)
avgReworks   = sum(reworks par issue) / count(total issues)   -- y compris issues sans rework au numérateur 0
byReworkType = { qaToDev, poToQa, poDev } — décompte d'occurrences (une issue peut compter plusieurs fois)
```

**Choix implicite — aucun warning si rôles non configurés** : contrairement à `stage-time-breakdown` et `wip-per-role`, `handoff-rework` ne logue pas d'avertissement. Si `devStatuses/qaStatuses/poStatuses` sont vides, `getRole` retourne toujours `null`, aucun rework n'est détecté → `{count, reworkRatio:0, avgReworks:0, byReworkType:{0,0,0}, issues:[]}` silencieusement.

**Choix implicite — `prevRole` traverse les statuts none** : diverge de `first-time-right` (qui réinitialise prevRole sur none). Cohérent avec l'idée qu'un retour qa→[design]→dev reste un rework même si une étape orpheline s'intercale.

**Snapshot** : fenêtre 30 jours rolling. Stocke `reworkRatio`, `avgReworks`, et les 3 types de rework.

**Sortie** : `{ count, reworkRatio, avgReworks, byReworkType: {qaToDev, poToQa, poDev}, issues: ReworkIssue[] }` — `issues[]` trié par `reworkCount` décroissant.

---

### `first-time-right`

**Définition** : % de tickets traversant chaque rôle en un seul passage continu (sans retour). KPI lisible complément de `handoff-rework`.

**Population** : identique à `cycle-time` — `fetchDeliveredTransitions` + `groupByIssue`.

**Algorithme** :
```
Pour chaque issue, transitions ordonnées :
  prevRole = null
  Pour chaque transition :
    cur = rôle(to_status)
    Si cur ≠ null :
      Si cur ≠ prevRole : passages[cur]++ ; prevRole = cur
    Sinon : prevRole = null   -- statut hors rôle CASSE le bloc, contrairement à handoff-rework

  Pour chaque rôle R où passages[R] > 0 :
    eligible[R]++
    totalPasses[R] += passages[R]
    Si passages[R] == 1 : firstTimeRight[R]++

ftrRate[R]   = firstTimeRight[R] / eligible[R]   (0 si eligible=0, pas NaN)
avgPasses[R] = totalPasses[R]   / eligible[R]    (mean sur eligibles seuls)
```

**Choix implicite — `prevRole` réinitialisé sur statut hors rôle** : `qa → [design] → qa` compte 2 passages dans `qa` (chaque bloc contigu compte). Cohérent avec « passe sans interruption » mais **diverge de `handoff-rework`** qui conserve `prevRole`. Conséquence pratique : un workflow contenant des statuts non taggés (design, review tech, ready-for-deploy) fait gonfler artificiellement `avgPasses`.

**Choix implicite — aucun warning si rôles non configurés** : retour `count=N, ftrByRole tous à 0` silencieusement (eligible=0 partout).

**Snapshot** : fenêtre 30 jours rolling. Stocke par rôle : `eligible`, `firstTimeRight`, `ftrRate`, `avgPasses` (bucket `"dev"` / `"qa"` / `"po"`).

**Sortie** : `{ count, ftrByRole: {dev, qa, po}: {eligible, firstTimeRight, ftrRate, avgPasses} }`.

---

### `scope-change-rate`

**Définition** : % d'issues dont **la description ou le résumé** ont changé significativement après entrée en sprint. Mesure la dérive de périmètre **textuelle uniquement** — Story Points et changements de sprint NE sont PAS surveillés (malgré le nom).

**Population — deux ensembles distincts** :
- **Numérateur (issues scannées pour dérive)** : issues ayant au moins un changement `Sprint` dans `issue_field_changes`. Limitation connue : une issue créée directement dans un sprint (sans changelog Sprint) est exclue du scan.
- **Dénominateur (`totalIssues`)** : agrégé via la jonction `issue_sprints` (peuplée depuis `customfield_10020`, contient l'effectif réel y compris les issues créées directement dans un sprint). Une issue présente dans N sprints **compte N fois** — intentionnel pour que `changeRatio` soit cohérent par sprint.

**Attribution au sprint** : premier sprint dont le `start_date` est le plus ancien parmi tous les `to_value` Sprint de l'issue (correspondance par inclusion de nom : `to_value.includes(sprintName)`). Si l'issue est attribuée à un sprint absent de `issue_sprints` (ex. sprint sans `start_date`), l'issue est ignorée.

**Algorithme** :
```
Pour chaque issue ayant un changelog Sprint :
  firstSprintName = sprint mentionné dont start_date est le plus ancien
  firstDevStart   = MIN(transitioned_at) où to_status ∈ devStartStatuses
  Si firstDevStart absent : ignorer issue

  graceCutoff = firstDevStart + (scopeChangeGracePeriodHours · 3 600 000 ms)

  Pour chaque champ ∈ {description, summary} :
    fieldState[champ] = { first: 1er from_value après graceCutoff,
                          last:  dernier to_value après graceCutoff }
    -- changements avec from_value=null sont ignorés (pas de baseline)

  descriptionChanged = ∃ champ tel que similarityRatio(first, last) < 0.85

  Si descriptionChanged : changedIssues++ ; bySprint[firstSprintName].byChangeType.description++
```

**Choix implicite — grace cutoff = `firstDevStart`, PAS `firstSprintStart`** : un ticket peut rester en TODO dans un sprint pendant que la PO l'affine ; ces ajustements pré-dev ne sont pas une dérive de périmètre. La fenêtre de mesure démarre à l'entrée en cycle dev. Conséquence : si `devStartStatuses` est vide ou non atteint, l'issue est ignorée silencieusement.

**Choix implicite — comparaison `first ↔ last` (cumul), pas chaque changement** : 5 micro-edits totalisant -20% similarity sont détectés comme une dérive ; un ticket réécrit puis restauré à l'identique ne l'est pas. Évite le faux positif "j'ai corrigé une typo".

**Similarité textuelle** ([distance de Levenshtein](https://en.wikipedia.org/wiki/Levenshtein_distance) normalisée) :
```
similarityRatio(a, b) = max(0, 1 − levenshtein(normalize(a), normalize(b)) / |a|)
                                                                          ^^^
   dénominateur = longueur du texte ORIGINAL (pas max(|a|, |b|))
   → ajout de N% de texte → similarity ≈ 1 − N% (détecté si N > ~15%)
   → suppression de N% → similarity ≈ 1 − N% (idem, symétrique en pratique)
   → si |a|=0 : ratio = 1 si |b|=0, sinon 0
normalize : strip {macros}, !images!, [text|url] → text, lowercase, strip Markdown, collapse whitespace
```

**Snapshot** : **skip** — sortie `bySprint` non mappable au format `(snapshot_date, bucket, stat)`.

**Sortie** : `{ totalIssues, changedIssues, changeRatio, bySprint: Record<sprintName, SprintScopeStats>, changedIssueKeys }`.

`SprintScopeStats` : `{ totalIssues, changedIssues, changeRatio, byChangeType: { description: number }, issueDetails: [{ key, description: boolean }] }`. **Une seule clé `description` dans `byChangeType`** — pas de `storyPoints`, pas de `sprintChange`.

---

### `bottleneck-analysis`

**Définition** : score composite 0–1 par rôle (dev / qa / po) synthétisant 4 signaux indépendants. Identifie le stage prioritaire à améliorer selon la Theory of Constraints.

**Population** :
- Signaux 1, 3, 4 (stageTime, reworkInbound, ftrPenalty) : population cycle-time livrée (`fetchDeliveredTransitions` + `groupByIssue`), même fenêtre que les autres métriques rôle-aware. Si `count = 0` → `emptyResult()`.
- Signal 2 (avgNetFlow) : **toutes les transitions** dans la fenêtre (WIP inclus) — mesure l'accumulation en cours, pas seulement le livré.
- Si aucun rôle configuré (`devStatuses ∪ qaStatuses ∪ poStatuses = ∅`) : `console.warn` + `emptyResult()`.

**Signaux** :

| Signal | Formule | Interprétation |
|--------|---------|----------------|
| `stageTimeMedianDays` | médiane des jours passés dans le rôle (via `computeRoleDays`, sans filtre outliers : `statsFromDays(arr, false)`) | temps de passage unitaire |
| `avgNetFlow` | moyenne hebdomadaire de (entrées − sorties) dans le rôle | accumulation : net > 0 = embouteillage |
| `reworkInboundRate` | (issues avec ≥ 1 retour arrière **vers** ce rôle) / `count` | pression qualité entrante |
| `ftrPenalty` | 1 − ftrRate = % issues passant le rôle en ≥ 2 passages | rejet interne du rôle |

**Choix implicite — `avgNetFlow` semaine ISO + biais semaines vides** : grouping par `isoWeek(transitioned_at)`, transitions seulement (pas de timeline régulière). Conséquence : si un rôle reste inactif 4 semaines puis reçoit +5 entrées en 1 semaine, `avgNetFlow = +5 / 1 = +5` (et non +5/5 = +1). Identique au biais documenté pour `stage-throughput-gap`.

**Choix implicite — `avgNetFlow` seed `prevRole = null`** : le tout premier passage d'une issue dans un rôle compte comme `In` sans `prevOut` correspondant. Création directe « en cours » → toujours +1 entrée pour le rôle initial sans contrepartie.

**Choix implicite — `ftrPenalty` réinit sur statut hors rôle** : suit la convention de `first-time-right` (`prevRoleFtr = null` quand `cur === null`), **diverge** de la convention rework de `handoff-rework`. Conséquence : workflow contenant des statuts non taggés (design, deploy) gonfle `ftrPenalty` si le rôle est traversé en plusieurs blocs contigus.

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

**Signal dominant** : signal avec le rang le plus élevé. Si l'écart entre le 1er et le 2e rang strictement compris dans `]0, 0.1[` → `combined`. En cas d'égalité exacte (diff = 0), priorité TOC : `accumulation > stage_time > rework > ftr`.

**po hardcodé à reworkInboundRate = 0** : po est le stage final de la chaîne — aucun flux aval ne lui retourne des tickets.

**Recommandation** : table `RECOMMENDATIONS[dominantSignal](primaryBottleneck)` :
- `accumulation` → "Réduire les entrées en {role} ou augmenter la capacité disponible à ce stage."
- `stage_time` → "Décomposer les tâches avant {role} pour réduire le temps de passage unitaire."
- `rework` → "Améliorer les critères d'entrée en {role} (Definition of Ready) pour éviter les retours."
- `ftr` → "Renforcer les critères de sortie de {role} (Definition of Done) pour éviter les rejets."
- `combined` → "Plusieurs signaux convergent sur {role} — analyser la charge et la qualité simultanément."

**Ranking entre rôles** : tri par `score` décroissant, tiebreak alphabétique stable (`dev < po < qa`). `rank = 1` = bottleneck primaire.

**Colonnes par rôle (`byColumn`)** :
- Pour chaque issue livrée, on accumule le `workingDaysBetween(start, end)` passé dans chaque statut tagué (`dev` ∪ `qa` ∪ `po`). Une fenêtre `end ≤ start` (timestamps égaux) est ignorée silencieusement.
- Pour chaque statut accumulé : `{ status, role, medianDays: statsFromDays(arr, false).medianDays, count }`.
- Tri **par rôle** (`dev → qa → po`), puis `medianDays` décroissant, tiebreak alphabétique sur `status`.
- `dominantColumn` (par rôle) = première entrée du rôle dans `byColumn` triée → statut avec la médiane la plus haute, tiebreak alphabétique.
- `primaryColumn` = `dominantColumns[primaryBottleneck]`.

**Snapshot** : stocke par rôle `score` et `rank` (bucket `"dev"` / `"qa"` / `"po"`), plus `count` (bucket `""`). `byColumn`, `primaryColumn`, `dominantColumn`, `recommendation` ne sont pas snapshottés (live uniquement).

**Sortie** : `{ count, primaryBottleneck: RoleKey | null, primaryColumn: string | null, recommendation: string, byRole: Record<RoleKey, { score, rank, dominantSignal, dominantColumn: string | null, signals }>, byColumn: ColumnStat[] }`.

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
        AND issue_type NOT IN excludeIssueTypes     -- si configuré
```

Retourne `{currentWip:0, sprintName:null, issueKeys:[]}` si aucun sprint actif.

**Choix implicite — `LIMIT 1` sur sprint actif** : si plusieurs sprints sont marqués `state='active'` simultanément (rare mais possible Jira-side), on garde celui dont `start_date` est la plus récente. Les WIP des autres sprints actifs sont invisibles.

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

**Définition** : nombre d'issues dont `current_status` appartient aux statuts du rôle (dev/qa/po), à l'instant T. Sans scoping sprint, sans `cutoffDate`, sans fenêtre temporelle — pure photo point-in-time.

**Algorithme** :
```
Pour chaque rôle R ∈ {dev, qa, po} configuré :
  wipRole[R] = SELECT key FROM issues WHERE current_status IN roleStatuses[R]
```

**Cas aucun rôle configuré** : émet `console.warn("wip-per-role : aucune colonne avec role:dev|qa|po dans board.yaml")` puis retourne `{ byRole: {dev: {count:0,issueKeys:[]}, ...} }`.

**Divergence vs `wip`** : `roleStatuses[R]` n'est **pas** filtré contre les statuts done-category au runtime (contrairement à `inProgressStatuses`). Si une colonne `type: done` est annotée `role: po` dans `board.yaml`, ses issues compteront dans `wip-per-role.po` mais pas dans `wip.currentWip`. Risque silencieux à arbitrer board-side.

**Snapshot** : `computeHistoricWipPerRole` reconstruit le statut à la date D via `last_status_before_D` (même logique que WIP historique, garde-fou `resolved_at` inclus). Stocke `count` par bucket rôle (`"dev"` / `"qa"` / `"po"`).

**Sortie** : `{ byRole: {dev: WipRoleSlice, qa: WipRoleSlice, po: WipRoleSlice} }` où `WipRoleSlice = {count, issueKeys[]}`.

---

## Métriques de flux

### `flow-efficiency`

**Définition** : ratio temps actif / (temps actif + temps queue) sur la phase cycle-time. Mesure la santé du workflow indépendamment de la charge. Typique 5–15 % en flux non optimisé ([Modig & Åhlström, 2012 — *This is Lean*](https://thisislean.com) ; [Reinertsen, 2009 — *The Principles of Product Development Flow*, §6](https://books.google.com/books?id=1HlPPgAACAAJ)).

**Périmètre** : même population que `cycle-time` (issues passées par `devStartStatuses` et livrées sur la fenêtre). Court-circuit à `{count:0, …}` si `activeStatuses` vide. Si `queueStatuses` vide, l'agrégat vaut 1.0 par construction.

**Algorithme** :
```
Pour chaque issue :
  trans = transitions WHERE transitioned_at ∈ [first_dev_start, done_at]
  Pour chaque intervalle [trans[i].at, trans[i+1].at OU done_at] :
    Si end ≤ start (timestamp) : skip   ← garde-fou anti-régression
    status = trans[i].to_status
    days   = workingDaysBetween(start, end)
    Si status ∈ activeStatuses : actif += days
    Sinon si status ∈ queueStatuses : queue += days
    Sinon : ignoré (TODO retour, hors flux mesuré)

  Si actif + queue ≤ 0 : issue ignorée (pas dans count)
  flow_efficiency_issue = actif / (actif + queue)

Filtre outliers Tukey sur totalDays (actif + queue) si excludeOutliers ET out.length ≥ 4.

Agrégat (pondéré durée) = SUM(actif) / SUM(actif + queue)
Médiane (par issue)     = percentile(flow_efficiency_issue, 50)
P15 (pire 15 %)         = percentile(flow_efficiency_issue, 15)
```

**Choix implicite — outliers sur totalDays, pas sur flowEfficiency** : on retire les issues exceptionnellement longues (queue + actif), pas les ratios extrêmes. Conséquence : un ticket bref dont 90 % est queue (ratio 10 %) reste compté ; un ticket de 6 mois (même ratio) est exclu si `totalDays` dépasse la fence Tukey.

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

**Périmètre** : issues actuellement en in-progress (filtre runtime contre done-category), peu importe le sprint. Pas de scoping sprint (les sprints historiques ne sont pas tracés). `excludeIssueTypes` appliqué aux deux requêtes (items courants ET historiques pour percentiles).

**Algorithme** :
```
asOf_iso = windowEndDate ? windowEndDate + "T23:59:59Z" : now().toISOString()
asOf     = asOf_iso[0..10]

Pour chaque issue dont :
  last_status_before_asOf_iso ∈ inProgressStatuses    -- garde-fou résolution Jira (vs done-category déjà strippé)
  ET (delivered.done_at IS NULL OR delivered.done_at > asOf_iso)
  ET 1er passage en devStartStatuses ≤ asOf_iso :
    age = workingDaysBetween(first_dev_at, asOf_iso)

Percentiles historiques = cycle-time des issues avec done_at ≤ asOf_iso
                          ET done_at >= cutoffDate (cutoff global, pas glissant)
                          ET issue_type NOT IN excludeIssueTypes
                          (filtre outliers Tukey si excludeOutliers)

Classification (strict >, pas ≥) :
  age > P95  → critical
  age > P85  → at-risk
  age > P50  → watch
  sinon      → ok

Cas dégradé : si sortedHist vide → tous les items classés "ok".
```

**Choix implicite — `T23:59:59Z` sur `windowEndDate`** : pour inclure les transitions du jour D dans le calcul de `last_status_before_asOf`. Sans cette borne, une transition `to_status='Done'` à `D 14:00` serait ignorée et l'item compté comme aging.

**Choix implicite — fenêtre historique cumulative** : pas de `cutoffDate` glissant sur les percentiles, on prend tout depuis `config.cutoffDate`. Vise une base statistique large (P95 sur 50 issues > P95 sur 5).

**Sortie** :
```
{
  asOf, count,
  percentiles: { p50, p85, p95 },
  riskCounts: { ok, watch, atRisk, critical },
  issues: [{ issueKey, summary, status, startedAt, ageDays, riskLevel }, ...] -- trié âge décroissant
}
```

---

### `forecast` — Monte Carlo

**Définition** : forecast probabiliste de livraison sur horizons 1/2/4/8 semaines. Simule 10 000 scénarios par horizon en tirant avec remise dans les 12 dernières semaines de throughput ([Vacanti, 2015 — *Actionable Agile Metrics for Predictability*](https://www.actionableagile.com)).

**Périmètre** : 12 semaines de throughput précédant `windowEndDate` (ou maintenant). **Pas de filtre `cutoffDate`** : `LIMIT 12` borne déjà l'historique, pour éviter qu'un snapshot historique avec cutoff étroit (30j glissants) ne réduise le pool à 4 semaines. `excludeIssueTypes` appliqué.

**Choix implicite — semaines SQLite (`%W`)** : agrégation par `strftime('%Y-W%W', done_at)` (semaine SQLite, dimanche-samedi en pratique sur Windows/POSIX). Diverge de l'agrégat ISO 8601 utilisé par `dev-time-allocation` (`isoWeek()` JS, lundi-dimanche). Sans impact sur le forecast lui-même (échantillonnage avec remise), mais les `recentWeeks[]` exposés ne s'alignent pas pile sur le découpage de `dev-time-allocation`.

**Algorithme** :
```
samples = 12 dernières semaines de throughput, en ordre chronologique
Si samples vide : return { recentWeeks:[], weeksUsed:0, byHorizon:[], simulations:0 }

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

**Choix implicite — semaines manquantes comptées comme « non échantillonnables »** : si l'équipe n'a livré sur 8 des 12 dernières semaines, `samples.length = 8` (les 4 zéros ne sont pas insérés). Le tirage est uniforme sur les 8 semaines actives, pas sur 12. Conséquence : forecast optimiste pour une équipe avec gros trous (vacances, crunch). Plancher acceptable si ≥ 4 semaines.

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

`backfillSnapshots` (`src/snapshots/compute.ts`) calcule toutes les métriques pour chaque **dimanche** depuis `cutoffDate` jusqu'à aujourd'hui (`now()`), inséré dans `metric_snapshots` après `DELETE FROM metric_snapshots` (replace-all par snapshot run, dans une seule transaction).

**Génération des dates** (`generateWeekEndings`) : démarre à `cutoffDate`, avance jusqu'au prochain dimanche (`(7 − dayOfWeek) % 7`), puis +7j tant que `start ≤ now()`. Conséquence : la première date snapshottée peut être postérieure à `cutoffDate` jusqu'à 6 jours.

Pour chaque date D et chaque métrique :

| Type de métrique | Fenêtre appliquée |
|---|---|
| Durée (lead, cycle, normalized, bug-cycle, flow-efficiency) | `cutoffDate = D − 30j`, `windowEndDate = D` |
| **By-size (lead-time-by-size, cycle-time-by-size) + aging-wip** | `cutoffDate = config.cutoffDate` (global), `windowEndDate = D` — cumulative depuis l'origine |
| Débit (throughput, bug-throughput, throughput-weighted, bug-backlog, dev-time-allocation) | `cutoffDate = D − 7j`, `windowEndDate = D` |
| WIP (`wip`, `wip-per-role`) | Routes dédiées hors `extractStats` (`computeHistoricWip` / `computeHistoricWipPerRole`) — pas de fenêtre glissante, point-in-time à D |
| Rework / qualité (`handoff-rework`, `first-time-right`) | `cutoffDate = D − 30j`, `windowEndDate = D` |
| Flux rôles (`stage-throughput-gap`, `bottleneck-analysis`, `stage-time-breakdown`) | `cutoffDate = D − 30j`, `windowEndDate = D` |
| `forecast` | **Skip** — Monte Carlo non déterministe, computé live en report |
| `scope-change-rate` | **Skip** — shape `bySprint` non mappable au format `(snapshot_date, bucket, stat)` |

**Pré-condition `WEEKLY_METRICS`** : `Set("throughput", "throughput-weighted", "bug-throughput", "dev-time-allocation", "bug-backlog")`. **`CUMULATIVE_METRICS`** : `Set("lead-time-by-size", "cycle-time-by-size", "aging-wip")`. Tout métrique hors de ces deux sets utilise la fenêtre 30j par défaut.

### `extractStats` — résolution des shapes

Discrimination par **présence de propriété**, ordre `if / else if` strict (premier match gagne) :

| Ordre | Discriminator | Stats stockées |
|---|---|---|
| 1 | `buckets` (Record<SizeBucket, DurationStats>) | `count`, `median`, `p85`, `p95` par bucket non-vide (`excludedOutliers` **non** persisté) |
| 2 | `avgDays` (DurationStats) — lead-time, cycle-time, lead-time-normalized, cycle-time-normalized, bug-cycle-time | `count`, `median`, `p85` |
| 3 | `riskCounts` (aging-wip) | `count`, `ok`, `watch`, `atRisk`, `critical`, `p50`, `p85`, `p95` |
| 4 | `aggregateFlowEfficiency` (flow-efficiency) | `count`, `aggregate`, `median`, `activeDays`, `queueDays` |
| 5 | `openCount` (bug-backlog) | `openCount`, `netFlow`, `created`, `closed` |
| 6 | `avgBugRatio` (dev-time-allocation) | `featureDays`, `bugDays`, `bugRatio` agrégés sur la fenêtre |
| 7 | `reworkRatio` (handoff-rework) | `count`, `reworkRatio`, `avgReworks`, `count` par bucket `qaToDev`/`poToQa`/`poDev` |
| 8 | `avgShareByRole` (stage-time-breakdown) | `count` (bucket `""`), puis `median`, `p85`, `avgShare` par bucket rôle non-vide |
| 9 | `primaryBottleneck` (bottleneck-analysis) — **doit précéder `byRole`** car `BottleneckAnalysisResult` contient les deux | `count` (bucket `""`), puis `score`, `rank` par bucket rôle |
| 10 | `byRole` (wip-per-role-like) — branche défensive, jamais atteinte en prod (route dédiée `computeHistoricWipPerRole`) | `count` par bucket rôle |
| 11 | `ftrByRole` (first-time-right) | `count` (bucket `""`), puis `eligible`, `ftrRate`, `avgPasses` par bucket rôle où `eligible > 0` |
| 12 | `avgNetByRole` (stage-throughput-gap) — **doit précéder `byWeek`** car `StageThroughputGapResult` contient les deux | `in`, `out`, `avgNet` par bucket rôle (toujours 3 buckets, pas de skip vide) |
| 13 | `byWeek` (throughput, bug-throughput, throughput-weighted) | `count` total ; `estimatedDays` total si la métrique pondère |

Tout résultat ne matchant aucune branche est silencieusement ignoré. Pour ajouter une métrique snapshottable avec une nouvelle forme, ajouter une branche dans `extractStats` et choisir un discriminator unique parmi les propriétés du résultat.

**Choix implicite — discrimination par propriété fragile** : si un futur résultat ajoute une propriété qui collide avec un discriminator existant en amont (ex. ajout de `avgDays` sur un type non-DurationStats), la branche capturée silencieusement changera. Aucun garde-fou type-level.

**Choix implicite — `bottleneck-analysis` perd `dominantSignal`, `dominantColumn`, `recommendation`, `byColumn`, `primaryColumn`** : seuls `count`, `score`, `rank` sont snapshottés. Impossible de tracer historiquement quel signal dominait. Live uniquement.

**Choix implicite — `stage-throughput-gap` stocke 3 buckets même quand un rôle est inactif** : contraste avec `ftrByRole` (skip si `eligible=0`) et `stage-time-breakdown` (skip si `count=0`). Diff transparente côté lecture mais non normalisée.

### WIP historique (`computeHistoricWip` / `computeHistoricWipPerRole`)

Pour chaque date D :
1. CTE `last_status` : pour chaque issue, `to_status` correspondant à `MAX(transitioned_at)` où `transitioned_at <= D`.
2. JOIN `issues i ON i.key = l.issue_key`.
3. Filtre : `l.to_status IN (inProgressStatuses)` (ou statuts du rôle pour `wip-per-role`) **ET** (`i.resolved_at IS NULL OR substr(i.resolved_at, 1, 10) > D`).

**Choix implicite — utilise `i.resolved_at` (Jira `resolutiondate`), PAS `done_at` team-done** : viole l'invariant "team-done vs resolutiondate" appliqué aux métriques de durée/débit. Conséquence : une issue en statut `inProgressStatuses` à D mais déjà team-done avant D (ex. transition manuelle vers "In Progress" après une ré-ouverture sans `resolutiondate` synchronisée) est comptée comme WIP. En pratique le risque est faible — `last_status` filtre déjà sur le dernier statut connu — mais l'asymétrie avec les autres métriques est notable.

**Choix implicite — `wip-per-role` historique sans warning si rôles vides** : `if (statuses.length === 0) {continue;}` → bucket non émis silencieusement, contrairement à la métrique live `wip-per-role` qui `console.warn`.

### Lecture par le rapport

Le rapport HTML lit `metric_snapshots` pour les tendances ; il appelle `agingWipMetric.compute(...)`, `forecastMetric.compute(...)`, `cycleTimeMetric.compute(...)`, `bottleneckAnalysisMetric.compute(...)` et `scopeChangeMetric.compute(...)` en direct pour la vue "état actuel" + scatter aging + histogramme + table forecast + bottleneck `byColumn` + détail scope-change par sprint.
