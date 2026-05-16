import { BUCKET_LABELS, BUCKET_ORDER } from "../metrics/utils";
import type { AgingWipSummary, AgingRisk } from "../metrics/agingWip";
import type { ForecastSummary } from "../metrics/forecast";
import { t, type LocaleShape } from "../i18n/index";

export function escapeHtml(s: string): string {
  const map: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return s.replace(/[&<>"']/g, (c) => map[c] ?? c);
}

export function syncMetaLabel(lastSyncAt: string | null): string {
  if (!lastSyncAt) {return t("report.syncMeta.neverSynced");}
  return t("report.syncMeta.lastSync", { datetime: lastSyncAt.slice(0, 16).replace("T", " ") });
}

export function staleBannerHtml(isSyncStale: boolean, lastSyncAt: string | null): string {
  if (!isSyncStale) {return "";}
  const syncRef = lastSyncAt
    ? t("report.stale.syncRef", { date: lastSyncAt.slice(0, 10) })
    : t("report.stale.neverDone");
  return `<div class="stale-warning">${escapeHtml(t("report.stale.warning", { syncRef }))}</div>`;
}

export function issueLink(key: string, jiraBaseUrl: string): string {
  if (!key) {return "";}
  const base = jiraBaseUrl.replace(/\/$/, "");
  return `<a href="${escapeHtml(base)}/browse/${escapeHtml(key)}" target="_blank" rel="noopener">${escapeHtml(key)}</a>`;
}

export function helpBtn(key: string): string {
  const titleKey = `report.help.${key}.title` as keyof LocaleShape;
  const bodyKey = `report.help.${key}.body` as keyof LocaleShape;
  const title = t(titleKey);
  if (!title) {return "";}
  return `<span class="help-wrap"><button class="help-btn" aria-label="${escapeHtml(t("report.help.btn"))}">?</button><span class="help-popover" role="tooltip"><strong>${escapeHtml(title)}</strong>${escapeHtml(t(bodyKey))}</span></span>`;
}

export function fmtInt(v: number | null): string {
  return v === null ? "—" : String(Math.round(v));
}

export function hide(show: boolean): string { return show ? "" : ' style="display:none"'; }

export const RISK_CLASS: Record<AgingRisk, string> = {
  ok: "risk-ok",
  watch: "risk-watch",
  "at-risk": "risk-at-risk",
  critical: "risk-critical",
};

export function agingRowsHtml(data: AgingWipSummary, jiraBaseUrl: string): string {
  if (data.issues.length === 0) {
    return `<tr><td colspan="4">${escapeHtml(t("report.aging.noItems"))}</td></tr>`;
  }
  return data.issues
    .slice(0, 15)
    .map(
      (i) =>
        `<tr><td>${issueLink(i.issueKey, jiraBaseUrl)}</td><td>${escapeHtml(i.status)}</td><td>${i.ageDays.toFixed(1)}j</td><td class="${RISK_CLASS[i.riskLevel]}">${escapeHtml(i.riskLevel)}</td></tr>`,
    )
    .join("");
}

export interface BucketStatsLike {
  count: number;
  median: number;
  p85: number;
}

export function bySizeRows(data: Partial<Record<string, BucketStatsLike>>): string {
  return BUCKET_ORDER.map((b) => {
    const s = data[b];
    if (!s || s.count === 0) {return "";}
    return `<tr><td>${escapeHtml(BUCKET_LABELS[b])}</td><td>${s.count}</td><td>${s.median.toFixed(1)}j</td><td>${s.p85.toFixed(1)}j</td></tr>`;
  }).join("");
}

export function forecastTableRows(data: ForecastSummary): string {
  if (data.byHorizon.length === 0) {
    return `<tr><td colspan="5">${escapeHtml(t("report.forecast.noThroughput"))}</td></tr>`;
  }
  return data.byHorizon
    .map(
      (h) =>
        `<tr><td>${h.weeks} ${escapeHtml(t("report.forecast.weeks"))}</td><td><strong>${h.p15.toFixed(0)}</strong></td><td>${h.p50.toFixed(0)}</td><td>${h.p85.toFixed(0)}</td><td>${h.p95.toFixed(0)}</td></tr>`,
    )
    .join("");
}
