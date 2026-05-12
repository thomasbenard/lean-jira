# Spec fonctionnelle — KPIs : seuils dynamiques configurables

## Contexte

Les signaux de santé KPI (couleurs vert/orange/rouge sur les tuiles du rapport) reposent actuellement sur des seuils `warn` et `crit` définis manuellement dans `board.yaml`. Cela exige que le lead calibre ces valeurs à la main, ce qui est fastidieux au démarrage et devient obsolète si la vélocité de l'équipe évolue.

L'historique de snapshots en DB contient suffisamment de données pour dériver ces seuils automatiquement : P50 (médiane) comme seuil de confort et P85 comme seuil d'alerte.

## Comportement attendu

### Mode `static` (défaut, inchangé)

Aucun changement de comportement. Si `mode` est absent ou vaut `"static"`, les `ThresholdPair` configurés dans `board.yaml` sont utilisés comme aujourd'hui.

```yaml
metrics:
  healthThresholds:
    mode: static           # optionnel, valeur par défaut
    leadTimeMedianDays:
      warn: 10
      crit: 20
```

### Mode `dynamic`

```yaml
metrics:
  healthThresholds:
    mode: dynamic
    windowWeeks: 12        # optionnel, défaut 12
```

Les seuils sont calculés à partir des snapshots des `windowWeeks` dernières semaines :

| KPI | Direction | warn | crit |
|---|---|---|---|
| lead-time médiane | lower | P50 | P85 |
| cycle-time médiane | lower | P50 | P85 |
| bug-cycle-time médiane | lower | P50 | P85 |
| wip count | lower | P50 | P85 |
| bug ratio | lower | P50 | P85 |
| throughput / 7j | higher | P50 | P15 |

Les seuils calculés ne sont pas exposés dans le rapport (pas de tooltip ni d'affichage).

### Mode `dynamic` avec `ThresholdPair` partiels

Si `mode: dynamic` mais que certains KPIs ont quand même une `ThresholdPair` définie, les seuils statiques de ces KPIs **remplacent** les seuils dynamiques pour ces KPIs uniquement (surcharge explicite). Les autres KPIs utilisent les seuils dynamiques.

```yaml
metrics:
  healthThresholds:
    mode: dynamic
    windowWeeks: 12
    throughputWeekly:      # override : on connaît le min attendu
      warn: 3
      crit: 1
```

### Fenêtre insuffisante

Si le nombre de snapshots distincts dans la fenêtre est < 4 semaines pour un KPI donné, le signal de ce KPI est `"none"` (tuile sans couleur) — identique à l'absence de seuil en mode statique.

## Cas limites

- `mode: dynamic`, DB vide (aucun snapshot) → tous les signaux `"none"`
- `mode: dynamic`, 3 semaines de données seulement → tous les signaux `"none"` (seuil: 4 semaines min)
- `mode: dynamic`, données abondantes mais toutes identiques (variance nulle) → P50 = P85 = valeur unique ; signal : vert si value ≤ P50, rouge si value > P85 (comportement naturel, pas de cas spécial)
- `mode: static` sans aucun `ThresholdPair` → tous les signaux `"none"` (comportement actuel)
- `mode` absent → équivalent `"static"` (rétrocompatibilité)
- Valeur `mode` inconnue → warning console + fallback `"static"`

## Ce qui ne change pas

- La structure `ThresholdPair { warn, crit }` reste inchangée
- `evalLowerBetter` et `evalHigherBetter` restent inchangés
- Les snapshots ne sont pas modifiés (calcul à la volée dans `generate.ts`)
- Le template Handlebars `.hbs` n'est pas modifié (les seuils calculés ne sont pas exposés)
- Les métriques `criticalAging` et `ftrDev` gardent leur signal actuel (non concernées)
