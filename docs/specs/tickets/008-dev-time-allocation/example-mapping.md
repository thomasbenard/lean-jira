# Example Mapping — Dev time allocation (features vs bugs)

## Règle 1 — Attribution feature vs bug par issue_type

**Une issue dont le type est dans `config.bugIssueTypes` contribue à `bugDays`, sinon à `featureDays`.**

```gherkin
Scenario: US livrée contribue aux featureDays
  Given une issue de type "Story" avec cycle time 5 jours
  And "Story" n'est pas dans bugIssueTypes
  When le metric est calculé
  Then featureDays += 5 pour la semaine de livraison
  And bugDays = 0 pour cette semaine

Scenario: Bug livré contribue aux bugDays
  Given une issue de type "Bug" avec cycle time 2 jours
  And "Bug" est dans bugIssueTypes
  When le metric est calculé
  Then bugDays += 2 pour la semaine de livraison
  And featureDays = 0 pour cette semaine

Scenario: bugIssueTypes vide → tout va en featureDays
  Given config.bugIssueTypes = []
  And 3 issues livrées dont 2 de type "Bug"
  When le metric est calculé
  Then featureDays = somme des 3 cycle times
  And bugDays = 0
  And bugRatio = 0
```

## Règle 2 — Population exclue (cohérence avec cycle-time)

**Seules les issues ayant transitionné par `devStartStatuses` ET par `todoStatuses` entrent dans le calcul.**

```gherkin
Scenario: Issue sans transition devStart exclue
  Given une issue livrée sans jamais passer par "Développement en cours"
  When le metric est calculé
  Then cette issue n'apparaît pas dans featureDays ni bugDays

Scenario: Issue sans transition todo exclue
  Given une issue livrée sans jamais passer par "To Do"
  When le metric est calculé
  Then cette issue n'apparaît pas dans featureDays ni bugDays
```

## Règle 3 — Agrégation par semaine de livraison

**La semaine est déterminée par `done_at`, pas par la date de début du dev.**

```gherkin
Scenario: Feature démarrée semaine N-3, livrée semaine N → compte en semaine N
  Given une issue démarrée le 2026-03-01 (semaine N-3)
  And livrée le 2026-03-22 (semaine N), cycle time = 15 jours
  When le metric est calculé
  Then featureDays += 15 en semaine N
  And semaine N-3 n'est pas affectée

Scenario: bugRatio pour semaine mixte
  Given semaine 2026-W15 contient :
    - 2 features avec cycle times 5j et 8j (total 13j)
    - 1 bug avec cycle time 3j
  When le metric est calculé
  Then featureDays = 13, bugDays = 3, bugRatio ≈ 0.187 pour W15
```
