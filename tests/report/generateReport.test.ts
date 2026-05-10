import { describe, it, beforeEach } from "vitest";
import os from "os";
import path from "path";
import { expect } from "vitest";
import { createTestDb } from "../helpers/db";
import { TEST_CONFIG } from "../helpers/seeders";
import { generateReport } from "../../src/report/generate";
import type Database from "better-sqlite3";
import type { EstimationConfig } from "../../src/metrics/types";

let db: Database.Database;
const outPath = path.join(os.tmpdir(), "lean-jira-test-report.html");

beforeEach(() => {
  db = createTestDb();
  db.prepare(
    "INSERT INTO metric_snapshots (snapshot_date, metric_name, bucket, stat, value) VALUES (?, ?, ?, ?, ?)",
  ).run("2025-01-05", "lead-time", "", "median", 3);
});

const estimations: EstimationConfig[] = [
  { method: "none" },
  { method: "time" },
  { method: "story-points" },
  { method: "t-shirt", jiraField: "customfield_10200" },
  { method: "numeric", jiraField: "customfield_10099", bucketThresholds: { xs: 2, s: 5, m: 10, l: 20 } },
];

describe("generateReport — câblage estimation par méthode", () => {
  for (const estimation of estimations) {
    it(`method=${estimation.method} ne lève pas et produit du HTML`, () => {
      const config = { ...TEST_CONFIG, estimation };
      expect(() =>
        generateReport(db, "TEST", "https://test.atlassian.net", outPath, config),
      ).not.toThrow();
    });
  }
});
