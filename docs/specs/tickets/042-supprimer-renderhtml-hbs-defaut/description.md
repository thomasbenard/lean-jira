# Ticket 042 — Supprimer renderHtml() et faire de Handlebars le renderer par défaut

## User story

En tant que développeur maintenant le rapport, je veux supprimer `renderHtml()` et ses ~1 025 lignes de concaténation HTML inline, afin d'avoir une seule source de vérité pour la structure du rapport dans `report.hbs`.

## Solution retenue

`generateReport()` utilisera toujours `renderWithHandlebars()` — avec le template embarqué (`__dirname/templates/report.hbs`) quand aucun `templatePath` n'est configuré. La branche `renderHtml() / renderWithHandlebars()` à L402-404 est supprimée. `renderHtml()` (L521–L1546) est effacée. Les helpers privés qu'elle appelait (`fmtInt`, `bySizeRows`, `forecastTableRows`, `helpBtn`, `renderKpiCellHtml`, `renderRoleCardHtml`) restent car ils servent encore `buildRenderedTabs()`. Les tests qui appellaient `renderHtml()` directement sont migrés vers `renderWithHandlebars()` avec le template embarqué.

## Estimation

**Bucket** : M

**Justification** : Suppression nette de ~1 025 lignes dans `generate.ts`, mais migration de ~25 tests répartis sur 2 fichiers (`generate.test.ts`, `personalization.test.ts`) vers `renderWithHandlebars()`. Risque principal : vérifier la parité de surface observable entre l'ancien output et le template `report.hbs` pour les assertions existantes.

## Statut

**à faire**
