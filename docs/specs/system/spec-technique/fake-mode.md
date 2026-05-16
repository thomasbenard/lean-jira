# Mode fake (output déterministe sans Jira)

[← Index](../spec-technique.md)

Activé par `jira.mode: "fake"` dans `config.yaml`. Tout l'output (métriques, snapshots, rapport, forecast Monte Carlo) devient bit-à-bit reproductible. Usage : tests E2E, démos, debug d'une régression sur jeu figé.

## Bootstrap (`src/main.ts:263-271`)

```typescript
function bootstrapFakeMode(jira) {
  if (jira.mode !== "fake") return;
  if (!jira.frozenNow) { error + exit(1); }   // i18n key "fakeMode.missingFrozenNow"
  initClock(jira.frozenNow);                  // fige now()
  initRandom(jira.frozenNow);                 // seed PRNG forecast
}
```

Appelé en tout début de `runWithErrorHandling`, avant tout accès DB ou metric. Une absence de `jira.frozenNow` en mode fake → `process.exit(1)`.

## `src/clock.ts` — horloge injectable

| Export | Comportement |
|---|---|
| `initClock(iso?)` | Si `iso` fourni → fige `frozen = new Date(iso)`. Sinon reset (`now()` retourne l'heure système). |
| `now()` | Retourne `new Date(frozen)` figée, ou `new Date()` réel. Nouvelle instance à chaque appel (pas de partage de référence). |

Utilisée par : `sync.ts`, `report/generate.ts`, `snapshots/compute.ts`, `metrics/forecast.ts`, `metrics/devTimeAllocation.ts`, `metrics/bugBacklog.ts`, `metrics/agingWip.ts`. **Toute métrique sensible à "aujourd'hui" doit passer par `now()`** — jamais `new Date()` direct.

## `src/random.ts` — PRNG seedé

| Export | Comportement |
|---|---|
| `initRandom(seed?)` | Si `seed` fourni → `rng = mulberry32(hashStr(seed))`. Sinon `rng = Math.random`. |
| `random()` | Retourne un nombre dans `[0,1)`. |

Algo : Mulberry32 (PRNG 32-bit déterministe, période 2³²). Seed = hash FNV-like (`Math.imul(31, hash) + charCode`) de la string `frozenNow`. Utilisé exclusivement par `metrics/forecast.ts` (Monte Carlo throughput).

## `src/jira/clientFactory.ts` — sélection real vs fake

```typescript
export function createJiraClient(jira: JiraConfig): JiraClientLike {
  if (jira.mode === "fake") return new FakeJiraClient(jira.fixturesPath);
  return new JiraClient(jira);
}
```

`JiraClientLike` est l'interface commune (`fetchAllIssues`, `fetchAllStatuses`, `fetchBoardConfiguration`, `fetchAllSprints`). `JiraClient` (real) et `FakeJiraClient` l'implémentent. `sync.ts` n'importe que `JiraClientLike` — aucun couplage au mode.

## `src/jira/fakeClient.ts`

Charge des fixtures JSON depuis le filesystem. `fixturesDir = jira.fixturesPath` (résolu absolu) ou `path.join(__dirname, "fixtures")` (défaut embarqué).

| Méthode | Fichier lu |
|---|---|
| `fetchAllStatuses()` | `statuses.json` |
| `fetchAllSprints()` | `sprints.json` |
| `fetchBoardConfiguration()` | `boardConfig.json` |
| `fetchAllIssues(_, updatedSince?)` | `issues.json` — filtre `fields.updated >= updatedSince` si fourni (simule sync incrémental) |

Lecture synchrone (`fs.readFileSync`) puis `Promise.resolve()` pour respecter l'interface async.

## Fixtures embarquées (`src/jira/fixtures/`)

```
boardConfig.json   ← réponse /rest/agile/1.0/board/{id}/configuration
issues.json        ← issues + changelog
sprints.json       ← sprints
statuses.json      ← /rest/api/2/status (avec category_key)
```

Override possible via `jira.fixturesPath: "./path/custom-fixtures"` dans `config.yaml`.

## Exemple complet

```yaml
# config.fake.yaml
jira:
  mode: fake
  frozenNow: "2026-01-15"       # obligatoire, format ISO date
  fixturesPath: "./src/jira/fixtures"   # optionnel
  projectKey: "FAKE"
db:
  path: "./fake.db"
```

```bash
npm run refresh -- -c config.fake.yaml -b board.fake.yaml -o report.fake.html
```

Sortie déterministe garantie : 2 exécutions consécutives produisent un `report.fake.html` byte-identique (modulo whitespace HTML).
