# 038 — Connecteur Jira fake (mode local sans accès Jira)

## User story

En tant que développeur souhaitant travailler sur lean-jira sans accès à un Jira live,  
je veux pouvoir lancer `npm run refresh -- -c config.fake.yaml -b board.fake.yaml`  
afin de voir un rapport HTML complet avec des données réalistes, identique à chaque exécution.

## Solution choisie

Ajouter un `FakeJiraClient` chargé via `jira.mode: fake` dans `config.yaml`. Les fixtures JSON statiques (statuts, sprints, ~38 issues avec changelogs complets) couvrent toutes les métriques. L'output est rendu déterministe par `frozenNow` (horloge figée) + PRNG seedé (Mulberry32) pour le forecast Monte Carlo.

## Statut

Livré
