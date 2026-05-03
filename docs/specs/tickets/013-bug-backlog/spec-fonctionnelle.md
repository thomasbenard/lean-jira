# Spec fonctionnelle — bug-backlog

## Contexte

`bug-throughput` montre combien de bugs sont fermés chaque semaine, mais ne dit pas si
l'équipe « garde la tête hors de l'eau ». Si 5 bugs sont fermés mais 8 sont ouverts dans la
même semaine, le backlog grossit. Cette métrique mesure ce solde.

## Comportement attendu

### Calcul de `openCount`

Nombre de bugs ouverts à la date de fin de fenêtre `D` :

- L'issue a `issue_type` dans `bugIssueTypes` (config)
- `created_at <= D`
- Aucune transition vers un statut done (`doneStatuses`) avec `transitioned_at <= D`

Si une transition done existe après `D` : l'issue compte quand même comme ouverte à `D`.
Si une issue est passée done puis rouverte, seule la *dernière* transition avant `D` compte.
→ Si la dernière transition avant `D` est vers un statut done : fermée. Sinon : ouverte.

### Calcul de `netFlow`, `created`, `closed`

Fenêtre `[startDate, endDate]` (7 jours) :

- `created` : bugs avec `created_at ∈ [startDate, endDate]`
- `closed` : bugs dont la **première** transition done a `transitioned_at ∈ [startDate, endDate]`
  (même logique que `bug-throughput`)
- `netFlow = closed − created`

`netFlow > 0` → backlog se réduit cette semaine.
`netFlow < 0` → backlog grossit.

### Snapshot

Métrique hebdomadaire (dans `WEEKLY_METRICS`). Pour chaque semaine snapshotée :
- `stat: "openCount"`, `value: openCount`
- `stat: "netFlow"`, `value: netFlow`
- `stat: "created"`, `value: created`
- `stat: "closed"`, `value: closed`

`bucket` = `""` (pas de segmentation par taille).

### Rapport HTML

Nouveau graphe « Bug Backlog » avec :
- Barres hebdomadaires pour `netFlow` (couleur verte si > 0, rouge si < 0)
- Courbe pour `openCount` (axe Y secondaire)
- X = semaines

## Cas limites

- Aucun `bugIssueTypes` configuré → retourner `{ openCount: 0, netFlow: 0, created: 0, closed: 0 }`
- Bug créé et fermé dans la même semaine → `created++`, `closed++`, openCount inchangé si fermé avant `D`
- Bug rouvert après avoir été fermé → dernier statut avant `D` détermine l'état
- Aucune donnée dans la fenêtre → `netFlow = 0`, `openCount` reflète les bugs historiques toujours ouverts
- `doneStatuses` vide → tous les bugs comptent comme ouverts (openCount = total bugs)

## Ce qui ne change pas

- `bug-throughput` reste inchangé : elle compte les livraisons, pas le solde
- Pas de scoping sprint (contrairement à `wip`)
- Pas de filtre sur `cutoffDate` pour `openCount` (point-in-time absolu)
- Pas de nouveaux champs en DB
