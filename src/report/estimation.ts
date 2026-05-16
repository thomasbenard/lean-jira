import { type EstimationConfig } from "../metrics/types";
import { t } from "../i18n/index";

export interface EstimationFlags {
  showWeighted: boolean;
  showNormalized: boolean;
  showBySize: boolean;
  weightedUnit: "j-h" | "SP" | "pts";
  contextLabel: string;
}

export function estimationFlags(est: EstimationConfig): EstimationFlags {
  const m = est.method;
  const thr = { xs: 1, s: 3, m: 8, l: 13, ...est.bucketThresholds };
  return {
    showWeighted:       m !== "t-shirt" && m !== "none",
    showNormalized:     m === "time",
    showBySize:         m !== "none",
    weightedUnit:       m === "story-points" ? "SP" : m === "numeric" ? "pts" : "j-h",
    contextLabel:
      m === "time"          ? t("report.estimation.time")
      : m === "story-points" ? t("report.estimation.storyPoints", { xs: String(thr.xs), s: String(thr.s), m: String(thr.m), l: String(thr.l) })
      : m === "numeric"      ? t("report.estimation.numeric")
      : m === "t-shirt"      ? t("report.estimation.tShirt")
      : t("report.estimation.none"),
  };
}
