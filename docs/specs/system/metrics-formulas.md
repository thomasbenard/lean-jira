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

**Bucketisation** :
```
Si issue_type IN bugIssueTypes         → BUG
Si original_estimate_seconds IS NULL
   ou original_estimate_seconds <= 0   → UNESTIMATED
Sinon :
  jours = original_estimate_seconds / 28 800
  < 0.5j  → XS
  < 1j    → S
  < 3j    → M
  < 5j    → L
  ≥ 5j    → XL
```

**Sortie** : `DurationStats` par bucket (`XS | S | M | L | XL | BUG | UNESTIMATED`).

---

### `lead-time-normalized`

**Définition** : ratio lead time réel / estimation. Mesure la dérive côté demandeur.

**Périmètre** : issues livrées, estimées (`original_estimate_seconds > 0`), **hors bugs**.

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

**Périmètre** : issues livrées, estimées, **hors bugs**.

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

## WIP (Work In Progress)

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

## Métriques de flux

### `flow-efficiency`

**Définition** : ratio temps actif / (temps actif + temps queue) sur la phase cycle-time. Mesure la santé du workflow indépendamment de la charge. Typique 5-15 % en flux non optimisé.

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

**Définition** : pour chaque ticket actuellement en cours, âge depuis le 1er passage en dev, comparé aux percentiles cycle-time historiques. Détecte les tickets en train de rater leur SLE — actionnable au stand-up.

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

**Définition** : forecast probabiliste de livraison sur horizons 1/2/4/8 semaines. Simule 10 000 scénarios par horizon en tirant avec remise dans les 12 dernières semaines de throughput.

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

**Non déterministe** : utilise `Math.random`. Skip dans `backfillSnapshots` (computé live à chaque `npm run report`).

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
| Débit (throughput, bug-throughput, throughput-weighted) | `cutoffDate = D − 7j`, `windowEndDate = D` |
| WIP | Algorithme historique ci-dessus, pas de fenêtre glissante |
| `forecast` | **Skip** — Monte Carlo non déterministe, computé live en report |

**Stats extraites et stockées** par snapshot (résolution dans `extractStats`, `src/snapshots/compute.ts`) :

| Type de résultat (clé identifiante) | Stats stockées |
|---|---|
| `buckets` (Record<SizeBucket, DurationStats>) | `count`, `median`, `p85`, `p95` par bucket non-vide |
| `aggregateFlowEfficiency` (flow-efficiency) | `count`, `aggregate`, `median`, `activeDays`, `queueDays` |
| `riskCounts` (aging-wip) | `count`, `ok`, `watch`, `atRisk`, `critical`, `p50`, `p85`, `p95` |
| `avgDays` (DurationStats) | `count`, `median`, `p85` |
| `byWeek` sans estimation | `count` (total semaine) |
| `byWeek` avec estimation | `count`, `estimatedDays` |
| WIP | `count` |

Tout résultat ne correspondant à aucune de ces formes est silencieusement ignoré. Pour ajouter une métrique snapshottable avec une nouvelle forme, ajouter une branche dans `extractStats`.

Le rapport HTML lit `metric_snapshots` pour les tendances ; il appelle `agingWipMetric.compute(...)`, `forecastMetric.compute(...)` et `cycleTimeMetric.compute(...)` en direct pour la vue "état actuel" + scatter aging + histogramme + table forecast.
