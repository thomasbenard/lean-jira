# Ticket 018 — dev-time-allocation : inclure WIP et corriger avgBugRatio

## User story

En tant que lead technique, je veux que la métrique `dev-time-allocation` reflète le temps réellement consommé par l'équipe (y compris le WIP en cours), afin de détecter une dérive vers le mode pompier sans attendre que les bugs soient livrés.

## Solution retenue

Deux corrections indépendantes dans `devTimeAllocation.ts` :

1. **Inclusion du WIP** : en plus des issues livrées, ajouter une seconde requête SQL qui récupère les issues actuellement en cours (ont une transition `devStartStatuses` + `todoStatuses`, mais pas de transition `doneStatuses` avant `today`). Pour ces issues, `done_at = today` (`windowEndDate ?? date du jour`) est utilisé comme borne fictive dans `distributeAcrossWeeks`, afin d'allouer leur cycle-time partiel aux semaines déjà écoulées.

2. **Correction de `avgBugRatio`** : remplacer la moyenne non pondérée des ratios hebdomadaires (`avg(byWeek.map(w => w.bugRatio))`) par une moyenne pondérée par volume : `totalBugDays / (totalBugDays + totalFeatureDays)`. Une semaine avec 1 bug-day et 0 feature-days ne tire plus le ratio global vers 1.0.

## Estimation

**Bucket** : M

**Justification** : 2 fichiers touchés (`devTimeAllocation.ts` + `snapshots/compute.ts`), SQL additionnel pour WIP, logique de borne fictive `today`, gestion de `windowEndDate` pour cohérence historique. 5-7 scénarios de test attendus. Pas de migration DB.

## Statut

**livré**
