# Ticket 046 — KPIs : seuils dynamiques configurables

## User story

En tant que lead technique ou PO, je veux pouvoir choisir entre des seuils de santé KPI statiques (configurés manuellement dans `board.yaml`) ou dynamiques (calculés automatiquement depuis l'historique de snapshots), afin d'obtenir des signaux de santé contextualisés à la vélocité réelle de mon équipe sans avoir à calibrer des valeurs à la main.

## Solution retenue

Étendre `metrics.healthThresholds` dans `board.yaml` avec un champ `mode: "static" | "dynamic"` (défaut `"static"` pour compatibilité descendante).

- **Mode `static`** : comportement actuel — les `ThresholdPair` définis manuellement sont utilisés tels quels.
- **Mode `dynamic`** : les seuils sont calculés automatiquement depuis les dernières N semaines de `metric_snapshots` (défaut 12 semaines, configurable via `windowWeeks`). Pour chaque KPI :
  - métriques "lower is better" (lead, cycle, bug-cycle, wip, bugRatio) : `warn = P50`, `crit = P85`
  - métriques "higher is better" (throughput) : `warn = P50`, `crit = P15`
  - Si moins de 4 semaines de données disponibles dans la fenêtre → signal `"none"` (pas de coloration)

Le calcul est fait dans `generate.ts` au moment du rendu, sans modifier la DB ni les snapshots.

## Estimation

**Bucket** : M

**Justification** : 2 fichiers touchés (`generate.ts`, `main.ts`). Nouvel algorithme percentile sur fenêtre glissante. Compatibilité descendante garantie par valeur de `mode` par défaut. ~5-6 scénarios de test attendus (mode statique inchangé, mode dynamique happy path, fenêtre insuffisante, seuils mixtes).

## Statut

**à faire**
