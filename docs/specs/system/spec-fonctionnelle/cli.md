# Commandes CLI

[← Index](../spec-fonctionnelle.md)

| Commande | Description |
|---|---|
| `npm run sync` | Pull Jira → SQLite (issues + transitions + sprints) |
| `npm run metrics` | Calcule et affiche toutes les métriques |
| `npm run snapshots` | Recalcule l'historique hebdomadaire (`metric_snapshots`) |
| `npm run report` | Génère un rapport HTML autonome avec charts de tendances |
| `npm run refresh` | Enchaîne sync → snapshots → report (arrêt sur erreur) |
| `npm run validate` | Vérifie que les statuts du config existent en base (après un sync) |
| `npm run autoconfig` | Génère `board.columns` depuis l'API Jira. Colonnes intermédiaires inférées `queue` si le nom contient un mot-clé connu (review, validation, valider, attente, wait, waiting, approval, approuver, staging, qa), sinon `active`. Commentaire YAML inline indique le mot-clé déclencheur pour les colonnes `queue` inférées. Si `board.columns` existe déjà : fusionne (préserve `type`/`devStart`/`legacyStatuses`, met à jour `statuses`). Avec `--apply` : écrit dans `board.yaml` + backup `.bak`. Détecte les statuts legacy depuis l'historique DB. Warnings et commentaire YAML des statuts non classés affichés en fin de sortie. |
| `npm run build` | Compile TypeScript → `./dist` |
| `npm start` | Lance le build compilé |

## Options `metrics`

| Option | Description |
|---|---|
| `-c, --config <path>` | Chemin config YAML (défaut : `./config.yaml`) |
| `-m, --metric <name>` | Métrique unique à exécuter |
| `--json` | Sortie JSON brut |
| `--include-outliers` | Ne pas filtrer les outliers extrêmes |

## Options `report`

| Option | Description |
|---|---|
| `-c, --config <path>` | Chemin config YAML (défaut : `./config.yaml`) |
| `-b, --board-config <path>` | Chemin board YAML (défaut : `./board.yaml`) |
| `-o, --output <path>` | Fichier HTML de sortie (défaut : `./report.html`) |

## Options `refresh`

| Option | Description |
|---|---|
| `-c, --config <path>` | Chemin config YAML (défaut : `./config.yaml`) |
| `-b, --board-config <path>` | Chemin board YAML (défaut : `./board.yaml`) |
| `-o, --output <path>` | Fichier HTML de sortie (défaut : `./report.html`) |

Permet de générer des rapports distincts pour plusieurs squads en parallèle :
```bash
npm run refresh -- -c config.keck.yaml -b board.yaml -o report.keck.html
npm run refresh -- -c config.kepler.yaml -b board.yaml -o report.kepler.html
```
