# Example Mapping — Rework Cost

## Règle 1 — Détection des passes rework

**Un statut sans rôle interrompt le bloc courant et réinitialise le contexte. Un retour dans un rôle déjà visité après un gap sans rôle est une passe rework.**

```gherkin
Scenario: flux linéaire sans rework
  Given un ticket avec transitions DEV(3j) → QA(1j) → DONE
  When on calcule rework-cost
  Then reworkDays = 0
  And reworkedCount = 0

Scenario: retour direct à un rôle via statut sans rôle
  Given un ticket avec transitions DEV(3j) → Code Review no-role(1j) → DEV(2j) → DONE
  When on calcule rework-cost
  Then reworkDays = 2 (2e DEV uniquement)
  And reworkedCount = 1

Scenario: retour inter-rôle classique
  Given un ticket avec transitions DEV(3j) → QA(1j) → DEV(2j) → QA(1j) → DONE
  When on calcule rework-cost
  Then reworkDays = 3 (2e DEV 2j + 2e QA 1j)
  And reworkedCount = 1
```

## Règle 2 — Exclusion des todoStatuses

**Le temps passé dans todoStatuses entre deux passes rework n'est pas compté dans le coût.**

```gherkin
Scenario: passage par TODO entre deux passes DEV
  Given un ticket avec transitions DEV(3j) → Code Review(1j) → TODO(4j) → DEV(2j) → DONE
  When on calcule rework-cost
  Then reworkDays = 2 (2e DEV uniquement)
  And les 4j en TODO sont exclus du coût

Scenario: passage par TODO sans rework
  Given un ticket avec transitions DEV(3j) → TODO(2j) → QA(1j) → DONE
  When on calcule rework-cost
  Then reworkDays = 0
  And le passage par TODO ne crée pas de passe rework dans QA
```

## Règle 3 — Distribution proportionnelle sur semaines

**Le coût rework d'une passe est distribué proportionnellement sur les semaines ISO, capé à 5 j/semaine.**

```gherkin
Scenario: passe rework sur 2 semaines
  Given un ticket avec une passe rework DEV de 8 j-ouvrés
  And la passe débute lundi semaine S1 et se termine mercredi semaine S2
  When on calcule byWeek
  Then S1 reçoit 5 j (lun→ven)
  And S2 reçoit 3 j (lun→mer)

Scenario: passe rework courte sur 1 semaine
  Given un ticket avec une passe rework QA de 2 j-ouvrés sur semaine S1
  When on calcule byWeek
  Then S1 reçoit 2 j
  And aucune autre semaine n'est affectée
```

## Règle 4 — Attribution sprint

**Un bloc rework est attribué au sprint actif à sa date de fin. Un bloc sans sprint correspondant est compté globalement mais pas dans bySprint.**

```gherkin
Scenario: passe rework se terminant dans un sprint actif
  Given un sprint S avec start_date = "2025-05-05" et end_date = "2025-05-18"
  And une passe rework DEV se terminant le "2025-05-12"
  When on calcule bySprint
  Then le coût rework est attribué au sprint S

Scenario: passe rework hors sprint
  Given aucun sprint n'a de plage couvrant "2025-03-01"
  And une passe rework se terminant le "2025-03-01"
  When on calcule bySprint
  Then bySprint ne contient pas cette passe
  But totalReworkDays inclut bien cette passe
```
