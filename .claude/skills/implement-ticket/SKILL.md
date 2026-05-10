---
name: implement-ticket
description: Implémente un ticket de dev existant sous `docs/specs/tickets/<NNN>-<slug>/` en suivant strictement TDD (Red→Green→Refactor) et les conventions de `docs/coding-standards.md`. Workflow complet : lecture spec → TDD → tests verts → /simplify → code review par sous-agent indépendant → application fix → mise à jour specs système si invariant modifié → mise à jour statut. Trigger systématiquement sur `/implement-ticket <N>`, "implémente le ticket X", "code le ticket 003", "fais le ticket", "développe la feature spécifiée dans le ticket", même si l'utilisateur ne mentionne pas explicitement TDD ou code review. Optimisé pour livrer du code correct et conforme à la spec sans bugs ni dérive de scope. NE PAS utiliser pour créer un nouveau ticket (utiliser /ticket-spec à la place) ni pour des bug fixes ad-hoc hors ticket.
---

# implement-ticket

Implémente un ticket spécifié dans `docs/specs/tickets/<NNN>-<slug>/`. Garantit : couverture TDD, conformité spec, conformité coding standards, revue indépendante.

## Definition of Done

**Avant de déclarer le ticket terminé, valider chaque point :**

- `npx vitest run` → 100 % vert
- `/simplify` appliqué sur les fichiers modifiés
- Code review sous-agent fait (ou justification d'exemption < 30 lignes)
- **Si nouvelle métrique** → `docs/specs/system/spec-fonctionnelle.md` + `metrics-formulas.md` + `CLAUDE.md` (section "Metric catalog") mis à jour
- **Si autre invariant modifié** (DB schema, CLI, config, export API) → sections concernées dans `docs/specs/system/` + `CLAUDE.md` mis à jour
- **Si surface publique modifiée** (nouvelle commande, option, comportement observable) → `README.md` mis à jour
- **Si champ config modifié** (nouveau champ `config.yaml`/`board.yaml`, nouvelle commande CLI, nouvelle option, comportement observable changé) → `docs/configuration.md` mis à jour (sections Référence complète et/ou Troubleshooting si pertinent)
- `description.md` du ticket + `docs/specs/tickets/INDEX.md` → statut `livré` (via `bash scripts/update-ticket.sh status <NNN> livré`, cf. Phase 8)

Ces 6 points sont non-négociables. Les phases ci-dessous décrivent comment y arriver.

## Identifier le ticket

Si l'utilisateur fournit un numéro (`/implement-ticket 003`, "ticket 3") :

```bash
ls docs/specs/tickets/ | grep '^003-'
```

Si plusieurs matchs ou aucun : demander confirmation à l'utilisateur. Ne pas deviner.

Si l'utilisateur décrit le ticket sans numéro : `ls docs/specs/tickets/`, propose 1-3 candidats par slug, attend confirmation.

## Phases

### Phase 1 — Lecture spec (parallèle)

Lire **en un seul tour** les 4 fichiers du dossier ticket :

- `description.md` — user story, solution choisie, statut courant
- `spec-fonctionnelle.md` — règles métier, critères d'acceptation
- `spec-technique.md` — fichiers `src/` à toucher, contrats, signatures
- `example-mapping.md` — scénarios Gherkin (peut ne pas exister)

Lire en complément si pas déjà en contexte :

- `docs/coding-standards.md` — conventions, pattern TDD obligatoire
- `CLAUDE.md` — invariants métier (team-done, doneStatuses, etc.)

**Sortie attendue** : résumé en 5-10 lignes de ce qui est à faire, fichiers cibles, scénarios à couvrir. Présenter ce résumé à l'utilisateur. Si la spec est sans ambiguïté critique : ajouter "Répondez si vous voulez corriger, sinon je commence" et démarrer la phase 2 au prochain message sans attendre. Si la spec est ambiguë sur un point bloquant : poser la question et attendre la réponse avant toute écriture.

Si le ticket est marqué `Statut: livré` dans `description.md` : alerter l'utilisateur, ne pas réimplémenter.

### Phase 2 — TDD Red → Green → Refactor

Pour **chaque scénario** d'`example-mapping.md` (ou critère d'acceptation à défaut). Si ni `example-mapping.md` ni critères d'acceptation clairs n'existent : revenir en phase 1, poser la question à l'utilisateur avant toute écriture.

1. **Red** — écrire le test Vitest dans `tests/<layer>/<file>.test.ts` (mirroring de `src/`)
   - Utiliser les helpers existants : `createTestDb`, `seedIssueWithTransitions`, `makeIssue`, `TEST_CONFIG`, `resetSeq`
   - Nom du test en français (`it("exclut une issue sans transition todoStatus", …)`)
   - Lancer `npx vitest run <chemin-test>` → **constater l'échec**. C'est non négociable. Pas d'écriture de prod tant que le rouge n'est pas vu
2. **Green** — écrire le minimum de code prod pour passer le test. Pas plus
   - Localiser via `Grep`/`Glob` avant `Read` pour économiser tokens
   - Modifier les fichiers `src/` listés dans `spec-technique.md`
   - `npx vitest run <chemin-test>` → vert
3. **Refactor** — nettoyer code + test à suite verte. Renommer, extraire, dédupliquer
   - Re-lancer après chaque modif

Voir `references/tdd-cycle.md` pour les pièges récurrents et règles projet (ne pas mocker la DB, etc.).

### Phase 3 — Suite complète verte

```bash
npx vitest run
```

Si rouge : revenir en phase 2 sur le test cassé. Ne **jamais** masquer un échec ni utiliser `--bail`. Tout doit passer.

### Phase 4 — `/simplify` (inline)

Invoquer la skill `/simplify` ciblée sur les fichiers modifiés. Objectifs :

- Réutiliser code existant plutôt que dupliquer
- Supprimer abstractions prématurées, code mort, commentaires `// what` inutiles
- Aligner style avec `docs/coding-standards.md`

Re-lancer `npx vitest run` après chaque modif issue de `/simplify`.

**Pourquoi avant la review** : nettoie le bruit stylistique pour que le sous-agent reviewer se concentre sur correction et conformité spec, pas sur de la cosmétique.

### Phase 5 — Code review (sous-agent)

**Exception triviale** : si le ticket modifie < 30 lignes et couvre un scénario unique, omettre cette phase. Mentionner la décision à l'utilisateur dans le résumé final.

Sinon, spawn **un seul** sous-agent (general-purpose) avec le prompt template de `references/code-review-prompt.md`. Lui passer :

- chemin du dossier ticket
- liste des fichiers modifiés (`git diff --name-only`)
- chemin de `docs/coding-standards.md`

Le sous-agent retourne une liste structurée de findings classés par sévérité (`bug` / `spec-deviation` / `standards` / `nit`). Pas plus de 1500 tokens en sortie.

**Token economics** : la review consomme ~5-15k tokens de raisonnement. Isolés dans le sous-agent, ils ne polluent pas le contexte principal. Gain net x10 vs review inline.

### Phase 6 — Application des findings

Pour chaque finding sévérité `bug` ou `spec-deviation` :

1. Si le bug n'est pas couvert par un test existant : écrire d'abord un test régression qui échoue. Puis fix
2. Si c'est une déviation de spec : appliquer le fix, vérifier que les tests existants passent toujours, ajouter un test si la spec couvre un cas non testé

`standards` : appliquer si trivial, sinon discuter avec l'utilisateur.
`nit` : ignorer par défaut. Mentionner dans le résumé final.

Re-lancer `npx vitest run` après chaque correction.

### Phase 7 — Mise à jour specs système + CLAUDE.md + README.md + docs/configuration.md (conditionnelle)

Voir la **Definition of Done** en tête de document pour les critères de déclenchement.

**Procédure** : grep dans `docs/specs/system/`, `CLAUDE.md` et `README.md` pour trouver les sections à toucher. Éditer en ton descriptif (état présent, pas changelog). Pas d'historique « avant/après ».

Si le ticket touche la configuration (`config.yaml`, `board.yaml`, nouvelles commandes, options CLI) : mettre à jour `docs/configuration.md` (section 5 Référence pour les champs, section 7 Troubleshooting si comportement d'erreur change).

**README.md** : mettre à jour si la surface publique change — nouvelle commande CLI, nouvelle option, nouveau comportement observable par l'utilisateur final. Appliquer la même règle de tranchage que pour les specs système.

**Exemptions** (skip màj) : refactor interne sans changement de surface publique, bug fix qui restaure un comportement déjà documenté, cosmétique pure (CSS/HTML/logs), test-only.

**Règle de tranchage** : « un lecteur de la spec qui n'a pas vu le code remarquerait-il que la description ne reflète plus la réalité ? » Si oui → màj. Si non → exemption.

⚠ « c'est juste de l'UI » n'est pas une exemption si le comportement observable change.

### Phase 8 — Clôture

1. Appeler le script de clôture (met à jour `description.md` ET `docs/specs/tickets/INDEX.md` atomiquement) :
   ```bash
   bash scripts/update-ticket.sh status <NNN> livré
   ```
   où `<NNN>` est le numéro du ticket (ex: `028`, `039a`).
2. `git status` + `git diff` → présenter résumé des changements à l'utilisateur
3. **Ne pas commit sans demande explicite**

## Anti-patterns à éviter

- **Sauter la phase 1.** Coder sans lire toutes les specs = scope drift garanti
- **Écrire la prod avant le test.** Tu déroges au pattern TDD du projet ; section 10 de `coding-standards.md` est explicite
- **Sous-agent pour implémentation.** Coût recharge contexte > gain. Implémentation reste inline
- **Plusieurs sous-agents review en parallèle.** Une seule review suffit ; les divergences entre reviewers sont du bruit à ce stade
- **Review avant `/simplify`.** Le reviewer flag des choses que `/simplify` aurait nettoyées de toute façon
- **Lecture séquentielle des 4 specs.** Toujours en parallèle (1 message, 4 Read tools)
- **`grep`/`cat`/`find` via Bash.** Utiliser Glob/Grep/Read dédiés
- **Modifier `resolved_at` ou contourner `buildDeliveredCte`.** Casse l'invariant team-done

## Récapitulatif token-efficient

| Phase | Tokens approx | Mode |
|---|---|---|
| 1. Lecture spec parallèle | 3-5k | inline |
| 2. TDD (par scénario, ~3 itérations) | 8-25k | inline |
| 3. Suite complète | <1k | inline |
| 4. /simplify | 3-8k | inline |
| 5. Review sous-agent | 1-2k retournés (raisonnement isolé) | sous-agent |
| 6. Fixes | 2-5k | inline |
| 7. Màj specs système + CLAUDE.md + README.md (si applicable) | 1-4k | inline |
| 8. Clôture | <1k | inline |
| **Total ticket M** | **20-55k** | |

**Tickets XL interdits.** Par convention `/ticket-spec` ne génère pas de ticket XL (cf. règle anti-monolithe dans la skill `ticket-spec`). Si tu rencontres un ticket marqué `Bucket: XL` ou estimé > 5j à la lecture phase 1 :

1. Ne pas implémenter
2. Alerter l'utilisateur
3. Proposer un découpage et orienter vers `/ticket-spec` pour générer les sous-tickets
4. Reprendre l'implémentation sur le premier sous-ticket une fois découpé