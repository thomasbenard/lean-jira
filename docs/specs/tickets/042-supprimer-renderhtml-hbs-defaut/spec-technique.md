# Spec technique — Supprimer renderHtml() et faire de Handlebars le renderer par défaut

## Impact fichiers

| Fichier | Modification |
|---|---|
| `src/report/generate.ts` | Supprimer `renderHtml()` (L521–L1546) ; câbler le template embarqué comme défaut dans `generateReport()` |
| `tests/report/generate.test.ts` | Migrer `describe("renderHtml — Cockpit structure")` vers `renderWithHandlebars()` avec template embarqué |
| `tests/report/personalization.test.ts` | Migrer `describe("renderHtml — personnalisation")` vers `renderWithHandlebars()` avec template embarqué |
| `tests/report/handlebars.test.ts` | Mettre à jour l'extraction du type `RenderInput` (ne plus l'extraire via `renderHtml`) |

---

## 1. `src/report/generate.ts` — câbler le template embarqué par défaut

Dans `generateReport()`, remplacer la branche L398-404 :

```typescript
// AVANT
const resolvedTemplatePath = personalization?.templatePath
  ? path.resolve(boardDir ?? process.cwd(), personalization.templatePath)
  : undefined;

const html = resolvedTemplatePath
  ? renderWithHandlebars(renderInput, resolvedTemplatePath)
  : renderHtml(renderInput);

// APRÈS
const resolvedTemplatePath = personalization?.templatePath
  ? path.resolve(boardDir ?? process.cwd(), personalization.templatePath)
  : path.join(__dirname, "templates", "report.hbs");

const html = renderWithHandlebars(renderInput, resolvedTemplatePath);
```

Puis supprimer `renderHtml()` (L521–L1546, ~1 025 lignes). L'export peut être retiré car `renderHtml` n'est plus utilisée.

Ne pas supprimer le commentaire `// ─── Helpers HTML extraits de renderHtml() ────────────────────────────────────` (L1548) — remplacer par `// ─── Helpers HTML utilisés par buildRenderedTabs() ───────────────────────────` pour rester exact.

---

## 2. `tests/report/generate.test.ts` — migration des tests de structure

Localiser le `describe("renderHtml — Cockpit structure", ...)` (~L269–L360). Chaque test appelle `renderHtml(makeRenderInput())` et asserte un fragment HTML.

Remplacer par un helper local qui appelle `renderWithHandlebars` avec le template embarqué :

```typescript
import path from "path";
import { renderWithHandlebars, /* ... */ } from "../../src/report/generate";

function renderDefault(input: RenderInput): string {
  const templatePath = path.join(__dirname, "../../src/report/templates/report.hbs");
  return renderWithHandlebars(input, templatePath);
}
```

Chaque `renderHtml(makeRenderInput())` → `renderDefault(makeRenderInput())`.

Vérifier que les assertions (`toContain`, `not.toContain`) restent valides contre l'output HBS. Si un fragment HTML n'est plus présent tel quel dans `report.hbs`, adapter l'assertion au nouvel équivalent (ex. : un `id` ou une classe CSS présente dans le template).

**Type `RenderInput`** : extrait via `Parameters<typeof renderWithHandlebars>[0]` ou importer directement depuis `generate.ts` si le type est exporté.

---

## 3. `tests/report/personalization.test.ts` — migration

Même approche que ci-dessus. Le `describe("renderHtml — personnalisation", ...)` (~L171) utilise `renderHtml` pour tester :

- title personnalisé
- logo
- font custom
- CSS custom
- excludeTabs
- staleBanner

Ces comportements passent désormais par `buildTemplateContext()` → `report.hbs`. Les assertions sur fragments HTML doivent rester valides (le template embarque ces valeurs aux mêmes endroits).

---

## 4. `tests/report/handlebars.test.ts` — mise à jour du type

Ligne 13 :
```typescript
// AVANT
type RenderInput = Parameters<typeof import("../../src/report/generate").renderHtml>[0];

// APRÈS
type RenderInput = Parameters<typeof import("../../src/report/generate").renderWithHandlebars>[0];
```

---

## Ordre d'implémentation

1. **Red** — écrire un test dans `generate.test.ts` qui appelle `renderDefault()` et vérifie un fragment existant → rouge car `renderDefault` n'existe pas encore
2. Câbler le template embarqué par défaut dans `generateReport()` (2 lignes)
3. Supprimer `renderHtml()` (L521–L1546)
4. **Green** — `npx vitest run tests/report/generate.test.ts` → vert sur le nouveau test
5. Migrer les tests `describe("renderHtml — Cockpit structure")` un par un → vert à chaque passage
6. Migrer `tests/report/personalization.test.ts`
7. Mettre à jour `tests/report/handlebars.test.ts` (type extraction)
8. `npx vitest run` → 100 % vert
