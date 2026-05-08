# Ticket 040 — Autoconfig détection de la méthode d'estimation

## User story

En tant que lead technique qui met en place lean-jira sur un projet existant, je veux qu'`autoconfig` détecte automatiquement la méthode d'estimation de l'équipe et génère le bloc `metrics.estimation` dans `board.yaml`, afin de ne pas avoir à deviner quelle méthode configurer manuellement.

## Solution retenue

L'API Jira Agile `/rest/agile/1.0/board/{id}/configuration` retourne déjà un champ `estimation` indiquant le type (`none`, `issueCount`, `field`) et l'identifiant du champ utilisé. `autoconfig` lit ce champ pour inférer `EstimationConfig` : `timeoriginalestimate` → `time`, `customfield_10016` → `story-points`, autre champ → `numeric` avec `jiraField`. Cas `none`/`issueCount` → `method: "none"`. En mode `--apply`, le bloc détecté est écrit dans `board.yaml` ; s'il existe déjà, il est préservé (même comportement que `legacyDoneStatuses`). Une warning CLI signale les cas `numeric` où l'utilisateur devrait vérifier si la méthode est en réalité `t-shirt`.

## Dépendance

Requiert **039a livré** (types `EstimationConfig` dans `src/metrics/types.ts`).

## Estimation

**Bucket** : S

**Justification** : 3 fichiers touchés (`src/jira/types.ts`, `src/main.ts`, `src/jira/fixtures/boardConfig.json`). Pas de migration DB. Pattern existant à dupliquer (preservation de `legacyDoneStatuses`). 4-5 scénarios de test.

## Statut

**à faire**
