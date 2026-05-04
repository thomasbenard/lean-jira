# Spec fonctionnelle — Role column config

## Contexte

`board.yaml` décrit les colonnes du board Kanban avec `type` (todo/active/queue/done) et
`devStart`. Aucun moyen aujourd'hui d'indiquer quel rôle (dev, qa, po) opère dans une
colonne. Cette information est nécessaire pour les métriques Stage Time Breakdown, Handoff
Detection, WIP par rôle, Stage Throughput Gap et First-Time-Right Rate (tickets 021–025).

## Comportement attendu

### Propriété `role` sur les colonnes

Chaque colonne de `board.yaml` peut porter un champ optionnel `role` avec l'une des valeurs
`dev`, `qa`, ou `po`. Exemples :

```yaml
- name: "En développement"
  type: active
  devStart: true
  role: dev
  statuses: [...]

- name: "File QA"
  type: queue
  role: qa
  statuses: [...]

- name: "En test"
  type: active
  role: qa
  statuses: [...]

- name: "Validation PO"
  type: queue
  role: po
  statuses: [...]
```

### Groupes dérivés exposés par `deriveStatusConfig()`

`deriveStatusConfig()` calcule et expose trois nouveaux groupes :

- `devStatuses` — union des statuts (+ legacyStatuses) des colonnes `role: dev`
- `qaStatuses` — union des statuts (+ legacyStatuses) des colonnes `role: qa`
- `poStatuses` — union des statuts (+ legacyStatuses) des colonnes `role: po`

Ces groupes obéissent aux mêmes règles que les groupes existants : déduplication via
`unique()`, inclusion des `legacyStatuses` de chaque colonne.

### Métriques existantes non impactées

Aucune des métriques actuelles (`lead-time`, `cycle-time`, `throughput`, `wip`,
`flow-efficiency`, `aging-wip`, `forecast`, `dev-time-allocation`, `bug-backlog`) ne
consomme les nouveaux groupes. Le champ est ignoré silencieusement si absent.

### Commande `autoconfig`

`autoconfig --apply` préserve `role` des colonnes existantes lors du merge (comme il
préserve `type`, `devStart`, `legacyStatuses`). Les nouvelles colonnes inférées n'ont
pas de `role` — l'utilisateur l'ajoute manuellement.

## Cas limites

- Colonne sans `role` → non incluse dans `devStatuses` / `qaStatuses` / `poStatuses`
- Aucune colonne avec `role` → les trois groupes sont vides (`[]`)
- Colonne `type: done` avec `role: po` → incluse dans `poStatuses` (cas KECK : "À valider")
- Valeur `role` inconnue → TypeScript la rejette à la compilation (union type strict)
- Plusieurs colonnes avec `role: qa` → leurs statuts sont unionnés dans `qaStatuses`

## Ce qui ne change pas

- Structure existante de `BoardColumn` (`name`, `type`, `devStart`, `statuses`, `legacyStatuses`)
- `MetricConfig` dans `src/metrics/types.ts` — inchangé dans ce ticket
- Toutes les métriques actuelles et leurs calculs
- Comportement de `renderBoardColumnsYaml()` — `role` non émis par autoconfig (ajout manuel)
- `board.legacyDoneStatuses` et son traitement
