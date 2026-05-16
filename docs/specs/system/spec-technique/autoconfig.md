# Commande `autoconfig` (`main.ts`)

[← Index](../spec-technique.md)

Génère `board.columns` depuis l'API Jira Agile par inférence de position. Usage : `npm run autoconfig` (aperçu stdout) ou `npm run autoconfig -- --apply` (écrase `config.yaml`).

## Fonctions exportées

| Fonction | Signature | Description |
|---|---|---|
| `inferBoardColumns` | `(boardConfig: JiraBoardConfig, statuses: JiraStatus[]) → InferredColumn[]` | Inférence position : première=todo, dernière=done. Colonnes intermédiaires : `queue` si le nom contient un mot-clé de `QUEUE_KEYWORDS` (review, validation, valider, attente, wait, waiting, approval, approuver, staging, qa), sinon `active`. Premier `active` → `devStart: true`. Mot-clé déclencheur stocké dans `queueKeyword` (affiché en commentaire YAML). |
| `renderBoardColumnsYaml` | `(columns: InferredColumn[]) → string` | Génère YAML avec commentaires inline, `legacyStatuses` par colonne. |
| `enrichWithLegacyStatuses` | `(columns, boardConfig, allStatuses, db) → EnrichmentResult` | Croise `transitions` DB avec l'API Jira pour détecter les statuts legacy : mute `columns[todoIdx/doneIdx].legacyStatuses` en place, retourne `{ unresolvable }`. |
| `mergeColumns` | `(existing: BoardColumn[], inferred: InferredColumn[]) → { columns: InferredColumn[]; warnings: string[] }` | Fusionne colonnes inférées avec config existante : préserve `type`, `devStart`, `role`, `legacyStatuses` par nom. Retourne warnings (nouvelles colonnes, colonnes absentes) sans side-effect. |
| `buildUnresolvableComment` | `(names: string[]) → string` | Génère un bloc de commentaires YAML listant les statuts non classifiés, prêt à copier-coller. Retourne `""` si liste vide. |

`InferredColumn extends BoardColumn { warning?: string; queueKeyword?: string }` — champs internes utilisés pour les commentaires inline YAML, non écrits dans le fichier de config.

`EnrichmentResult { unresolvable: string[] }`.

## Mode fusion (`autoconfig` avec config existante)

Si `config.board.columns` non vide : `mergeColumns(existingColumns, inferBoardColumns(...))`. Chaque colonne API est réconciliée par nom exact avec la config existante — `type`/`devStart`/`role`/`legacyStatuses` préservés, `statuses` mis à jour depuis l'API. Colonnes nouvelles (API seulement) → ajout avec warning. Colonnes orphelines (config seulement) → conservées avec warning. `board.legacyDoneStatuses` préservé tel quel dans `--apply`.

Si `config.board.columns` absent ou vide → inférence complète (comportement premier lancement).

Tous les warnings (nouvelles colonnes, colonnes absentes, statuts unresolvable, devStart manquant) sont collectés pendant le traitement et affichés en bloc à la fin de la sortie.

Si des statuts `unresolvable` existent, un bloc de commentaires YAML (`buildUnresolvableComment`) est ajouté en fin de sortie stdout et en fin du fichier écrit par `--apply`, pour faciliter le copier-coller.

**Algorithme d'enrichissement** :
1. `getDistinctTransitionStatuses(db)` → noms historiques DB.
2. Candidats = noms DB absents des colonnes courantes (`statuses` + `legacyStatuses` de chaque colonne).
3. Pour chaque candidat : si trouvé dans `allStatuses` (API) avec ID absent du board → `category='new'` → `legacyStatuses` colonne todo ; `category='done'` → `legacyStatuses` colonne done ; `category='indeterminate'` → `unresolvable`. Si absent de l'API → `unresolvable`.
4. Statuts `unresolvable` remontés à la commande pour affichage groupé en fin de sortie.

DB access conditionnel : si `config.db.path` n'existe pas, `enrichWithLegacyStatuses` n'est pas appelée.

## `src/db/store.ts` — `getDistinctTransitionStatuses`

```typescript
export function getDistinctTransitionStatuses(db: Database.Database, since?: string): string[]
// SELECT DISTINCT to_status FROM transitions [WHERE transitioned_at >= since]
```

## Backup `--apply`

Avant écriture, copie `config.yaml` → `config.yaml.bak` (gitignored). Le chemin bak est `configPath + ".bak"`.
