import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

export function openDb(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  const schema = fs.readFileSync(path.join(__dirname, "..", "..", "db", "schema.sql"), "utf-8");
  db.exec(schema);
  migrate(db);

  return db;
}

function migrate(db: Database.Database): void {
  const cols = db.prepare("PRAGMA table_info(issues)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "current_sprint_id")) {
    db.exec("ALTER TABLE issues ADD COLUMN current_sprint_id INTEGER");
  }
  if (!cols.some((c) => c.name === "original_estimate_seconds")) {
    db.exec("ALTER TABLE issues ADD COLUMN original_estimate_seconds INTEGER");
  }
  if (!cols.some((c) => c.name === "story_points")) {
    db.exec("ALTER TABLE issues ADD COLUMN story_points REAL");
  }
  if (!cols.some((c) => c.name === "size_label")) {
    db.exec("ALTER TABLE issues ADD COLUMN size_label TEXT");
  }
}
