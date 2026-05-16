# Formules des métriques — index

Définitions mathématiques, périmètres et choix d'implémentation pour chaque métrique exposée par `npm run metrics` / `npm run report`. Catalogue d'ensemble : voir [CLAUDE.md](../../../CLAUDE.md) (section *Metric catalog*).

Découpé par thème :

| Fichier | Contenu |
|---|---|
| [primitives.md](metrics-formulas/primitives.md) | Briques communes : jours ouvrés (`workingDaysBetween`), conversion estimation, filtre outliers Tukey, `DurationStats`, date de livraison (`done_at` team-done). |
| [duration.md](metrics-formulas/duration.md) | `lead-time`, `lead-time-by-size`, `lead-time-normalized`, `cycle-time`, `cycle-time-by-size`, `cycle-time-normalized`, `bug-cycle-time`. |
| [throughput.md](metrics-formulas/throughput.md) | `throughput`, `throughput-weighted`, `bug-throughput`, `dev-time-allocation`, `bug-backlog`. |
| [roles.md](metrics-formulas/roles.md) | Métriques role-aware : `stage-time-breakdown`, `stage-throughput-gap`, `handoff-rework`, `first-time-right`, `rework-cost`, `scope-change-rate`, `bottleneck-analysis`. |
| [wip.md](metrics-formulas/wip.md) | `wip` (snapshot courant), WIP historique, `wip-per-role` ; rappel loi de Little. |
| [flow.md](metrics-formulas/flow.md) | `flow-efficiency`, `aging-wip`, `forecast` (Monte Carlo), `duration-distribution`. |
| [snapshots.md](metrics-formulas/snapshots.md) | Fenêtres de calcul `backfillSnapshots`, table `extractStats` (shape discrimination), WIP historique, lecture par le rapport. |
