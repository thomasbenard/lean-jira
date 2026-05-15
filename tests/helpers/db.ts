import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

const SCHEMA_PATH = path.join(__dirname, "../../src/store/sqlite/schema.sql");

export function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(fs.readFileSync(SCHEMA_PATH, "utf-8"));
  return db;
}
