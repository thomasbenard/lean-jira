# Métriques role-aware (rôles, rework, périmètre, bottleneck)

[← Index](../metrics-formulas.md)

## `stage-time-breakdown`

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

## `stage-throughput-gap`

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

## `handoff-rework`

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

## `first-time-right`

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

## `rework-cost`

**Définition** : coût en jours-ouvrés des passes rework — passages de rang ≥ 2 dans un même rôle pour un même ticket. Complète `handoff-rework` (fréquence) et `first-time-right` (taux) en quantifiant le coût économique.

**Population** : identique à `cycle-time` (`fetchDeliveredTransitions` + `groupByIssue`).

**Détection des passes** :
```
Une passe = bloc contigu de transitions vers des statuts du même rôle.
Statut hors rôle (ni dev, ni qa, ni po) → réinitialise currentRole = null.
Passe rework = passe 2+ dans un même rôle.

Diverge de handoff-rework (qui préserve prevRole à travers les statuts hors rôle).
Converge avec first-time-right (même reset sur statut hors rôle).
```

**Durée d'une passe** : `workingDaysBetween(passStart, passEnd)` en jours-ouvrés. `todoStatuses` automatiquement exclus (temps entre blocs, jamais dans un bloc). Passes de 0 j-ouvrés ignorées.

**Distribution hebdomadaire** : `distributeAcrossWeeks(passStart, passEnd, days)` — même logique que `dev-time-allocation`. Chaque semaine ISO reçoit `min(5, remaining)` jours.

**Attribution sprint** : bloc rework attribué au sprint dont `start_date ≤ passEnd ≤ end_date`. Si aucun sprint ne couvre, le bloc est compté dans les agrégats globaux mais absent de `bySprint`.

**Calculs** :
```
reworkedCount          = count(issues avec ≥ 1 passe rework)
reworkRatio            = reworkedCount / count
totalReworkDays        = somme jours-ouvrés de toutes les passes rework
avgReworkDays          = totalReworkDays / reworkedCount  (0 si reworkedCount = 0)
reworkCostRatio        = totalReworkDays / reworkedCycleTimeDays
                         reworkedCycleTimeDays = somme cycle-time des tickets reworkés uniquement
```

**Snapshot** : fenêtre 30 jours rolling. Stocke : `count`, `reworkedCount`, `reworkRatio`, `totalReworkDays`, `avgReworkDays`, `reworkCostRatio`.

**Sortie** : `{ count, reworkedCount, reworkRatio, totalReworkDays, avgReworkDaysPerReworkedTicket, reworkCostRatio, byWeek[], bySprint[] }`.

---

## `scope-change-rate`

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

## `bottleneck-analysis`

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
- Pour chaque issue livrée, on accumule le `workingDaysBetween(start, end)` passé dans chaque statut tagué (`dev` ∪ `qa` ∪ `po`), en utilisant le nom de colonne `board.yaml` via `statusToColumnName[status] ?? status`. Plusieurs statuts Jira appartenant à la même colonne board sont **poolés** : leurs durées sont agrégées avant calcul de la médiane. Une fenêtre `end ≤ start` (timestamps égaux) est ignorée silencieusement.
- Pour chaque colonne accumulée : `{ column, role, medianDays: statsFromDays(arr, false).medianDays, count }`.
- Tri **par rôle** (`dev → qa → po`), puis `medianDays` décroissant, tiebreak alphabétique sur `column`.
- `dominantColumn` (par rôle) = première entrée du rôle dans `byColumn` triée → colonne board.yaml avec la médiane la plus haute, tiebreak alphabétique.
- `primaryColumn` = `dominantColumns[primaryBottleneck]`.

**Snapshot** : stocke par rôle `score` et `rank` (bucket `"dev"` / `"qa"` / `"po"`), plus `count` (bucket `""`). `byColumn`, `primaryColumn`, `dominantColumn`, `recommendation` ne sont pas snapshottés (live uniquement).

**Sortie** : `{ count, primaryBottleneck: RoleKey | null, primaryColumn: string | null, recommendation: string, byRole: Record<RoleKey, { score, rank, dominantSignal, dominantColumn: string | null, signals }>, byColumn: ColumnStat[] }`.
