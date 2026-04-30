# Example Mapping — Onboarding : validate-config

## Règle 1 — Pré-requis : DB peuplée

**La commande échoue explicitement si aucun sync n'a encore été effectué.**

```gherkin
Scenario: Base vide
  Given la table statuses est vide (aucun sync effectué)
  When l'utilisateur lance npm run validate
  Then la sortie affiche "Base vide. Lancer `npm run sync` d'abord."
  And le code de sortie est non zéro

Scenario: Base peuplée après un sync
  Given la table statuses contient au moins un statut
  When l'utilisateur lance npm run validate
  Then la commande s'exécute normalement (pas d'erreur pré-requis)
```

---

## Règle 2 — Validation des statuts par section

**Chaque section du config est validée indépendamment ; les absents sont listés.**

```gherkin
Scenario: Tous les statuts valides
  Given config.yaml contient todoStatuses: ["À faire"]
  And la table statuses contient "À faire"
  When l'utilisateur lance npm run validate
  Then la sortie affiche "  ✓ À faire" sous "todoStatuses"
  And la sortie finale affiche "✓ Config valide."
  And le code de sortie est 0

Scenario: Un statut introuvable dans une section
  Given config.yaml contient todoStatuses: ["À faire", "Backlog"]
  And la table statuses contient "À faire" mais pas "Backlog"
  When l'utilisateur lance npm run validate
  Then la sortie affiche "  ✓ À faire" et "  ✗ Backlog  ← introuvable en base"
  And la liste des statuts disponibles est affichée
  And le code de sortie est non zéro

Scenario: Section optionnelle absente du config
  Given config.yaml ne contient pas de clé activeStatuses
  When l'utilisateur lance npm run validate
  Then la section activeStatuses est silencieusement ignorée
  And aucune erreur n'est générée pour cette section
```

---

## Règle 3 — Statuts legacy dans doneStatuses

**Un statut absent de la DB mais dans doneStatuses est signalé comme legacy, pas comme erreur bloquante.**

```gherkin
Scenario: Statut legacy dans doneStatuses
  Given config.yaml contient doneStatuses: ["Livré", "To Be Validated"]
  And la table statuses contient "Livré" mais pas "To Be Validated"
  When l'utilisateur lance npm run validate
  Then la sortie affiche "  ✓ Livré"
  And la sortie affiche "  ✗ To Be Validated  ← introuvable en base (statut legacy — accepté pour l'historique)"
  And "To Be Validated" n'est PAS comptabilisé dans le total des statuts manquants
  And si doneStatuses est la seule section avec des absents, le code de sortie est 0
```
