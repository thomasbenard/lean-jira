import { describe, it, expect, beforeAll, afterAll } from "vitest";
import os from "os";
import path from "path";
import fs from "fs";
import yaml from "yaml";
import type Database from "better-sqlite3";
import { sync } from "../../src/sync";
import { openDb } from "../../src/store/sqlite";
import { runAllMetrics } from "../../src/metrics/index";
import { loadConfigs, buildMetricConfig } from "../../src/main";
import { SqliteStore } from "../../src/store/sqlite/index";
import { buildMetricsContext } from "../../src/metrics/context";
import { initClock } from "../../src/clock";
import { initRandom } from "../../src/random";

const ROOT = path.resolve(__dirname, "../..");
const FROZEN_NOW = "2026-01-15";
const JIRA_CONFIG = path.join(ROOT, "config.fake.yaml");
const BOARD_CONFIG = path.join(ROOT, "board.fake.yaml");

let db: Database.Database;
let tmpDbPath: string;

beforeAll(async () => {
  tmpDbPath = path.join(os.tmpdir(), `lean-jira-e2e-${Date.now()}.db`);

  initClock(FROZEN_NOW);
  initRandom(FROZEN_NOW);

  const rawConfig = yaml.parse(fs.readFileSync(JIRA_CONFIG, "utf-8"));
  db = openDb(tmpDbPath);
  const syncStore = new SqliteStore(db);
  await sync(syncStore, { ...rawConfig, db: { path: tmpDbPath } });
}, 30_000);

afterAll(() => {
  try {
    db?.pragma("wal_checkpoint(TRUNCATE)");
    db?.close();
  } catch { /* ignore */ }
  for (const suffix of ["", "-wal", "-shm"]) {
    try { fs.unlinkSync(tmpDbPath + suffix); } catch { /* ignore */ }
  }
});

describe("pipeline fake — golden output", () => {
  it("toutes les métriques produisent un output identique", () => {
    const app = loadConfigs(JIRA_CONFIG, BOARD_CONFIG);
    const store = new SqliteStore(db);
    const config = buildMetricConfig(store, app);
    const ctx = buildMetricsContext(store, config);
    const results = runAllMetrics(ctx);

    expect(results).toMatchSnapshot();
  });
});
