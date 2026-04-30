# TDD — pièges et règles projet

À lire en phase 2 de `implement-ticket` quand un doute apparaît sur le cycle Red/Green/Refactor.

## Cycle complet

### Red — écrire le test qui échoue

- Le test doit échouer **pour la bonne raison** : assertion non satisfaite, pas erreur de compilation ou import manquant
- Si le test passe du premier coup : soit la fonctionnalité existe déjà (pas de ticket à faire), soit l'assertion est trop faible. Renforcer l'assertion avant de continuer
- Lancer **uniquement le test ciblé** pour vitesse : `npx vitest run tests/metrics/leadTime.test.ts`
- Capturer la sortie d'erreur — elle confirme la nature du Red

### Green — minimum vital

- Code prod = juste assez pour passer **ce** test. Pas d'anticipation des prochains scénarios
- Si tu te surprends à écrire une fonction utilitaire « parce que ça servira après » : stop, attends le scénario suivant
- Hardcoder une valeur si c'est ce qui passe le test. Le test suivant forcera à généraliser. C'est délibéré
- Re-lancer le test ciblé — vert

### Refactor — à suite verte uniquement

- Renommer, extraire fonction, dédupliquer, simplifier expressions
- Ne **jamais** changer le comportement durant un refactor
- Lancer la suite **complète** après refactor (`npx vitest run`) — un refactor peut casser un autre test
- Si rouge : revenir en arrière, ne pas empiler

## Règles spécifiques lean-jira

### Tests = SQLite en mémoire, pas de mock

`tests/helpers/db.ts` fournit `createTestDb()`. Cette DB applique le vrai schéma. **Ne pas mocker `better-sqlite3`** — un test qui passe sur un mock peut casser sur le vrai schéma.

### Helpers existants — ne pas réinventer

```ts
import { createTestDb } from "../helpers/db";
import {
  makeIssue,
  makeTransitions,
  seedIssueWithTransitions,
  makeSprint,
  seedSprint,
  seedStatus,
  TEST_CONFIG,
  resetSeq,
} from "../helpers/seeders";
```

`resetSeq()` dans le `beforeEach` pour que `PROJ-1`, `PROJ-2`… restent prévisibles entre tests.

### Fixture canonique

Si plusieurs tests partagent une issue de référence, factoriser dans une fonction `seedCanonical()` en haut du `describe` (cf. `tests/metrics/cycleTime.test.ts`). Garder les variations courtes, juste l'écart au cas canonique.

### Couverture cible pour une métrique

À minima un `it()` pour chacun :

1. Population vide → stats à 0 / pas de crash
2. Cas nominal — 1 issue, durée connue calculable à la main
3. Exclusion : population sans transition requise (todo, devStart, done)
4. Borne `cutoffDate` — strict supérieur **et** inclusion à la date exacte
5. Borne `windowEndDate` — idem
6. Multi-`doneStatuses` (statut renommé fallback)
7. Anomalie temporelle (done avant start) → exclusion silencieuse
8. Stats sur ≥ 3 issues — vérifier médiane et P85

### Nommage `it()`

Français, formulé comme assertion comportementale :

```ts
it("exclut une issue sans transition todoStatus (pas dans la population)", …)
it("cutoffDate inclut les issues livrées exactement à la date", …)
it("prend MIN(started_at) quand plusieurs transitions devStart", …)
```

Pas de "should", pas de "test that".

### Quand l'helper manque

Si tu te retrouves à écrire 5+ lignes de setup similaire dans plusieurs tests, ajouter un helper dans `tests/helpers/seeders.ts`. C'est dans le scope du ticket en cours, pas un refactor séparé.

## Pièges récurrents

### Working days vs calendar days

Toutes les durées métier sont en **jours ouvrés** via `workingDaysBetween()`. Tester sur des dates qui couvrent un week-end **et** des dates qui n'en couvrent pas. Un test passant uniquement sur dates en semaine peut masquer un bug week-end.

### Fuseau horaire

Les timestamps Jira sont en UTC. Toute comparaison `substr(transitioned_at, 1, 10)` opère sur la portion date UTC. Tester avec timestamps en `Z` explicite, pas de `+02:00`.

### `cutoffDate` et `windowEndDate`

Inclusifs aux deux bornes (cf. `cycleTime.test.ts`). Un test "exactement à la date" doit valider l'inclusion. Confusion fréquente avec semi-ouvert.

### Statuts done multiples

Toujours tester avec un second statut done (style `Delivered`) pour valider que le CTE accepte la liste, pas seulement le premier élément.

## Quand le rouge ne vient pas

- Vérifier que le test est bien lancé (chemin correct, regex `vitest run -t "<nom>"`)
- Vérifier l'import : un mauvais chemin de `cycleTimeMetric` peut crasher avant l'assertion
- Vérifier que `beforeEach` reset bien la DB et le compteur de séquence
