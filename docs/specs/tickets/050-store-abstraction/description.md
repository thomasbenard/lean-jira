# Ticket 050 — Abstraction de la couche de stockage (ReadStore / WriteStore)

## User story

En tant que développeur souhaitant brancher `lean-jira` sur un autre stockage que
SQLite (export JSON, REST tierce, Postgres, snapshot de fixtures), je veux que
les métriques, les snapshots, le rapport et la synchronisation ne dépendent plus
directement de `Database.Database` et n'embarquent plus de SQL en clair, afin
que l'ajout d'un backend alternatif se résume à implémenter une paire
d'interfaces stables.

## Solution retenue

Inverser la dépendance : la logique métier consomme deux interfaces de domaine
(`ReadStore`, `WriteStore`) et une couche d'indexation in-memory
(`MetricsContext`). Une seule implémentation est livrée dans ce ticket :
`SqliteStore`, qui encapsule l'intégralité du SQL existant. Les helpers SQL
publics (`buildDeliveredCte`, `buildWindowFragment`, `fetchDeliveredTransitions`,
`placeholders`, fragments d'exclusion) disparaissent du code des métriques et,
soit migrent en privé dans `SqliteStore`, soit sont remplacés par leur
équivalent in-memory dans `MetricsContext`.

Les 25 métriques sont réécrites en TypeScript pur, sans accès DB. Elles
consomment `MetricsContext` (issues + transitions filtrées et pré-indexées) au
lieu d'un `db: Database.Database`. Les snapshots, le rapport et la
synchronisation consomment `Store` (façade `ReadStore + WriteStore`).
`src/main.ts` instancie un unique `SqliteStore` au démarrage et le propage.

L'interface est conçue comme **étroite et stable** : quatre lectures
fondamentales (`issues`, `transitions`, `sprints`, `statuses`) plus quelques
projections annexes (`snapshots`, `appConfig`, `issueFieldChanges`,
`issueSprints`, `syncLog`). Aucun filtre métier n'est délégué au store ;
toutes les agrégations passent par TypeScript. Ce choix garantit qu'un backend
alternatif n'a jamais à reproduire de logique métier.

## Décisions architecturales

- **Option « événements bruts »** retenue sur l'option « repository typé par
  cas d'usage » : 4 méthodes de lecture stables plutôt qu'une vingtaine de
  méthodes spécialisées qui forceraient chaque nouveau backend à reproduire
  les fragments SQL actuels.
- **Façades séparées `ReadStore` / `WriteStore`** : un backend lecture seule
  (export REST, fixtures JSON) peut n'implémenter que `ReadStore`. CQRS-light,
  sans framework.
- **`MetricsContext`** : pré-indexation en mémoire (Maps par issue, par statut,
  `deliveredAt`, population cycle-time partagée). Construite une fois par run.
  Compense la perte des index B-tree SQLite. Perf attendue : équivalente sur
  le dataset KECK (~10k issues, ~100k transitions), parfois meilleure
  (mutualisation entre métriques).
- **Périmètre total** (sync compris) : signalé YAGNI lors du brainstorming,
  retenu par décision explicite. Coût supplémentaire localisé dans
  `src/sync.ts` et le bootstrap `main.ts`.

## Estimation

**Bucket** : XL

**Justification** : 25 métriques migrées, 5 couches infrastructure (store
interfaces, SqliteStore, MetricsContext, snapshots, report, sync, main),
~30 commits TDD attendus, tests d'intégration à adapter pour chaque
consommateur. Risque modéré de régression silencieuse atténué par un snapshot
test JSON `npm run metrics --json` avant/après refactor.

## Statut

**livré**
