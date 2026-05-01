# Spec technique — Automatisation du pipeline refresh

## Impact fichiers

| Fichier | Modification |
|---|---|
| `package.json` | Ajout du script `refresh` |

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

## Note

GitHub Actions n'est pas retenu : `config.yaml` contient une configuration complexe (`board.columns`) non versionnée. Seul le script npm est livré.
