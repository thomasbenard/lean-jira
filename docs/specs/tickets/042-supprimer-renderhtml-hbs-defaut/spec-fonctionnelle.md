# Spec fonctionnelle — Supprimer renderHtml() et faire de Handlebars le renderer par défaut

## Contexte

Le ticket 029 a introduit `renderWithHandlebars()` et le template `report.hbs` comme système opt-in via `report.templatePath` dans `board.yaml`. Le renderer historique `renderHtml()` (~1 025 lignes de template literals TypeScript) coexiste désormais avec le template Handlebars qui en est la copie conforme. Cette duplication crée un risque de divergence : toute modification de structure HTML doit être appliquée aux deux endroits.

## Comportement attendu

### Renderer par défaut

Sans `report.templatePath` configuré, `generateReport()` utilise le template embarqué `report.hbs` (résolu via `__dirname/templates/report.hbs`, identique au comportement de `exportDefaultTemplate()`). Le comportement observable (structure HTML, onglets, KPIs, graphiques) reste identique à l'ancien `renderHtml()`.

### Avec templatePath configuré

Le comportement existant est inchangé : `renderWithHandlebars()` utilise le fichier `.hbs` spécifié par l'utilisateur.

### Option --export-template

Inchangée. Exporte `report.hbs` + `context.schema.json` dans le dossier cible.

## Cas limites

- `report.hbs` introuvable dans `__dirname/templates/` au runtime (build incomplet) → `renderWithHandlebars()` lève `[report] Template Handlebars introuvable : <path>` comme pour tout template manquant.
- Tests qui assertent sur des fragments HTML spécifiques produits par `renderHtml()` : les mêmes fragments doivent être présents dans l'output de `renderWithHandlebars()` avec le template embarqué, car `report.hbs` est la copie conforme.

## Ce qui ne change pas

- La surface publique : aucune option CLI ni clé `board.yaml` n'est ajoutée ou supprimée.
- Les helpers privés `fmtInt`, `bySizeRows`, `forecastTableRows`, `helpBtn`, `renderKpiCellHtml`, `renderRoleCardHtml` — ils servent `buildRenderedTabs()` qui reste inchangé.
- `buildRenderedTabs()`, `buildTemplateContext()`, `buildChartDataJson()`, `buildKpiGridHtml()` — inchangés.
- `exportDefaultTemplate()`, `renderWithHandlebars()` — inchangés.
- `computeMovingAvg()` exportée — inchangée (testée unitairement, dupliquée du bloc `<script>`).
- Le bloc `// ─── Dupliqué depuis le bloc <script> embarqué ───` — inchangé.
