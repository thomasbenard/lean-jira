// Baseline figé pour CF-01 (ticket 050) : valide qu'aucune régression
// observable n'est introduite par le refactor SqliteStore.
// La DB fake est gitignorée : le test la sème lui-même via sync() en mémoire
// dans un fichier temporaire, puis pointe le subprocess `npm run metrics`
// sur une config YAML temporaire qui surcharge `db.path`.
// Régénérer après changement légitime de schéma de sortie :
//   npm run sync -- -c config.fake.yaml
//   npm run metrics -- -c config.fake.yaml -b board.fake.yaml --json \
//     > tests/snapshots/__snapshots__/metrics-baseline.fake.json
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "child_process";
import { readFileSync, writeFileSync, unlinkSync } from "fs";
import os from "os";
import path from "path";
import yaml from "yaml";
import { sync } from "../../src/sync";
import { initClock } from "../../src/clock";
import { initRandom } from "../../src/random";

const ROOT = path.resolve(__dirname, "../..");
const FROZEN_NOW = "2026-01-15";
const JIRA_CONFIG = path.join(ROOT, "config.fake.yaml");

let tmpDbPath: string;
let tmpConfigPath: string;

beforeAll(async () => {
  const stamp = Date.now();
  tmpDbPath = path.join(os.tmpdir(), `lean-jira-cf01-${stamp}.db`);
  tmpConfigPath = path.join(os.tmpdir(), `lean-jira-cf01-${stamp}.yaml`);

  initClock(FROZEN_NOW);
  initRandom(FROZEN_NOW);

  const rawConfig = yaml.parse(readFileSync(JIRA_CONFIG, "utf-8"));
  const tmpConfig = { ...rawConfig, db: { path: tmpDbPath } };
  await sync(tmpConfig);

  writeFileSync(tmpConfigPath, yaml.stringify(tmpConfig), "utf-8");
}, 30_000);

afterAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) {
    try { unlinkSync(tmpDbPath + suffix); } catch { /* ignore */ }
  }
  try { unlinkSync(tmpConfigPath); } catch { /* ignore */ }
});

describe("baseline output métriques (CF-01)", () => {
  it("npm run metrics --json correspond au baseline figé", () => {
    const out = execFileSync(
      "npm",
      [
        "run",
        "metrics",
        "--silent",
        "--",
        "-c",
        tmpConfigPath,
        "-b",
        "board.fake.yaml",
        "--json",
      ],
      {
        encoding: "utf-8",
        shell: true,
      },
    );
    const baseline = readFileSync(
      "tests/snapshots/__snapshots__/metrics-baseline.fake.json",
      "utf-8",
    );
    expect(JSON.parse(out)).toEqual(JSON.parse(baseline));
  }, 60_000);
});
