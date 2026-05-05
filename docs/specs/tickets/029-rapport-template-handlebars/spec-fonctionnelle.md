# Spec fonctionnelle — Template Handlebars pour override HTML complet

## Contexte

Le ticket 028 permet de personnaliser logo, police, CSS et onglets via `board.yaml`. Cela
couvre la majorité des besoins. Mais certains utilisateurs veulent aller plus loin : réordonner
les sections, supprimer le header par défaut, intégrer un layout multi-colonnes propriétaire,
ou ajouter des sections personnalisées (équipe, liens wiki…). Ces cas requièrent un accès
complet à la structure HTML, impossible sans modifier le code TypeScript.

## Comportement attendu

### Mode par défaut (inchangé)

`npm run report` → rendu TS interne (ticket 028). Aucun fichier template requis.

### Exporter le template par défaut

```bash
npm run report -- --export-template ./mon-template
```

- Crée `./mon-template/report.hbs` : template Handlebars correspondant au rendu actuel.
- Crée `./mon-template/context.schema.json` : documentation JSON Schema du contexte passé
  au template (aide l'utilisateur à connaître les variables disponibles).
- Si le répertoire existe déjà et contient `report.hbs` : erreur explicite (ne pas écraser).
- L'utilisateur peut ensuite éditer `report.hbs` librement.

### Utiliser un template custom

```yaml
# board.yaml
report:
  templatePath: "./mon-template/report.hbs"
```

- Au lancement de `npm run report`, le chemin est résolu depuis le répertoire de `board.yaml`.
- Le fichier `.hbs` est compilé via Handlebars et rendu avec le contexte complet.
- Le HTML produit reste self-contained (même contrainte qu'aujourd'hui).
- Toutes les autres clés `report:` (ticket 028 : `logoUrl`, `fontUrl`, `customCssPath`,
  `excludeTabs`, `title`) restent compatibles — leur effet est visible dans le contexte passé
  au template (variables `headerLogoHtml`, `fontLinkHtml`, `customStyleHtml`, `tabs`, `title`).
- Si `templatePath` pointe vers un fichier inexistant : erreur explicite, arrêt immédiat.
- Erreur de compilation Handlebars (syntaxe invalide) : message d'erreur avec le numéro de
  ligne, arrêt immédiat.

### Contexte Handlebars — variables disponibles

Le contexte passé au template couvre deux catégories :

**Fragments HTML pré-calculés** (pour composition simple) :
- `staleBannerHtml` — bannière de données périmées (chaîne HTML ou vide)
- `top3Html` — section "À traiter // top 3" (HTML complet)
- `kpiGridHtml` — grille des KPI cells
- `tabs` — tableau `[{ id, label, html, active }]` — chaque onglet prêt à injecter
- `headerLogoHtml` — balise `<img>` du logo si configuré (sinon vide)
- `fontLinkHtml` — `<link>` de la police (IBM Plex ou custom)
- `customStyleHtml` — bloc `<style>` du CSS custom si fourni (sinon vide)

**Données brutes** (pour sections custom) :
- `projectKey`, `generatedAt`, `lastSnapshotDate`, `isSyncStale`, `lastSyncAt`
- `kpis` — objet `Record<string, number | null>`
- `chartDataJson` — JSON stringifié de toutes les séries Chart.js (à injecter dans `<script>`)
- `agingWip`, `forecast`, `cycleStats` — objets structurés
- `title` — titre résolu (`report.title` de board.yaml ou "Rapport Lean — {projectKey}")

**Helpers Handlebars enregistrés** :
- `{{escapeHtml value}}` — échappe HTML
- `{{json value}}` — JSON.stringify
- `{{#if_includes array value}}...{{/if_includes}}` — teste si un tableau contient une valeur
- `{{fmt_float value decimals}}` — formate un nombre décimal

## Cas limites

- `templatePath` dans board.yaml + `--export-template` fournis simultanément → `--export-template` a priorité (action one-shot, ignore le rendu).
- Template custom qui référence une variable inexistante → Handlebars retourne vide (`""`) — comportement standard Handlebars ; pas d'erreur.
- Template custom sans `{{{chartDataJson}}}` → les charts Chart.js ne s'initialiseront pas (pas d'erreur à la génération, problème visible à l'ouverture du HTML).
- `--export-template` avec répertoire inexistant → le créer automatiquement.
- Template custom vide → HTML vide produit, pas d'erreur.

## Ce qui ne change pas

- `npm run report` sans options → comportement identique à 028, zéro overhead.
- Les données calculées (`metric_snapshots`, snapshots, Chart.js series) : inchangées.
- Le rendu TS interne (`renderHtml()`) : conservé intégralement comme fallback et comme
  source de vérité pour générer `report.hbs`.
- Les commandes `sync`, `metrics`, `snapshots` : non affectées.
