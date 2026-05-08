# Spec fonctionnelle — 038 fake Jira connector

## Comportement attendu

**Activation** : ajouter `jira.mode: fake` dans `config.yaml`. Champ `frozenNow` obligatoire si `mode: fake` (ISO date, ex: `"2026-01-15"`).

**Commandes concernées** :
- `npm run sync` : lit les fixtures JSON au lieu d'appeler l'API Jira. Peuple la DB comme un sync normal.
- `npm run metrics` : inchangé (lit la DB).
- `npm run snapshots` : inchangé (lit la DB).
- `npm run report` : inchangé (lit les snapshots).
- `npm run refresh` : enchaîne les 4 étapes en mode fake.

**Déterminisme** :
- Toutes les métriques utilisant "aujourd'hui" (`aging-wip`, `bug-backlog`, `dev-time-allocation`, `wip`, snapshots, `generatedAt` du rapport) utilisent `frozenNow` à la place de `new Date()`.
- `forecast` utilise un PRNG seedé par `frozenNow` → résultat identique entre runs.
- `diff out1.json out2.json` doit être vide après deux cycles sync → metrics.

**Fixtures embarquées** (`src/jira/fixtures/`) :
- 38 issues (25 Story/Task + 8 Bug fermés, 5 WIP actifs), couvrant toutes les métriques.
- 4 niveaux de risque aging-wip (ok / watch / at-risk / critical).
- 2 issues avec scope change (summary ou description changé après entrée sprint).
- 3 issues avec backward transitions (rework QA→Dev ou PO→QA).
- 6 buckets de taille (XS/S/M/L/XL/UNESTIMATED) + BUG.
- ≥16 semaines de throughput pour forecast Monte Carlo.

**Validation** : si `mode: fake` et `frozenNow` absent → erreur explicite au démarrage.

## Cas non couverts

- `autoconfig` (appel API direct) : interdit en mode fake, erreur explicite.
- `validate-config` : fonctionne (lit la DB après sync fake).
