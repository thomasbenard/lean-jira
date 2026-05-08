# Spec fonctionnelle — Throughput pondéré adapté à la méthode d'estimation

## Contexte

`throughput-weighted` somme les `original_estimate_seconds` livrés par semaine. Pour les équipes story-points ou numeric, cette somme vaut 0. Pour t-shirt et none, la somme n'a pas de sens. La métrique doit s'adapter automatiquement à la méthode sans nouvelle propriété de config — le champ à sommer et l'unité sont dérivés de `estimation.method`.

## Comportement attendu

### Comportement par méthode (dérivé automatiquement)

| Méthode | Champ sommé | Unité affichée | Statut |
|---|---|---|---|
| `time` | `original_estimate_seconds / 28800` | "j-h" | actif (inchangé) |
| `story-points` | `story_points` | "SP" | actif |
| `numeric` | `story_points` (même colonne) | "pts" | actif |
| `t-shirt` | — | — | désactivé |
| `none` | — | — | désactivé |

Pas de propriété `weightField` en config — tout est dérivé depuis `estimation.method`.

### Interface de retour

```typescript
interface ThroughputWeightedSummary {
  byWeek: ThroughputWeightedByWeek[];
  avgPerWeek: number;
  unit: "j-h" | "SP" | "pts";
  disabled: boolean;
}
```

### Affichage CLI

- `time` : "3.5 j-h/semaine (12 estimées, 2 non estimées)"
- `story-points` : "45.0 SP/semaine (12 estimées, 2 non estimées)"
- `numeric` : "32.0 pts/semaine (12 estimées, 2 non estimées)"
- `t-shirt` / `none` : "throughput-weighted : désactivé (méthode : t-shirt)"

### Exemples de config complets avec résultat attendu

```yaml
# time → active, somme les secondes → j-h
metrics:
  estimation:
    method: "time"
# throughput-weighted : "3.5 j-h/semaine"

# story-points → active, somme story_points → SP
metrics:
  estimation:
    method: "story-points"
# throughput-weighted : "45.0 SP/semaine"

# complexity/fibonacci → active, somme story_points → pts
metrics:
  estimation:
    method: "numeric"
    jiraField: "customfield_10099"
    bucketThresholds: { xs: 2, s: 5, m: 10, l: 20 }
# throughput-weighted : "32.0 pts/semaine"

# t-shirt → désactivé
metrics:
  estimation:
    method: "t-shirt"
    jiraField: "customfield_10200"
# throughput-weighted : désactivé

# none → désactivé
metrics:
  estimation:
    method: "none"
# throughput-weighted : désactivé
```

### `board.example.yaml`

Ajouter un bloc commenté documentant la section `metrics.estimation` avec les 5 méthodes, leurs options, et les comportements dérivés automatiquement (pas de weightField).

## Cas limites

- `story_points = NULL` pour certaines issues en `story-points`/`numeric` → comptées en `unestimatedCount`, non incluses dans la somme
- Toutes issues non estimées → `avgPerWeek = 0`, `estimatedCount = 0`, métrique affichée mais vide

## Ce qui ne change pas

- `byWeek` shape : compatible avec `snapshots/compute.ts` (vérification `"byWeek" in result`)
- Métriques by-size (039b) : indépendantes
- Rapport (039d) : adapte l'affichage, pas la logique
