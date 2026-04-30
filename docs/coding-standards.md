# Coding standards — lean-jira

Standards rédigés à partir des conventions effectivement appliquées dans `src/`. Toute déviation locale doit être justifiée par un commentaire `// pourquoi`.

---

## 1. Stack & outillage

- **TypeScript 6**, `strict: true`, `target: ES2020`, `module: commonjs`, `esModuleInterop: true`
- Aucun ESLint ni Prettier configuré — conventions tenues à la main et par revue
- `ts-node` en dev (`npm run sync|metrics|snapshots|report`), `tsc` pour build
- Tests : **Vitest** (`vitest run` / `vitest`)
- Pas de couche framework (DI, ORM…). Bibliothèques minimales : `axios`, `better-sqlite3`, `commander`, `yaml`

Conséquence : éviter d'introduire un nouvel outil ou une dépendance lourde sans discussion préalable.

---

## 2. Style TypeScript

### Formatage

- Indentation **2 espaces**
- **Double quotes** pour chaînes
- **Point-virgules** terminaux obligatoires
- **Trailing comma** dans tout littéral / paramètre multi-ligne
- Largeur cible ~120 colonnes, pas de coupure agressive
- Une instruction par ligne

### Nommage

| Élément | Convention | Exemple |
|---|---|---|
| Variables / fonctions | `camelCase` | `workingDaysBetween`, `buildDeliveredCte` |
| Types / interfaces | `PascalCase` | `MetricConfig`, `DurationStats` |
| Constantes module-level immuables | `UPPER_SNAKE` | `SECONDS_PER_DAY`, `BUCKET_ORDER`, `SIM_COUNT` |
| Métrique exportée | `<nom>Metric` | `leadTimeMetric`, `agingWipMetric` |
| Colonnes SQL | `snake_case` | `done_at`, `to_status`, `original_estimate_seconds` |
| Fichiers métriques | `camelCase.ts` | `cycleTimeBySize.ts`, `bugCycleTime.ts` |

Le mapping snake_case (DB) ↔ camelCase (TS) se fait explicitement dans `db/store.ts` et `sync.ts` (`mapIssue`).

### Types & interfaces

- `interface` pour formes d'objets publics (résultats de métrique, config, payload Jira)
- `type` pour alias d'unions ou tuples (`type SizeBucket = "XS" | "S" | …`)
- `unknown` plutôt que `any` quand le type est inconnu (cf. `runMetric`, `printResults`)
- Cast via `as` permis quand un payload externe est typé après lecture (`as Array<{ ... }>`)
- Préférer types nominaux à la duplication : étendre (`extends DurationStats`) plutôt que recopier les champs

### Imports

- Imports nommés systématiques. Pas de `import * as`
- Default import réservé aux libs qui l'imposent (`Database from "better-sqlite3"`, `axios`, `fs`, `path`, `yaml`)
- Ordre conseillé : libs externes → modules internes proches → modules internes distants. Pas d'auto-tri imposé
- Pas de barrel files génériques. Un seul registre central : `src/metrics/index.ts`

### Fonctions

- Fonctions pures préférées dans `utils.ts` (jamais d'effet de bord)
- Signatures **toujours typées en retour** (sauf void implicite trivial)
- Paramètres optionnels via `?` ou valeurs par défaut, jamais `| undefined` explicite en signature publique
- Une fonction = une responsabilité. Si > 60 lignes ou > 3 niveaux d'imbrication : extraire

---

## 3. Architecture & layering

Flux unidirectionnel strict :

```
Jira API → src/jira/client.ts → src/sync.ts → src/db/store.ts → SQLite
                                                                    ↓
            stdout / report.html ← src/metrics/* ← src/snapshots/compute.ts
```

Règles :

- `src/jira/` ne dépend de **rien d'interne** (pure couche transport + types)
- `src/db/store.ts` est la **seule** porte d'entrée vers SQLite. Aucun `db.prepare(...)` hors de `db/store.ts` **sauf** dans `metrics/*` et `snapshots/*` où la SQL est inhérente à la lecture analytique
- `src/metrics/*` lit la DB, ne l'écrit jamais
- `src/snapshots/compute.ts` est le seul module qui écrit `metric_snapshots`
- `src/report/generate.ts` lit `metric_snapshots`, n'écrit que le fichier HTML
- Pas de dépendance circulaire. Pas de remontée (`metrics` ne dépend jamais de `report` ni de `sync`)

---

## 4. Pattern métrique (plugin registry)

Toute nouvelle métrique respecte le contrat `Metric<T>` (`src/metrics/types.ts`) :

```ts
export interface Metric<T> {
  name: string;          // identifiant CLI (kebab-case)
  description: string;   // affiché par list-metrics
  compute(db: Database.Database, config: MetricConfig): T;
}
```

Checklist d'ajout :

1. Créer `src/metrics/<nom>.ts`. Exporter `<nom>Metric: Metric<T>`
2. Si la métrique mesure une durée jusqu'à livraison : utiliser **obligatoirement** `buildDeliveredCte(config.doneStatuses)`. Ne jamais lire `issues.resolved_at`
3. Si la métrique opère sur une fenêtre temporelle : prévoir `cutoffDate` **et** `windowEndDate` (sinon les snapshots historiques cassent)
4. Importer + pousser dans `ALL_METRICS` (`metrics/index.ts`)
5. Si la forme du résultat n'entre pas dans une branche existante de `extractStats` (`buckets`, `avgDays`, `byWeek`, `aggregateFlowEfficiency`, `riskCounts`) : ajouter une branche explicite dans `snapshots/compute.ts`. Sinon la métrique sera silencieusement absente du report
6. Si non-déterministe (Monte Carlo) ou sans sens en historique : skip explicite dans `computeSnapshot` (cf. `forecast`)
7. Tests Vitest sous `tests/metrics/<nom>.test.ts` couvrant : population vide, invariants de filtrage, `cutoffDate` borne basse, `windowEndDate` borne haute, anomalies (timestamps inversés), multi-statuts done

---

## 5. SQL & accès base

- `better-sqlite3` synchrone — pas d'`async` autour des requêtes
- Toute écriture multi-ligne **doit** passer par `db.transaction(() => { ... })()` (atomicité)
- Templates de requêtes via `db.prepare(...)`. Réutiliser le statement préparé en boucle
- Placeholders `?` positionnels pour les listes dynamiques (statuts) :

  ```ts
  const ph = config.todoStatuses.map(() => "?").join(",");
  db.prepare(`... WHERE to_status IN (${ph})`).all(...config.todoStatuses);
  ```

- **Jamais** d'interpolation directe d'input utilisateur dans un littéral SQL
- CTE nommée pour les sous-requêtes répétées (`WITH delivered AS (...)`)
- Index : si un nouveau pattern de WHERE/JOIN apparaît, ajouter l'index dans `schema.sql` (et migration si table existante)

---

## 6. Date & temps

- Stockage : **ISO 8601 string** UTC (jamais d'epoch ms en DB)
- Comparaisons date côté SQL : `substr(transitioned_at, 1, 10)` pour comparer à un `YYYY-MM-DD`
- Durées métier : **jours ouvrés (Mon-Fri)** via `workingDaysBetween()`. Fractions incluses
- Bornes de fenêtres snapshot : **jours calendaires** (`cutoffDate ± N`)
- Conversion date relative → date absolue **dès la lecture** (pas de "Thursday" qui traîne)

---

## 7. Configuration

- Fichier unique `config.yaml` à la racine, parsé en `AppConfig` (`main.ts`)
- Le runtime construit un `MetricConfig` via `buildMetricConfig(db, app)` qui **enrichit** la config statique avec les statuts `done` dérivés de la table `statuses`
- Un statut classé `done` par Jira est automatiquement retiré de `inProgressStatuses` / `activeStatuses` / `queueStatuses` et un warning est loggé. Ne pas chercher à filtrer manuellement en amont
- `doneStatuses` du YAML = fallback pour statuts renommés disparus de l'API. Garder cette liste minimale

---

## 8. Logs & erreurs

- Logs : `console.log` / `console.warn`, **français**, préfixe `  ⚠` pour les warnings runtime
- Pas de logger structuré (winston, pino…) tant que l'outil reste CLI mono-utilisateur
- Erreurs : `throw new Error("message FR explicite")`. Pas de classes d'erreur custom sauf nécessité documentée
- Validation : aux frontières (lecture config, payload Jira). Code interne fait confiance aux types

---

## 9. Commentaires

Règle générale : **rare et précis**. On commente le *pourquoi*, jamais le *quoi*.

- Toujours commenter quand :
  - Un invariant non-évident est posé (cf. en-têtes des fichiers métriques)
  - Un choix contre-intuitif est volontaire (cf. `forecast.ts` : « Volontairement sans filtre cutoffDate »)
  - Un workaround vise une particularité Jira ou DB documentée ailleurs
- Jamais commenter :
  - Ce qu'un nom de fonction dit déjà
  - Le numéro de ticket / issue (mettre dans le commit / PR)
  - Du code commenté laissé "au cas où"
- Langue : **français** pour la prose, anglais autorisé dans les noms de symboles techniques uniquement
- En-tête de fonction utile = 1 à 4 lignes max. Pas de JSDoc verbeux

---

## 10. TDD — obligatoire

**Tout code de production est écrit en TDD.** Sans exception : nouvelle fonctionnalité, correction de bug, refactor avec changement de comportement, ajout de métrique.

Cycle **Red → Green → Refactor** :

1. **Red** — écrire d'abord un test qui échoue. Le test décrit le comportement attendu (pas l'implémentation). Lancer `vitest` et **constater l'échec** avant d'écrire la moindre ligne de production
2. **Green** — écrire le minimum de code de production pour faire passer le test. Pas plus. Pas d'anticipation, pas de généralisation prématurée
3. **Refactor** — nettoyer code et tests à suite verte. Renommer, extraire, dédupliquer. Re-lancer la suite après chaque modification

Règles dérivées :

- Pas de PR sans test associé au commit qui introduit le comportement
- Pour un **bug** : écrire d'abord un test qui **reproduit** le bug et échoue avec le code actuel. Puis corriger. Le test devient régression
- Pour un **refactor pur** (sans changement de comportement) : la suite existante doit déjà couvrir la zone. Sinon ajouter les tests manquants **avant** le refactor
- Granularité : un test = un comportement vérifiable. Préférer plusieurs petits `it("…")` à un test géant
- Si un test est difficile à écrire, c'est un signal de design : la cible est trop couplée. Découper avant d'implémenter
- Tests écrits **après** = dette. À traiter comme un bug à corriger immédiatement

Exception unique : prototypes jetables explicitement marqués (script one-shot dans un dossier `scratch/` ignoré). Tout code dans `src/` est sous TDD.

---

## 11. Tests

- Framework : **Vitest** (`vitest run` / `vitest`)
- Localisation : `tests/<layer>/<file>.test.ts` (mirroring de `src/`)
- Helpers partagés : `tests/helpers/db.ts` (DB en mémoire), `tests/helpers/seeders.ts` (`makeIssue`, `seedIssueWithTransitions`, `TEST_CONFIG`)
- Avant chaque test : `db = createTestDb(); resetSeq();`
- Une fixture canonique en haut du describe (cf. `seedCanonical` dans `cycleTime.test.ts`), puis variations
- `it("…", …)` rédigé en **français**, formulé comme une assertion comportementale (« exclut une issue sans transition todoStatus »)
- Couverture cible pour une métrique : population vide, cas nominal, exclusion de filtrage, bornes `cutoffDate` / `windowEndDate` (inclusion stricte), multi-doneStatus, anomalies temporelles
- Pas de mock de la DB : on utilise une vraie SQLite en mémoire. Mocker l'appel Jira si test de `sync` ajouté

---

## 12. CLI (Commander.js)

- Une commande = un verbe (`sync`, `metrics`, `snapshots`, `report`, `list-metrics`)
- Toute commande accepte `-c, --config <path>` avec défaut `./config.yaml`
- Options longues `--kebab-case`. Booléens via `--include-outliers`
- Sortie machine via `--json` quand pertinent, sinon affichage humain `printResults`
- L'affichage humain reste dans `main.ts` (`printResults`, `printBuckets`). Ne pas l'éparpiller

---

## 13. Performance

- `better-sqlite3` est synchrone et rapide : pas de prématurer l'optim
- Pagination Jira : `await sleep(200)` entre pages (rate limit Atlassian Cloud)
- Préférer un seul `SELECT` agrégé à plusieurs `SELECT` en boucle JS
- `metric_snapshots` est en format long (`snapshot_date, metric_name, bucket, stat, value`) — ne pas dénormaliser

---

## 14. Git

- Branches : `feat/...`, `fix/...`, `docs/...`, `refactor/...`, `chore/...`
- Commits : **Conventional Commits** (`feat(metrics): …`, `docs(specs): …`, `chore: …`)
- Sujet ≤ 72 caractères. Corps en français si nécessaire pour expliquer le *pourquoi*
- Un commit = un changement cohérent. Éviter les commits "fix everything"

---

## 15. Sécurité

- `apiToken` Jira lu depuis `config.yaml` — fichier ignoré du repo
- Aucune URL ou secret en dur dans le code
- Aucune fonction ne reçoit du SQL utilisateur ; si un jour : placeholders ou échappement obligatoire
- Le rapport HTML est autonome (Chart.js inline), pas d'eval ni d'iframe externe

---

## 16. Pour aller plus loin

- `CLAUDE.md` (racine) — invariants métier (team-done, doneStatuses, fenêtres snapshot)
- `docs/specs/system/spec-technique.md` — schéma DB détaillé
- `docs/specs/system/metrics-formulas.md` — définitions mathématiques des métriques
- `docs/specs/tickets/<NNN>-<slug>/` — historique des décisions par ticket
