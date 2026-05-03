# Example Mapping — bug-backlog

## Règle 1 — openCount : dernier statut avant la date détermine l'état ouvert/fermé

**Un bug qui a transitionné vers done puis a été rouvert compte comme ouvert si son dernier
statut avant D n'est pas done.**

```gherkin
Scenario: bug ouvert sans aucune transition
  Given un bug créé le 2025-01-01 sans aucune transition
  When on calcule openCount à la date 2025-06-01
  Then openCount inclut ce bug

Scenario: bug fermé avec transition done avant D
  Given un bug créé le 2025-01-01
  And une transition vers "Done" le 2025-03-01
  When on calcule openCount à la date 2025-06-01
  Then openCount n'inclut pas ce bug

Scenario: bug fermé puis rouvert — dernier statut non-done
  Given un bug créé le 2025-01-01
  And une transition vers "Done" le 2025-03-01
  And une transition vers "In Progress" le 2025-04-01
  When on calcule openCount à la date 2025-06-01
  Then openCount inclut ce bug

Scenario: bug créé après D non comptabilisé
  Given un bug créé le 2025-07-01
  When on calcule openCount à la date 2025-06-01
  Then openCount n'inclut pas ce bug
```

---

## Règle 2 — netFlow : première transition done seulement

**`closed` compte chaque bug une seule fois (première transition done), même si le bug est
fermé plusieurs fois.**

```gherkin
Scenario: bug fermé une fois dans la fenêtre
  Given un bug avec une première transition done le 2025-06-03
  And la fenêtre est [2025-05-28, 2025-06-03]
  When on calcule netFlow
  Then closed = 1

Scenario: bug fermé deux fois — seule la première compte
  Given un bug avec une première transition done le 2025-06-01
  And une deuxième transition done le 2025-06-02 (après réouverture)
  And la fenêtre est [2025-05-28, 2025-06-03]
  When on calcule netFlow
  Then closed = 1

Scenario: bug fermé hors fenêtre non comptabilisé
  Given un bug avec une première transition done le 2025-05-01
  And la fenêtre est [2025-05-28, 2025-06-03]
  When on calcule netFlow
  Then closed = 0
```

---

## Règle 3 — bugIssueTypes vide → résultat nul

**Si aucun type n'est configuré comme bug, la métrique retourne des zéros sans erreur.**

```gherkin
Scenario: bugIssueTypes non configuré
  Given config.bugIssueTypes = []
  When on calcule bug-backlog
  Then openCount = 0 AND netFlow = 0 AND created = 0 AND closed = 0
```
