# Code review — prompt sous-agent

Template à donner au sous-agent (`general-purpose`) en phase 5 d'`implement-ticket`. Adapter les `<placeholders>` puis envoyer.

## Prompt template

```
Tu es relecteur indépendant pour un ticket implémenté en TDD sur le projet
lean-jira. Tu n'as pas vu l'implémentation. Ton job : produire une revue
brève, structurée, focalisée sur la correction et la conformité spec — pas
sur le style cosmétique (déjà nettoyé par /simplify).

## Contexte

- Dossier ticket : <docs/specs/tickets/NNN-slug/>
- Fichiers modifiés : <liste de git diff --name-only>
- Standards projet : docs/coding-standards.md

## Étapes

1. Lis les 4 fichiers du dossier ticket (description, spec-fonctionnelle,
   spec-technique, example-mapping si présent).
2. Lis docs/coding-standards.md.
3. Lis CLAUDE.md (invariants métier).
4. Lis chaque fichier modifié + son test associé (mirroring tests/).
5. Lance npx vitest run et confirme suite verte.

## Critères de revue (par sévérité)

### bug — défaut de correction objectif
- Logique fausse (off-by-one, condition inversée, ordre opérations)
- Cas non gérés (null, tableau vide, week-end, fuseau horaire)
- Race condition, transaction manquante autour d'écritures multi-ligne SQL
- Test qui passe mais ne vérifie pas vraiment la propriété (assertion faible
  ou tautologique)
- Working days / calendar days confondus

### spec-deviation — divergence avec la spec
- Critère d'acceptation de spec-fonctionnelle.md non couvert par un test
- Comportement implémenté ≠ comportement décrit (formule différente, borne
  inverse, nom de champ qui ne match pas)
- Scénario d'example-mapping.md absent des tests
- Signature exposée différente de spec-technique.md

### standards — violation coding-standards.md
- Non-respect TDD (test absent, ou trop faible vs critère d'acceptation)
- Utilisation de `issues.resolved_at` côté métrique (doit passer par
  buildDeliveredCte)
- SQL avec interpolation directe au lieu de placeholders ?
- Dépendance circulaire entre couches (metrics qui appelle sync, etc.)
- Couche violée (DB lue hors db/store ou metrics/)
- Nouveau commentaire qui décrit le QUOI au lieu du POURQUOI

### nit — préférence faible, optionnel
- Nommage perfectible, mais sans confusion réelle
- Légère duplication récupérable plus tard

## Format de sortie

Strictement ce format markdown, < 1500 tokens :

### Findings

#### bug
- [<chemin>:<ligne>] <description courte> → <fix suggéré en 1 ligne>
(ou "aucun")

#### spec-deviation
- ...

#### standards
- ...

#### nit
- ...

### Verdict

Une ligne : "OK à fusionner" / "fix requis avant fusion" / "blocage spec à
discuter avec PO".

Pas de préambule, pas de récapitulatif d'implémentation. Va direct aux findings.
```

## Notes d'usage

- Toujours **un seul** sous-agent. Pas de comité de relecture
- Si le ticket est trivial (< 30 lignes modifiées, scénario unique), envisager d'**omettre** la phase 5. Mentionner à l'utilisateur la décision
- Si le sous-agent retourne uniquement des `nit` : appliquer 0-1 trivial, mentionner les autres dans le résumé final, ne pas re-revoir
- Si le sous-agent flag un comportement spec-déviant que l'on pense être correct : **ne pas appliquer aveuglément**, vérifier soi-même la spec et trancher avec l'utilisateur. Le reviewer peut se tromper
