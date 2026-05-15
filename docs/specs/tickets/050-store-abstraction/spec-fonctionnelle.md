# Ticket 050 — Spec fonctionnelle

## Contexte

Aujourd'hui, chaque calcul métier dans `src/` reçoit un `db: Database.Database`
(better-sqlite3) et exécute du SQL en clair (`db.prepare(...).all(...)`). Cela
concerne les 25 métriques (`src/metrics/*.ts`), le module de snapshots
(`src/snapshots/compute.ts`), le rapport (`src/report/generate.ts`) et la
synchronisation (`src/sync.ts`). Conséquence : on ne peut pas brancher
`lean-jira` sur un autre stockage (Postgres, JSON statique, REST tierce, fixture
de test) sans réécrire l'intégralité de la logique métier.

## Objectif

Inverser la dépendance : la logique métier ne connaît plus que des interfaces de
domaine (`ReadStore`, `WriteStore`, `MetricsContext`). Toute la connaissance SQL
est concentrée dans une seule classe `SqliteStore` qui implémente ces
interfaces. Aucun nouveau backend n'est livré dans ce ticket — l'objectif est
de poser le contrat qui permettra de le faire dans un ticket ultérieur sans
toucher aux 25 métriques, au rapport ni aux snapshots.

## Critères fonctionnels d'acceptation

### CF-01 — Aucune régression observable

Avant et après le refactor, sur la base KECK et sur les fixtures fake :

- `npm run metrics --json` produit le même JSON octet pour octet
  (modulo l'ordre des clés si `JSON.stringify` est appelé sur des Maps —
  l'ordre des champs des objets est conservé).
- `npm run snapshots` produit la même table `metric_snapshots` (mêmes
  `(snapshot_date, metric_name, bucket, stat, value)`).
- `npm run report` produit le même HTML (modulo l'horodatage de génération
  embarqué et l'ordre éventuel d'itération sur les Maps internes).
- `npm run sync` produit la même base SQLite (mêmes lignes dans `issues`,
  `transitions`, `sprints`, `statuses`, `issue_field_changes`, `issue_sprints`,
  `sync_log`, `app_config`).

### CF-02 — Logique métier sans SQL

Aucun fichier sous `src/metrics/`, `src/snapshots/`, `src/report/` ou
`src/sync.ts` n'importe `better-sqlite3`, ne contient de chaîne SQL (`SELECT`,
`INSERT`, `UPDATE`, `DELETE`, `WITH`, `CTE`, `PRAGMA`), ni n'appelle
`db.prepare`, `db.exec`, `db.transaction`. Vérifié par un test
`tests/architecture/no-sql-in-business-logic.test.ts` qui grep ces patterns sur
l'arborescence et échoue si trouvés (à l'exception de `src/store/sqlite/**`).

### CF-03 — Une seule implémentation livrée

Le ticket livre `SqliteStore` comme unique implémentation de
`Store = ReadStore + WriteStore`. Pas de `JsonStore`, pas de `PostgresStore`,
pas de `RestStore`. La preuve que l'abstraction tient est la suite de tests
de contrat (`tests/store/contract.test.ts`) qui vérifie le comportement
attendu de toute implémentation et tourne contre `SqliteStore`.

### CF-04 — Façades séparées

Les types `ReadStore` et `WriteStore` sont définis comme deux interfaces
indépendantes. Un consommateur en lecture seule (rapport, métriques,
snapshots) ne reçoit qu'un `ReadStore`. La synchronisation reçoit un `Store`
complet (les deux). Compile-time error si un module reçoit un `ReadStore` et
appelle une méthode d'écriture.

### CF-05 — Performance préservée

Sur le dataset KECK (~10k issues, ~100k transitions), `npm run metrics`
s'exécute en ≤ 110% du temps actuel (mesure : moyenne de 5 runs sur la même
machine, avant/après). Sur le dataset fake (`board.fake.yaml`), le temps doit
être équivalent ou meilleur. Pas de mesure micro-benchmarkée par métrique :
on mesure l'enveloppe globale `metrics`, `snapshots` et `report`.

### CF-06 — Bootstrap unique

`src/main.ts` instancie `new SqliteStore(openDb(config.db.path))` une seule
fois au démarrage des commandes qui touchent à la DB (`sync`, `metrics`,
`snapshots`, `report`, `refresh`, `autoconfig`) et propage l'instance aux
modules consommateurs. Les commandes purement YAML (`validate-config`,
`list-metrics`) n'instancient pas de store. Plus aucun appel à `openDb`
hors `main.ts`.

### CF-07 — Documentation à jour

Le `CLAUDE.md` (section *Architecture* + section *Adding a metric*) est mis à
jour pour décrire le nouveau flux : `Store → MetricsContext → Metric.compute(ctx)`.
Les exemples de code dans `CLAUDE.md` reflètent la nouvelle signature
`compute(ctx: MetricsContext): T`. La section *Database schema* reste valide
(le schéma SQL ne change pas) mais est précédée d'une note : "le schéma
ci-dessous est un détail d'implémentation de `SqliteStore` ; les métriques
ne le voient pas."

## Hors périmètre

- Implémentation d'un second backend (Postgres, JSON, REST, fake-store).
- Validation runtime des données lues (Zod ou équivalent).
- Découpage de `MetricsContext` en plusieurs contextes plus fins.
- Migration des tests existants vers un harness `InMemoryStore` partagé —
  les tests des métriques continueront à utiliser SQLite via un helper
  `createTestStore()` jusqu'à ce qu'un besoin réel se manifeste.
- Refactor des helpers SQL utilisés par `autoconfig` (`calibrateThresholds`
  dans `main.ts`) — ils restent privés à `main.ts` ou migrent dans
  `SqliteStore` selon la décision technique.
- Suppression de `app_config` ou changement de schéma DB.

## Statut

**à faire**
