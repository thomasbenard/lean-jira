# Spec fonctionnelle — Rapport HTML personnalisable

## Contexte

Le rapport HTML est actuellement entièrement hard-codé dans `renderHtml()` : police IBM Plex,
palette sombre, titre "Rapport Lean", cinq onglets toujours visibles. Une équipe sans
colonnes par rôle voit des graphiques vides dans l'onglet "Flux par rôle" ; une équipe
voulant ajouter son logo ou sa charte graphique doit modifier le code TypeScript.

## Comportement attendu

### Section `report:` dans `board.yaml`

```yaml
report:
  title: "Équipe Plateforme"
  logoUrl: "./assets/logo.png"
  fontUrl: "https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap"
  customCssPath: "./my-report.css"
  excludeTabs:
    - roles
    - forecast
```

Toutes les clés sont optionnelles. Absence de la section `report:` = comportement actuel inchangé.

### Titre (`title`)

- Remplace "Rapport Lean" dans `<title>` du document HTML.
- Remplace l'intitulé affiché dans le header (`<h1>` ou équivalent).
- Si absent : valeur actuelle conservée ("Rapport Lean — {projectKey}").

### Logo (`logoUrl`)

- **Chemin local** (pas de préfixe `http://` / `https://`) : résolu depuis le répertoire de
  `board.yaml`, lu, converti en data URI base64 (`data:image/<ext>;base64,...`).
  Extensions supportées : `.png`, `.jpg`, `.jpeg`, `.svg`, `.webp`.
- **URL distante** (`http://` / `https://`) : injectée telle quelle dans `src`.
- Inséré dans le header du rapport, à droite du titre.
- Si absent : aucune balise `<img>`, header identique à l'actuel.

### Police (`fontUrl`)

- Remplace le `<link>` Google Fonts existant (IBM Plex) dans le `<head>`.
- La valeur `Chart.defaults.font.family` dans le `<script>` reste à `IBM Plex Mono` — la
  police des charts n'est pas surchargée par ce paramètre (risque d'incompatibilité trop élevé).
- Si absent : `<link>` IBM Plex conservé.

### CSS custom (`customCssPath`)

- Résolu depuis le répertoire de `board.yaml`.
- Lu et injecté dans un bloc `<style>` séparé, **après** le bloc `<style>` défaut.
- Les règles custom ont donc priorité sur les défauts (cascade CSS normale).
- Si absent : aucun bloc supplémentaire.

### Exclusion d'onglets (`excludeTabs`)

Onglets valides : `delivery`, `quality`, `roles`, `forecast`, `advanced`.

- Les onglets listés ne sont **pas rendus** dans le HTML (ni le bouton de navigation, ni le
  panneau contenu).
- Si tous les onglets sont exclus : aucune barre d'onglets rendue.
- Les KPIs (section "Indicateurs clés") et la section "À traiter" ne sont **jamais** exclus
  via ce mécanisme — ils sont toujours présents.
- Valeurs inconnues dans `excludeTabs` : loggées en warning, ignorées.

## Cas limites

- `logoUrl` local inexistant → erreur claire au lancement de `npm run report` (ne pas générer un rapport silencieusement cassé).
- `customCssPath` inexistant → même comportement : erreur explicite.
- `fontUrl` chaîne vide → traité comme absent (IBM Plex conservé).
- `excludeTabs: [delivery, quality, roles, forecast, advanced]` → tous les onglets masqués, aucune barre de navigation rendue.
- Extension logo non reconnue → warning + logo ignoré (ne pas planter le rapport entier).
- `logoUrl` URL distante avec protocole `data:` → rejetée (erreur), car ambiguïté avec le format base64 généré.

## Ce qui ne change pas

- Structure des snapshots et du schéma DB : inchangée.
- Commandes `npm run sync`, `npm run snapshots`, `npm run metrics` : non affectées.
- Contenu des KPIs (section toujours présente, jamais exclue).
- La section "À traiter // top 3" : toujours présente.
- Palette de couleurs défaut : inchangée si aucun CSS custom.
- Charts.js et son `<script>` CDN : toujours présents.
