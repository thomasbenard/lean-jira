# lean-jira

CLI TypeScript qui pull les données Jira vers SQLite et calcule des métriques Lean (lead time, cycle time, throughput, WIP, flow efficiency…) avec génération de rapport HTML.

## Prérequis

- Node.js ≥ 18
- Un token API Jira (Atlassian Cloud ou Server)

## Installation

```bash
npm install
```

## Configuration

### 1. Credentials Jira (`config.yaml`)

```bash
cp config.example.yaml config.yaml
```

Éditer `config.yaml` :

```yaml
jira:
  baseUrl: "https://jira.your-company.com"
  email: "your.email@company.com"
  apiToken: "YOUR_API_TOKEN"   # https://id.atlassian.com/manage-profile/security/api-tokens
  projectKey: "YOUR_PROJECT_KEY"
  boardId: 1                   # ID numérique du board Jira

db:
  path: "./lean-jira.db"
```

> **Atlassian Cloud avec domaine custom** : si Basic auth est bloqué, utiliser le gateway Atlassian :
> `baseUrl: "https://api.atlassian.com/ex/jira/<cloudId>/"` — récupérer `cloudId` via `GET https://<your-domain>/_edge/tenant_info`

`config.yaml` est gitignored — ne jamais commiter ce fichier.

### 2. Board (`board.yaml`)

```bash
cp board.example.yaml board.yaml
```

Ou laisser `autoconfig` le générer automatiquement (voir ci-dessous).

`board.yaml` décrit les colonnes du board avec leur type (`todo` | `active` | `queue` | `done`) et les statuts Jira correspondants. C'est ce fichier qui pilote toutes les métriques.

### 3. Git hooks

```bash
git config core.hooksPath .githooks
```

Active le pre-commit hook qui lance les tests avant chaque commit.

## Utilisation

```bash
npm run sync          # Pull Jira → SQLite (incrémental si déjà synchronisé)
npm run metrics       # Calcule et affiche toutes les métriques
npm run snapshots     # Backfill des snapshots hebdomadaires (requis avant report)
npm run report        # Génère report.html
npm run refresh       # Enchaîne sync → snapshots → report
```

### Options utiles

```bash
npm run metrics -- -m lead-time          # Une seule métrique
npm run metrics -- --json                # Sortie JSON
npm run metrics -- --include-outliers    # Inclut les outliers
npm run metrics -- -b ./board.yaml       # Board config custom
npm run report  -- -o ./output.html      # Fichier de sortie custom
```

### Autoconfig

Génère `board.yaml` automatiquement depuis les données Jira :

```bash
npm run autoconfig                  # Preview (dry run)
npm run autoconfig -- --apply       # Écrit board.yaml (backup → board.yaml.bak)
```

## Développement

```bash
npm test              # Lance les tests (vitest)
npm run test:watch    # Mode watch
npm run build         # Compile TypeScript → dist/
```
