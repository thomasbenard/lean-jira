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

---

## Métriques de durée

### `lead-time`

**Définition** : délai total entre l'engagement de l'équipe (entrée en TODO) et la résolution.

**Périmètre** : toutes issues résolues (`resolved_at IS NOT NULL`), après `cutoffDate`.

**Algorithme** :
```
Pour chaque issue :
  todo_at    = MIN(transitioned_at) WHERE to_status IN todoStatuses
  resolved_at = champ Jira resolutiondate (pas une transition)

  lead_time = resolved_at − todo_at  (en jours)
```

Si une issue a transité plusieurs fois dans un statut TODO (retour arrière), seul le **premier** passage est retenu (`MIN`).

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

**Périmètre** : issues résolues, estimées (`original_estimate_seconds > 0`), **hors bugs**.

**Algorithme** :
```
Pour chaque issue éligible :
  lead_days     = resolved_at − todo_at
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

**Définition** : durée du dev actif uniquement, de la première entrée en développement jusqu'à la résolution.

**Périmètre** : toutes issues résolues, après `cutoffDate`.

**Algorithme** :
```
Pour chaque issue :
  started_at  = MIN(transitioned_at) WHERE to_status IN devStartStatuses
  resolved_at = champ Jira resolutiondate

  cycle_time = resolved_at − started_at  (en jours)
```

Exclut le temps d'attente backlog et de design (contrairement au lead time).

**Sortie** : `DurationStats` + liste détaillée des issues.

---

### `cycle-time-by-size`

Même algorithme que `cycle-time`, avec segmentation par bucket de taille.

Bucketisation identique à `lead-time-by-size`.

**Sortie** : `DurationStats` par bucket.

---

### `cycle-time-normalized`

**Définition** : ratio cycle time réel / estimation. Mesure la dérive sur la phase dev seule.

**Périmètre** : issues résolues, estimées, **hors bugs**.

**Algorithme** :
```
Pour chaque issue éligible :
  cycle_days    = resolved_at − started_at
  estimate_days = original_estimate_seconds / 28 800
  ratio         = cycle_days / estimate_days
```

**Interprétation** : si `médiane > 1`, l'équipe sous-estime systématiquement la phase dev.

**Sortie** : `DurationStats` (ratios). `unit = "ratio (cycle réel / estimé)"`.

---

### `bug-cycle-time`

**Définition** : cycle time restreint aux issues de type bug. Mesure la réactivité aux incidents.

**Périmètre** : issues de type `IN bugIssueTypes`, résolues, après `cutoffDate`.

**Algorithme** : identique à `cycle-time`, avec filtre `issue_type IN bugIssueTypes`.

**Sortie** : `DurationStats`. `unit = "j"`.

---

## Métriques de débit (throughput)

### `throughput`

**Définition** : nombre d'issues livrées par semaine calendaire.

**Périmètre** : toutes issues résolues, après `cutoffDate`.

**Algorithme** :
```
GROUP BY strftime('%Y-W%W', substr(resolved_at, 1, 10))
  → count(*) par semaine

avgPerWeek = total_issues / nombre_de_semaines
```

Utilise `resolved_at` (champ Jira `resolutiondate`), **pas** les transitions vers les statuts Done — plus robuste aux bulk closes.

**Sortie** : liste `{week, count}` + `avgPerWeek`.

---

### `throughput-weighted`

**Définition** : somme des jours-personnes estimés livrés par semaine. Compense le biais du throughput brut (beaucoup de petits tickets = débit apparent élevé).

**Périmètre** : issues résolues, **hors bugs**, après `cutoffDate`.

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

**Périmètre** : issues `issue_type IN bugIssueTypes`, résolues, après `cutoffDate`.

**Algorithme** : identique à `throughput`, avec filtre sur le type.

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
        AND current_status IN inProgressStatuses
```

Retourne 0 si aucun sprint actif.

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
  last_status_before_D IN inProgressStatuses
  AND (resolved_at IS NULL OR resolved_at > D)
```

SQL :
```sql
WITH last_status AS (
  SELECT issue_key, to_status, MAX(transitioned_at) AS last_at
  FROM transitions
  WHERE substr(transitioned_at, 1, 10) <= ?   -- date D
  GROUP BY issue_key
)
SELECT COUNT(*) AS c
FROM last_status l
JOIN issues i ON i.key = l.issue_key
WHERE l.to_status IN (inProgressStatuses)
  AND (i.resolved_at IS NULL OR substr(i.resolved_at, 1, 10) > ?)  -- date D
```

---

## Snapshots — fenêtres de calcul

`backfillSnapshots` calcule toutes les métriques pour chaque dimanche depuis `cutoffDate` jusqu'à aujourd'hui.

Pour chaque date D :

| Type de métrique | Fenêtre appliquée |
|---|---|
| Durée (lead, cycle, normalized, bug-cycle) | `cutoffDate = D − 30j`, `windowEndDate = D` |
| Débit (throughput, bug-throughput) | `cutoffDate = D − 7j`, `windowEndDate = D` |
| WIP | Algorithme historique ci-dessus, pas de fenêtre glissante |

Les métriques `throughput-weighted` utilisent la même fenêtre 7j que `throughput`.

**Stats extraites et stockées** par snapshot :

| Type de résultat | Stats stockées |
|---|---|
| `DurationStats` (avgDays présent) | `count`, `median`, `p85` |
| `byWeek` sans estimation | `count` (total semaine) |
| `byWeek` avec estimation | `count`, `estimatedDays` |
| WIP | `count` |
| `buckets` | `count`, `median`, `p85` par bucket non-vide |

Le rapport HTML lit uniquement `metric_snapshots` — il ne recompute rien.
