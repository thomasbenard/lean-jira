# Spec fonctionnelle — Courbe de tendance sur les graphes du rapport

## Contexte

Le rapport HTML affiche ~9 graphes de tendances hebdomadaires (lead time, cycle time, throughput, WIP, bugs…) et 2 graphes by-size avec sélecteur de bucket. Actuellement ces graphes montrent des séries brutes ; il n'est pas possible de distinguer visuellement une tendance haussière d'une oscillation aléatoire sans lire les valeurs point par point. Une courbe de tendance (régression linéaire) permet de lire la direction générale en un coup d'œil.

## Comportement attendu

### Graphes de tendances hebdomadaires (section "Tendances hebdomadaires")

Chaque graphe line reçoit un dataset supplémentaire "Tendance" calculé par régression linéaire OLS sur la **série principale** (premier dataset listé dans l'appel `lineChart`).

- Lead time → tendance sur `median`
- Cycle time → tendance sur `median`
- Throughput → tendance sur `count`
- Throughput pondéré → tendance sur `estimatedDays`
- WIP → tendance sur `count`
- Bugs livrés → tendance sur `count`
- Bug cycle time → tendance sur `median`
- Cycle normalisé → tendance sur `median`
- Flow efficiency → tendance sur `aggregate`

### Graphes by-size avec sélecteur de bucket

Chaque re-render de `renderChart()` (lors du changement de bucket) recalcule la tendance sur la série `median` du bucket actif.

### Style de la courbe de tendance

- Couleur : `#64748b` (gris ardoise) avec opacité `88` (semi-transparent)
- Trait pointillé (`borderDash: [6, 4]`)
- Épaisseur : `borderWidth: 1.5`
- Pas de fill (`fill: false`)
- `pointRadius: 0` (pas de points)
- `tension: 0` (droite stricte)
- Label dans la légende : `"Tendance"`

### Calcul de la tendance

Moyenne mobile sur fenêtre glissante de 4 semaines :

```
movingAvg[i] = moyenne(values[i-3], values[i-2], values[i-1], values[i])   si i ≥ 3
movingAvg[i] = null                                                          si i < 3
```

- `null` → Chart.js skipGap automatique (pas de point tracé)
- Arrondi à 2 décimales
- Fenêtre 4 = équilibre entre lissage et réactivité sur données hebdo

Pourquoi pas OLS : régression linéaire impose la linéarité sur des métriques qui évoluent par sauts (changement de process, arrivée/départ). De plus `buildSeries` remplace les absences par `0`, ce qui fausse la pente OLS vers le bas.

## Cas limites

- Série vide (`n = 0`) → `computeTrend` retourne `[]` ; dataset tendance non ajouté.
- Série d'un seul point (`n = 1`) → tendance = valeur unique ; dataset ajouté (droite horizontale triviale).
- Série constante (variance 0) → pente = 0, tendance = ligne horizontale. Correct.
- Valeurs nulles ou `0` dans la série → incluses telles quelles dans la régression (pas de filtrage).
- Graphe without data (`series.dates.length === 0`) → `lineChart` retourne déjà sans créer de chart ; aucune tendance.

## Ce qui ne change pas

- Aucune modification du schéma DB ni des snapshots.
- Aucun nouveau stat dans `metric_snapshots`.
- Aucune modification des types TypeScript (`ChartSeries`, `SnapshotRow`, etc.).
- Les graphes histogramme (cycle time distribution), scatter (aging WIP) et tableau (forecast) ne reçoivent pas de courbe de tendance.
- Le style visuel existant des datasets actuels (couleurs, tension, pointRadius) reste inchangé.
