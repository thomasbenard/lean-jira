# Spec fonctionnelle — i18n infrastructure + traduction messages CLI

## Contexte

Tous les messages CLI (progress, erreurs, résultats texte) sont actuellement écrits en français
directement dans le code. Pour l'adoption internationale, l'anglais doit être la langue par défaut
avec une option explicite pour revenir au français. Ce ticket pose l'infrastructure i18n et traduit
uniquement les messages CLI — les chaînes du rapport HTML sont hors scope (ticket 041b).

## Comportement attendu

### Option `--lang`

Disponible sur toutes les commandes (`sync`, `metrics`, `snapshots`, `report`, `refresh`,
`validate-config`, `autoconfig`, `list-metrics`). Valeurs acceptées : `en` (défaut), `fr`.

```
npm run sync                         # messages en anglais
npm run sync -- --lang fr            # messages en français (comportement actuel)
npm run refresh -- --lang fr         # toute la pipeline en français
```

Une valeur inconnue (ex. `--lang de`) affiche un avertissement et bascule sur `en`.

### Messages traduits

Toutes les chaînes passant par `console.log`, `console.error`, `console.warn` dans `main.ts`
et `sync.ts` sont externalisées. Exemples :

| Clé | Anglais | Français |
|---|---|---|
| `sync.start` | `Syncing project {{projectKey}}...` | `Sync projet {{projectKey}}...` |
| `sync.statusesFetched` | `  {{count}} statuses fetched ({{doneCount}} in 'done' category)` | `  {{count}} statuts récupérés ({{doneCount}} en catégorie 'done')` |
| `sync.done` | `Sync complete. {{count}} issues stored.` | `Sync terminé. {{count}} issues stockées.` |
| `board.missing` | `board.yaml not found: {{path}}` | `board.yaml introuvable : {{path}}` |
| `board.runAutoconfig` | `Run first: npm run autoconfig -- --apply` | `Lancer d'abord : npm run autoconfig -- --apply` |

### Ce qui N'est PAS traduit dans ce ticket

- Textes du rapport HTML (`HELP_TEXTS`, labels Chart.js, titres de sections) → ticket 041b
- Contenu du README → ticket 041c
- Commentaires dans le code source (restent en français selon coding-standards.md)
- Noms de commandes et d'options CLI (restent en anglais : `sync`, `--config`, etc.)

## Cas limites

- `--lang de` (locale inconnue) → warning `Unknown locale "de", falling back to "en"` + fallback `en`
- Interpolation avec variable manquante → placeholder `{{key}}` laissé tel quel (pas d'exception)
- `initLocale` non appelé avant `t()` → langue par défaut `en` (initialisation lazy à la première
  appel)

## Ce qui ne change pas

- Identifiants de code (noms de fonctions, variables, types) — restent en anglais
- Format de sortie `--json` sur `metrics` — données structurées, non localisées
- Noms des métriques (`lead-time`, `cycle-time`, etc.)
- Comportement fonctionnel de toutes les commandes
