# Example Mapping — Métrique scope-change-rate

## Règle 1 — Changement trivial ignoré (description)

**Un changement de description est ignoré si la similarité normalisée ≥ 0,85**

```gherkin
Scenario: Ajout d'espaces et retour à la ligne — ignoré
  Given une description "Faire le module de login"
  And la description modifiée est "Faire  le module de login\n"
  When on calcule similarityRatio
  Then le ratio est >= 0.85
  And le changement est ignoré

Scenario: Correction d'une faute de frappe — ignoré
  Given une description "Implémenter la fonciton d'export"
  And la description modifiée est "Implémenter la fonction d'export"
  When on calcule similarityRatio
  Then le ratio est >= 0.85
  And le changement est ignoré

Scenario: Suppression d'un paragraphe entier — significatif
  Given une description de 300 caractères avec critères d'acceptation détaillés
  And la description modifiée supprime 2 critères sur 4 (150 caractères retirés)
  When on calcule similarityRatio
  Then le ratio est < 0.85
  And le changement est comptabilisé pour l'issue
```

## Règle 2 — Story points : première estimation vs réévaluation

**Première estimation (null → valeur) est ignorée ; toute réévaluation est significative**

```gherkin
Scenario: Première estimation — ignorée
  Given une issue sans story points
  And un changement Story Points de NULL à "3"
  When on classifie le changement
  Then from_value est NULL
  And le changement est ignoré

Scenario: Réévaluation de l'estimation — significative
  Given une issue estimée à "3 points"
  And un changement Story Points de "3" à "8"
  When on classifie le changement
  Then le changement est comptabilisé (type storyPoints)
```

## Règle 3 — Périmètre temporel : post-sprint-start uniquement

**Seuls les changements après le start_date du premier sprint sont comptabilisés**

```gherkin
Scenario: Changement avant entrée en sprint — ignoré
  Given une issue avec sprint start_date = "2025-03-10"
  And un changement de description le "2025-03-08"
  When on filtre les changements post-sprint
  Then le changement est exclu (antérieur au sprint start)

Scenario: Changement après entrée en sprint — comptabilisé
  Given une issue avec sprint start_date = "2025-03-10"
  And un changement de description significatif le "2025-03-15"
  When on filtre les changements post-sprint
  Then le changement est inclus dans la métrique

Scenario: Issue sans sprint — exclue
  Given une issue sans aucun changement Sprint dans issue_field_changes
  When on calcule scope-change-rate
  Then l'issue n'apparaît pas dans totalIssues
```

## Règle 4 — Reprogrammation sprint

**Tout changement de sprint depuis un sprint non-null est un signal de reprogrammation**

```gherkin
Scenario: Sprint change depuis un sprint existant — significatif
  Given une issue assignée au "Sprint 42"
  And un changement Sprint de "Sprint 42" vers "Sprint 43"
  When on classifie le changement
  Then le changement est comptabilisé (type sprintChange)

Scenario: Assignation initiale à un sprint — ignorée
  Given une issue sans sprint précédent
  And un changement Sprint de NULL vers "Sprint 42"
  When on classifie le changement
  Then from_value est NULL
  And le changement est ignoré
```
