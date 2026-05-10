import { describe, it, expect } from "vitest";
import { bucketize, getBucketLabels, SECONDS_PER_DAY, type IssueEstimation } from "../../src/metrics/utils";
import type { EstimationConfig } from "../../src/metrics/types";

const emptyIssue: IssueEstimation = { originalEstimateSeconds: null, storyPoints: null, sizeLabel: null };

describe("bucketize — story-points, seuils par défaut (xs=1, s=3, m=8, l=13)", () => {
  const cfg: EstimationConfig = { method: "story-points" };

  it("5 SP → M", () => {
    expect(bucketize({ ...emptyIssue, storyPoints: 5 }, false, cfg)).toBe("M");
  });

  it("0 SP → UNESTIMATED", () => {
    expect(bucketize({ ...emptyIssue, storyPoints: 0 }, false, cfg)).toBe("UNESTIMATED");
  });

  it("SP null → UNESTIMATED", () => {
    expect(bucketize(emptyIssue, false, cfg)).toBe("UNESTIMATED");
  });

  it("8 SP → L (8 n'est pas < m=8)", () => {
    expect(bucketize({ ...emptyIssue, storyPoints: 8 }, false, cfg)).toBe("L");
  });

  it("13 SP → XL", () => {
    expect(bucketize({ ...emptyIssue, storyPoints: 13 }, false, cfg)).toBe("XL");
  });

  it("bug avec storyPoints renseigné → BUG (règle bug prime)", () => {
    expect(bucketize({ ...emptyIssue, storyPoints: 8 }, true, cfg)).toBe("BUG");
  });
});

describe("bucketize — numeric, seuils custom (xs=2, s=5, m=10, l=20)", () => {
  const cfg: EstimationConfig = { method: "numeric", jiraField: "customfield_99", bucketThresholds: { xs: 2, s: 5, m: 10, l: 20 } };

  it("3 → S ([2, 5))", () => {
    expect(bucketize({ ...emptyIssue, storyPoints: 3 }, false, cfg)).toBe("S");
  });

  it("0 → UNESTIMATED", () => {
    expect(bucketize({ ...emptyIssue, storyPoints: 0 }, false, cfg)).toBe("UNESTIMATED");
  });

  it("1 → XS (< 2)", () => {
    expect(bucketize({ ...emptyIssue, storyPoints: 1 }, false, cfg)).toBe("XS");
  });

  it("25 → XL (>= 20)", () => {
    expect(bucketize({ ...emptyIssue, storyPoints: 25 }, false, cfg)).toBe("XL");
  });
});

describe("bucketize — t-shirt, mapping direct", () => {
  const cfg: EstimationConfig = { method: "t-shirt", jiraField: "customfield_10200" };

  it("sizeLabel='M' → M", () => {
    expect(bucketize({ ...emptyIssue, sizeLabel: "M" }, false, cfg)).toBe("M");
  });

  it("sizeLabel='XL' → XL", () => {
    expect(bucketize({ ...emptyIssue, sizeLabel: "XL" }, false, cfg)).toBe("XL");
  });

  it("sizeLabel=null → UNESTIMATED", () => {
    expect(bucketize(emptyIssue, false, cfg)).toBe("UNESTIMATED");
  });
});

describe("bucketize — time, seuils par défaut (xs=0.5, s=1, m=3, l=5)", () => {
  const cfg: EstimationConfig = { method: "time" };

  it("57600s (2j) → M ([1j, 3j))", () => {
    expect(bucketize({ ...emptyIssue, originalEstimateSeconds: 57600 }, false, cfg)).toBe("M");
  });

  it("original_estimate_seconds null → UNESTIMATED", () => {
    expect(bucketize(emptyIssue, false, cfg)).toBe("UNESTIMATED");
  });

  it("seuils time custom: 28800s (1j) avec xs=1, s=2, m=5, l=10 → S", () => {
    const customCfg: EstimationConfig = { method: "time", bucketThresholds: { xs: 1, s: 2, m: 5, l: 10 } };
    expect(bucketize({ ...emptyIssue, originalEstimateSeconds: SECONDS_PER_DAY }, false, customCfg)).toBe("S");
  });
});

describe("bucketize — none", () => {
  const cfg: EstimationConfig = { method: "none" };

  it("feature avec estimation → UNESTIMATED", () => {
    expect(bucketize({ ...emptyIssue, originalEstimateSeconds: 28800 }, false, cfg)).toBe("UNESTIMATED");
  });

  it("bug en mode none → BUG", () => {
    expect(bucketize(emptyIssue, true, cfg)).toBe("BUG");
  });
});

describe("getBucketLabels — story-points, seuils par défaut", () => {
  const cfg: EstimationConfig = { method: "story-points" };

  it("XS → 'XS (<1 SP)'", () => {
    expect(getBucketLabels(cfg).XS).toBe("XS (<1 SP)");
  });

  it("M → 'M (3-8 SP)'", () => {
    expect(getBucketLabels(cfg).M).toBe("M (3-8 SP)");
  });

  it("XL → 'XL (≥13 SP)'", () => {
    expect(getBucketLabels(cfg).XL).toBe("XL (≥13 SP)");
  });
});

describe("getBucketLabels — numeric sans unité", () => {
  const cfg: EstimationConfig = { method: "numeric", jiraField: "cf", bucketThresholds: { xs: 2, s: 5, m: 10, l: 20 } };

  it("XS → 'XS (<2)'", () => {
    expect(getBucketLabels(cfg).XS).toBe("XS (<2)");
  });

  it("M → 'M (5-10)'", () => {
    expect(getBucketLabels(cfg).M).toBe("M (5-10)");
  });
});

describe("getBucketLabels — time", () => {
  it("XS → 'XS (<0.5j)'", () => {
    expect(getBucketLabels({ method: "time" }).XS).toBe("XS (<0.5j)");
  });
});
