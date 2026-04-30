# Spec fonctionnelle — Rapport : liens Jira cliquables

## Contexte

Le rapport HTML affiche des clés d'issues Jira dans deux endroits : le tableau Aging WIP et le tooltip du scatter chart. Ces clés sont du texte brut. Pour investiguer ou agir sur un ticket identifié comme critique, l'utilisateur doit copier la clé, ouvrir Jira dans un onglet séparé, et coller. L'URL Jira est de la forme `{baseUrl}/browse/{issueKey}` et `baseUrl` est déjà dans `config.yaml`.

## Comportement attendu

### Tableau Aging WIP

- Colonne "Issue" : chaque clé devient un lien `<a href="{baseUrl}/browse/{key}" target="_blank" rel="noopener">{key}</a>`
- Apparence : couleur par défaut du lien navigateur (bleu/violet selon visité), pas de style supplémentaire imposé
- Le lien s'ouvre dans un nouvel onglet (`target="_blank"`) pour ne pas quitter le rapport

### Scatter chart Aging (tooltip)

- Le tooltip affiche actuellement `KECK-123 : 4.5j (En cours)`
- Après modification : inchangé visuellement (Chart.js ne rend pas de HTML dans les tooltips par défaut)
- Aucune modification du tooltip — les tooltips Canvas ne supportent pas les liens cliquables

### Propagation de `jiraBaseUrl`

- `baseUrl` est passé à `generateReport` depuis `main.ts` (déjà disponible via `config.jira.baseUrl`)
- `renderHtml` reçoit `jiraBaseUrl: string` dans `RenderInput`
- Toute table future affichant des clés d'issues doit utiliser la même helper `issueLink(key)`

## Cas limites

- `baseUrl` se termine par `/` → normaliser pour éviter `//browse/KEY` (trim trailing slash)
- Clé vide ou null → afficher le texte brut sans `<a>` (cas défensif, ne devrait pas arriver)
- Rapport consulté hors ligne → le lien est présent mais ne fonctionnera pas ; comportement attendu (pas de fallback nécessaire)

## Ce qui ne change pas

- Aucune modification du backend, de la DB, ou des calculs de métriques
- Le scatter chart aging n'est pas modifié
- Les autres sections du rapport (KPIs, tendances, forecast) ne montrent pas de clés d'issues : hors scope
