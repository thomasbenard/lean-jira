# Ticket 037 — Bottleneck Analysis

## User story

En tant que lead technique ou Scrum Master, je veux savoir quel stage (dev/qa/po) freine le
plus le flow actuellement, afin de concentrer les efforts d'amélioration sur le bon levier
plutôt que d'optimiser aveuglément.

## Solution retenue

Nouvelle métrique `bottleneck-analysis` qui agrège quatre signaux existants (temps médian par
rôle, accumulation nette, taux de rework entrant, first-time-right) en un score composite
0–1 par rôle. Le score est calculé par ranking relatif entre rôles (pas de seuils absolus),
ce qui le rend robuste quelle que soit l'échelle de l'équipe. Output : ranking des 3 rôles,
signal dominant identifié, recommandation actionnable en français. Snapshottable via un
nouveau discriminateur dans `extractStats`. Aligné Theory of Constraints (constraint = stage
avec accumulation + temps élevé) et Kanban (Little's Law : throughput relatif entre stages).
Intégré dans le rapport HTML : panneau de diagnostic courant (primaryBottleneck +
recommandation, calculé live) + graphe d'évolution des scores par rôle (depuis snapshots).

## Estimation

**Bucket** : L

**Justification** : 4 fichiers touchés (`src/metrics/bottleneckAnalysis.ts` nouveau,
`src/metrics/index.ts`, `src/snapshots/compute.ts`, `src/report/generate.ts`). Algorithme
de scoring non-trivial + section HTML rapport avec panneau de diagnostic et graphe d'évolution.
Sans migration DB. ~9 scénarios de test attendus.

## Statut

**à faire**
