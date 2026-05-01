# Example Mapping — `legacyStatuses` par colonne

## Règle 1 — Legacy non-done reconnu dans `validateStatusConfig`

**Un statut absent de la DB mais déclaré dans `legacyStatuses` d'une colonne est `isLegacy=true` et non comptabilisé dans `missingCount`.**

```gherkin
Scenario: statut legacy non-done absent de la DB — isLegacy, non comptabilisé
  Given une colonne Développement avec legacyStatuses: ["Dev in progress"]
  And "Dev in progress" est absent de la table statuses
  When validateStatusConfig est appelé avec legacyNames contenant "Dev in progress"
  Then l'entrée "Dev in progress" a isLegacy=true
  And missingCount = 0

Scenario: statut absent d'une section non-done et absent de legacyNames — compté comme erreur
  Given une section todoStatuses avec statut "Backlog"
  And "Backlog" est absent de la DB et absent de legacyNames
  When validateStatusConfig est appelé
  Then l'entrée "Backlog" a isLegacy=false
  And missingCount = 1
```

---

## Règle 2 — Legacy présent en DB affiché comme trouvé

**Si un nom `legacyStatuses` existe encore dans la table `statuses`, il est affiché `✓` — `isLegacy` ne s'applique qu'aux absents.**

```gherkin
Scenario: statut dans legacyStatuses ET présent en DB — found=true, isLegacy=false
  Given une colonne avec legacyStatuses: ["En cours"]
  And "En cours" est présent dans la table statuses
  When validateStatusConfig est appelé avec legacyNames contenant "En cours"
  Then l'entrée "En cours" a found=true et isLegacy=false
```

---

## Règle 3 — `deriveStatusConfig` inclut `legacyStatuses` dans les listes dérivées

**Les `legacyStatuses` d'une colonne alimentent les mêmes listes dérivées que ses `statuses` normaux.**

```gherkin
Scenario: colonne active+devStart avec legacyStatuses — legacy dans devStart, active et inProgress
  Given une colonne type=active, devStart=true, statuses=["Dev en cours"], legacyStatuses=["Dev in progress"]
  When deriveStatusConfig est appelé
  Then devStartStatuses contient "Dev en cours" et "Dev in progress"
  And activeStatuses contient "Dev en cours" et "Dev in progress"
  And inProgressStatuses contient "Dev en cours" et "Dev in progress"

Scenario: colonne sans legacyStatuses — comportement inchangé
  Given une colonne type=active, devStart=true, statuses=["Dev en cours"], sans legacyStatuses
  When deriveStatusConfig est appelé
  Then devStartStatuses = ["Dev en cours"] seulement
```
