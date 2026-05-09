---
name: ticket-spec
description: >
  Generate a complete ticket specification folder structure under docs/specs/tickets/<NNN>-<slug>/,
  with description.md (user story + chosen solution + status), spec-fonctionnelle.md (detailed
  functional spec), spec-technique.md (technical spec anchored in real source code), and
  optionally example-mapping.md (Gherkin scenarios for non-trivial business rules or UI behavior).
  Use this skill whenever the user invokes /ticket-spec, asks to "spec a ticket", "write the spec
  for ticket N", "document a feature as a ticket", or wants to create spec files for a new
  development ticket. Also trigger when the user describes a feature to implement and asks for
  documentation before coding — even if they don't say "ticket".
---

# Ticket Spec Generator

Produces a structured ticket documentation folder under `docs/specs/tickets/` from a ticket
number and feature description. The output mirrors the quality of a team-reviewed spec: each
file is precise, anchored in the actual codebase, and actionable.

## Invocation forms

```
/ticket-spec <N> <short description>
/ticket-spec 3 export CSV des métriques
/ticket-spec 12 refactor: découpler le renderer HTML
```

If the number or description is missing, ask for them before proceeding.

## Step 1 — Gather context

Before writing anything, collect the minimum viable context:

1. **Ticket number** — from args or ask
2. **Short description** — 3-6 words, will become the folder slug
3. **Feature intent** — what problem does this solve, for whom? If not in args, ask one focused
   question: "Qu'est-ce que ce ticket doit accomplir, et pour qui ?"
4. **Scope** — which part of the system is touched? Don't ask this explicitly; infer from the
   description and confirm while reading the code.

Don't ask multiple questions at once. One question is enough — the code reading fills most gaps.

### Inconnues bloquantes vs inférables

Après lecture du code (Step 2), classifier les inconnues restantes :

**Bloquantes** (ne peut pas inférer depuis le code — toujours demander si absent) :
- Persona : qui bénéficie de la feature ? (lead technique, PO, développeur…)
- Bénéfice métier : quel problème concret résout ce ticket ?
- Contrainte explicite : perf cible, compatibilité requise, migration DB interdite, etc.

**Inférables** (le code suffit — ne pas demander) :
- Fichiers à toucher
- Approche technique (pattern existant à dupliquer)
- Cas limites (dérivables des types et branches existants)

**Règle** : si ≥1 inconnue bloquante subsiste après lecture du code, poser **une** question.
Présenter d'abord ce qui a été inféré : *"J'ai inféré X — est-ce correct ? Et <inconnue bloquante> ?"*
Attendre la réponse avant d'écrire quoi que ce soit.

## Step 2 — Read the relevant source code

This step is mandatory. Specs that aren't anchored in real code produce wrong file paths,
non-existent functions, and unrealistic implementation orders.

Read the files most likely to be touched:
- Start from `src/` — identify which modules are in scope from the description
- Read the relevant metric, report, snapshot, or sync files as needed
- If the feature touches the report (`src/report/generate.ts`) or snapshots
  (`src/snapshots/compute.ts`), always read those
- Look for existing patterns (how similar things are already done) — the spec-technique should
  reuse them, not invent new ones

Note: don't read the entire codebase. Read the 2-4 files most likely to be modified.

## Step 3 — Build the folder name

```
NNN  = ticket number, zero-padded to 3 digits (1 → 001, 12 → 012)
slug = short description in kebab-case, lowercase, no accents
       "export CSV des métriques" → "export-csv-metriques"
       "refactor: découpler le renderer" → "refactor-decoupler-renderer"
```

Folder: `docs/specs/tickets/<NNN>-<slug>/`

## Step 4 — Estimer la taille du ticket

**À faire avant d'écrire le moindre fichier.** Une fois le code lu (Step 2), poser un bucket
d'estimation (XS / S / M / L / XL) basé sur :

- nombre de fichiers à toucher
- présence ou non d'un pattern existant à dupliquer
- complexité algorithmique
- migrations DB nécessaires
- nombre de scénarios de test attendus

Voir le tableau "Buckets d'estimation" plus bas (sous `description.md`) pour les seuils.

### Si l'estimation sort XL → STOP

**Ne pas générer le ticket.** Proposer immédiatement à l'utilisateur un découpage en 2-4
sous-tickets, chacun ≤ M. Identifier les livrables intermédiaires logiques (ex. couche DB
d'abord, métrique consommatrice ensuite, intégration UI en dernier).

Format de la proposition :

```
Ce ticket sortirait XL (~7j). Je propose de le découper :

  001a — <slug> (M, ~2j) : <livrable 1>
  001b — <slug> (M, ~3j) : <livrable 2>
  001c — <slug> (S, ~1j) : <livrable 3>

OK pour ce découpage ? Si oui, je génère les 3 specs.
```

Attendre confirmation. Puis générer chaque sous-ticket via les Steps 3-7 en boucle.

**Exception** : refactor architectural indivisible. Justifier dans `description.md` pourquoi
le découpage n'est pas faisable et signaler le risque (PR géante, scope drift probable). Cas
rare — la plupart des « ça ne se découpe pas » se découpent quand on creuse 5 minutes.

## Step 5 — Decide on example-mapping.md

Write example-mapping.md **only if** the ticket has at least one of:
- Conditional UI behavior (what happens when a button is clicked, a selector changes, etc.)
- Edge cases that are easy to misspecify (empty data, single-item collections, concurrent state)
- Non-trivial business rules with multiple outcomes
- UI interactions where order or independence matters

Skip it for: pure refactors, pure backend changes with no observable behavior change, trivial
CRUD additions with no branching.

## Step 6 — Write the files

Write all files in one pass, in order: description.md → spec-fonctionnelle.md →
spec-technique.md → (example-mapping.md if needed). Le bucket et la justification décidés
en Step 4 alimentent la section `## Estimation` de `description.md`.

---

### description.md

```markdown
# Ticket <NNN> — <Short title>

## User story

En tant que <persona>, je veux <action>, afin de <bénéfice>.

## Solution retenue

<One paragraph. What will be built, how, at a high level. Enough for a developer to understand
the approach without reading the other files. Mention the key technical choice if there is one.>

## Estimation

**Bucket** : <XS | S | M | L | XL>

**Justification** : <2-3 lignes : nombre de fichiers touchés, complexité, risques techniques,
besoin de migration DB, nombre de scénarios de test attendus.>

## Statut

**à faire**
```

The persona should be specific (lead technique, développeur, PO) not generic ("utilisateur").
The "afin de" must express a real benefit, not just restate the action.

`Statut` accepte trois valeurs : `à faire` → `en cours` → `livré`. Mis à jour par la skill
`/implement-ticket` au cours de l'implémentation.

### Buckets d'estimation

Cohérents avec `bucketize()` dans `src/metrics/utils.ts` (alimente `lead-time-by-size`,
`cycle-time-by-size`, `throughput-weighted`) :

| Bucket | Jours-personne | Quand l'utiliser |
|---|---|---|
| **XS** | < 0.5j | 1 fichier, < 30 lignes, 1-2 scénarios test |
| **S**  | 0.5-1j | 1-2 fichiers, pattern existant à dupliquer, 2-4 scénarios |
| **M**  | 1-3j | 2-4 fichiers, nouvelle métrique simple, 4-8 scénarios |
| **L**  | 3-5j | Plusieurs couches touchées, refactor partiel, > 8 scénarios |
| **XL** | ≥ 5j | **Interdit** — voir règle ci-dessous |

### Règle anti-monolithe — pas de ticket XL

**Si l'estimation dépasse 5j, le ticket doit être découpé en plusieurs sous-tickets via
`/ticket-spec`.** Un ticket XL est un signal :

- la spec couvre plusieurs préoccupations indépendantes
- la livraison incrémentale est impossible → risque élevé de scope drift et de PR géante non revusable
- l'estimation est trop incertaine pour être actionnable

Quand cette skill détecte qu'un ticket sortirait XL :

1. **Ne pas écrire le ticket monolithique**
2. Proposer à l'utilisateur un découpage : 2-4 sous-tickets, chacun ≤ M. Identifier les
   livrables intermédiaires pertinents (ex. « ticket A : ajout schéma DB + migration », « ticket B :
   métrique consommatrice », « ticket C : intégration report »)
3. Confirmer la liste avec l'utilisateur, puis générer les specs pour chaque sous-ticket

Exception : refactor architectural impossible à découper. Justifier explicitement dans
`description.md` pourquoi le découpage n'est pas faisable et signaler le risque.

---

### spec-fonctionnelle.md

Structure:

```markdown
# Spec fonctionnelle — <feature name>

## Contexte

<Why this feature is needed. What currently exists and what's missing. 2-4 sentences.>

## Comportement attendu

<Subsections as needed. Be specific: which UI element, which data, which trigger.
Use subsections like "Zone d'affichage", "Interactions", "État initial", etc.>

## Cas limites

<Bullet list of edge cases. Each entry: condition → expected behavior.
Include: empty data, single item, missing optional data, concurrent state if relevant.>

## Ce qui ne change pas

<Explicit list of things that are NOT in scope. Prevents scope creep.>
```

---

### spec-technique.md

Structure:

```markdown
# Spec technique — <feature name>

## Impact fichiers

| Fichier | Modification |
|---|---|
| `src/path/to/file.ts` | Description de la modification |

---

## 1. <Section par fichier ou par responsabilité>

<For each impacted file: what changes, why, and a realistic code snippet showing the shape
of the change. Use the actual types, function signatures, and variable names from the codebase.
Don't invent new patterns when existing ones fit.>

---

## Ordre d'implémentation

1. <Step 1 — most foundational first>
2. <Step 2>
...
```

Code snippets should show the real shape of the change, not pseudocode. Use the actual types
from the codebase (e.g., `DurationStats`, `SnapshotRow`, `MetricConfig`).

---

### example-mapping.md (when applicable)

Structure: one section per business rule, each with 2-4 Gherkin scenarios.

```markdown
# Example Mapping — <feature name>

## Règle 1 — <rule name>

**<Rule statement in plain language>**

```gherkin
Scenario: <happy path>
  Given ...
  When ...
  Then ...

Scenario: <edge case>
  Given ...
  When ...
  Then ...
```

## Règle 2 — ...
```

Focus on behavior that is easy to get wrong or that clarifies ambiguity in the functional spec.
Don't write scenarios for trivially obvious behavior.

---

## Output confirmation

After writing all files, print a summary:

```
Ticket <NNN> — <title>  [<bucket> ~<Xj>]
Created: docs/specs/tickets/<NNN>-<slug>/
  description.md         ✓
  spec-fonctionnelle.md  ✓
  spec-technique.md      ✓
  example-mapping.md     ✓  (or: — skipped: pure backend change, no branching behavior)
```

Si plusieurs sous-tickets ont été générés suite à un découpage XL, afficher chaque ticket sur
sa propre ligne avec son bucket.

## Step 7 — Enregistrer dans INDEX.md

Après l'output confirmation, appeler le script pour ajouter le ticket à l'index :

```bash
bash scripts/update-ticket.sh add <NNN> <slug> "<description one-line>"
```

- `<NNN>` : numéro zero-paddé (ex: `042`, `039e`)
- `<slug>` : même slug que le dossier créé (kebab-case, sans accents)
- `<description one-line>` : première phrase de la user story condensée (max 80 chars)

Si découpage XL → plusieurs sous-tickets : appeler `add` pour chaque sous-ticket généré.
