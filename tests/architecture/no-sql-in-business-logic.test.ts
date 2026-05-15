import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// pourquoi : barrière architecturale ticket-050. Tout SQL doit vivre dans
// `src/store/sqlite/**`. Le reste de `src/` consomme uniquement les
// namespaces SqliteStore. Si ce test échoue, factoriser la requête dans
// le namespace correspondant (issues, transitions, sprints, …).

const SRC_ROOT = path.resolve(__dirname, "../../src");

const ALLOWED_PREFIXES: string[] = [
  path.join(SRC_ROOT, "store", "sqlite"),
];

const ALLOWED_FILES: string[] = [
  path.join(SRC_ROOT, "store", "types.ts"),
];

interface Forbidden {
  pattern: RegExp;
  label: string;
}

const FORBIDDEN: Forbidden[] = [
  { pattern: /\bdb\.prepare\s*\(/, label: "db.prepare(" },
  { pattern: /\bdb\.exec\s*\(/, label: "db.exec(" },
  { pattern: /\bdb\.transaction\s*\(/, label: "db.transaction(" },
  { pattern: /from\s+["']better-sqlite3["']/, label: "import better-sqlite3" },
  // Mots-clés SQL en début de chaîne (case-insensitive). Les chaînes
  // multi-lignes ou inline avec backticks/quotes sont matchées.
  { pattern: /["'`]\s*(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\s+/i, label: "raw SQL keyword in string literal" },
];

function isAllowed(absPath: string): boolean {
  if (ALLOWED_FILES.includes(absPath)) return true;
  return ALLOWED_PREFIXES.some((p) => absPath.startsWith(p + path.sep));
}

function listTsFiles(root: string): string[] {
  const out: string[] = [];
  function walk(dir: string): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith(".ts")) out.push(full);
    }
  }
  walk(root);
  return out;
}

describe("architecture — pas de SQL hors src/store/sqlite", () => {
  const files = listTsFiles(SRC_ROOT).filter((f) => !isAllowed(f));

  it("scanne au moins un fichier (sanity)", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    const rel = path.relative(SRC_ROOT, file);
    it(`${rel} ne contient pas d'accès SQL direct`, () => {
      const content = fs.readFileSync(file, "utf-8");
      const violations: string[] = [];
      for (const { pattern, label } of FORBIDDEN) {
        if (pattern.test(content)) violations.push(label);
      }
      expect(violations).toEqual([]);
    });
  }
});
