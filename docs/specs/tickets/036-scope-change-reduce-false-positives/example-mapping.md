# Example Mapping — scope-change-rate : réduire les faux positifs

## Règle 6 — First vs last (dérive cumulée)

**La comparaison porte sur l'état au moment de l'entrée en sprint contre l'état final — pas sur les paires consécutives.**

```gherkin
Scenario: trois enrichissements progressifs dépassant le seuil cumulé
  Given une issue entrée dans le sprint à t0
  And description à t0 : "Texte A" (100 chars)
  And changement à t1 (post-sprint) : "Texte A" → "Texte A plus long" (sim=0.88 par paire)
  And changement à t2 : "Texte A plus long" → "Texte A plus long et enrichi" (sim=0.90 par paire)
  And changement à t3 : "Texte A plus long et enrichi" → "Texte B complètement différent" (sim=0.87 par paire)
  When on calcule scope-change-rate
  Then l'issue est comptée comme modifiée
  # firstValue="Texte A", lastValue="Texte B complètement différent" → sim < 0.85

Scenario: trois petits changements dont le delta cumulé reste sous le seuil
  Given une issue entrée dans le sprint
  And trois changements post-sprint de similarité 0.96, 0.97, 0.95 par paire
  And le delta cumulé (first vs last) a une similarité de 0.91
  When on calcule scope-change-rate
  Then l'issue n'est pas comptée comme modifiée
  # firstValue vs lastValue → sim 0.91 ≥ 0.85

Scenario: champs description et summary évalués indépendamment
  Given une issue avec description inchangée et summary fortement modifié post-sprint
  When on calcule scope-change-rate
  Then l'issue est détectée (summary franchi le seuil)
```

---

## Règle 7 — Grace period

**Les changements dans les N premières heures post-sprint-start sont ignorés.**

```gherkin
Scenario: changement dans la grace period ignoré
  Given scopeChangeGracePeriodHours = 24
  And sprint start = 2026-03-16T09:00:00Z
  And changement description à 2026-03-16T20:00:00Z (11h après start) sim < 0.85
  And aucun autre changement
  When on calcule scope-change-rate
  Then l'issue n'est pas détectée
  # changement dans grace period → firstValue = null → skip

Scenario: changement après la grace period détecté
  Given scopeChangeGracePeriodHours = 24
  And sprint start = 2026-03-16T09:00:00Z
  And changement description à 2026-03-17T10:00:00Z (25h après start) sim < 0.85
  When on calcule scope-change-rate
  Then l'issue est détectée

Scenario: grace period à 0 (défaut) → comportement inchangé
  Given scopeChangeGracePeriodHours absent de board.yaml (défaut 0)
  And changement description 1h après sprint start sim < 0.85
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

## Règle 9 — Addition pure ignorée, suppression détectée

**Ajouter du contenu sans rien modifier ni supprimer n'est pas une dérive de périmètre. Supprimer des exigences en est une.**

```gherkin
Scenario: enrichissement par append pur
  Given from_value = "Critère principal."
  And   to_value   = "Critère principal. Détails complémentaires ajoutés en fin de sprint."
  When on calcule similarityRatio(from_value, to_value)
  Then le résultat est 1.0
  # levenshtein = len(to) - len(from), len(to) > len(from) → addition pure

Scenario: suppression de contenu → détecté
  Given from_value = "Critère principal. Détails importants."
  And   to_value   = "Critère principal."
  When on calcule similarityRatio(from_value, to_value)
  Then le résultat est < 1.0
  # len(to) < len(from) → suppression, pas exempté → similarity normale

Scenario: substitution partielle → non exempté par la règle addition pure
  Given from_value = "Critère A"
  And   to_value   = "Critère B et autres choses"  (len > len(from) mais substitution "A"→"B")
  When on calcule similarityRatio(from_value, to_value)
  Then le résultat est calculé normalement (levenshtein > len(to) - len(from))
```
