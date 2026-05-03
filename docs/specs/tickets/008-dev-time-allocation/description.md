# Ticket 008 — Dev time allocation (features vs bugs)

## User story

En tant que lead technique ou PO, je veux voir l'évolution semaine par semaine du temps passé
sur des nouvelles features (US, TS) versus des bugs, afin de détecter une dérive vers un mode
"pompier" avant qu'elle ne devienne structurelle.

## Solution retenue

Nouveau metric `dev-time-allocation` : pour chaque issue livrée (ancre `done_at`), on calcule
son cycle time (jours ouvrés dev start → team-done) et on l'attribue au bucket `feature` ou
`bug` selon `config.bugIssueTypes`. On agrège par semaine de livraison pour produire
`featureDays`, `bugDays`, et `bugRatio = bugDays / total`. Le metric suit le pattern
`byWeek` existant (fenêtre 7 jours dans snapshots) mais nécessite un nouveau branch dans
`extractStats` pour sa shape spécifique. Le rapport affiche un chart empilé
(feature en bleu, bug en rouge) + une ligne `bugRatio` sur axe secondaire.

## Estimation

**Bucket** : M

**Justification** : 4 fichiers touchés (nouveau `devTimeAllocation.ts`, `index.ts`,
`compute.ts`, `generate.ts`). SQL calqué sur `cycleTime.ts` avec split par `issue_type`.
Nouveau branch `extractStats` pour shape `{ featureDays, bugDays }`. Nouveau chart empilé
dans le report. 5-7 scénarios de test attendus.

## Statut

**livré**
