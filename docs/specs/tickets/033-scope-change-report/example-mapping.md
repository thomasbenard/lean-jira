# Example Mapping — Rapport scope change

## Règle 1 — Bannière d'alerte conditionnelle

**La bannière s'affiche uniquement si des changements existent dans le sprint actif ou précédent**

```gherkin
Scenario: Aucun changement de périmètre — pas de bannière
  Given scopeData.changedIssues = 0
  When on génère le rapport
  Then aucune bannière alert-orange n'est présente

Scenario: Changement dans le sprint actif — bannière affichée
  Given le sprint "KECK Sprint 45" est actif
  And scopeData.bySprint["KECK Sprint 45"].changedIssues = 2
  When on génère le rapport
  Then la bannière affiche "2 issue(s) modifiée(s) après entrée en sprint"
  And le texte mentionne "KECK Sprint 45"

Scenario: Changements uniquement sur sprints anciens — pas de bannière
  Given le sprint actif "KECK Sprint 45" a 0 issue modifiée
  And le sprint closed précédent "KECK Sprint 44" a 0 issue modifiée
  And "KECK Sprint 40" a 3 issues modifiées
  When on génère le rapport
  Then aucune bannière n'est présente
```

## Règle 2 — Dégradation gracieuse si table absente

**La section est omise sans erreur si issue_field_changes n'existe pas**

```gherkin
Scenario: Base non migrée (ticket 031 non exécuté)
  Given la table issue_field_changes n'existe pas en base
  When on génère le rapport
  Then aucune section "Dérive de périmètre" n'est présente
  And aucune erreur n'est levée
  And les autres sections du rapport sont normales

Scenario: Table présente mais vide
  Given la table issue_field_changes existe mais est vide
  When on génère le rapport
  Then la section affiche "Aucune dérive de périmètre détectée"
  And aucune bannière n'est présente
```

## Règle 3 — Tri chronologique des sprints dans le graphe

**Les sprints s'affichent du plus ancien au plus récent**

```gherkin
Scenario: Sprints numérotés dans le nom
  Given les sprints bySprint contiennent "KECK Sprint 43", "KECK Sprint 41", "KECK Sprint 42"
  When on construit le graphe
  Then l'ordre des labels est ["KECK Sprint 41", "KECK Sprint 42", "KECK Sprint 43"]
```
