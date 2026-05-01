# Spec fonctionnelle — Autoconfiguration du board depuis l'API Jira

## Contexte

Configurer `board.columns` dans `config.yaml` est la partie la plus fastidieuse de l'onboarding : l'utilisateur doit ouvrir Jira, noter les noms exacts de chaque statut, les saisir manuellement, et relancer `validate-config` pour détecter les typos. L'API Jira Agile expose déjà la structure complète du board (`/rest/agile/1.0/board/{boardId}/configuration`). Cette commande l'exploite pour générer une première version correcte automatiquement.

## Comportement attendu

### Commande

```
lean-jira autoconfig [options]
  -c, --config <path>   Chemin vers config.yaml (défaut: ./config.yaml)
  --apply               Écrase board.columns dans config.yaml (destructif)
```

### Sortie stdout (sans --apply)

La commande imprime le YAML de la section `board.columns` prête à coller dans `config.yaml`, précédée d'un en-tête informatif :

```
# Board "KECK" — colonnes détectées automatiquement depuis l'API Jira
# Vérifier devStart: true — positionné sur la première colonne active par défaut
# Ajouter legacyDoneStatuses si des statuts historiques n'apparaissent plus dans l'API

board:
  columns:
    - name: "À faire"
      type: todo
      statuses:
        - "To Do"

    - name: "Développement"
      type: active
      devStart: true
      statuses:
        - "In Progress"
    ...
```

### Comportement avec --apply

- Avertissement explicite avant modification : `⚠ --apply va écraser board.columns dans ./config.yaml. Continuer ? (Ctrl-C pour annuler)`
- Attend 3 secondes puis procède (non-interactif, pour usage en script)
- Recharge le fichier YAML existant, remplace uniquement la clé `board`, réécrit le fichier
- Les autres sections (`jira`, `metrics`, `db`) sont préservées

### Inférence des types de colonnes

| Catégories dominantes dans les statuts de la colonne | Type inféré |
|---|---|
| Tous `new` | `todo` |
| Tous `done` | `done` |
| Mixte ou `indeterminate` | `active` |

La première colonne de type `active` reçoit `devStart: true`.

Si aucune colonne `active` n'est détectée, `devStart: true` n'est positionné sur aucune colonne et un avertissement est affiché.

## Cas limites

- **Board vide** (aucune colonne) → affiche un avertissement et sort sans générer de config
- **Colonne sans statuts** → incluse avec `statuses: []` et un commentaire `# aucun statut associé`
- **Statut ID inconnu** (absent de `/rest/api/2/status`) → inclus sous son ID brut avec commentaire `# statut ID non résolu`
- **Aucune colonne `active`** → `devStart: true` absent de la sortie, avertissement affiché : `⚠ Aucune colonne active détectée — positionner devStart: true manuellement`
- **Plusieurs colonnes toutes `active`** → `devStart: true` sur la première seulement
- **config.yaml introuvable** → erreur et exit 1

## Ce qui ne change pas

- Le comportement des commandes existantes (`sync`, `metrics`, `snapshots`, `report`, `validate-config`)
- Le schéma de `config.yaml` — aucun nouveau champ introduit
- La base de données — aucune lecture ni écriture DB dans cette commande
- La section `metrics.cutoffDate` et `metrics.bugIssueTypes` — non touchées par `--apply`
