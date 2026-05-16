# Métriques

[← Index](../spec-fonctionnelle.md)

## Principe de livraison équipe (team-done)

La **livraison** d'une issue est définie comme sa **première transition vers un statut dont `statusCategory = done`** (au sens Jira), ou vers un statut listé dans `doneStatuses` (pour les anciens noms renommés).

Ce choix exclut les délais de validation post-livraison (ex: sur le board KECK, "À valider" porte `statusCategory=done` mais les tickets y attendent la validation PO). Les métriques reflètent le temps de l'équipe, pas le temps total de résolution.

## Filtre outliers

Par défaut, les valeurs extrêmes (queue droite de la distribution) sont exclues des calculs de moyenne et percentiles via la méthode Tukey (Q3 + 1,5 × IQR). Désactivable avec `--include-outliers`. La médiane et P85 ne sont que peu affectées.

## Buckets de taille

Basés sur l'estimation initiale (`originalEstimate`) de l'issue (1 jour = 8 h) :

| Bucket | Critère |
|---|---|
| XS | < 0,5 j |
| S | 0,5 – 1 j |
| M | 1 – 3 j |
| L | 3 – 5 j |
| XL | ≥ 5 j |
| BUG | Issue de type bug (quelle que soit l'estimation) |
| UNESTIMATED | Pas d'estimation ou estimation ≤ 0 |

## Catalogue des métriques

| Nom | Ce que ça mesure | Population |
|---|---|---|
| `lead-time` | Délai total : entrée backlog (todo) → livraison équipe | Issues avec transition todo ET transition devStart |
| `lead-time-by-size` | Lead time agrégé par bucket de taille | Idem |
| `lead-time-normalized` | Ratio lead time réel / estimation (détecte les dérives de chiffrage) | Idem lead-time, estimées, hors bugs |
| `cycle-time` | Délai de dev : début dev actif → livraison équipe | Issues avec transition todo ET transition devStart |
| `cycle-time-by-size` | Cycle time agrégé par bucket de taille | Idem |
| `cycle-time-normalized` | Ratio cycle time réel / estimation | Idem cycle-time, estimées, hors bugs |
| `bug-cycle-time` | Cycle time des bugs uniquement (pas d'invariant todo requis) | Issues de type bug |
| `throughput` | Nombre d'issues livrées par semaine | Toutes issues |
| `bug-throughput` | Nombre de bugs livrés par semaine | Issues de type bug |
| `throughput-weighted` | Jours-personnes estimés livrés par semaine (proxy de valeur) | Issues estimées non-bug |
| `wip` | Issues actuellement en cours dans le sprint actif | Sprint actif courant |
| `flow-efficiency` | % du temps réellement travaillé vs temps total en cycle (actif / (actif + queue)) | Issues livrées sur fenêtre cycle-time |
| `aging-wip` | Âge des items en cours comparé aux percentiles historiques de cycle time (classification de risque) | WIP courant |
| `forecast` | Fourchette Monte Carlo de livraisons possibles sur 1/2/4/8 semaines, basée sur les 12 dernières semaines de throughput | Historique récent |
| `dev-time-allocation` | Somme des cycle times livrés **+ WIP en cours** par semaine, split features vs bugs. `avgBugRatio = totalBugDays / totalDays` (pondéré par volume). Détecte la dérive vers le mode pompier sans lag de livraison. | Issues avec transition todo ET devStart (livrées ou en cours) |
| `bug-backlog` | Nombre de bugs ouverts à la fin de chaque semaine (`openCount`) et flux net hebdomadaire `closed − created` (`netFlow`). `netFlow > 0` = backlog se réduit, `< 0` = grossit. Pas de scoping sprint. | Tous les bugs (issues de type `bugIssueTypes`) |
| `stage-time-breakdown` | Temps médian passé dans chaque rôle (dev/qa/po) sur la population cycle-time. `avgShareByRole` = part moyenne de chaque rôle dans le temps role-observable. Révèle où le lead time est consommé. Requiert `role: dev\|qa\|po` sur les colonnes du board. | Population cycle-time (todo + devStart + livrée) |
| `wip-per-role` | Nombre de tickets en cours dans chaque rôle (dev/qa/po) à l'instant T. Sans scoping sprint. Permet de détecter le rôle saturé en daily standup. | WIP global (issues.current_status) |
| `stage-throughput-gap` | Entrées et sorties par rôle par semaine ISO. `devNet = devIn − devOut`. Net positif = accumulation d'inventaire dans ce rôle. Fenêtre 30j en snapshot, complète en CLI. | Toutes transitions sur la période |
| `handoff-rework` | % de tickets retournant en arrière entre rôles (`reworkRatio`), nombre moyen de reworks par ticket (`avgReworks`), et décompte par type (qaToDev, poToQa, poDev). | Population cycle-time, rolling 30j |
| `first-time-right` | % de tickets traversant chaque rôle en un seul passage continu (`ftrRate`). Complément de `handoff-rework` : KPI lisible par rôle. | Population cycle-time, rolling 30j |
| `rework-cost` | Coût en jours-ouvrés des passes rework (2e passe ou + dans un même rôle). `totalReworkDays`, `reworkCostRatio`, `avgReworkDaysPerReworkedTicket`. Vue hebdo proportionnelle et vue sprint. | Population cycle-time, rolling 30j |
| `scope-change-rate` | % d'issues dont la description, l'estimation ou l'affectation de sprint a changé après entrée en sprint. Détecte la dérive de périmètre US post-engagement. | Toutes issues avec historique Sprint dans `issue_field_changes` |
| `duration-distribution` | Distribution complète (histogramme PDF + KDE gaussien Silverman + CDF empirique) du `cycle-time` et `lead-time`, global et par bucket XS/S/M/L/XL. Révèle la forme (asymétrie, multi-modale, queue lourde) — pas seulement les percentiles. Non snapshotté. | Population cycle-time (cycle) ; idem + transition TODO (lead) ; BUG/UNESTIMATED hors `byBucket` |

**Invariant lead/cycle** : les métriques `lead-time` et `cycle-time` (et leurs variantes) filtrent sur les issues ayant **à la fois** une transition `todoStatuses` et une transition `devStartStatuses`, ce qui garantit `lead_time ≥ cycle_time` par issue et rend les percentiles comparables.

## Statistiques calculées pour chaque métrique temporelle

| Stat | Description |
|---|---|
| Moyenne | Sensible aux outliers ; à lire avec prudence |
| Médiane (P50) | Valeur typique, robuste aux outliers |
| P85 | 85 % des issues livrées en moins de ce délai |
| P95 | Plafond pratique (engagement SLA) |

## Forecast Monte Carlo

- Pool : 12 dernières semaines de throughput réel
- Simulations : 10 000 tirages aléatoires
- Horizons : 1, 2, 4, 8 semaines
- P15 = engagement à 85 % de confiance ("au moins ce nombre d'issues livrées")
- P50 = médiane (livraison la plus probable)
- P85/P95 = scénarios optimistes
