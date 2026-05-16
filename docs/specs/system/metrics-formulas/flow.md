# Métriques de flux

[← Index](../metrics-formulas.md)

## `flow-efficiency`

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

## `aging-wip`

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

## `forecast` — Monte Carlo

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

## `duration-distribution`

**Définition** : distribution complète (PDF histogramme + KDE gaussien lissé + CDF empirique) de `cycle-time` et `lead-time`, global et par bucket `XS / S / M / L / XL`. Révèle la forme de la distribution (asymétrie, multi-modale, queue lourde) — pas seulement les percentiles.

**Périmètre** :
- `cycle` : `ctx.cycleTimePopulation` (filtrée par `excludeIssueTypes` + `cutoffDate` + transition `devStartStatuses`).
- `lead` : sous-ensemble de `cycle` dont la 1ʳᵉ transition vers `todoStatuses` existe et précède `done_at`.
- `byBucket` : `BUG` et `UNESTIMATED` exclus du breakdown (présents dans `global` uniquement).

**Bins histogramme** (`buildUnitBins`, local à `src/metrics/durationDistribution.ts`) :
```
binWidth = 1 (jour-ouvré, fixe)
binCount = max(1, ⌈max + 0.0001⌉)
```
Granularité 1 jour-ouvré quel que soit `max` : l'axe x reste aligné sur l'unité de mesure des durées, la courbe KDE porte le lissage visuel. Une issue est rangée dans `bins[min(binCount-1, ⌊v⌋)]`. Le helper générique `buildHistogramBins` de `utils.ts` (formule `0.5 | 1 | ⌈max/20⌉`) reste utilisé par `cycleHistogram` (legacy advanced tab).

**KDE gaussien** (`buildKdeAndCdf`) :
```
σ = écart-type empirique non biaisé (Bessel n-1)
h = 1.06 · σ · n^(-1/5)        ← bandwidth Silverman
φ(u) = exp(-u²/2) / √(2π)
density(x) = (1 / (n · h)) · Σⱼ φ((x - vⱼ) / h)
```
Évalué sur **50 points** uniformément distribués sur `[0, max]`.

**CDF empirique** : pour chaque point KDE `x`, `cdf(x) = #{vⱼ ≤ x} / n` (calculé par balayage du vecteur trié).

**hasKde** :
```
hasKde = (n ≥ 4) ∧ (σ > 0) ∧ (max > 0)
```
Si `false` : `density = 0` partout (les 50 points sont conservés pour `CDF`).

**Cas limites** :
- `n = 0` → `bins = []`, `kde = []`, `hasKde = false`, `max = 0`.
- `n = 1` → 1 bin contenant la valeur, `kde.length = 50` avec `density = 0`, `hasKde = false`.
- `σ = 0` (valeurs identiques avec `n ≥ 4`) → `hasKde = false`, KDE plat à 0.
- `max = 0` (toutes valeurs nulles) → 1 bin `[0, 0]` avec `count = n`, `kde` de 50 points `{x:0, density:0, cdf:1}`, `hasKde = false`.

**Sortie** :
```
{
  cycle: { global: DistributionSeries, byBucket: Partial<Record<XS|S|M|L|XL, DistributionSeries>> },
  lead:  { global: DistributionSeries, byBucket: Partial<Record<XS|S|M|L|XL, DistributionSeries>> }
}
DistributionSeries = {
  count, max, hasKde,
  bins: [{ start, end, count }, …],
  kde:  [{ x, density, cdf }, …]   // 50 points (ou [] si count=0)
}
```

**Non snapshottable** : output non-scalable (50 points × 6 séries × 2 axes), recalculé à chaque rapport. Listée dans `SKIP_METRICS` de `src/snapshots/compute.ts`.
