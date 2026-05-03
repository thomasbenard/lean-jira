# Spec fonctionnelle — Split config : séparation credentials Jira / config board

## Contexte

Actuellement, `config.yaml` contient à la fois les credentials Jira (`apiToken`, `email`) et
la configuration du board (`board.columns`, `metrics.*`). Ces deux catégories ont des cycles
de vie différents : les credentials sont des secrets personnels (gitignored), tandis que la
config board est un artefact d'équipe versionnable. Mélanger les deux dans un seul fichier
empêche de commiter la config board.

## Comportement attendu

### Fichier `config.yaml` (secrets, gitignored)

Contient uniquement :
```yaml
jira:
  baseUrl: ...
  email: ...
  apiToken: ...
  projectKey: ...
  boardId: ...
db:
  path: ./lean-jira.db
```

### Fichier `board.yaml` (commitable)

Contient uniquement :
```yaml
board:
  columns: [...]
  legacyDoneStatuses: [...]  # optionnel
metrics:
  cutoffDate: "..."           # optionnel
  bugIssueTypes:
    - Bug
```

### Flag `--board-config` / `-b`

Les commandes `metrics`, `snapshots`, `report` et `validate-config` acceptent :
```
-b, --board-config <path>   Chemin vers board.yaml  (défaut: ./board.yaml)
```

Si `board.yaml` est absent au moment d'exécuter une de ces commandes, l'outil affiche :
```
board.yaml introuvable : ./board.yaml
Lancer d'abord : npm run autoconfig -- --apply
```
puis sort avec code 1.

### Commande `sync`

Inchangée fonctionnellement. Ne charge plus que `config.yaml` (flag `-c` seul). Ne requiert
pas `board.yaml`.

### Commande `autoconfig`

Sans `--apply` : comportement identique (affiche la config générée sur stdout). Lit `config.yaml`
via `-c`. Le flag `-b` n'est pas utilisé en mode dry-run.

Avec `--apply` :
1. Lit les credentials depuis `config.yaml` (`-c`).
2. Connecte à l'API Jira, infère les colonnes.
3. Si `board.yaml` existe : crée un backup `board.yaml.bak`.
4. Écrit un nouveau `board.yaml` contenant `board.columns` (colonnes inférées) et une section
   `metrics` par défaut commentée (aide à l'affinage manuel).
5. N'écrit plus dans `config.yaml`.

### `config.example.yaml`

Mis à jour pour ne contenir que `jira.*` et `db.*`.

### `board.example.yaml` (nouveau fichier)

Ajouté à la racine du projet. Contient un exemple complet de `board.yaml` avec commentaires
explicatifs (copie de la section board+metrics de l'ancien `config.example.yaml`).

### `.gitignore`

Ajouter `board.yaml.bak` (backup créé par `--apply`). `board.yaml` reste non-gitignored.

## Cas limites

- `board.yaml` absent + commande qui en a besoin → exit 1 avec message d'aide explicite.
- `autoconfig --apply` sur projet vierge (pas de `board.yaml`) → crée `board.yaml` from scratch,
  pas de backup.
- `autoconfig --apply` sur `board.yaml` existant → backup `.bak` créé, `board.yaml` écrasé.
  La préservation du contenu existant (colonnes manuelles, `metrics.cutoffDate`) relève du
  ticket 016.
- `config.yaml` qui contient encore la section `board` (ancien format) → non détecté
  automatiquement ; l'utilisateur doit migrer manuellement.

## Ce qui ne change pas

- La logique de dérivation des statuts (`deriveStatusConfig`, `buildMetricConfig`).
- Le schéma interne de `AppConfig` en mémoire (toujours la même structure fusionnée).
- Les noms des commandes CLI et leurs flags existants.
- Le comportement fonctionnel de `sync`, `metrics`, `snapshots`, `report`.
- La commande `list-metrics` (aucun fichier de config requis).
