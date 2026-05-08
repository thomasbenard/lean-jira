# Spec technique — 038 fake Jira connector

## Nouveaux fichiers

| Path | Rôle |
|---|---|
| `src/clock.ts` | `now()` + `initClock(iso?)` — horloge injectable |
| `src/random.ts` | `random()` + `initRandom(seed?)` — Mulberry32 PRNG |
| `src/jira/clientFactory.ts` | `JiraClientLike` interface + `createJiraClient(JiraConfig)` factory |
| `src/jira/fakeClient.ts` | `FakeJiraClient implements JiraClientLike`, charge fixtures JSON |
| `src/jira/fixtures/statuses.json` | 6 statuts fake |
| `src/jira/fixtures/sprints.json` | 9 sprints (8 closed + 1 active) |
| `src/jira/fixtures/issues.json` | 38 issues avec changelogs |
| `src/jira/fixtures/boardConfig.json` | Config board fake pour autoconfig |
| `config.fake.yaml` | Config exemple (commitable) |
| `board.fake.yaml` | Board exemple aligné fixtures (commitable) |

## Fichiers modifiés

| Path | Modif |
|---|---|
| `src/jira/types.ts` | Export `JiraConfig` avec `mode?`, `frozenNow?`, `fixturesPath?` |
| `src/jira/client.ts` | `implements JiraClientLike` |
| `src/sync.ts` | `createJiraClient(config.jira)` remplace `new JiraClient(config.jira)` |
| `src/main.ts` | `JiraFileConfig.jira` enrichi; bootstrap `initClock`/`initRandom` si `mode=fake` |
| `src/metrics/forecast.ts:69` | `Math.random` → `random()` depuis `src/random.ts` |
| `src/metrics/agingWip.ts:34` | `new Date()` → `now()` depuis `src/clock.ts` |
| `src/metrics/bugBacklog.ts:21` | idem |
| `src/metrics/devTimeAllocation.ts:70` | idem |
| `src/snapshots/compute.ts:58` | idem |
| `src/report/generate.ts:289` | `generatedAt` via `now()` |
| `src/db/store.ts:164` | `logSync` via `now()` |

## Interface JiraClientLike (src/jira/clientFactory.ts)

```ts
export interface JiraClientLike {
  fetchAllIssues(onProgress?, updatedSince?): Promise<JiraIssue[]>;
  fetchAllStatuses(): Promise<JiraStatus[]>;
  fetchBoardConfiguration(): Promise<JiraBoardConfig>;
  fetchAllSprints(): Promise<JiraSprint[]>;
}
```

## Couche déterminisme

**clock.ts** : module-global `frozen: Date | null`. `initClock("2026-01-15")` fige l'horloge. `now()` retourne `new Date(frozen)` si figé, sinon `new Date()`.

**random.ts** : Mulberry32 seedé via hash djb2 de `frozenNow`. `initRandom(seed)` remplace le RNG global. `random()` délègue au RNG courant.

## Bootstrap (src/main.ts)

```ts
// Après loadJiraConfig, avant toute commande
if (jiraConfig.jira.mode === "fake") {
  if (!jiraConfig.jira.frozenNow) {
    console.error("Erreur : jira.frozenNow requis en mode fake.");
    process.exit(1);
  }
  initClock(jiraConfig.jira.frozenNow);
  initRandom(jiraConfig.jira.frozenNow);
}
```

## Vérification bout-en-bout

```bash
npm run build
rm -f lean-jira.fake.db
npm run sync     -- -c config.fake.yaml
npm run metrics  -- -c config.fake.yaml -b board.fake.yaml --json > out1.json
rm -f lean-jira.fake.db
npm run sync     -- -c config.fake.yaml
npm run metrics  -- -c config.fake.yaml -b board.fake.yaml --json > out2.json
diff out1.json out2.json  # doit être vide
npm run refresh  -- -c config.fake.yaml -b board.fake.yaml -o report.fake.html
```
