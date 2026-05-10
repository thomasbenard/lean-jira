# lean-jira

CLI qui synchronise un board Jira Kanban, calcule des métriques de flux Lean et génère un rapport HTML interactif avec tendances temporelles.

**Cas d'usage** : équipe Agile/Kanban qui veut piloter par les données sans dépendre d'un outil BI tiers.

---

## Ce que ça produit

- **Métriques de flux** : lead time, cycle time, throughput, WIP, flow efficiency, aging WIP, forecast Monte Carlo
- **Métriques qualité** : bug cycle time, bug ratio, bug backlog, allocation dev/bugs
- **Métriques role-aware** : temps par rôle (dev/QA/PO), WIP par rôle, gaps de flux, taux de rework, first-time-right
- **Rapport HTML autonome** : graphes de tendances Chart.js, signaux de santé KPI, forecast, liens Jira cliquables — aucun serveur requis

---

## Prérequis

- Node.js 18+
- Token API Jira (Basic auth ou Atlassian Cloud via gateway)
- Accès en lecture à un projet Jira avec board Kanban

---

## Installation

```bash
git clone <repo>
cd lean-jira
npm install
```

---

## Configuration

La configuration est séparée en deux fichiers :

| Fichier | Rôle | Versionnable |
|---|---|---|
| `config.yaml` | Secrets Jira + chemin DB | Non (gitignoré) |
| `board.yaml` | Définition du board + métriques | Oui |

### 1. `config.yaml`

```bash
cp config.example.yaml config.yaml
```

```yaml
jira:
  baseUrl: "https://your-company.atlassian.net"
  email: "you@company.com"
  apiToken: "YOUR_API_TOKEN"   # Jira → Profil → Sécurité → Créer un token API
  projectKey: "PROJ"
  boardId: 42                  # Visible dans l'URL du board Jira
  name: "Ma Squad"             # Optionnel — affiché dans le titre du rapport

db:
  path: "./lean-jira.db"
```

> **Atlassian Cloud avec domaine custom** : si l'auth Basic est bloquée, utiliser le gateway Atlassian :
> ```yaml
> baseUrl: "https://api.atlassian.com/ex/jira/<cloudId>/"
> frontendUrl: "https://your-company.atlassian.net"   # obligatoire ici, sert aux liens du rapport
> ```
> Récupérer `cloudId` via `GET https://<your-domain>/_edge/tenant_info`.

### 2. `board.yaml`

**Option A — génération automatique depuis l'API Jira** (recommandée pour démarrer) :

```bash
npm run autoconfig                   # Affiche le YAML inféré sur stdout (dry-run)
npm run autoconfig -- --apply        # Écrit board.yaml (backup → board.yaml.bak si existant)
```

`autoconfig` interroge directement l'API Jira et n'a pas besoin d'un `sync` préalable. Si une base SQLite existe déjà, les statuts historiques renommés (présents dans les transitions mais absents de l'API courante) sont automatiquement ajoutés en `legacyStatuses`. Pour bénéficier de cet enrichissement sur une nouvelle install, lancer un `sync` puis relancer `autoconfig --apply`.

`autoconfig` infère le type de chaque colonne intermédiaire : `queue` si le nom contient un mot-clé connu (review, validation, QA, attente, staging, approval…), sinon `active`. Le `devStart: true` est positionné sur la première colonne `active`. La méthode d'estimation (`metrics.estimation`) est détectée depuis le champ configuré sur le board Jira : `timeoriginalestimate` → `time`, `customfield_10016` → `story-points`, champ custom inconnu → `numeric` (avec avertissement d'envisager `t-shirt`). En mode `--apply`, une estimation déjà configurée dans `board.yaml` est préservée. Toujours revoir et ajuster manuellement après génération.

**Option B — configuration manuelle** :

```bash
cp board.example.yaml board.yaml
```

```yaml
board:
  columns:
    - name: "À faire"
      type: todo              # début du lead time

    - name: "Développement"
      type: active
      devStart: true          # début du cycle time
      role: dev               # optionnel : métriques role-aware

    - name: "Review"
      type: queue             # temps d'attente (flow-efficiency)
      role: qa

    - name: "Done"
      type: done

  # Statuts renommés absents de l'API Jira courante (historique uniquement)
  # legacyDoneStatuses:
  #   - "Delivered"

metrics:
  cutoffDate: "2024-01-01"    # ignorer les issues livrées avant cette date
  bugIssueTypes:
    - "Bug"

  # Signaux de santé KPI dans le rapport (optionnel)
  # healthThresholds:
  #   leadTimeMedianDays:     { warn: 5,    crit: 10   }
  #   cycleTimeMedianDays:    { warn: 3,    crit: 7    }
  #   throughputWeekly:       { warn: 3,    crit: 1    }   # plus haut = mieux
  #   wipCount:               { warn: 5,    crit: 8    }
  #   bugCycleTimeMedianDays: { warn: 3,    crit: 7    }
  #   bugRatio:               { warn: 0.20, crit: 0.40 }

# Personnalisation du rapport HTML (optionnel)
# report:
#   title: "Équipe Plateforme"             # Remplace "Rapport Lean — {projectKey}" dans le titre et l'en-tête
#   logoUrl: "./assets/logo.png"           # Chemin local (embarqué en base64) ou URL http(s)
#   fontUrl: "https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap"  # Remplace IBM Plex
#   customCssPath: "./my-report.css"       # CSS injecté après le style défaut (priorité cascade)
#   excludeTabs:                           # Onglets à masquer : delivery, quality, roles, forecast, advanced
#     - roles
#     - forecast
#   templatePath: "./report.hbs"           # Template Handlebars custom (remplace le rendu HTML intégral)
```

#### Types de colonnes

| `type` | Rôle dans les métriques |
|---|---|
| `todo` | Début du **lead time** |
| `active` + `devStart: true` | Début du **cycle time** |
| `active` | "Touch time" pour **flow efficiency** + WIP |
| `queue` | "Queue time" pour **flow efficiency** + WIP |
| `done` | Définit la **livraison équipe** (`done_at`) |

Le champ optionnel `role: dev | qa | po` active les métriques role-aware (stage time, WIP par rôle, throughput gap, rework, first-time-right). Les colonnes sans `role` sont silencieusement ignorées par ces métriques.

---

## Utilisation

### Workflow standard

```bash
npm run sync        # Pull Jira → SQLite (issues, transitions, sprints, statuts)
npm run snapshots   # Calcule l'historique hebdomadaire (prérequis rapport)
npm run report      # Génère ./report.html
```

Ou en une commande :

```bash
npm run refresh     # sync → snapshots → report (arrêt sur erreur)
```

`refresh` accepte les mêmes options que `report`. Pour plusieurs squads avec des configs et rapports distincts :

```bash
npm run refresh -- -c config.keck.yaml    -b board.yaml -o report.keck.html
npm run refresh -- -c config.kepler.yaml  -b board.yaml -o report.kepler.html
npm run refresh -- -c config.james-webb.yaml -b board.yaml -o report.james-webb.html
```

### Commandes individuelles

```bash
# Métriques en CLI
npm run metrics                          # Toutes les métriques
npm run metrics -- -m cycle-time         # Une seule métrique
npm run metrics -- -m cycle-time --json  # Sortie JSON brute
npm run metrics -- --include-outliers    # Sans filtre Tukey
npm run metrics:raw                      # Alias de --include-outliers

# Lister les noms des métriques disponibles
npx ts-node src/main.ts list-metrics

# Rapport HTML
npm run report                           # Sortie : ./report.html
npm run report -- -o /tmp/rapport.html   # Chemin personnalisé
npm run report -- --export-template ./my-template  # Exporte le template Handlebars par défaut dans ./my-template/

# Validation de la config
npm run validate    # Vérifie que les statuts du board.yaml existent en base
```

### Options communes

| Option | Description | Disponible sur |
|---|---|---|
| `-c, --config <path>` | Chemin vers `config.yaml` (défaut : `./config.yaml`) | Toutes les commandes |
| `-b, --board-config <path>` | Chemin vers `board.yaml` (défaut : `./board.yaml`) | `metrics`, `snapshots`, `report`, `refresh`, `validate-config`, `autoconfig` |
| `-o, --output <path>` | Fichier HTML de sortie (défaut : `./report.html`) | `report`, `refresh` |
| `--export-template <dir>` | Exporte `report.hbs` + `context.schema.json` dans `<dir>` et quitte | `report` |

---

## Catalogue des métriques

| Métrique | Ce que ça mesure |
|---|---|
| `lead-time` | Entrée todo → livraison équipe |
| `cycle-time` | Début dev actif → livraison équipe |
| `lead-time-by-size` / `cycle-time-by-size` | Idem, par bucket de taille (XS/S/M/L/XL/BUG) |
| `lead-time-normalized` / `cycle-time-normalized` | Ratio réel / estimation (détecte les dérives de chiffrage) |
| `bug-cycle-time` | Cycle time des bugs uniquement |
| `throughput` | Issues livrées par semaine |
| `bug-throughput` | Bugs livrés par semaine |
| `throughput-weighted` | Jours-personnes estimés livrés par semaine |
| `wip` | WIP courant dans le sprint actif |
| `flow-efficiency` | % temps actif vs total (actif + queue) |
| `aging-wip` | Âge du WIP courant vs percentiles historiques |
| `forecast` | Monte Carlo P15/P50/P85/P95 sur 1/2/4/8 semaines |
| `dev-time-allocation` | Split cycle time features vs bugs par semaine |
| `bug-backlog` | Bugs ouverts + flux net hebdomadaire |
| `stage-time-breakdown` | Temps médian par rôle (dev/QA/PO) |
| `wip-per-role` | WIP courant par rôle |
| `stage-throughput-gap` | Flux net (entrées − sorties) par rôle par semaine |
| `handoff-rework` | % tickets avec retour arrière entre rôles |
| `first-time-right` | % tickets traversant chaque rôle en un seul passage |
| `scope-change-rate` | % issues dont description/estimation/sprint a changé après entrée en sprint (dérive de périmètre) |

**Notes** :
- Toutes les métriques de durée produisent : moyenne, médiane (P50), P85, P95
- Les outliers extrêmes sont filtrés par défaut (méthode Tukey Q3 + 1,5 × IQR) ; utiliser `--include-outliers` pour les conserver
- **Livraison = team-done** : `done_at` = première transition vers un statut dont `statusCategory.key = done` (ou listé dans `board.legacyDoneStatuses`). Le champ Jira `resolutiondate` n'est pas utilisé.
- **Durées en jours ouvrés** (lundi–vendredi) via `workingDaysBetween()`
- `lead-time` et `cycle-time` partagent la même population : tickets ayant à la fois traversé `todoStatuses` et `devStartStatuses`. Garantit `lead_time ≥ cycle_time` par ticket. `bug-cycle-time` est exempté (les bugs sautent souvent TODO).

---

## Rapport HTML

Le rapport est un fichier autonome (Chart.js chargé depuis CDN, aucune dépendance serveur, partageable par email ou Slack).

**5 sections** :
1. **Livraison** — KPIs, graphes lead/cycle time, throughput, WIP, distribution, par taille, métriques normalisées
2. **Bugs & dette qualité** — bug throughput, bug cycle time, allocation dev, bug backlog (barres net flow + courbe open count)
3. **Capacité & prévision** — forecast Monte Carlo, aging WIP avec liens Jira cliquables
4. **Flux par rôle** — stage time, WIP par rôle, throughput gap, rework, first-time-right
5. **Scope change** — barres empilées par sprint (description / story points / reprogrammation) + taux de dérive, table des issues modifiées avec liens Jira cliquables ; bannière d'alerte orange si dérive détectée sur le sprint actif ou précédent ; section absente si la base n'a pas été migrée (ticket 031)

Chaque graphe inclut une courbe de tendance (moyenne mobile 4 semaines). Les KPIs configurés avec `healthThresholds` affichent un signal de santé coloré (vert / orange / rouge). La section "Flux par rôle" est masquée silencieusement si aucune colonne `role:` n'est configurée dans `board.yaml`.

---

## Développement

```bash
npm run build           # Compile TypeScript → ./dist
npm start               # Lance le build compilé

npm test                # Tests unitaires (Vitest)
npm run test:watch      # Watch mode
npm run test:coverage   # Couverture

npm run lint            # ESLint
npm run lint:fix        # ESLint avec corrections automatiques
```

### Ajouter une métrique

1. Créer `src/metrics/<name>.ts` implémentant `Metric<T>`
2. Pour les métriques de durée jusqu'à livraison, utiliser `buildDeliveredCte(config.doneStatuses)` depuis `utils.ts` — jamais `issues.resolved_at`
3. Enregistrer dans `ALL_METRICS` dans `src/metrics/index.ts`
4. Vérifier que la forme de résultat est reconnue par `extractStats` dans `snapshots/compute.ts` (sinon ajouter une branche explicite)
5. Si la métrique est non-déterministe (Monte Carlo) ou ne doit pas être backfillée, ajouter un skip explicite dans `snapshots/compute.ts`

Voir `docs/coding-standards.md` pour les conventions complètes (TDD obligatoire, TypeScript strict, plugin pattern, etc.) et `CLAUDE.md` pour l'architecture détaillée.

---

## Architecture

```
Jira REST API v2
      │
      ▼
src/jira/client.ts      ← Axios, pagination, 200ms entre pages
      │
      ▼
src/sync.ts             ← Orchestration : statuts, sprints, issues, transitions
      │
      ▼
src/db/store.ts         ← better-sqlite3, WAL, transactions atomiques
      │
   SQLite
      │
      ├── src/metrics/          ← Plugin registry (ALL_METRICS)
      ├── src/snapshots/        ← Backfill historique hebdo (metric_snapshots)
      └── src/report/           ← Rendu HTML autonome (Chart.js CDN)
```

**Stack** : Node.js · TypeScript 6 · better-sqlite3 · Axios · Commander.js · Chart.js
