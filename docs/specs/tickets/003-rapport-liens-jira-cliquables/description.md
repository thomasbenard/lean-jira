# Ticket 003 — Rapport : liens Jira cliquables sur les clés d'issues

## User story

En tant que membre de l'équipe consultant le rapport HTML, je veux pouvoir cliquer sur une clé d'issue (ex : `KECK-123`) pour ouvrir directement la page Jira correspondante, afin d'agir immédiatement sur les tickets identifiés comme critiques sans avoir à copier-coller manuellement.

## Solution retenue

Passer `jiraBaseUrl` (lu depuis `config.jira.baseUrl`) à `generateReport` et à `renderHtml`. Dans le HTML généré, chaque clé d'issue devient `<a href="{baseUrl}/browse/{key}" target="_blank">{key}</a>`. Impacte le tableau Aging WIP (colonne Issue) et le tooltip du scatter chart aging. Le lien s'ouvre dans un nouvel onglet pour ne pas quitter le rapport.

## Estimation

**Bucket** : S (~1j)

**Justification** : 2 fichiers (`src/main.ts` 1 ligne, `src/report/generate.ts` ajout signature + helper `issueLink` + 1 substitution dans `agingTableRows`). Helper testable unitairement (échappement HTML, trim trailing slash, génération URL). Vérification visuelle navigateur requise.

## Statut

**livré**
