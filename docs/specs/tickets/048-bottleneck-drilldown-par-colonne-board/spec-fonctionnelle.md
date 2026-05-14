# Spec fonctionnelle — Bottleneck drill-down par colonne board

## Contexte

Le graphe "Drill-down by column" dans l'onglet Rôles affiche actuellement le temps médian
par **statut Jira individuel** (ex. "In Review", "Code Review"). Or un board.yaml peut grouper
plusieurs statuts dans une seule colonne fonctionnelle (ex. colonne "Dev" = "In Progress" +
"Code Review"). L'utilisateur voit donc des barres fragmentées qui ne correspondent pas à la
vue fonctionnelle du board.

## Comportement attendu

### Graphe drill-down

- Chaque barre représente une **colonne board.yaml** (nom défini dans `board.yaml → columns[].name`)
- Si une colonne contient plusieurs statuts Jira, leurs durées sont **agrégées** (toutes les
  observations des statuts de la colonne sont poolées avant calcul de la médiane)
- L'ordre et la couleur restent inchangés : dev → qa → po, barres triées par médiane décroissante
  au sein de chaque rôle
- Le label affiché = nom de la colonne board (ex. "Code Review"), pas le statut Jira

### `dominantColumn` dans le diagnostic

- Le champ `dominantColumn` sur chaque `RoleBottleneckScore` stocke désormais un nom de
  colonne board, pas un statut Jira
- `primaryColumn` dans `BottleneckAnalysisResult` idem

## Cas limites

- Statut Jira sans correspondance dans `statusToColumnName` (ex. statut orphelin en DB) →
  fallback : utiliser le nom du statut Jira brut (comportement actuel préservé)
- Colonne board sans statut observé dans la période → absente du graphe (comportement actuel)
- Plusieurs colonnes du même rôle avec le même nom (config invalide) → premier trouvé dans
  `board.columns` (déjà garanti par l'ordre de construction du mapping)

## Ce qui ne change pas

- Algorithme de calcul des scores `byRole` (dev/qa/po)
- Logique de ranking et de `primaryBottleneck`
- Structure `metric_snapshots` (bottleneck-analysis n'est pas snapshotté)
- Tri interne par médiane décroissante + tiebreak alphabétique
