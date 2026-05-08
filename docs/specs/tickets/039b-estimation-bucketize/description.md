# Ticket 039b — Bucketize par méthode d'estimation

## User story

En tant que lead technique configurant lean-jira pour son équipe, je veux que les métriques `lead-time-by-size` et `cycle-time-by-size` utilisent la méthode d'estimation configurée (story points, taille de t-shirt, aucune), afin d'obtenir des buckets de taille significatifs quelle que soit la pratique d'estimation de l'équipe.

## Solution retenue

`bucketize()` est étendu pour accepter `EstimationConfig` (issu de 039a) et les valeurs brutes `storyPoints`/`sizeLabel`. Cinq chemins : `time` (secondes → jours, seuils en jours), `story-points`/`numeric` (valeur brute, seuils en unité native), `t-shirt` (mapping direct label → bucket), `none` (toujours UNESTIMATED). Seuils par défaut fournis pour `time` et `story-points` ; obligatoires pour `numeric`. `getBucketLabels()` retourne des labels adaptés (ex: "XS (<1 SP)" pour story-points, "XS (<2)" pour numeric sans unité). `MetricConfig` reçoit `estimation: EstimationConfig`.

**Prérequis** : 039a livré (colonnes `story_points`, `size_label` disponibles).

## Estimation

**Bucket** : M

**Justification** : 5 fichiers touchés (utils.ts, types.ts, leadTimeBySize.ts, cycleTimeBySize.ts, main.ts). Pattern de propagation existant (`MetricConfig` → `buildMetricConfig()` dans `main.ts`). `bucketize()` est appelé seulement par les 2 métriques by-size. 6-8 scénarios de test.

## Statut

**à faire**
