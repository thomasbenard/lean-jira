# Example Mapping — autoconfig : préservation du config existant

## Règle 1 — Fusion avec config existante : préservation des personnalisations

**Quand une colonne API correspond à une colonne existante (même nom), les champs manuels sont préservés et `statuses` est mis à jour.**

```gherkin
Scenario: type personnalisé préservé après merge
  Given config existante avec colonne "STANDBY" type: queue
  And API board retourne colonne "STANDBY" avec statuses ["En attente"]
  When mergeColumns est appelé
  Then la colonne "STANDBY" a type: queue
  And statuses = ["En attente"]

Scenario: devStart préservé après merge
  Given config existante avec colonne "IN PROGRESS" devStart: true
  And API board retourne colonne "IN PROGRESS" avec statuses ["En cours"]
  When mergeColumns est appelé
  Then la colonne "IN PROGRESS" a devStart: true

Scenario: legacyStatuses préservés après merge
  Given config existante avec colonne "TODO" legacyStatuses: ["Ready to do", "To Do"]
  And API board retourne colonne "TODO" avec statuses ["Prêt à faire"]
  When mergeColumns est appelé
  Then la colonne "TODO" a legacyStatuses: ["Ready to do", "To Do"]
  And statuses = ["Prêt à faire"]
```

## Règle 2 — Nouvelle colonne dans l'API, absente du config

**Une colonne présente dans l'API mais absente de la config existante est inférée par position et ajoutée.**

```gherkin
Scenario: nouvelle colonne inférée et ajoutée
  Given config existante avec colonnes ["TODO", "IN PROGRESS", "DONE"]
  And API board retourne colonnes ["TODO", "IN PROGRESS", "TEST QA", "DONE"]
  When mergeColumns est appelé
  Then colonnes résultantes contiennent "TEST QA"
  And "TEST QA" a type: active (inféré par position)

Scenario: warning émis pour nouvelle colonne
  Given config existante avec colonnes ["TODO", "DONE"]
  And API board retourne colonnes ["TODO", "IN PROGRESS", "DONE"]
  When mergeColumns est appelé
  Then un warning contenant "Nouvelle colonne détectée" et "IN PROGRESS" est émis
```

## Règle 3 — Colonne config absente de l'API

**Une colonne présente en config mais absente de l'API est conservée avec un warning.**

```gherkin
Scenario: colonne config orpheline conservée
  Given config existante avec colonnes ["TODO", "DESIGN", "DONE"]
  And API board retourne colonnes ["TODO", "DONE"]
  When mergeColumns est appelé
  Then colonnes résultantes contiennent "DESIGN"
  And un warning contenant "absente du board Jira" et "DESIGN" est émis

Scenario: colonnes API et config complètement disjointes (tous renommés)
  Given config existante avec colonnes ["TODO", "IN PROGRESS", "DONE"]
  And API board retourne colonnes ["BACKLOG", "EN COURS", "TERMINÉ"]
  When mergeColumns est appelé
  Then 3 warnings "Nouvelle colonne détectée" sont émis
  And 3 warnings "absente du board Jira" sont émis
```

## Règle 4 — Absence de config existante

**Sans `board.columns` dans la config, génération complète (comportement actuel inchangé).**

```gherkin
Scenario: premier lancement sans board.columns
  Given config.yaml sans section board.columns
  And API board retourne 4 colonnes
  When autoconfig est lancé
  Then inferBoardColumns est appelé directement (pas de merge)
  And toutes les colonnes sont inférées par position

Scenario: board.columns vide explicitement
  Given config.yaml avec board.columns: []
  And API board retourne 4 colonnes
  When autoconfig est lancé
  Then génération complète (board.columns vide traité comme absent)
```
