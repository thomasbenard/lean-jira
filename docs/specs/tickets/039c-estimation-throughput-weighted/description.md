# Ticket 039c — Throughput pondéré adapté à la méthode d'estimation

## User story

En tant que lead technique configurant lean-jira pour son équipe, je veux que la métrique `throughput-weighted` utilise l'unité d'estimation configurée (j-h pour temps, SP pour story points) et soit désactivée pour les méthodes `t-shirt` et `none`, afin que le débit pondéré soit cohérent avec la pratique d'estimation de l'équipe.

## Solution retenue

`throughputWeighted.ts` dérive automatiquement le champ et l'unité depuis `config.estimation.method` via `resolveWeightedConfig()` — pas de propriété `weightField` en config. `time` → somme `original_estimate_seconds` → "j-h". `story-points` → somme `story_points` → "SP". `numeric` → somme `story_points` → "pts". `t-shirt`/`none` → `disabled: true`. Le CLI et le rapport affichent l'unité adaptée. `board.example.yaml` documente la section `estimation` complète avec les 5 méthodes.

**Prérequis** : 039a (colonnes DB), 039b (`EstimationConfig` dans `MetricConfig`).

## Estimation

**Bucket** : S

**Justification** : 3 fichiers touchés (throughputWeighted.ts, main.ts affichage CLI, board.example.yaml). Adaptation SQL et d'unité localisée dans un seul fichier métrique. Pas de migration DB.

## Statut

**à faire**
