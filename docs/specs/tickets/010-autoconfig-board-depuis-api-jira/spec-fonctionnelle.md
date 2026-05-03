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
# Vérifier devStart: true — positionné sur la première colonne intermédiaire par défaut
# Les colonnes intermédiaires sont toutes en type: active — changer en "queue" pour les colonnes d'attente (ex: review)
# Ajouter legacyDoneStatuses si des statuts historiques n'apparaissent plus dans l'API

board:
  columns:
    - name: "À faire"
      type: todo
      statuses:
        - "To Do"

    - name: "Développement"
      type: active
      devStart: true   # ← première colonne intermédiaire — vérifier si correct
      statuses:
        - "In Progress"

    - name: "Code Review"
      type: active   # ← changer en "queue" si c'est un temps d'attente
      statuses:
        - "In Review"

    - name: "Terminé"
      type: done
      statuses:
        - "Done"
```

### Inférence des types de colonnes

L'inférence repose sur la **position** dans le board, qui est une convention universelle dans Jira :

| Position | Type inféré | Justification |
|---|---|---|
| Première colonne | `todo` | Toujours le point d'entrée du board |
| Dernière colonne | `done` | Toujours la sortie (delivery) |
| Colonnes intermédiaires | `active` par défaut | `active` vs `queue` indéterminable automatiquement |

`statusCategory` est utilisé uniquement comme **signal de confirmation** : si une colonne intermédiaire contient des statuts dont la `statusCategory.key='done'`, un commentaire d'avertissement est ajouté à la ligne `type:` dans la sortie.

`devStart: true` est positionné sur la première colonne intermédiaire (index 1).

### Comportement avec --apply

- Avertissement explicite avant modification : `⚠ --apply va écraser board.columns dans ./config.yaml. Attente 3s…`
- Attend 3 secondes puis procède (non-interactif, pour usage en script)
- Copie le fichier existant vers `config.yaml.bak` avant toute modification
- Recharge le fichier YAML existant, remplace uniquement la clé `board.columns`, réécrit le fichier
- Les autres sections (`jira`, `metrics`, `db`) sont préservées

## Cas limites

- **Board avec 1 seule colonne** → type: `todo` (première = dernière) ; avertissement : `⚠ Board à une seule colonne — configuration probablement incomplète`
- **Board avec 2 colonnes** → première `todo`, dernière `done`, aucune colonne intermédiaire ; `devStart: true` absent + avertissement
- **Colonne sans statuts** → incluse avec `statuses: []` et commentaire `# aucun statut associé`
- **Statut ID inconnu** (absent de `/rest/api/2/status`) → inclus sous son ID brut avec commentaire `# statut ID non résolu`
- **Colonne intermédiaire avec statuts de catégorie "done"** → type reste `active` mais commentaire ajouté : `# ⚠ statuts classés "done" par Jira — vérifier si cette colonne devrait être type: done`
- **Board vide** (aucune colonne) → erreur et exit 1
- **config.yaml introuvable** → erreur et exit 1

## Ce qui ne change pas

- Le comportement des commandes existantes (`sync`, `metrics`, `snapshots`, `report`, `validate-config`)
- Le schéma de `config.yaml` — aucun nouveau champ introduit
- La base de données — aucune lecture ni écriture DB dans cette commande
- La section `metrics.cutoffDate` et `metrics.bugIssueTypes` — non touchées par `--apply`
