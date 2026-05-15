import { describe, it, expect } from "vitest";
import { execFileSync } from "child_process";
import { readFileSync } from "fs";

describe("metrics output baseline (CF-01)", () => {
  it("npm run metrics --json matches baseline", () => {
    const out = execFileSync(
      "npm",
      [
        "run",
        "metrics",
        "--silent",
        "--",
        "-c",
        "config.fake.yaml",
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
