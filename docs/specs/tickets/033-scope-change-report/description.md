# Ticket 033 — Rapport : graphe scope change + alerte

## User story

En tant que lead technique, je veux voir dans le rapport HTML un graphe historique des changements de périmètre par sprint (avec corrélation throughput) et une alerte visible s'il y a au moins une US modifiée après son entrée en sprint, afin d'identifier rapidement les sprints dégradés par de la dérive de périmètre.

## Solution retenue

Dans `src/report/generate.ts`, ajouter une nouvelle section "Scope change" qui appelle directement `scopeChangeMetric.compute()` (calcul live, pas via snapshots). Le graphe est un Chart.js bar chart par sprint : barres empilées (description / story points / reprogrammation), axe droit en pourcentage. Une bannière d'alerte orange est injectée en haut du rapport si `changedIssues > 0` dans le sprint actif ou le sprint précédent. La section est skippée silencieusement si la table `issue_field_changes` est absente (base non migrée).

## Estimation

**Bucket** : M

**Justification** : Extension de `generate.ts` (fichier volumineux), nouveau graphe Chart.js avec double axe Y, bannière alerte conditionnelle, help text. Dépend des tickets 031 + 032. ~4-6 scénarios de test (rapport sans changements, rapport avec alerte, sprint actif, données manquantes).

## Statut

**à faire**
