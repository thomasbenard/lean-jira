# Spec fonctionnelle — Dev time allocation (features vs bugs)

## Contexte

Le report actuel affiche le bug throughput (count) et le bug cycle time, mais pas la proportion
de *temps* consommée par les bugs. Un lead peut voir "4 bugs livrés cette semaine" sans savoir
si ces 4 bugs ont coûté 2 jours ou 20 jours d'effort d'équipe. La métrique `dev-time-allocation`
répond à la question : "quelle fraction du temps de dev de l'équipe part dans les bugs ?"

## Comportement attendu

### Calcul de base

Pour chaque issue livrée dans la fenêtre temporelle :
- Cycle time = jours ouvrés depuis la 1ère transition vers `devStartStatuses` jusqu'à `done_at`
- Si l'issue n'a pas de transition `devStartStatuses` → exclue (même règle que `cycle-time`)
- Si l'issue n'a pas de transition `todoStatuses` → exclue (population consistante avec `cycle-time`)
- Attribution : `issue_type IN config.bugIssueTypes` → bug, sinon → feature

### Agrégation par semaine

Groupement par semaine ISO de `done_at` (strftime `%Y-W%W`) :
- `featureDays` : somme des cycle times des features livrées dans la semaine
- `bugDays` : somme des cycle times des bugs livrés dans la semaine
- `bugRatio` : `bugDays / (featureDays + bugDays)`, 0 si aucun livré

### Affichage dans le report

Chart empilé barres verticales :
- Barre bleue = `featureDays`, barre rouge = `bugDays`, empilées
- Ligne (axe secondaire, %) = `bugRatio` semaine par semaine
- KPI summary visible dans le report : `bugRatio` moyen sur la période

## Cas limites

- Semaine sans aucune livraison → ligne absente du byWeek (pas de barre vide à afficher)
- Semaine sans bugs → `bugDays = 0`, `bugRatio = 0`
- Semaine sans features (que des bugs) → `featureDays = 0`, `bugRatio = 1.0`
- Issue sans estimation : n'affecte pas ce metric (on utilise le cycle time réel, pas l'estimation)
- Issue sans transition `devStartStatuses` : exclue silencieusement (cohérent avec `cycle-time`)
- `config.bugIssueTypes` vide : tous les tickets comptent comme features, `bugDays = 0` toujours

## Ce qui ne change pas

- Aucune modification du schéma DB
- Aucun changement aux métriques existantes (`cycle-time`, `bug-cycle-time`, `throughput`)
- La définition de "livraison" reste `done_at` via `buildDeliveredCte`
- Les durées restent en jours ouvrés (`workingDaysBetween`)
