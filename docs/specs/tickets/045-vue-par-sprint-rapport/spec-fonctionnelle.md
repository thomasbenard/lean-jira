# Spec fonctionnelle — Vue par sprint dans le rapport

## Contexte

Le rapport affiche actuellement throughput, bug-throughput et throughput-weighted en vue semaines fixes (fenêtre 7j glissante, axe X = date de fin de semaine ISO). Cette granularité ne correspond pas au référentiel naturel de l'équipe qui travaille en sprints. Un lead technique veut pouvoir lire "on a livré 12 issues ce sprint" plutôt que "on a livré X issues la semaine du 04/05".

## Comportement attendu

### Toggle d'affichage

Un bouton "Semaines / Sprints" apparaît au-dessus des graphes throughput, bug-throughput et throughput-weighted. Il est absent si aucun sprint avec `start_date` et `end_date` n'est disponible en DB.

- État initial : vue **Semaines** (comportement actuel inchangé)
- Au clic sur "Sprints" : l'axe X des 3 graphes bascule vers les noms de sprint, les valeurs représentent le total livré sur la durée complète du sprint
- Au clic sur "Semaines" : retour à la vue hebdomadaire habituelle
- Le toggle est synchronisé : changer un graphe bascule les 3 simultanément

### Données par sprint

- Seuls les sprints avec `start_date` et `end_date` non nulles sont inclus
- Le sprint actif (`state = 'active'`) est inclus avec sa valeur partielle (issues livrées depuis `start_date` jusqu'à aujourd'hui), distingué visuellement (barre translucide ou hachurée dans Chart.js)
- Les sprints sont ordonnés chronologiquement par `start_date`
- Le nom du sprint (champ `name` de la table `sprints`) est l'étiquette X

### Métriques concernées

Uniquement les 3 métriques de débit :
- `throughput` → stat `count`
- `bug-throughput` → stat `count`
- `throughput-weighted` → stats `count` + `estimatedDays`

Les métriques de durée (lead time, cycle time) et WIP ne sont **pas** concernées par le toggle.

## Cas limites

- Aucun sprint en DB → toggle absent, rapport inchangé
- Sprint sans `end_date` (sprint actif) → calculé avec `windowEndDate = aujourd'hui`, libellé "(en cours)" ajouté au nom
- Sprint avec `start_date = end_date` (sprint dégénéré) → inclus, valeur probablement 0
- Aucune issue livrée dans un sprint → barre à 0, pas d'exclusion
- Sprint antérieur à `cutoffDate` → exclu (la métrique retourne 0 pour une fenêtre hors cutoff)

## Ce qui ne change pas

- `metric_snapshots` : aucune modification, aucun re-backfill nécessaire
- `snapshots/compute.ts` : inchangé
- Vue semaines : comportement actuel identique, juste masqué quand toggle sur "Sprints"
- Toutes les autres métriques du rapport
- Paramètres CLI `npm run report`
