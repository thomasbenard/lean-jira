# Spec technique — Automatisation du pipeline refresh

## Impact fichiers

| Fichier | Modification |
|---|---|
| `package.json` | Ajout du script `refresh` |
| `.github/workflows/refresh.yml` | Nouveau fichier — workflow GitHub Actions |

---

## 1. `package.json` — script `refresh`

Enchaîner les 3 commandes avec `&&` pour garantir l'arrêt sur erreur :

```json
{
  "scripts": {
    "sync":      "ts-node src/main.ts sync",
    "snapshots": "ts-node src/main.ts snapshots",
    "report":    "ts-node src/main.ts report",
    "refresh":   "npm run sync && npm run snapshots && npm run report"
  }
}
```

Pas de script shell intermédiaire : le chaînage `&&` dans npm scripts fonctionne sur Linux, macOS et Windows (cmd et PowerShell 7+).

---

## 2. `.github/workflows/refresh.yml` — GitHub Actions

Le workflow reconstruit `config.yaml` à partir de secrets GitHub pour ne pas committer de credentials.

```yaml
# Exemple crontab (hors GitHub Actions) :
# 0 7 * * 1 cd /path/to/lean-jira && npm run refresh >> /var/log/lean-jira.log 2>&1

name: Refresh lean-jira report

on:
  schedule:
    - cron: '0 7 * * 1'   # Chaque lundi à 07h00 UTC
  workflow_dispatch:        # Déclenchement manuel depuis l'UI GitHub

jobs:
  refresh:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - run: npm ci

      - name: Générer config.yaml depuis les secrets
        run: |
          cat > config.yaml << EOF
          jira:
            baseUrl: ${{ vars.JIRA_BASE_URL }}
            email: ${{ secrets.JIRA_EMAIL }}
            apiToken: ${{ secrets.JIRA_API_TOKEN }}
            projectKey: ${{ vars.JIRA_PROJECT_KEY }}
            boardId: ${{ vars.JIRA_BOARD_ID }}
            todoStatuses: ${{ vars.JIRA_TODO_STATUSES }}
            devStartStatuses: ${{ vars.JIRA_DEV_START_STATUSES }}
            inProgressStatuses: ${{ vars.JIRA_IN_PROGRESS_STATUSES }}
            doneStatuses: ${{ vars.JIRA_DONE_STATUSES }}
          metrics:
            cutoffDate: ${{ vars.METRICS_CUTOFF_DATE }}
          db:
            path: ./jira.db
          EOF

      - run: npm run refresh

      - name: Upload rapport HTML
        uses: actions/upload-artifact@v4
        with:
          name: lean-report-${{ github.run_id }}
          path: report.html
          retention-days: 30
```

**Variables GitHub à configurer :**
- Secrets : `JIRA_EMAIL`, `JIRA_API_TOKEN`
- Variables (non sensibles) : `JIRA_BASE_URL`, `JIRA_PROJECT_KEY`, `JIRA_BOARD_ID`, `JIRA_TODO_STATUSES`, `JIRA_DEV_START_STATUSES`, `JIRA_IN_PROGRESS_STATUSES`, `JIRA_DONE_STATUSES`, `METRICS_CUTOFF_DATE`

Note : les listes YAML dans les variables GitHub Actions nécessitent le format inline (`[Status A, Status B]`). Documenter ce point dans un commentaire du workflow.

---

## Ordre d'implémentation

1. Ajouter le script `refresh` dans `package.json` — tester localement
2. Créer `.github/workflows/refresh.yml` — tester via `workflow_dispatch`
