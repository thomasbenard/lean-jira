# Example Mapping — Autoconfiguration du board depuis l'API Jira

## Règle 1 — Inférence du type de colonne depuis statusCategory

**Une colonne dont tous les statuts ont `categoryKey='done'` reçoit `type: done`. Tous `new` → `todo`. Sinon → `active`.**

```gherkin
Scenario: colonne homogène "done"
  Given une colonne "Terminé" avec des statuts dont tous ont categoryKey = "done"
  When inferBoardColumns() est appelé
  Then la colonne reçoit type: "done"
  And la colonne ne reçoit pas devStart: true

Scenario: colonne homogène "new"
  Given une colonne "Backlog" avec des statuts dont tous ont categoryKey = "new"
  When inferBoardColumns() est appelé
  Then la colonne reçoit type: "todo"

Scenario: colonne mixte ou "indeterminate"
  Given une colonne "Review" avec des statuts dont certains ont categoryKey = "indeterminate"
  When inferBoardColumns() est appelé
  Then la colonne reçoit type: "active"
```

---

## Règle 2 — Placement de devStart: true

**`devStart: true` est positionné sur la première colonne `active` détectée, et sur une seule.**

```gherkin
Scenario: première colonne active reçoit devStart
  Given un board avec colonnes [todo, active, active, done]
  When inferBoardColumns() est appelé
  Then seule la première colonne active a devStart: true

Scenario: aucune colonne active
  Given un board avec colonnes [todo, done] seulement
  When inferBoardColumns() est appelé
  Then aucune colonne n'a devStart: true
  And un avertissement est affiché sur stderr
```

---

## Règle 3 — Statut ID non résolu

**Si un status ID retourné par le board ne figure pas dans `/rest/api/2/status`, il est inclus sous forme de commentaire lisible plutôt qu'ignoré silencieusement.**

```gherkin
Scenario: statut ID absent de la liste des statuts Jira
  Given une colonne avec status ID "999" absent de fetchAllStatuses()
  When inferBoardColumns() est appelé
  Then le statut apparaît dans la liste comme "# ID:999 non résolu"
  And la colonne est quand même incluse dans la sortie
```

---

## Règle 4 — Comportement sans --apply (stdout safe)

**Sans `--apply`, la commande ne modifie aucun fichier. Elle imprime uniquement sur stdout.**

```gherkin
Scenario: sortie stdout par défaut
  Given un config.yaml valide avec credentials Jira
  And les APIs Jira répondent correctement
  When la commande autoconfig est lancée sans --apply
  Then config.yaml n'est pas modifié
  And la sortie stdout contient "board:\n  columns:"
  And la sortie contient un commentaire d'en-tête

Scenario: --apply écrase board.columns uniquement
  Given un config.yaml avec une section metrics.cutoffDate existante
  When la commande autoconfig --apply est lancée
  Then board.columns est mis à jour dans config.yaml
  And metrics.cutoffDate est préservé dans config.yaml
```
