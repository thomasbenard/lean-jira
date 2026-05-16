# Métriques de durée

[← Index](../metrics-formulas.md)

## `lead-time`

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

## `lead-time-by-size`

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

## `lead-time-normalized`

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

## `cycle-time`

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

## `cycle-time-by-size`

Même algorithme que `cycle-time` (population : devStart EXISTS, **pas de TODO requirement**), avec segmentation par bucket de taille. Donc `population(cycle-time-by-size) ⊇ population(lead-time-by-size)`.

**Périmètre** : identique à `cycle-time`. Bugs **inclus** dans la population mais routés vers le bucket `BUG`.

**Filtres** : `excludeIssueTypes`, `cutoffDate`, `windowEndDate` (cutoff borne `done_at`).

**Skip silencieux** : `if (workingDaysBetween(started_at, done_at) < 0)` (inatteignable).

**Outliers** : appliqués **par bucket indépendamment** (idem `lead-time-by-size`).

**Bucketisation** identique à `lead-time-by-size`.

**Sortie** : `DurationStats` par bucket (`XS | S | M | L | XL | BUG | UNESTIMATED`).

---

## `cycle-time-normalized`

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

## `bug-cycle-time`

**Définition** : cycle time restreint aux issues de type bug. Mesure la réactivité aux incidents.

**Périmètre** : issues de type `IN bugIssueTypes`, livrées (devStart EXISTS via JOIN delivered + filtre `to_status IN devStartStatuses`), après `cutoffDate`. **Pas d'exigence TODO** (idem `cycle-time`).

**Court-circuit** : si `bugIssueTypes` est vide → renvoie immédiatement des stats vides (`count: 0`).

**Filtres** : `cutoffDate`, `windowEndDate` (cutoff borne `done_at`). **`excludeIssueTypes` n'est pas appliqué** — divergence vs `cycle-time`. Sans incidence en pratique tant qu'aucun type n'apparaît dans les deux listes (un type ne peut être à la fois bug et exclu).

**Algorithme** : identique à `cycle-time` (`done_at − started_at`), avec filtre `issue_type IN bugIssueTypes`.

**Skip silencieux** : `if (workingDaysBetween(started_at, done_at) >= 0)` push (équivalent à filtrer les négatifs ; inatteignable).

**Outliers** : `excludeOutliers` standard.

**Sortie** : `DurationStats`. `unit = "j"`.
