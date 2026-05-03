# Spec fonctionnelle — dev-time-allocation : WIP et ratio pondéré

## Contexte

`dev-time-allocation` mesure la part du temps d'ingénierie consacrée aux bugs vs aux features, en distribuant le cycle-time des issues livrées sur leurs semaines de développement. Deux problèmes :

- **WIP invisible** : les issues encore en cours (non livrées) sont absentes du calcul. Si l'équipe est en mode pompier avec 5 bugs actifs non livrés, la métrique l'ignore. Le lag peut atteindre plusieurs semaines selon le cycle-time moyen.
- **avgBugRatio biaisé** : la moyenne des ratios hebdomadaires traite une semaine avec 0.5 bug-day (ratio 1.0) identiquement à une semaine avec 20 bug-days. Résultat observé : 96.9% au lieu d'une valeur représentative.

## Comportement attendu

### Inclusion du WIP

Une issue est considérée **WIP à la date D** si :
- Elle a une transition vers un statut `devStartStatuses` avant D
- Elle a une transition vers un statut `todoStatuses` avant D
- Elle n'a PAS de transition vers un statut `doneStatuses` avant ou à D

Pour ces issues, `distributeAcrossWeeks(started_at, D, workingDaysBetween(started_at, D))` est appelé avec D = `windowEndDate` (si défini, pour cohérence historique des snapshots) ou la date du jour.

Les jours WIP contribuent aux mêmes `byWeek` que les issues livrées : pas de séparation visuelle dans la structure de sortie.

### Correction de avgBugRatio

```
avgBugRatio = totalBugDays / (totalBugDays + totalFeatureDays)
```

où `totalBugDays` et `totalFeatureDays` sont les sommes sur toutes les entrées de `byWeek`. Suppression de l'appel à `avg(byWeek.map(w => w.bugRatio))`.

### Cohérence avec snapshots

`snapshots/compute.ts` lit `r.avgBugRatio` pour stocker le stat `bugRatio`. Après correction du calcul dans la métrique, la valeur stockée sera automatiquement correcte. Aucun changement de structure de snapshot.

## Cas limites

- Issue WIP démarrée avant `cutoffDate` → incluse quand même (elle consomme du temps équipe aujourd'hui, même si sa date de début est ancienne).
- Issue WIP avec `started_at > D` → exclue (`distributeAcrossWeeks` retourne vide si `totalDays <= 0`).
- `done_at < started_at` sur issue livrée → déjà géré (`if (r.done_at < r.started_at) continue`).
- Semaine sans aucune issue (ni livrée ni WIP) → absente de `byWeek`, non prise en compte dans `avgBugRatio`.
- `totalDays = 0` (aucune issue) → `avgBugRatio = 0`.
- Snapshot historique (date passée) : le WIP à la date D = issues non livrées au moment D, même si depuis livrées. `windowEndDate` joue le rôle de D.

## Ce qui ne change pas

- Structure de retour `DevTimeAllocationSummary` (`byWeek`, `avgBugRatio`) : inchangée.
- Logique de `distributeAcrossWeeks` et `isoWeek` : inchangées.
- `excludeIssueTypes` reste appliqué au WIP comme aux issues livrées.
- Schéma `metric_snapshots` : aucune colonne ajoutée.
- `snapshots/compute.ts` : seul `r.avgBugRatio` devient correct automatiquement ; aucun changement de code requis dans ce fichier.
