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

## Step 4 — Decide on example-mapping.md

Write example-mapping.md **only if** the ticket has at least one of:
- Conditional UI behavior (what happens when a button is clicked, a selector changes, etc.)
- Edge cases that are easy to misspecify (empty data, single-item collections, concurrent state)
- Non-trivial business rules with multiple outcomes
- UI interactions where order or independence matters

Skip it for: pure refactors, pure backend changes with no observable behavior change, trivial
CRUD additions with no branching.

## Step 5 — Write the files

Write all files in one pass, in order: description.md → spec-fonctionnelle.md →
spec-technique.md → (example-mapping.md if needed).

---

### description.md

```markdown
# Ticket <NNN> — <Short title>

## User story

En tant que <persona>, je veux <action>, afin de <bénéfice>.

## Solution retenue

<One paragraph. What will be built, how, at a high level. Enough for a developer to understand
the approach without reading the other files. Mention the key technical choice if there is one.>

## Statut

**To be implemented**
```

The persona should be specific (lead technique, développeur, PO) not generic ("utilisateur").
The "afin de" must express a real benefit, not just restate the action.

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
Ticket <NNN> — <title>
Created: docs/specs/tickets/<NNN>-<slug>/
  description.md         ✓
  spec-fonctionnelle.md  ✓
  spec-technique.md      ✓
  example-mapping.md     ✓  (or: — skipped: pure backend change, no branching behavior)
```
