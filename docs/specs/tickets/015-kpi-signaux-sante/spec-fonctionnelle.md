# Spec fonctionnelle — KPIs : signaux de santé statiques

## Contexte

Les KPIs du rapport affichent des chiffres bruts sans indication de leur qualité. Un lead
technique doit mentalement comparer la valeur courante à son expérience passée pour savoir
si c'est "bon" ou "mauvais". Les seuils varient d'une équipe à l'autre, donc une solution
configurable est nécessaire.

## Comportement attendu

### Signal par KPI

Chaque card KPI affiche un point coloré (●) avant la valeur :

| Signal | Couleur | Sens |
|---|---|---|
| Vert | `#10b981` | Valeur dans la zone saine |
| Orange | `#f59e0b` | Valeur à surveiller |
| Rouge | `#ef4444` | Valeur dégradée — action requise |
| Aucun | (absent) | Seuil non configuré pour ce KPI |

### KPIs concernés et directionnel

| KPI | Directionnel | Seuil `warn` | Seuil `crit` |
|---|---|---|---|
| Lead time médian | Plus bas = mieux | orange si > warn | rouge si > crit |
| Cycle time médian | Plus bas = mieux | orange si > warn | rouge si > crit |
| Throughput 7j | Plus haut = mieux | orange si < warn | rouge si < crit |
| WIP | Plus bas = mieux | orange si > warn | rouge si > crit |
| Bug cycle time médian | Plus bas = mieux | orange si > warn | rouge si > crit |
| Bug ratio | Plus bas = mieux | orange si > warn | rouge si > crit |
| Flow efficiency | (pas de seuil dans ce ticket) | — | — |

### Configuration (`config.yaml`)

```yaml
metrics:
  healthThresholds:
    leadTimeMedianDays:    { warn: 5,    crit: 10   }
    cycleTimeMedianDays:   { warn: 3,    crit: 7    }
    throughputWeekly:      { warn: 3,    crit: 1    }  # higher=better : orange si <warn
    wipCount:              { warn: 5,    crit: 8    }
    bugCycleTimeMedianDays: { warn: 3,   crit: 7    }
    bugRatio:              { warn: 0.20, crit: 0.40 }
```

Toutes les clés sont optionnelles. Si `healthThresholds` est absent → aucun signal.
Si une clé spécifique est absente → pas de signal pour ce KPI uniquement.

### Rendu HTML

Le point coloré est un `<span class="health-dot health-green">●</span>` (ou `orange` /
`red`) inséré avant la valeur dans la card KPI. Si `none`, le span est absent.

## Cas limites

- `warn` et `crit` identiques → comportement normal (zone orange vide, vert ou rouge direct)
- Valeur KPI `null` (pas de snapshot) → aucun signal, même si seuil configuré
- `crit < warn` pour une métrique "lower-is-better" → signal toujours rouge si > warn
  (cas config erroné, pas d'erreur levée — dégradé silencieux)
- `healthThresholds` absent de config → `generateReport()` reçoit `undefined`, aucun signal

## Ce qui ne change pas

- Logique de calcul des métriques inchangée
- `MetricConfig` inchangé (les seuils ne sont pas des paramètres métriques)
- KPI "Flow efficiency" et "Throughput pondéré" sans signal dans ce ticket
- Aucune nouvelle colonne en DB
