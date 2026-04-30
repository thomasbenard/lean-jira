# Spec technique — Onboarding : config example + validate-config

## Impact fichiers

| Fichier | Modification |
|---|---|
| `config.example.yaml` | Nouveau fichier à la racine |
| `src/main.ts` | Nouvelle commande `validate-config` |
| `package.json` | Nouveau script `validate` |

---

## 1. `config.example.yaml`

```yaml
# lean-jira — configuration exemple
# Copier en config.yaml et adapter les valeurs.
# Lancer `npm run validate` après le premier sync pour vérifier les noms de statuts.

jira:
  # URL de base de votre instance Atlassian Cloud (sans slash final)
  # Exemple : https://your-domain.atlassian.net
  baseUrl: https://your-domain.atlassian.net

  # Email du compte Jira utilisé pour l'API
  email: you@example.com

  # Token API Jira : https://id.atlassian.com/manage-profile/security/api-tokens
  apiToken: your_api_token_here

  # Clé du projet Jira (ex : KECK, PROJ, DEV)
  projectKey: PROJ

  # ID du board Kanban/Scrum (visible dans l'URL du board : /jira/software/boards/123)
  boardId: 123

  # Statuts représentant "en attente de démarrage" (début du lead time)
  # Utiliser les noms exacts tels qu'ils apparaissent dans Jira.
  todoStatuses:
    - À faire
    - Backlog

  # Statuts représentant le début du développement actif (début du cycle time)
  devStartStatuses:
    - En cours
    - Développement en cours

  # Tous les statuts "en cours de traitement" (WIP)
  # Les statuts dont la catégorie Jira = 'done' sont automatiquement exclus au runtime.
  inProgressStatuses:
    - En cours
    - En revue
    - QA en cours
    - En attente de déploiement

  # Statuts considérés comme livrés (fallback pour les anciens statuts renommés)
  # Les statuts de catégorie 'done' depuis l'API Jira sont automatiquement inclus.
  doneStatuses:
    - Livré
    - Done
    - To Be Validated  # ancien nom, peut ne plus apparaître dans l'API

  # (Optionnel) Sous-ensemble de inProgressStatuses = temps de travail actif
  # Utilisé pour le calcul de flow-efficiency. Omettre si flow-efficiency non souhaité.
  activeStatuses:
    - En cours
    - Développement en cours
    - QA en cours

  # (Optionnel) Sous-ensemble de inProgressStatuses = temps d'attente (queue)
  # Utilisé pour le calcul de flow-efficiency.
  queueStatuses:
    - En revue
    - En attente de déploiement

metrics:
  # Date limite inférieure pour le calcul des métriques (format YYYY-MM-DD)
  # Les issues livrées avant cette date sont ignorées.
  # Recommandation : choisir une date après toute période de bruit (migrations, bulk-close).
  cutoffDate: "2024-01-01"

  # Types d'issues considérés comme des bugs (routés vers le bucket BUG)
  # Exclus des métriques normalisées et pondérées.
  bugIssueTypes:
    - Bug
    - Incident

db:
  # Chemin vers le fichier SQLite (créé automatiquement par `npm run sync`)
  path: ./jira.db
```

---

## 2. `src/main.ts` — commande `validate-config`

### Import

```typescript
import { getDoneStatusNames } from "./db/store";
```

`getDoneStatusNames` est déjà importé. Ajouter une nouvelle fonction dans `store.ts` :

```typescript
// src/db/store.ts
export function getAllStatuses(db: Database.Database): Array<{ name: string; categoryKey: string }> {
  return db.prepare("SELECT name, category_key as categoryKey FROM statuses ORDER BY name").all() as Array<{ name: string; categoryKey: string }>;
}
```

### Commande dans `main.ts`

```typescript
program
  .command("validate-config")
  .description("Vérifie que les statuts du config existent dans la base (après un sync)")
  .option("-c, --config <path>", "Chemin vers config.yaml", "./config.yaml")
  .action((opts) => {
    const config = loadConfig(path.resolve(opts.config));
    const db = openDb(config.db.path);

    const dbStatuses = getAllStatuses(db);
    if (dbStatuses.length === 0) {
      console.error("Base vide. Lancer `npm run sync` d'abord.");
      process.exit(1);
    }

    const dbNames = new Set(dbStatuses.map((s) => s.name));
    const doneStatuses = new Set(config.jira.doneStatuses ?? []);

    const sections: Array<{ label: string; statuses: string[] | undefined }> = [
      { label: "todoStatuses",        statuses: config.jira.todoStatuses },
      { label: "devStartStatuses",    statuses: config.jira.devStartStatuses },
      { label: "inProgressStatuses",  statuses: config.jira.inProgressStatuses },
      { label: "doneStatuses",        statuses: config.jira.doneStatuses },
      { label: "activeStatuses",      statuses: config.jira.activeStatuses },
      { label: "queueStatuses",       statuses: config.jira.queueStatuses },
    ];

    let totalMissing = 0;

    for (const { label, statuses } of sections) {
      if (!statuses || statuses.length === 0) continue;
      console.log(`\n${label}`);
      for (const s of statuses) {
        const found = dbNames.has(s);
        const isLegacy = !found && label === "doneStatuses";
        if (found) {
          console.log(`  ✓ ${s}`);
        } else if (isLegacy) {
          console.log(`  ✗ ${s}  ← introuvable en base (statut legacy — accepté pour l'historique)`);
        } else {
          console.log(`  ✗ ${s}  ← introuvable en base`);
          totalMissing++;
        }
      }
    }

    if (totalMissing > 0) {
      console.log("\nStatuts disponibles en base :");
      for (const s of dbStatuses) {
        console.log(`  ${s.name.padEnd(30)} (${s.categoryKey})`);
      }
      console.log(`\n${totalMissing} statut(s) introuvable(s). Vérifier config.yaml.`);
      process.exit(1);
    } else {
      console.log("\n✓ Config valide.");
    }
  });
```

### `package.json` — script `validate`

```json
{
  "scripts": {
    "validate": "ts-node src/main.ts validate-config"
  }
}
```

---

## Ordre d'implémentation

1. Créer `config.example.yaml` à la racine
2. Ajouter `getAllStatuses` dans `src/db/store.ts`
3. Ajouter la commande `validate-config` dans `src/main.ts`
4. Ajouter le script `validate` dans `package.json`
