# Example Mapping — Autoconfiguration du board depuis l'API Jira

## Règle 1 — Inférence du type par position

**Première colonne → `todo`. Dernière colonne → `done`. Colonnes intermédiaires → `active` par défaut.**

```gherkin
Scenario: board standard à 4 colonnes
  Given un board avec 4 colonnes [Backlog, En cours, Review, Terminé]
  When inferBoardColumns() est appelé
  Then colonne 0 a type: "todo"
  And colonne 3 a type: "done"
  And colonnes 1 et 2 ont type: "active"

Scenario: board minimal à 2 colonnes
  Given un board avec 2 colonnes [À faire, Terminé]
  When inferBoardColumns() est appelé
  Then colonne 0 a type: "todo"
  And colonne 1 a type: "done"
  And aucune colonne n'a devStart: true
  And un avertissement est affiché sur stderr

Scenario: board à 1 seule colonne
  Given un board avec 1 colonne [Tout]
  When inferBoardColumns() est appelé
  Then la colonne reçoit type: "todo"
  And un avertissement "configuration probablement incomplète" est affiché
```

---

## Règle 2 — Placement de devStart: true

**`devStart: true` positionné sur la première colonne intermédiaire (index 1), et sur une seule.**

```gherkin
Scenario: devStart sur première colonne intermédiaire
  Given un board avec colonnes [todo, col-A, col-B, done]
  When inferBoardColumns() est appelé
  Then seule col-A a devStart: true
  And col-B n'a pas devStart

Scenario: aucune colonne intermédiaire
  Given un board avec 2 colonnes seulement
  When inferBoardColumns() est appelé
  Then aucune colonne n'a devStart: true
  And un avertissement est affiché sur stderr
```

---

## Règle 3 — Avertissement colonne intermédiaire suspecte

**Si une colonne intermédiaire a tous ses statuts avec `statusCategory.key='done'`, un commentaire d'avertissement est ajouté — mais le type reste `active`.**

```gherkin
Scenario: colonne intermédiaire avec statuts "done"
  Given une colonne intermédiaire "À valider" dont tous les statuts ont categoryKey = "done"
  When inferBoardColumns() est appelé
  Then la colonne a type: "active"
  And la sortie YAML contient un commentaire "statuts classés done par Jira — vérifier"
  And la colonne n'est pas silencieusement reclassée en "done"

Scenario: colonne intermédiaire avec statuts "indeterminate"
  Given une colonne intermédiaire "Review" avec statuts categoryKey = "indeterminate"
  When inferBoardColumns() est appelé
  Then la colonne a type: "active"
  And aucun avertissement n'est généré pour cette colonne
```

---

## Règle 4 — Statut ID non résolu

**Un status ID retourné par le board mais absent de `/rest/api/2/status` est inclus lisiblement, pas ignoré.**

```gherkin
Scenario: statut ID absent de la liste des statuts Jira
  Given une colonne avec status ID "999" absent de fetchAllStatuses()
  When inferBoardColumns() est appelé
  Then le statut apparaît dans la liste comme "# ID:999 non résolu"
  And la colonne est quand même incluse dans la sortie
```

---

## Règle 5 — Comportement sans --apply (stdout safe)

**Sans `--apply`, la commande ne modifie aucun fichier.**

```gherkin
Scenario: sortie stdout par défaut
  Given un config.yaml valide avec credentials Jira
  And les APIs Jira répondent correctement
  When la commande autoconfig est lancée sans --apply
  Then config.yaml n'est pas modifié
  And la sortie stdout contient "board:" et "columns:"
  And la sortie contient les commentaires d'en-tête

Scenario: --apply écrase board.columns et préserve le reste
  Given un config.yaml avec une section metrics.cutoffDate existante
  When la commande autoconfig --apply est lancée
  Then board.columns est mis à jour dans config.yaml
  And metrics.cutoffDate est préservé dans config.yaml
```
