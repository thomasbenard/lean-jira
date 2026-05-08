# Ticket 041b — Traduction rapport HTML (labels + help texts)

## User story

En tant qu'utilisateur international ayant configuré lean-jira avec `--lang en` ou
`report.lang: en` dans `board.yaml`, je veux que le rapport HTML généré affiche tous
ses textes en anglais (titres de sections, labels Chart.js, tooltips d'aide, messages
KPI, bannières d'alerte), afin de partager un rapport lisible avec mon équipe sans
texte français résiduel.

## Solution retenue

Étendre `LocaleShape` (créée en 041a) avec un espace de noms `report.*` couvrant les
18 entrées `HELP_TEXTS` et toutes les chaînes HTML embarquées dans `generate.ts`.
`generateReport()` accepte un paramètre `lang: LocaleCode = "en"` — quand absent,
lit `board.yaml → report.lang` (via `BoardFileConfig`). `renderHtml()` reçoit un objet
`labels: ReportLabels` dans `RenderInput` ; le template HTML remplace toutes les
chaînes hardcodées par des références à `labels.*`.

## Estimation

**Bucket** : L

**Justification** : `generate.ts` fait 1884 lignes avec ~200 chaînes françaises (HELP_TEXTS
+ titres sections + labels + messages KPI + bannières + tooltips aging WIP). Pas d'algorithme
complexe mais extraction volumineuse. `BoardFileConfig` gagne `report?.lang`. 6-8 scénarios
de test. Prérequis : ticket 041a livré (infrastructure `LocaleShape` + `t()` disponible).

## Statut

**à faire**
