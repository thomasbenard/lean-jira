# Ticket 029 — Template Handlebars pour override HTML complet du rapport

## User story

En tant que développeur ou lead technique souhaitant personnaliser la structure HTML du
rapport au-delà de ce que permet `board.yaml`, je veux pouvoir fournir un template
Handlebars personnalisé, afin de revoir intégralement la mise en page, ajouter des sections
métier, ou intégrer une charte graphique d'entreprise complète.

## Solution retenue

Option A (ticket 028) reste le comportement par défaut — aucune dépendance nouvelle, aucun
fichier à maîtriser. Option B est un mode avancé, opt-in, configuré dans `board.yaml` :

```yaml
report:
  templatePath: "./my-template/report.hbs"  # active Option B
  # compatible avec toutes les autres clés du ticket 028
```

Une seule option CLI nouvelle sur la commande `report` :

- `--export-template <dir>` : action one-shot — copie le template Handlebars par défaut
  dans `<dir>` pour servir de point de départ. L'utilisateur édite ensuite `report.hbs`,
  puis configure `templatePath` dans `board.yaml`.

Le moteur choisi est **Handlebars** (`handlebars` npm package) : syntaxe `{{variable}}` /
`{{#if}}` / `{{#each}}` familière pour quiconque connaît HTML ; pas de logique arbitraire
dans le template (séparation nette données / présentation).

`renderHtml()` est refactorisé en deux parties :
1. `buildTemplateContext(input)` — construit un objet JSON riche (toutes les données +
   fragments HTML pré-calculés + données Chart.js sérialisées) passé au template.
2. Le rendu lui-même — soit via le template TS interne (comportement 028), soit via
   Handlebars si `report.templatePath` est renseigné dans `board.yaml`.

**Prérequis** : ticket 028 livré (la `ReportPersonalization` fait partie du contexte passé
au template).

## Estimation

**Bucket** : L

**Justification** : 4 fichiers touchés (`package.json`, `main.ts`, `generate.ts`, nouveau
`report.hbs` ~1200 lignes). Extraction mécanique mais volumineuse. Helpers Handlebars à
définir pour les fonctions utilitaires (`helpBtn`, `kpiCellHtml`, `escapeHtml`…). Chart.js
data à sérialiser proprement dans le contexte. 6-8 scénarios de test. Risque : si les
helpers deviennent trop complexes, extraction partielle possible (voir spec-technique).

## Statut

**livré**
