# Example Mapping — scope-change-rate : réduire les faux positifs

## Règle 6 — First vs last (dérive cumulée), depuis le premier devStart

**La comparaison porte sur l'état au moment du premier devStart contre l'état final — pas sur les paires consécutives.**

```gherkin
Scenario: trois enrichissements progressifs dépassant le seuil cumulé post-devStart
  Given une issue avec firstDevStart à t0
  And description à t0 : "Texte A" (100 chars)
  And changement à t1 (post-devStart) : "Texte A" → "Texte A plus long" (sim=0.88 par paire)
  And changement à t2 : "Texte A plus long" → "Texte A plus long et enrichi" (sim=0.90 par paire)
  And changement à t3 : "Texte A plus long et enrichi" → "Texte B complètement différent" (sim=0.87 par paire)
  When on calcule scope-change-rate
  Then l'issue est comptée comme modifiée
  # firstValue="Texte A", lastValue="Texte B complètement différent" → sim < 0.85

Scenario: trois petits changements dont le delta cumulé reste sous le seuil
  Given une issue avec firstDevStart
  And trois changements post-devStart de similarité 0.96, 0.97, 0.95 par paire
  And le delta cumulé (first vs last) a une similarité de 0.91
  When on calcule scope-change-rate
  Then l'issue n'est pas comptée comme modifiée
  # firstValue vs lastValue → sim 0.91 ≥ 0.85

Scenario: issue sans transition devStart — exclue de la détection
  Given une issue dans un sprint qui n'a jamais transitionné vers un devStartStatus
  And la description a changé significativement
  When on calcule scope-change-rate
  Then l'issue n'est pas détectée
  # pas de firstDevStart → skip détection, reste dans totalIssues

Scenario: champs description et summary évalués indépendamment
  Given une issue avec description inchangée et summary fortement modifié post-sprint
  When on calcule scope-change-rate
  Then l'issue est détectée (summary franchi le seuil)
```

---

## Règle 7 — Grace period

**Les changements dans les N premières heures post-devStart sont ignorés.**

```gherkin
Scenario: changement dans la grace period ignoré
  Given scopeChangeGracePeriodHours = 24
  And firstDevStart = 2026-03-16T09:00:00Z
  And changement description à 2026-03-16T20:00:00Z (11h après devStart) sim < 0.85
  And aucun autre changement
  When on calcule scope-change-rate
  Then l'issue n'est pas détectée
  # changement dans grace period → firstValue = null → skip

Scenario: changement après la grace period détecté
  Given scopeChangeGracePeriodHours = 24
  And firstDevStart = 2026-03-16T09:00:00Z
  And changement description à 2026-03-17T10:00:00Z (25h après devStart) sim < 0.85
  When on calcule scope-change-rate
  Then l'issue est détectée

Scenario: grace period à 0 (défaut) → comportement inchangé
  Given scopeChangeGracePeriodHours absent de board.yaml (défaut 0)
  And changement description 1h après devStart sim < 0.85
  When on calcule scope-change-rate
  Then l'issue est détectée
```

---

## Règle 8 — Macros Jira strippées

**Un changement purement structurel (macro, image, URL de lien) ne déclenche pas de détection.**

```gherkin
Scenario: changement de titre de panel uniquement
  Given from_value = "{panel:title=Avant}Contenu identique{panel}"
  And   to_value   = "{panel:title=Après}Contenu identique{panel}"
  When on calcule similarityRatio(from_value, to_value)
  Then le résultat est 1.0
  # après strip : "contenu identique" vs "contenu identique"

Scenario: changement d'URL dans un lien Jira
  Given from_value = "Voir [ticket|https://jira.example.com/old]"
  And   to_value   = "Voir [ticket|https://jira.example.com/new]"
  When on calcule similarityRatio(from_value, to_value)
  Then le résultat est 1.0
  # après strip : "voir ticket" vs "voir ticket"

Scenario: changement de contenu (pas seulement macro) reste détecté
  Given from_value = "{panel}Critère A{panel}"
  And   to_value   = "{panel}Critère B complètement différent{panel}"
  When on calcule similarityRatio(from_value, to_value)
  Then le résultat est < 0.85
```

---

## Règle 9 — Dérive proportionnelle à l'original (dénominateur = len(from))

**sim = max(0, 1 − levenshtein / len(from_normalisé)). Petit ajout → sim proche de 1. Gros ajout ou suppression → détecté.**

```gherkin
Scenario: petit ajout (< 15% de l'original) → non détecté
  Given from_value = "a" × 100 (100 chars)
  And   to_value   = "a" × 100 + "b" × 10 (ajout de 10%, lev=10)
  When on calcule similarityRatio(from_value, to_value)
  Then le résultat est 1 - 10/100 = 0.90 ≥ 0.85 → non détecté

Scenario: gros ajout (> 15% de l'original) → détecté
  Given from_value = "a" × 100 (100 chars)
  And   to_value   = "a" × 100 + "b" × 30 (ajout de 30%, lev=30)
  When on calcule similarityRatio(from_value, to_value)
  Then le résultat est 1 - 30/100 = 0.70 < 0.85 → détecté

Scenario: suppression de contenu → détecté
  Given from_value = "Critère principal. Détails importants."
  And   to_value   = "Critère principal."
  When on calcule similarityRatio(from_value, to_value)
  Then le résultat est < 1.0

Scenario: réécriture complète → clampé à 0
  Given from_value = "a" × 100
  And   to_value   = "b" × 100 (dist=100, len(from)=100)
  When on calcule similarityRatio(from_value, to_value)
  Then le résultat est max(0, 1-100/100) = 0.0 < 0.85 → détecté
```
