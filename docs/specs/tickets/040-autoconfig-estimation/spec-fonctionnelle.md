# Spec fonctionnelle — Autoconfig détection de la méthode d'estimation

## Contexte

Après les tickets 039a-039d, `board.yaml` accepte un bloc `metrics.estimation` qui pilote toutes les métriques by-size et throughput-weighted. Sans autoconfig, l'utilisateur doit inspecter manuellement son instance Jira et saisir le bloc à la main. L'API Jira Agile expose déjà la méthode d'estimation configurée sur le board — `autoconfig` peut la lire directement.

## Comportement attendu

### Détection depuis l'API Jira

L'API `/rest/agile/1.0/board/{id}/configuration` retourne :

```json
{
  "estimation": {
    "type": "field",
    "field": { "fieldId": "customfield_10016", "displayName": "Story Points" }
  }
}
```

Règles de mapping :

| `estimation.type` | `estimation.field.fieldId` | `EstimationConfig` résultant |
|---|---|---|
| `none` ou `issueCount` | — | `{ method: "none" }` |
| `field` | `timeoriginalestimate` | `{ method: "time" }` |
| `field` | `customfield_10016` | `{ method: "story-points" }` |
| `field` | autre `customfield_XXXXX` | `{ method: "numeric", jiraField: "customfield_XXXXX" }` + warning |
| absent (API ancienne) | — | `{ method: "time" }` (défaut silencieux) |

**Warning pour champ inconnu** :
```
⚠ Champ d'estimation détecté : "customfield_XXXXX" (NomDuChamp).
  Si les valeurs sont catégorielles (XS/S/M/L/XL), changer method: t-shirt dans board.yaml.
```

### Mode dry-run (sans --apply)

Le YAML de sortie inclut un bloc `metrics.estimation` :

```yaml
metrics:
  bugIssueTypes:
    - Bug
  estimation:
    method: story-points
```

### Mode --apply

Le bloc `estimation` détecté est écrit dans `board.yaml`.
Si `board.yaml` existant contient déjà `metrics.estimation`, il est **préservé** (l'utilisateur a potentiellement ajusté les seuils manuellement).

### Cas t-shirt non auto-détectable

La méthode `t-shirt` nécessite un champ Jira avec des valeurs catégorielles (XS/S/M/L/XL). L'API board config ne distingue pas catégoriel de numérique — les deux apparaissent comme `type: "field"`. Autoconfig émet donc `numeric` + warning. L'utilisateur change `method: t-shirt` si pertinent.

## Cas limites

- Champ `estimation` absent de la réponse API (vieille instance Jira) → défaut `method: "time"`, aucun warning
- `estimation.type === "issueCount"` (Jira Scrum en mode "nombre d'issues") → `method: "none"`
- Board.yaml existant avec `estimation` déjà configuré → préservé, aucun recalcul
- Mode fake : fixture `boardConfig.json` contient un `estimation` → même logique (testé)

## Ce qui ne change pas

- Commandes `sync`, `metrics`, `snapshots`, `report` : inchangées
- `JiraClientLike.fetchBoardConfiguration()` : retourne déjà la réponse complète, seul le type TypeScript change (ajout du champ optionnel `estimation`)
- Seuils de bucket (`bucketThresholds`) : jamais auto-détectés, toujours configurés manuellement
- Méthode `t-shirt` : non auto-détectable ; l'utilisateur doit corriger manuellement après autoconfig
