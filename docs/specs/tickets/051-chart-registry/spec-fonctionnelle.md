# Spec fonctionnelle — Chart registry

## Contexte

`generate.ts` maintient un objet `charts` hardcodé avec 23 appels `buildSeries`/`buildRoleSeries`, un par graphique. `report.hbs` duplique ce savoir avec ~30 appels `lineChart`/IIFEs individuels et un `CANVAS_KEY` de 25 entrées hardcodées. Ajouter un graphique oblige à modifier ces deux fichiers sans source de vérité unique.

## Comportement attendu

### Collecte de données côté serveur

`generate.ts` itère `CHART_DEFS` pour construire l'objet `charts`. Pour chaque def avec `data !== null`, il appelle `buildSeries` (mode `stats`) ou `buildRoleSeries` (mode `roleSeries`). Le résultat est identique à l'objet `charts` actuel — aucun changement de données injectées dans le rapport.

### Injection dans le template

`buildTemplateContext` ajoute deux champs :
- `chartDefsJson` : JSON des defs avec `titleKey` résolu en `title` via `t()`. Injecté via `{{{chartDefsJson}}}`.
- `estimationFlagsJson` : JSON de `EstimationFlags` (showWeighted, weightedUnit, contextLabel). Injecté via `{{{estimationFlagsJson}}}`.

### Rendu client — dispatcher loop

Le script du template itère `CHART_DEFS`. Pour chaque def :
1. Si `def.showWhen` est défini et `_estimationFlags[def.showWhen]` est falsy → skip.
2. Si `def.data === null` et aucun renderer enregistré pour `def.chart.rendererId` → skip (cas `leadBySize`/`cycleBySize` gérés par `initBucketSelector`).
3. Si `def.chart.type === "custom"` → appelle `CUSTOM_RENDERERS[def.chart.rendererId](def, data)`.
4. Sinon → appelle `renderStandardChart(def, data)`.

### Toggle Semaines/Sprints

Le bouton global `debit-toggle` déclenche `initGlobalSprintToggle`. Celui-ci :
- Bascule `_sprintActive` (var globale).
- Itère les defs avec `sprintKey`, cherche les données dans `SPRINT_CHARTS[def.sprintKey]` puis `ROLES_SPRINT_CHARTS[def.sprintKey]`, appelle le renderer.
- Met à jour l'axe X (tick format sprint) et les titres des graphiques débit via `SPRINT_CHART_TITLES`.

Comportement observable inchangé par rapport à l'implémentation actuelle.

### CANVAS_KEY dynamique

`initZoom` construit `CANVAS_KEY` en itérant `CHART_DEFS` : `CANVAS_KEY[def.id] = def.helpKey || ""`. Les tooltips de zoom restent fonctionnels pour tous les canvases.

## Cas limites

- Def avec `data: null` et renderer absent → skip silencieux, pas d'erreur.
- Canvas absent du DOM (`document.getElementById(def.id) === null`) → `renderStandardChart` retourne en début de fonction.
- Données vides (`data.dates.length === 0`) → `renderStandardChart` retourne avant création du Chart.
- `showWhen: "showWeighted"` + estimation `none`/`t-shirt` → graphique `throughputWeighted` skippé.
- Sprint data absente (`hasSprintCharts === false`) → `initGlobalSprintToggle` retourne immédiatement.

## Ce qui ne change pas

- La structure de données injectée dans `CHARTS` (aucun renommage de clé).
- `buildRenderedTabs()` — les canvases HTML sont toujours générés par le code existant.
- `initBucketSelector` pour `leadBySizeChart` et `cycleBySizeChart`.
- Le pipeline sprint (`buildSprintSeries`, `sprintChartsJson`, `rolesSprintChartsJson`).
- Les renderers custom `renderHistogram` et `renderAging` qui lisent `HISTOGRAM`/`AGING` globaux.
- `SPRINT_CHART_TITLES` et la logique de mise à jour des titres débit.
