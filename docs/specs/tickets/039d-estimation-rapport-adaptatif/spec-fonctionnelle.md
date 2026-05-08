# Spec fonctionnelle — Rapport adaptatif selon méthode d'estimation

## Contexte

Le rapport affiche 5 sections estimation-dépendantes. Pour no-estimate et t-shirt, certaines sont vides ou trompeuses. Pour story-points/numeric, les labels sont incorrects ("j-h" au lieu de "SP").

**Note de positionnement produit :** les métriques normalisées (`lead-time-normalized`, `cycle-time-normalized`) montrent le ratio réel/estimé. Pour les équipes story-points, ce ratio est un levier d'influence vers le flow : si médiane = 3×, les estimations n'ont pas de valeur prédictive. Ces métriques ne sont donc **pas masquées pour story-points** — elles sont affichées avec un message contextuel.

## Comportement attendu

### Règles de visibilité

| Section | `time` | `story-points` | `numeric` | `t-shirt` | `none` |
|---|---|---|---|---|---|
| Throughput pondéré | ✓ "j-h" | ✓ "SP" | ✓ "pts" | masquée | masquée |
| Lead normalisé | ✓ + message | masquée | masquée | masquée | masquée |
| Cycle normalisé | ✓ + message | masquée | masquée | masquée | masquée |
| Lead by-size | ✓ | ✓ labels SP | ✓ labels pts | ✓ labels XS/S | masquée |
| Cycle by-size | ✓ | ✓ labels SP | ✓ labels pts | ✓ labels XS/S | masquée |

> **Risque 3** : les métriques normalisées retournent `disabled: true` hors mode `time` (039b). Le rapport les masque en conséquence pour toutes les méthodes sauf `time`. Le message d'influence no-estimate ("ratio élevé = estimations sans valeur prédictive") s'affiche uniquement pour `time` — là où les données sont présentes. Pour les équipes story-points/numeric, l'influence passe par les métriques flow directes (lead-time, cycle-time, forecast).

### Bandeau de contexte (haut de rapport)

```
time      → "Estimation : temps (j-h)"
story-points → "Estimation : story points (SP) — seuils XS<1 S<3 M<8 L<13"
numeric   → "Estimation : champ custom (pts)"
t-shirt   → "Estimation : taille de t-shirt"
none      → "Estimation : aucune — métriques by-size désactivées"
```

### Exemples complets

```yaml
# Config → comportement rapport

method: "time"
# → toutes sections visibles, labels "j-h", pas de message contextuel

method: "story-points"
# → by-size visible labels "XS (<1 SP)", throughput "SP/sem",
#   normalisés visibles + message "ratio basé sur estimations"

method: "numeric"
# → by-size visible labels "XS (<2)", throughput "pts/sem",
#   normalisés visibles + message

method: "t-shirt"
# → by-size visible labels "XS/S/M/L/XL", throughput masquée,
#   normalisés masqués (pas de valeur numérique à diviser)

method: "none"
# → by-size masquée, throughput masquée, normalisés masqués
#   bandeau : "Estimation : aucune — métriques by-size désactivées"
```

### Sections masquées

`display: none` sur la `div.chart-card`. Le canvas JS n'est pas initialisé (vérification `getElementById` avant init).

## Cas limites

- `estimation` absent → `method: "time"` implicite, rapport inchangé
- story-points mais toutes issues UNESTIMATED → by-size visible mais vide (même comportement qu'actuellement)
- `numeric` sans label d'unité custom : afficher "pts" générique

## Ce qui ne change pas

- Données `metric_snapshots` : inchangées
- Métriques non estimation-dépendantes (lead-time, cycle-time bruts, throughput, WIP, flow, aging, forecast) : toujours affichées
