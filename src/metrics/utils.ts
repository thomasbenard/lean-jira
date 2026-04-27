// Jours ouvrés (lun-ven) entre deux timestamps ISO. Fraction de journée incluse
// si elle tombe un jour ouvré. Fenêtres de snapshot restent en calendaire.
export function workingDaysBetween(from: string, to: string): number {
  const startMs = new Date(from).getTime();
  const endMs = new Date(to).getTime();
  if (endMs <= startMs) return 0;

  const calDays = (endMs - startMs) / 86_400_000;
  const wholeDays = Math.floor(calDays);
  const frac = calDays - wholeDays;

  const startDow = new Date(from).getDay(); // 0=dim, 6=sam
  const fullWeeks = Math.floor(wholeDays / 7);
  const rem = wholeDays % 7;

  let extraWorking = 0;
  for (let i = 0; i < rem; i++) {
    const d = (startDow + i) % 7;
    if (d !== 0 && d !== 6) extraWorking++;
  }

  const partialDow = (startDow + wholeDays) % 7;
  const fracWorking = (partialDow !== 0 && partialDow !== 6) ? frac : 0;

  return fullWeeks * 5 + extraWorking + fracWorking;
}

// Tableau doit être trié en ordre croissant
export function percentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 0;
  const index = Math.ceil((p / 100) * sortedValues.length) - 1;
  return sortedValues[Math.max(0, index)];
}

// 1 jour-personne = 8h = 28800 secondes (convention Atlassian par défaut)
export const SECONDS_PER_DAY = 28800;

export type SizeBucket = "XS" | "S" | "M" | "L" | "XL" | "BUG" | "UNESTIMATED";

export const BUCKET_ORDER: SizeBucket[] = ["XS", "S", "M", "L", "XL", "BUG", "UNESTIMATED"];

export const BUCKET_LABELS: Record<SizeBucket, string> = {
  XS: "XS (<0.5j)",
  S: "S (0.5-1j)",
  M: "M (1-3j)",
  L: "L (3-5j)",
  XL: "XL (≥5j)",
  BUG: "BUG",
  UNESTIMATED: "UNESTIMATED",
};

export function bucketize(estimateSeconds: number | null | undefined, isBug = false): SizeBucket {
  if (isBug) return "BUG";
  if (estimateSeconds == null || estimateSeconds <= 0) return "UNESTIMATED";
  const days = estimateSeconds / SECONDS_PER_DAY;
  if (days < 0.5) return "XS";
  if (days < 1) return "S";
  if (days < 3) return "M";
  if (days < 5) return "L";
  return "XL";
}

export function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export interface DurationStats {
  count: number;
  excludedOutliers: number;
  avgDays: number;
  medianDays: number;
  p85Days: number;
  p95Days: number;
}

// Tukey upper fence: Q3 + 1.5 * IQR, queue droite seulement (cycle-time >= 0).
// Conserve la médiane et P85 stables, retire les valeurs extrêmes qui tirent la moyenne.
export function removeUpperOutliers(values: number[]): { kept: number[]; excluded: number } {
  if (values.length < 4) return { kept: values, excluded: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const q1 = percentile(sorted, 25);
  const q3 = percentile(sorted, 75);
  const iqr = q3 - q1;
  const upper = q3 + 1.5 * iqr;
  const kept = sorted.filter((v) => v <= upper);
  return { kept, excluded: sorted.length - kept.length };
}

export function statsFromDays(days: number[], excludeOutliers = true): DurationStats {
  const { kept, excluded } = excludeOutliers ? removeUpperOutliers(days) : { kept: [...days], excluded: 0 };
  const sorted = kept.sort((a, b) => a - b);
  return {
    count: sorted.length,
    excludedOutliers: excluded,
    avgDays: avg(sorted),
    medianDays: percentile(sorted, 50),
    p85Days: percentile(sorted, 85),
    p95Days: percentile(sorted, 95),
  };
}
