# Spec fonctionnelle — Modèle de données estimation brute

## Contexte

Lean-jira stocke uniquement `original_estimate_seconds` (champ Jira `timeoriginalestimate`, en secondes). Les équipes estimant en story points, complexity points ou tailles de t-shirt voient 100% de leurs issues dans le bucket UNESTIMATED, rendant `lead-time-by-size` et `cycle-time-by-size` inutiles.

Ce ticket ajoute le stockage brut des valeurs alternatives sans modifier les métriques (c'est l'objet de 039b).

## Comportement attendu

### Configuration (`board.yaml`)

Section optionnelle `metrics.estimation`. Cinq méthodes disponibles :

```yaml
# Cas 1 — Time estimate (comportement actuel, méthode par défaut)
# jiraField implicite : Jira "timeoriginalestimate"
metrics:
  estimation:
    method: "time"
    bucketThresholds: { xs: 0.5, s: 1, m: 3, l: 5 }   # en jours ouvrés

# Cas 2 — Story points (champ Atlassian standard)
# jiraField implicite : customfield_10016
metrics:
  estimation:
    method: "story-points"
    bucketThresholds: { xs: 1, s: 3, m: 8, l: 13 }

# Cas 3 — Complexity / Fibonacci / champ numérique custom
# jiraField obligatoire (pas de défaut possible)
metrics:
  estimation:
    method: "numeric"
    jiraField: "customfield_10099"
    bucketThresholds: { xs: 2, s: 5, m: 10, l: 20 }

# Cas 4 — Taille de t-shirt (valeurs catégorielles XS/S/M/L/XL)
# jiraField obligatoire (pas de champ standard)
metrics:
  estimation:
    method: "t-shirt"
    jiraField: "customfield_10200"
    # pas de bucketThresholds — mapping direct du label

# Cas 5 — No estimate
metrics:
  estimation:
    method: "none"
```

Si `estimation` est absent : `method: "time"` implicite, comportement actuel inchangé.

### Valeurs par défaut de `jiraField`

| Méthode | `jiraField` par défaut | Requis explicitement ? |
|---|---|---|
| `time` | `timeoriginalestimate` | Non |
| `story-points` | `customfield_10016` | Non (override possible) |
| `numeric` | — | **Oui** |
| `t-shirt` | — | **Oui** |
| `none` | — | Non (ignoré) |

### Colonnes stockées en DB

| Méthode | Colonne renseignée | Valeur |
|---|---|---|
| `time` | `original_estimate_seconds` (existant) | secondes |
| `story-points` | `story_points` | nombre décimal |
| `numeric` | `story_points` | nombre décimal (même colonne) |
| `t-shirt` | `size_label` | "XS" / "S" / "M" / "L" / "XL" |
| `none` | aucune nouvelle | — |

`story-points` et `numeric` partagent la colonne `story_points` — ce sont deux méthodes de saisie vers le même type de données (valeur numérique brute). `original_estimate_seconds` continue d'être syncé quelle que soit la méthode.

### Extraction depuis Jira

- **time** : `issue.fields.timeoriginalestimate` → `original_estimate_seconds`. Comportement actuel inchangé.
- **story-points / numeric** : `issue.fields[jiraField]` → nombre. Valeur null, 0 ou négative → `story_points = NULL`.
- **t-shirt** : `issue.fields[jiraField]` → string ou objet `{ value: "M" }` (Jira Cloud). Normalisé en majuscules. Valeur non reconnue dans {XS, S, M, L, XL} → `size_label = NULL` + warning console.
- **none** : aucune extraction.

## Cas limites

- `jiraField` absent pour `t-shirt` ou `numeric` → erreur au démarrage avec message explicite
- Override de `jiraField` pour `story-points` (équipe sur instance non-standard) → accepté
- Valeur t-shirt non standard ("Extra Small", "Petite") → `size_label = NULL`, warning console
- Migration sur DB existante → nouvelles colonnes NULL jusqu'au prochain sync complet
- Méthode `none` avec `original_estimate_seconds` existant → pas d'écrasement

## Ce qui ne change pas

- `bucketize()` et métriques by-size : inchangés (039b)
- `throughput-weighted` : inchangé (039c)
- Rapport : inchangé (039d)
- `original_estimate_seconds` : toujours syncé
