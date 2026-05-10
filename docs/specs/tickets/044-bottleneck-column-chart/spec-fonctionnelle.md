# Spec fonctionnelle — Bottleneck column chart

## Contexte

Le panel Bottleneck Analysis (ticket 037/043) identifie le rôle goulot (dev/qa/po) et sa colonne dominante. Mais il n'affiche pas la distribution complète des temps par colonne au sein de chaque rôle. Un lead technique veut savoir non seulement "dev est le bottleneck" mais "dans dev, In Progress prend 5j pour 20 tickets, Code Review prend 1j pour 20 tickets".

## Comportement attendu

### Zone d'affichage

Un nouveau panel HTML dans l'onglet Rôles, immédiatement après le panel "Bottleneck Analysis" existant, intitulé **"Drill-down par colonne"**.

### Contenu du panel

Pour chaque colonne Jira appartenant à un rôle (dans l'ordre : dev puis qa puis po, et au sein de chaque rôle par médiane décroissante) :

- Une barre horizontale dont **la longueur est proportionnelle à la médiane de jours** (normalisée sur le max global toutes colonnes confondues)
- Un **label** à gauche : nom du statut Jira + tag rôle (ex. `In Progress DEV`)
- La **valeur médiane** à droite de la barre : `5.0j`
- Le **nombre d'issues** ayant traversé la colonne, affiché en annotation après la valeur : `(20 tickets)`
- **Couleur de la barre** selon le rôle : dev → `var(--violet)`, qa → `var(--green)`, po → `var(--orange)`

### État vide

Si `byColumn` est vide (count = 0 ou aucun rôle configuré) → ne pas afficher le panel du tout (identique au comportement de `buildBottleneckPanelHtml` quand `b.count === 0`).

## Cas limites

- Une seule colonne au total → barre à 100% de largeur
- Deux colonnes de même médiane → même longueur de barre, tri par nom alphabétique dans le groupe
- Colonne avec médiane = 0 (toutes transitions instantanées) → barre absente ou de largeur minimale (1px), valeur `0.0j` affichée
- Rôle non configuré (poStatuses = []) → ses colonnes sont absentes de `byColumn`
- `count = 0` (aucune issue livrée) → panel non rendu

## Ce qui ne change pas

- Le panel "Bottleneck Analysis" existant (barres par rôle) n'est pas modifié
- Aucun snapshot ni persistance — données calculées live depuis `bottleneckAnalysisMetric.compute()`
- Aucune nouvelle métrique enregistrée dans `ALL_METRICS`
- Le tri au sein d'un rôle est par médiane décroissante (colonnes les plus lentes en premier), pas par count
