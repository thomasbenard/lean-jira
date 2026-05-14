# Spec fonctionnelle — Rework Cost

## Contexte

`handoff-rework` mesure la fréquence des retours arrière (taux), et `first-time-right` mesure le taux de passages en un seul essai. Aucune métrique ne mesure le **coût en temps** du rework : 20 % de rework à 0,5 j chacun n'a pas le même impact que 20 % à 4 j chacun. `rework-cost` comble ce vide.

## Population

Même population que `cycle-time`, `handoff-rework` et `first-time-right` : tickets livrés ayant une transition vers un `devStartStatuses`. `cutoffDate` et `windowEndDate` s'appliquent (filtre sur `done_at`).

## Définition d'une passe rework

Une **passe** dans un rôle = bloc contigu de transitions vers des statuts appartenant à ce rôle (`devStatuses`, `qaStatuses`, `poStatuses`). Un statut sans rôle (ni dev, ni qa, ni po) **interrompt** le bloc courant et réinitialise le contexte de rôle.

Une passe est **rework** si c'est la 2e passe ou au-delà dans ce rôle pour ce ticket.

Exemples de séquences et leur résultat :

| Séquence | Résultat |
|---|---|
| DEV → QA → DONE | 0 j rework (aucun retour) |
| DEV → Code Review (no-role) → DEV → DONE | 1 passe rework : 2e DEV |
| DEV → QA → DEV → QA → DONE | 2 passes rework : 2e DEV + 2e QA |
| DEV → TODO → DEV → DONE | 1 passe rework : 2e DEV ; temps en TODO exclu |
| DEV → Code Review → TODO → DEV → DONE | 1 passe rework : 2e DEV ; temps Code Review + TODO exclus |

## Durée d'une passe rework

La durée d'une passe = `workingDaysBetween(passStart, passEnd)` en jours-ouvrés (lundi–vendredi).

- `passStart` = `transitioned_at` de la première transition entrant dans la passe
- `passEnd` = `transitioned_at` de la transition qui quitte la passe (ou `done_at` si la passe se termine à la livraison)

Seul le temps **dans le statut de rôle** est compté. Le temps dans `todoStatuses` ou statuts sans rôle entre deux passes est automatiquement exclu (il n'est dans aucune passe).

## Distribution hebdomadaire

Le coût rework d'un ticket est réparti proportionnellement sur les semaines ISO couvertes par chaque passe rework, comme `devTimeAllocation` répartit les cycle-times :

- Chaque semaine reçoit `min(5, remaining)` jours (cap à 5 j/semaine ouvrée)
- Le résidu est affecté à la semaine de fin de la passe

## Vue par sprint

Un bloc rework est attribué au sprint dont `start_date <= passEnd <= end_date`. Si aucun sprint ne couvre cette date, le bloc est ignoré de la vue sprint (mais compté dans les agrégats globaux et hebdo).

## Sorties

```
count                          total tickets analysés
reworkedCount                  tickets avec ≥ 1 passe rework
reworkRatio                    reworkedCount / count
totalReworkDays                somme globale des jours rework
avgReworkDaysPerReworkedTicket totalReworkDays / reworkedCount (0 si reworkedCount = 0)
reworkCostRatio                totalReworkDays / totalCycleTimeDays des tickets reworkés uniquement
byWeek[]                       { week, reworkDays, reworkedIssues }
bySprint[]                     { sprintId, sprintName, reworkDays, reworkedIssues }
```

## Cas limites

- Aucun rôle configuré (`devStatuses` / `qaStatuses` / `poStatuses` vides) → aucun bloc détecté → `reworkedCount = 0`, `byWeek = []`, `bySprint = []`
- `reworkedCount = 0` → `avgReworkDaysPerReworkedTicket = 0`, `reworkCostRatio = 0` (pas de division par zéro)
- Ticket avec `devStartStatuses` mais sans statut de rôle dans ses transitions → ignoré du compte rework
- Passe rework de 0 j-ouvrés (transition instantanée) → ignorée (aucun coût à imputer)
- Sprint sans `start_date` ou `end_date` → ignoré de l'attribution sprint

## Ce qui ne change pas

- La détection de rework de `handoff-rework` et `first-time-right` reste inchangée
- `rework-cost` ne produit aucune ligne `healthThresholds` dans le rapport (pas de seuil configuré dans ce ticket)
- Pas de vue par taille de ticket (bucket XS/S/M/L) dans ce ticket
